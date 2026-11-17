use super::transform::{rewrite_this, string_expr, SilentPass};
use crate::template_plan::TemplatePlan;
use swc_core::common::{SyntaxContext, DUMMY_SP};
use swc_core::ecma::ast::{
    ArrayLit, ArrowExpr, ArrowFunctionBody, AssignExpr, AssignOp, AssignTarget, BinExpr, BinaryOp,
    BindingIdent, Bool, CallExpr, Callee, ComputedPropName, Expr, ExprOrSpread, Function,
    FunctionBody, GetterProp, Ident, IdentName, JSXAttr, JSXAttrName, JSXAttrOrSpread,
    JSXAttrValue, JSXElement, JSXElementChild, JSXElementName, JSXExpr, JSXExprContainer,
    JSXFragment, JSXObject, KeyValueProp, Lit, MemberExpr, MemberProp, ObjectLit, ParenExpr, Pat,
    Prop, PropName, PropOrSpread, ReturnStmt, SimpleAssignTarget, SpreadElement, Stmt, Str,
    VarDecl, VarDeclKind, VarDeclarator,
};
use swc_core::ecma::visit::{Visit, VisitMutWith, VisitWith};

#[derive(Default)]
struct TemplateParts {
    html: String,
    holes: Vec<Expr>,
    attrs: Vec<DynamicAttr>,
    plan: TemplatePlan,
    svg: bool,
}

struct DynamicAttr {
    kind: DynamicAttrKind,
    expr: Expr,
    setter: Option<Expr>,
}

struct RcdataChildren {
    attrs: String,
    text: String,
}

enum DynamicAttrKind {
    Attr(String),
    Event(String),
    Ref,
    Style,
    Spread,
    InnerHtml,
    TextValue,
    TextContent,
    Bind(String),
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
        let svg = self.svg_context && !is_svg_name(&element.opening.name);
        let mut parts = TemplateParts {
            svg,
            ..TemplateParts::default()
        };
        self.build_element_html(element, &mut parts);
        Box::new(self.finish_template(parts))
    }

    pub(crate) fn compile_fragment(&mut self, fragment: &JSXFragment) -> Box<Expr> {
        let mut parts = TemplateParts {
            svg: self.svg_context,
            ..TemplateParts::default()
        };
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
        let svg = self.svg_context;
        self.build_element_html_in(element, parts, svg);
    }

    fn build_element_html_in(
        &mut self,
        element: &JSXElement,
        parts: &mut TemplateParts,
        svg: bool,
    ) {
        let tag = element_name_string(&element.opening.name);
        parts.plan.open_element(&tag);
        parts.html.push('<');
        parts.html.push_str(&tag);

        for attr in &element.opening.attrs {
            match attr {
                JSXAttrOrSpread::JSXAttr(attr) => self.build_html_attr(attr, &tag, parts),
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
            parts.plan.close_element();
            return;
        }

        let rcdata = if is_rcdata_tag(&tag) {
            self.build_rcdata_children(&tag, &element.children, parts)
        } else {
            None
        };
        if let Some(piece) = &rcdata {
            parts.html.push_str(&piece.attrs);
        }
        parts.html.push('>');
        if let Some(piece) = rcdata {
            parts.html.push_str(&piece.text);
            parts.html.push_str("</");
            parts.html.push_str(&tag);
            parts.html.push('>');
            parts.plan.close_element();
            return;
        }
        let children_svg = if tag.eq_ignore_ascii_case("svg") {
            true
        } else if svg && tag.eq_ignore_ascii_case("foreignObject") {
            false
        } else {
            svg
        };
        let previous = self.svg_context;
        self.svg_context = children_svg;
        self.build_children_html(&element.children, parts);
        self.svg_context = previous;
        parts.html.push_str("</");
        parts.html.push_str(&tag);
        parts.html.push('>');
        parts.plan.close_element();
    }

    fn build_rcdata_children(
        &mut self,
        tag: &str,
        children: &[JSXElementChild],
        parts: &mut TemplateParts,
    ) -> Option<RcdataChildren> {
        enum Piece {
            Text(String),
            Dynamic(Expr),
        }

        let raw_text = is_raw_text_tag(tag);
        let mut pieces: Vec<Piece> = Vec::new();
        for child in children {
            match child {
                JSXElementChild::JSXText(text) => {
                    let raw = text.value.to_string_lossy();
                    let value = if raw_text || !raw.contains('\n') {
                        raw.into_owned()
                    } else {
                        process_text(&raw)
                    };
                    if !value.is_empty() {
                        pieces.push(Piece::Text(value));
                    }
                }
                JSXElementChild::JSXExprContainer(container) => {
                    let JSXExpr::Expr(expr) = &container.expr else {
                        continue;
                    };
                    match unwrap_paren(expr) {
                        Expr::Lit(Lit::Str(value)) => {
                            let text = value.value.to_string_lossy().into_owned();
                            if !text.is_empty() {
                                pieces.push(Piece::Text(text));
                            }
                        }
                        Expr::Lit(Lit::Num(value)) => {
                            pieces.push(Piece::Text(format_number(value.value)));
                        }
                        Expr::Lit(Lit::Bool(_)) | Expr::Lit(Lit::Null(_)) => {}
                        Expr::JSXElement(_) | Expr::JSXFragment(_) => {
                            if raw_text {
                                self.report_error(raw_text_child_error(tag));
                                continue;
                            }
                            return None;
                        }
                        other => {
                            if raw_text && contains_jsx(other) {
                                self.report_error(raw_text_child_error(tag));
                                continue;
                            }
                            let compiled = self.compile_expr(other);
                            pieces.push(Piece::Dynamic(*compiled));
                        }
                    }
                }
                JSXElementChild::JSXElement(_)
                | JSXElementChild::JSXFragment(_)
                | JSXElementChild::JSXSpreadChild(_) => {
                    if raw_text {
                        self.report_error(raw_text_child_error(tag));
                        continue;
                    }
                    return None;
                }
            }
        }

        let static_only = pieces.iter().all(|piece| matches!(piece, Piece::Text(_)));

        if static_only {
            let mut text = String::new();
            for piece in pieces {
                if let Piece::Text(value) = piece {
                    text.push_str(&value);
                }
            }
            parts.plan.add_text(&text);
            return Some(RcdataChildren {
                attrs: String::new(),
                text: if text.is_empty() || raw_text {
                    text
                } else {
                    escape_html(&text)
                },
            });
        }

        let mut combined: Option<Expr> = None;
        for piece in pieces {
            let expr = match piece {
                Piece::Text(value) => string_expr(&value),
                Piece::Dynamic(expr) => expr,
            };
            combined = Some(match combined {
                None => expr,
                Some(previous) => Expr::Bin(BinExpr {
                    span: DUMMY_SP,
                    op: BinaryOp::Add,
                    left: Box::new(previous),
                    right: Box::new(expr),
                }),
            });
        }

        let expr = combined.unwrap_or_else(|| string_expr(""));
        let kind = if tag.eq_ignore_ascii_case("textarea") {
            DynamicAttrKind::TextValue
        } else {
            DynamicAttrKind::TextContent
        };
        let index = parts.attrs.len();
        let attrs = format!(" data-silent-a-{index}=\"\" data-silent-text=\"\"");
        parts.plan.mark_attr(&format!("data-silent-a-{index}"));
        parts.plan.mark_attr("data-silent-text");
        parts.attrs.push(DynamicAttr {
            kind,
            expr,
            setter: None,
        });
        Some(RcdataChildren {
            attrs,
            text: String::new(),
        })
    }

    fn build_html_attr(&mut self, attr: &JSXAttr, tag: &str, parts: &mut TemplateParts) {
        let name = attr_name_string(&attr.name);
        if name == "key" {
            return;
        }
        let name = normalize_attr_name(&name);
        if name == "bindValue" || name == "bindChecked" {
            if let Some(JSXAttrValue::JSXExprContainer(container)) = &attr.value {
                if let JSXExpr::Expr(expr) = &container.expr {
                    self.push_bind_attr(&name, expr, parts);
                }
            }
            return;
        }
        let static_value_only = name == "value" && tag.eq_ignore_ascii_case("select");
        let Some(value) = &attr.value else {
            if !static_value_only {
                write_static_attr(parts, &name, StaticValue::Bool(true));
            }
            return;
        };
        match value {
            JSXAttrValue::Str(value) => {
                if !static_value_only {
                    write_static_attr(
                        parts,
                        &name,
                        StaticValue::Str(value.value.to_string_lossy().into_owned()),
                    );
                }
            }
            JSXAttrValue::JSXExprContainer(container) => match &container.expr {
                JSXExpr::JSXEmptyExpr(_) => {}
                JSXExpr::Expr(expr) => {
                    if let Some(value) = static_value(expr) {
                        if !static_value_only {
                            write_static_attr(parts, &name, value);
                        }
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
        parts.plan.mark_attr(&format!("data-silent-a-{index}"));
        if matches!(kind, DynamicAttrKind::InnerHtml) {
            parts.html.push_str(" data-silent-text=\"\"");
            parts.plan.mark_attr("data-silent-text");
        }
        parts.attrs.push(DynamicAttr {
            kind: match kind {
                DynamicAttrKind::Attr(_) => DynamicAttrKind::Attr(name.to_string()),
                other => other,
            },
            expr,
            setter: None,
        });
    }

    fn push_bind_attr(&mut self, helper: &str, expr: &Expr, parts: &mut TemplateParts) {
        let (accessor, setter) = self.bind_parts(expr);
        let index = parts.attrs.len();
        parts.html.push_str(&format!(" data-silent-a-{index}=\"\""));
        parts.plan.mark_attr(&format!("data-silent-a-{index}"));
        parts.attrs.push(DynamicAttr {
            kind: DynamicAttrKind::Bind(helper.to_string()),
            expr: accessor,
            setter,
        });
    }

    fn bind_parts(&mut self, expr: &Expr) -> (Expr, Option<Expr>) {
        let target = unwrap_paren(expr);
        if let Expr::Array(array) = target {
            if array.elems.len() == 2
                && array.elems.iter().all(|element| {
                    matches!(
                        element,
                        Some(ExprOrSpread {
                            spread: None,
                            expr,
                        }) if is_reference(expr)
                    )
                })
            {
                let compiled = self.compile_expr(expr);
                let accessor = call_expr(computed_member((*compiled).clone(), 0), Vec::new());
                return (accessor, Some(computed_member(*compiled, 1)));
            }
        }
        if let Expr::Member(member) = target {
            let compiled = self.compile_expr(expr);
            let setter = assign_arrow(member.clone());
            return (*compiled, Some(setter));
        }
        (*self.compile_expr(expr), None)
    }

    fn build_children_html(&mut self, children: &[JSXElementChild], parts: &mut TemplateParts) {
        for child in children {
            match child {
                JSXElementChild::JSXText(text) => {
                    let value = process_text(&text.value.to_string_lossy());
                    if !value.is_empty() {
                        parts.html.push_str(&escape_html(&value));
                        parts.plan.add_text(&value);
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
                let value = value.value.to_string_lossy();
                parts.html.push_str(&escape_html(&value));
                parts.plan.add_text(&value);
            }
            Expr::Lit(Lit::Num(value)) => {
                let value = format_number(value.value);
                parts.html.push_str(&value);
                parts.plan.add_text(&value);
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
        parts.plan.add_hole(index);
    }

    fn finish_template(&mut self, parts: TemplateParts) -> Expr {
        if self.ssr && ssr_compatible(&parts) {
            return self.finish_ssr_template(parts);
        }
        let TemplateParts {
            html,
            holes,
            attrs,
            plan,
            svg,
        } = parts;
        let runtime = Expr::Ident(self.helper("templateHoles"));
        let init = match plan.finish() {
            Some(plan) => {
                let mut args = vec![string_expr(&html), plan];
                if svg {
                    args.push(string_expr("svg"));
                }
                call_expr(runtime, args)
            }
            None if svg => call_expr(
                runtime,
                vec![
                    string_expr(&html),
                    Expr::Ident(ident("undefined")),
                    string_expr("svg"),
                ],
            ),
            None => call_expr(runtime, vec![string_expr(&html)]),
        };
        let name = self.hoisted_namespaced_template(&html, svg, init);
        let clone_call = call_expr(Expr::Ident(name), Vec::new());
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

        for (index, attr) in attrs.into_iter().enumerate() {
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
                        Expr::Ident(self.helper("innerHtml")),
                        vec![element, arrow_expr(html)],
                    )
                }
                DynamicAttrKind::TextValue => call_expr(
                    Expr::Ident(self.helper("prop")),
                    vec![element, string_expr("value"), arrow_expr(attr.expr)],
                ),
                DynamicAttrKind::TextContent => call_expr(
                    Expr::Ident(self.helper("prop")),
                    vec![element, string_expr("textContent"), arrow_expr(attr.expr)],
                ),
                DynamicAttrKind::Bind(name) => {
                    let mut args = vec![element, arrow_expr(attr.expr)];
                    if let Some(setter) = attr.setter {
                        args.push(setter);
                    }
                    call_expr(Expr::Ident(self.helper(&name)), args)
                }
            };
            statements.push(Stmt::Expr(swc_core::ecma::ast::ExprStmt {
                span: DUMMY_SP,
                expr: Box::new(call),
            }));
        }

        for (index, mut expr) in holes.into_iter().enumerate() {
            let hole = computed_member(member_expr(result.clone(), "holes"), index);
            let parent = member_expr(hole.clone(), "parentNode");
            let node = member_expr(result.clone(), "node");
            let parent = Expr::Bin(BinExpr {
                span: DUMMY_SP,
                op: BinaryOp::LogicalOr,
                left: Box::new(parent),
                right: Box::new(node),
            });
            if self.attach_direct_list(&mut expr, &parent, &hole) {
                statements.push(Stmt::Expr(swc_core::ecma::ast::ExprStmt {
                    span: DUMMY_SP,
                    expr: Box::new(expr),
                }));
                continue;
            }
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

    fn finish_ssr_template(&mut self, parts: TemplateParts) -> Expr {
        let TemplateParts { html, holes, .. } = parts;
        let count = holes.len();
        let mut segments: Vec<String> = Vec::with_capacity(count + 1);
        let mut rest = html.as_str();
        for index in 0..count {
            let marker = format!("<!--silent-hole-{index}-->");
            let position = rest
                .find(&marker)
                .expect("маркер дыры должен присутствовать в шаблоне");
            segments.push(rest[..position].to_string());
            rest = &rest[position..];
        }
        segments.push(rest.to_string());
        let bare: Vec<bool> = segments[..count]
            .iter()
            .map(|segment| segment.is_empty() || segment.ends_with('>'))
            .collect();

        let name = self.hoisted_template(&html, string_array_expr(segments));
        if holes.is_empty() {
            return call_expr(
                Expr::Ident(self.helper("ssrRaw")),
                vec![computed_member(Expr::Ident(name), 0)],
            );
        }
        let mut parts_expr = computed_member(Expr::Ident(name.clone()), 0);
        for (index, hole) in holes.into_iter().enumerate() {
            let value = call_expr(
                Expr::Ident(self.helper("ssrValue")),
                vec![
                    hole,
                    Expr::Lit(Lit::Bool(Bool {
                        span: DUMMY_SP,
                        value: bare.get(index).copied().unwrap_or(false),
                    })),
                ],
            );
            parts_expr = Expr::Bin(BinExpr {
                span: DUMMY_SP,
                op: BinaryOp::Add,
                left: Box::new(parts_expr),
                right: Box::new(value),
            });
            parts_expr = Expr::Bin(BinExpr {
                span: DUMMY_SP,
                op: BinaryOp::Add,
                left: Box::new(parts_expr),
                right: Box::new(computed_member(Expr::Ident(name.clone()), index + 1)),
            });
        }
        call_expr(Expr::Ident(self.helper("ssrRaw")), vec![parts_expr])
    }

    fn hoisted_namespaced_template(&mut self, html: &str, svg: bool, init: Expr) -> Ident {
        if svg {
            self.hoisted_template(&format!("svg\u{1}{html}"), init)
        } else {
            self.hoisted_template(html, init)
        }
    }

    fn report_error(&self, message: impl Into<String>) {
        self.errors.borrow_mut().push(format!(
            "{}: {}",
            self.filename.to_string_lossy(),
            message.into()
        ));
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

        self.add_index_hint(element, &mut properties);
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

fn string_array_expr(items: Vec<String>) -> Expr {
    Expr::Array(ArrayLit {
        span: DUMMY_SP,
        elems: items
            .into_iter()
            .map(|item| {
                Some(ExprOrSpread {
                    spread: None,
                    expr: Box::new(string_expr(&item)),
                })
            })
            .collect(),
    })
}

fn ssr_compatible(parts: &TemplateParts) -> bool {
    for attr in &parts.attrs {
        if !matches!(attr.kind, DynamicAttrKind::Event(_) | DynamicAttrKind::Ref) {
            return false;
        }
    }
    let lower = parts.html.to_ascii_lowercase();
    if lower.contains("<title") || lower.contains("<meta") || lower.contains("<link") {
        return false;
    }
    let mut rest = parts.html.as_str();
    for index in 0..parts.holes.len() {
        let marker = format!("<!--silent-hole-{index}-->");
        let Some(position) = rest.find(&marker) else {
            return false;
        };
        rest = &rest[position..];
    }
    true
}

impl SilentPass {
    fn is_direct_list_component(&self, name: &Ident) -> bool {
        let Some(record) = self.imports.get(name.sym.as_ref()) else {
            return false;
        };
        if record.type_only || !matches!(record.imported.as_str(), "For" | "Index") {
            return false;
        }
        let source = record.source.trim_end_matches('/');
        source == self.runtime.trim_end_matches('/')
            || source.ends_with("silent-core")
            || source == "@ivlev-dev/silent"
    }

    fn children_use_index(&self, element: &JSXElement) -> Option<bool> {
        for child in &element.children {
            let JSXElementChild::JSXExprContainer(container) = child else {
                continue;
            };
            let JSXExpr::Expr(expr) = &container.expr else {
                continue;
            };
            match unwrap_paren(expr) {
                Expr::Arrow(arrow) => return Some(arrow.params.len() >= 2),
                Expr::Fn(function) => return Some(function.function.params.len() >= 2),
                _ => return None,
            }
        }
        None
    }

    fn add_index_hint(&self, element: &JSXElement, properties: &mut Vec<PropOrSpread>) {
        let JSXElementName::Ident(name) = &element.opening.name else {
            return;
        };
        if !self.is_direct_list_component(name) {
            return;
        }
        if self.children_use_index(element) != Some(false) {
            return;
        }
        if properties.iter().any(|prop| {
            let PropOrSpread::Prop(prop) = prop else {
                return false;
            };
            let Prop::KeyValue(entry) = &**prop else {
                return false;
            };
            let PropName::Ident(key) = &entry.key else {
                return false;
            };
            key.sym.as_ref() == "index"
        }) {
            return;
        }
        properties.push(PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
            key: prop_name("index"),
            value: Box::new(Expr::Lit(Lit::Bool(Bool {
                span: DUMMY_SP,
                value: false,
            }))),
        }))));
    }

    fn attach_direct_list(&self, expr: &mut Expr, parent: &Expr, hole: &Expr) -> bool {
        let Expr::Call(call) = expr else {
            return false;
        };
        let Callee::Expr(callee) = &call.callee else {
            return false;
        };
        let Expr::Ident(callee) = &**callee else {
            return false;
        };
        if !callee.sym.as_ref().ends_with("component") {
            return false;
        }
        let Some(first) = call.args.first() else {
            return false;
        };
        let Expr::Ident(name) = &*first.expr else {
            return false;
        };
        if !self.is_direct_list_component(name) {
            return false;
        }
        let Some(props) = call.args.get_mut(1) else {
            return false;
        };
        let Expr::Object(object) = &mut *props.expr else {
            return false;
        };
        if has_prop(object, "parent") || has_prop(object, "marker") {
            return false;
        }
        object
            .props
            .push(PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                key: prop_name("parent"),
                value: Box::new(parent.clone()),
            }))));
        object
            .props
            .push(PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                key: prop_name("marker"),
                value: Box::new(hole.clone()),
            }))));
        true
    }
}

fn has_prop(object: &ObjectLit, name: &str) -> bool {
    object.props.iter().any(|prop| {
        let PropOrSpread::Prop(prop) = prop else {
            return false;
        };
        let Prop::KeyValue(entry) = &**prop else {
            return false;
        };
        let PropName::Ident(key) = &entry.key else {
            return false;
        };
        key.sym.as_ref() == name
    })
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

fn is_reference(expr: &Expr) -> bool {
    matches!(unwrap_paren(expr), Expr::Ident(_) | Expr::Member(_))
}

fn assign_arrow(member: MemberExpr) -> Expr {
    let value = Expr::Assign(AssignExpr {
        span: DUMMY_SP,
        op: AssignOp::Assign,
        left: AssignTarget::Simple(SimpleAssignTarget::Member(member)),
        right: Box::new(ident_expr("__value$")),
    });
    Expr::Arrow(ArrowExpr {
        span: DUMMY_SP,
        ctxt: SyntaxContext::empty(),
        params: vec![Pat::Ident(BindingIdent {
            id: ident("__value$"),
            type_ann: None,
        })],
        body: Box::new(ArrowFunctionBody::Expr(Box::new(value))),
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
            if is_boolean_attr(name) {
                parts.html.push_str("=\"\"");
            } else {
                parts.html.push_str("=\"true\"");
            }
        }
        StaticValue::Bool(false) | StaticValue::Null => {}
    }
}

fn is_boolean_attr(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "hidden"
            | "autofocus"
            | "required"
            | "readonly"
            | "multiple"
            | "novalidate"
            | "async"
            | "defer"
            | "open"
            | "muted"
            | "playsinline"
            | "checked"
            | "disabled"
            | "selected"
            | "inert"
            | "loop"
            | "controls"
            | "reversed"
    )
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
    let lines: Vec<&str> = text.split('\n').collect();
    let last_non_empty = lines
        .iter()
        .rposition(|line| line.chars().any(|ch| ch != ' ' && ch != '\t' && ch != '\r'));
    let Some(last_non_empty) = last_non_empty else {
        return String::new();
    };
    let mut result = String::new();
    let last_index = lines.len() - 1;
    for (index, raw) in lines.iter().enumerate() {
        let mut line = raw.replace('\t', " ");
        if index > 0 {
            line = line.trim_start_matches(' ').to_string();
        }
        if index < last_index {
            line = line.trim_end_matches(' ').to_string();
        }
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        result.push_str(line);
        if index != last_non_empty {
            result.push(' ');
        }
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

fn is_rcdata_tag(tag: &str) -> bool {
    matches!(
        tag.to_ascii_lowercase().as_str(),
        "textarea" | "title" | "style" | "script"
    )
}

fn is_raw_text_tag(tag: &str) -> bool {
    matches!(tag.to_ascii_lowercase().as_str(), "style" | "script")
}

fn raw_text_child_error(tag: &str) -> String {
    format!(
        "элемент <{tag}> поддерживает только текстовое содержимое; используйте интерполяцию строк вместо JSX-детей"
    )
}

fn is_svg_name(name: &JSXElementName) -> bool {
    element_name_string(name).eq_ignore_ascii_case("svg")
}

fn contains_jsx(expr: &Expr) -> bool {
    struct Probe {
        found: bool,
    }

    impl Visit for Probe {
        fn visit_jsx_element(&mut self, _: &JSXElement) {
            self.found = true;
        }

        fn visit_jsx_fragment(&mut self, _: &JSXFragment) {
            self.found = true;
        }
    }

    let mut probe = Probe { found: false };
    expr.visit_with(&mut probe);
    probe.found
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
