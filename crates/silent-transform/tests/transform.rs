use silent_transform::{transform, Index};
use std::collections::HashMap;

fn run(source: &str, filename: &str, index: Index) -> String {
    let index_json = serde_json::to_string(&index).unwrap();
    let result = transform(source, filename, "{}", &index_json).unwrap();
    let value: serde_json::Value = serde_json::from_str(&result).unwrap();
    value["code"].as_str().unwrap().to_string()
}

fn template_holes_call(code: &str) -> &str {
    let start = code
        .find("_$templateHoles(")
        .expect("no templateHoles call");
    let rest = &code[start..];
    let end = rest.find(')').expect("unterminated templateHoles call");
    &rest[..end]
}

#[test]
fn compiles_jsx_template_and_dynamic_text() {
    let code = run(
        "const el = <div class=\"x\"><span>{name}</span></div>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(code.contains("_$templateHoles"));
    assert!(code.contains("silent-hole-0"));
    assert!(code.contains("_$insert"));
}

#[test]
fn hoists_templates_to_module_scope_and_deduplicates() {
    let code = run(
        "const a = <div><span>{name}</span></div>; const b = <div><span>{name}</span></div>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(code.contains("const _tmpl$0 = _$templateHoles("));
    assert_eq!(code.matches("const _tmpl$").count(), 1);
    assert_eq!(code.matches("_$templateHoles(").count(), 1);
    assert_eq!(code.matches("roots:").count(), 1);
    assert!(code.contains("_tmpl$0()"));
}

#[test]
fn hoists_templates_across_components_in_one_module() {
    let code = run(
        "function A({ x }: { x: string }) { return <li>{x}</li>; } function B({ y }: { y: string }) { return <li>{y}</li>; }",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert_eq!(code.matches("const _tmpl$").count(), 1, "{code}");
    assert_eq!(code.matches("<!--silent-hole-0-->").count(), 1, "{code}");
}

#[test]
fn merges_adjacent_static_text_children() {
    let code = run(
        "const el = <p>a{\"b\"}c{d}e</p>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(code.contains("<p>abc<!--silent-hole-0-->e</p>"), "{code}");
    assert_eq!(code.matches("_$insert(").count(), 1, "{code}");
}

#[test]
fn preserves_significant_spaces_around_expressions() {
    let code = run(
        "const el = <p>Привет, {name}!</p>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(
        code.contains("<p>Привет, <!--silent-hole-0-->!</p>"),
        "{code}"
    );
}

#[test]
fn keeps_inline_spaces_and_trims_indentation() {
    let inline = run(
        "const el = <p> hello </p>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(inline.contains("<p> hello </p>"), "{inline}");
    let multiline = run(
        "const el = <p>\n  hello\n  world\n</p>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(multiline.contains("<p>hello world</p>"), "{multiline}");
}

#[test]
fn passes_adoption_plan_to_template_holes() {
    let code = run(
        "const el = <div><span>{name}</span></div>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    let call = template_holes_call(&code);
    assert!(call.contains("\", {"), "missing plan argument: {call}");
    assert!(call.contains("roots: 1"), "missing roots: {call}");
    assert!(call.contains("path: ["), "missing path: {call}");
    assert!(call.contains("counts: ["), "missing counts: {call}");
}

#[test]
fn keeps_rcdata_marker_inside_opening_tag() {
    let code = run(
        "const el = <div><title>{name}</title></div>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(code.contains("<title data-silent-a-0"));
    assert!(!code.contains("title> data-silent-a-"));
    assert!(code.contains("_$prop"));
}

#[test]
fn emits_component_metadata() {
    let source = r#"
import type { CounterVM } from "./counter.vm";
function Loader() { return <span>loading</span>; }
export function Counter(this: { vm: CounterVM; preloader: typeof Loader }, props: { count: number }) {
  return <span class="count">{this.vm.count}</span>;
}
"#;
    let code = run(source, "/proj/src/counter.tsx", Index::default());
    assert!(code.contains("silent.view"));
    assert!(code.contains("CounterVM"));
    assert!(code.contains("Loader"));
    assert!(code.contains("moduleId"));
    assert!(code.contains("preloaderName"));
}

#[test]
fn injects_interface_implementation_into_constructor() {
    let source = r#"
import type { Store } from "./types";
export class Service {
  constructor(private readonly store: Store) {}
  read() { return this.store.get("x"); }
}
"#;
    let mut interfaces = HashMap::new();
    interfaces.insert(
        "/proj/src/types#Store".to_string(),
        vec!["/proj/src/memory.ts#MemoryStore".to_string()],
    );
    let index = Index {
        interfaces,
        values: HashMap::new(),
    };
    let code = run(source, "/proj/src/service.ts", index);
    assert!(code.contains("silent.di.create"));
    assert!(code.contains("MemoryStore"));
    assert!(code.contains("await container.resolve"));
}

#[test]
fn rewrites_resolve_type_argument() {
    let source = r#"
import type { Store } from "./types";
export async function main(di: any) {
  return await di.resolve<Store>();
}
"#;
    let mut interfaces = HashMap::new();
    interfaces.insert(
        "/proj/src/types#Store".to_string(),
        vec!["/proj/src/memory.ts#MemoryStore".to_string()],
    );
    let index = Index {
        interfaces,
        values: HashMap::new(),
    };
    let code = run(source, "/proj/src/main.ts", index);
    assert!(code.contains("di.resolve(MemoryStore)"));
}

#[test]
fn keeps_stage3_accessor_decorators_compilable() {
    let source = r#"
import { reactive } from "@ivlev-dev/silent-core";
class CounterVM {
  @reactive accessor count = 0;
}
"#;
    let code = run(source, "/proj/src/counter.vm.ts", Index::default());
    assert!(code.contains("reactive"));
    assert!(!code.contains("@reactive accessor"));
    assert!(code.contains("_apply_decs"));
}

#[test]
fn compiles_aliased_for_as_direct_list() {
    let code = run(
        "import { For as List, Index as ListIndex } from \"@ivlev-dev/silent-core\"; const a = <ul><List each={items}>{(item) => <li>{item}</li>}</List></ul>; const b = <div><ListIndex each={items}>{(item) => <span>{item()}</span>}</ListIndex></div>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert_eq!(code.matches("parent:").count(), 2, "{code}");
    assert_eq!(code.matches("marker:").count(), 2, "{code}");
}

#[test]
fn does_not_treat_foreign_for_component_as_list() {
    let code = run(
        "import { For } from \"./for-component\"; const a = <div><For each={items}>{(item) => <span>{item}</span>}</For></div>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(!code.contains("parent:"), "{code}");
}

#[test]
fn compiles_for_and_index_as_direct_lists() {
    let code = run(
        "import { For, Index } from \"@ivlev-dev/silent-core\"; const a = <ul><For each={items}>{(item) => <li>{item}</li>}</For></ul>; const b = <div><Index each={items}>{(item) => <span>{item()}</span>}</Index></div>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert_eq!(code.matches("parent:").count(), 2, "{code}");
    assert_eq!(code.matches("marker:").count(), 2, "{code}");
    assert!(code.contains("_$component(For"), "{code}");
    assert!(code.contains("_$component(Index"), "{code}");
    assert_eq!(code.matches("index: false").count(), 2, "{code}");
}

#[test]
fn keeps_index_accessor_when_children_use_it() {
    let code = run(
        "import { For } from \"@ivlev-dev/silent-core\"; const a = <ul><For each={items}>{(item, index) => <li>{item}{index()}</li>}</For></ul>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(!code.contains("index: false"), "{code}");
}

fn for_source(children: &str) -> String {
    format!(
        "import {{ For }} from \"@ivlev-dev/silent-core\"; const a = <ul><For each={{items}}>{children}</For></ul>;"
    )
}

#[test]
fn marks_static_rows_for_item_only_text() {
    let code = run(
        &for_source("{(row) => <li>{row.label}</li>}"),
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(code.contains("staticRows: true"), "{code}");
    assert!(code.contains("index: false"), "{code}");
}

#[test]
fn marks_static_rows_with_item_attributes_and_handler() {
    let code = run(
        &for_source(
            "{(row) => <li class={row.kind} data-id={row.id} onClick={() => remove(row.id)}>{row.label}</li>}",
        ),
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(code.contains("staticRows: true"), "{code}");
}

#[test]
fn marks_static_rows_across_allowed_expressions() {
    let code = run(
        &for_source(
            "{(row) => <li title={row.ready ? \"yes\" : `no-${row.id}`}>{!row.hidden && row.label}</li>}",
        ),
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(code.contains("staticRows: true"), "{code}");
}

#[test]
fn marks_static_rows_for_aliased_for() {
    let code = run(
        "import { For as List } from \"@ivlev-dev/silent-core\"; const a = <ul><List each={items}>{(row) => <li>{row.label}</li>}</List></ul>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(code.contains("staticRows: true"), "{code}");
}

#[test]
fn skips_static_rows_when_index_is_used() {
    let code = run(
        &for_source("{(row, index) => <li>{row.label}{index()}</li>}"),
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(!code.contains("staticRows"), "{code}");
}

#[test]
fn skips_static_rows_for_calls() {
    let code = run(
        &for_source("{(row) => <li>{row.label.toUpperCase()}</li>}"),
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(!code.contains("staticRows"), "{code}");
}

#[test]
fn skips_static_rows_for_outer_identifiers() {
    for children in [
        "{(row) => <li>{props.suffix}</li>}",
        "{(row) => <li>{format(row.label)}</li>}",
        "{(row) => <li>{row.label + label}</li>}",
    ] {
        let code = run(
            &for_source(children),
            "/proj/src/view.tsx",
            Index::default(),
        );
        assert!(!code.contains("staticRows"), "{children}: {code}");
    }
}

#[test]
fn skips_static_rows_for_nested_component() {
    let code = run(
        &for_source("{(row) => <li><Row value={row} /></li>}"),
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(!code.contains("staticRows"), "{code}");
}

#[test]
fn skips_static_rows_for_spread_and_ref() {
    for children in [
        "{(row) => <li {...row.attrs}>{row.label}</li>}",
        "{(row) => <li ref={row.element}>{row.label}</li>}",
        "{(row) => <li innerHTML={row.label}></li>}",
        "{(row) => <li bindValue={row.label}></li>}",
    ] {
        let code = run(
            &for_source(children),
            "/proj/src/view.tsx",
            Index::default(),
        );
        assert!(!code.contains("staticRows"), "{children}: {code}");
    }
}

#[test]
fn skips_static_rows_for_destructured_parameter() {
    let code = run(
        &for_source("{({ label }) => <li>{label}</li>}"),
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(!code.contains("staticRows"), "{code}");
}

#[test]
fn skips_static_rows_for_index_component() {
    let code = run(
        "import { Index } from \"@ivlev-dev/silent-core\"; const a = <div><Index each={items}>{(item) => <span>{item.label}</span>}</Index></div>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(!code.contains("staticRows"), "{code}");
}

#[test]
fn keeps_explicit_static_rows_prop() {
    let code = run(
        "import { For } from \"@ivlev-dev/silent-core\"; const a = <ul><For each={items} staticRows={false}>{(row) => <li>{row.label}</li>}</For></ul>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert_eq!(code.matches("staticRows").count(), 1, "{code}");
}
