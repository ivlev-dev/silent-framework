use silent_transform::alias::AliasRule;
use silent_transform::{scan_with_aliases, transform, Index};
use std::fs;
use std::path::{Path, PathBuf};

fn temp_project(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("silent-alias-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("src/application")).unwrap();
    fs::create_dir_all(root.join("src/app")).unwrap();
    fs::write(
        root.join("src/application/service.ts"),
        r#"
export interface UsersService {
  load(): string;
}

export class UsersServiceDefault implements UsersService {
  load(): string {
    return "users";
  }
}
"#,
    )
    .unwrap();
    fs::write(
        root.join("src/app/probe.ts"),
        r#"
import type { UsersService } from "@/application/service";

export class Probe {
  constructor(private readonly users: UsersService) {}

  read(): string {
    return this.users.load();
  }
}
"#,
    )
    .unwrap();
    root
}

fn alias_rules(root: &Path) -> Vec<AliasRule> {
    vec![AliasRule {
        find: "@/*".to_string(),
        replacement: format!("{}/src/*", root.to_string_lossy().replace('\\', "/")),
    }]
}

#[test]
fn scan_resolves_aliased_interface_implementations() {
    let root = temp_project("scan");
    let aliases = alias_rules(&root);
    let index = scan_with_aliases(&root, &aliases);

    let service = root
        .join("src/application/service")
        .to_string_lossy()
        .replace('\\', "/");
    let probe = root
        .join("src/app/probe")
        .to_string_lossy()
        .replace('\\', "/");

    let implementations = index
        .interfaces
        .get(&format!("{service}#UsersService"))
        .expect("interface implementation was not indexed");
    assert!(implementations.contains(&format!("{service}#UsersServiceDefault")));
    assert!(!index
        .interfaces
        .contains_key(&format!("{probe}#UsersService")));
}

#[test]
fn transform_resolves_aliased_type_import_through_index() {
    let root = temp_project("transform");
    let aliases = alias_rules(&root);
    let index = scan_with_aliases(&root, &aliases);
    let index_json = serde_json::to_string(&index).unwrap();
    let options = serde_json::json!({ "aliases": aliases }).to_string();
    let source = fs::read_to_string(root.join("src/app/probe.ts")).unwrap();
    let probe = root.join("src/app/probe.ts").to_string_lossy().into_owned();

    let result = transform(&source, &probe, &options, &index_json).unwrap();
    let value: serde_json::Value = serde_json::from_str(&result).unwrap();
    let code = value["code"].as_str().unwrap();
    assert!(code.contains("UsersServiceDefault"), "{code}");
    assert!(code.contains("silent.di.create"), "{code}");
}

#[test]
fn alias_import_is_not_indexed_without_aliases() {
    let root = temp_project("no-alias");
    let index = scan_with_aliases(&root, &[]);
    let probe = root
        .join("src/app/probe")
        .to_string_lossy()
        .replace('\\', "/");
    assert!(
        !index
            .interfaces
            .contains_key(&format!("{probe}#UsersService")),
        "{:?}",
        index.interfaces
    );
    let _ = Index::default();
}
