use std::fmt;

use axum::{
    body::Body,
    http::{header, StatusCode},
    response::Response,
};
use chrono::{DateTime, Utc};
use silent_protocol::{
    Decoder, Encoder, Limits, ProtoEnum, ProtocolError, SchemaEntry, SchemaField, SchemaType,
    SilentProto,
};

use crate::model::{self, ProjectStatus};

pub const CONTENT_TYPE: &str = "application/x-silent-protocol";
pub const LIMITS: Limits = Limits::new(32, 2 * 1024 * 1024);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WireError {
    message: String,
}

impl WireError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for WireError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for WireError {}

fn to_u32(value: u64, field: &str) -> Result<u32, WireError> {
    u32::try_from(value)
        .map_err(|_| WireError::new(format!("`{field}` value {value} exceeds uint32")))
}

pub fn response<T: SilentProto>(status: StatusCode, value: &T) -> Result<Response, WireError> {
    let bytes = value
        .encode()
        .map_err(|error| WireError::new(error.to_string()))?;
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, CONTENT_TYPE)
        .body(Body::from(bytes))
        .map_err(|error| WireError::new(error.to_string()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, SilentProto)]
pub struct Health {
    pub ok: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, SilentProto)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, SilentProto)]
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

impl Project {
    pub fn from_model(project: &model::Project) -> Result<Self, WireError> {
        Ok(Self {
            budget: project.budget,
            created_at: project.created_at.timestamp_millis(),
            id: to_u32(project.id, "id")?,
            name: project.name.clone(),
            owner: project.owner.clone(),
            status: project.status,
            tags: project.tags.clone(),
        })
    }

    pub fn into_model(self) -> Result<model::Project, WireError> {
        let created_at =
            DateTime::<Utc>::from_timestamp_millis(self.created_at).ok_or_else(|| {
                WireError::new(format!(
                    "`createdAt` value {} is outside the supported range",
                    self.created_at
                ))
            })?;
        Ok(model::Project {
            id: u64::from(self.id),
            name: self.name,
            owner: self.owner,
            status: self.status,
            tags: self.tags,
            budget: self.budget,
            created_at,
        })
    }
}

#[derive(Debug, Clone, PartialEq, SilentProto)]
pub struct ProjectInput {
    pub budget: f64,
    pub name: String,
    pub owner: String,
    #[proto(enum_type)]
    pub status: ProjectStatus,
    pub tags: Vec<String>,
}

impl ProjectInput {
    pub fn into_model(self) -> model::ProjectInput {
        model::ProjectInput {
            name: self.name,
            owner: self.owner,
            status: self.status,
            tags: self.tags,
            budget: self.budget,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProjectPatch {
    pub budget: Option<f64>,
    pub name: Option<String>,
    pub owner: Option<String>,
    pub status: Option<ProjectStatus>,
    pub tags: Option<Vec<String>>,
}

impl ProjectPatch {
    pub fn into_model(self) -> model::ProjectPatch {
        model::ProjectPatch {
            name: self.name,
            owner: self.owner,
            status: self.status,
            tags: self.tags,
            budget: self.budget,
        }
    }
}

impl SilentProto for ProjectPatch {
    fn write(&self, encoder: &mut Encoder<'_>) -> Result<(), ProtocolError> {
        let mut bitmap = 0u8;
        if self.budget.is_some() {
            bitmap |= 1;
        }
        if self.name.is_some() {
            bitmap |= 1 << 1;
        }
        if self.owner.is_some() {
            bitmap |= 1 << 2;
        }
        if self.status.is_some() {
            bitmap |= 1 << 3;
        }
        if self.tags.is_some() {
            bitmap |= 1 << 4;
        }
        encoder.write_raw(&[bitmap])?;

        if let Some(value) = self.budget {
            encoder.write_float64(value)?;
        }
        if let Some(value) = &self.name {
            encoder.write_string(value)?;
        }
        if let Some(value) = &self.owner {
            encoder.write_string(value)?;
        }
        if let Some(value) = self.status {
            encoder.write_enum(value.to_proto())?;
        }
        if let Some(values) = &self.tags {
            encoder.write_length(values.len())?;
            for value in values {
                encoder.write_string(value)?;
            }
        }
        Ok(())
    }

    fn read(decoder: &mut Decoder<'_>) -> Result<Self, ProtocolError> {
        let bitmap = decoder.read_bitmap(5)?;
        let budget = if bitmap.get(0) {
            Some(decoder.read_float64()?)
        } else {
            None
        };
        let name = if bitmap.get(1) {
            Some(decoder.read_string()?)
        } else {
            None
        };
        let owner = if bitmap.get(2) {
            Some(decoder.read_string()?)
        } else {
            None
        };
        let status = if bitmap.get(3) {
            Some(ProjectStatus::from_proto(decoder.read_enum_value()?)?)
        } else {
            None
        };
        let tags = if bitmap.get(4) {
            let count = decoder.read_length()?;
            let mut values = Vec::with_capacity(count);
            for _ in 0..count {
                values.push(decoder.read_string()?);
            }
            Some(values)
        } else {
            None
        };
        Ok(Self {
            budget,
            name,
            owner,
            status,
            tags,
        })
    }

    fn schema() -> Vec<SchemaEntry> {
        vec![
            SchemaEntry::Field(SchemaField {
                name: "budget",
                ty: SchemaType::Float64,
                optional: true,
            }),
            SchemaEntry::Field(SchemaField {
                name: "name",
                ty: SchemaType::String,
                optional: true,
            }),
            SchemaEntry::Field(SchemaField {
                name: "owner",
                ty: SchemaType::String,
                optional: true,
            }),
            SchemaEntry::Field(SchemaField {
                name: "status",
                ty: SchemaType::Enum("ProjectStatus"),
                optional: true,
            }),
            SchemaEntry::Field(SchemaField {
                name: "tags",
                ty: SchemaType::Array(Box::new(SchemaType::String)),
                optional: true,
            }),
        ]
    }
}

#[derive(Debug, Clone, PartialEq, SilentProto)]
pub struct ProjectPage {
    pub items: Vec<Project>,
    #[proto(uint32)]
    pub page: u32,
    #[proto(rename = "pageSize", uint32)]
    pub page_size: u32,
    #[proto(uint32)]
    pub total: u32,
}

impl ProjectPage {
    pub fn from_model(page: &model::ProjectPage) -> Result<Self, WireError> {
        let items = page
            .items
            .iter()
            .map(Project::from_model)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            items,
            page: to_u32(page.page, "page")?,
            page_size: to_u32(page.page_size, "pageSize")?,
            total: to_u32(page.total, "total")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectMeta {
    pub owners: Vec<String>,
    pub statuses: Vec<ProjectStatus>,
    pub tags: Vec<String>,
}

impl SilentProto for ProjectMeta {
    fn write(&self, encoder: &mut Encoder<'_>) -> Result<(), ProtocolError> {
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

    fn read(decoder: &mut Decoder<'_>) -> Result<Self, ProtocolError> {
        let owners = read_strings(decoder)?;
        let count = decoder.read_length()?;
        let mut statuses = Vec::with_capacity(count);
        for _ in 0..count {
            statuses.push(ProjectStatus::from_proto(decoder.read_enum_value()?)?);
        }
        let tags = read_strings(decoder)?;
        Ok(Self {
            owners,
            statuses,
            tags,
        })
    }

    fn schema() -> Vec<SchemaEntry> {
        vec![
            SchemaEntry::Field(SchemaField {
                name: "owners",
                ty: SchemaType::Array(Box::new(SchemaType::String)),
                optional: false,
            }),
            SchemaEntry::Field(SchemaField {
                name: "statuses",
                ty: SchemaType::Array(Box::new(SchemaType::Enum("ProjectStatus"))),
                optional: false,
            }),
            SchemaEntry::Field(SchemaField {
                name: "tags",
                ty: SchemaType::Array(Box::new(SchemaType::String)),
                optional: false,
            }),
        ]
    }
}

fn read_strings(decoder: &mut Decoder<'_>) -> Result<Vec<String>, ProtocolError> {
    let count = decoder.read_length()?;
    let mut values = Vec::with_capacity(count);
    for _ in 0..count {
        values.push(decoder.read_string()?);
    }
    Ok(values)
}

impl ProjectMeta {
    pub fn from_model(meta: &model::ProjectMeta) -> Self {
        Self {
            owners: meta.owners.clone(),
            statuses: meta.statuses.clone(),
            tags: meta.tags.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, SilentProto)]
pub struct UploadResult {
    pub id: String,
    pub mime: String,
    pub name: String,
    #[proto(uint32)]
    pub size: u32,
    pub url: String,
}

impl UploadResult {
    pub fn from_model(result: &model::UploadResult) -> Result<Self, WireError> {
        Ok(Self {
            id: result.id.clone(),
            mime: result.mime.clone(),
            name: result.name.clone(),
            size: to_u32(result.size, "size")?,
            url: result.url.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> model::Project {
        model::Project {
            id: 241,
            name: "Платформа".into(),
            owner: "Ада Ловлейс".into(),
            status: ProjectStatus::Review,
            tags: vec!["api".into(), "docs".into()],
            budget: 4242.5,
            created_at: DateTime::<Utc>::from_timestamp_millis(1_700_000_000_000).expect("date"),
        }
    }

    #[test]
    fn project_roundtrips_through_wire() {
        let source = project();
        let wire = Project::from_model(&source).expect("wire");
        let bytes = wire.encode().expect("encode");
        let decoded = Project::decode(&bytes).expect("decode");
        assert_eq!(decoded, wire);
        assert_eq!(decoded.into_model().expect("model"), source);
    }

    #[test]
    fn patch_roundtrips_partial_values() {
        let patch = ProjectPatch {
            status: Some(ProjectStatus::Done),
            tags: Some(vec!["release".into()]),
            ..ProjectPatch::default()
        };
        let bytes = patch.encode().expect("encode");
        assert_eq!(
            bytes,
            vec![
                0b0001_1000,
                2,
                1,
                7,
                b'r',
                b'e',
                b'l',
                b'e',
                b'a',
                b's',
                b'e'
            ]
        );
        assert_eq!(ProjectPatch::decode(&bytes).expect("decode"), patch);
    }

    #[test]
    fn patch_empty_is_single_zero_bitmap() {
        let bytes = ProjectPatch::default().encode().expect("encode");
        assert_eq!(bytes, vec![0]);
        assert_eq!(
            ProjectPatch::decode(&bytes).expect("decode"),
            ProjectPatch::default()
        );
    }

    #[test]
    fn patch_rejects_unknown_status() {
        let bytes = [0b0000_1000, 9];
        assert!(ProjectPatch::decode(&bytes).is_err());
    }

    #[test]
    fn id_overflow_is_reported() {
        let mut source = project();
        source.id = u64::from(u32::MAX) + 1;
        assert!(Project::from_model(&source).is_err());
    }

    #[test]
    fn decode_honours_size_limits() {
        let huge_length = [0xFF, 0xFF, 0xFF, 0xFF, 0x0F];
        assert!(UploadResult::decode_with_limits(&huge_length, Limits::new(8, 1024)).is_err());
        assert!(Project::decode_with_limits(&[], Limits::new(8, 1024)).is_err());
    }

    #[test]
    fn meta_statuses_use_enum_wire_values() {
        let meta = model::ProjectMeta {
            owners: vec!["Ада".into()],
            statuses: vec![ProjectStatus::Active, ProjectStatus::Paused],
            tags: vec!["api".into()],
        };
        let wire = ProjectMeta::from_model(&meta);
        let bytes = wire.encode().expect("encode");
        assert_eq!(
            bytes,
            b"\x01\x06\xd0\x90\xd0\xb4\xd0\xb0\x02\x00\x03\x01\x03api"
        );
        assert_eq!(ProjectMeta::decode(&bytes).expect("decode"), wire);
    }
}
