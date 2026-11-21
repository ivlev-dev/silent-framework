use silent_transform::alias::AliasRule;
use silent_transform::{scan_paths, scan_with_aliases, Index};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_project(name: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let root = std::env::temp_dir().join(format!(
        "silent-scan-paths-{}-{}-{}",
        name,
        std::process::id(),
        unique
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("src")).unwrap();
    fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
    fs::create_dir_all(root.join(".hidden")).unwrap();
    fs::write(
        root.join("src/types.ts"),
        "export interface Store { get(key: string): string }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/memory.ts"),
        "import type { Store } from './types';\nexport class MemoryStore implements Store { get() { return ''; } }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/other.ts"),
        "export interface Logger { log(message: string): void }\nexport class ConsoleLogger implements Logger { log() {} }\n",
    )
    .unwrap();
    fs::write(
        root.join("node_modules/pkg/index.ts"),
        "export class Vendored implements Store { get() { return ''; } }\n",
    )
    .unwrap();
    fs::write(
        root.join(".hidden/secret.ts"),
        "export class Secret implements Store { get() { return ''; } }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/types.d.ts"),
        "export interface Declared {}\n",
    )
    .unwrap();
    root
}

fn canonical(root: &Path) -> String {
    fs::canonicalize(root)
        .unwrap_or_else(|_| root.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
}

fn keys(index: &Index) -> Vec<String> {
    let mut values: Vec<String> = index.values.keys().cloned().collect();
    values.sort();
    values
}

#[test]
fn scans_only_requested_files() {
    let root = temp_project("subset");
    let base = canonical(&root);

    let index = scan_paths(&root, &[root.join("src/memory.ts")], &[]);

    assert_eq!(keys(&index), vec![format!("{base}/src/memory")]);
    assert!(index
        .interfaces
        .values()
        .flatten()
        .all(|value| value.starts_with(&format!("{base}/src/memory#"))));
    assert!(!index.values.contains_key(&format!("{base}/src/types")));
    assert!(!index.values.contains_key(&format!("{base}/src/other")));
}

#[test]
fn merge_of_scanned_paths_matches_full_scan() {
    let root = temp_project("parity");
    let files = vec![
        root.join("src/types.ts"),
        root.join("src/memory.ts"),
        root.join("src/other.ts"),
    ];

    let partial = scan_paths(&root, &files, &[]);
    let full = scan_with_aliases(&root, &[]);

    assert_eq!(
        serde_json::to_value(&partial).unwrap(),
        serde_json::to_value(&full).unwrap()
    );
}

#[test]
fn ignores_duplicates_outside_root_and_service_directories() {
    let root = temp_project("filters");
    let base = canonical(&root);
    let outside = std::env::temp_dir().join(format!(
        "silent-scan-paths-outside-{}.ts",
        std::process::id()
    ));
    fs::write(
        &outside,
        "export interface Outside {}\nexport class Impl implements Outside {}\n",
    )
    .unwrap();

    let index = scan_paths(
        &root,
        &[
            root.join("src/other.ts"),
            root.join("src/other.ts"),
            root.join("src/types.d.ts"),
            root.join("node_modules/pkg/index.ts"),
            root.join(".hidden/secret.ts"),
            outside.clone(),
        ],
        &[],
    );

    assert_eq!(keys(&index), vec![format!("{base}/src/other")]);
    let _ = fs::remove_file(outside);
}

#[test]
fn resolves_aliases_for_scanned_file() {
    let root = temp_project("aliases");
    fs::create_dir_all(root.join("src/application")).unwrap();
    fs::create_dir_all(root.join("src/app")).unwrap();
    fs::write(
        root.join("src/application/service.ts"),
        "export interface UsersService { load(): string }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/app/probe.ts"),
        "import type { UsersService } from '@/application/service';\nexport class Probe implements UsersService { load() { return ''; } }\n",
    )
    .unwrap();
    let base = canonical(&root);
    let aliases = vec![AliasRule {
        find: "@/*".to_string(),
        replacement: format!("{base}/src/*"),
    }];

    let index = scan_paths(&root, &[root.join("src/app/probe.ts")], &aliases);

    assert_eq!(
        index
            .interfaces
            .get(&format!("{base}/src/application/service#UsersService")),
        Some(&vec![format!("{base}/src/app/probe#Probe")])
    );
}

#[test]
fn missing_file_yields_empty_index() {
    let root = temp_project("missing");

    let index = scan_paths(&root, &[root.join("src/gone.ts")], &[]);

    assert!(index.interfaces.is_empty());
    assert!(index.values.is_empty());
}
