use silent_transform::{transform, Index};
use std::collections::HashMap;

fn run(source: &str, filename: &str, index: Index) -> String {
    run_with(source, filename, "{}", index)
}

fn run_with(source: &str, filename: &str, options: &str, index: Index) -> String {
    let index_json = serde_json::to_string(&index).unwrap();
    let result = transform(source, filename, options, &index_json).unwrap();
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
fn skips_static_rows_with_event_handler() {
    let code = run(
        &for_source(
            "{(row) => <li class={row.kind} data-id={row.id} onClick={() => remove(row.id)}>{row.label}</li>}",
        ),
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(!code.contains("staticRows: true"), "{code}");
}

#[test]
fn marks_static_rows_with_item_attributes_without_handler() {
    let code = run(
        &for_source("{(row) => <li class={row.kind} data-id={row.id}>{row.label}</li>}"),
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

#[test]
fn marks_static_rows_for_optional_chaining() {
    for children in [
        "{(row) => <li>{row?.label}</li>}",
        "{(row) => <li>{row.a?.b}</li>}",
        "{(row) => <li>{row?.a.b}</li>}",
        "{(row) => <li title={row?.label}></li>}",
    ] {
        let code = run(
            &for_source(children),
            "/proj/src/view.tsx",
            Index::default(),
        );
        assert!(code.contains("staticRows: true"), "{children}: {code}");
    }
}

#[test]
fn marks_static_rows_ignoring_jsx_comments() {
    let code = run(
        &for_source("{/* row */}{(row) => <li>{row.label}</li>}"),
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(code.contains("staticRows: true"), "{code}");
}

#[test]
fn marks_static_rows_for_function_expression_row() {
    for children in [
        "{function (row) { return <li>{row.label}</li>; }}",
        "{(row) => { return <li>{row.label}</li>; }}",
        "{(row: Row) => <li>{row.label}</li>}",
        "{<T,>(row: T) => <li>{row}</li>}",
    ] {
        let code = run(
            &for_source(children),
            "/proj/src/view.tsx",
            Index::default(),
        );
        assert!(code.contains("staticRows: true"), "{children}: {code}");
    }
}

#[test]
fn marks_static_rows_for_namespaced_and_dashed_attributes() {
    let code = run(
        &for_source(
            "{(row) => <a xlink:href={row.href} data-row-id={row.id} aria-label=\"row\">{row.label}</a>}",
        ),
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(code.contains("staticRows: true"), "{code}");
}

#[test]
fn marks_static_rows_for_fragment_and_multiple_children() {
    for children in [
        "{(row) => <><li>{row.label}</li><li>{row.id}</li></>}",
        "{(row) => <li>{row.label}{row.id}</li>}",
        "{(row) => <li>{row.ok ? <b>{row.x}</b> : <i>{row.y}</i>}</li>}",
        "{(row) => <li>\n  {row.label}\n</li>}",
    ] {
        let code = run(
            &for_source(children),
            "/proj/src/view.tsx",
            Index::default(),
        );
        assert!(code.contains("staticRows: true"), "{children}: {code}");
    }
}

#[test]
fn marks_static_rows_for_object_and_array_attribute_values() {
    for children in [
        "{(row) => <li data-row={{ id: row.id, tags: [row.kind, \"x\"] }}></li>}",
        "{(row) => <li data-row={{ id: row.id, nested: { ok: true } }}></li>}",
        "{(row) => <li style={`--row: ${row.id}`}></li>}",
    ] {
        let code = run(
            &for_source(children),
            "/proj/src/view.tsx",
            Index::default(),
        );
        assert!(code.contains("staticRows: true"), "{children}: {code}");
    }
}

#[test]
fn marks_static_rows_for_lowercase_on_attribute_values() {
    for children in [
        "{(row) => <li onclick={row.label}></li>}",
        "{(row) => <li on={row.label}></li>}",
        "{(row) => <li binding={row.label}></li>}",
    ] {
        let code = run(
            &for_source(children),
            "/proj/src/view.tsx",
            Index::default(),
        );
        assert!(code.contains("staticRows: true"), "{children}: {code}");
    }
}

#[test]
fn marks_static_rows_for_ts_wrappers() {
    for children in [
        "{(row) => <li>{(row.label as string)}</li>}",
        "{(row) => <li>{(row.label satisfies string)}</li>}",
        "{(row) => <li>{row.label!}</li>}",
        "{(row) => <li>{`${row.label}`}</li>}",
        "{(row) => <li>{(row.label)}</li>}",
        "{(row) => <li>{row.a ?? row.b}</li>}",
    ] {
        let code = run(
            &for_source(children),
            "/proj/src/view.tsx",
            Index::default(),
        );
        assert!(code.contains("staticRows: true"), "{children}: {code}");
    }
}

#[test]
fn skips_static_rows_for_event_lookalike_attributes() {
    for children in [
        "{(row) => <li one={flag}></li>}",
        "{(row) => <li only={flag}></li>}",
        "{(row) => <li on={flag}></li>}",
        "{(row) => <li binding={flag}></li>}",
        "{(row) => <li bindings={flag}></li>}",
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
fn skips_static_rows_for_shadowed_item() {
    for children in [
        "{(row) => { const row2 = external; return <li>{row2.x}</li>; }}",
        "{(row) => { const row = external; return <li>{row.x}</li>; }}",
        "{(row) => { let row = external; return <li>{row}</li>; }}",
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
fn skips_static_rows_for_item_parameters_that_are_not_plain() {
    for children in [
        "{(...rows) => <li>{rows[0]}</li>}",
        "{(row = fallback) => <li>{row.label}</li>}",
        "{(row, second) => <li>{row.label}</li>}",
        "{(row, _second) => <li>{row.label}</li>}",
        "{function (row) { return <li>{arguments[0].label}</li>; }}",
        "{async (row) => <li>{row.label}</li>}",
        "{function* (row) { return <li>{row.label}</li>; }}",
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
fn skips_static_rows_for_mutating_and_control_flow_expressions() {
    for children in [
        "{(row) => <li>{row.x = 1}</li>}",
        "{(row) => <li>{row.x++}</li>}",
        "{(row) => <li>{delete row.x}</li>}",
        "{(row) => <li>{row.x in row.y}</li>}",
        "{(row) => <li>{row.x instanceof row.y}</li>}",
        "{(row) => <li>{(row.x, row.y)}</li>}",
        "{(row) => <li>{new Date(row.x)}</li>}",
        "{async (row) => <li>{await row.x}</li>}",
        "{(row) => <li>{row?.get?.()}</li>}",
        "{(row) => <li>{row?.()}</li>}",
        "{(row) => <li>{row.x.toString()}</li>}",
        "{(row) => <li>{String(row.x)}</li>}",
        "{(row) => <li>{Math.max(row.x, 1)}</li>}",
        "{(row) => <li>{((value) => value)(row.x)}</li>}",
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
fn skips_static_rows_for_object_features() {
    for children in [
        "{(row) => <li data-row={{ get id() { return row.id; } }}></li>}",
        "{(row) => <li data-row={{ set id(value) { row.id = value; } }}></li>}",
        "{(row) => <li data-row={{ id() { return row.id; } }}></li>}",
        "{(row) => <li data-row={{ [flag]: row.id }}></li>}",
        "{(row) => <li data-row={{ ...row.meta }}></li>}",
        "{(row) => <li data-row={[row.id, ...row.list]}></li>}",
        "{(row) => <li>{...row.parts}</li>}",
        "{(row) => <li>{row[flag]}</li>}",
        "{(row) => <li>{row?.[flag]}</li>}",
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
fn skips_static_rows_for_component_elements() {
    for children in [
        "{(row) => <li><Row value={row} /></li>}",
        "{(row) => <li><ui.Row value={row} /></li>}",
        "{(row) => <li><svg:path d={row.d} /></li>}",
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
fn skips_static_rows_for_dangerous_html_and_bind_attributes() {
    for children in [
        "{(row) => <li dangerouslySetInnerHTML={{ __html: row.html }}></li>}",
        "{(row) => <li innerHTML={row.html}></li>}",
        "{(row) => <li bindValue={row.value}></li>}",
        "{(row) => <li bindChecked={row.checked}></li>}",
        "{(row) => <li prop:value={row.value}></li>}",
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
fn skips_static_rows_for_foreign_for_component() {
    let code = run(
        "import { For } from \"./custom-for\"; const a = <ul><For each={items}>{(row) => <li>{row.label}</li>}</For></ul>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(!code.contains("staticRows"), "{code}");
}

#[test]
fn skips_static_rows_when_for_props_are_spread() {
    let code = run(
        "import { For } from \"@ivlev-dev/silent-core\"; const a = <ul><For {...p} each={items}>{(row) => <li>{row.label}</li>}</For></ul>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(!code.contains("staticRows"), "{code}");
    assert!(!code.contains("index: false"), "{code}");
}

#[test]
fn keeps_dynamic_static_rows_prop() {
    let code = run(
        "import { For } from \"@ivlev-dev/silent-core\"; const a = <ul><For each={items} staticRows={flag}>{(row) => <li>{row.label}</li>}</For></ul>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(!code.contains("staticRows: true"), "{code}");
    assert_eq!(code.matches("staticRows").count(), 1, "{code}");
}

#[test]
fn keeps_dynamic_index_prop() {
    let code = run(
        "import { For } from \"@ivlev-dev/silent-core\"; const a = <ul><For each={items} index={flag}>{(row) => <li>{row.label}</li>}</For></ul>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(!code.contains("index: false"), "{code}");
    assert_eq!(code.matches("index").count(), 1, "{code}");
}

#[test]
fn skips_adoption_plan_when_hydration_disabled() {
    let source = "import { value } from \"./state\"; const a = <div>{value()}</div>;";
    let code = run_with(
        source,
        "/proj/src/view.tsx",
        "{\"hydrate\":false}",
        Index::default(),
    );
    assert!(!code.contains("holes:"), "{code}");
    let default_code = run(source, "/proj/src/view.tsx", Index::default());
    assert!(default_code.contains("holes:"), "{default_code}");
}

#[test]
fn skips_static_rows_when_hydration_disabled() {
    let code = run_with(
        &for_source("{(row) => <li>{row.label}</li>}"),
        "/proj/src/view.tsx",
        "{\"hydrate\":false}",
        Index::default(),
    );
    assert!(!code.contains("staticRows"), "{code}");
    assert!(code.contains("index: false"), "{code}");
}

#[test]
fn emits_static_marker_for_static_template_without_hydration() {
    let code = run_with(
        "const el = <section class=\"static\"><h2>Заголовок</h2><p>Текст</p></section>;",
        "/proj/src/view.tsx",
        "{\"hydrate\":false}",
        Index::default(),
    );
    assert!(code.contains("_$templateHoles('<section"), "{code}");
    assert!(
        code.contains(", false),") || code.contains(", false);"),
        "{code}"
    );
    assert!(!code.contains("holes:"), "{code}");
}

#[test]
fn emits_static_marker_for_static_svg_template_without_hydration() {
    let code = run_with(
        "const el = <svg viewBox=\"0 0 10 10\"><path d=\"M0 0\" /></svg>;",
        "/proj/src/view.tsx",
        "{\"hydrate\":false}",
        Index::default(),
    );
    assert!(code.contains("_$templateHoles('<svg"), "{code}");
    assert!(code.contains(", false)"), "{code}");
}

#[test]
fn keeps_marker_scan_for_dynamic_template_without_hydration() {
    let code = run_with(
        "const el = <div title={label}>{value}<textarea class=\"field\">{value}</textarea></div>;",
        "/proj/src/view.tsx",
        "{\"hydrate\":false}",
        Index::default(),
    );
    assert!(code.contains("_$templateHoles('<div"), "{code}");
    assert!(!code.contains("false"), "{code}");
    assert!(!code.contains("holes:"), "{code}");
}

#[test]
fn emits_static_marker_for_refused_static_template_with_hydration() {
    for source in [
        "const el = <p>hello</p>;",
        "const el = <a href=\"/x\">link</a>;",
        "const el = <div><title>t</title></div>;",
        "const el = <div><meta name=\"description\" content=\"x\" /></div>;",
        "const el = <table><tbody><tr><td>x</td></tr></tbody></table>;",
    ] {
        let code = run(source, "/proj/src/view.tsx", Index::default());
        assert!(code.contains("_$templateHoles("), "{source}: {code}");
        assert!(code.contains(", false)"), "{source}: {code}");
        assert!(!code.contains("holes:"), "{source}: {code}");
    }
}

#[test]
fn keeps_no_plan_for_dynamic_refused_template_with_hydration() {
    let code = run(
        "const el = <p>{x}</p>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(code.contains("_$templateHoles("), "{code}");
    assert!(code.contains("<!--silent-hole-0-->"), "{code}");
    assert!(!code.contains(", false"), "{code}");
    assert!(!code.contains("holes:"), "{code}");
}

#[test]
fn keeps_static_template_plan_with_hydration() {
    let code = run(
        "const el = <section class=\"static\"><h2>Заголовок</h2></section>;",
        "/proj/src/view.tsx",
        Index::default(),
    );
    assert!(code.contains("holes: []"), "{code}");
    assert!(!code.contains(", false"), "{code}");
}
