use silent_transform::{transform, Index};

fn run(source: &str) -> String {
    let index_json = serde_json::to_string(&Index::default()).unwrap();
    let result = transform(source, "/proj/src/view.tsx", "{}", &index_json).unwrap();
    let value: serde_json::Value = serde_json::from_str(&result).unwrap();
    value["code"].as_str().unwrap().to_string()
}

#[test]
fn rewrites_top_level_props_destructuring() {
    let code = run(r#"function View(props: { value: string; label: string }) {
  const { value, label } = props;
  return <input value={value} title={label} />;
}"#);
    assert!(!code.contains("const {"), "{code}");
    assert!(!code.contains("= props"), "{code}");
    assert!(code.contains("props.value"), "{code}");
    assert!(code.contains("props.label"), "{code}");
}

#[test]
fn supports_rename_and_default() {
    let code = run(r#"function View(props: { count?: number; name: string }) {
  const { count = 1, name: label } = props;
  return <div title={label}>{count}</div>;
}"#);
    assert!(!code.contains("const {"), "{code}");
    assert!(code.contains("props.name"), "{code}");
    assert!(code.contains("props.count === undefined"), "{code}");
    assert!(code.contains("? 1 : props.count"), "{code}");
}

#[test]
fn default_can_reference_other_bindings() {
    let code = run(r#"function View(props: { count?: number }) {
  const { count = 1, total = count + 1 } = props;
  return <div>{total}</div>;
}"#);
    assert!(!code.contains("const {"), "{code}");
    assert!(code.contains("props.count === undefined"), "{code}");
    assert!(!code.contains("count + 1"), "{code}");
}

#[test]
fn rewrites_destructured_parameter() {
    let code = run(
        r#"function View({ value, count = 1 }: { value: string; count?: number }) {
  return <div title={value}>{count}</div>;
}"#,
    );
    assert!(!code.contains("{ value"), "{code}");
    assert!(code.contains("props.value"), "{code}");
    assert!(code.contains("props.count === undefined"), "{code}");
}

#[test]
fn rewrites_arrow_component_with_block_body() {
    let code = run(r#"const View = (props: { value: string }) => {
  const { value } = props;
  return <div>{value}</div>;
};"#);
    assert!(!code.contains("const {"), "{code}");
    assert!(code.contains("props.value"), "{code}");
}

#[test]
fn rewrites_arrow_component_with_expression_body() {
    let code = run(r#"const View = ({ value }: { value: string }) => <div>{value}</div>;"#);
    assert!(!code.contains("{ value"), "{code}");
    assert!(code.contains("props.value"), "{code}");
}

#[test]
fn keeps_view_component_this_alias() {
    let code = run(r#"import type { CounterVM } from "./counter.vm";
function View(this: { vm: CounterVM }, props: { value: string }) {
  const { value } = props;
  return <span>{value}{this.vm.count}</span>;
}"#);
    assert!(!code.contains("const {"), "{code}");
    assert!(code.contains("props.value"), "{code}");
    assert!(code.contains("_this$"), "{code}");
}

#[test]
fn ignores_functions_without_jsx() {
    let code = run(r#"function useValue(props: { value: string }) {
  const { value } = props;
  return value;
}"#);
    assert!(code.contains("const { value } = props"), "{code}");
    assert!(!code.contains("props.value"), "{code}");
}

#[test]
fn ignores_destructuring_not_from_props() {
    let code = run(r#"function View(props: { value: string }) {
  const source = { value: "x" };
  const { value } = source;
  return <div>{value}{props.value}</div>;
}"#);
    assert!(code.contains("const { value } = source"), "{code}");
}

#[test]
fn ignores_let_destructuring() {
    let code = run(r#"function View(props: { value: string }) {
  let { value } = props;
  return <div>{value}</div>;
}"#);
    assert!(code.contains("let { value } = props"), "{code}");
    assert!(!code.contains("props.value"), "{code}");
}

#[test]
fn keeps_shadowed_binding_inside_nested_block() {
    let code = run(r#"function View(props: { value: string }) {
  const { value } = props;
  {
    const value = "shadow";
    console.log(value);
  }
  return <div>{value}</div>;
}"#);
    assert!(!code.contains("const {"), "{code}");
    assert!(code.contains("props.value"), "{code}");
    assert!(code.contains("const value = \"shadow\""), "{code}");
    assert!(code.contains("console.log(value)"), "{code}");
}

#[test]
fn leaves_declaration_when_binding_is_reassigned() {
    let code = run(r#"function View(props: { value: string }) {
  const { value } = props;
  value = "changed";
  return <div>{value}</div>;
}"#);
    assert!(code.contains("const { value } = props"), "{code}");
    assert!(!code.contains("props.value"), "{code}");
}

#[test]
fn rewrites_nested_destructuring() {
    let code = run(
        r#"function View(props: { user: { name: string; age: number } }) {
  const { user: { name, age } } = props;
  return <div title={name}>{age}</div>;
}"#,
    );
    assert!(!code.contains("const {"), "{code}");
    assert!(code.contains("props.user.name"), "{code}");
    assert!(code.contains("props.user.age"), "{code}");
}

#[test]
fn rewrites_nested_destructuring_with_default() {
    let code = run(r#"function View(props: { user?: { name: string } }) {
  const { user: { name } = { name: "guest" } } = props;
  return <div>{name}</div>;
}"#);
    assert!(!code.contains("const {"), "{code}");
    assert!(code.contains("props.user === undefined"), "{code}");
    assert!(code.contains(").name"), "{code}");
}

#[test]
fn rewrites_object_shorthand() {
    let code = run(r#"function View(props: { value: string }) {
  const { value } = props;
  const data = { value };
  return <div title={data.value} />;
}"#);
    assert!(!code.contains("const {"), "{code}");
    assert!(code.contains("value: props.value"), "{code}");
}

#[test]
fn rewrites_destructuring_inside_block() {
    let code = run(r#"function View(props: { value: string }) {
  if (props.value) {
    const { value } = props;
    return <div>{value}</div>;
  }
  return <span />;
}"#);
    assert!(!code.contains("const {"), "{code}");
    assert!(code.contains("props.value"), "{code}");
}

#[test]
fn keeps_rest_destructuring_untouched() {
    let code = run(r#"function View(props: { value: string; rest: string }) {
  const { value, ...rest } = props;
  return <div title={value}>{rest.other}</div>;
}"#);
    assert!(code.contains("...rest"), "{code}");
}

#[test]
fn rewrites_function_expression_component() {
    let code = run(r#"const View = function (props: { value: string }) {
  const { value } = props;
  return <div>{value}</div>;
};"#);
    assert!(!code.contains("const {"), "{code}");
    assert!(code.contains("props.value"), "{code}");
}

#[test]
fn rewrites_destructured_parameter_with_this_type() {
    let code = run(r#"import type { CounterVM } from "./counter.vm";
function View(this: { vm: CounterVM }, { value }: { value: string }) {
  return <div>{value}{this.vm.count}</div>;
}"#);
    assert!(!code.contains("{ value"), "{code}");
    assert!(code.contains("props.value"), "{code}");
    assert!(code.contains("_this$"), "{code}");
}

#[test]
fn rewrites_component_name_from_props() {
    let code = run(r#"function View(props: { Icon: () => unknown }) {
  const { Icon } = props;
  return <Icon />;
}"#);
    assert!(!code.contains("const {"), "{code}");
    assert!(code.contains("props.Icon"), "{code}");
}

#[test]
fn keeps_component_untouched_when_props_is_shadowed() {
    let code = run(r#"function View(props: { value: string }) {
  const { value } = props;
  return <div>{value}{[1].map((props) => <span>{props.value}</span>)}</div>;
}"#);
    assert!(code.contains("const { value } = props"), "{code}");
}

#[test]
fn keeps_loop_binding_shadowing_destructured_name() {
    let code = run(r#"function View(props: { value: string }) {
  const { value } = props;
  return <div>{[1].map(() => {
    let result = "";
    for (const value of ["x"]) {
      result = value;
    }
    return result + value;
  })}</div>;
}"#);
    assert!(!code.contains("const {"), "{code}");
    assert!(code.contains("result = value"), "{code}");
    assert!(code.contains("+ props.value"), "{code}");
}

#[test]
fn keeps_catch_binding_shadowing_destructured_name() {
    let code = run(r#"function View(props: { value: string }) {
  const { value } = props;
  try {
    throw new Error("x");
  } catch (value) {
    console.log(value);
  }
  return <div>{value}</div>;
}"#);
    assert!(!code.contains("const {"), "{code}");
    assert!(code.contains("console.log(value)"), "{code}");
    assert!(code.contains("props.value"), "{code}");
}

#[test]
fn keeps_outer_props_when_inner_arrow_destructures() {
    let code = run(
        r#"function Card(props: { rows: { id: number }[]; title: string }) {
  return <ul><For each={props.rows}>{({ id }) => <li>{id}: {props.title}</li>}</For></ul>;
}"#,
    );
    assert!(code.contains("function Card(props)"), "{code}");
    assert!(code.contains("props.rows"), "{code}");
    assert!(code.contains("props.title"), "{code}");
    assert!(code.contains("(_props$)=>"), "{code}");
    assert!(code.contains("_props$.id"), "{code}");
    assert!(
        !code.contains("_props$.title"),
        "outer props must not be captured: {code}"
    );
}

#[test]
fn keeps_free_props_when_destructured_parameter_is_rewritten() {
    let code = run(r#"function View({ items }: { items: number[] }) {
  return <ul>{items.map((item) => <li>{item}: {props.title}</li>)}</ul>;
}"#);
    assert!(code.contains("function View(_props$)"), "{code}");
    assert!(code.contains("_props$.items"), "{code}");
    assert!(code.contains("props.title"), "{code}");
    assert!(
        !code.contains("_props$.title"),
        "outer props must not be captured: {code}"
    );
}

#[test]
fn keeps_free_props_in_nested_function_declaration() {
    let code = run(r#"function View({ items }: { items: number[] }) {
  function row({ id }: { id: number }) {
    return <li>{id}: {props.title}</li>;
  }
  return <ul>{row(items[0])}</ul>;
}"#);
    assert!(code.contains("props.title"), "{code}");
    assert!(code.contains("row(_props$.items[0])"), "{code}");
}

#[test]
fn destructured_component_without_free_props_keeps_props_name() {
    let code = run(r#"function C({ a }: { a: string }) {
  return <div>{a}</div>;
}"#);
    assert!(code.contains("function C(props)"), "{code}");
    assert!(code.contains("props.a"), "{code}");
    assert!(!code.contains("_props$"), "{code}");
}

#[test]
fn props_parameter_without_free_reference_is_unchanged() {
    let code = run(r#"function C(props: { a: string }) {
  return <div>{props.a}</div>;
}"#);
    assert!(code.contains("function C(props)"), "{code}");
    assert!(code.contains("props.a"), "{code}");
    assert!(!code.contains("_props$"), "{code}");
}

#[test]
fn keeps_local_props_binding_untouched() {
    let code = run(r#"function View({ items }: { items: number[] }) {
  const props = { title: "x" };
  return <ul>{items.map((item) => <li>{item}: {props.title}</li>)}</ul>;
}"#);
    assert!(code.contains("function View({ items })"), "{code}");
    assert!(code.contains("const props ="), "{code}");
    assert!(code.contains("props.title"), "{code}");
}
