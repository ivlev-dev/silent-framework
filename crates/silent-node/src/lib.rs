use napi_derive::napi;
use std::path::Path;

fn to_napi_error(error: String) -> napi::Error {
    napi::Error::from_reason(error)
}

#[napi]
pub fn version() -> String {
    silent_transform::version().to_string()
}

#[napi(catch_unwind)]
pub fn transform(
    source: String,
    filename: String,
    options_json: String,
    index_json: String,
) -> napi::Result<String> {
    silent_transform::transform(&source, &filename, &options_json, &index_json)
        .map_err(to_napi_error)
}

#[napi(catch_unwind)]
pub fn scan(root: String, options_json: String) -> napi::Result<String> {
    let config: silent_transform::alias::AliasConfig = if options_json.trim().is_empty() {
        silent_transform::alias::AliasConfig::default()
    } else {
        serde_json::from_str(&options_json).map_err(|error| to_napi_error(error.to_string()))?
    };
    let index = silent_transform::scan_with_aliases(Path::new(&root), &config.aliases);
    serde_json::to_string(&index).map_err(|error| to_napi_error(error.to_string()))
}
