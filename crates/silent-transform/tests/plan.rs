use silent_transform::{transform, Index};
use swc_core::common::{FileName, SourceMap};
use swc_core::ecma::ast::{CallExpr, Callee, EsVersion, Expr, Lit, Prop, PropName, PropOrSpread};
use swc_core::ecma::parser::{lexer::Lexer, Parser, StringInput, Syntax, TsSyntax};
use swc_core::ecma::visit::{Visit, VisitWith};

#[derive(Debug, Clone, PartialEq, Eq)]
struct Part {
    path: Vec<usize>,
    counts: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Strip {
    path: Vec<usize>,
    counts: Vec<usize>,
    names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Plan {
    roots: usize,
    holes: Vec<Part>,
    attrs: Vec<Part>,
    strips: Vec<Strip>,
}

#[derive(Default)]
struct TemplateCalls {
    calls: Vec<CallExpr>,
}

impl Visit for TemplateCalls {
    fn visit_call_expr(&mut self, call: &CallExpr) {
        if let Callee::Expr(callee) = &call.callee {
            if let Expr::Ident(ident) = &**callee {
                if ident.sym == "_$templateHoles" {
                    self.calls.push(call.clone());
                }
            }
        }
        call.visit_children_with(self);
    }
}

fn compile(source: &str) -> String {
    let index_json = serde_json::to_string(&Index::default()).unwrap();
    let result = transform(source, "/proj/src/view.tsx", "{}", &index_json).unwrap();
    let value: serde_json::Value = serde_json::from_str(&result).unwrap();
    value["code"].as_str().unwrap().to_string()
}

fn template_calls(source: &str) -> Vec<CallExpr> {
    let code = compile(source);
    let source_map = SourceMap::default();
    let file = source_map.new_source_file(FileName::Real("/proj/src/view.tsx".into()).into(), code);
    let lexer = Lexer::new(
        Syntax::Typescript(TsSyntax {
            tsx: false,
            decorators: true,
            ..Default::default()
        }),
        EsVersion::EsNext,
        StringInput::from(&*file),
        None,
    );
    let mut parser = Parser::new_from(lexer);
    let module = parser.parse_module().unwrap();
    let mut collector = TemplateCalls::default();
    module.visit_with(&mut collector);
    collector.calls
}

fn plan(source: &str) -> Plan {
    let calls = template_calls(source);
    assert_eq!(calls.len(), 1, "expected one template call: {source}");
    let call = &calls[0];
    assert_eq!(call.args.len(), 2, "expected adoption plan: {source}");
    plan_from_expr(&call.args[1].expr)
}

fn assert_no_plan(source: &str) {
    let calls = template_calls(source);
    assert!(!calls.is_empty(), "expected a template call: {source}");
    for call in calls {
        assert_eq!(call.args.len(), 1, "unexpected adoption plan: {source}");
    }
}

fn plan_from_expr(expr: &Expr) -> Plan {
    let Expr::Object(object) = expr else {
        panic!("expected plan object");
    };
    let mut plan = Plan {
        roots: 0,
        holes: Vec::new(),
        attrs: Vec::new(),
        strips: Vec::new(),
    };
    for prop in &object.props {
        let PropOrSpread::Prop(prop) = prop else {
            panic!("unexpected spread in plan");
        };
        let Prop::KeyValue(pair) = &**prop else {
            panic!("unexpected plan property");
        };
        match key_name(&pair.key).as_str() {
            "roots" => plan.roots = number_value(&pair.value),
            "holes" => plan.holes = parts(&pair.value),
            "attrs" => plan.attrs = parts(&pair.value),
            "strips" => plan.strips = strips(&pair.value),
            key => panic!("unexpected plan key: {key}"),
        }
    }
    plan
}

fn key_name(key: &PropName) -> String {
    match key {
        PropName::Ident(ident) => ident.sym.to_string(),
        PropName::Str(value) => value.value.to_string_lossy().into_owned(),
        _ => panic!("unexpected plan key"),
    }
}

fn number_value(expr: &Expr) -> usize {
    match expr {
        Expr::Lit(Lit::Num(value)) => value.value as usize,
        _ => panic!("expected number"),
    }
}

fn string_value(expr: &Expr) -> String {
    match expr {
        Expr::Lit(Lit::Str(value)) => value.value.to_string_lossy().into_owned(),
        _ => panic!("expected string"),
    }
}

fn number_list(expr: &Expr) -> Vec<usize> {
    let Expr::Array(array) = expr else {
        panic!("expected number array");
    };
    array
        .elems
        .iter()
        .map(|element| {
            let element = element.as_ref().expect("unexpected sparse array");
            assert!(element.spread.is_none());
            number_value(&element.expr)
        })
        .collect()
}

fn string_list(expr: &Expr) -> Vec<String> {
    let Expr::Array(array) = expr else {
        panic!("expected string array");
    };
    array
        .elems
        .iter()
        .map(|element| {
            let element = element.as_ref().expect("unexpected sparse array");
            assert!(element.spread.is_none());
            string_value(&element.expr)
        })
        .collect()
}

fn parts(expr: &Expr) -> Vec<Part> {
    let Expr::Array(array) = expr else {
        panic!("expected parts array");
    };
    array
        .elems
        .iter()
        .map(|element| {
            let element = element.as_ref().expect("unexpected sparse array");
            part_from_expr(&element.expr)
        })
        .collect()
}

fn strips(expr: &Expr) -> Vec<Strip> {
    let Expr::Array(array) = expr else {
        panic!("expected strips array");
    };
    array
        .elems
        .iter()
        .map(|element| {
            let element = element.as_ref().expect("unexpected sparse array");
            strip_from_expr(&element.expr)
        })
        .collect()
}

fn part_from_expr(expr: &Expr) -> Part {
    let Expr::Object(object) = expr else {
        panic!("expected part object");
    };
    let mut part = Part {
        path: Vec::new(),
        counts: Vec::new(),
    };
    for prop in &object.props {
        let PropOrSpread::Prop(prop) = prop else {
            panic!("unexpected spread in part");
        };
        let Prop::KeyValue(pair) = &**prop else {
            panic!("unexpected part property");
        };
        match key_name(&pair.key).as_str() {
            "path" => part.path = number_list(&pair.value),
            "counts" => part.counts = number_list(&pair.value),
            key => panic!("unexpected part key: {key}"),
        }
    }
    part
}

fn strip_from_expr(expr: &Expr) -> Strip {
    let Expr::Object(object) = expr else {
        panic!("expected strip object");
    };
    let mut strip = Strip {
        path: Vec::new(),
        counts: Vec::new(),
        names: Vec::new(),
    };
    for prop in &object.props {
        let PropOrSpread::Prop(prop) = prop else {
            panic!("unexpected spread in strip");
        };
        let Prop::KeyValue(pair) = &**prop else {
            panic!("unexpected strip property");
        };
        match key_name(&pair.key).as_str() {
            "path" => strip.path = number_list(&pair.value),
            "counts" => strip.counts = number_list(&pair.value),
            "names" => strip.names = string_list(&pair.value),
            key => panic!("unexpected strip key: {key}"),
        }
    }
    strip
}

fn part(path: &[usize], counts: &[usize]) -> Part {
    Part {
        path: path.to_vec(),
        counts: counts.to_vec(),
    }
}

fn strip(path: &[usize], counts: &[usize], names: &[&str]) -> Strip {
    Strip {
        path: path.to_vec(),
        counts: counts.to_vec(),
        names: names.iter().map(|name| name.to_string()).collect(),
    }
}

#[test]
fn builds_plan_for_single_root() {
    let plan = plan("const el = <li>{row.label}</li>;");
    assert_eq!(
        plan,
        Plan {
            roots: 1,
            holes: vec![part(&[0, 0], &[1, 1])],
            attrs: Vec::new(),
            strips: Vec::new(),
        }
    );
}

#[test]
fn builds_plan_for_nested_elements() {
    let plan = plan(
        "const el = <main><h1>{title}</h1><section><strong>{count}</strong></section></main>;",
    );
    assert_eq!(
        plan.holes,
        vec![
            part(&[0, 0, 0], &[1, 2, 1]),
            part(&[0, 1, 0, 0], &[1, 2, 1, 1]),
        ]
    );
}

#[test]
fn builds_plan_for_multiple_roots() {
    let plan = plan("const el = <><li>{a}</li><li>{b}</li></>;");
    assert_eq!(plan.roots, 2);
    assert_eq!(
        plan.holes,
        vec![part(&[0, 0], &[2, 1]), part(&[1, 0], &[2, 1]),]
    );
}

#[test]
fn merges_adjacent_text_children() {
    let plan = plan("const el = <div>Hello {\"world\"}{name}</div>;");
    assert_eq!(plan.holes, vec![part(&[0, 1], &[1, 2])]);
}

#[test]
fn merges_adjacent_text_roots() {
    let plan = plan("const el = <>Hello {\"world\"}{name}</>;");
    assert_eq!(plan.roots, 2);
    assert_eq!(plan.holes, vec![part(&[1], &[2])]);
}

#[test]
fn builds_plan_for_attrs_and_strips() {
    let plan = plan("const el = <div id=\"x\" title={x} class={y}><span data-z={z} /></div>;");
    assert_eq!(
        plan.attrs,
        vec![part(&[0], &[1]), part(&[0], &[1]), part(&[0, 0], &[1, 1]),]
    );
    assert_eq!(
        plan.strips,
        vec![
            strip(&[0], &[1], &["data-silent-a-0", "data-silent-a-1"]),
            strip(&[0, 0], &[1, 1], &["data-silent-a-2"]),
        ]
    );
}

#[test]
fn treats_fragment_children_as_transparent() {
    let plan = plan("const el = <div>{<><span>{x}</span></>}</div>;");
    assert_eq!(plan.holes, vec![part(&[0, 0, 0], &[1, 1, 1])]);
}

#[test]
fn builds_plan_for_dynamic_textarea() {
    let plan = plan("const el = <textarea class=\"field\">{props.value}</textarea>;");
    assert_eq!(
        plan,
        Plan {
            roots: 1,
            holes: Vec::new(),
            attrs: vec![part(&[0], &[1])],
            strips: vec![strip(&[0], &[1], &["data-silent-a-0", "data-silent-text"],)],
        }
    );
}

#[test]
fn builds_empty_plan_for_static_textarea() {
    let plan = plan("const el = <textarea>hello</textarea>;");
    assert_eq!(
        plan,
        Plan {
            roots: 1,
            holes: Vec::new(),
            attrs: Vec::new(),
            strips: Vec::new(),
        }
    );
}

#[test]
fn refuses_plan_for_table() {
    assert_no_plan("const el = <div><table><tbody><tr><td>{x}</td></tr></tbody></table></div>;");
}

#[test]
fn refuses_plan_for_select() {
    assert_no_plan("const el = <select><option>{x}</option></select>;");
}

#[test]
fn refuses_plan_for_paragraph() {
    assert_no_plan("const el = <p>{x}</p>;");
}

#[test]
fn refuses_plan_for_metadata_tags() {
    assert_no_plan("const el = <div><title>{x}</title></div>;");
    assert_no_plan("const el = <div><meta content={x} /></div>;");
    assert_no_plan("const el = <div><link href={x} /></div>;");
}
