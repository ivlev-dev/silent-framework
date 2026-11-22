use silent_transform::{transform, Index};
use swc_core::common::{FileName, SourceMap};
use swc_core::ecma::ast::EsVersion;
use swc_core::ecma::parser::{lexer::Lexer, EsSyntax, Parser, StringInput, Syntax};

fn compile(source: &str, filename: &str) -> Result<String, String> {
    let index_json = serde_json::to_string(&Index::default()).unwrap();
    let result = transform(source, filename, "{}", &index_json)?;
    let value: serde_json::Value = serde_json::from_str(&result).unwrap();
    Ok(value["code"].as_str().unwrap().to_string())
}

fn run(source: &str, filename: &str) -> String {
    compile(source, filename).unwrap()
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

#[test]
fn async_child_await_is_materialized_before_accessor() {
    let code = run(
        r#"async function C() {
  const load = async () => "x";
  return <div>{await load()}</div>;
}"#,
        "/proj/src/view.tsx",
    );
    assert!(code.contains("const _h$0 = await load()"), "{code}");
    assert!(code.contains("()=>_h$0"), "{code}");
    assert!(!code.contains("() => await"), "{code}");
    assert_parses(&code);
}

#[test]
fn async_attribute_await_is_materialized() {
    let code = run(
        r#"async function C() {
  const load = async () => "x";
  return <div title={await load()} />;
}"#,
        "/proj/src/view.tsx",
    );
    assert!(code.contains("const _a$0 = await load()"), "{code}");
    assert!(code.contains("()=>_a$0"), "{code}");
    assert!(!code.contains("() => await"), "{code}");
    assert_parses(&code);
}

#[test]
fn async_component_prop_await_does_not_produce_async_getter() {
    let code = run(
        r#"async function C() {
  const load = async () => "x";
  return <Comp value={await load()} />;
}"#,
        "/proj/src/view.tsx",
    );
    assert!(code.contains("const _p$0 = await load()"), "{code}");
    assert!(code.contains("return _p$0"), "{code}");
    assert!(!code.contains("return await load()"), "{code}");
    assert_parses(&code);
}

#[test]
fn async_component_children_await_is_materialized() {
    let code = run(
        r#"async function C() {
  const load = async () => "x";
  return <Comp>{await load()}</Comp>;
}"#,
        "/proj/src/view.tsx",
    );
    assert!(code.contains("const _p$0 = await load()"), "{code}");
    assert!(
        !code.contains("get children () {\n        return await"),
        "{code}"
    );
    assert_parses(&code);
}

#[test]
fn async_method_await_is_materialized() {
    let code = run(
        r#"class C {
  async render() {
    const load = async () => "x";
    return <div>{await load()}</div>;
  }
}"#,
        "/proj/src/view.tsx",
    );
    assert!(code.contains("const _h$0 = await load()"), "{code}");
    assert_parses(&code);
}

#[test]
fn sync_jsx_keeps_synchronous_accessors() {
    let code = run(
        r#"function C() {
  return <div title={value()}>{value()}</div>;
}"#,
        "/proj/src/view.tsx",
    );
    assert!(!code.contains("async ("), "{code}");
    assert!(!code.contains("await ("), "{code}");
    assert!(code.contains("()=>value()"), "{code}");
    assert_parses(&code);
}

#[test]
fn async_handler_is_not_materialized() {
    let code = run(
        r#"function C() {
  const save = async () => 1;
  return <button onClick={async ()=>await save()}>x</button>;
}"#,
        "/proj/src/view.tsx",
    );
    assert!(!code.contains("const _a$"), "{code}");
    assert!(code.contains("async ()=>await save()"), "{code}");
    assert_parses(&code);
}

#[test]
fn yield_in_generator_jsx_reports_diagnostic() {
    let error = compile(
        r#"function* C() {
  return <div>{yield 1}</div>;
}"#,
        "/proj/src/view.tsx",
    )
    .unwrap_err();
    assert!(error.contains("yield"), "unexpected error: {error}");
    assert!(
        error.contains("не поддерживается") || error.contains("generator"),
        "unexpected error: {error}"
    );
}

#[test]
fn await_in_nested_function_is_not_materialized() {
    let code = run(
        r#"function C() {
  const run = async () => 1;
  return <div title={(() => run())()}>{value()}</div>;
}"#,
        "/proj/src/view.tsx",
    );
    assert!(!code.contains("const _a$"), "{code}");
    assert!(!code.contains("const _h$"), "{code}");
    assert_parses(&code);
}
