use serde_json::{json, Value};
use silent_transform::{transform, Index};

fn run(source: &str, filename: &str, options: Value) -> Result<Value, String> {
    let options_json = serde_json::to_string(&options).unwrap();
    let index_json = serde_json::to_string(&Index::default()).unwrap();
    let result = transform(source, filename, &options_json, &index_json)?;
    Ok(serde_json::from_str(&result).unwrap())
}

#[test]
fn target_es5_downlevels_const_and_arrow() {
    let v = run(
        "const x = (a: number) => a + 1;",
        "/proj/src/m.ts",
        json!({"swc": {"jsc": {"target": "es5"}}}),
    )
    .unwrap();
    let code = v["code"].as_str().unwrap();
    assert!(code.contains("var"), "{code}");
    assert!(code.contains("function"), "{code}");
    assert!(!code.contains("=>"), "{code}");
}

#[test]
fn default_target_keeps_modern_syntax() {
    let v = run(
        "const x = (a: number) => a + 1;",
        "/proj/src/m.ts",
        json!({}),
    )
    .unwrap();
    let code = v["code"].as_str().unwrap();
    assert!(code.contains("const"), "{code}");
    assert!(code.contains("=>"), "{code}");
}

#[test]
fn minify_removes_extra_whitespace() {
    let v = run(
        "const a = 1;\nconst b = 2;\n",
        "/proj/src/m.ts",
        json!({"swc": {"minify": true}}),
    )
    .unwrap();
    let code = v["code"].as_str().unwrap();
    assert!(!code.contains('\n'), "{code}");
}

#[test]
fn source_maps_false_yields_null_map() {
    let v = run(
        "const a = 1;",
        "/proj/src/m.ts",
        json!({"swc": {"sourceMaps": false}}),
    )
    .unwrap();
    assert!(v["map"].is_null());

    let v = run("const a = 1;", "/proj/src/m.ts", json!({})).unwrap();
    assert!(v["map"].is_string());
}

#[test]
fn env_targets_do_not_conflict() {
    let v = run(
        "const x = (a: number) => a + 1;",
        "/proj/src/m.ts",
        json!({"swc": {"env": {"targets": {"chrome": "60"}}}}),
    )
    .unwrap();
    let code = v["code"].as_str().unwrap();
    assert!(!code.is_empty());
}

#[test]
fn external_helpers_true_imports_swc_helpers() {
    let source = "const x = async () => await Promise.resolve(1);";
    let v = run(
        source,
        "/proj/src/m.ts",
        json!({"swc": {"jsc": {"target": "es5", "externalHelpers": true}}}),
    )
    .unwrap();
    let code = v["code"].as_str().unwrap();
    assert!(code.contains("@swc/helpers"), "{code}");

    let v = run(
        source,
        "/proj/src/m.ts",
        json!({"swc": {"jsc": {"target": "es5", "externalHelpers": false}}}),
    )
    .unwrap();
    let code = v["code"].as_str().unwrap();
    assert!(!code.contains("@swc/helpers"), "{code}");

    let v = run(source, "/proj/src/m.ts", json!({})).unwrap();
    let code = v["code"].as_str().unwrap();
    assert!(!code.contains("@swc/helpers"), "{code}");
}

#[test]
fn parser_tsx_options_do_not_break_parsing() {
    let source = "const x: number = 1;";
    for (filename, tsx) in [
        ("/proj/src/m.ts", false),
        ("/proj/src/m.ts", true),
        ("/proj/src/m.tsx", false),
        ("/proj/src/m.tsx", true),
    ] {
        let result = run(
            source,
            filename,
            json!({"swc": {"jsc": {"parser": {"syntax": "typescript", "tsx": tsx, "decorators": true}}}}),
        );
        assert!(result.is_ok(), "{filename} tsx={tsx}");
    }
}

#[test]
fn keep_class_names_preserves_name() {
    let v = run(
        "class Foo { bar() { return 1; } }",
        "/proj/src/m.ts",
        json!({"swc": {"minify": true, "jsc": {"keepClassNames": true}}}),
    )
    .unwrap();
    let code = v["code"].as_str().unwrap();
    assert!(code.contains("Foo"), "{code}");
}

#[test]
fn minify_with_decorators_and_accessor_does_not_fail() {
    let source = r#"
import { reactive } from "@silent/core";
class CounterVM {
  @reactive accessor count = 0;
}
"#;
    let v = run(
        source,
        "/proj/src/counter.vm.ts",
        json!({"swc": {"minify": true}}),
    )
    .unwrap();
    let code = v["code"].as_str().unwrap();
    assert!(
        code.contains("_apply_decs") || code.contains("applyDecs"),
        "{code}"
    );
}

#[test]
fn invalid_swc_options_return_err() {
    let result = transform(
        "const a = 1;",
        "/proj/src/m.ts",
        r#"{"swc":{"jsc":{"target":123}}}"#,
        "{}",
    );
    assert!(result.is_err());
}
