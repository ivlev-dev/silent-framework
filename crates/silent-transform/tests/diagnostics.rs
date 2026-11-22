use silent_transform::{scan, transform, Index};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use swc_core::common::{FileName, SourceMap};
use swc_core::ecma::ast::EsVersion;
use swc_core::ecma::parser::{lexer::Lexer, EsSyntax, Parser, StringInput, Syntax};

fn compile(source: &str, filename: &str, options: &str, index: Index) -> Result<String, String> {
    let index_json = serde_json::to_string(&index).unwrap();
    transform(source, filename, options, &index_json)
}

fn result_parts(result: &str) -> (String, Vec<String>) {
    let value: serde_json::Value = serde_json::from_str(result).unwrap();
    let code = value["code"].as_str().unwrap().to_string();
    let diagnostics = value["diagnostics"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    (code, diagnostics)
}

fn assert_parses(code: &str) {
    let source_map = SourceMap::default();
    let file = source_map.new_source_file(FileName::Anon.into(), code.to_string());
    let lexer = Lexer::new(
        Syntax::Es(EsSyntax {
            decorators: true,
            ..Default::default()
        }),
        EsVersion::EsNext,
        StringInput::from(&*file),
        None,
    );
    let mut parser = Parser::new_from(lexer);
    if let Err(error) = parser.parse_module() {
        panic!("сгенерированный код не парсится: {error:?}\n{code}");
    }
}

fn index_with(interfaces: &[(&str, Vec<&str>)]) -> Index {
    let mut index = Index::default();
    for (token, implementations) in interfaces {
        index.interfaces.insert(
            token.to_string(),
            implementations
                .iter()
                .map(|value| value.to_string())
                .collect(),
        );
    }
    index
}

const MULTIPLE_IMPLEMENTATIONS: &str = r#"
import type { Store } from "./types";
export class Service {
  constructor(private readonly store: Store) {}
}
"#;

#[test]
fn di_warn_returns_diagnostics_and_keeps_code() {
    let index = index_with(&[(
        "/proj/src/types#Store",
        vec!["/proj/src/a#AStore", "/proj/src/b#BStore"],
    )]);
    let result = compile(
        MULTIPLE_IMPLEMENTATIONS,
        "/proj/src/service.ts",
        r#"{"di":"warn"}"#,
        index,
    )
    .unwrap();
    let (code, diagnostics) = result_parts(&result);
    assert!(
        diagnostics
            .iter()
            .any(|item| item.contains("несколько реализаций")),
        "missing diagnostic: {diagnostics:?}"
    );
    assert!(code.contains("class Service"), "{code}");
    assert!(!code.contains("silent.di.create"), "{code}");
    assert_parses(&code);
}

#[test]
fn di_allow_is_silent_and_keeps_code() {
    let index = index_with(&[(
        "/proj/src/types#Store",
        vec!["/proj/src/a#AStore", "/proj/src/b#BStore"],
    )]);
    let result = compile(
        MULTIPLE_IMPLEMENTATIONS,
        "/proj/src/service.ts",
        r#"{"di":"allow"}"#,
        index,
    )
    .unwrap();
    let (code, diagnostics) = result_parts(&result);
    assert!(
        diagnostics.is_empty(),
        "unexpected diagnostics: {diagnostics:?}"
    );
    assert!(code.contains("class Service"), "{code}");
    assert!(!code.contains("silent.di.create"), "{code}");
}

#[test]
fn di_error_is_fatal() {
    let index = index_with(&[(
        "/proj/src/types#Store",
        vec!["/proj/src/a#AStore", "/proj/src/b#BStore"],
    )]);
    let error = compile(
        MULTIPLE_IMPLEMENTATIONS,
        "/proj/src/service.ts",
        r#"{"di":"error"}"#,
        index,
    )
    .unwrap_err();
    assert!(error.contains("несколько реализаций"), "{error}");
}

#[test]
fn string_export_name_uses_string_import_and_sanitized_local() {
    let source = r#"
import type { "foo-bar" as X } from "./x";
export async function main(di: any) {
  return di.resolve<X>();
}
"#;
    let result = compile(source, "/proj/src/main.ts", "{}", Index::default()).unwrap();
    let (code, _) = result_parts(&result);
    assert!(code.contains(r#""foo-bar" as foo_bar"#), "{code}");
    assert!(!code.contains("foo-bar as foo-bar"), "{code}");
    assert!(code.contains("resolve(foo_bar)"), "{code}");
    assert_parses(&code);
}

#[test]
fn has_di_create_requires_exact_symbol() {
    let source = r#"
import type { A } from "./typesA";
export class Service {
  static [Symbol.for("other.di.create")](container: any) {
    return new this(container);
  }
  constructor(private readonly a: A) {}
}
"#;
    let index = index_with(&[("/proj/src/typesA#A", vec!["/proj/src/typesA#AImpl"])]);
    let result = compile(source, "/proj/src/service.ts", "{}", index).unwrap();
    let (code, _) = result_parts(&result);
    assert_eq!(code.matches("silent.di.create").count(), 1, "{code}");
    assert!(code.contains("other.di.create"), "{code}");
}

#[test]
fn reserved_word_export_gets_valid_local_name() {
    let source = r#"
import type { "class" as X } from "./x";
export async function main(di: any) {
  return di.resolve<X>();
}
"#;
    let result = compile(source, "/proj/src/main.ts", "{}", Index::default()).unwrap();
    let (code, _) = result_parts(&result);
    assert!(code.contains("class as _class"), "{code}");
    assert!(code.contains("resolve(_class)"), "{code}");
    assert_parses(&code);
}

#[test]
fn parse_error_has_line_and_column_without_ast_debug() {
    let error = compile("const x = ;\n", "/proj/src/bad.ts", "{}", Index::default()).unwrap_err();
    assert!(error.contains("/proj/src/bad.ts:1:11"), "{error}");
    assert!(error.contains("ошибка разбора"), "{error}");
    assert!(!error.contains("Span {"), "{error}");
    assert!(!error.contains("SyntaxError"), "{error}");
}

#[test]
fn js_file_with_jsx_is_parsed_instead_of_regexp_error() {
    let result = compile(
        "export const el = <div title=\"x\">hi</div>;",
        "/proj/src/view.js",
        "{}",
        Index::default(),
    )
    .unwrap();
    let (code, _) = result_parts(&result);
    assert!(code.contains("_$templateHoles"), "{code}");
    assert!(!code.contains("Unterminated"), "{code}");
}

#[test]
fn select_value_survives_when_no_option_matches() {
    let result = compile(
        r#"export function view() {
  return <select value="missing"><option value="a">a</option></select>;
}"#,
        "/proj/src/view.tsx",
        "{}",
        Index::default(),
    )
    .unwrap();
    let (code, _) = result_parts(&result);
    assert!(code.contains(r#"value="missing""#), "{code}");
    assert!(!code.contains("selected"), "{code}");
}

#[test]
fn default_export_implementation_becomes_default_import() {
    let source = r#"
import type { Store } from "./types";
export class Service {
  constructor(private readonly store: Store) {}
}
"#;
    let index = index_with(&[("/proj/src/types#Store", vec!["/proj/src/mem#default"])]);
    let result = compile(source, "/proj/src/service.ts", "{}", index).unwrap();
    let (code, _) = result_parts(&result);
    assert!(code.contains(r#"from "./mem.js""#), "{code}");
    assert!(code.contains("import _default"), "{code}");
    assert!(code.contains("resolve(_default)"), "{code}");
    assert_parses(&code);
}

#[test]
fn generated_names_avoid_user_bindings() {
    let result = compile(
        r#"const _r$ = 1;
const _tmpl$0 = 2;
function C() { return <div>{value()}</div>; }
"#,
        "/proj/src/view.tsx",
        "{}",
        Index::default(),
    )
    .unwrap();
    let (code, _) = result_parts(&result);
    assert!(code.contains("const _tmpl$1 = _$templateHoles("), "{code}");
    assert!(code.contains("const _r$0 = _tmpl$1()"), "{code}");
    assert!(!code.contains("const _r$ = _tmpl$"), "{code}");
    assert_parses(&code);
}

fn temp_root(name: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("silent-scan-{name}-{stamp}"));
    fs::create_dir_all(root.join("src")).unwrap();
    root
}

#[test]
fn scan_indexes_default_and_class_expression_implementations() {
    let root = temp_root("di-classes");
    let src = root.join("src");
    fs::write(
        src.join("types.ts"),
        "export interface Store { get(): string }\n",
    )
    .unwrap();
    fs::write(
        src.join("default-impl.ts"),
        r#"import type { Store } from "./types";
export default class MemoryStore implements Store {
  get() { return ""; }
}
"#,
    )
    .unwrap();
    fs::write(
        src.join("expression-impl.ts"),
        r#"import type { Store } from "./types";
export const ApiStore = class implements Store {
  get() { return ""; }
};
"#,
    )
    .unwrap();

    let index = scan(&root);
    let token = format!("{}#Store", src.join("types").display());
    let implementations = index.interfaces.get(&token).cloned().unwrap_or_default();
    let expected_default = format!("{}#default", src.join("default-impl").display());
    let expected_expression = format!("{}#ApiStore", src.join("expression-impl").display());
    assert!(
        implementations.contains(&expected_default),
        "missing default implementation: {implementations:?}"
    );
    assert!(
        implementations.contains(&expected_expression),
        "missing class expression implementation: {implementations:?}"
    );

    let values: HashMap<String, Vec<String>> = index.values;
    assert!(
        values
            .get(&src.join("default-impl").display().to_string())
            .is_some_and(|names| names.iter().any(|name| name == "default")),
        "default export is missing from values: {values:?}"
    );

    fs::remove_dir_all(root).ok();
}
