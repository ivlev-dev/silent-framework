use std::path::{Component, Path, PathBuf};

const TS_EXTENSIONS: [&str; 8] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

pub fn is_declaration_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts"))
        .unwrap_or(false)
}

pub fn is_source_file(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    if !TS_EXTENSIONS.contains(&extension) {
        return false;
    }
    !is_declaration_file(path)
}

pub fn normalize_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = std::fs::canonicalize(path) {
        return canonical;
    }
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}

pub fn module_path_without_extension(path: &Path) -> String {
    let normalized = normalize_path(path);
    let mut result = normalized;
    if result
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| TS_EXTENSIONS.contains(&extension))
        .unwrap_or(false)
    {
        result.set_extension("");
    }
    result.to_string_lossy().replace('\\', "/")
}

pub fn module_token(path: &Path, name: &str) -> String {
    format!("{}#{}", module_path_without_extension(path), name)
}

pub fn resolve_import_path(from_file: &Path, source: &str) -> Option<String> {
    if !source.starts_with('.') {
        return None;
    }
    let base = from_file.parent().unwrap_or_else(|| Path::new(""));
    let resolved = base.join(source);
    Some(module_path_without_extension(&resolved))
}

pub fn relative_specifier(from_file: &Path, target_module: &str) -> String {
    let from_dir = from_file.parent().unwrap_or_else(|| Path::new(""));
    let target = Path::new(target_module);
    let relative = pathdiff(from_dir, target);
    let normalized = relative.to_string_lossy().replace('\\', "/");
    if normalized.starts_with('.') {
        normalized
    } else {
        format!("./{normalized}")
    }
}

fn pathdiff(from: &Path, to: &Path) -> PathBuf {
    let from_components: Vec<Component<'_>> = from.components().collect();
    let to_components: Vec<Component<'_>> = to.components().collect();
    let mut common = 0;
    while common < from_components.len()
        && common < to_components.len()
        && from_components[common] == to_components[common]
    {
        common += 1;
    }
    let mut result = PathBuf::new();
    for _ in common..from_components.len() {
        result.push("..");
    }
    for component in &to_components[common..] {
        result.push(component.as_os_str());
    }
    result
}
