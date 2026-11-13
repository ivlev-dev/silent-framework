use serde_json::{json, Value};
use silent_transform::{transform, Index};

fn run(source: &str, options: Value) -> String {
    let options_json = serde_json::to_string(&options).unwrap();
    let index_json = serde_json::to_string(&Index::default()).unwrap();
    let result = transform(source, "/proj/src/view.tsx", &options_json, &index_json).unwrap();
    let value: Value = serde_json::from_str(&result).unwrap();
    value["code"].as_str().unwrap().to_string()
}

fn adoption_plan(code: &str) -> &str {
    let start = code.find("roots:").expect("missing adoption plan");
    let rest = &code[start..];
    let end = rest.find(')').expect("unterminated adoption plan");
    &rest[..end]
}

fn section<'a>(plan: &'a str, from: &str, to: &str) -> &'a str {
    let start = plan
        .find(from)
        .unwrap_or_else(|| panic!("missing {from} in plan: {plan}"));
    let rest = &plan[start..];
    let end = rest
        .find(to)
        .unwrap_or_else(|| panic!("missing {to} in plan: {plan}"));
    &rest[..end]
}

fn assert_order(section: &str, first: &str, second: &str, plan: &str) {
    let first_at = section
        .find(first)
        .unwrap_or_else(|| panic!("missing {first} in plan: {plan}"));
    let second_at = section
        .find(second)
        .unwrap_or_else(|| panic!("missing {second} in plan: {plan}"));
    assert!(first_at < second_at, "unexpected key order: {plan}");
}

#[test]
fn plan_keys_include_hole_and_attr_markers() {
    let code = run(r#"const el = <div title={label}>{name}</div>;"#, json!({}));
    let plan = adoption_plan(&code);
    let holes = section(plan, "holes:", "attrs:");
    assert!(holes.contains("silent-hole-0"), "{plan}");
    let attrs = section(plan, "attrs:", "strips:");
    assert!(attrs.contains("data-silent-a-0"), "{plan}");
}

#[test]
fn plan_keys_follow_indices_and_keep_order() {
    let code = run(
        r#"const el = <><div title={a} id={b}>{c}</div><div>{d}</div></>;"#,
        json!({}),
    );
    let plan = adoption_plan(&code);
    let holes = section(plan, "holes:", "attrs:");
    assert_order(holes, "silent-hole-0", "silent-hole-1", plan);
    let attrs = section(plan, "attrs:", "strips:");
    assert_order(attrs, "data-silent-a-0", "data-silent-a-1", plan);
}
