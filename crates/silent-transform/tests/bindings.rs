use silent_transform::{transform, Index};

fn run(source: &str) -> String {
    let index_json = serde_json::to_string(&Index::default()).unwrap();
    let result = transform(source, "/proj/src/view.tsx", "{}", &index_json).unwrap();
    let value: serde_json::Value = serde_json::from_str(&result).unwrap();
    value["code"].as_str().unwrap().to_string()
}

#[test]
fn bind_value_member_generates_two_way_setter() {
    let code = run(
        r#"class View { vm = { draft: "" }; render() { return <input bindValue={this.vm.draft} />; } }"#,
    );
    assert!(code.contains("_$bindValue("), "{code}");
    assert!(code.contains("()=>this.vm.draft"), "{code}");
    assert!(code.contains("this.vm.draft = __value$"), "{code}");
}

#[test]
fn bind_checked_member_generates_setter() {
    let code = run(
        r#"class View { vm = { done: false }; render() { return <input type="checkbox" bindChecked={this.vm.done} />; } }"#,
    );
    assert!(code.contains("_$bindChecked("), "{code}");
    assert!(code.contains("this.vm.done = __value$"), "{code}");
}

#[test]
fn bind_value_tuple_uses_accessor_and_setter() {
    let code = run(
        r#"function render() { const [value, setValue] = createSignal("a"); return <input bindValue={[value, setValue]} />; }"#,
    );
    assert!(code.contains("_$bindValue("), "{code}");
    assert!(code.contains("[value, setValue]"), "{code}");
    assert!(!code.contains("__value$"), "{code}");
}

#[test]
fn bind_value_expression_is_one_way() {
    let code = run(r#"function render() { return <input bindValue={read()} />; }"#);
    assert!(code.contains("_$bindValue("), "{code}");
    assert!(code.contains("()=>read()"), "{code}");
    assert!(!code.contains("__value$"), "{code}");
}

#[test]
fn bind_value_is_not_rendered_as_attribute() {
    let code = run(r#"function render() { return <input class="x" bindValue={value} />; }"#);
    assert!(!code.contains("bindValue=\""), "{code}");
    assert!(code.contains("class=\"x\""), "{code}");
    assert!(code.contains("_$bindValue("), "{code}");
}

#[test]
fn key_is_not_emitted_into_template() {
    let code = run(r#"function render() { return <li key="row"><span>text</span></li>; }"#);
    assert!(!code.contains("key=\""), "{code}");
    assert!(code.contains("<li><span>text</span></li>"), "{code}");
}

#[test]
fn bind_value_inside_template_plan_gets_attr_marker() {
    let code = run(r#"function render() { return <div><input bindValue={value} /></div>; }"#);
    assert!(code.contains("data-silent-a-0"), "{code}");
    assert!(code.contains("_$bindValue("), "{code}");
}
