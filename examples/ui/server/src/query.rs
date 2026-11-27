use std::cmp::Ordering;
use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, TimeZone, Utc};

use crate::error::ApiError;
use crate::model::{Project, ProjectPage, ProjectStatus};

pub const DEFAULT_PAGE: u64 = 1;
pub const DEFAULT_PAGE_SIZE: u64 = 20;
pub const MIN_PAGE_SIZE: u64 = 10;
pub const MAX_PAGE_SIZE: u64 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortField {
    Name,
    Owner,
    Status,
    Budget,
    CreatedAt,
}

impl SortField {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "name" => Some(Self::Name),
            "owner" => Some(Self::Owner),
            "status" => Some(Self::Status),
            "budget" => Some(Self::Budget),
            "createdAt" => Some(Self::CreatedAt),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Name => "name",
            Self::Owner => "owner",
            Self::Status => "status",
            Self::Budget => "budget",
            Self::CreatedAt => "createdAt",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortOrder {
    Asc,
    Desc,
}

impl SortOrder {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "asc" => Some(Self::Asc),
            "desc" => Some(Self::Desc),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectQuery {
    pub page: u64,
    pub page_size: u64,
    pub sort: SortField,
    pub order: SortOrder,
    pub q: Option<String>,
    pub status: Option<ProjectStatus>,
    pub owner: Option<String>,
    pub tag: Option<String>,
    pub budget_min: Option<f64>,
    pub budget_max: Option<f64>,
    pub created_from: Option<DateTime<Utc>>,
    pub created_to: Option<DateTime<Utc>>,
}

impl Default for ProjectQuery {
    fn default() -> Self {
        Self {
            page: DEFAULT_PAGE,
            page_size: DEFAULT_PAGE_SIZE,
            sort: SortField::CreatedAt,
            order: SortOrder::Desc,
            q: None,
            status: None,
            owner: None,
            tag: None,
            budget_min: None,
            budget_max: None,
            created_from: None,
            created_to: None,
        }
    }
}

impl ProjectQuery {
    pub fn parse(params: &HashMap<String, String>) -> Result<Self, ApiError> {
        let mut query = Self::default();

        if let Some(raw) = non_empty(params, "page") {
            let page = parse_integer::<u64>(raw, "page")?;
            if page < 1 {
                return Err(invalid("`page` must be greater than or equal to 1"));
            }
            query.page = page;
        }

        if let Some(raw) = non_empty(params, "pageSize") {
            let page_size = parse_integer::<u64>(raw, "pageSize")?;
            if !(MIN_PAGE_SIZE..=MAX_PAGE_SIZE).contains(&page_size) {
                return Err(invalid(format!(
                    "`pageSize` must be between {MIN_PAGE_SIZE} and {MAX_PAGE_SIZE}"
                )));
            }
            query.page_size = page_size;
        }

        if let Some(raw) = non_empty(params, "sort") {
            query.sort = SortField::parse(raw).ok_or_else(|| {
                invalid("`sort` must be one of: name, owner, status, budget, createdAt")
            })?;
        }

        if let Some(raw) = non_empty(params, "order") {
            query.order = SortOrder::parse(raw)
                .ok_or_else(|| invalid("`order` must be one of: asc, desc"))?;
        }

        if let Some(raw) = non_empty(params, "q") {
            let lowered = raw.to_lowercase();
            if !lowered.is_empty() {
                query.q = Some(lowered);
            }
        }

        if let Some(raw) = non_empty(params, "status") {
            query.status =
                Some(ProjectStatus::parse(raw).ok_or_else(|| {
                    invalid("`status` must be one of: active, review, done, paused")
                })?);
        }

        query.owner = non_empty(params, "owner").map(str::to_owned);
        query.tag = non_empty(params, "tag").map(str::to_owned);

        query.budget_min = non_empty(params, "budgetMin")
            .map(|raw| parse_budget(raw, "budgetMin"))
            .transpose()?;
        query.budget_max = non_empty(params, "budgetMax")
            .map(|raw| parse_budget(raw, "budgetMax"))
            .transpose()?;

        if let (Some(min), Some(max)) = (query.budget_min, query.budget_max) {
            if min > max {
                return Err(invalid(
                    "`budgetMin` must be less than or equal to `budgetMax`",
                ));
            }
        }

        query.created_from = non_empty(params, "createdFrom")
            .map(|raw| parse_date(raw, "createdFrom", false))
            .transpose()?;
        query.created_to = non_empty(params, "createdTo")
            .map(|raw| parse_date(raw, "createdTo", true))
            .transpose()?;

        if let (Some(from), Some(to)) = (query.created_from, query.created_to) {
            if from > to {
                return Err(invalid(
                    "`createdFrom` must be less than or equal to `createdTo`",
                ));
            }
        }

        Ok(query)
    }

    pub fn matches(&self, project: &Project) -> bool {
        if let Some(q) = &self.q {
            let name = project.name.to_lowercase();
            let owner = project.owner.to_lowercase();
            if !name.contains(q) && !owner.contains(q) {
                return false;
            }
        }
        if let Some(status) = self.status {
            if project.status != status {
                return false;
            }
        }
        if let Some(owner) = &self.owner {
            if &project.owner != owner {
                return false;
            }
        }
        if let Some(tag) = &self.tag {
            if !project.tags.iter().any(|value| value == tag) {
                return false;
            }
        }
        if let Some(min) = self.budget_min {
            if project.budget < min {
                return false;
            }
        }
        if let Some(max) = self.budget_max {
            if project.budget > max {
                return false;
            }
        }
        if let Some(from) = self.created_from {
            if project.created_at < from {
                return false;
            }
        }
        if let Some(to) = self.created_to {
            if project.created_at > to {
                return false;
            }
        }
        true
    }

    pub fn sort(&self, projects: &mut [Project]) {
        projects.sort_by(|left, right| {
            let primary = match self.sort {
                SortField::Name => compare_case_insensitive(&left.name, &right.name),
                SortField::Owner => compare_case_insensitive(&left.owner, &right.owner),
                SortField::Status => left.status.as_str().cmp(right.status.as_str()),
                SortField::Budget => left
                    .budget
                    .partial_cmp(&right.budget)
                    .unwrap_or(Ordering::Equal),
                SortField::CreatedAt => left.created_at.cmp(&right.created_at),
            };
            let primary = match self.order {
                SortOrder::Asc => primary,
                SortOrder::Desc => primary.reverse(),
            };
            if primary == Ordering::Equal {
                left.id.cmp(&right.id)
            } else {
                primary
            }
        });
    }

    pub fn filter_and_paginate(&self, mut projects: Vec<Project>) -> ProjectPage {
        projects.retain(|project| self.matches(project));
        self.sort(&mut projects);
        self.paginate(projects)
    }

    pub fn paginate(&self, projects: Vec<Project>) -> ProjectPage {
        let total = projects.len() as u64;
        let offset = self.page.saturating_sub(1).saturating_mul(self.page_size);
        let skip = usize::try_from(offset).unwrap_or(usize::MAX);
        let items = projects
            .into_iter()
            .skip(skip)
            .take(self.page_size as usize)
            .collect();

        ProjectPage {
            items,
            total,
            page: self.page,
            page_size: self.page_size,
        }
    }
}

fn non_empty<'a>(params: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    params
        .get(key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
}

fn invalid(message: impl Into<String>) -> ApiError {
    ApiError::bad_request("invalid_query", message)
}

fn parse_integer<T>(raw: &str, name: &str) -> Result<T, ApiError>
where
    T: std::str::FromStr,
{
    raw.parse()
        .map_err(|_| invalid(format!("`{name}` must be a valid integer")))
}

fn parse_budget(raw: &str, name: &str) -> Result<f64, ApiError> {
    let value: f64 = raw
        .parse()
        .map_err(|_| invalid(format!("`{name}` must be a valid number")))?;
    if !value.is_finite() || value < 0.0 {
        return Err(invalid(format!(
            "`{name}` must be a finite number greater than or equal to 0"
        )));
    }
    Ok(value)
}

fn parse_date(raw: &str, name: &str, end_of_day: bool) -> Result<DateTime<Utc>, ApiError> {
    if let Ok(value) = DateTime::parse_from_rfc3339(raw) {
        return Ok(value.with_timezone(&Utc));
    }
    if let Ok(date) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        let naive = if end_of_day {
            date.and_hms_opt(23, 59, 59)
        } else {
            date.and_hms_opt(0, 0, 0)
        };
        if let Some(naive) = naive {
            return Ok(Utc.from_utc_datetime(&naive));
        }
    }
    Err(invalid(format!(
        "`{name}` must be an RFC 3339 timestamp or a YYYY-MM-DD date"
    )))
}

fn compare_case_insensitive(left: &str, right: &str) -> Ordering {
    left.to_lowercase()
        .cmp(&right.to_lowercase())
        .then_with(|| left.cmp(right))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ProjectStatus;

    fn params(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    }

    fn project(
        id: u64,
        name: &str,
        owner: &str,
        status: ProjectStatus,
        tags: &[&str],
        budget: f64,
        created_at: DateTime<Utc>,
    ) -> Project {
        Project {
            id,
            name: name.into(),
            owner: owner.into(),
            status,
            tags: tags.iter().map(|tag| (*tag).to_owned()).collect(),
            budget,
            created_at,
        }
    }

    #[test]
    fn parses_defaults() {
        let query = ProjectQuery::parse(&params(&[])).expect("defaults");
        assert_eq!(query.page, 1);
        assert_eq!(query.page_size, 20);
        assert_eq!(query.sort, SortField::CreatedAt);
        assert_eq!(query.order, SortOrder::Desc);
        assert!(query.q.is_none());
    }

    #[test]
    fn parses_all_parameters() {
        let query = ProjectQuery::parse(&params(&[
            ("page", "3"),
            ("pageSize", "50"),
            ("sort", "name"),
            ("order", "asc"),
            ("q", "  АДА "),
            ("status", "review"),
            ("owner", "Ада"),
            ("tag", "api"),
            ("budgetMin", "10"),
            ("budgetMax", "20.5"),
            ("createdFrom", "2025-01-01"),
            ("createdTo", "2025-12-31T23:59:59Z"),
        ]))
        .expect("valid query");
        assert_eq!(query.page, 3);
        assert_eq!(query.page_size, 50);
        assert_eq!(query.sort, SortField::Name);
        assert_eq!(query.order, SortOrder::Asc);
        assert_eq!(query.q.as_deref(), Some("ада"));
        assert_eq!(query.status, Some(ProjectStatus::Review));
        assert_eq!(
            query.created_from.unwrap().to_rfc3339(),
            "2025-01-01T00:00:00+00:00"
        );
        assert_eq!(
            query.created_to.unwrap().to_rfc3339(),
            "2025-12-31T23:59:59+00:00"
        );
    }

    #[test]
    fn rejects_invalid_parameters() {
        let cases = [
            ("page", "0"),
            ("page", "abc"),
            ("pageSize", "9"),
            ("pageSize", "101"),
            ("sort", "id"),
            ("order", "up"),
            ("status", "archived"),
            ("budgetMin", "-1"),
            ("budgetMin", "NaN"),
            ("createdFrom", "yesterday"),
            ("createdTo", "2025-13-40"),
        ];
        for (key, value) in cases {
            let error = ProjectQuery::parse(&params(&[(key, value)])).unwrap_err();
            assert_eq!(error.status.as_u16(), 400, "{key}={value}");
            assert_eq!(error.code, "invalid_query", "{key}={value}");
        }

        let error =
            ProjectQuery::parse(&params(&[("budgetMin", "100"), ("budgetMax", "10")])).unwrap_err();
        assert_eq!(error.code, "invalid_query");

        let error = ProjectQuery::parse(&params(&[
            ("createdFrom", "2025-02-01"),
            ("createdTo", "2025-01-01"),
        ]))
        .unwrap_err();
        assert_eq!(error.code, "invalid_query");
    }

    #[test]
    fn filters_case_insensitively_unicode() {
        let now = Utc::now();
        let records = vec![
            project(
                1,
                "Дизайн-система",
                "Ада",
                ProjectStatus::Active,
                &["ui"],
                10.0,
                now,
            ),
            project(
                2,
                "SSR-пул",
                "Грейс",
                ProjectStatus::Done,
                &["api"],
                20.0,
                now,
            ),
        ];
        let query = ProjectQuery::parse(&params(&[("q", "ДИЗАЙН")])).expect("query");
        let page = query.filter_and_paginate(records.clone());
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].id, 1);

        let query = ProjectQuery::parse(&params(&[("q", "грейс")])).expect("query");
        let page = query.filter_and_paginate(records.clone());
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].id, 2);

        let query =
            ProjectQuery::parse(&params(&[("status", "done"), ("tag", "api")])).expect("query");
        let page = query.filter_and_paginate(records.clone());
        assert_eq!(page.total, 1);

        let query = ProjectQuery::parse(&params(&[("budgetMin", "15"), ("budgetMax", "25")]))
            .expect("query");
        let page = query.filter_and_paginate(records);
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].id, 2);
    }

    #[test]
    fn filters_by_created_range() {
        let now = Utc::now();
        let records = vec![
            project(
                1,
                "Old",
                "A",
                ProjectStatus::Active,
                &[],
                1.0,
                now - chrono::Duration::days(10),
            ),
            project(2, "New", "B", ProjectStatus::Active, &[], 2.0, now),
        ];
        let query = ProjectQuery::parse(&params(&[(
            "createdFrom",
            &(now - chrono::Duration::days(5)).to_rfc3339(),
        )]))
        .expect("query");
        let page = query.filter_and_paginate(records.clone());
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].id, 2);

        let query = ProjectQuery::parse(&params(&[(
            "createdTo",
            &(now - chrono::Duration::days(5)).to_rfc3339(),
        )]))
        .expect("query");
        let page = query.filter_and_paginate(records);
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].id, 1);
    }

    #[test]
    fn sorts_by_every_field_and_order() {
        let now = Utc::now();
        let records = vec![
            project(2, "beta", "Zoe", ProjectStatus::Review, &[], 20.0, now),
            project(
                1,
                "Alpha",
                "ada",
                ProjectStatus::Done,
                &[],
                10.0,
                now - chrono::Duration::days(1),
            ),
            project(
                3,
                "Гамма",
                "Иван",
                ProjectStatus::Active,
                &[],
                30.0,
                now + chrono::Duration::days(1),
            ),
        ];

        let query =
            ProjectQuery::parse(&params(&[("sort", "name"), ("order", "asc")])).expect("query");
        let mut sorted = records.clone();
        query.sort(&mut sorted);
        assert_eq!(
            sorted.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );

        let query =
            ProjectQuery::parse(&params(&[("sort", "owner"), ("order", "desc")])).expect("query");
        let mut sorted = records.clone();
        query.sort(&mut sorted);
        assert_eq!(
            sorted.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![3, 2, 1]
        );

        let query =
            ProjectQuery::parse(&params(&[("sort", "budget"), ("order", "asc")])).expect("query");
        let mut sorted = records.clone();
        query.sort(&mut sorted);
        assert_eq!(
            sorted.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );

        let query = ProjectQuery::parse(&params(&[("sort", "createdAt"), ("order", "desc")]))
            .expect("query");
        let mut sorted = records;
        query.sort(&mut sorted);
        assert_eq!(
            sorted.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![3, 2, 1]
        );
    }

    #[test]
    fn paginates_after_filtering() {
        let now = Utc::now();
        let records: Vec<Project> = (1..=25)
            .map(|id| {
                project(
                    id,
                    &format!("Project {id:02}"),
                    "Owner",
                    ProjectStatus::Active,
                    &[],
                    id as f64,
                    now,
                )
            })
            .collect();

        let query = ProjectQuery::parse(&params(&[
            ("page", "2"),
            ("pageSize", "10"),
            ("sort", "budget"),
            ("order", "asc"),
        ]))
        .expect("query");
        let page = query.filter_and_paginate(records);
        assert_eq!(page.total, 25);
        assert_eq!(page.page, 2);
        assert_eq!(page.page_size, 10);
        assert_eq!(page.items.len(), 10);
        assert_eq!(page.items[0].id, 11);
    }

    #[test]
    fn huge_page_returns_empty_items() {
        let query =
            ProjectQuery::parse(&params(&[("page", &u64::MAX.to_string())])).expect("query");
        let page = query.paginate(Vec::new());
        assert!(page.items.is_empty());
        assert_eq!(page.total, 0);
    }
}
