use std::io::Read;
use std::time::Duration;

use silent_protocol::SilentProto;

pub const CONTENT_TYPE: &str = "application/x-silent-protocol";
pub const DEFAULT_API_URL: &str = "http://127.0.0.1:6108";

#[derive(Clone, Copy, Debug, PartialEq, Eq, silent_protocol::SilentProto)]
pub enum ProjectStatus {
    Active,
    Review,
    Done,
    Paused,
}

impl ProjectStatus {
    pub const ALL: [Self; 4] = [Self::Active, Self::Review, Self::Done, Self::Paused];

    pub const fn label(self) -> &'static str {
        match self {
            Self::Active => "Активен",
            Self::Review => "На ревью",
            Self::Done => "Завершён",
            Self::Paused => "Пауза",
        }
    }

    pub const fn query(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Review => "review",
            Self::Done => "done",
            Self::Paused => "paused",
        }
    }
}

#[derive(Clone, Debug, PartialEq, silent_protocol::SilentProto)]
pub struct Project {
    pub budget: f64,
    #[proto(rename = "createdAt", date)]
    pub created_at: i64,
    #[proto(uint32)]
    pub id: u32,
    pub name: String,
    pub owner: String,
    #[proto(enum_type)]
    pub status: ProjectStatus,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, silent_protocol::SilentProto)]
pub struct ProjectPage {
    pub items: Vec<Project>,
    #[proto(uint32)]
    pub page: u32,
    #[proto(rename = "pageSize", uint32)]
    pub page_size: u32,
    #[proto(uint32)]
    pub total: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProjectMeta {
    pub owners: Vec<String>,
    pub statuses: Vec<ProjectStatus>,
    pub tags: Vec<String>,
}

impl SilentProto for ProjectMeta {
    fn write(
        &self,
        encoder: &mut silent_protocol::Encoder<'_>,
    ) -> Result<(), silent_protocol::ProtocolError> {
        use silent_protocol::ProtoEnum;
        encoder.write_length(self.owners.len())?;
        for owner in &self.owners {
            encoder.write_string(owner)?;
        }
        encoder.write_length(self.statuses.len())?;
        for status in &self.statuses {
            encoder.write_enum(status.to_proto())?;
        }
        encoder.write_length(self.tags.len())?;
        for tag in &self.tags {
            encoder.write_string(tag)?;
        }
        Ok(())
    }

    fn read(
        decoder: &mut silent_protocol::Decoder<'_>,
    ) -> Result<Self, silent_protocol::ProtocolError> {
        use silent_protocol::ProtoEnum;
        let owner_count = decoder.read_length()?;
        let mut owners = Vec::with_capacity(owner_count);
        for _ in 0..owner_count {
            owners.push(decoder.read_string()?);
        }
        let status_count = decoder.read_length()?;
        let mut statuses = Vec::with_capacity(status_count);
        for _ in 0..status_count {
            statuses.push(ProjectStatus::from_proto(decoder.read_enum_value()?)?);
        }
        let tag_count = decoder.read_length()?;
        let mut tags = Vec::with_capacity(tag_count);
        for _ in 0..tag_count {
            tags.push(decoder.read_string()?);
        }
        Ok(Self {
            owners,
            statuses,
            tags,
        })
    }

    fn schema() -> Vec<silent_protocol::SchemaEntry> {
        Vec::new()
    }
}

#[derive(Clone, Debug)]
pub struct ProjectQuery {
    pub page: usize,
    pub page_size: usize,
    pub sort: SortField,
    pub ascending: bool,
    pub search: String,
    pub status: Option<ProjectStatus>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SortField {
    Name,
    Owner,
    Status,
    Budget,
    CreatedAt,
}

impl SortField {
    pub const fn query(self) -> &'static str {
        match self {
            Self::Name => "name",
            Self::Owner => "owner",
            Self::Status => "status",
            Self::Budget => "budget",
            Self::CreatedAt => "createdAt",
        }
    }
}

impl ProjectQuery {
    pub fn to_query_string(&self) -> String {
        let mut parts = vec![
            format!("page={}", self.page + 1),
            format!("pageSize={}", self.page_size),
            format!("sort={}", self.sort.query()),
            format!("order={}", if self.ascending { "asc" } else { "desc" }),
        ];
        if !self.search.trim().is_empty() {
            parts.push(format!("q={}", encode(&self.search)));
        }
        if let Some(status) = self.status {
            parts.push(format!("status={}", status.query()));
        }
        parts.join("&")
    }
}

fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub fn api_url() -> String {
    std::env::var("SILENT_API_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_API_URL.to_string())
        .trim_end_matches('/')
        .to_string()
}

pub fn load_projects(query: &ProjectQuery) -> Result<(ProjectPage, Option<ProjectMeta>), String> {
    let base = api_url();
    let url = format!("{base}/api/projects?{}", query.to_query_string());
    let page: ProjectPage = get_protocol(&url)?;
    let meta = get_protocol::<ProjectMeta>(&format!("{base}/api/meta")).ok();
    Ok((page, meta))
}

fn get_protocol<T: SilentProto>(url: &str) -> Result<T, String> {
    let response = ureq::get(url)
        .timeout(Duration::from_secs(5))
        .set("Accept", CONTENT_TYPE)
        .call()
        .map_err(|error| format!("{url}: {error}"))?;
    let status = response.status();
    if !(200..300).contains(&status) {
        return Err(format!("{url}: HTTP {status}"));
    }
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(2 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    T::decode(&bytes).map_err(|error| format!("{url}: {error}"))
}

pub fn format_budget(value: f64) -> String {
    if value >= 1_000_000.0 {
        format!("₽{:.1}M", value / 1_000_000.0)
    } else if value >= 1_000.0 {
        format!("₽{:.0}K", value / 1_000.0)
    } else {
        format!("₽{value:.0}")
    }
}

pub fn format_date(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    format!("{day:02}.{month:02}.{year}")
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_string_is_web_compatible() {
        let query = ProjectQuery {
            page: 1,
            page_size: 10,
            sort: SortField::CreatedAt,
            ascending: false,
            search: "silent ui".into(),
            status: Some(ProjectStatus::Review),
        };
        assert_eq!(
            query.to_query_string(),
            "page=2&pageSize=10&sort=createdAt&order=desc&q=silent%20ui&status=review"
        );
    }

    #[test]
    fn dates_use_epoch_milliseconds() {
        assert_eq!(format_date(0), "01.01.1970");
        assert_eq!(format_date(1_724_000_000_000), "18.08.2024");
    }

    #[test]
    fn budgets_are_compact() {
        assert_eq!(format_budget(4_200_000.0), "₽4.2M");
        assert_eq!(format_budget(980_000.0), "₽980K");
    }

    #[test]
    fn wire_page_roundtrip() {
        let page = ProjectPage {
            items: vec![Project {
                budget: 10.0,
                created_at: 1_700_000_000_000,
                id: 7,
                name: "Demo".into(),
                owner: "Ada".into(),
                status: ProjectStatus::Active,
                tags: vec!["gpu".into()],
            }],
            page: 1,
            page_size: 10,
            total: 240,
        };
        let bytes = page.encode().expect("encode");
        let restored = ProjectPage::decode(&bytes).expect("decode");
        assert_eq!(restored, page);
    }
}
