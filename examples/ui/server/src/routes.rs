use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use axum::{
    extract::{
        rejection::JsonRejection, DefaultBodyLimit, FromRequest, FromRequestParts, Path, Query,
        State,
    },
    http::{header, request::Parts, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use serde::{de::DeserializeOwned, Serialize};
use tokio::task::spawn_blocking;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::error::ApiError;
use crate::model::{Project, ProjectInput, ProjectMeta, ProjectPage, ProjectPatch};
use crate::query::ProjectQuery;
use crate::store::Store;
use crate::uploads;

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

#[derive(Debug, Serialize)]
struct HealthResponse {
    ok: bool,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { ok: true })
}

async fn list_projects(
    State(state): State<AppState>,
    ApiQuery(params): ApiQuery<HashMap<String, String>>,
) -> Result<Json<ProjectPage>, ApiError> {
    let query = ProjectQuery::parse(&params)?;
    apply_delay(&state).await;

    let store = state.store.clone();
    let page = spawn_blocking(move || store.list(&query))
        .await
        .map_err(ApiError::from)?
        .map_err(ApiError::from)?;

    Ok(Json(page))
}

async fn create_project(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<ProjectInput>,
) -> Result<impl IntoResponse, ApiError> {
    let store = state.store.clone();
    let project = spawn_blocking(move || store.create(input))
        .await
        .map_err(ApiError::from)?
        .map_err(ApiError::from)?;

    Ok((StatusCode::CREATED, Json(project)))
}

async fn update_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ApiJson(patch): ApiJson<ProjectPatch>,
) -> Result<Json<Project>, ApiError> {
    let id = parse_id(&id)?;
    let store = state.store.clone();
    let project = spawn_blocking(move || store.update(id, patch))
        .await
        .map_err(ApiError::from)?
        .map_err(ApiError::from)?;

    Ok(Json(project))
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

async fn meta(State(state): State<AppState>) -> Result<Json<ProjectMeta>, ApiError> {
    apply_delay(&state).await;

    let store = state.store.clone();
    let meta = spawn_blocking(move || store.meta())
        .await
        .map_err(ApiError::from)?
        .map_err(ApiError::from)?;

    Ok(Json(meta))
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

pub struct ApiJson<T>(pub T);

impl<T, S> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(
        request: axum::extract::Request,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let Json(value) =
            Json::<T>::from_request(request, state)
                .await
                .map_err(|rejection: JsonRejection| {
                    ApiError::bad_request("invalid_json", rejection.body_text())
                })?;
        Ok(Self(value))
    }
}
