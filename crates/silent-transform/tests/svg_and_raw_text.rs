use silent_transform::{transform, Index};

fn compile(source: &str) -> Result<String, String> {
    let index_json = serde_json::to_string(&Index::default()).unwrap();
    let result = transform(source, "/proj/src/view.tsx", "{}", &index_json)?;
    let value: serde_json::Value = serde_json::from_str(&result).unwrap();
    Ok(value["code"].as_str().unwrap().to_string())
}

fn run(source: &str) -> String {
    compile(source).unwrap()
}

fn template_calls(code: &str) -> Vec<&str> {
    const MARKER: &str = "_$templateHoles(";
    let mut calls = Vec::new();
    let mut rest = code;
    while let Some(position) = rest.find(MARKER) {
        let from = &rest[position + MARKER.len()..];
        let mut quote: Option<char> = None;
        let mut escaped = false;
        let mut depth = 1usize;
        let mut end = from.len();
        for (index, character) in from.char_indices() {
            if escaped {
                escaped = false;
                continue;
            }
            if quote.is_some() {
                if character == '\\' {
                    escaped = true;
                } else if quote == Some(character) {
                    quote = None;
                }
                continue;
            }
            match character {
                '\'' | '"' | '`' => quote = Some(character),
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = index;
                        break;
                    }
                }
                _ => {}
            }
        }
        calls.push(&from[..end]);
        rest = &from[end..];
    }
    calls
}

fn html_of(call: &str) -> &str {
    let trimmed = call.trim_start();
    let quote = trimmed
        .chars()
        .next()
        .filter(|character| matches!(character, '\'' | '"'))
        .unwrap_or_else(|| panic!("call does not start with html literal: {call}"));
    let body = &trimmed[quote.len_utf8()..];
    let close = body
        .find(quote)
        .unwrap_or_else(|| panic!("unterminated html literal: {call}"));
    &body[..close]
}

fn call_for<'a>(calls: &[&'a str], html_prefix: &str) -> &'a str {
    calls
        .iter()
        .copied()
        .find(|call| html_of(call).starts_with(html_prefix))
        .unwrap_or_else(|| panic!("no template for {html_prefix}: {calls:?}"))
}

fn has_svg_hint(call: &str) -> bool {
    call.trim_end().ends_with("\"svg\"")
}

#[test]
fn svg_context_passes_namespace_to_for_child_template() {
    let code = run(r#"export function view() {
  return <svg viewBox="0 0 8 8"><For each={[1]}>{() => <path d="M0 0h8" />}</For></svg>;
}
"#);
    let calls = template_calls(&code);
    let path = call_for(&calls, "<path");
    assert!(has_svg_hint(path), "missing svg hint: {path}");
    assert!(path.contains("roots: 1"), "missing plan: {path}");
    let svg = call_for(&calls, "<svg");
    assert!(!has_svg_hint(svg), "svg root must not get hint: {svg}");
}

#[test]
fn svg_context_propagates_through_nested_elements() {
    let code = run(r#"export function view() {
  return <svg><div><For each={[1]}>{() => <circle r="1" />}</For></div></svg>;
}
"#);
    let calls = template_calls(&code);
    let circle = call_for(&calls, "<circle");
    assert!(has_svg_hint(circle), "missing svg hint: {circle}");
}

#[test]
fn foreign_object_children_lose_svg_namespace() {
    let code = run(r#"export function view() {
  return <svg><foreignObject><For each={[1]}>{() => <div />}</For></foreignObject></svg>;
}
"#);
    let calls = template_calls(&code);
    let div = call_for(&calls, "<div");
    assert!(!has_svg_hint(div), "unexpected svg hint: {div}");
    assert!(
        !calls.iter().any(|call| has_svg_hint(call)),
        "no template may carry svg hint: {code}"
    );
}

#[test]
fn nested_svg_inside_foreign_object_restores_namespace() {
    let code = run(r#"export function view() {
  return <svg><foreignObject><svg><For each={[1]}>{() => <rect />}</For></svg></foreignObject></svg>;
}
"#);
    let calls = template_calls(&code);
    let rect = call_for(&calls, "<rect");
    assert!(has_svg_hint(rect), "missing svg hint: {rect}");
}

#[test]
fn map_inside_svg_gets_namespace() {
    let code = run(r#"export function view(props: { items: number[] }) {
  return <svg>{props.items.map((item) => <g><circle r={item} /></g>)}</svg>;
}
"#);
    let calls = template_calls(&code);
    let group = call_for(&calls, "<g>");
    assert!(has_svg_hint(group), "missing svg hint: {group}");
}

#[test]
fn static_svg_template_keeps_html_namespace() {
    let code = run(r#"export function view() {
  return <div><svg viewBox="0 0 8 8"><path d="M0 0h8" /></svg></div>;
}
"#);
    assert!(
        code.contains(r#"<svg viewBox="0 0 8 8"><path d="M0 0h8"></path></svg>"#),
        "unexpected html: {code}"
    );
    assert!(
        !template_calls(&code).iter().any(|call| has_svg_hint(call)),
        "unexpected hint: {code}"
    );
}

#[test]
fn same_html_in_html_and_svg_context_is_not_deduplicated() {
    let code = run(r#"export function view() {
  return <div><For each={[1]}>{() => <path />}</For><svg><For each={[1]}>{() => <path />}</For></svg></div>;
}
"#);
    let paths: Vec<&str> = template_calls(&code)
        .into_iter()
        .filter(|call| html_of(call) == "<path></path>")
        .collect();
    assert_eq!(paths.len(), 2, "templates must stay separate: {code}");
    assert_eq!(
        paths.iter().filter(|call| has_svg_hint(call)).count(),
        1,
        "exactly one path template needs the hint: {code}"
    );
}

#[test]
fn static_style_keeps_raw_characters() {
    let code = run(r#"export function view() {
  return <style>a > b & c</style>;
}
"#);
    assert!(
        code.contains("<style>a > b & c</style>"),
        "unexpected markup: {code}"
    );
    assert!(!code.contains("&gt;"), "style must not be escaped: {code}");
    assert!(!code.contains("&amp;"), "style must not be escaped: {code}");
}

#[test]
fn static_style_from_string_literal_keeps_raw_characters() {
    let code = run(r#"export function view() {
  return <style>{"a > b { color: red; }"}</style>;
}
"#);
    assert!(
        code.contains("<style>a > b { color: red; }</style>"),
        "unexpected markup: {code}"
    );
}

#[test]
fn static_script_keeps_raw_characters() {
    let code = run(r#"export function view() {
  return <script>run(a > b && c)</script>;
}
"#);
    assert!(
        code.contains("<script>run(a > b && c)</script>"),
        "unexpected markup: {code}"
    );
    assert!(!code.contains("&gt;"), "script must not be escaped: {code}");
    assert!(
        !code.contains("&amp;"),
        "script must not be escaped: {code}"
    );
}

#[test]
fn dynamic_style_uses_text_content_binding() {
    let code = run(r#"export function view(props: { css: string }) {
  return <style>{props.css}</style>;
}
"#);
    assert!(
        !code.contains("silent-hole"),
        "style must not contain hole comments: {code}"
    );
    assert!(code.contains("data-silent-text"), "missing marker: {code}");
    assert!(
        code.contains("\"textContent\""),
        "missing textContent binding: {code}"
    );
    assert!(
        code.contains("data-silent-a-0"),
        "missing attr marker: {code}"
    );
}

#[test]
fn dynamic_script_uses_text_content_binding() {
    let code = run(r#"export function view(props: { code: string }) {
  return <script>{props.code}</script>;
}
"#);
    assert!(
        !code.contains("silent-hole"),
        "script must not contain hole comments: {code}"
    );
    assert!(code.contains("data-silent-text"), "missing marker: {code}");
    assert!(
        code.contains("\"textContent\""),
        "missing textContent binding: {code}"
    );
}

#[test]
fn dynamic_style_with_static_text_keeps_order() {
    let code = run(r#"export function view(props: { color: string }) {
  return <style>a {props.color} c</style>;
}
"#);
    assert!(
        !code.contains("silent-hole"),
        "style must not contain hole comments: {code}"
    );
    let style = template_calls(&code)
        .into_iter()
        .find(|call| html_of(call).starts_with("<style"))
        .expect("missing style template");
    assert!(
        html_of(style) == "<style data-silent-a-0=\"\" data-silent-text=\"\"></style>",
        "{style}"
    );
    assert!(code.contains("\"a \""), "unexpected code: {code}");
    assert!(code.contains("\" c\""), "unexpected code: {code}");
    assert!(
        code.contains("textContent"),
        "missing textContent binding: {code}"
    );
}

#[test]
fn textarea_and_title_keep_existing_escaping() {
    let code = run(r#"export function view() {
  return <div><title>a &lt; b</title><textarea>a &amp; b</textarea></div>;
}
"#);
    assert!(
        code.contains("<title>a &lt; b</title>"),
        "title must be escaped: {code}"
    );
    assert!(
        code.contains("<textarea>a &amp; b</textarea>"),
        "textarea must be escaped: {code}"
    );
}

#[test]
fn textarea_and_title_keep_existing_bindings() {
    let code = run(r#"export function view(props: { text: string }) {
  return <div><title>{props.text}</title><textarea>{props.text}</textarea></div>;
}
"#);
    assert!(
        code.contains("\"value\""),
        "textarea must bind value: {code}"
    );
    assert!(
        code.contains("\"textContent\""),
        "title must bind textContent: {code}"
    );
}

#[test]
fn svg_template_without_plan_keeps_namespace_argument() {
    let code = run(r#"export function view() {
  return <svg><For each={[1]}>{() => <a />}</For></svg>;
}
"#);
    let calls = template_calls(&code);
    let anchor = call_for(&calls, "<a>");
    assert!(
        anchor.trim_end().ends_with("undefined, \"svg\"")
            || anchor.trim_end().ends_with("false, \"svg\""),
        "missing namespace placeholder: {anchor}"
    );
}

#[test]
fn svg_fragment_child_template_gets_namespace() {
    let code = run(r#"export function view() {
  return <svg><For each={[1]}>{() => <><circle /><rect /></>}</For></svg>;
}
"#);
    let calls = template_calls(&code);
    let fragment = call_for(&calls, "<circle");
    assert!(has_svg_hint(fragment), "missing svg hint: {fragment}");
    assert_eq!(
        html_of(fragment),
        "<circle></circle><rect></rect>",
        "unexpected html: {fragment}"
    );
}

#[test]
fn style_with_element_child_fails() {
    let error = compile(
        r#"export function view() {
  return <style><div /></style>;
}
"#,
    )
    .unwrap_err();
    assert!(error.contains("<style>"), "unexpected error: {error}");
}

#[test]
fn script_with_element_child_fails() {
    let error = compile(
        r#"export function view() {
  return <script><div /></script>;
}
"#,
    )
    .unwrap_err();
    assert!(error.contains("<script>"), "unexpected error: {error}");
}

#[test]
fn style_with_fragment_child_fails() {
    let error = compile(
        r#"export function view() {
  return <style><span>a</span></style>;
}
"#,
    )
    .unwrap_err();
    assert!(error.contains("<style>"), "unexpected error: {error}");
}

#[test]
fn style_with_dynamic_element_child_fails() {
    let error = compile(
        r#"export function view(props: { on: boolean }) {
  return <style>{props.on ? <b /> : null}</style>;
}
"#,
    )
    .unwrap_err();
    assert!(error.contains("<style>"), "unexpected error: {error}");
}

#[test]
fn static_script_preserves_exact_newlines() {
    let code = run(
        "export function view() {\n  return <script>const a=1;\n// comment\nconst b=2;</script>;\n}\n",
    );
    assert!(
        code.contains("<script>const a=1;\\n// comment\\nconst b=2;</script>"),
        "script must keep newlines: {code}"
    );
}

#[test]
fn static_style_preserves_exact_newlines() {
    let code = run("export function view() {\n  return <style>a > b\n/* c */</style>;\n}\n");
    assert!(
        code.contains("<style>a > b\\n/* c */</style>"),
        "style must keep newlines: {code}"
    );
}

#[test]
fn static_title_and_textarea_still_collapse_newlines() {
    let code = run(
        "export function view() {\n  return <div><title>a\nb</title><textarea>c\nd</textarea></div>;\n}\n",
    );
    assert!(
        code.contains("<title>a b</title>"),
        "title must collapse: {code}"
    );
    assert!(
        code.contains("<textarea>c d</textarea>"),
        "textarea must collapse: {code}"
    );
}

#[test]
fn dangerously_set_inner_html_uses_inner_html_helper() {
    let code = run(r#"export function view(props: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: props.html }} />;
}
"#);
    assert!(
        code.contains("_$innerHtml("),
        "missing innerHtml helper: {code}"
    );
    assert!(
        !code.contains("_$prop("),
        "innerHtml must not go through prop: {code}"
    );
    assert!(
        code.contains("data-silent-text"),
        "innerHTML element needs a content hole marker: {code}"
    );
}

#[test]
fn static_boolean_and_non_boolean_attributes_are_synchronized() {
    let code = run(r#"export function view() {
  return <div aria-hidden={true} draggable={true} data-flag={true} hidden={true} />;
}
"#);
    assert!(
        code.contains("aria-hidden=\"true\""),
        "unexpected markup: {code}"
    );
    assert!(
        code.contains("draggable=\"true\""),
        "unexpected markup: {code}"
    );
    assert!(
        code.contains("data-flag=\"true\""),
        "unexpected markup: {code}"
    );
    assert!(code.contains("hidden=\"\""), "unexpected markup: {code}");
    assert!(
        !code.contains(" hidden=\"true\""),
        "unexpected markup: {code}"
    );
}

#[test]
fn select_value_is_not_rendered_as_attribute() {
    let code = run(r#"export function view() {
  return <select value="b"><option value="a">a</option><option value="b">b</option></select>;
}
"#);
    assert!(
        !code.contains("<select value="),
        "select must not render value attribute: {code}"
    );
    assert!(code.contains("value=\"b\""), "option keeps value: {code}");
}

#[test]
fn dynamic_select_value_still_binds_on_client() {
    let code = run(r#"export function view(props: { value: string }) {
  return <select value={props.value}><option value="a">a</option></select>;
}
"#);
    assert!(
        code.contains("_$attr("),
        "dynamic select value must stay reactive: {code}"
    );
    assert!(
        !code.contains("<select value="),
        "select must not render static value attribute: {code}"
    );
}

#[test]
fn static_svg_presentation_attributes_use_kebab_case() {
    let code = run(r#"export function view() {
  return <svg><path strokeWidth="2" fillOpacity="0.5" /></svg>;
}
"#);
    assert!(code.contains("stroke-width=\"2\""), "{code}");
    assert!(code.contains("fill-opacity=\"0.5\""), "{code}");
    assert!(!code.contains("strokeWidth"), "{code}");
    assert!(!code.contains("fillOpacity"), "{code}");
}

#[test]
fn static_svg_attribute_on_root_svg_is_mapped() {
    let code = run(r#"export function view() {
  return <svg strokeWidth="2"><path /></svg>;
}
"#);
    assert!(code.contains("<svg stroke-width=\"2\">"), "{code}");
}

#[test]
fn dynamic_svg_presentation_attribute_keeps_camel_case() {
    let code = run(r#"export function view(props: { width: number }) {
  return <svg><path strokeWidth={props.width} fillOpacity="0.5" /></svg>;
}
"#);
    assert!(code.contains("\"strokeWidth\""), "{code}");
    assert!(code.contains("fill-opacity=\"0.5\""), "{code}");
}

#[test]
fn svg_attribute_table_covers_runtime_names() {
    let runtime = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/core/src/dom.ts"
    ));
    let start = runtime
        .find("const SVG_ATTRIBUTE_NAMES")
        .expect("SVG_ATTRIBUTE_NAMES not found in runtime");
    let end = runtime[start..]
        .find("]);")
        .map(|offset| start + offset)
        .expect("end of SVG_ATTRIBUTE_NAMES not found in runtime");
    let table = &runtime[start..end];
    let pairs: Vec<(&str, &str)> = table
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("[\""))
        .map(|line| {
            let parts: Vec<&str> = line.split('"').skip(1).step_by(2).collect();
            match parts.as_slice() {
                [camel, kebab] => (*camel, *kebab),
                _ => panic!("unexpected SVG_ATTRIBUTE_NAMES entry: {line}"),
            }
        })
        .collect();
    assert!(pairs.len() >= 20, "runtime table was not parsed: {pairs:?}");
    for (camel, kebab) in pairs {
        let source =
            format!("export function view() {{ return <svg><path {camel}=\"x\" /></svg>; }}");
        let code = run(&source);
        assert!(
            code.contains(&format!("{kebab}=\"x\"")),
            "{camel} must be written as {kebab}: {code}"
        );
    }
}

#[test]
fn static_select_marks_matching_option_selected() {
    let code = run(r#"export function view() {
  return <select value="b"><option value="a">a</option><option value="b">b</option></select>;
}
"#);
    assert!(
        code.contains(r#"<option value="b" selected="">b</option>"#),
        "matching option must be selected: {code}"
    );
    assert!(!code.contains(r#"<option value="a" selected"#), "{code}");
    assert!(!code.contains("<select value="), "{code}");
}

#[test]
fn dynamic_select_value_does_not_mark_options() {
    let code = run(r#"export function view(props: { value: string }) {
  return <select value={props.value}><option value="a">a</option><option value="b">b</option></select>;
}
"#);
    assert!(!code.contains("selected"), "{code}");
    assert!(code.contains("_$attr("), "{code}");
}
