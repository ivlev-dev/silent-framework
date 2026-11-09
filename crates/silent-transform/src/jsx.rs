use super::transform::{rewrite_this, string_expr, SilentPass};
use swc_core::common::{SyntaxContext, DUMMY_SP};
use swc_core::ecma::ast::{
    ArrayLit, ArrowExpr, ArrowFunctionBody, BinExpr, BinaryOp, BindingIdent, CallExpr, Callee,
    ComputedPropName, Expr, ExprOrSpread, Function, FunctionBody, GetterProp, Ident, IdentName,
    JSXAttr, JSXAttrName, JSXAttrOrSpread, JSXAttrValue, JSXElement, JSXElementChild,
    JSXElementName, JSXExpr, JSXExprContainer, JSXFragment, JSXObject, KeyValueProp, Lit,
    MemberExpr, MemberProp, ObjectLit, ParenExpr, Pat, Prop, PropName, PropOrSpread, ReturnStmt,
    SpreadElement, Stmt, Str, VarDecl, VarDeclKind, VarDeclarator,
};
use swc_core::ecma::visit::VisitMutWith;

#[derive(Default)]
struct TemplateParts {
    html: String,
    holes: Vec<Expr>,
    attrs: Vec<DynamicAttr>,
}

struct DynamicAttr {
    kind: DynamicAttrKind,
    expr: Expr,
}

enum DynamicAttrKind {
    Attr(String),
    Event(String),
    Ref,
    Style,
    Spread,
    InnerHtml,
}

#[derive(Clone)]
enum StaticValue {
    Str(String),
    Num(f64),
    Bool(bool),
    Null,
}

impl SilentPass {
    pub(crate) fn compile_element(&mut self, element: &JSXElement) -> Box<Expr> {
        if is_component_name(&element.opening.name) {
            return Box::new(self.compile_component(element));
        }
        let mut parts = TemplateParts::default();
        self.build_element_html(element, &mut parts);
        Box::new(self.finish_template(parts))
    }

    pub(crate) fn compile_fragment(&mut self, fragment: &JSXFragment) -> Box<Expr> {
        let mut parts = TemplateParts::default();
        self.build_children_html(&fragment.children, &mut parts);
        Box::new(self.finish_template(parts))
    }

    fn compile_expr(&mut self, expr: &Expr) -> Box<Expr> {
        match expr {
            Expr::JSXElement(element) => self.compile_element(element),
            Expr::JSXFragment(fragment) => self.compile_fragment(fragment),
            _ => {
                let mut cloned = expr.clone();
                cloned.visit_mut_children_with(self);
                Box::new(cloned)
            }
        }
    }

    fn build_element_html(&mut self, element: &JSXElement, parts: &mut TemplateParts) {
        let tag = element_name_string(&element.opening.name);
        parts.html.push('<');
        parts.html.push_str(&tag);

        for attr in &element.opening.attrs {
            match attr {
                JSXAttrOrSpread::JSXAttr(attr) => self.build_html_attr(attr, parts),
                JSXAttrOrSpread::SpreadElement(spread) => {
                    let expr = self.compile_expr(&spread.expr);
                    self.push_dynamic_attr("", *expr, DynamicAttrKind::Spread, parts);
                }
            }
        }

        let void = is_void_tag(&tag);
        if element.opening.self_closing {
            if void {
                parts.html.push('>');
            } else {
                parts.html.push('>');
                parts.html.push_str("</");
                parts.html.push_str(&tag);
                parts.html.push('>');
            }
            return;
        }

        parts.html.push('>');
        self.build_children_html(&element.children, parts);
        parts.html.push_str("</");
        parts.html.push_str(&tag);
        parts.html.push('>');
    }

    fn build_html_attr(&mut self, attr: &JSXAttr, parts: &mut TemplateParts) {
        let name = attr_name_string(&attr.name);
        if name == "key" {
            return;
        }
        let name = normalize_attr_name(&name);
        let Some(value) = &attr.value else {
            write_static_attr(parts, &name, StaticValue::Bool(true));
            return;
        };
        match value {
            JSXAttrValue::Str(value) => {
                write_static_attr(
                    parts,
                    &name,
                    StaticValue::Str(value.value.to_string_lossy().into_owned()),
                );
            }
            JSXAttrValue::JSXExprContainer(container) => match &container.expr {
                JSXExpr::JSXEmptyExpr(_) => {}
                JSXExpr::Expr(expr) => {
                    if let Some(value) = static_value(expr) {
                        write_static_attr(parts, &name, value);
                    } else {
                        let compiled = self.compile_expr(expr);
                        let kind = dynamic_kind(&name);
                        self.push_dynamic_attr(&name, *compiled, kind, parts);
                    }
                }
            },
            JSXAttrValue::JSXElement(element) => {
                let compiled = self.compile_element(element);
                self.push_dynamic_attr(&name, *compiled, dynamic_kind(&name), parts);
            }
            JSXAttrValue::JSXFragment(fragment) => {
                let compiled = self.compile_fragment(fragment);
                self.push_dynamic_attr(&name, *compiled, dynamic_kind(&name), parts);
            }
        }
    }

    fn push_dynamic_attr(
        &mut self,
        name: &str,
        expr: Expr,
        kind: DynamicAttrKind,
        parts: &mut TemplateParts,
    ) {
        let index = parts.attrs.len();
        parts.html.push_str(&format!(" data-silent-a-{index}=\"\""));
        parts.attrs.push(DynamicAttr {
            kind: match kind {
                DynamicAttrKind::Attr(_) => DynamicAttrKind::Attr(name.to_string()),
                other => other,
            },
            expr,
        });
    }

    fn build_children_html(&mut self, children: &[JSXElementChild], parts: &mut TemplateParts) {
        for child in children {
            match child {
                JSXElementChild::JSXText(text) => {
                    let value = process_text(&text.value.to_string_lossy());
                    if !value.is_empty() {
                        parts.html.push_str(&escape_html(&value));
                    }
                }
                JSXElementChild::JSXElement(element) => {
                    if is_component_name(&element.opening.name) {
                        let compiled = self.compile_element(element);
                        self.push_hole(parts, *compiled);
                    } else {
                        self.build_element_html(element, parts);
                    }
                }
                JSXElementChild::JSXFragment(fragment) => {
                    self.build_children_html(&fragment.children, parts);
                }
                JSXElementChild::JSXExprContainer(container) => {
                    self.build_expr_child(container, parts);
                }
                JSXElementChild::JSXSpreadChild(spread) => {
                    let expr = self.compile_expr(&spread.expr);
                    self.push_hole(parts, *expr);
                }
            }
        }
    }

    fn build_expr_child(&mut self, container: &JSXExprContainer, parts: &mut TemplateParts) {
        let JSXExpr::Expr(expr) = &container.expr else {
            return;
        };
        match &**expr {
            Expr::JSXElement(element) => {
                if is_component_name(&element.opening.name) {
                    let compiled = self.compile_element(element);
                    self.push_hole(parts, *compiled);
                } else {
                    self.build_element_html(element, parts);
                }
            }
            Expr::JSXFragment(fragment) => {
                self.build_children_html(&fragment.children, parts);
            }
            Expr::Lit(Lit::Str(value)) => {
                parts
                    .html
                    .push_str(&escape_html(&value.value.to_string_lossy()));
            }
            Expr::Lit(Lit::Num(value)) => {
                parts.html.push_str(&format_number(value.value));
            }
            Expr::Lit(Lit::Bool(_)) | Expr::Lit(Lit::Null(_)) => {}
            _ => {
                let compiled = self.compile_expr(expr);
                self.push_hole(parts, *compiled);
            }
        }
    }

    fn push_hole(&mut self, parts: &mut TemplateParts, expr: Expr) {
        let index = parts.holes.len();
        parts.html.push_str(&format!("<!--silent-hole-{index}-->"));
        parts.holes.push(expr);
    }

    fn finish_template(&mut self, parts: TemplateParts) -> Expr {
        let runtime = Expr::Ident(self.helper("templateHoles"));
        let template_factory = call_expr(runtime, vec![string_expr(&parts.html)]);
        let clone_call = call_expr(template_factory, Vec::new());
        let result = ident_expr("_r$");

        let mut statements = vec![Stmt::Decl(swc_core::ecma::ast::Decl::Var(Box::new(
            VarDecl {
                span: DUMMY_SP,
                ctxt: SyntaxContext::empty(),
                kind: VarDeclKind::Const,
                declare: false,
                decls: vec![VarDeclarator {
                    span: DUMMY_SP,
                    name: Pat::Ident(BindingIdent {
                        id: ident("_r$"),
                        type_ann: None,
                    }),
                    definite: false,
                    init: Some(Box::new(clone_call)),
                }],
            },
        )))];

        for (index, attr) in parts.attrs.into_iter().enumerate() {
            let element = computed_member(member_expr(result.clone(), "attrs"), index);
            let call = match attr.kind {
                DynamicAttrKind::Attr(name) => call_expr(
                    Expr::Ident(self.helper("attr")),
                    vec![element, string_expr(&name), arrow_expr(attr.expr)],
                ),
                DynamicAttrKind::Event(name) => call_expr(
                    Expr::Ident(self.helper("on")),
                    vec![element, string_expr(&name), arrow_expr(attr.expr)],
                ),
                DynamicAttrKind::Ref => call_expr(
                    Expr::Ident(self.helper("ref")),
                    vec![element, arrow_expr(attr.expr)],
                ),
                DynamicAttrKind::Style => call_expr(
                    Expr::Ident(self.helper("style")),
                    vec![element, arrow_expr(attr.expr)],
                ),
                DynamicAttrKind::Spread => call_expr(
                    Expr::Ident(self.helper("spread")),
                    vec![element, arrow_expr(attr.expr)],
                ),
                DynamicAttrKind::InnerHtml => {
                    let html = member_expr(attr.expr, "__html");
                    call_expr(
                        Expr::Ident(self.helper("prop")),
                        vec![element, string_expr("innerHTML"), arrow_expr(html)],
                    )
                }
            };
            statements.push(Stmt::Expr(swc_core::ecma::ast::ExprStmt {
                span: DUMMY_SP,
                expr: Box::new(call),
            }));
        }

        for (index, expr) in parts.holes.into_iter().enumerate() {
            let hole = computed_member(member_expr(result.clone(), "holes"), index);
            let parent = member_expr(hole.clone(), "parentNode");
            let node = member_expr(result.clone(), "node");
            let parent = Expr::Bin(BinExpr {
                span: DUMMY_SP,
                op: BinaryOp::LogicalOr,
                left: Box::new(parent),
                right: Box::new(node),
            });
            let call = call_expr(
                Expr::Ident(self.helper("insert")),
                vec![parent, arrow_expr(expr), hole],
            );
            statements.push(Stmt::Expr(swc_core::ecma::ast::ExprStmt {
                span: DUMMY_SP,
                expr: Box::new(call),
            }));
        }

        statements.push(Stmt::Return(ReturnStmt {
            span: DUMMY_SP,
            arg: Some(Box::new(member_expr(result, "node"))),
        }));

        let arrow = Expr::Arrow(ArrowExpr {
            span: DUMMY_SP,
            ctxt: SyntaxContext::empty(),
            params: Vec::new(),
            body: Box::new(ArrowFunctionBody::FunctionBody(FunctionBody {
                span: DUMMY_SP,
                stmts: statements,
            })),
            is_async: false,
            is_generator: false,
            type_params: None,
            return_type: None,
        });
        call_expr(
            Expr::Paren(ParenExpr {
                span: DUMMY_SP,
                expr: Box::new(arrow),
            }),
            Vec::new(),
        )
    }

    fn make_getter(&mut self, key: PropName, mut value: Expr) -> GetterProp {
        if self.view_stack.last().copied().unwrap_or(false) {
            rewrite_this(&mut value);
        }
        getter_prop(key, value)
    }

    fn compile_component(&mut self, element: &JSXElement) -> Expr {
        let tag = self.jsx_tag_expr(&element.opening.name);
        let mut properties: Vec<PropOrSpread> = Vec::new();
        let mut has_children = false;

        for attr in &element.opening.attrs {
            match attr {
                JSXAttrOrSpread::SpreadElement(spread) => {
                    let expr = self.compile_expr(&spread.expr);
                    properties.push(PropOrSpread::Spread(SpreadElement {
                        dot3_token: DUMMY_SP,
                        expr: Box::new(*expr),
                    }));
                }
                JSXAttrOrSpread::JSXAttr(attr) => {
                    let name = attr_name_string(&attr.name);
                    if name == "key" {
                        continue;
                    }
                    if name == "children" {
                        has_children = true;
                    }
                    let key = prop_name(&name);
                    let value = match &attr.value {
                        None => Some(Expr::Lit(Lit::Bool(swc_core::ecma::ast::Bool {
                            span: DUMMY_SP,
                            value: true,
                        }))),
                        Some(JSXAttrValue::Str(value)) => {
                            Some(string_expr(&value.value.to_string_lossy()))
                        }
                        Some(JSXAttrValue::JSXExprContainer(container)) => match &container.expr {
                            JSXExpr::JSXEmptyExpr(_) => None,
                            JSXExpr::Expr(expr) => Some(*self.compile_expr(expr)),
                        },
                        Some(JSXAttrValue::JSXElement(element)) => {
                            Some(*self.compile_element(element))
                        }
                        Some(JSXAttrValue::JSXFragment(fragment)) => {
                            Some(*self.compile_fragment(fragment))
                        }
                    };
                    if let Some(expr) = value {
                        if let Some(static_value) = static_value(&expr) {
                            properties.push(PropOrSpread::Prop(Box::new(Prop::KeyValue(
                                KeyValueProp {
                                    key: key.clone(),
                                    value: Box::new(static_expr(static_value)),
                                },
                            ))));
                        } else {
                            properties.push(PropOrSpread::Prop(Box::new(Prop::Getter(
                                self.make_getter(key, expr),
                            ))));
                        }
                    }
                }
            }
        }

        if !has_children {
            if let Some(children) = self.compile_children_value(&element.children) {
                properties.push(PropOrSpread::Prop(Box::new(Prop::Getter(
                    self.make_getter(prop_name("children"), children),
                ))));
            }
        }

        call_expr(
            Expr::Ident(self.helper("component")),
            vec![
                tag,
                Expr::Object(ObjectLit {
                    span: DUMMY_SP,
                    props: properties,
                }),
            ],
        )
    }

    fn compile_children_value(&mut self, children: &[JSXElementChild]) -> Option<Expr> {
        let mut values = Vec::new();
        for child in children {
            match child {
                JSXElementChild::JSXText(text) => {
                    let value = process_text(&text.value.to_string_lossy());
                    if !value.is_empty() {
                        values.push(string_expr(&value));
                    }
                }
                JSXElementChild::JSXElement(element) => {
                    values.push(*self.compile_element(element));
                }
                JSXElementChild::JSXFragment(fragment) => {
                    values.push(*self.compile_fragment(fragment));
                }
                JSXElementChild::JSXExprContainer(container) => {
                    if let JSXExpr::Expr(expr) = &container.expr {
                        match &**expr {
                            Expr::Lit(Lit::Bool(_)) | Expr::Lit(Lit::Null(_)) => {}
                            Expr::Lit(Lit::Str(value)) => {
                                values.push(string_expr(&value.value.to_string_lossy()));
                            }
                            Expr::Lit(Lit::Num(value)) => {
                                values.push(number_expr(value.value));
                            }
                            _ => values.push(*self.compile_expr(expr)),
                        }
                    }
                }
                JSXElementChild::JSXSpreadChild(spread) => {
                    values.push(*self.compile_expr(&spread.expr));
                }
            }
        }
        if values.is_empty() {
            return None;
        }
        if values.len() == 1 {
            return values.into_iter().next();
        }
        Some(Expr::Array(ArrayLit {
            span: DUMMY_SP,
            elems: values
                .into_iter()
                .map(|expr| {
                    Some(ExprOrSpread {
                        spread: None,
                        expr: Box::new(expr),
                    })
                })
                .collect(),
        }))
    }

    fn jsx_tag_expr(&mut self, name: &JSXElementName) -> Expr {
        match name {
            JSXElementName::Ident(ident) => Expr::Ident(ident.clone()),
            JSXElementName::JSXMemberExpr(member) => jsx_object_expr(&member.obj, &member.prop),
            JSXElementName::JSXNamespacedName(namespaced) => Expr::Ident(Ident::new(
                format!("{}:{}", namespaced.ns.sym, namespaced.name.sym).into(),
                DUMMY_SP,
                SyntaxContext::empty(),
            )),
        }
    }
}

fn jsx_object_expr(object: &JSXObject, property: &IdentName) -> Expr {
    let base = match object {
        JSXObject::Ident(ident) => Expr::Ident(ident.clone()),
        JSXObject::JSXMemberExpr(member) => jsx_object_expr(&member.obj, &member.prop),
    };
    member_expr(base, &property.sym)
}

fn ident(name: &str) -> Ident {
    Ident::new(name.into(), DUMMY_SP, SyntaxContext::empty())
}

fn ident_expr(name: &str) -> Expr {
    Expr::Ident(ident(name))
}

fn member_expr(object: Expr, property: &str) -> Expr {
    Expr::Member(MemberExpr {
        span: DUMMY_SP,
        obj: Box::new(object),
        prop: MemberProp::Ident(IdentName::new(property.into(), DUMMY_SP)),
    })
}

fn computed_member(object: Expr, index: usize) -> Expr {
    Expr::Member(MemberExpr {
        span: DUMMY_SP,
        obj: Box::new(object),
        prop: MemberProp::Computed(ComputedPropName {
            span: DUMMY_SP,
            expr: Box::new(number_expr(index as f64)),
        }),
    })
}

fn call_expr(callee: Expr, args: Vec<Expr>) -> Expr {
    Expr::Call(CallExpr {
        span: DUMMY_SP,
        callee: Callee::Expr(Box::new(callee)),
        args: args
            .into_iter()
            .map(|expr| ExprOrSpread {
                spread: None,
                expr: Box::new(expr),
            })
            .collect(),
        type_args: None,
        ctxt: SyntaxContext::empty(),
    })
}

fn arrow_expr(body: Expr) -> Expr {
    Expr::Arrow(ArrowExpr {
        span: DUMMY_SP,
        ctxt: SyntaxContext::empty(),
        params: Vec::new(),
        body: Box::new(ArrowFunctionBody::Expr(Box::new(body))),
        is_async: false,
        is_generator: false,
        type_params: None,
        return_type: None,
    })
}

fn getter_prop(key: PropName, value: Expr) -> GetterProp {
    GetterProp {
        span: DUMMY_SP,
        key,
        function: Box::new(Function {
            params: Vec::new(),
            decorators: Vec::new(),
            span: DUMMY_SP,
            ctxt: SyntaxContext::empty(),
            this_param: None,
            body: Some(FunctionBody {
                span: DUMMY_SP,
                stmts: vec![Stmt::Return(ReturnStmt {
                    span: DUMMY_SP,
                    arg: Some(Box::new(value)),
                })],
            }),
            is_generator: false,
            is_async: false,
            type_params: None,
            return_type: None,
        }),
    }
}

fn number_expr(value: f64) -> Expr {
    Expr::Lit(Lit::Num(swc_core::ecma::ast::Number {
        span: DUMMY_SP,
        value,
        raw: None,
    }))
}

fn static_expr(value: StaticValue) -> Expr {
    match value {
        StaticValue::Str(value) => string_expr(&value),
        StaticValue::Num(value) => number_expr(value),
        StaticValue::Bool(value) => Expr::Lit(Lit::Bool(swc_core::ecma::ast::Bool {
            span: DUMMY_SP,
            value,
        })),
        StaticValue::Null => Expr::Lit(Lit::Null(swc_core::ecma::ast::Null { span: DUMMY_SP })),
    }
}

fn static_value(expr: &Expr) -> Option<StaticValue> {
    match unwrap_paren(expr) {
        Expr::Lit(Lit::Str(value)) => {
            Some(StaticValue::Str(value.value.to_string_lossy().into_owned()))
        }
        Expr::Lit(Lit::Num(value)) => Some(StaticValue::Num(value.value)),
        Expr::Lit(Lit::Bool(value)) => Some(StaticValue::Bool(value.value)),
        Expr::Lit(Lit::Null(_)) => Some(StaticValue::Null),
        Expr::Ident(ident) if ident.sym == "undefined" => Some(StaticValue::Null),
        Expr::Tpl(template) if template.exprs.is_empty() => {
            let quasi = template.quasis.first()?;
            Some(StaticValue::Str(
                quasi
                    .cooked
                    .as_ref()
                    .map(|value| value.to_string_lossy().into_owned())
                    .unwrap_or_else(|| quasi.raw.to_string()),
            ))
        }
        _ => None,
    }
}

fn unwrap_paren(expr: &Expr) -> &Expr {
    match expr {
        Expr::Paren(paren) => unwrap_paren(&paren.expr),
        Expr::TsAs(value) => unwrap_paren(&value.expr),
        Expr::TsConstAssertion(value) => unwrap_paren(&value.expr),
        Expr::TsNonNull(value) => unwrap_paren(&value.expr),
        _ => expr,
    }
}

fn write_static_attr(parts: &mut TemplateParts, name: &str, value: StaticValue) {
    match value {
        StaticValue::Str(value) => {
            parts.html.push(' ');
            parts.html.push_str(name);
            parts.html.push_str("=\"");
            parts.html.push_str(&escape_attr(&value));
            parts.html.push('"');
        }
        StaticValue::Num(value) => {
            parts.html.push(' ');
            parts.html.push_str(name);
            parts.html.push_str("=\"");
            parts.html.push_str(&format_number(value));
            parts.html.push('"');
        }
        StaticValue::Bool(true) => {
            parts.html.push(' ');
            parts.html.push_str(name);
            parts.html.push_str("=\"\"");
        }
        StaticValue::Bool(false) | StaticValue::Null => {}
    }
}

fn dynamic_kind(name: &str) -> DynamicAttrKind {
    if name == "ref" {
        return DynamicAttrKind::Ref;
    }
    if name == "style" {
        return DynamicAttrKind::Style;
    }
    if name == "dangerouslySetInnerHTML" {
        return DynamicAttrKind::InnerHtml;
    }
    if name.starts_with("on") && name.len() > 2 {
        let next = name.as_bytes()[2];
        if next == b':' || next.is_ascii_uppercase() {
            return DynamicAttrKind::Event(name.to_string());
        }
    }
    DynamicAttrKind::Attr(name.to_string())
}

fn prop_name(name: &str) -> PropName {
    if is_valid_identifier(name) {
        PropName::Ident(IdentName::new(name.into(), DUMMY_SP))
    } else {
        PropName::Str(Str {
            span: DUMMY_SP,
            value: name.into(),
            raw: None,
        })
    }
}

fn is_valid_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_' || first == '$') {
        return false;
    }
    chars.all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '$')
}

fn normalize_attr_name(name: &str) -> String {
    match name {
        "className" => "class".to_string(),
        "htmlFor" => "for".to_string(),
        other => other.to_string(),
    }
}

fn attr_name_string(name: &JSXAttrName) -> String {
    match name {
        JSXAttrName::Ident(ident) => ident.sym.to_string(),
        JSXAttrName::JSXNamespacedName(namespaced) => {
            format!("{}:{}", namespaced.ns.sym, namespaced.name.sym)
        }
    }
}

fn element_name_string(name: &JSXElementName) -> String {
    match name {
        JSXElementName::Ident(ident) => ident.sym.to_string(),
        JSXElementName::JSXMemberExpr(member) => {
            format!("{}.{}", jsx_object_string(&member.obj), member.prop.sym)
        }
        JSXElementName::JSXNamespacedName(namespaced) => {
            format!("{}:{}", namespaced.ns.sym, namespaced.name.sym)
        }
    }
}

fn jsx_object_string(object: &JSXObject) -> String {
    match object {
        JSXObject::Ident(ident) => ident.sym.to_string(),
        JSXObject::JSXMemberExpr(member) => {
            format!("{}.{}", jsx_object_string(&member.obj), member.prop.sym)
        }
    }
}

fn is_component_name(name: &JSXElementName) -> bool {
    match name {
        JSXElementName::Ident(ident) => ident
            .sym
            .chars()
            .next()
            .map(|character| character.is_uppercase())
            .unwrap_or(false),
        JSXElementName::JSXMemberExpr(_) => true,
        JSXElementName::JSXNamespacedName(_) => false,
    }
}

fn process_text(text: &str) -> String {
    let mut result = String::new();
    for line in text.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !result.is_empty() {
            result.push(' ');
        }
        result.push_str(trimmed);
    }
    result
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn escape_attr(value: &str) -> String {
    escape_html(value).replace('\'', "&#39;")
}

fn format_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

fn is_void_tag(tag: &str) -> bool {
    matches!(
        tag.to_ascii_lowercase().as_str(),
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "source"
            | "track"
            | "wbr"
    )
}
