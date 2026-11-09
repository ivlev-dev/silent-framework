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
    assert!(code.contains("<h1>title</h1><p><!--silent-hole-0--></p>"));
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
