use axum::{
    body::Body,
    extract::{
        multipart::{MultipartError, MultipartRejection},
        FromRequest, Multipart, Path, State,
    },
    http::{header, Response, StatusCode},
    response::IntoResponse,
};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::error::ApiError;
use crate::model::UploadResult;
use crate::routes::AppState;
use crate::wire;

pub const MAX_UPLOAD_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_BODY_BYTES: usize = MAX_UPLOAD_BYTES + 1024 * 1024;

pub struct ApiMultipart(pub Multipart);

impl<S> FromRequest<S> for ApiMultipart
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(
        request: axum::extract::Request,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        Multipart::from_request(request, state)
            .await
            .map(ApiMultipart)
            .map_err(|rejection: MultipartRejection| {
                ApiError::new(
                    rejection.status(),
                    "invalid_multipart",
                    rejection.body_text(),
                )
            })
    }
}

pub async fn upload(
    State(state): State<AppState>,
    ApiMultipart(mut multipart): ApiMultipart,
) -> Result<impl IntoResponse, ApiError> {
    loop {
        let Some(mut field) = multipart.next_field().await.map_err(multipart_error)? else {
            return Err(ApiError::bad_request(
                "missing_file",
                "Multipart field `file` is required",
            ));
        };
        if field.name() != Some("file") {
            continue;
        }

        let original_name = normalize_filename(field.file_name().unwrap_or("file"));
        let mime = sanitize_mime(field.content_type());
        let (id, stored_name) = allocate_name(&state.uploads_dir, &original_name).await?;

        tokio::fs::create_dir_all(&state.uploads_dir)
            .await
            .map_err(io_error)?;
        let path = state.uploads_dir.join(&stored_name);
        let mut file = tokio::fs::File::create(&path).await.map_err(io_error)?;
        let mut size = 0usize;

        let write_result = async {
            while let Some(chunk) = field.chunk().await.map_err(multipart_error)? {
                size = size.checked_add(chunk.len()).ok_or_else(oversized_error)?;
                if size > MAX_UPLOAD_BYTES {
                    return Err(oversized_error());
                }
                file.write_all(&chunk).await.map_err(io_error)?;
            }
            file.flush().await.map_err(io_error)?;
            Ok(())
        }
        .await;

        if let Err(error) = write_result {
            drop(file);
            let _ = tokio::fs::remove_file(&path).await;
            return Err(error);
        }
        drop(file);

        return wire::response(
            StatusCode::CREATED,
            &wire::UploadResult::from_model(&UploadResult {
                id,
                name: original_name,
                size: size as u64,
                mime,
                url: format!("/uploads/{stored_name}"),
            })?,
        )
        .map_err(ApiError::from);
    }
}

pub async fn serve(
    State(state): State<AppState>,
    Path(file): Path<String>,
) -> Result<Response<Body>, ApiError> {
    if !is_safe_stored_name(&file) {
        return Err(ApiError::bad_request(
            "invalid_file_name",
            "Invalid uploaded file name",
        ));
    }

    let path = state.uploads_dir.join(&file);
    let bytes = tokio::fs::read(&path).await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            ApiError::not_found("not_found", "File not found")
        } else {
            io_error(error)
        }
    })?;

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime_for_extension(&file))
        .header(header::CONTENT_LENGTH, bytes.len().to_string())
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "public, max-age=3600")
        .body(Body::from(bytes))
        .map_err(|error| {
            tracing::error!(error = %error, "failed to build upload response");
            ApiError::internal("Internal server error")
        })
}

async fn allocate_name(
    uploads_dir: &std::path::Path,
    original_name: &str,
) -> Result<(String, String), ApiError> {
    for _ in 0..5 {
        let id = Uuid::new_v4().to_string();
        let stored_name = match safe_extension(original_name) {
            Some(extension) => format!("{id}.{extension}"),
            None => id.clone(),
        };
        let exists = tokio::fs::try_exists(uploads_dir.join(&stored_name))
            .await
            .map_err(io_error)?;
        if !exists {
            return Ok((id, stored_name));
        }
    }
    Err(ApiError::internal(
        "Could not allocate a unique upload name",
    ))
}

fn oversized_error() -> ApiError {
    ApiError::payload_too_large(format!(
        "File must be at most {} MiB",
        MAX_UPLOAD_BYTES / (1024 * 1024)
    ))
}

fn io_error(error: std::io::Error) -> ApiError {
    tracing::error!(error = %error, "upload storage error");
    ApiError::internal("Could not store uploaded file")
}

fn multipart_error(error: MultipartError) -> ApiError {
    ApiError::bad_request("invalid_multipart", error.body_text())
}

pub(crate) fn is_safe_stored_name(name: &str) -> bool {
    let (id, extension) = match name.split_once('.') {
        Some((id, extension)) => (id, Some(extension)),
        None => (name, None),
    };
    if !is_uuid(id) {
        return false;
    }
    extension.is_none_or(|extension| {
        !extension.is_empty()
            && extension.len() <= 10
            && extension.chars().all(|value| value.is_ascii_alphanumeric())
    })
}

fn is_uuid(value: &str) -> bool {
    if value.len() != 36 {
        return false;
    }
    value.char_indices().all(|(index, value)| match index {
        8 | 13 | 18 | 23 => value == '-',
        _ => value.is_ascii_hexdigit(),
    })
}

pub(crate) fn safe_extension(file_name: &str) -> Option<String> {
    let (stem, extension) = file_name.rsplit_once('.')?;
    if stem.is_empty() || extension.is_empty() || extension.len() > 10 {
        return None;
    }
    if !extension.chars().all(|value| value.is_ascii_alphanumeric()) {
        return None;
    }
    Some(extension.to_ascii_lowercase())
}

pub(crate) fn normalize_filename(raw: &str) -> String {
    let base = raw
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("file")
        .chars()
        .filter(|value| !value.is_control())
        .collect::<String>();
    let trimmed = base.trim();
    if trimmed.is_empty() {
        return String::from("file");
    }
    trimmed.chars().take(255).collect()
}

pub(crate) fn sanitize_mime(raw: Option<&str>) -> String {
    const FALLBACK: &str = "application/octet-stream";

    let Some(value) = raw else {
        return FALLBACK.to_owned();
    };
    let value = value.trim();
    if value.is_empty()
        || value.len() > 255
        || !value.is_ascii()
        || !value
            .chars()
            .all(|character| character.is_ascii_graphic() || character == ' ')
    {
        return FALLBACK.to_owned();
    }

    let essence = value.split(';').next().unwrap_or_default().trim();
    match essence.split_once('/') {
        Some((kind, subtype))
            if !kind.is_empty()
                && !subtype.is_empty()
                && kind.chars().all(is_token_character)
                && subtype.chars().all(is_token_character) =>
        {
            value.to_owned()
        }
        _ => FALLBACK.to_owned(),
    }
}

fn is_token_character(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || matches!(
            character,
            '!' | '#'
                | '$'
                | '%'
                | '&'
                | '\''
                | '*'
                | '+'
                | '-'
                | '.'
                | '^'
                | '_'
                | '`'
                | '|'
                | '~'
        )
}

pub(crate) fn mime_for_extension(name: &str) -> &'static str {
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase());
    match extension.as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("pdf") => "application/pdf",
        Some("txt") => "text/plain; charset=utf-8",
        Some("md") => "text/markdown; charset=utf-8",
        Some("json") => "application/json",
        Some("csv") => "text/csv; charset=utf-8",
        Some("zip") => "application/zip",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_generated_file_names() {
        assert!(is_safe_stored_name(
            "6f1a3c1e-1f9f-4f1a-9f0e-5d6b7c8d9e0f.png"
        ));
        assert!(is_safe_stored_name("6f1a3c1e-1f9f-4f1a-9f0e-5d6b7c8d9e0f"));

        for name in [
            "",
            ".",
            "..",
            "../secret",
            "..%2Fsecret",
            "/etc/passwd",
            "6f1a3c1e-1f9f-4f1a-9f0e-5d6b7c8d9e0f.png/../x",
            "6f1a3c1e-1f9f-4f1a-9f0e-5d6b7c8d9e0f.tar.gz",
            "6f1a3c1e-1f9f-4f1a-9f0e-5d6b7c8d9e0g",
            "not-a-uuid",
        ] {
            assert!(!is_safe_stored_name(name), "{name}");
        }
    }

    #[test]
    fn derives_safe_extensions() {
        assert_eq!(safe_extension("notes.TXT"), Some("txt".into()));
        assert_eq!(safe_extension("archive.tar.gz"), Some("gz".into()));
        assert_eq!(safe_extension("no-extension"), None);
        assert_eq!(safe_extension(".env"), None);
        assert_eq!(safe_extension("evil.p/../../x"), None);
        assert_eq!(safe_extension("long.abcdefghijk"), None);
    }

    #[test]
    fn normalizes_client_file_names() {
        assert_eq!(normalize_filename("../../etc/passwd"), "passwd");
        assert_eq!(normalize_filename("C:\\temp\\report.pdf"), "report.pdf");
        assert_eq!(normalize_filename("  spaced.txt  "), "spaced.txt");
        assert_eq!(normalize_filename(""), "file");
        assert_eq!(normalize_filename("bad\u{0}name"), "badname");
    }

    #[test]
    fn sanitizes_mime() {
        assert_eq!(sanitize_mime(Some("image/png")), "image/png");
        assert_eq!(
            sanitize_mime(Some("text/plain; charset=utf-8")),
            "text/plain; charset=utf-8"
        );
        assert_eq!(sanitize_mime(Some("garbage")), "application/octet-stream");
        assert_eq!(
            sanitize_mime(Some("text/plain\r\nX-Evil: 1")),
            "application/octet-stream"
        );
        assert_eq!(sanitize_mime(None), "application/octet-stream");
    }

    #[test]
    fn resolves_mime_by_extension() {
        assert_eq!(mime_for_extension("a.png"), "image/png");
        assert_eq!(mime_for_extension("a.JPEG"), "image/jpeg");
        assert_eq!(mime_for_extension("a.txt"), "text/plain; charset=utf-8");
        assert_eq!(mime_for_extension("a.bin"), "application/octet-stream");
        assert_eq!(
            mime_for_extension("no-extension"),
            "application/octet-stream"
        );
    }
}
