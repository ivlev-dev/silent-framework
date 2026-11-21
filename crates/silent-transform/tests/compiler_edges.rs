use silent_transform::{transform, Index};

fn compile(source: &str, filename: &str, options: &str, index: Index) -> Result<String, String> {
    let index_json = serde_json::to_string(&index).unwrap();
    let result = transform(source, filename, options, &index_json)?;
    let value: serde_json::Value = serde_json::from_str(&result).unwrap();
    Ok(value["code"].as_str().unwrap().to_string())
}

fn run(source: &str, filename: &str) -> String {
    compile(source, filename, "{}", Index::default()).unwrap()
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

fn value_import_alias(code: &str, source: &str, export: &str) -> Option<String> {
    let marker = format!("{export} as ");
    code.lines()
        .find(|line| line.contains("import") && line.contains(source) && line.contains(&marker))
        .and_then(|line| {
            let rest = line.split(&marker).nth(1)?;
            let alias: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '$')
                .collect();
            (!alias.is_empty()).then_some(alias)
        })
}

#[test]
fn fragment_with_multiple_roots_and_dynamic_text() {
    let code = run(
        r#"function render() {
  const el = <> <h1>title</h1> <p>{text}</p> </>;
  return el;
}"#,
        "/proj/src/view.tsx",
    );
    assert!(code.contains("_$templateHoles"));
    assert!(code.contains("<h1>title</h1> <p><!--silent-hole-0--></p>"));
    assert!(code.contains("_$insert"));
}

#[test]
fn spread_attribute_uses_spread_helper() {
    let code = run(
        r#"function render() {
  const el = <div {...props} class="static" />;
  return el;
}"#,
        "/proj/src/view.tsx",
    );
    assert!(code.contains("_$spread"));
    assert!(code.contains("data-silent-a-0"));
    assert!(code.contains("class=\"static\""));
}

#[test]
fn svg_compiles_to_static_template() {
    let code = run(
        r#"function render() {
  const el = <svg viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>;
  return el;
}"#,
        "/proj/src/view.tsx",
    );
    assert!(code.contains("<svg"));
    assert!(code.contains(r#"<svg viewBox="0 0 10 10"><path d="M0 0 L10 10"></path></svg>"#));
    assert!(!code.contains("_$attr"));
    assert!(!code.contains("_$spread"));
}

#[test]
fn component_children_become_getter() {
    let source = r#"function view() {
  const el = <Comp>{value}</Comp>;
  return el;
}"#;
    let code = compile(source, "/proj/src/view.tsx", "{}", Index::default()).unwrap();
    assert!(code.contains("_$component"));
    assert!(code.contains("get children ()"));
    assert!(!code.contains("children:"));
}

#[test]
fn member_expression_component() {
    let code = run(
        r#"import * as UI from "./ui";
function view() {
  const el = <UI.Button text="x" />;
  return el;
}"#,
        "/proj/src/view.tsx",
    );
    assert!(code.contains("_$component(UI.Button"));
    assert!(code.contains("text: \"x\""));
}

#[test]
fn for_component_compiles_with_each_and_children_getters() {
    let code = run(
        r#"function list() {
  const el = <For each={items}>{(item) => <li>{item}</li>}</For>;
  return el;
}"#,
        "/proj/src/view.tsx",
    );
    assert!(code.contains("_$component(For"));
    assert!(code.contains("get each ()"));
    assert!(code.contains("get children ()"));
    assert!(code.contains("<li><!--silent-hole-0--></li>"));
}

#[test]
fn show_component_compiles_when_fallback_and_children() {
    let code = run(
        r#"function card() {
  const el = <Show when={ok} fallback={<b>no</b>}>yes</Show>;
  return el;
}"#,
        "/proj/src/view.tsx",
    );
    assert!(code.contains("_$component(Show"));
    assert!(code.contains("get when ()"));
    assert!(code.contains("get fallback ()"));
    assert!(code.contains("<b>no</b>"));
    assert!(code.contains("get children ()"));
}

#[test]
fn require_preloader_fails_without_preloader() {
    let source = r#"
import type { CounterVM } from "./counter.vm";
export function Counter(this: { vm: CounterVM }, props: object) {
  return <span>loading</span>;
}
"#;
    let error = compile(
        source,
        "/proj/src/counter.tsx",
        r#"{"requirePreloader":true}"#,
        Index::default(),
    )
    .unwrap_err();
    assert!(
        error.contains("обязателен preloader"),
        "unexpected error: {error}"
    );
    assert!(error.contains("Counter"));
}

#[test]
fn require_preloader_succeeds_with_preloader() {
    let source = r#"
import type { CounterVM } from "./counter.vm";
function Loader() { return <span>loading</span>; }
export function Counter(this: { vm: CounterVM; preloader: typeof Loader }, props: object) {
  return <span>loading</span>;
}
"#;
    let code = compile(
        source,
        "/proj/src/counter.tsx",
        r#"{"requirePreloader":true}"#,
        Index::default(),
    )
    .unwrap();
    assert!(code.contains("preloader"));
    assert!(code.contains("Loader"));
    assert!(code.contains("CounterVM"));
}

#[test]
fn resolves_type_only_class_with_empty_index() {
    let source = r#"
import type { Store } from "./types";
export async function main(di: any) {
  return await di.resolve<Store>();
}
"#;
    let code = run(source, "/proj/src/main.ts");
    assert!(
        code.lines()
            .any(|line| line.contains("import") && line.contains("./types")),
        "no value import of ./types: {code}"
    );
    let alias = value_import_alias(&code, "./types", "Store").expect("no alias for Store");
    assert!(
        code.contains(&format!("resolve({alias})")),
        "unexpected code: {code}"
    );
    assert!(!code.contains("<Store>"));
}

#[test]
fn resolves_interface_with_multiple_implementations_errors() {
    let source = r#"
interface Store { get(): string }
export async function main(di: any) {
  return await di.resolve<Store>();
}
"#;
    let index = index_with(&[(
        "/proj/src/main#Store",
        vec![
            "/proj/src/memory.ts#MemoryStore",
            "/proj/src/memory.ts#RedisStore",
        ],
    )]);
    let error = compile(source, "/proj/src/main.ts", "{}", index).unwrap_err();
    assert!(
        error.contains("несколько реализаций"),
        "unexpected error: {error}"
    );
    assert!(error.contains("MemoryStore"));
    assert!(error.contains("RedisStore"));
}

#[test]
fn constructor_receives_all_implementations_in_order() {
    let source = r#"
import type { A } from "./typesA";
import type { B } from "./typesB";
export class Service {
  constructor(private readonly a: A, public b: B) {}
  work() { return this.a.x() + this.b.y(); }
}
"#;
    let index = index_with(&[
        ("/proj/src/typesA#A", vec!["/proj/src/typesA#AImpl"]),
        ("/proj/src/typesB#B", vec!["/proj/src/typesB#BImpl"]),
    ]);
    let code = compile(source, "/proj/src/service.ts", "{}", index).unwrap();
    assert!(code.contains("silent.di.create"));
    let first = code
        .find("resolve(AImpl)")
        .expect("missing AImpl dependency");
    let second = code
        .find("resolve(BImpl)")
        .expect("missing BImpl dependency");
    assert!(first < second, "dependency order is wrong: {code}");
    assert_eq!(
        code.matches("silent.di.create").count(),
        1,
        "unexpected code: {code}"
    );
}

#[test]
fn di_create_not_duplicated() {
    let source = r#"
import type { A } from "./typesA";
export class Service {
  static [Symbol.for("silent.di.create")](container: any) {
    return new this(container);
  }
  constructor(private readonly a: A) {}
}
"#;
    let index = index_with(&[("/proj/src/typesA#A", vec!["/proj/src/typesA#AImpl"])]);
    let code = compile(source, "/proj/src/service.ts", "{}", index).unwrap();
    assert_eq!(
        code.matches("silent.di.create").count(),
        1,
        "unexpected code: {code}"
    );
}

#[test]
fn class_without_constructor_gets_no_di_factory() {
    let source = r#"
import type { A } from "./typesA";
export class Plain {
  value(): number { return 1; }
}
"#;
    let code = run(source, "/proj/src/plain.ts");
    assert!(!code.contains("silent.di.create"));
}

#[test]
fn type_only_imports_become_value_imports() {
    let source = r#"
import type { X } from "./x";
import { type Y } from "./y";
export async function main(di: any) {
  return await di.resolve<X>() + await di.resolve<Y>();
}
"#;
    let code = run(source, "/proj/src/main.ts");
    let x_alias = value_import_alias(&code, "./x", "X").expect("no alias for X");
    let y_alias = value_import_alias(&code, "./y", "Y").expect("no alias for Y");
    assert!(
        code.contains(&format!("resolve({x_alias})")),
        "unexpected code: {code}"
    );
    assert!(
        code.contains(&format!("resolve({y_alias})")),
        "unexpected code: {code}"
    );
    assert!(!code.contains("<X>"));
    assert!(!code.contains("<Y>"));
}

#[test]
fn hmr_on_emits_hot_accept_and_module_id() {
    let source = r#"
import type { CounterVM } from "./counter.vm";
export function Counter(this: { vm: CounterVM }, props: object) {
  return <span>hi</span>;
}
"#;
    let code = compile(
        source,
        "/proj/src/counter.tsx",
        r#"{"hmr":true}"#,
        Index::default(),
    )
    .unwrap();
    assert!(code.contains("import.meta.hot"), "unexpected code: {code}");
    assert!(code.contains("import.meta.hot.accept"));
    assert!(code.contains("/proj/src/counter"));
    assert!(code.contains("_hmrUpdate"));
}

#[test]
fn hmr_off_does_not_emit_hmr_code() {
    let source = r#"
import type { CounterVM } from "./counter.vm";
export function Counter(this: { vm: CounterVM }, props: object) {
  return <span>hi</span>;
}
"#;
    let code = compile(source, "/proj/src/counter.tsx", "{}", Index::default()).unwrap();
    assert!(!code.contains("import.meta.hot"));
    assert!(!code.contains("_hmrUpdate"));
}

#[test]
fn textarea_dynamic_child_uses_value_binding() {
    let code = run(
        r#"export function Form(props: { value: string }) {
  return <textarea class="field">{props.value}</textarea>;
}
"#,
        "/proj/src/form.tsx",
    );
    assert!(
        !code.contains("<textarea class=\"field\"><!--silent-hole-0-->"),
        "textarea must not contain hole comments: {code}"
    );
    assert!(
        code.contains("data-silent-text"),
        "missing text marker: {code}"
    );
    assert!(code.contains("\"value\""), "missing value binding: {code}");
}

#[test]
fn textarea_static_text_stays_in_markup() {
    let code = run(
        r#"export function Form() {
  return <textarea>hello</textarea>;
}
"#,
        "/proj/src/form.tsx",
    );
    assert!(code.contains("<textarea>hello</textarea>"), "code: {code}");
    assert!(!code.contains("data-silent-text"), "code: {code}");
}

#[test]
fn title_dynamic_text_uses_text_content_binding() {
    let code = run(
        r#"export function Page(props: { name: string }) {
  return <title>Hello {props.name}</title>;
}
"#,
        "/proj/src/page.tsx",
    );
    assert!(
        !code.contains("<title><!--silent-hole-0-->"),
        "title must not contain hole comments: {code}"
    );
    assert!(
        code.contains("data-silent-text"),
        "missing text marker: {code}"
    );
    assert!(
        code.contains("\"textContent\""),
        "missing textContent binding: {code}"
    );
    assert!(
        code.contains("\"Hello \""),
        "space must be preserved: {code}"
    );
}

#[test]
fn title_static_text_stays_in_markup() {
    let code = run(
        r#"export function Page() {
  return <title>My Blog</title>;
}
"#,
        "/proj/src/page.tsx",
    );
    assert!(code.contains("<title>My Blog</title>"), "code: {code}");
    assert!(!code.contains("data-silent-text"), "code: {code}");
}

#[test]
fn implementation_import_keeps_user_extension() {
    let source = r#"
import type { Store } from "./store.js";
export class Service {
  constructor(private readonly store: Store) {}
}
"#;
    let index = index_with(&[(
        "/proj/src/store#Store",
        vec!["/proj/src/memory-store#MemoryStore"],
    )]);
    let code = compile(source, "/proj/src/service.ts", "{}", index).unwrap();
    assert!(
        code.contains("from \"./memory-store.js\""),
        "unexpected specifier: {code}"
    );
}

#[test]
fn implementation_import_without_extension_gets_js() {
    let source = r#"
import type { Store } from "./store";
export class Service {
  constructor(private readonly store: Store) {}
}
"#;
    let index = index_with(&[(
        "/proj/src/store#Store",
        vec!["/proj/src/memory-store#MemoryStore"],
    )]);
    let code = compile(source, "/proj/src/service.ts", "{}", index).unwrap();
    assert!(
        code.contains("from \"./memory-store.js\""),
        "unexpected specifier: {code}"
    );
}

#[test]
fn typeof_import_uses_relative_specifier() {
    let source = r#"
export async function main(di: any) {
  return di.resolve<typeof import("./m").Money>();
}
"#;
    let code = run(source, "/proj/src/main.ts");
    assert!(
        code.contains("from \"./m.js\""),
        "unexpected specifier: {code}"
    );
    assert!(
        !code.contains("/proj/src/m\""),
        "absolute path leaked into import: {code}"
    );
}

#[test]
fn aliased_implementation_import_stays_relative() {
    let source = r#"
import type { Store } from "@/store";
export class Service {
  constructor(private readonly store: Store) {}
}
"#;
    let index = index_with(&[(
        "/proj/src/store#Store",
        vec!["/proj/src/memory-store#MemoryStore"],
    )]);
    let options = r#"{"aliases":[{"find":"@/*","replacement":"/proj/src/*"}]}"#;
    let code = compile(source, "/proj/src/service.ts", options, index).unwrap();
    assert!(
        code.contains("from \"./memory-store.js\""),
        "unexpected specifier: {code}"
    );
    assert!(
        !code.contains("/proj/src/memory-store\""),
        "absolute path leaked into import: {code}"
    );
}

#[test]
fn promise_resolve_argument_is_preserved() {
    let source = r#"
class Foo {}
export function main() {
  const value = 1;
  return Promise.resolve<Foo>(value);
}
"#;
    let code = run(source, "/proj/src/main.ts");
    assert!(code.contains("Promise.resolve(value)"), "{code}");
    assert!(!code.contains("Promise.resolve(Foo)"), "{code}");
}

#[test]
fn resolve_with_argument_keeps_argument() {
    let source = r#"
import type { Store } from "./types";
export async function main(di: any, override: any) {
  return di.resolve<Store>(override);
}
"#;
    let code = run(source, "/proj/src/main.ts");
    assert!(code.contains("di.resolve(override)"), "{code}");
    assert!(!code.contains("di.resolve(Store"), "{code}");
}

#[test]
fn unresolved_resolve_type_reports_error() {
    let source = r#"
export async function main(di: any) {
  return di.resolve<A | B>();
}
"#;
    let error = compile(source, "/proj/src/main.ts", "{}", Index::default()).unwrap_err();
    assert!(
        error.contains("не удалось разрешить тип"),
        "unexpected error: {error}"
    );
    assert!(error.contains("resolve"), "unexpected error: {error}");
}

fn compile_with_diagnostics(source: &str, filename: &str) -> (String, Vec<String>) {
    let index_json = serde_json::to_string(&Index::default()).unwrap();
    let result = transform(source, filename, "{}", &index_json).unwrap();
    let value: serde_json::Value = serde_json::from_str(&result).unwrap();
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

#[test]
fn jsx_children_take_priority_over_children_attribute() {
    let (code, diagnostics) = compile_with_diagnostics(
        r#"function view(x: any) { return <Comp children={x}>{x}</Comp>; }"#,
        "/proj/src/view.tsx",
    );
    assert_eq!(code.matches("get children").count(), 1, "{code}");
    assert!(!code.contains("children:"), "{code}");
    assert!(
        diagnostics.iter().any(|item| item.contains("children")),
        "missing diagnostic: {diagnostics:?}"
    );
}

#[test]
fn bind_value_requires_stable_reference() {
    let error = compile(
        r#"function render(f: any) { return <input bindValue={f().field} />; }"#,
        "/proj/src/view.tsx",
        "{}",
        Index::default(),
    )
    .unwrap_err();
    assert!(
        error.contains("bindValue требует ссылку (identifier/member от стабильного объекта)"),
        "unexpected error: {error}"
    );
}

#[test]
fn void_tag_list_matches_server_serializer() {
    let serializer = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/server/src/dom/serializer.ts"
    ));
    let start = serializer
        .find("const VOID_ELEMENTS")
        .expect("VOID_ELEMENTS not found in serializer");
    let end = serializer[start..]
        .find("]);")
        .map(|offset| start + offset)
        .expect("end of VOID_ELEMENTS not found in serializer");
    let tags: Vec<&str> = serializer[start..end]
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with('"'))
        .map(|line| line.trim_matches(|character| character == '"' || character == ','))
        .collect();
    assert!(tags.len() >= 14, "serializer list was not parsed: {tags:?}");
    for tag in tags {
        let code = run(
            &format!("const el = <{tag} name=\"x\" />;"),
            "/proj/src/view.tsx",
        );
        assert!(code.contains(&format!("<{tag} ")), "{tag}: {code}");
        assert!(
            !code.contains(&format!("</{tag}>")),
            "{tag} must not have a closing tag: {code}"
        );
    }
}

#[test]
fn void_tag_with_children_fails() {
    let error = compile(
        r#"function view() { return <img>text</img>; }"#,
        "/proj/src/view.tsx",
        "{}",
        Index::default(),
    )
    .unwrap_err();
    assert!(error.contains("<img>"), "unexpected error: {error}");
    assert!(
        error.contains("не может иметь дочерних узлов"),
        "unexpected error: {error}"
    );
}

#[test]
fn unresolvable_constructor_dependency_reports_error() {
    let error = compile(
        r#"export class Service { constructor(private readonly dep: Missing) {} }"#,
        "/proj/src/service.ts",
        "{}",
        Index::default(),
    )
    .unwrap_err();
    assert!(error.contains("Service"), "unexpected error: {error}");
    assert!(error.contains("dep"), "unexpected error: {error}");
    assert!(
        error.contains("не удалось разрешить тип параметра конструктора"),
        "unexpected error: {error}"
    );
}

#[test]
fn constructor_parameter_without_type_skips_di() {
    let code = run(
        r#"export class Service { constructor(private readonly dep) {} }"#,
        "/proj/src/service.ts",
    );
    assert!(code.contains("class Service"), "{code}");
    assert!(!code.contains("silent.di.create"), "{code}");
}

#[test]
fn malformed_implementation_token_reports_error() {
    let source = r#"
import type { Store } from "./types";
export class Service {
  constructor(private readonly store: Store) {}
}
"#;
    let index = index_with(&[("/proj/src/types#Store", vec!["broken-token"])]);
    let error = compile(source, "/proj/src/service.ts", "{}", index).unwrap_err();
    assert!(
        error.contains("некорректный токен реализации"),
        "unexpected error: {error}"
    );
}

#[test]
fn generic_class_skips_di_without_error() {
    let source = r#"
export class ComponentContext<P = unknown> {
  constructor(props: P, container: Container, signal: SignalSource) {}
}
"#;
    let (code, diagnostics) = compile_with_diagnostics(source, "/proj/src/component-context.ts");
    assert!(code.contains("class ComponentContext"), "{code}");
    assert!(!code.contains("silent.di.create"), "{code}");
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
}

#[test]
fn class_inside_generic_function_skips_di_without_error() {
    let source = r#"
export function make<T>() {
  return class Service {
    constructor(private readonly value: T) {}
  };
}
"#;
    let (code, diagnostics) = compile_with_diagnostics(source, "/proj/src/service.ts");
    assert!(!code.contains("silent.di.create"), "{code}");
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
}
