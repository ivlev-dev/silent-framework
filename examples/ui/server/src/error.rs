use axum::{
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};

use crate::model::ValidationError;
use crate::store::StoreError;
use crate::wire::{self, WireError};

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    pub fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message)
    }

    pub fn unsupported_media_type(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNSUPPORTED_MEDIA_TYPE, code, message)
    }

    pub fn not_found(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, code, message)
    }

    pub fn payload_too_large(message: impl Into<String>) -> Self {
        Self::new(StatusCode::PAYLOAD_TOO_LARGE, "payload_too_large", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let payload = wire::ApiError {
            code: self.code.to_owned(),
            message: self.message,
        };
        match wire::response(self.status, &payload) {
            Ok(response) => response,
            Err(error) => {
                tracing::error!(error = %error, "failed to encode error response");
                let mut fallback = Response::new(axum::body::Body::from("Internal server error"));
                *fallback.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
                fallback.headers_mut().insert(
                    header::CONTENT_TYPE,
                    header::HeaderValue::from_static("text/plain; charset=utf-8"),
                );
                fallback
            }
        }
    }
}

impl From<ValidationError> for ApiError {
    fn from(error: ValidationError) -> Self {
        ApiError::bad_request("invalid_input", error.to_string())
    }
}

impl From<WireError> for ApiError {
    fn from(error: WireError) -> Self {
        tracing::error!(error = %error, "failed to convert wire payload");
        ApiError::internal("Internal server error")
    }
}

impl From<StoreError> for ApiError {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::NotFound => ApiError::not_found("not_found", "Project not found"),
            StoreError::Validation(error) => error.into(),
            other => {
                tracing::error!(error = %other, "database operation failed");
                ApiError::internal("Internal server error")
            }
        }
    }
}

impl From<tokio::task::JoinError> for ApiError {
    fn from(error: tokio::task::JoinError) -> Self {
        tracing::error!(error = %error, "background task failed");
        ApiError::internal("Internal server error")
    }
}
