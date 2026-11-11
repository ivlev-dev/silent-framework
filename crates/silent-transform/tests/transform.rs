use silent_transform::{transform, Index};
use std::collections::HashMap;

fn run(source: &str, filename: &str, index: Index) -> String {
    let index_json = serde_json::to_string(&index).unwrap();
    let result = transform(source, filename, "{}", &index_json).unwrap();
    let value: serde_json::Value = serde_json::from_str(&result).unwrap();
    value["code"].as_str().unwrap().to_string()
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
    assert!(code.contains("_tmpl$0()"));
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
