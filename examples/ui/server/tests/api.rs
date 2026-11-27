use std::time::Duration;

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    Router,
};
use chrono::Utc;
use silent_example_ui_server::{
    build_router,
    model::ProjectStatus,
    store::Store,
    uploads::MAX_UPLOAD_BYTES,
    wire::{
        self, ApiError as WireApiError, Project, ProjectInput, ProjectMeta, ProjectPage,
        ProjectPatch, UploadResult,
    },
    AppState,
};
use silent_protocol::SilentProto;
use tempfile::TempDir;
use tower::ServiceExt;

struct TestApp {
    router: Router,
    uploads: std::path::PathBuf,
    _dir: TempDir,
}

struct TestResponse {
    status: StatusCode,
    content_type: Option<String>,
    bytes: Vec<u8>,
}

impl TestResponse {
    fn decode<T: SilentProto>(&self) -> T {
        assert_eq!(
            self.content_type.as_deref(),
            Some(wire::CONTENT_TYPE),
            "unexpected content type for {}",
            self.status
        );
        T::decode(&self.bytes).expect("protocol body")
    }

    fn error(&self) -> WireApiError {
        self.decode()
    }
}

impl TestApp {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = Store::open(dir.path().join("projects.redb")).expect("store");
        store.seed_if_empty().expect("seed");
        let uploads = dir.path().join("uploads");
        std::fs::create_dir_all(&uploads).expect("uploads dir");
        let router = build_router(AppState {
            store,
            delay: Duration::ZERO,
            uploads_dir: uploads.clone(),
        });
        Self {
            router,
            uploads,
            _dir: dir,
        }
    }

    async fn call(&self, request: Request<Body>) -> TestResponse {
        let response = self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("response");
        let status = response.status();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body")
            .to_vec();
        if !bytes.is_empty() {
            assert_eq!(
                content_type.as_deref(),
                Some(wire::CONTENT_TYPE),
                "binary protocol content type expected"
            );
        }
        TestResponse {
            status,
            content_type,
            bytes,
        }
    }

    async fn get(&self, uri: &str) -> TestResponse {
        self.call(Request::get(uri).body(Body::empty()).expect("request"))
            .await
    }

    async fn send<T: SilentProto>(&self, method: &str, uri: &str, body: &T) -> TestResponse {
        let bytes = body.encode().expect("encode request");
        self.send_raw(method, uri, Some(wire::CONTENT_TYPE), bytes)
            .await
    }

    async fn send_raw(
        &self,
        method: &str,
        uri: &str,
        content_type: Option<&str>,
        bytes: Vec<u8>,
    ) -> TestResponse {
        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(content_type) = content_type {
            builder = builder.header(header::CONTENT_TYPE, content_type);
        }
        self.call(builder.body(Body::from(bytes)).expect("request"))
            .await
    }

    async fn delete(&self, uri: &str) -> TestResponse {
        self.call(
            Request::builder()
                .method("DELETE")
                .uri(uri)
                .body(Body::empty())
                .expect("request"),
        )
        .await
    }
}

fn encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[tokio::test]
async fn health_reports_ok() {
    let app = TestApp::new();
    let response = app.get("/api/health").await;
    assert_eq!(response.status, StatusCode::OK);
    assert!(response.decode::<wire::Health>().ok);
}

#[tokio::test]
async fn meta_contains_seeded_values() {
    let app = TestApp::new();
    let response = app.get("/api/meta").await;
    assert_eq!(response.status, StatusCode::OK);
    let meta: ProjectMeta = response.decode();
    assert_eq!(
        meta.statuses,
        vec![
            ProjectStatus::Active,
            ProjectStatus::Review,
            ProjectStatus::Done,
            ProjectStatus::Paused
        ]
    );
    assert_eq!(meta.owners.len(), 8);
    assert_eq!(meta.tags.len(), 12);
    assert!(meta.owners.iter().any(|owner| owner == "Ада Ловлейс"));
    assert!(meta.tags.iter().any(|tag| tag == "frontend"));
}

#[tokio::test]
async fn list_supports_pagination_filtering_and_sorting() {
    let app = TestApp::new();

    let response = app.get("/api/projects").await;
    assert_eq!(response.status, StatusCode::OK);
    let page: ProjectPage = response.decode();
    assert_eq!(page.total, 240);
    assert_eq!(page.page, 1);
    assert_eq!(page.page_size, 20);
    assert_eq!(page.items.len(), 20);

    let page: ProjectPage = app.get("/api/projects?page=2&pageSize=10").await.decode();
    assert_eq!(page.total, 240);
    assert_eq!(page.page, 2);
    assert_eq!(page.items.len(), 10);

    let page: ProjectPage = app
        .get("/api/projects?status=active&pageSize=100")
        .await
        .decode();
    assert_eq!(page.total, 60);
    assert!(page
        .items
        .iter()
        .all(|item| item.status == ProjectStatus::Active));

    let page: ProjectPage = app
        .get(&format!("/api/projects?owner={}", encode("Ада Ловлейс")))
        .await
        .decode();
    assert_eq!(page.total, 30);

    let page: ProjectPage = app
        .get(&format!("/api/projects?q={}", encode("сЕвЕрНыЙ")))
        .await
        .decode();
    assert_eq!(page.total, 15);

    let page: ProjectPage = app
        .get("/api/projects?budgetMin=10000&budgetMax=20000&pageSize=100")
        .await
        .decode();
    assert!(!page.items.is_empty());
    assert!(page
        .items
        .iter()
        .all(|item| (10_000.0..=20_000.0).contains(&item.budget)));

    let page: ProjectPage = app
        .get(&format!(
            "/api/projects?createdTo={}&pageSize=100",
            encode(&Utc::now().to_rfc3339())
        ))
        .await
        .decode();
    assert_eq!(page.total, 240);

    let page: ProjectPage = app
        .get(&format!(
            "/api/projects?createdFrom={}",
            encode(&(Utc::now() + chrono::Duration::days(1)).to_rfc3339())
        ))
        .await
        .decode();
    assert_eq!(page.total, 0);

    let page: ProjectPage = app
        .get("/api/projects?sort=budget&order=asc&pageSize=100")
        .await
        .decode();
    let budgets: Vec<f64> = page.items.iter().map(|item| item.budget).collect();
    assert!(budgets.windows(2).all(|pair| pair[0] <= pair[1]));

    let page: ProjectPage = app
        .get("/api/projects?sort=createdAt&order=desc&pageSize=100")
        .await
        .decode();
    let dates: Vec<i64> = page.items.iter().map(|item| item.created_at).collect();
    assert!(dates.windows(2).all(|pair| pair[0] >= pair[1]));
}

#[tokio::test]
async fn invalid_query_returns_structured_error() {
    let app = TestApp::new();
    for uri in [
        "/api/projects?page=0",
        "/api/projects?page=abc",
        "/api/projects?pageSize=9",
        "/api/projects?pageSize=101",
        "/api/projects?sort=id",
        "/api/projects?order=up",
        "/api/projects?status=archived",
        "/api/projects?budgetMin=-1",
        "/api/projects?budgetMin=100&budgetMax=10",
        "/api/projects?createdFrom=not-a-date",
        "/api/projects?createdFrom=2025-02-01&createdTo=2025-01-01",
    ] {
        let response = app.get(uri).await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST, "{uri}");
        let error = response.error();
        assert_eq!(error.code, "invalid_query", "{uri}");
        assert!(!error.message.is_empty(), "{uri}");
    }
}

#[tokio::test]
async fn crud_flow_works_end_to_end() {
    let app = TestApp::new();

    let created = ProjectInput {
        name: "  Платформа  ".into(),
        owner: "Тестовый Владелец".into(),
        status: ProjectStatus::Review,
        tags: vec!["api".into(), "api".into(), "docs".into()],
        budget: 4242.5,
    };
    let response = app.send("POST", "/api/projects", &created).await;
    assert_eq!(response.status, StatusCode::CREATED);
    let project: Project = response.decode();
    assert_eq!(project.id, 241);
    assert_eq!(project.name, "Платформа");
    assert_eq!(project.tags, vec!["api".to_owned(), "docs".to_owned()]);
    assert_eq!(project.budget, 4242.5);
    assert_eq!(project.status, ProjectStatus::Review);
    assert!(project.created_at > 0);

    let meta: ProjectMeta = app.get("/api/meta").await.decode();
    assert!(meta.owners.iter().any(|owner| owner == "Тестовый Владелец"));

    let patch = ProjectPatch {
        name: Some("Обновлённая платформа".into()),
        status: Some(ProjectStatus::Done),
        ..ProjectPatch::default()
    };
    let response = app.send("PATCH", "/api/projects/241", &patch).await;
    assert_eq!(response.status, StatusCode::OK);
    let project: Project = response.decode();
    assert_eq!(project.name, "Обновлённая платформа");
    assert_eq!(project.status, ProjectStatus::Done);
    assert_eq!(project.owner, "Тестовый Владелец");
    assert_eq!(project.budget, 4242.5);

    let page: ProjectPage = app
        .get(&format!("/api/projects?q={}", encode("Обновлённая")))
        .await
        .decode();
    assert_eq!(page.total, 1);

    let response = app.delete("/api/projects/241").await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert!(response.bytes.is_empty());

    let response = app.delete("/api/projects/241").await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    assert_eq!(response.error().code, "not_found");

    let response = app
        .send(
            "PATCH",
            "/api/projects/241",
            &ProjectPatch {
                name: Some("x".into()),
                ..ProjectPatch::default()
            },
        )
        .await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    assert_eq!(response.error().code, "not_found");
}

#[tokio::test]
async fn create_rejects_invalid_project_values() {
    let app = TestApp::new();
    let response = app
        .send(
            "POST",
            "/api/projects",
            &ProjectInput {
                name: "Проект".into(),
                owner: "Владелец".into(),
                status: ProjectStatus::Active,
                tags: vec![],
                budget: -1.0,
            },
        )
        .await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.error().code, "invalid_input");

    let response = app
        .send(
            "POST",
            "/api/projects",
            &ProjectInput {
                name: "  ".into(),
                owner: "Владелец".into(),
                status: ProjectStatus::Active,
                tags: vec![],
                budget: 1.0,
            },
        )
        .await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.error().code, "invalid_input");
}

#[tokio::test]
async fn rejects_wrong_content_type() {
    let app = TestApp::new();
    let payload = ProjectInput {
        name: "Проект".into(),
        owner: "Владелец".into(),
        status: ProjectStatus::Active,
        tags: vec![],
        budget: 1.0,
    }
    .encode()
    .expect("encode");

    let response = app
        .send_raw("POST", "/api/projects", Some("application/json"), payload)
        .await;
    assert_eq!(response.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_eq!(response.error().code, "invalid_content_type");

    let response = app
        .send_raw("POST", "/api/projects", None, Vec::new())
        .await;
    assert_eq!(response.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_eq!(response.error().code, "invalid_content_type");

    let response = app
        .send_raw(
            "POST",
            "/api/projects",
            Some(&format!("{}; charset=binary", wire::CONTENT_TYPE)),
            ProjectInput {
                name: "Проект".into(),
                owner: "Владелец".into(),
                status: ProjectStatus::Active,
                tags: vec![],
                budget: 1.0,
            }
            .encode()
            .expect("encode"),
        )
        .await;
    assert_eq!(response.status, StatusCode::CREATED);
}

#[tokio::test]
async fn rejects_empty_and_malformed_payloads() {
    let app = TestApp::new();

    let response = app
        .send_raw(
            "POST",
            "/api/projects",
            Some(wire::CONTENT_TYPE),
            Vec::new(),
        )
        .await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.error().code, "empty_body");

    let response = app
        .send_raw(
            "POST",
            "/api/projects",
            Some(wire::CONTENT_TYPE),
            vec![0xFF, 0xFF],
        )
        .await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.error().code, "invalid_payload");

    let response = app
        .send_raw(
            "PATCH",
            "/api/projects/241",
            Some(wire::CONTENT_TYPE),
            vec![0b0000_1000, 9],
        )
        .await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.error().code, "invalid_payload");
}

#[tokio::test]
async fn unknown_route_returns_not_found() {
    let app = TestApp::new();
    let response = app.get("/api/unknown").await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    assert_eq!(response.error().code, "not_found");
}

#[tokio::test]
async fn cors_allows_ui_origin() {
    let app = TestApp::new();
    let response = app
        .call(
            Request::builder()
                .method("OPTIONS")
                .uri("/api/projects")
                .header(header::ORIGIN, "http://localhost:6107")
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
                .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert!(response.status.is_success());

    let response = app
        .router
        .clone()
        .oneshot(
            Request::get("/api/health")
                .header(header::ORIGIN, "http://127.0.0.1:6107")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .expect("cors header"),
        "http://127.0.0.1:6107"
    );
}

#[tokio::test]
async fn health_has_protocol_content_type_and_one_byte_body() {
    let app = TestApp::new();
    let response = app.get("/api/health").await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.content_type.as_deref(), Some(wire::CONTENT_TYPE));
    assert_eq!(response.bytes, vec![1u8]);
}

#[tokio::test]
async fn project_responses_use_protocol_bodies() {
    let app = TestApp::new();
    let page = app.get("/api/projects?pageSize=10").await;
    assert_eq!(page.status, StatusCode::OK);
    assert_eq!(page.content_type.as_deref(), Some(wire::CONTENT_TYPE));
    assert!(page.bytes.len() > 10);
    let decoded: ProjectPage = page.decode();
    assert_eq!(decoded.items.len(), 10);

    let meta = app.get("/api/meta").await;
    assert_eq!(meta.content_type.as_deref(), Some(wire::CONTENT_TYPE));
    let decoded: ProjectMeta = meta.decode();
    assert!(!decoded.owners.is_empty());
}

#[tokio::test]
async fn rejects_oversized_protocol_body() {
    let app = TestApp::new();
    let payload = vec![0u8; wire::LIMITS.max_size + 1];
    let response = app
        .send_raw("POST", "/api/projects", Some(wire::CONTENT_TYPE), payload)
        .await;
    assert_eq!(response.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(response.error().code, "payload_too_large");
}

#[tokio::test]
async fn rejects_declared_length_over_limit() {
    let app = TestApp::new();
    let mut payload = vec![0u8; 8];
    payload.extend_from_slice(&[0x81, 0x80, 0x80, 0x01]);
    let response = app
        .send_raw("POST", "/api/projects", Some(wire::CONTENT_TYPE), payload)
        .await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.error().code, "invalid_payload");
}

#[tokio::test]
async fn patch_rejects_invalid_values() {
    let app = TestApp::new();
    let patch = ProjectPatch {
        tags: Some((0..40).map(|index| format!("tag-{index}")).collect()),
        ..ProjectPatch::default()
    };
    let response = app.send("PATCH", "/api/projects/1", &patch).await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.error().code, "invalid_input");

    let patch = ProjectPatch {
        budget: Some(f64::NAN),
        ..ProjectPatch::default()
    };
    let response = app.send("PATCH", "/api/projects/1", &patch).await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.error().code, "invalid_input");
}

#[tokio::test]
async fn every_error_response_is_a_binary_api_error() {
    let app = TestApp::new();
    let patch = ProjectPatch {
        name: Some("Нет такого проекта".into()),
        ..ProjectPatch::default()
    };
    let responses = [
        app.get("/api/unknown").await,
        app.get("/api/projects?page=0").await,
        app.get("/api/projects?pageSize=101&status=archived").await,
        app.send_raw("POST", "/api/projects", Some("application/json"), vec![0])
            .await,
        app.send_raw("POST", "/api/projects", None, Vec::new())
            .await,
        app.send_raw(
            "POST",
            "/api/projects",
            Some(wire::CONTENT_TYPE),
            Vec::new(),
        )
        .await,
        app.send_raw(
            "POST",
            "/api/projects",
            Some(wire::CONTENT_TYPE),
            vec![0xFF, 0xFF],
        )
        .await,
        app.send("PATCH", "/api/projects/999999", &patch).await,
        app.delete("/api/projects/999999").await,
    ];

    for response in responses {
        assert!(response.status.is_client_error(), "{}", response.status);
        assert_eq!(
            response.content_type.as_deref(),
            Some(wire::CONTENT_TYPE),
            "{}",
            response.status
        );
        assert!(!response.bytes.is_empty());
        let error = response.error();
        assert!(!error.code.is_empty());
        assert!(!error.message.is_empty());
    }
}

fn multipart_request(
    uri: &str,
    boundary: &str,
    field: &str,
    filename: &str,
    mime: &str,
    content: &[u8],
) -> Request<Body> {
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(content);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    Request::post(uri)
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .expect("request")
}

#[tokio::test]
async fn uploads_are_stored_and_served() {
    let app = TestApp::new();
    let boundary = "test-boundary";
    let request = multipart_request(
        "/api/uploads",
        boundary,
        "file",
        "../../notes.txt",
        "text/plain",
        b"hello upload",
    );

    let response = app.call(request).await;
    assert_eq!(response.status, StatusCode::CREATED);
    let upload: UploadResult = response.decode();
    assert_eq!(upload.name, "notes.txt");
    assert_eq!(upload.size, 12);
    assert_eq!(upload.mime, "text/plain");
    assert!(!upload.id.is_empty());
    assert!(upload.url.starts_with("/uploads/"));
    assert!(app
        .uploads
        .join(upload.url.trim_start_matches("/uploads/"))
        .is_file());

    let response = app
        .router
        .clone()
        .oneshot(
            Request::get(&upload.url)
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .expect("content type"),
        "text/plain; charset=utf-8"
    );
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    assert_eq!(bytes.as_ref(), b"hello upload");
}

#[tokio::test]
async fn uploads_require_file_field() {
    let app = TestApp::new();
    let request = multipart_request(
        "/api/uploads",
        "boundary",
        "other",
        "notes.txt",
        "text/plain",
        b"data",
    );
    let response = app.call(request).await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.error().code, "missing_file");
}

#[tokio::test]
async fn uploads_require_multipart_content_type() {
    let app = TestApp::new();
    let response = app
        .call(
            Request::post("/api/uploads")
                .body(Body::from("plain text"))
                .expect("request"),
        )
        .await;
    assert!(response.status.is_client_error());
    assert_eq!(response.error().code, "invalid_multipart");
}

#[tokio::test]
async fn uploads_reject_oversized_files() {
    let app = TestApp::new();
    let content = vec![b'a'; MAX_UPLOAD_BYTES + 1];
    let request = multipart_request(
        "/api/uploads",
        "boundary",
        "file",
        "big.bin",
        "application/octet-stream",
        &content,
    );
    let response = app.call(request).await;
    assert_eq!(response.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(response.error().code, "payload_too_large");

    let stored = std::fs::read_dir(&app.uploads)
        .expect("uploads dir")
        .count();
    assert_eq!(stored, 0);
}

#[tokio::test]
async fn upload_serving_rejects_traversal() {
    let app = TestApp::new();
    for uri in [
        "/uploads/..%2F..%2FCargo.toml",
        "/uploads/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd",
        "/uploads/not-a-uuid.png",
        "/uploads/..%2Fprojects.redb",
        "/uploads/00000000-0000-0000-0000-000000000000.tar.gz",
    ] {
        let response = app.get(uri).await;
        assert!(
            response.status == StatusCode::BAD_REQUEST || response.status == StatusCode::NOT_FOUND,
            "{uri} returned {}",
            response.status
        );
    }
}
