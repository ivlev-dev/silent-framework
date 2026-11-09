use napi_derive::napi;
use std::path::Path;

fn to_napi_error(error: String) -> napi::Error {
    napi::Error::from_reason(error)
}

#[napi]
pub fn version() -> String {
    silent_transform::version().to_string()
}

#[napi]
pub fn transform(
    source: String,
    filename: String,
    options_json: String,
    index_json: String,
) -> napi::Result<String> {
    silent_transform::transform(&source, &filename, &options_json, &index_json)
        .map_err(to_napi_error)
}

#[napi]
pub fn scan(root: String) -> napi::Result<String> {
    let index = silent_transform::scan(Path::new(&root));
    serde_json::to_string(&index).map_err(|error| to_napi_error(error.to_string()))
}
