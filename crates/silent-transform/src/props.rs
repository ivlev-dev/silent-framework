use std::collections::{HashMap, HashSet};

use swc_core::common::{SyntaxContext, DUMMY_SP};
use swc_core::ecma::ast::{
    ArrowExpr, ArrowFunctionBody, AssignExpr, AssignTarget, AssignTargetPat, BinExpr, BinaryOp,
    BindingIdent, BlockStmt, CatchClause, ClassDecl, ClassExpr, ComputedPropName, CondExpr,
    Constructor, Decl, Expr, FnDecl, FnExpr, ForHead, ForInStmt, ForOfStmt, ForStmt, Function,
    Ident, IdentName, JSXElementName, JSXMemberExpr, JSXObject, KeyValueProp, Lit, MemberExpr,
    MemberProp, ObjectPat, ObjectPatProp, ParamOrTsParamProp, Pat, Prop, PropName,
    SimpleAssignTarget, Stmt, SwitchStmt, TsParamPropParam, UpdateExpr, VarDecl, VarDeclKind,
    VarDeclOrExpr,
};
use swc_core::ecma::visit::{Visit, VisitMut, VisitMutWith, VisitWith};

#[derive(Clone)]
struct Step {
    key: MemberProp,
    default: Option<Box<Expr>>,
}

#[derive(Clone)]
struct Replacement {
    steps: Vec<Step>,
}

struct PropsDestructure<'a> {
    props_name: &'a str,
    written: &'a HashSet<String>,
    blocked: &'a HashSet<String>,
    jsx_names: &'a HashSet<String>,
    map: HashMap<String, Replacement>,
    allow_declarations: bool,
}

enum ParamMode {
    PropsIdent,
    Destructured,
}

struct VarNames {
    names: HashSet<String>,
}

impl Visit for VarNames {
    fn visit_var_decl(&mut self, decl: &VarDecl) {
        if decl.kind == VarDeclKind::Var {
            for declarator in &decl.decls {
                collect_pat_names(&declarator.name, &mut self.names);
            }
        }
        decl.visit_children_with(self);
    }

    fn visit_fn_decl(&mut self, _: &FnDecl) {}

    fn visit_fn_expr(&mut self, _: &FnExpr) {}

    fn visit_arrow_expr(&mut self, _: &ArrowExpr) {}

    fn visit_class_decl(&mut self, _: &ClassDecl) {}

    fn visit_class_expr(&mut self, _: &ClassExpr) {}
}

struct WriteCollector {
    names: HashSet<String>,
}

impl Visit for WriteCollector {
    fn visit_assign_expr(&mut self, node: &AssignExpr) {
        collect_assign_target(&node.left, &mut self.names);
        node.visit_children_with(self);
    }

    fn visit_update_expr(&mut self, node: &UpdateExpr) {
        if let Expr::Ident(ident) = &*node.arg {
            self.names.insert(ident.sym.to_string());
        }
        node.visit_children_with(self);
    }

    fn visit_for_in_stmt(&mut self, node: &swc_core::ecma::ast::ForInStmt) {
        if let ForHead::Pat(pat) = &node.left {
            collect_pat_names(pat, &mut self.names);
        }
        node.visit_children_with(self);
    }

    fn visit_for_of_stmt(&mut self, node: &swc_core::ecma::ast::ForOfStmt) {
        if let ForHead::Pat(pat) = &node.left {
            collect_pat_names(pat, &mut self.names);
        }
        node.visit_children_with(self);
    }
}

struct JsxFinder {
    found: bool,
}

impl Visit for JsxFinder {
    fn visit_expr(&mut self, expr: &Expr) {
        if self.found {
            return;
        }
        if matches!(expr, Expr::JSXElement(_) | Expr::JSXFragment(_)) {
            self.found = true;
            return;
        }
        expr.visit_children_with(self);
    }
}

struct BindingFinder {
    found: bool,
}

struct JsxNameCollector {
    names: HashSet<String>,
}

impl Visit for JsxNameCollector {
    fn visit_jsx_element_name(&mut self, name: &JSXElementName) {
        match name {
            JSXElementName::Ident(ident) => {
                let is_component = ident
                    .sym
                    .chars()
                    .next()
                    .map(|character| character.is_uppercase())
                    .unwrap_or(false);
                if is_component {
                    self.names.insert(ident.sym.to_string());
                }
            }
            JSXElementName::JSXMemberExpr(member) => {
                if let Some(ident) = jsx_object_root(&member.obj) {
                    self.names.insert(ident.sym.to_string());
                }
            }
            JSXElementName::JSXNamespacedName(_) => {}
        }
    }
}

fn jsx_object_root(object: &JSXObject) -> Option<&Ident> {
    match object {
        JSXObject::Ident(ident) => Some(ident),
        JSXObject::JSXMemberExpr(member) => jsx_object_root(&member.obj),
    }
}

impl Visit for BindingFinder {
    fn visit_binding_ident(&mut self, node: &BindingIdent) {
        if node.id.sym == "props" {
            self.found = true;
        }
    }

    fn visit_fn_decl(&mut self, node: &FnDecl) {
        if node.ident.sym == "props" {
            self.found = true;
        }
        node.function.visit_with(self);
    }

    fn visit_fn_expr(&mut self, node: &FnExpr) {
        if node
            .ident
            .as_ref()
            .is_some_and(|ident| ident.sym == "props")
        {
            self.found = true;
        }
        node.function.visit_with(self);
    }

    fn visit_class_decl(&mut self, node: &ClassDecl) {
        if node.ident.sym == "props" {
            self.found = true;
        }
        node.class.visit_with(self);
    }

    fn visit_class_expr(&mut self, node: &ClassExpr) {
        if node
            .ident
            .as_ref()
            .is_some_and(|ident| ident.sym == "props")
        {
            self.found = true;
        }
        node.class.visit_with(self);
    }
}

fn binds_props<T: VisitWith<BindingFinder>>(node: &T) -> bool {
    let mut finder = BindingFinder { found: false };
    node.visit_with(&mut finder);
    finder.found
}

pub(crate) fn rewrite_function_props(function: &mut Function) {
    let Some(body) = &function.body else {
        return;
    };
    if !has_jsx(body) || binds_props(body) {
        return;
    }
    let Some(mode) = function
        .params
        .first()
        .and_then(|param| param_mode(&param.pat))
    else {
        return;
    };
    let mut written = WriteCollector {
        names: HashSet::new(),
    };
    body.visit_with(&mut written);
    let mut var_names = VarNames {
        names: HashSet::new(),
    };
    body.visit_with(&mut var_names);
    let blocked: HashSet<String> = written.names.union(&var_names.names).cloned().collect();
    let mut jsx_names = JsxNameCollector {
        names: HashSet::new(),
    };
    body.visit_with(&mut jsx_names);

    let mut rewriter = PropsDestructure {
        props_name: "props",
        written: &written.names,
        blocked: &blocked,
        jsx_names: &jsx_names.names,
        map: HashMap::new(),
        allow_declarations: true,
    };

    if let ParamMode::Destructured = mode {
        let mut other = HashSet::new();
        for param in function.params.iter().skip(1) {
            collect_pat_names(&param.pat, &mut other);
        }
        if other.contains("props") {
            return;
        }
        let Some(param) = function.params.first_mut() else {
            return;
        };
        let Some(type_ann) = prepare_destructured_param(&mut param.pat, &mut rewriter) else {
            return;
        };
        replace_pat_with_props(&mut param.pat, type_ann);
    }

    if let Some(body) = &mut function.body {
        rewriter.process_stmts(&mut body.stmts);
    }
}

pub(crate) fn rewrite_arrow_props(arrow: &mut ArrowExpr) {
    if !has_jsx(arrow) || binds_props(&*arrow.body) {
        return;
    }
    let Some(mode) = arrow.params.first().and_then(param_mode) else {
        return;
    };

    let mut written = WriteCollector {
        names: HashSet::new(),
    };
    let mut var_names = VarNames {
        names: HashSet::new(),
    };
    match &*arrow.body {
        ArrowFunctionBody::FunctionBody(body) => {
            body.visit_with(&mut written);
            body.visit_with(&mut var_names);
        }
        ArrowFunctionBody::Expr(expr) => {
            expr.visit_with(&mut written);
        }
    }
    let blocked: HashSet<String> = written.names.union(&var_names.names).cloned().collect();
    let mut jsx_names = JsxNameCollector {
        names: HashSet::new(),
    };
    arrow.body.visit_with(&mut jsx_names);

    let mut rewriter = PropsDestructure {
        props_name: "props",
        written: &written.names,
        blocked: &blocked,
        jsx_names: &jsx_names.names,
        map: HashMap::new(),
        allow_declarations: true,
    };

    if let ParamMode::Destructured = mode {
        let mut other = HashSet::new();
        for param in arrow.params.iter().skip(1) {
            collect_pat_names(param, &mut other);
        }
        if other.contains("props") {
            return;
        }
        let Some(param) = arrow.params.first_mut() else {
            return;
        };
        let Some(type_ann) = prepare_destructured_param(param, &mut rewriter) else {
            return;
        };
        replace_pat_with_props(param, type_ann);
    }

    match &mut *arrow.body {
        ArrowFunctionBody::FunctionBody(body) => rewriter.process_stmts(&mut body.stmts),
        ArrowFunctionBody::Expr(expr) => expr.visit_mut_with(&mut rewriter),
    }
}

fn prepare_destructured_param(
    pat: &mut Pat,
    rewriter: &mut PropsDestructure<'_>,
) -> Option<Option<Box<swc_core::ecma::ast::TsTypeAnn>>> {
    let (object, type_ann) = match pat {
        Pat::Object(object) => {
            let type_ann = object.type_ann.clone();
            (object, type_ann)
        }
        Pat::Assign(assign) => match &mut *assign.left {
            Pat::Object(object) => {
                let type_ann = object.type_ann.clone();
                (object, type_ann)
            }
            _ => return None,
        },
        _ => return None,
    };
    let mut available = HashMap::new();
    let mut steps = Vec::new();
    let mut bindings = Vec::new();
    rewriter.walk_object(object, &mut steps, &mut available, &mut bindings)?;
    if bindings.is_empty() {
        return None;
    }
    for (name, replacement) in &bindings {
        if rewriter.is_blocked(name) || !rewriter.jsx_name_safe(name, replacement) {
            return None;
        }
    }
    rewriter.map = available;
    Some(type_ann)
}

fn replace_pat_with_props(pat: &mut Pat, type_ann: Option<Box<swc_core::ecma::ast::TsTypeAnn>>) {
    let ident = Ident::new("props".into(), DUMMY_SP, SyntaxContext::empty());
    let replacement = BindingIdent {
        id: ident,
        type_ann,
    };
    match pat {
        Pat::Object(_) => {
            *pat = Pat::Ident(replacement);
        }
        Pat::Assign(assign) => {
            *assign.left = Pat::Ident(replacement);
        }
        _ => {}
    }
}

fn param_mode(pat: &Pat) -> Option<ParamMode> {
    match pat {
        Pat::Ident(binding) if binding.id.sym == "props" => Some(ParamMode::PropsIdent),
        Pat::Object(_) => Some(ParamMode::Destructured),
        Pat::Assign(assign) => match &*assign.left {
            Pat::Ident(binding) if binding.id.sym == "props" => Some(ParamMode::PropsIdent),
            Pat::Object(_) => Some(ParamMode::Destructured),
            _ => None,
        },
        _ => None,
    }
}

fn has_jsx<T: VisitWith<JsxFinder>>(node: &T) -> bool {
    let mut finder = JsxFinder { found: false };
    node.visit_with(&mut finder);
    finder.found
}

fn make_props_ident(name: &str) -> Ident {
    Ident::new(name.into(), DUMMY_SP, SyntaxContext::empty())
}

fn make_undefined() -> Expr {
    Expr::Ident(Ident::new(
        "undefined".into(),
        DUMMY_SP,
        SyntaxContext::empty(),
    ))
}

fn prop_name_to_member(name: &PropName) -> Option<MemberProp> {
    match name {
        PropName::Ident(ident) => Some(MemberProp::Ident(ident.clone())),
        PropName::Str(value) => Some(MemberProp::Computed(ComputedPropName {
            span: DUMMY_SP,
            expr: Box::new(Expr::Lit(Lit::Str(value.clone()))),
        })),
        _ => None,
    }
}

fn object_supported(pattern: &ObjectPat) -> bool {
    pattern.props.iter().all(|prop| match prop {
        ObjectPatProp::Assign(_) => true,
        ObjectPatProp::KeyValue(pair) => {
            prop_name_to_member(&pair.key).is_some() && pat_supported(&pair.value)
        }
        ObjectPatProp::Rest(_) => false,
    })
}

fn pat_supported(pat: &Pat) -> bool {
    match pat {
        Pat::Ident(_) => true,
        Pat::Object(object) => object_supported(object),
        Pat::Assign(assign) => pat_supported(&assign.left),
        _ => false,
    }
}

fn props_object_pattern<'a>(stmt: &'a Stmt, props_name: &str) -> Option<&'a ObjectPat> {
    let Stmt::Decl(Decl::Var(var)) = stmt else {
        return None;
    };
    if var.kind != VarDeclKind::Const || var.decls.len() != 1 {
        return None;
    }
    let declarator = &var.decls[0];
    let Some(init) = &declarator.init else {
        return None;
    };
    let Expr::Ident(ident) = &**init else {
        return None;
    };
    if ident.sym != props_name {
        return None;
    }
    let Pat::Object(pattern) = &declarator.name else {
        return None;
    };
    object_supported(pattern).then_some(pattern)
}

fn collect_pat_names(pat: &Pat, names: &mut HashSet<String>) {
    match pat {
        Pat::Ident(binding) => {
            names.insert(binding.id.sym.to_string());
        }
        Pat::Array(array) => {
            for element in array.elems.iter().flatten() {
                collect_pat_names(element, names);
            }
        }
        Pat::Rest(rest) => collect_pat_names(&rest.arg, names),
        Pat::Object(object) => collect_object_names(object, names),
        Pat::Assign(assign) => collect_pat_names(&assign.left, names),
        Pat::Expr(_) | Pat::Invalid(_) => {}
    }
}

fn collect_object_names(object: &ObjectPat, names: &mut HashSet<String>) {
    for prop in &object.props {
        match prop {
            ObjectPatProp::KeyValue(pair) => collect_pat_names(&pair.value, names),
            ObjectPatProp::Assign(pair) => {
                names.insert(pair.key.id.sym.to_string());
            }
            ObjectPatProp::Rest(rest) => collect_pat_names(&rest.arg, names),
        }
    }
}

fn collect_assign_target(target: &AssignTarget, names: &mut HashSet<String>) {
    match target {
        AssignTarget::Simple(SimpleAssignTarget::Ident(binding)) => {
            names.insert(binding.id.sym.to_string());
        }
        AssignTarget::Simple(_) => {}
        AssignTarget::Pat(pat) => match pat {
            AssignTargetPat::Object(object) => collect_object_names(object, names),
            AssignTargetPat::Array(array) => {
                for element in array.elems.iter().flatten() {
                    collect_pat_names(element, names);
                }
            }
            AssignTargetPat::Invalid(_) => {}
        },
    }
}

fn collect_block_declared_names(stmts: &[Stmt]) -> HashSet<String> {
    let mut names = HashSet::new();
    for stmt in stmts {
        collect_stmt_decl_names(stmt, &mut names);
    }
    names
}

fn collect_stmt_decl_names(stmt: &Stmt, names: &mut HashSet<String>) {
    match stmt {
        Stmt::Decl(Decl::Var(var)) => {
            collect_var_decl_names(var, names);
        }
        Stmt::Decl(Decl::Using(decl)) => {
            for declarator in &decl.decls {
                collect_pat_names(&declarator.name, names);
            }
        }
        Stmt::Decl(Decl::Fn(decl)) => {
            names.insert(decl.ident.sym.to_string());
        }
        Stmt::Decl(Decl::Class(decl)) => {
            names.insert(decl.ident.sym.to_string());
        }
        _ => {}
    }
}

fn collect_var_decl_names(decl: &VarDecl, names: &mut HashSet<String>) {
    for declarator in &decl.decls {
        collect_pat_names(&declarator.name, names);
    }
}

fn collect_for_head_names(head: &ForHead, names: &mut HashSet<String>) {
    match head {
        ForHead::VarDecl(decl) => collect_var_decl_names(decl, names),
        ForHead::UsingDecl(decl) => {
            for declarator in &decl.decls {
                collect_pat_names(&declarator.name, names);
            }
        }
        ForHead::Pat(pat) => collect_pat_names(pat, names),
    }
}

impl<'a> PropsDestructure<'a> {
    fn is_blocked(&self, name: &str) -> bool {
        name == self.props_name || self.written.contains(name) || self.blocked.contains(name)
    }

    fn jsx_name_safe(&self, name: &str, replacement: &Replacement) -> bool {
        if !self.jsx_names.contains(name) {
            return true;
        }
        replacement
            .steps
            .iter()
            .all(|step| matches!(step.key, MemberProp::Ident(_)) && step.default.is_none())
    }

    fn jsx_element_name_for(&self, replacement: &Replacement) -> Option<JSXElementName> {
        let (last, rest) = replacement.steps.split_last()?;
        let MemberProp::Ident(last_key) = &last.key else {
            return None;
        };
        let mut object = JSXObject::Ident(make_props_ident(self.props_name));
        for step in rest {
            let MemberProp::Ident(key) = &step.key else {
                return None;
            };
            object = JSXObject::JSXMemberExpr(Box::new(JSXMemberExpr {
                span: DUMMY_SP,
                obj: object,
                prop: key.clone(),
            }));
        }
        Some(JSXElementName::JSXMemberExpr(JSXMemberExpr {
            span: DUMMY_SP,
            obj: object,
            prop: last_key.clone(),
        }))
    }

    fn jsx_object_for(&self, replacement: &Replacement) -> Option<JSXObject> {
        let (last, rest) = replacement.steps.split_last()?;
        let MemberProp::Ident(last_key) = &last.key else {
            return None;
        };
        let mut object = JSXObject::Ident(make_props_ident(self.props_name));
        for step in rest {
            let MemberProp::Ident(key) = &step.key else {
                return None;
            };
            object = JSXObject::JSXMemberExpr(Box::new(JSXMemberExpr {
                span: DUMMY_SP,
                obj: object,
                prop: key.clone(),
            }));
        }
        Some(JSXObject::JSXMemberExpr(Box::new(JSXMemberExpr {
            span: DUMMY_SP,
            obj: object,
            prop: last_key.clone(),
        })))
    }

    fn expr_for(&self, replacement: &Replacement) -> Expr {
        let mut expr = Expr::Ident(make_props_ident(self.props_name));
        for step in &replacement.steps {
            let member = Expr::Member(MemberExpr {
                span: DUMMY_SP,
                obj: Box::new(expr),
                prop: step.key.clone(),
            });
            expr = match &step.default {
                None => member,
                Some(default) => Expr::Cond(CondExpr {
                    span: DUMMY_SP,
                    test: Box::new(Expr::Bin(BinExpr {
                        span: DUMMY_SP,
                        op: BinaryOp::EqEqEq,
                        left: Box::new(member.clone()),
                        right: Box::new(make_undefined()),
                    })),
                    cons: default.clone(),
                    alt: Box::new(member),
                }),
            };
        }
        expr
    }

    fn rewrite_default(&self, expr: &Expr, available: &HashMap<String, Replacement>) -> Expr {
        let mut value = expr.clone();
        let mut rewriter = PropsDestructure {
            props_name: self.props_name,
            written: self.written,
            blocked: self.blocked,
            jsx_names: self.jsx_names,
            map: available.clone(),
            allow_declarations: false,
        };
        value.visit_mut_with(&mut rewriter);
        value
    }

    fn walk_pat(
        &self,
        pat: &Pat,
        steps: &mut Vec<Step>,
        available: &mut HashMap<String, Replacement>,
        out: &mut Vec<(String, Replacement)>,
    ) -> Option<()> {
        match pat {
            Pat::Ident(binding) => {
                let name = binding.id.sym.to_string();
                let replacement = Replacement {
                    steps: steps.clone(),
                };
                available.insert(name.clone(), replacement.clone());
                out.push((name, replacement));
                Some(())
            }
            Pat::Assign(assign) => {
                let default = self.rewrite_default(&assign.right, available);
                let step = steps.last_mut()?;
                if step.default.is_some() {
                    return None;
                }
                step.default = Some(Box::new(default));
                self.walk_pat(&assign.left, steps, available, out)
            }
            Pat::Object(object) => self.walk_object(object, steps, available, out),
            _ => None,
        }
    }

    fn walk_object(
        &self,
        object: &ObjectPat,
        steps: &mut Vec<Step>,
        available: &mut HashMap<String, Replacement>,
        out: &mut Vec<(String, Replacement)>,
    ) -> Option<()> {
        for prop in &object.props {
            match prop {
                ObjectPatProp::Assign(pair) => {
                    let name = pair.key.id.sym.to_string();
                    let default = pair
                        .value
                        .as_deref()
                        .map(|value| Box::new(self.rewrite_default(value, available)));
                    steps.push(Step {
                        key: MemberProp::Ident(IdentName::new(pair.key.id.sym.clone(), DUMMY_SP)),
                        default,
                    });
                    let replacement = Replacement {
                        steps: steps.clone(),
                    };
                    steps.pop();
                    available.insert(name.clone(), replacement.clone());
                    out.push((name, replacement));
                }
                ObjectPatProp::KeyValue(pair) => {
                    let key = prop_name_to_member(&pair.key)?;
                    steps.push(Step { key, default: None });
                    let result = self.walk_pat(&pair.value, steps, available, out);
                    steps.pop();
                    result?;
                }
                ObjectPatProp::Rest(_) => return None,
            }
        }
        Some(())
    }

    fn candidate_bindings(&self, stmt: &Stmt) -> Option<Vec<(String, Replacement)>> {
        let pattern = props_object_pattern(stmt, self.props_name)?;
        let mut available = self.map.clone();
        let mut steps = Vec::new();
        let mut bindings = Vec::new();
        self.walk_object(pattern, &mut steps, &mut available, &mut bindings)?;
        if bindings.is_empty() {
            return None;
        }
        for (name, replacement) in &bindings {
            if self.is_blocked(name) || !self.jsx_name_safe(name, replacement) {
                return None;
            }
        }
        Some(bindings)
    }

    fn process_stmts(&mut self, stmts: &mut Vec<Stmt>) {
        let flags: Vec<bool> = if self.allow_declarations {
            stmts
                .iter()
                .map(|stmt| props_object_pattern(stmt, self.props_name).is_some())
                .collect()
        } else {
            vec![false; stmts.len()]
        };

        let mut shadowed = collect_block_declared_names(stmts);
        for (stmt, flag) in stmts.iter().zip(&flags) {
            if *flag {
                if let Some(pattern) = props_object_pattern(stmt, self.props_name) {
                    let mut names = HashSet::new();
                    collect_object_names(pattern, &mut names);
                    for name in names {
                        shadowed.remove(&name);
                    }
                }
            }
        }

        if shadowed.contains(self.props_name) {
            return;
        }
        if self.blocked.contains(self.props_name) {
            return;
        }

        let saved = self.map.clone();
        for name in &shadowed {
            self.map.remove(name);
        }

        let mut output = Vec::with_capacity(stmts.len());
        for (index, mut stmt) in std::mem::take(stmts).into_iter().enumerate() {
            if flags[index] {
                if let Some(bindings) = self.candidate_bindings(&stmt) {
                    for (name, replacement) in bindings {
                        self.map.insert(name, replacement);
                    }
                    continue;
                }
                let mut names = HashSet::new();
                if let Some(pattern) = props_object_pattern(&stmt, self.props_name) {
                    collect_object_names(pattern, &mut names);
                }
                for name in names {
                    self.map.remove(&name);
                }
                output.push(stmt);
                continue;
            }
            stmt.visit_mut_with(self);
            output.push(stmt);
        }
        *stmts = output;
        self.map = saved;
    }

    fn apply_shadow(&mut self, shadowed: &HashSet<String>) {
        if shadowed.contains(self.props_name) || self.blocked.contains(self.props_name) {
            self.map.clear();
            return;
        }
        for name in shadowed {
            self.map.remove(name);
        }
    }

    fn visit_scope(
        &mut self,
        params: Vec<&Pat>,
        body: &mut Option<swc_core::ecma::ast::FunctionBody>,
    ) {
        let saved = self.map.clone();
        let saved_allow = self.allow_declarations;
        self.allow_declarations = false;
        let mut shadowed = HashSet::new();
        for param in params {
            collect_pat_names(param, &mut shadowed);
        }
        if let Some(body) = body {
            let mut vars = VarNames {
                names: HashSet::new(),
            };
            body.visit_with(&mut vars);
            shadowed.extend(vars.names);
        }
        self.apply_shadow(&shadowed);
        if let Some(body) = body {
            self.process_stmts(&mut body.stmts);
        }
        self.allow_declarations = saved_allow;
        self.map = saved;
    }
}

impl VisitMut for PropsDestructure<'_> {
    fn visit_mut_expr(&mut self, expr: &mut Expr) {
        if let Expr::Ident(ident) = expr {
            if let Some(replacement) = self.map.get(&ident.sym.to_string()) {
                *expr = self.expr_for(replacement);
                return;
            }
        }
        expr.visit_mut_children_with(self);
    }

    fn visit_mut_prop(&mut self, prop: &mut Prop) {
        if let Prop::Shorthand(ident) = prop {
            if let Some(replacement) = self.map.get(&ident.sym.to_string()) {
                let value = self.expr_for(replacement);
                let key = PropName::Ident(IdentName::new(ident.sym.clone(), ident.span));
                *prop = Prop::KeyValue(KeyValueProp {
                    key,
                    value: Box::new(value),
                });
                return;
            }
        }
        prop.visit_mut_children_with(self);
    }

    fn visit_mut_function(&mut self, function: &mut Function) {
        let params: Vec<&Pat> = function.params.iter().map(|param| &param.pat).collect();
        self.visit_scope(params, &mut function.body);
    }

    fn visit_mut_fn_expr(&mut self, node: &mut FnExpr) {
        let Some(ident) = &node.ident else {
            node.function.visit_mut_with(self);
            return;
        };
        let saved = self.map.clone();
        self.map.remove(ident.sym.as_ref());
        node.function.visit_mut_with(self);
        self.map = saved;
    }

    fn visit_mut_class_expr(&mut self, node: &mut ClassExpr) {
        let Some(ident) = &node.ident else {
            node.class.visit_mut_with(self);
            return;
        };
        let saved = self.map.clone();
        self.map.remove(ident.sym.as_ref());
        node.class.visit_mut_with(self);
        self.map = saved;
    }

    fn visit_mut_constructor(&mut self, constructor: &mut Constructor) {
        let saved = self.map.clone();
        let saved_allow = self.allow_declarations;
        self.allow_declarations = false;
        let mut shadowed = HashSet::new();
        for param in &constructor.params {
            match param {
                ParamOrTsParamProp::Param(param) => collect_pat_names(&param.pat, &mut shadowed),
                ParamOrTsParamProp::TsParamProp(prop) => match &prop.param {
                    TsParamPropParam::Ident(binding) => {
                        shadowed.insert(binding.id.sym.to_string());
                    }
                    TsParamPropParam::Assign(assign) => {
                        collect_pat_names(&assign.left, &mut shadowed);
                    }
                },
            }
        }
        if let Some(body) = &constructor.body {
            let mut vars = VarNames {
                names: HashSet::new(),
            };
            body.visit_with(&mut vars);
            shadowed.extend(vars.names);
        }
        self.apply_shadow(&shadowed);
        if let Some(body) = &mut constructor.body {
            self.process_stmts(&mut body.stmts);
        }
        self.allow_declarations = saved_allow;
        self.map = saved;
    }

    fn visit_mut_arrow_expr(&mut self, arrow: &mut ArrowExpr) {
        let saved = self.map.clone();
        let saved_allow = self.allow_declarations;
        self.allow_declarations = false;
        let mut shadowed = HashSet::new();
        for param in &arrow.params {
            collect_pat_names(param, &mut shadowed);
        }
        if let ArrowFunctionBody::FunctionBody(body) = &*arrow.body {
            let mut vars = VarNames {
                names: HashSet::new(),
            };
            body.visit_with(&mut vars);
            shadowed.extend(vars.names);
        }
        self.apply_shadow(&shadowed);
        match &mut *arrow.body {
            ArrowFunctionBody::FunctionBody(body) => self.process_stmts(&mut body.stmts),
            ArrowFunctionBody::Expr(expr) => expr.visit_mut_with(self),
        }
        self.allow_declarations = saved_allow;
        self.map = saved;
    }

    fn visit_mut_jsx_element_name(&mut self, name: &mut JSXElementName) {
        if let JSXElementName::Ident(ident) = name {
            let is_component = ident
                .sym
                .chars()
                .next()
                .map(|character| character.is_uppercase())
                .unwrap_or(false);
            if is_component {
                if let Some(replacement) = self.map.get(&ident.sym.to_string()) {
                    if let Some(rewritten) = self.jsx_element_name_for(replacement) {
                        *name = rewritten;
                        return;
                    }
                }
            }
        }
        name.visit_mut_children_with(self);
    }

    fn visit_mut_jsx_object(&mut self, object: &mut JSXObject) {
        if let JSXObject::Ident(ident) = object {
            if let Some(replacement) = self.map.get(&ident.sym.to_string()) {
                if let Some(rewritten) = self.jsx_object_for(replacement) {
                    *object = rewritten;
                    return;
                }
            }
        }
        object.visit_mut_children_with(self);
    }

    fn visit_mut_catch_clause(&mut self, clause: &mut CatchClause) {
        let saved = self.map.clone();
        if let Some(param) = &clause.param {
            let mut names = HashSet::new();
            collect_pat_names(param, &mut names);
            self.apply_shadow(&names);
        }
        clause.visit_mut_children_with(self);
        self.map = saved;
    }

    fn visit_mut_for_stmt(&mut self, node: &mut ForStmt) {
        let saved = self.map.clone();
        if let Some(VarDeclOrExpr::VarDecl(decl)) = &node.init {
            let mut names = HashSet::new();
            collect_var_decl_names(decl, &mut names);
            self.apply_shadow(&names);
        }
        node.visit_mut_children_with(self);
        self.map = saved;
    }

    fn visit_mut_for_in_stmt(&mut self, node: &mut ForInStmt) {
        let saved = self.map.clone();
        let mut names = HashSet::new();
        collect_for_head_names(&node.left, &mut names);
        self.apply_shadow(&names);
        node.visit_mut_children_with(self);
        self.map = saved;
    }

    fn visit_mut_for_of_stmt(&mut self, node: &mut ForOfStmt) {
        let saved = self.map.clone();
        let mut names = HashSet::new();
        collect_for_head_names(&node.left, &mut names);
        self.apply_shadow(&names);
        node.visit_mut_children_with(self);
        self.map = saved;
    }

    fn visit_mut_switch_stmt(&mut self, node: &mut SwitchStmt) {
        let saved = self.map.clone();
        let mut names = HashSet::new();
        for case in &node.cases {
            for stmt in &case.cons {
                collect_stmt_decl_names(stmt, &mut names);
            }
        }
        self.apply_shadow(&names);
        node.visit_mut_children_with(self);
        self.map = saved;
    }

    fn visit_mut_block_stmt(&mut self, block: &mut BlockStmt) {
        self.process_stmts(&mut block.stmts);
    }
}
