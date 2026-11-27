use std::time::Duration;

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    Router,
};
use chrono::Utc;
use serde_json::{json, Value};
use silent_example_ui_server::{build_router, store::Store, uploads::MAX_UPLOAD_BYTES, AppState};
use tempfile::TempDir;
use tower::ServiceExt;

struct TestApp {
    router: Router,
    uploads: std::path::PathBuf,
    _dir: TempDir,
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

    async fn call(&self, request: Request<Body>) -> (StatusCode, Value) {
        let response = self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("response");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).expect("json body")
        };
        (status, value)
    }

    async fn get(&self, uri: &str) -> (StatusCode, Value) {
        self.call(Request::get(uri).body(Body::empty()).expect("request"))
            .await
    }

    async fn send_json(&self, method: &str, uri: &str, body: Value) -> (StatusCode, Value) {
        self.call(
            Request::builder()
                .method(method)
                .uri(uri)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .expect("request"),
        )
        .await
    }

    async fn delete(&self, uri: &str) -> (StatusCode, Value) {
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
    let (status, body) = app.get("/api/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "ok": true }));
}

#[tokio::test]
async fn meta_contains_seeded_values() {
    let app = TestApp::new();
    let (status, body) = app.get("/api/meta").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["statuses"].as_array().unwrap().len(), 4);
    assert_eq!(body["owners"].as_array().unwrap().len(), 8);
    assert_eq!(body["tags"].as_array().unwrap().len(), 12);
    assert!(body["owners"]
        .as_array()
        .unwrap()
        .contains(&json!("Ада Ловлейс")));
    assert!(body["tags"]
        .as_array()
        .unwrap()
        .contains(&json!("frontend")));
}

#[tokio::test]
async fn list_supports_pagination_filtering_and_sorting() {
    let app = TestApp::new();

    let (status, body) = app.get("/api/projects").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["total"], 240);
    assert_eq!(body["page"], 1);
    assert_eq!(body["pageSize"], 20);
    assert_eq!(body["items"].as_array().unwrap().len(), 20);

    let (status, body) = app.get("/api/projects?page=2&pageSize=10").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["total"], 240);
    assert_eq!(body["page"], 2);
    assert_eq!(body["items"].as_array().unwrap().len(), 10);

    let (_, body) = app.get("/api/projects?status=active&pageSize=100").await;
    assert_eq!(body["total"], 60);
    assert!(body["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["status"] == "active"));

    let (_, body) = app
        .get(&format!("/api/projects?owner={}", encode("Ада Ловлейс")))
        .await;
    assert_eq!(body["total"], 30);

    let (_, body) = app
        .get(&format!("/api/projects?q={}", encode("сЕвЕрНыЙ")))
        .await;
    assert_eq!(body["total"], 15);

    let (_, body) = app
        .get("/api/projects?budgetMin=10000&budgetMax=20000&pageSize=100")
        .await;
    let items = body["items"].as_array().unwrap();
    assert!(!items.is_empty());
    assert!(items.iter().all(|item| {
        let budget = item["budget"].as_f64().unwrap();
        (10_000.0..=20_000.0).contains(&budget)
    }));

    let (_, body) = app
        .get(&format!(
            "/api/projects?createdTo={}&pageSize=100",
            encode(&Utc::now().to_rfc3339())
        ))
        .await;
    assert_eq!(body["total"], 240);

    let (_, body) = app
        .get(&format!(
            "/api/projects?createdFrom={}",
            encode(&(Utc::now() + chrono::Duration::days(1)).to_rfc3339())
        ))
        .await;
    assert_eq!(body["total"], 0);

    let (_, body) = app
        .get("/api/projects?sort=budget&order=asc&pageSize=100")
        .await;
    let budgets: Vec<f64> = body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["budget"].as_f64().unwrap())
        .collect();
    assert!(budgets.windows(2).all(|pair| pair[0] <= pair[1]));

    let (_, body) = app
        .get("/api/projects?sort=createdAt&order=desc&pageSize=100")
        .await;
    let dates: Vec<chrono::DateTime<Utc>> = body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| {
            chrono::DateTime::parse_from_rfc3339(item["createdAt"].as_str().unwrap())
                .unwrap()
                .with_timezone(&Utc)
        })
        .collect();
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
        let (status, body) = app.get(uri).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(body["error"]["code"], "invalid_query", "{uri}");
        assert!(body["error"]["message"]
            .as_str()
            .is_some_and(|value| !value.is_empty()));
    }
}

#[tokio::test]
async fn crud_flow_works_end_to_end() {
    let app = TestApp::new();

    let created = json!({
        "name": "  Платформа  ",
        "owner": "Тестовый Владелец",
        "status": "review",
        "tags": ["api", "api", "docs"],
        "budget": 4242.5
    });
    let (status, body) = app.send_json("POST", "/api/projects", created).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["id"], 241);
    assert_eq!(body["name"], "Платформа");
    assert_eq!(body["tags"], json!(["api", "docs"]));
    assert_eq!(body["budget"], 4242.5);
    assert!(body["createdAt"].is_string());

    let (_, meta) = app.get("/api/meta").await;
    assert!(meta["owners"]
        .as_array()
        .unwrap()
        .contains(&json!("Тестовый Владелец")));

    let patch = json!({ "name": "Обновлённая платформа", "status": "done" });
    let (status, body) = app.send_json("PATCH", "/api/projects/241", patch).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["name"], "Обновлённая платформа");
    assert_eq!(body["status"], "done");
    assert_eq!(body["owner"], "Тестовый Владелец");
    assert_eq!(body["budget"], 4242.5);

    let (_, body) = app
        .get(&format!("/api/projects?q={}", encode("Обновлённая")))
        .await;
    assert_eq!(body["total"], 1);

    let (status, body) = app.delete("/api/projects/241").await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(body, Value::Null);

    let (status, body) = app.delete("/api/projects/241").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], "not_found");

    let (status, body) = app
        .send_json("PATCH", "/api/projects/241", json!({ "name": "x" }))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], "not_found");
}

#[tokio::test]
async fn create_rejects_invalid_payloads() {
    let app = TestApp::new();

    let (status, body) = app
        .send_json(
            "POST",
            "/api/projects",
            json!({
                "name": "Проект",
                "owner": "Владелец",
                "status": "active",
                "tags": [],
                "budget": -1
            }),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "invalid_input");

    let (status, body) = app
        .send_json("POST", "/api/projects", json!({ "name": "Проект" }))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "invalid_json");

    let (status, body) = app
        .send_json(
            "POST",
            "/api/projects",
            json!({
                "name": "Проект",
                "owner": "Владелец",
                "status": "unknown",
                "tags": [],
                "budget": 1
            }),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "invalid_json");
}

#[tokio::test]
async fn unknown_route_returns_not_found() {
    let app = TestApp::new();
    let (status, body) = app.get("/api/unknown").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], "not_found");
}

#[tokio::test]
async fn cors_allows_ui_origin() {
    let app = TestApp::new();
    let (status, _) = app
        .call(
            Request::builder()
                .method("OPTIONS")
                .uri("/api/projects")
                .header(header::ORIGIN, "http://localhost:6107")
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
                .body(Body::empty())
                .expect("request"),
        )
        .await;
    assert!(status.is_success());

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

    let (status, body) = app.call(request).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["name"], "notes.txt");
    assert_eq!(body["size"], 12);
    assert_eq!(body["mime"], "text/plain");
    assert!(body["id"].as_str().is_some());
    let url = body["url"].as_str().expect("url").to_owned();
    assert!(url.starts_with("/uploads/"));
    assert!(app
        .uploads
        .join(url.trim_start_matches("/uploads/"))
        .is_file());

    let response = app
        .router
        .clone()
        .oneshot(Request::get(&url).body(Body::empty()).expect("request"))
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
    let (status, body) = app.call(request).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "missing_file");
}

#[tokio::test]
async fn uploads_require_multipart_content_type() {
    let app = TestApp::new();
    let (status, body) = app
        .call(
            Request::post("/api/uploads")
                .body(Body::from("plain text"))
                .expect("request"),
        )
        .await;
    assert!(status.is_client_error());
    assert_eq!(body["error"]["code"], "invalid_multipart");
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
    let (status, body) = app.call(request).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(body["error"]["code"], "payload_too_large");

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
        let (status, _) = app.get(uri).await;
        assert!(
            status == StatusCode::BAD_REQUEST || status == StatusCode::NOT_FOUND,
            "{uri} returned {status}"
        );
    }
}
