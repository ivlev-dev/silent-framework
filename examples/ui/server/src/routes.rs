use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use axum::{
    body::Bytes,
    extract::{
        rejection::BytesRejection, DefaultBodyLimit, FromRequest, FromRequestParts, Path, Query,
        State,
    },
    http::{header, request::Parts, HeaderValue, Method, StatusCode},
    response::Response,
    routing::{get, patch, post},
    Router,
};
use serde::de::DeserializeOwned;
use silent_protocol::SilentProto;
use tokio::task::spawn_blocking;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::error::ApiError;
use crate::model::ProjectMeta;
use crate::query::ProjectQuery;
use crate::store::Store;
use crate::uploads;
use crate::wire;

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub delay: Duration,
    pub uploads_dir: PathBuf,
}

pub fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("http://localhost:6107"),
            HeaderValue::from_static("http://127.0.0.1:6107"),
        ])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::ACCEPT, header::CONTENT_TYPE])
        .max_age(Duration::from_secs(600));

    Router::new()
        .route("/api/health", get(health))
        .route("/api/projects", get(list_projects).post(create_project))
        .route(
            "/api/projects/{id}",
            patch(update_project).delete(delete_project),
        )
        .route("/api/meta", get(meta))
        .route("/api/uploads", post(uploads::upload))
        .route("/uploads/{file}", get(uploads::serve))
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(uploads::MAX_BODY_BYTES))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

async fn health() -> Result<Response, ApiError> {
    Ok(wire::response(StatusCode::OK, &wire::Health { ok: true })?)
}

async fn list_projects(
    State(state): State<AppState>,
    ApiQuery(params): ApiQuery<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let query = ProjectQuery::parse(&params)?;
    apply_delay(&state).await;

    let store = state.store.clone();
    let page = spawn_blocking(move || store.list(&query))
        .await
        .map_err(ApiError::from)?
        .map_err(ApiError::from)?;

    Ok(wire::response(
        StatusCode::OK,
        &wire::ProjectPage::from_model(&page)?,
    )?)
}

async fn create_project(
    State(state): State<AppState>,
    Proto(input): Proto<wire::ProjectInput>,
) -> Result<Response, ApiError> {
    let store = state.store.clone();
    let project = spawn_blocking(move || store.create(input.into_model()))
        .await
        .map_err(ApiError::from)?
        .map_err(ApiError::from)?;

    Ok(wire::response(
        StatusCode::CREATED,
        &wire::Project::from_model(&project)?,
    )?)
}

async fn update_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Proto(patch): Proto<wire::ProjectPatch>,
) -> Result<Response, ApiError> {
    let id = parse_id(&id)?;
    let store = state.store.clone();
    let project = spawn_blocking(move || store.update(id, patch.into_model()))
        .await
        .map_err(ApiError::from)?
        .map_err(ApiError::from)?;

    Ok(wire::response(
        StatusCode::OK,
        &wire::Project::from_model(&project)?,
    )?)
}

async fn delete_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = parse_id(&id)?;
    let store = state.store.clone();
    spawn_blocking(move || store.delete(id))
        .await
        .map_err(ApiError::from)?
        .map_err(ApiError::from)?;

    Ok(StatusCode::NO_CONTENT)
}

async fn meta(State(state): State<AppState>) -> Result<Response, ApiError> {
    apply_delay(&state).await;

    let store = state.store.clone();
    let meta: ProjectMeta = spawn_blocking(move || store.meta())
        .await
        .map_err(ApiError::from)?
        .map_err(ApiError::from)?;

    Ok(wire::response(
        StatusCode::OK,
        &wire::ProjectMeta::from_model(&meta),
    )?)
}

async fn not_found() -> ApiError {
    ApiError::not_found("not_found", "Route not found")
}

fn parse_id(raw: &str) -> Result<u64, ApiError> {
    raw.parse()
        .map_err(|_| ApiError::bad_request("invalid_path", "`id` must be a positive integer"))
}

async fn apply_delay(state: &AppState) {
    if !state.delay.is_zero() {
        tokio::time::sleep(state.delay).await;
    }
}

pub struct ApiQuery<T>(pub T);

impl<T, S> FromRequestParts<S> for ApiQuery<T>
where
    T: DeserializeOwned + Send,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Query(value) = Query::<T>::from_request_parts(parts, state)
            .await
            .map_err(|_| {
                ApiError::bad_request("invalid_query", "Query string could not be parsed")
            })?;
        Ok(Self(value))
    }
}

pub struct Proto<T>(pub T);

impl<T, S> FromRequest<S> for Proto<T>
where
    T: SilentProto,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(
        request: axum::extract::Request,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        if !accepts_protocol(request.headers()) {
            return Err(ApiError::unsupported_media_type(
                "invalid_content_type",
                format!("`Content-Type` must be `{}`", wire::CONTENT_TYPE),
            ));
        }

        let bytes =
            Bytes::from_request(request, state)
                .await
                .map_err(|rejection: BytesRejection| {
                    if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
                        ApiError::payload_too_large("Request body is too large")
                    } else {
                        ApiError::new(rejection.status(), "invalid_body", rejection.body_text())
                    }
                })?;

        if bytes.is_empty() {
            return Err(ApiError::bad_request(
                "empty_body",
                "Request body must not be empty",
            ));
        }

        if bytes.len() > wire::LIMITS.max_size {
            return Err(ApiError::payload_too_large(format!(
                "Request body must be at most {} bytes",
                wire::LIMITS.max_size
            )));
        }

        let value = T::decode_with_limits(&bytes, wire::LIMITS).map_err(|error| {
            ApiError::bad_request(
                "invalid_payload",
                format!("Payload could not be decoded: {error}"),
            )
        })?;

        Ok(Self(value))
    }
}

fn accepts_protocol(headers: &axum::http::HeaderMap) -> bool {
    let Some(value) = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    value
        .split(';')
        .next()
        .map(str::trim)
        .is_some_and(|essence| essence.eq_ignore_ascii_case(wire::CONTENT_TYPE))
}
