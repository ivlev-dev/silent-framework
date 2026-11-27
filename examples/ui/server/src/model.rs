use chrono::{DateTime, Utc};
use silent_protocol::SilentProto;
use std::fmt;

pub const MAX_NAME_LEN: usize = 200;
pub const MAX_OWNER_LEN: usize = 120;
pub const MAX_TAG_LEN: usize = 40;
pub const MAX_TAGS: usize = 32;
pub const MAX_BUDGET: f64 = 1_000_000_000_000.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    pub field: &'static str,
    pub message: String,
}

impl ValidationError {
    fn new(field: &'static str, message: impl Into<String>) -> Self {
        Self {
            field,
            message: message.into(),
        }
    }
}

impl fmt::Display for ValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.field, self.message)
    }
}

impl std::error::Error for ValidationError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, SilentProto)]
pub enum ProjectStatus {
    Active,
    Review,
    Done,
    Paused,
}

impl ProjectStatus {
    pub const ALL: [Self; 4] = [Self::Active, Self::Review, Self::Done, Self::Paused];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Review => "review",
            Self::Done => "done",
            Self::Paused => "paused",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|status| status.as_str() == value)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Project {
    pub id: u64,
    pub name: String,
    pub owner: String,
    pub status: ProjectStatus,
    pub tags: Vec<String>,
    pub budget: f64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct ProjectInput {
    pub name: String,
    pub owner: String,
    pub status: ProjectStatus,
    pub tags: Vec<String>,
    pub budget: f64,
}

impl ProjectInput {
    pub fn validate(self) -> Result<ValidatedProject, ValidationError> {
        Ok(ValidatedProject {
            name: validate_text(&self.name, "name", MAX_NAME_LEN)?,
            owner: validate_text(&self.owner, "owner", MAX_OWNER_LEN)?,
            status: self.status,
            tags: validate_tags(self.tags)?,
            budget: validate_budget(self.budget)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedProject {
    pub name: String,
    pub owner: String,
    pub status: ProjectStatus,
    pub tags: Vec<String>,
    pub budget: f64,
}

#[derive(Debug, Clone, Default)]
pub struct ProjectPatch {
    pub name: Option<String>,
    pub owner: Option<String>,
    pub status: Option<ProjectStatus>,
    pub tags: Option<Vec<String>>,
    pub budget: Option<f64>,
}

impl ProjectPatch {
    pub fn is_empty(&self) -> bool {
        self.name.is_none()
            && self.owner.is_none()
            && self.status.is_none()
            && self.tags.is_none()
            && self.budget.is_none()
    }

    pub fn apply(self, project: Project) -> Result<Project, ValidationError> {
        let input = ProjectInput {
            name: self.name.unwrap_or(project.name),
            owner: self.owner.unwrap_or(project.owner),
            status: self.status.unwrap_or(project.status),
            tags: self.tags.unwrap_or(project.tags),
            budget: self.budget.unwrap_or(project.budget),
        };
        let validated = input.validate()?;

        Ok(Project {
            id: project.id,
            name: validated.name,
            owner: validated.owner,
            status: validated.status,
            tags: validated.tags,
            budget: validated.budget,
            created_at: project.created_at,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectPage {
    pub items: Vec<Project>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectMeta {
    pub statuses: Vec<ProjectStatus>,
    pub owners: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadResult {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub mime: String,
    pub url: String,
}

fn validate_text(
    value: &str,
    field: &'static str,
    max_len: usize,
) -> Result<String, ValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ValidationError::new(field, "must not be empty"));
    }
    if trimmed.chars().count() > max_len {
        return Err(ValidationError::new(
            field,
            format!("must be at most {max_len} characters"),
        ));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(ValidationError::new(
            field,
            "must not contain control characters",
        ));
    }
    Ok(trimmed.to_owned())
}

fn validate_tags(tags: Vec<String>) -> Result<Vec<String>, ValidationError> {
    let mut result = Vec::new();
    for tag in tags {
        let tag = tag.trim();
        if tag.is_empty() {
            continue;
        }
        if tag.chars().count() > MAX_TAG_LEN {
            return Err(ValidationError::new(
                "tags",
                format!("each tag must be at most {MAX_TAG_LEN} characters"),
            ));
        }
        if tag.chars().any(char::is_control) {
            return Err(ValidationError::new(
                "tags",
                "must not contain control characters",
            ));
        }
        if !result.iter().any(|existing: &String| existing == tag) {
            result.push(tag.to_owned());
        }
    }
    if result.len() > MAX_TAGS {
        return Err(ValidationError::new(
            "tags",
            format!("must contain at most {MAX_TAGS} tags"),
        ));
    }
    Ok(result)
}

fn validate_budget(budget: f64) -> Result<f64, ValidationError> {
    if !budget.is_finite() {
        return Err(ValidationError::new("budget", "must be a finite number"));
    }
    if budget < 0.0 {
        return Err(ValidationError::new(
            "budget",
            "must be greater than or equal to 0",
        ));
    }
    if budget > MAX_BUDGET {
        return Err(ValidationError::new(
            "budget",
            format!("must be at most {MAX_BUDGET}"),
        ));
    }
    Ok(budget)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ProjectInput {
        ProjectInput {
            name: "Проект".into(),
            owner: "Ада".into(),
            status: ProjectStatus::Active,
            tags: vec!["api".into()],
            budget: 100.0,
        }
    }

    #[test]
    fn validates_and_normalizes_input() {
        let mut input = input();
        input.name = "  Проект  ".into();
        input.tags = vec![" api ".into(), "api".into(), String::new(), "ui".into()];
        let validated = input.validate().expect("valid");
        assert_eq!(validated.name, "Проект");
        assert_eq!(validated.tags, vec!["api".to_owned(), "ui".to_owned()]);
    }

    #[test]
    fn rejects_invalid_values() {
        let mut empty_name = input();
        empty_name.name = "   ".into();
        assert_eq!(empty_name.validate().unwrap_err().field, "name");

        let mut long_name = input();
        long_name.name = "x".repeat(MAX_NAME_LEN + 1);
        assert_eq!(long_name.validate().unwrap_err().field, "name");

        let mut control = input();
        control.owner = "bad\u{0}owner".into();
        assert_eq!(control.validate().unwrap_err().field, "owner");

        let mut negative = input();
        negative.budget = -1.0;
        assert_eq!(negative.validate().unwrap_err().field, "budget");

        let mut nan = input();
        nan.budget = f64::NAN;
        assert_eq!(nan.validate().unwrap_err().field, "budget");

        let mut too_many = input();
        too_many.tags = (0..=MAX_TAGS).map(|index| format!("tag-{index}")).collect();
        assert_eq!(too_many.validate().unwrap_err().field, "tags");
    }

    #[test]
    fn patch_keeps_untouched_fields() {
        let project = Project {
            id: 7,
            name: "Old".into(),
            owner: "Ada".into(),
            status: ProjectStatus::Active,
            tags: vec!["api".into()],
            budget: 10.0,
            created_at: Utc::now(),
        };
        let patch = ProjectPatch {
            name: Some("New".into()),
            ..ProjectPatch::default()
        };
        let updated = patch.apply(project.clone()).expect("patched");
        assert_eq!(updated.id, project.id);
        assert_eq!(updated.name, "New");
        assert_eq!(updated.owner, project.owner);
        assert_eq!(updated.tags, project.tags);
        assert_eq!(updated.created_at, project.created_at);
    }

    #[test]
    fn rejects_nan_patch() {
        let project = Project {
            id: 1,
            name: "Name".into(),
            owner: "Owner".into(),
            status: ProjectStatus::Done,
            tags: vec![],
            budget: 10.0,
            created_at: Utc::now(),
        };
        let patch = ProjectPatch {
            budget: Some(f64::INFINITY),
            ..ProjectPatch::default()
        };
        assert_eq!(patch.apply(project).unwrap_err().field, "budget");
    }
}
