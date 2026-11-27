use std::collections::BTreeSet;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use redb::{
    Database, ReadableDatabase, ReadableTable, ReadableTableMetadata, TableDefinition,
    WriteTransaction,
};
use silent_protocol::SilentProto;

use crate::model::{
    Project, ProjectInput, ProjectMeta, ProjectPage, ProjectPatch, ProjectStatus, ValidationError,
};
use crate::query::ProjectQuery;
use crate::wire;

const PROJECTS: TableDefinition<u64, &'static [u8]> = TableDefinition::new("projects");
const IDX_STATUS: TableDefinition<(&'static str, u64), ()> = TableDefinition::new("idx_status");
const IDX_OWNER: TableDefinition<(&'static str, u64), ()> = TableDefinition::new("idx_owner");
const IDX_NAME: TableDefinition<(&'static str, u64), ()> = TableDefinition::new("idx_name");
const IDX_CREATED: TableDefinition<(i64, u64), ()> = TableDefinition::new("idx_created");
const IDX_TAG: TableDefinition<(&'static str, u64), ()> = TableDefinition::new("idx_tag");
const DB_META: TableDefinition<&'static str, &'static [u8]> = TableDefinition::new("db_meta");

const FORMAT_KEY: &str = "format";
const FORMAT_VERSION: &str = "silent-protocol/1";
const LEGACY_SUFFIX: &str = ".legacy";

pub const SEED_PROJECT_COUNT: usize = 240;

#[derive(Debug)]
pub enum StoreError {
    Database(redb::Error),
    Io(std::io::Error),
    NotFound,
    Validation(ValidationError),
    LegacyFormat,
    Corrupted(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Database(error) => write!(formatter, "database error: {error}"),
            Self::Io(error) => write!(formatter, "io error: {error}"),
            Self::NotFound => formatter.write_str("project not found"),
            Self::Validation(error) => error.fmt(formatter),
            Self::LegacyFormat => {
                formatter.write_str("database uses an incompatible legacy format")
            }
            Self::Corrupted(message) => write!(formatter, "corrupted project record: {message}"),
        }
    }
}

impl StoreError {
    fn is_recreatable_format(&self) -> bool {
        matches!(
            self,
            Self::LegacyFormat
                | Self::Database(
                    redb::Error::TableTypeMismatch { .. }
                        | redb::Error::TableIsMultimap(_)
                        | redb::Error::TableIsNotMultimap(_)
                        | redb::Error::UpgradeRequired(_)
                        | redb::Error::Corrupted(_)
                )
        )
    }
}

impl std::error::Error for StoreError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::Io(error) => Some(error),
            Self::Validation(error) => Some(error),
            Self::NotFound | Self::LegacyFormat | Self::Corrupted(_) => None,
        }
    }
}

macro_rules! from_redb_error {
    ($($ty:ty),+ $(,)?) => {
        $(
            impl From<$ty> for StoreError {
                fn from(error: $ty) -> Self {
                    Self::Database(error.into())
                }
            }
        )+
    };
}

from_redb_error!(
    redb::DatabaseError,
    redb::TransactionError,
    redb::TableError,
    redb::CommitError,
    redb::StorageError,
);

impl From<std::io::Error> for StoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<ValidationError> for StoreError {
    fn from(error: ValidationError) -> Self {
        Self::Validation(error)
    }
}

impl From<wire::WireError> for StoreError {
    fn from(error: wire::WireError) -> Self {
        Self::Corrupted(error.to_string())
    }
}

#[derive(Clone)]
pub struct Store {
    db: Arc<Database>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FormatState {
    Current,
    Fresh,
    Unmarked,
    Legacy,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }

        for attempt in 0..2 {
            match Self::open_once(path) {
                Ok(store) => return Ok(store),
                Err(error) if attempt == 0 && error.is_recreatable_format() => {
                    tracing::warn!(
                        error = %error,
                        path = %path.display(),
                        "recreating database in the silent-protocol format"
                    );
                    archive_legacy(path)?;
                }
                Err(error) => return Err(error),
            }
        }

        Err(StoreError::Corrupted(
            "database format could not be recreated".into(),
        ))
    }

    fn open_once(path: &Path) -> Result<Self, StoreError> {
        let db = Database::create(path)?;
        let store = Self { db: Arc::new(db) };
        store.ensure_tables()?;
        match store.format_state()? {
            FormatState::Current => Ok(store),
            FormatState::Fresh | FormatState::Unmarked => {
                store.mark_current()?;
                Ok(store)
            }
            FormatState::Legacy => Err(StoreError::LegacyFormat),
        }
    }

    fn ensure_tables(&self) -> Result<(), StoreError> {
        let txn = self.db.begin_write()?;
        {
            txn.open_table(PROJECTS)?;
            txn.open_table(IDX_STATUS)?;
            txn.open_table(IDX_OWNER)?;
            txn.open_table(IDX_NAME)?;
            txn.open_table(IDX_CREATED)?;
            txn.open_table(IDX_TAG)?;
            txn.open_table(DB_META)?;
        }
        txn.commit()?;
        Ok(())
    }

    fn format_state(&self) -> Result<FormatState, StoreError> {
        let txn = self.db.begin_read()?;
        {
            let meta = txn.open_table(DB_META)?;
            if let Some(value) = meta.get(FORMAT_KEY)? {
                return Ok(if value.value() == FORMAT_VERSION.as_bytes() {
                    FormatState::Current
                } else {
                    FormatState::Legacy
                });
            }
        }
        let projects = txn.open_table(PROJECTS)?;
        if projects.is_empty()? {
            return Ok(FormatState::Fresh);
        }
        for entry in projects.iter()?.take(16) {
            let (_, value) = entry?;
            if wire::Project::decode_with_limits(value.value(), wire::LIMITS).is_err() {
                return Ok(FormatState::Legacy);
            }
        }
        Ok(FormatState::Unmarked)
    }

    fn mark_current(&self) -> Result<(), StoreError> {
        let txn = self.db.begin_write()?;
        {
            let mut meta = txn.open_table(DB_META)?;
            meta.insert(FORMAT_KEY, FORMAT_VERSION.as_bytes())?;
        }
        txn.commit()?;
        Ok(())
    }

    pub fn seed_if_empty(&self) -> Result<usize, StoreError> {
        let txn = self.db.begin_write()?;
        let existing = {
            let table = txn.open_table(PROJECTS)?;
            table.len()?
        };
        if existing > 0 {
            return Ok(0);
        }

        let projects = generate_seed_projects(Utc::now());
        {
            let mut table = txn.open_table(PROJECTS)?;
            for project in &projects {
                insert_project(&mut table, project)?;
            }
        }
        for project in &projects {
            add_indexes(&txn, project)?;
        }
        txn.commit()?;
        Ok(projects.len())
    }

    pub fn list(&self, query: &ProjectQuery) -> Result<ProjectPage, StoreError> {
        let txn = self.db.begin_read()?;
        let table = txn.open_table(PROJECTS)?;

        let mut candidates: Option<BTreeSet<u64>> = None;
        if let Some(status) = query.status {
            intersect(&mut candidates, ids_by_status(&txn, status)?);
        }
        if let Some(owner) = &query.owner {
            intersect(&mut candidates, ids_by_owner(&txn, owner)?);
        }
        if let Some(tag) = &query.tag {
            intersect(&mut candidates, ids_by_tag(&txn, tag)?);
        }
        if query.created_from.is_some() || query.created_to.is_some() {
            intersect(
                &mut candidates,
                ids_by_created(&txn, query.created_from, query.created_to)?,
            );
        }

        let mut projects = Vec::new();
        match candidates {
            Some(ids) => {
                for id in ids {
                    if let Some(project) = read_project(&table, id)? {
                        projects.push(project);
                    }
                }
            }
            None => {
                for entry in table.iter()? {
                    let (_, value) = entry?;
                    projects.push(decode_project(value.value())?);
                }
            }
        }

        Ok(query.filter_and_paginate(projects))
    }

    pub fn meta(&self) -> Result<ProjectMeta, StoreError> {
        let txn = self.db.begin_read()?;
        let table = txn.open_table(PROJECTS)?;

        let mut present_statuses = BTreeSet::new();
        let mut owners = BTreeSet::new();
        let mut tags = BTreeSet::new();

        for entry in table.iter()? {
            let (_, value) = entry?;
            let project = decode_project(value.value())?;
            present_statuses.insert(project.status);
            owners.insert(project.owner);
            for tag in project.tags {
                tags.insert(tag);
            }
        }

        let statuses = ProjectStatus::ALL
            .into_iter()
            .filter(|status| present_statuses.contains(status))
            .collect();
        let mut owners: Vec<String> = owners.into_iter().collect();
        owners.sort_by(|left, right| compare_case_insensitive(left, right));
        let mut tags: Vec<String> = tags.into_iter().collect();
        tags.sort_by(|left, right| compare_case_insensitive(left, right));

        Ok(ProjectMeta {
            statuses,
            owners,
            tags,
        })
    }

    pub fn get(&self, id: u64) -> Result<Option<Project>, StoreError> {
        let txn = self.db.begin_read()?;
        let table = txn.open_table(PROJECTS)?;
        read_project(&table, id)
    }

    pub fn create(&self, input: ProjectInput) -> Result<Project, StoreError> {
        let validated = input.validate()?;
        let txn = self.db.begin_write()?;
        let project = {
            let mut table = txn.open_table(PROJECTS)?;
            let last_id = table.last()?.map(|(key, _)| key.value()).unwrap_or(0);
            let id = last_id
                .checked_add(1)
                .ok_or_else(|| StoreError::Corrupted("project id space exhausted".into()))?;
            if table.get(id)?.is_some() {
                return Err(StoreError::Corrupted(format!(
                    "project id {id} already exists"
                )));
            }
            let project = Project {
                id,
                name: validated.name,
                owner: validated.owner,
                status: validated.status,
                tags: validated.tags,
                budget: validated.budget,
                created_at: Utc::now(),
            };
            insert_project(&mut table, &project)?;
            project
        };
        add_indexes(&txn, &project)?;
        txn.commit()?;
        Ok(project)
    }

    pub fn update(&self, id: u64, patch: ProjectPatch) -> Result<Project, StoreError> {
        let txn = self.db.begin_write()?;
        let (previous, current) = {
            let mut table = txn.open_table(PROJECTS)?;
            let previous = read_project(&table, id)?.ok_or(StoreError::NotFound)?;
            let current = patch.apply(previous.clone())?;
            insert_project(&mut table, &current)?;
            (previous, current)
        };
        if previous != current {
            remove_indexes(&txn, &previous)?;
            add_indexes(&txn, &current)?;
        }
        txn.commit()?;
        Ok(current)
    }

    pub fn delete(&self, id: u64) -> Result<(), StoreError> {
        let txn = self.db.begin_write()?;
        let project = {
            let mut table = txn.open_table(PROJECTS)?;
            let project = read_project(&table, id)?.ok_or(StoreError::NotFound)?;
            table.remove(id)?;
            project
        };
        remove_indexes(&txn, &project)?;
        txn.commit()?;
        Ok(())
    }
}

fn archive_legacy(path: &Path) -> Result<(), StoreError> {
    let mut name = path.as_os_str().to_owned();
    name.push(LEGACY_SUFFIX);
    let backup = PathBuf::from(name);
    if backup.exists() {
        std::fs::remove_file(&backup)?;
    }
    std::fs::rename(path, &backup)?;
    Ok(())
}

fn insert_project(
    table: &mut redb::Table<'_, u64, &'static [u8]>,
    project: &Project,
) -> Result<(), StoreError> {
    let bytes = wire::Project::from_model(project)?
        .encode()
        .map_err(|error| StoreError::Corrupted(error.to_string()))?;
    table.insert(project.id, bytes.as_slice())?;
    Ok(())
}

fn read_project<T>(table: &T, id: u64) -> Result<Option<Project>, StoreError>
where
    T: ReadableTable<u64, &'static [u8]>,
{
    match table.get(id)? {
        Some(value) => Ok(Some(decode_project(value.value())?)),
        None => Ok(None),
    }
}

fn decode_project(bytes: &[u8]) -> Result<Project, StoreError> {
    let project = wire::Project::decode_with_limits(bytes, wire::LIMITS)
        .map_err(|error| StoreError::Corrupted(error.to_string()))?;
    Ok(project.into_model()?)
}

fn add_indexes(txn: &WriteTransaction, project: &Project) -> Result<(), StoreError> {
    {
        let mut table = txn.open_table(IDX_STATUS)?;
        table.insert((project.status.as_str(), project.id), ())?;
    }
    {
        let mut table = txn.open_table(IDX_OWNER)?;
        table.insert((project.owner.as_str(), project.id), ())?;
    }
    {
        let mut table = txn.open_table(IDX_NAME)?;
        table.insert((project.name.as_str(), project.id), ())?;
    }
    {
        let mut table = txn.open_table(IDX_CREATED)?;
        table.insert((project.created_at.timestamp_millis(), project.id), ())?;
    }
    {
        let mut table = txn.open_table(IDX_TAG)?;
        for tag in &project.tags {
            table.insert((tag.as_str(), project.id), ())?;
        }
    }
    Ok(())
}

fn remove_indexes(txn: &WriteTransaction, project: &Project) -> Result<(), StoreError> {
    {
        let mut table = txn.open_table(IDX_STATUS)?;
        table.remove((project.status.as_str(), project.id))?;
    }
    {
        let mut table = txn.open_table(IDX_OWNER)?;
        table.remove((project.owner.as_str(), project.id))?;
    }
    {
        let mut table = txn.open_table(IDX_NAME)?;
        table.remove((project.name.as_str(), project.id))?;
    }
    {
        let mut table = txn.open_table(IDX_CREATED)?;
        table.remove((project.created_at.timestamp_millis(), project.id))?;
    }
    {
        let mut table = txn.open_table(IDX_TAG)?;
        for tag in &project.tags {
            table.remove((tag.as_str(), project.id))?;
        }
    }
    Ok(())
}

fn ids_by_status(
    txn: &redb::ReadTransaction,
    status: ProjectStatus,
) -> Result<BTreeSet<u64>, StoreError> {
    let table = txn.open_table(IDX_STATUS)?;
    let mut ids = BTreeSet::new();
    for entry in table.range((status.as_str(), 0u64)..=(status.as_str(), u64::MAX))? {
        let (key, _) = entry?;
        ids.insert(key.value().1);
    }
    Ok(ids)
}

fn ids_by_owner(txn: &redb::ReadTransaction, owner: &str) -> Result<BTreeSet<u64>, StoreError> {
    let table = txn.open_table(IDX_OWNER)?;
    let mut ids = BTreeSet::new();
    for entry in table.range((owner, 0u64)..=(owner, u64::MAX))? {
        let (key, _) = entry?;
        ids.insert(key.value().1);
    }
    Ok(ids)
}

fn ids_by_tag(txn: &redb::ReadTransaction, tag: &str) -> Result<BTreeSet<u64>, StoreError> {
    let table = txn.open_table(IDX_TAG)?;
    let mut ids = BTreeSet::new();
    for entry in table.range((tag, 0u64)..=(tag, u64::MAX))? {
        let (key, _) = entry?;
        ids.insert(key.value().1);
    }
    Ok(ids)
}

fn ids_by_created(
    txn: &redb::ReadTransaction,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
) -> Result<BTreeSet<u64>, StoreError> {
    let table = txn.open_table(IDX_CREATED)?;
    let start = from.map_or(i64::MIN, |value| value.timestamp_millis());
    let end = to.map_or(i64::MAX, |value| value.timestamp_millis());
    let mut ids = BTreeSet::new();
    for entry in table.range((start, 0u64)..=(end, u64::MAX))? {
        let (key, _) = entry?;
        ids.insert(key.value().1);
    }
    Ok(ids)
}

fn intersect(candidates: &mut Option<BTreeSet<u64>>, ids: BTreeSet<u64>) {
    match candidates {
        Some(current) => current.retain(|id| ids.contains(id)),
        None => *candidates = Some(ids),
    }
}

fn compare_case_insensitive(left: &str, right: &str) -> std::cmp::Ordering {
    left.to_lowercase()
        .cmp(&right.to_lowercase())
        .then_with(|| left.cmp(right))
}

const SEED_PREFIXES: [&str; 16] = [
    "Северный",
    "Тихий",
    "Быстрый",
    "Ясный",
    "Глубокий",
    "Лёгкий",
    "Смелый",
    "Точный",
    "Гибкий",
    "Открытый",
    "Ранний",
    "Зимний",
    "Летний",
    "Ночной",
    "Дальний",
    "Вольный",
];

const SEED_NOUNS: [&str; 15] = [
    "Атлас",
    "Компас",
    "Пульс",
    "Контур",
    "Фокус",
    "Вектор",
    "Кристалл",
    "Маяк",
    "Поток",
    "Каркас",
    "Орбита",
    "Сигнал",
    "Мост",
    "Ключ",
    "Ритм",
];

const SEED_OWNERS: [&str; 8] = [
    "Ада Ловлейс",
    "Грейс Хоппер",
    "Алан Тьюринг",
    "Иван Лебедев",
    "Кэтрин Джонсон",
    "Маргарет Гамильтон",
    "Линус Торвальдс",
    "Барбара Лисков",
];

const SEED_TAGS: [&str; 12] = [
    "frontend",
    "backend",
    "design",
    "infra",
    "research",
    "mobile",
    "api",
    "docs",
    "security",
    "performance",
    "ui",
    "data",
];

pub fn generate_seed_projects(now: DateTime<Utc>) -> Vec<Project> {
    let mut projects = Vec::with_capacity(SEED_PROJECT_COUNT);
    let mut id = 1u64;

    for prefix in SEED_PREFIXES {
        for noun in SEED_NOUNS {
            let index = (id - 1) as usize;
            let tag_count = 1 + index % 3;
            let mut tags = Vec::with_capacity(tag_count);
            for position in 0..tag_count {
                let tag = SEED_TAGS[(index * 5 + position * 3) % SEED_TAGS.len()];
                if !tags.iter().any(|existing: &String| existing == tag) {
                    tags.push(tag.to_owned());
                }
            }
            let raw_budget = 5_000.0 + (index as f64 * 1_237.0) % 95_000.0;
            let budget = (raw_budget * 100.0).round() / 100.0;
            let created_at = now
                - Duration::hours((index as i64 * 37) % 8_760)
                - Duration::minutes((index as i64 * 13) % 60);

            projects.push(Project {
                id,
                name: format!("{prefix} {noun}"),
                owner: SEED_OWNERS[index % SEED_OWNERS.len()].to_owned(),
                status: ProjectStatus::ALL[index % ProjectStatus::ALL.len()],
                tags,
                budget,
                created_at,
            });
            id += 1;
        }
    }

    projects
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ProjectInput;
    use crate::query::ProjectQuery;
    use std::collections::HashMap;
    use tempfile::TempDir;

    fn query(pairs: &[(&str, &str)]) -> ProjectQuery {
        ProjectQuery::parse(
            &pairs
                .iter()
                .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                .collect::<HashMap<_, _>>(),
        )
        .expect("query")
    }

    fn open_store() -> (TempDir, Store) {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = Store::open(dir.path().join("projects.redb")).expect("store");
        (dir, store)
    }

    #[test]
    fn seeds_once_with_deterministic_content() {
        let (_dir, store) = open_store();
        assert_eq!(store.seed_if_empty().expect("seed"), SEED_PROJECT_COUNT);
        assert_eq!(store.seed_if_empty().expect("seed again"), 0);

        let meta = store.meta().expect("meta");
        assert_eq!(meta.statuses.len(), 4);
        assert_eq!(meta.owners.len(), 8);
        assert_eq!(meta.tags.len(), 12);

        let page = store.list(&query(&[])).expect("list");
        assert_eq!(page.total, SEED_PROJECT_COUNT as u64);
        assert_eq!(page.page, 1);
        assert_eq!(page.page_size, 20);
        assert_eq!(page.items.len(), 20);

        let active = store.list(&query(&[("status", "active")])).expect("active");
        assert_eq!(active.total, 60);
        let owners = store
            .list(&query(&[("owner", "Ада Ловлейс")]))
            .expect("owner");
        assert_eq!(owners.total, 30);

        let mut names = BTreeSet::new();
        for item in store
            .list(&query(&[("pageSize", "100")]))
            .expect("first page")
            .items
        {
            names.insert(item.name);
        }
        assert_eq!(names.len(), 100);
    }

    #[test]
    fn crud_keeps_indexes_in_sync() {
        let (_dir, store) = open_store();
        store.seed_if_empty().expect("seed");

        let created = store
            .create(ProjectInput {
                name: "Новый проект".into(),
                owner: "Тестовый Владелец".into(),
                status: ProjectStatus::Review,
                tags: vec!["qa".into()],
                budget: 123.45,
            })
            .expect("create");
        assert_eq!(created.id, 241);

        let by_owner = store
            .list(&query(&[("owner", "Тестовый Владелец")]))
            .expect("owner");
        assert_eq!(by_owner.total, 1);
        assert_eq!(by_owner.items[0].id, 241);

        let patched = store
            .update(
                241,
                ProjectPatch {
                    owner: Some("Другой Владелец".into()),
                    status: Some(ProjectStatus::Done),
                    tags: Some(vec!["qa".into(), "release".into()]),
                    ..ProjectPatch::default()
                },
            )
            .expect("update");
        assert_eq!(patched.name, "Новый проект");
        assert_eq!(patched.status, ProjectStatus::Done);
        assert_eq!(patched.budget, 123.45);

        assert_eq!(
            store
                .list(&query(&[("owner", "Тестовый Владелец")]))
                .expect("old owner")
                .total,
            0
        );
        assert_eq!(
            store
                .list(&query(&[("owner", "Другой Владелец")]))
                .expect("new owner")
                .total,
            1
        );
        assert_eq!(
            store
                .list(&query(&[("tag", "release")]))
                .expect("new tag")
                .total,
            1
        );

        store.delete(241).expect("delete");
        assert!(store.get(241).expect("get").is_none());
        assert!(matches!(store.delete(241), Err(StoreError::NotFound)));
        assert_eq!(
            store.list(&query(&[])).expect("list").total,
            SEED_PROJECT_COUNT as u64
        );
    }

    #[test]
    fn filters_by_created_range_using_index() {
        let (_dir, store) = open_store();
        store.seed_if_empty().expect("seed");
        let now = Utc::now();

        let all = store
            .list(&query(&[("createdTo", &now.to_rfc3339())]))
            .expect("all");
        assert_eq!(all.total, SEED_PROJECT_COUNT as u64);

        let future = store
            .list(&query(&[(
                "createdFrom",
                &(now + Duration::days(1)).to_rfc3339(),
            )]))
            .expect("future");
        assert_eq!(future.total, 0);
    }

    #[test]
    fn persists_across_reopen() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("projects.redb");
        {
            let store = Store::open(&path).expect("store");
            store.seed_if_empty().expect("seed");
            store.delete(1).expect("delete");
        }
        let store = Store::open(&path).expect("reopen");
        assert!(store.get(1).expect("get").is_none());
        assert_eq!(store.list(&query(&[])).expect("list").total, 239);
    }

    #[test]
    fn rejects_invalid_input_on_create() {
        let (_dir, store) = open_store();
        let error = store
            .create(ProjectInput {
                name: "  ".into(),
                owner: "Owner".into(),
                status: ProjectStatus::Active,
                tags: vec![],
                budget: 1.0,
            })
            .unwrap_err();
        assert!(matches!(error, StoreError::Validation(_)));
    }

    #[test]
    fn stores_values_in_silent_protocol_format() {
        let (_dir, store) = open_store();
        store.seed_if_empty().expect("seed");

        let txn = store.db.begin_read().expect("read");
        let table = txn.open_table(PROJECTS).expect("projects");
        let value = table.get(1u64).expect("get").expect("record");
        let bytes = value.value();
        assert!(!bytes.starts_with(b"{"), "JSON must not be stored");
        let decoded = wire::Project::decode_with_limits(bytes, wire::LIMITS).expect("protocol");
        assert_eq!(decoded.id, 1);
        assert_eq!(decoded.name, "Северный Атлас");
    }

    #[test]
    fn corrupted_record_is_reported() {
        let (_dir, store) = open_store();
        let txn = store.db.begin_write().expect("write");
        {
            let mut table = txn.open_table(PROJECTS).expect("table");
            let bytes = [0xFFu8, 0xFF, 0xFF];
            table.insert(1u64, bytes.as_slice()).expect("insert");
        }
        txn.commit().expect("commit");
        assert!(matches!(store.get(1), Err(StoreError::Corrupted(_))));
    }

    #[test]
    fn recreates_legacy_json_database() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("projects.redb");
        {
            let db = Database::create(&path).expect("legacy db");
            let txn = db.begin_write().expect("write");
            {
                let mut table = txn.open_table(PROJECTS).expect("projects");
                table
                    .insert(1u64, br#"{"id":1,"name":"legacy project"}"#.as_slice())
                    .expect("insert");
            }
            txn.commit().expect("commit");
        }

        let store = Store::open(&path).expect("recreated store");
        assert_eq!(store.seed_if_empty().expect("seed"), SEED_PROJECT_COUNT);
        assert_eq!(
            store.list(&query(&[])).expect("list").total,
            SEED_PROJECT_COUNT as u64
        );

        let backup = dir.path().join("projects.redb.legacy");
        assert!(backup.is_file());
        assert!(!std::fs::read(&backup).expect("backup").is_empty());
    }

    #[test]
    fn recreates_incompatible_table_types() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("projects.redb");
        {
            let db = Database::create(&path).expect("legacy db");
            let txn = db.begin_write().expect("write");
            {
                let legacy = TableDefinition::<u64, &'static str>::new("projects");
                let mut table = txn.open_table(legacy).expect("projects");
                table.insert(1u64, "legacy").expect("insert");
            }
            txn.commit().expect("commit");
        }

        let store = Store::open(&path).expect("recreated store");
        assert_eq!(store.seed_if_empty().expect("seed"), SEED_PROJECT_COUNT);
        assert!(dir.path().join("projects.redb.legacy").is_file());
    }

    #[test]
    fn recreates_database_with_unknown_format_marker() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("projects.redb");
        {
            let store = Store::open(&path).expect("store");
            store.seed_if_empty().expect("seed");
        }
        {
            let db = Database::create(&path).expect("db");
            let txn = db.begin_write().expect("write");
            {
                let mut meta = txn.open_table(DB_META).expect("meta");
                meta.insert(FORMAT_KEY, b"silent-protocol/0".as_slice())
                    .expect("marker");
            }
            txn.commit().expect("commit");
        }

        let store = Store::open(&path).expect("recreated store");
        assert_eq!(store.list(&query(&[])).expect("list").total, 0);
        assert!(dir.path().join("projects.redb.legacy").is_file());
    }

    #[test]
    fn adopts_unmarked_protocol_database_without_reseeding() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("projects.redb");
        {
            let store = Store::open(&path).expect("store");
            store.seed_if_empty().expect("seed");
        }
        {
            let db = Database::create(&path).expect("db");
            let txn = db.begin_write().expect("write");
            {
                let mut meta = txn.open_table(DB_META).expect("meta");
                meta.remove(FORMAT_KEY).expect("remove marker");
            }
            txn.commit().expect("commit");
        }

        let store = Store::open(&path).expect("reopen");
        assert_eq!(
            store.list(&query(&[])).expect("list").total,
            SEED_PROJECT_COUNT as u64
        );
        assert!(!dir.path().join("projects.redb.legacy").exists());
    }

    #[test]
    fn reopens_current_database_without_archiving() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("projects.redb");
        {
            let store = Store::open(&path).expect("store");
            store.seed_if_empty().expect("seed");
            store.delete(1).expect("delete");
        }
        let store = Store::open(&path).expect("reopen");
        assert!(store.get(1).expect("get").is_none());
        assert!(!dir.path().join("projects.redb.legacy").exists());
    }

    #[test]
    fn concurrent_creates_keep_ids_unique_and_indexes_consistent() {
        const WORKERS: usize = 8;
        const PER_WORKER: usize = 10;

        let (_dir, store) = open_store();
        store.seed_if_empty().expect("seed");

        let mut handles = Vec::with_capacity(WORKERS);
        for worker in 0..WORKERS {
            let store = store.clone();
            handles.push(std::thread::spawn(move || {
                (0..PER_WORKER)
                    .map(|index| {
                        store
                            .create(ProjectInput {
                                name: format!("Параллельный {worker}-{index}"),
                                owner: "Параллельный".into(),
                                status: ProjectStatus::Active,
                                tags: vec![format!("worker-{worker}")],
                                budget: index as f64,
                            })
                            .expect("create")
                            .id
                    })
                    .collect::<Vec<u64>>()
            }));
        }

        let mut ids = BTreeSet::new();
        for handle in handles {
            for id in handle.join().expect("worker") {
                assert!(ids.insert(id), "duplicate id {id}");
            }
        }
        assert_eq!(ids.len(), WORKERS * PER_WORKER);
        assert_eq!(
            store.list(&query(&[])).expect("list").total,
            (SEED_PROJECT_COUNT + WORKERS * PER_WORKER) as u64
        );
        assert_eq!(
            store
                .list(&query(&[("owner", "Параллельный")]))
                .expect("owner")
                .total,
            (WORKERS * PER_WORKER) as u64
        );
        assert_eq!(
            store
                .list(&query(&[("tag", "worker-3")]))
                .expect("tag")
                .total,
            PER_WORKER as u64
        );
        for id in ids {
            assert!(store.get(id).expect("get").is_some());
        }
    }

    #[test]
    fn failed_update_rolls_back_without_changing_the_record() {
        let (_dir, store) = open_store();
        store.seed_if_empty().expect("seed");
        let before = store.get(1).expect("get").expect("project");

        let error = store
            .update(
                1,
                ProjectPatch {
                    budget: Some(-1.0),
                    ..ProjectPatch::default()
                },
            )
            .unwrap_err();
        assert!(matches!(error, StoreError::Validation(_)));
        assert_eq!(store.get(1).expect("get").expect("project"), before);
        assert_eq!(
            store.list(&query(&[])).expect("list").total,
            SEED_PROJECT_COUNT as u64
        );
    }

    #[test]
    fn seed_projects_are_unique_and_cover_last_year() {
        let now = Utc::now();
        let projects = generate_seed_projects(now);
        assert_eq!(projects.len(), SEED_PROJECT_COUNT);

        let names: BTreeSet<_> = projects
            .iter()
            .map(|project| project.name.clone())
            .collect();
        assert_eq!(names.len(), SEED_PROJECT_COUNT);

        let ids: BTreeSet<_> = projects.iter().map(|project| project.id).collect();
        assert_eq!(ids.len(), SEED_PROJECT_COUNT);
        assert_eq!(ids.first(), Some(&1));
        assert_eq!(ids.last(), Some(&(SEED_PROJECT_COUNT as u64)));

        let oldest = projects
            .iter()
            .map(|project| project.created_at)
            .min()
            .expect("oldest");
        assert!(oldest >= now - Duration::days(366));
        assert!(projects.iter().all(|project| project.created_at <= now));
    }
}
