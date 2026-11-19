use serde_json::{json, Value};
use silent_transform::{transform, Index};

fn run(source: &str, options: Value) -> String {
    let options_json = serde_json::to_string(&options).unwrap();
    let index_json = serde_json::to_string(&Index::default()).unwrap();
    let result = transform(source, "/proj/src/view.tsx", &options_json, &index_json).unwrap();
    let value: Value = serde_json::from_str(&result).unwrap();
    value["code"].as_str().unwrap().to_string()
}

#[test]
fn ssr_compiles_template_to_string_parts() {
    let code = run(
        r#"const el = <div class="x"><span>{name}</span></div>;"#,
        json!({ "ssr": true }),
    );
    assert!(code.contains("_$ssrRaw("), "{code}");
    assert!(code.contains("_$ssrValue("), "{code}");
    assert!(!code.contains("_$templateHoles("), "{code}");
    assert!(!code.contains("_$insert("), "{code}");
    assert!(code.contains("<!--silent-hole-0--></span></div>"), "{code}");
}

#[test]
fn ssr_compiles_list_items_and_fragments() {
    let code = run(
        r#"const el = <><li>{a}</li><li>{b}</li></>;"#,
        json!({ "ssr": true }),
    );
    assert!(code.contains("_$ssrRaw("), "{code}");
    assert!(code.contains("<!--silent-hole-0--></li><li>"), "{code}");
    assert!(code.contains("silent-hole-1"), "{code}");
}

#[test]
fn ssr_compiles_static_template_without_values() {
    let code = run(
        r#"const el = <div class="x">static</div>;"#,
        json!({ "ssr": true }),
    );
    assert!(code.contains("_$ssrRaw("), "{code}");
    assert!(!code.contains("_$ssrValue("), "{code}");
}

#[test]
fn ssr_skips_events_and_refs() {
    let code = run(
        r#"const el = <button type="button" onClick={() => run()}>{label}</button>;"#,
        json!({ "ssr": true }),
    );
    assert!(code.contains("_$ssrRaw("), "{code}");
    assert!(code.contains("data-silent-a-0"), "{code}");
    assert!(!code.contains("_$insert("), "{code}");
}

#[test]
fn ssr_falls_back_for_dynamic_attributes() {
    let code = run(
        r#"const el = <div class={active ? "a" : "b"}>{label}</div>;"#,
        json!({ "ssr": true }),
    );
    assert!(code.contains("_$templateHoles("), "{code}");
    assert!(!code.contains("_$ssrRaw("), "{code}");
}

#[test]
fn ssr_falls_back_for_metadata() {
    let code = run(
        r#"const el = <div><title>{name}</title></div>;"#,
        json!({ "ssr": true }),
    );
    assert!(code.contains("_$templateHoles("), "{code}");
    assert!(!code.contains("_$ssrRaw("), "{code}");
}

#[test]
fn ssr_fallback_keeps_lists_inside_holes() {
    let code = run(
        r#"import { For, Index } from "@ivlev-dev/silent-core";
const el = <div class={active}>{label}<For each={items}>{(item) => <li>{item}</li>}</For><Index each={items}>{(item) => <b>{item()}</b>}</Index></div>;"#,
        json!({ "ssr": true }),
    );
    assert!(!code.contains("parent:"), "{code}");
    assert!(!code.contains("marker:"), "{code}");
    assert!(code.contains("_$component(For"), "{code}");
    assert!(code.contains("_$component(Index"), "{code}");
    assert_eq!(code.matches("_$insert(").count(), 3, "{code}");
}

#[test]
fn ssr_fallback_keeps_for_inside_metadata_template() {
    let code = run(
        r#"import { For } from "@ivlev-dev/silent-core";
const el = <div><title>Список</title><For each={items}>{(item) => <li>{item}</li>}</For></div>;"#,
        json!({ "ssr": true }),
    );
    assert!(!code.contains("parent:"), "{code}");
    assert!(!code.contains("marker:"), "{code}");
    assert!(code.contains("_$insert("), "{code}");
}

#[test]
fn ssr_is_off_by_default() {
    let code = run(r#"const el = <div>{name}</div>;"#, json!({}));
    assert!(code.contains("_$templateHoles("), "{code}");
    assert!(!code.contains("_$ssrRaw("), "{code}");
}
