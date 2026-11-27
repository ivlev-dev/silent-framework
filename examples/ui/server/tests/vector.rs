use silent_example_ui_server::{
    model::ProjectStatus,
    wire::{ApiError, Project, ProjectInput, ProjectMeta, ProjectPage, ProjectPatch, UploadResult},
};
use silent_protocol::{Limits, SilentProto};

const PROJECT: &str = include_str!("../../protocol-vectors/project.hex");
const PROJECT_EMPTY: &str = include_str!("../../protocol-vectors/project-empty.hex");
const PROJECT_PAGE: &str = include_str!("../../protocol-vectors/project-page.hex");
const PROJECT_META: &str = include_str!("../../protocol-vectors/project-meta.hex");
const PROJECT_META_EMPTY: &str = include_str!("../../protocol-vectors/project-meta-empty.hex");
const PROJECT_INPUT: &str = include_str!("../../protocol-vectors/project-input.hex");
const PROJECT_INPUT_EMPTY: &str = include_str!("../../protocol-vectors/project-input-empty.hex");
const PROJECT_PATCH: &str = include_str!("../../protocol-vectors/project-patch.hex");
const PROJECT_PATCH_EMPTY: &str = include_str!("../../protocol-vectors/project-patch-empty.hex");
const PROJECT_PATCH_TAGS_EMPTY: &str =
    include_str!("../../protocol-vectors/project-patch-tags-empty.hex");
const API_ERROR: &str = include_str!("../../protocol-vectors/api-error.hex");
const UPLOAD_RESULT: &str = include_str!("../../protocol-vectors/upload-result.hex");

const API_LIMITS: Limits = Limits::new(32, 2 * 1024 * 1024);

fn from_hex(value: &str) -> Vec<u8> {
    let value = value.trim();
    assert!(value.len().is_multiple_of(2), "hex length must be even");
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).expect("hex"))
        .collect()
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn assert_vector<T>(hex: &str, value: &T)
where
    T: SilentProto + PartialEq + std::fmt::Debug,
{
    let expected = from_hex(hex);
    let encoded = value.encode().expect("encode");
    assert_eq!(to_hex(&encoded), hex.trim());
    assert_eq!(&T::decode(&expected).expect("decode"), value);
    assert_eq!(
        &T::decode_with_limits(&expected, API_LIMITS).expect("decode with API limits"),
        value
    );
}

fn project_full() -> Project {
    Project {
        budget: 4242.5,
        created_at: 1_700_000_000_000,
        id: 241,
        name: "Платформа".into(),
        owner: "Ада Ловлейс".into(),
        status: ProjectStatus::Review,
        tags: vec!["api".into(), "docs".into()],
    }
}

fn project_empty() -> Project {
    Project {
        budget: 0.0,
        created_at: 0,
        id: 0,
        name: String::new(),
        owner: String::new(),
        status: ProjectStatus::Active,
        tags: vec![],
    }
}

fn project_boundary() -> Project {
    Project {
        budget: 1_000_000_000_000.0,
        created_at: -86_400_000,
        id: u32::MAX,
        name: "Максимум".into(),
        owner: "Иван Лебедев".into(),
        status: ProjectStatus::Paused,
        tags: vec!["кириллица".into(), "unicode-тег".into()],
    }
}

#[test]
fn project_matches_shared_vectors() {
    assert_vector(PROJECT, &project_full());
    assert_vector(PROJECT_EMPTY, &project_empty());
}

#[test]
fn project_page_matches_shared_vector() {
    let page = ProjectPage {
        items: vec![project_full(), project_empty(), project_boundary()],
        page: 2,
        page_size: 10,
        total: 3,
    };
    assert_vector(PROJECT_PAGE, &page);

    let decoded =
        ProjectPage::decode_with_limits(&from_hex(PROJECT_PAGE), API_LIMITS).expect("decode page");
    assert_eq!(decoded.items[2].id, u32::MAX);
    assert_eq!(decoded.items[2].created_at, -86_400_000);
    assert!(decoded.items[1].tags.is_empty());
    assert_eq!(decoded.items[0].name, "Платформа");
}

#[test]
fn project_meta_matches_shared_vectors() {
    assert_vector(
        PROJECT_META,
        &ProjectMeta {
            owners: vec!["Ада Ловлейс".into(), "Иван Лебедев".into()],
            statuses: vec![
                ProjectStatus::Active,
                ProjectStatus::Review,
                ProjectStatus::Done,
                ProjectStatus::Paused,
            ],
            tags: vec!["api".into(), "кириллица".into()],
        },
    );
    assert_vector(
        PROJECT_META_EMPTY,
        &ProjectMeta {
            owners: vec![],
            statuses: vec![],
            tags: vec![],
        },
    );
}

#[test]
fn project_input_matches_shared_vectors() {
    assert_vector(
        PROJECT_INPUT,
        &ProjectInput {
            budget: 4242.5,
            name: "Платформа".into(),
            owner: "Ада Ловлейс".into(),
            status: ProjectStatus::Review,
            tags: vec!["api".into(), "docs".into()],
        },
    );
    assert_vector(
        PROJECT_INPUT_EMPTY,
        &ProjectInput {
            budget: 0.0,
            name: String::new(),
            owner: String::new(),
            status: ProjectStatus::Active,
            tags: vec![],
        },
    );
}

#[test]
fn project_patch_matches_shared_vectors() {
    assert_vector(
        PROJECT_PATCH,
        &ProjectPatch {
            status: Some(ProjectStatus::Done),
            tags: Some(vec!["release".into()]),
            ..ProjectPatch::default()
        },
    );
    assert_vector(PROJECT_PATCH_EMPTY, &ProjectPatch::default());
    assert_vector(
        PROJECT_PATCH_TAGS_EMPTY,
        &ProjectPatch {
            tags: Some(vec![]),
            ..ProjectPatch::default()
        },
    );

    let decoded = ProjectPatch::decode(&from_hex(PROJECT_PATCH_TAGS_EMPTY)).expect("decode");
    assert_eq!(decoded.tags, Some(Vec::new()));
    assert_eq!(decoded.name, None);
    assert_eq!(decoded.status, None);
}

#[test]
fn api_error_and_upload_result_match_shared_vectors() {
    assert_vector(
        API_ERROR,
        &ApiError {
            code: "invalid_query".into(),
            message: "Параметр `pageSize` должен быть от 10 до 100".into(),
        },
    );
    assert_vector(
        UPLOAD_RESULT,
        &UploadResult {
            id: "6f1a3c1e-1f9f-4f1a-9f0e-5d6b7c8d9e0f".into(),
            mime: "text/plain; charset=utf-8".into(),
            name: "заметки 2026.txt".into(),
            size: u32::MAX,
            url: "/uploads/6f1a3c1e-1f9f-4f1a-9f0e-5d6b7c8d9e0f.txt".into(),
        },
    );
}

#[test]
fn shared_vectors_respect_api_limits() {
    let page = from_hex(PROJECT_PAGE);
    assert!(ProjectPage::decode_with_limits(&page, Limits::new(32, 16)).is_err());
    assert!(ProjectPage::decode_with_limits(&page, Limits::new(1, 2 * 1024 * 1024)).is_err());
    assert!(ProjectPage::decode_with_limits(&page, Limits::new(0, 2 * 1024 * 1024)).is_err());

    let mut out = Vec::new();
    let value = ProjectPage {
        items: vec![project_full()],
        page: 1,
        page_size: 10,
        total: 1,
    };
    assert!(value
        .encode_to_with_limits(&mut out, Limits::new(32, 16))
        .is_err());

    assert!(
        ProjectPatch::decode_with_limits(&from_hex(PROJECT_PATCH), Limits::new(32, 4)).is_err()
    );
}

fn assert_rejects_truncated<T: SilentProto>(hex: &str) {
    let bytes = from_hex(hex);
    assert!(!bytes.is_empty(), "vector is empty");
    assert!(
        T::decode(&bytes[..bytes.len() - 1]).is_err(),
        "truncated {hex} must not decode"
    );

    let mut trailing = bytes;
    trailing.push(0);
    assert!(T::decode(&trailing).is_err(), "trailing bytes in {hex}");
}

#[test]
fn decoders_reject_truncated_and_trailing_bytes() {
    assert_rejects_truncated::<Project>(PROJECT);
    assert_rejects_truncated::<Project>(PROJECT_EMPTY);
    assert_rejects_truncated::<ProjectPage>(PROJECT_PAGE);
    assert_rejects_truncated::<ProjectMeta>(PROJECT_META);
    assert_rejects_truncated::<ProjectMeta>(PROJECT_META_EMPTY);
    assert_rejects_truncated::<ProjectInput>(PROJECT_INPUT);
    assert_rejects_truncated::<ProjectInput>(PROJECT_INPUT_EMPTY);
    assert_rejects_truncated::<ProjectPatch>(PROJECT_PATCH);
    assert_rejects_truncated::<ProjectPatch>(PROJECT_PATCH_EMPTY);
    assert_rejects_truncated::<ProjectPatch>(PROJECT_PATCH_TAGS_EMPTY);
    assert_rejects_truncated::<ApiError>(API_ERROR);
    assert_rejects_truncated::<UploadResult>(UPLOAD_RESULT);
}
