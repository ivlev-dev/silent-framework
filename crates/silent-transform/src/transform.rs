use crate::imports::{ImportKind, ImportManager};
use crate::index::Index;
use crate::paths::{module_path_without_extension, module_token, relative_specifier};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use swc_core::base::config::{Options, SourceMapsConfig};
use swc_core::base::Compiler;
use swc_core::common::comments::SingleThreadedComments;
use swc_core::common::errors::Handler;
use swc_core::common::{FileName, SourceMap, SyntaxContext, DUMMY_SP};
use swc_core::ecma::ast::{
    AssignExpr, AssignOp, AssignTarget, CallExpr, Callee, ClassDecl, ClassExpr, ClassMember,
    ClassMethod, Constructor, Decl, EsVersion, Expr, ExprOrSpread, Function, Ident, ImportDecl,
    ImportNamedSpecifier, ImportSpecifier, KeyValueProp, Lit, MemberExpr, MemberProp, MethodKind,
    Module, ModuleDecl, ModuleExportName, ModuleItem, NewExpr, ObjectLit, Param,
    ParamOrTsParamProp, Pass, Pat, Program, Prop, PropName, PropOrSpread, ReturnStmt,
    SimpleAssignTarget, Stmt, Str, TsEntityName, TsImportType, TsParamPropParam,
    TsPropertySignature, TsType, TsTypeElement, TsTypeParamInstantiation, TsTypeQueryExpr,
    TsUnionOrIntersectionType, VarDecl, VarDeclKind, VarDeclarator,
};
use swc_core::ecma::parser::Syntax;
use swc_core::ecma::transforms::proposal::DecoratorVersion;
use swc_core::ecma::visit::{VisitMut, VisitMutWith};

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SilentOptions {
    #[serde(default)]
    pub swc: serde_json::Value,
    #[serde(default)]
    pub require_preloader: bool,
    #[serde(default)]
    pub runtime: Option<String>,
    #[serde(default)]
    pub hmr: bool,
}

#[derive(Debug, Serialize)]
struct TransformResult {
    code: String,
    map: Option<String>,
    diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LocalKind {
    Value,
    Type,
}

pub(crate) struct SilentPass {
    pub(crate) filename: PathBuf,
    pub(crate) index: Index,
    pub(crate) runtime: String,
    pub(crate) require_preloader: bool,
    pub(crate) module_id: String,
    pub(crate) imports: ImportManager,
    pub(crate) locals: HashMap<String, LocalKind>,
    pub(crate) errors: Rc<RefCell<Vec<String>>>,
    pub(crate) used_helpers: HashSet<String>,
    pub(crate) metadata: Vec<ModuleItem>,
    pub(crate) view_stack: Vec<bool>,
    pub(crate) hmr: bool,
    pub(crate) hmr_deps: Vec<String>,
}

impl SilentPass {
    fn new(
        filename: &Path,
        index: Index,
        options: &SilentOptions,
        imports: ImportManager,
        errors: Rc<RefCell<Vec<String>>>,
    ) -> Self {
        Self {
            filename: filename.to_path_buf(),
            index,
            runtime: options
                .runtime
                .clone()
                .unwrap_or_else(|| "@silent/core".to_string()),
            require_preloader: options.require_preloader,
            module_id: filename.to_string_lossy().replace('\\', "/"),
            imports,
            locals: HashMap::new(),
            errors,
            used_helpers: HashSet::new(),
            metadata: Vec::new(),
            view_stack: Vec::new(),
            hmr: options.hmr,
            hmr_deps: Vec::new(),
        }
    }

    fn error(&self, message: impl Into<String>) {
        self.errors.borrow_mut().push(format!(
            "{}: {}",
            self.filename.to_string_lossy(),
            message.into()
        ));
    }

    pub(crate) fn helper(&mut self, name: &str) -> Ident {
        self.used_helpers.insert(name.to_string());
        Ident::new(format!("_${name}").into(), DUMMY_SP, SyntaxContext::empty())
    }

    fn current_module(&self) -> String {
        module_path_without_extension(&self.filename)
    }

    fn collect_locals(&mut self, module: &Module) {
        for item in &module.body {
            match item {
                ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(export)) => {
                    self.collect_decl(&export.decl);
                }
                ModuleItem::Stmt(Stmt::Decl(decl)) => {
                    self.collect_decl(decl);
                }
                ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(default)) => {
                    if let swc_core::ecma::ast::DefaultDecl::Class(class) = &default.decl {
                        if let Some(ident) = &class.ident {
                            self.locals.insert(ident.sym.to_string(), LocalKind::Value);
                            self.imports.reserve(ident.sym.as_ref());
                        }
                    }
                    if let swc_core::ecma::ast::DefaultDecl::Fn(func) = &default.decl {
                        if let Some(ident) = &func.ident {
                            self.locals.insert(ident.sym.to_string(), LocalKind::Value);
                            self.imports.reserve(ident.sym.as_ref());
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn collect_decl(&mut self, decl: &Decl) {
        match decl {
            Decl::Class(class) => {
                self.locals
                    .insert(class.ident.sym.to_string(), LocalKind::Value);
                self.imports.reserve(class.ident.sym.as_ref());
            }
            Decl::Fn(func) => {
                self.locals
                    .insert(func.ident.sym.to_string(), LocalKind::Value);
                self.imports.reserve(func.ident.sym.as_ref());
            }
            Decl::Var(var) => {
                for declarator in &var.decls {
                    if let Pat::Ident(ident) = &declarator.name {
                        self.locals
                            .insert(ident.id.sym.to_string(), LocalKind::Value);
                        self.imports.reserve(ident.id.sym.as_ref());
                    }
                }
            }
            Decl::TsEnum(enum_decl) => {
                self.locals
                    .insert(enum_decl.id.sym.to_string(), LocalKind::Value);
                self.imports.reserve(enum_decl.id.sym.as_ref());
            }
            Decl::TsInterface(interface) => {
                self.locals
                    .insert(interface.id.sym.to_string(), LocalKind::Type);
                self.imports.reserve(interface.id.sym.as_ref());
            }
            Decl::TsTypeAlias(alias) => {
                self.locals
                    .insert(alias.id.sym.to_string(), LocalKind::Type);
                self.imports.reserve(alias.id.sym.as_ref());
            }
            _ => {}
        }
    }

    fn resolve_entity_value(&mut self, entity: &TsEntityName) -> Option<Expr> {
        match entity {
            TsEntityName::Ident(ident) => {
                let name = ident.sym.to_string();
                if self.locals.get(&name) == Some(&LocalKind::Value) {
                    return Some(Expr::Ident(Ident::new(
                        name.into(),
                        DUMMY_SP,
                        SyntaxContext::empty(),
                    )));
                }
                if let Some(import) = self.imports.get(&name).cloned() {
                    if import.kind == ImportKind::Namespace {
                        self.error(format!(
                            "namespace import {name} нельзя использовать как тип внедрения"
                        ));
                        return None;
                    }
                    return self.resolve_imported_type(
                        &import.source,
                        &import.imported,
                        import.type_only,
                    );
                }
                if self.locals.get(&name) == Some(&LocalKind::Type) {
                    return self.resolve_interface_value(&name);
                }
                None
            }
            TsEntityName::TsQualifiedName(qualified) => {
                let TsEntityName::Ident(left) = &qualified.left else {
                    self.error("сложное квалифицированное имя типа не поддерживается");
                    return None;
                };
                let left_name = left.sym.to_string();
                let export = qualified.right.sym.to_string();
                if let Some(import) = self.imports.get(&left_name).cloned() {
                    let local =
                        self.imports
                            .add_value_import(&self.filename, &import.source, &export);
                    return Some(Expr::Ident(local));
                }
                self.error(format!("не удалось разрешить {left_name}.{export}"));
                None
            }
        }
    }

    fn resolve_imported_type(
        &mut self,
        source: &str,
        imported: &str,
        type_only: bool,
    ) -> Option<Expr> {
        if source.starts_with('.') {
            let module = crate::paths::resolve_import_path(&self.filename, source)?;
            if module != self.current_module() && self.hmr {
                self.record_hmr_dep(&module);
            }
            let token = format!("{module}#{imported}");
            if let Some(list) = self.index.implementations(&token).cloned() {
                return self.resolve_implementation_list(&token, list);
            }
            let has_value = self.index.has_value_export(&module, imported);
            let no_index = self.index.interfaces.is_empty() && self.index.values.is_empty();
            if has_value || !type_only || no_index {
                let local = self
                    .imports
                    .add_value_import(&self.filename, source, imported);
                return Some(Expr::Ident(local));
            }
            self.error(format!(
                "для типа {token} не найдено реализации и value-экспорта"
            ));
            return None;
        }
        let local = self
            .imports
            .add_value_import(&self.filename, source, imported);
        Some(Expr::Ident(local))
    }

    fn resolve_implementation_list(
        &mut self,
        token: &str,
        implementations: Vec<String>,
    ) -> Option<Expr> {
        if implementations.is_empty() {
            self.error(format!("для интерфейса {token} не найдено реализации"));
            return None;
        }
        if implementations.len() > 1 {
            self.error(format!(
                "для интерфейса {token} найдено несколько реализаций: {}; укажите явный bind",
                implementations.join(", ")
            ));
            return None;
        }
        let implementation = implementations.first()?.clone();
        let (module, class_name) = split_token(&implementation)?;
        if module == self.current_module() {
            return Some(Expr::Ident(Ident::new(
                class_name.into(),
                DUMMY_SP,
                SyntaxContext::empty(),
            )));
        }
        let relative = relative_specifier(&self.filename, &module);
        if self.hmr {
            self.record_hmr_dep(&module);
        }
        let local = self
            .imports
            .add_value_import(&self.filename, &relative, &class_name);
        Some(Expr::Ident(local))
    }

    fn record_hmr_dep(&mut self, module: &str) {
        let relative = relative_specifier(&self.filename, module);
        if !self
            .hmr_deps
            .iter()
            .any(|dependency| dependency == &relative)
        {
            self.hmr_deps.push(relative);
        }
    }

    fn resolve_interface_value(&mut self, name: &str) -> Option<Expr> {
        let token = module_token(&self.filename, name);
        let implementations = self.index.implementations(&token).cloned();
        match implementations {
            Some(list) => self.resolve_implementation_list(&token, list),
            None => {
                let module = self.current_module();
                if self.index.has_value_export(&module, name) {
                    return Some(Expr::Ident(Ident::new(
                        name.into(),
                        DUMMY_SP,
                        SyntaxContext::empty(),
                    )));
                }
                self.error(format!("для интерфейса {token} не найдено реализации"));
                None
            }
        }
    }

    fn resolve_type_value(&mut self, ty: &TsType, allow_interface: bool) -> Option<Expr> {
        match ty {
            TsType::TsTypeRef(reference) => {
                if reference.type_params.is_some() {
                    return None;
                }
                self.resolve_entity_value(&reference.type_name)
            }
            TsType::TsTypeQuery(query) => match &query.expr_name {
                TsTypeQueryExpr::TsEntityName(entity) => self.resolve_entity_value(entity),
                TsTypeQueryExpr::Import(import) => self.resolve_import_type(import),
            },
            TsType::TsParenthesizedType(paren) => {
                self.resolve_type_value(&paren.type_ann, allow_interface)
            }
            TsType::TsKeywordType(_) => None,
            TsType::TsTypeLit(_) => None,
            _ => None,
        }
    }

    fn resolve_import_type(&mut self, import: &TsImportType) -> Option<Expr> {
        let source = import.arg.value.to_string_lossy().into_owned();
        let module = if source.starts_with('.') {
            crate::paths::resolve_import_path(&self.filename, &source)?
        } else {
            source.clone()
        };
        let export = import
            .qualifier
            .as_ref()
            .map(entity_name_string)
            .unwrap_or_else(|| "default".to_string());
        let local = self
            .imports
            .add_value_import(&self.filename, &module, &export);
        Some(Expr::Ident(local))
    }

    fn transform_class(&mut self, class: &mut swc_core::ecma::ast::Class) {
        if class.is_abstract {
            return;
        }
        let Some(constructor) = class.body.iter().find_map(|member| match member {
            ClassMember::Constructor(constructor) => Some(constructor),
            _ => None,
        }) else {
            return;
        };
        if matches!(
            constructor.accessibility,
            Some(swc_core::ecma::ast::Accessibility::Private)
        ) {
            return;
        }
        let dependencies = self.constructor_dependencies(constructor);
        let Some(dependencies) = dependencies else {
            return;
        };
        if dependencies.is_empty() {
            return;
        }
        if class.body.iter().any(has_di_create) {
            return;
        }
        let method = build_di_create(dependencies);
        class.body.push(ClassMember::Method(method));
    }

    fn constructor_dependencies(&mut self, constructor: &Constructor) -> Option<Vec<Expr>> {
        let mut dependencies = Vec::new();
        for param in &constructor.params {
            let (ident, type_ann) = match param {
                ParamOrTsParamProp::Param(param) => match &param.pat {
                    Pat::Ident(binding) => (&binding.id, binding.type_ann.as_ref()),
                    Pat::Assign(assign) => match &*assign.left {
                        Pat::Ident(binding) => (&binding.id, binding.type_ann.as_ref()),
                        _ => return None,
                    },
                    _ => return None,
                },
                ParamOrTsParamProp::TsParamProp(prop) => match &prop.param {
                    TsParamPropParam::Ident(binding) => (&binding.id, binding.type_ann.as_ref()),
                    TsParamPropParam::Assign(assign) => match &*assign.left {
                        Pat::Ident(binding) => (&binding.id, binding.type_ann.as_ref()),
                        _ => return None,
                    },
                },
            };
            let Some(type_ann) = type_ann else {
                return None;
            };
            let Some(dependency) = self.resolve_type_value(&type_ann.type_ann, true) else {
                return None;
            };
            if ident.sym == "this" {
                return None;
            }
            dependencies.push(dependency);
        }
        Some(dependencies)
    }

    fn collect_component_metadata(&mut self, module: &Module) {
        for item in &module.body {
            match item {
                ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(export)) => match &export.decl {
                    Decl::Fn(func) => {
                        self.component_metadata(&func.ident, &func.function);
                    }
                    Decl::Var(var) => {
                        self.var_component_metadata(var);
                    }
                    _ => {}
                },
                ModuleItem::Stmt(Stmt::Decl(Decl::Fn(func))) => {
                    self.component_metadata(&func.ident, &func.function);
                }
                ModuleItem::Stmt(Stmt::Decl(Decl::Var(var))) => {
                    self.var_component_metadata(var);
                }
                ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(default)) => {
                    if let swc_core::ecma::ast::DefaultDecl::Fn(func) = &default.decl {
                        if let Some(ident) = &func.ident {
                            self.component_metadata(ident, &func.function);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn var_component_metadata(&mut self, var: &VarDecl) {
        for declarator in &var.decls {
            let Some(init) = &declarator.init else {
                continue;
            };
            let Pat::Ident(binding) = &declarator.name else {
                continue;
            };
            if let Expr::Fn(function) = &**init {
                self.component_metadata(&binding.id, &function.function);
            }
        }
    }

    fn component_metadata(&mut self, name: &Ident, function: &Function) {
        let Some(this_type) = this_parameter_type(function) else {
            return;
        };
        let Some((vm_type, preloader_type)) = view_context_types(this_type) else {
            return;
        };
        let Some(vm) = self.resolve_type_value(&vm_type, true) else {
            self.error(format!(
                "компонент {}: не удалось разрешить класс ViewModel",
                name.sym
            ));
            return;
        };
        let preloader = preloader_type
            .as_ref()
            .and_then(|value| self.resolve_type_value(value, false));
        let preloader_name = preloader_type.as_ref().and_then(type_value_name);
        if self.require_preloader && preloader.is_none() {
            self.error(format!(
                "компонент {}: обязателен preloader в this-типе",
                name.sym
            ));
        }
        let mut properties: Vec<PropOrSpread> = Vec::new();
        properties.push(PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
            key: PropName::Ident(swc_core::ecma::ast::IdentName::new("vm".into(), DUMMY_SP)),
            value: Box::new(vm),
        }))));
        if let Some(preloader) = preloader {
            properties.push(PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                key: PropName::Ident(swc_core::ecma::ast::IdentName::new(
                    "preloader".into(),
                    DUMMY_SP,
                )),
                value: Box::new(preloader),
            }))));
        }
        if let Some(preloader_name) = preloader_name {
            properties.push(PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                key: PropName::Ident(swc_core::ecma::ast::IdentName::new(
                    "preloaderName".into(),
                    DUMMY_SP,
                )),
                value: Box::new(string_expr(&preloader_name)),
            }))));
        }
        properties.push(PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
            key: PropName::Ident(swc_core::ecma::ast::IdentName::new("name".into(), DUMMY_SP)),
            value: Box::new(string_expr(name.sym.as_ref())),
        }))));
        properties.push(PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
            key: PropName::Ident(swc_core::ecma::ast::IdentName::new(
                "moduleId".into(),
                DUMMY_SP,
            )),
            value: Box::new(string_expr(&self.module_id)),
        }))));
        let meta = Expr::Object(ObjectLit {
            span: DUMMY_SP,
            props: properties,
        });
        let target = Expr::Member(MemberExpr {
            span: DUMMY_SP,
            obj: Box::new(Expr::Ident(name.clone())),
            prop: MemberProp::Computed(swc_core::ecma::ast::ComputedPropName {
                span: DUMMY_SP,
                expr: Box::new(symbol_for("silent.view")),
            }),
        });
        let Expr::Member(member) = target else {
            return;
        };
        let statement = Stmt::Expr(swc_core::ecma::ast::ExprStmt {
            span: DUMMY_SP,
            expr: Box::new(Expr::Assign(AssignExpr {
                span: DUMMY_SP,
                op: AssignOp::Assign,
                left: AssignTarget::Simple(SimpleAssignTarget::Member(member)),
                right: Box::new(meta),
            })),
        });
        self.metadata.push(ModuleItem::Stmt(statement));
    }

    fn append_module_items(&mut self, module: &mut Module) {
        if self.hmr && !self.metadata.is_empty() {
            if let Some(import) = self.build_hmr_import() {
                module
                    .body
                    .insert(0, ModuleItem::ModuleDecl(ModuleDecl::Import(import)));
            }
        }
        let imports = self.build_helper_import();
        if let Some(import) = imports {
            module
                .body
                .insert(0, ModuleItem::ModuleDecl(ModuleDecl::Import(import)));
        }
        for import in self.imports.take_imports() {
            module
                .body
                .insert(0, ModuleItem::ModuleDecl(ModuleDecl::Import(import)));
        }
        let metadata = std::mem::take(&mut self.metadata);
        let has_metadata = !metadata.is_empty();
        module.body.extend(metadata);
        if self.hmr && has_metadata {
            if let Ok(statement) = build_hmr_statement(&self.module_id, &self.hmr_deps) {
                module.body.push(ModuleItem::Stmt(statement));
            } else {
                self.error("не удалось сгенерировать HMR-код");
            }
        }
    }

    fn build_hmr_import(&self) -> Option<ImportDecl> {
        let runtime = if self.runtime.ends_with("/hmr") {
            self.runtime.clone()
        } else {
            format!("{}/hmr", self.runtime.trim_end_matches('/'))
        };
        Some(ImportDecl {
            span: DUMMY_SP,
            specifiers: vec![
                ImportSpecifier::Named(ImportNamedSpecifier {
                    span: DUMMY_SP,
                    local: Ident::new("_hmrUpdate".into(), DUMMY_SP, SyntaxContext::empty()),
                    imported: Some(ModuleExportName::Ident(Ident::new(
                        "hmrUpdate".into(),
                        DUMMY_SP,
                        SyntaxContext::empty(),
                    ))),
                    is_type_only: false,
                }),
                ImportSpecifier::Named(ImportNamedSpecifier {
                    span: DUMMY_SP,
                    local: Ident::new("_hmrInvalidate".into(), DUMMY_SP, SyntaxContext::empty()),
                    imported: Some(ModuleExportName::Ident(Ident::new(
                        "hmrInvalidate".into(),
                        DUMMY_SP,
                        SyntaxContext::empty(),
                    ))),
                    is_type_only: false,
                }),
            ],
            src: Box::new(Str {
                span: DUMMY_SP,
                value: runtime.into(),
                raw: None,
            }),
            type_only: false,
            with: None,
            phase: Default::default(),
        })
    }

    fn build_helper_import(&mut self) -> Option<ImportDecl> {
        if self.used_helpers.is_empty() {
            return None;
        }
        let runtime = if self.runtime.ends_with("/jsx-runtime") {
            self.runtime.clone()
        } else {
            format!("{}/jsx-runtime", self.runtime.trim_end_matches('/'))
        };
        let mut names: Vec<&String> = self.used_helpers.iter().collect();
        names.sort();
        let specifiers = names
            .into_iter()
            .map(|name| {
                ImportSpecifier::Named(ImportNamedSpecifier {
                    span: DUMMY_SP,
                    local: Ident::new(format!("_${name}").into(), DUMMY_SP, SyntaxContext::empty()),
                    imported: Some(ModuleExportName::Ident(Ident::new(
                        name.as_str().into(),
                        DUMMY_SP,
                        SyntaxContext::empty(),
                    ))),
                    is_type_only: false,
                })
            })
            .collect();
        Some(ImportDecl {
            span: DUMMY_SP,
            specifiers,
            src: Box::new(Str {
                span: DUMMY_SP,
                value: runtime.into(),
                raw: None,
            }),
            type_only: false,
            with: None,
            phase: Default::default(),
        })
    }
}

impl VisitMut for SilentPass {
    fn visit_mut_expr(&mut self, expr: &mut Expr) {
        match expr {
            Expr::JSXElement(element) => {
                let compiled = self.compile_element(element);
                *expr = *compiled;
            }
            Expr::JSXFragment(fragment) => {
                let compiled = self.compile_fragment(fragment);
                *expr = *compiled;
            }
            _ => expr.visit_mut_children_with(self),
        }
    }

    fn visit_mut_fn_decl(&mut self, node: &mut swc_core::ecma::ast::FnDecl) {
        let is_view = has_view_this(node.function.this_param.as_deref());
        if is_view {
            inject_this_alias(&mut node.function);
        }
        self.view_stack.push(is_view);
        node.visit_mut_children_with(self);
        self.view_stack.pop();
    }

    fn visit_mut_fn_expr(&mut self, node: &mut swc_core::ecma::ast::FnExpr) {
        let is_view = has_view_this(node.function.this_param.as_deref());
        if is_view {
            inject_this_alias(&mut node.function);
        }
        self.view_stack.push(is_view);
        node.visit_mut_children_with(self);
        self.view_stack.pop();
    }

    fn visit_mut_class_decl(&mut self, class: &mut ClassDecl) {
        self.transform_class(&mut class.class);
        class.visit_mut_children_with(self);
    }

    fn visit_mut_class_expr(&mut self, class: &mut ClassExpr) {
        self.transform_class(&mut class.class);
        class.visit_mut_children_with(self);
    }

    fn visit_mut_call_expr(&mut self, call: &mut CallExpr) {
        let mut resolve_type_args: Option<Box<TsTypeParamInstantiation>> = None;
        let mut is_resolve = false;
        match &mut call.callee {
            Callee::Expr(callee) => match &mut **callee {
                Expr::Member(member) => {
                    if let MemberProp::Ident(property) = &member.prop {
                        if property.sym == "resolve" {
                            is_resolve = true;
                            resolve_type_args = call.type_args.take();
                        }
                    }
                }
                Expr::TsInstantiation(instantiation) => {
                    if let Expr::Member(member) = &mut *instantiation.expr {
                        if let MemberProp::Ident(property) = &member.prop {
                            if property.sym == "resolve" {
                                is_resolve = true;
                                resolve_type_args = Some(instantiation.type_args.clone());
                                let replacement = std::mem::replace(
                                    &mut *instantiation.expr,
                                    Expr::Invalid(swc_core::ecma::ast::Invalid { span: DUMMY_SP }),
                                );
                                *callee = Box::new(replacement);
                            }
                        }
                    }
                }
                _ => {}
            },
            _ => {}
        }
        if is_resolve {
            if let Some(type_args) = resolve_type_args {
                if type_args.params.len() == 1 {
                    if let Some(ty) = type_args.params.first() {
                        if let Some(value) = self.resolve_type_value(ty, true) {
                            call.args = vec![ExprOrSpread {
                                spread: None,
                                expr: Box::new(value),
                            }];
                        }
                    }
                }
            }
            call.type_args = None;
        }
        call.visit_mut_children_with(self);
    }
}

impl swc_core::ecma::ast::Pass for SilentPass {
    fn process(&mut self, program: &mut Program) {
        let Program::Module(module) = program else {
            return;
        };
        self.collect_locals(module);
        self.collect_component_metadata(module);
        module.visit_mut_with(self);
        self.append_module_items(module);
    }
}

fn has_view_this(this_param: Option<&swc_core::ecma::ast::TsThisParam>) -> bool {
    let Some(type_ann) = this_param.and_then(|param| param.type_ann.as_ref()) else {
        return false;
    };
    view_context_types(type_ann.type_ann.as_ref()).is_some()
}

fn inject_this_alias(function: &mut Function) {
    let Some(body) = &mut function.body else {
        return;
    };
    if body.stmts.iter().any(|statement| {
        let Stmt::Decl(Decl::Var(var)) = statement else {
            return false;
        };
        var.decls.iter().any(|declarator| {
            matches!(&declarator.name, Pat::Ident(binding) if binding.id.sym == "_this$")
        })
    }) {
        return;
    }
    let declaration = Stmt::Decl(Decl::Var(Box::new(VarDecl {
        span: DUMMY_SP,
        ctxt: SyntaxContext::empty(),
        kind: VarDeclKind::Const,
        declare: false,
        decls: vec![VarDeclarator {
            span: DUMMY_SP,
            name: Pat::Ident(swc_core::ecma::ast::BindingIdent {
                id: Ident::new("_this$".into(), DUMMY_SP, SyntaxContext::empty()),
                type_ann: None,
            }),
            definite: false,
            init: Some(Box::new(Expr::This(swc_core::ecma::ast::ThisExpr {
                span: DUMMY_SP,
            }))),
        }],
    })));
    body.stmts.insert(0, declaration);
}

pub(crate) struct ThisRewriter;

impl VisitMut for ThisRewriter {
    fn visit_mut_expr(&mut self, expr: &mut Expr) {
        if matches!(expr, Expr::This(_)) {
            *expr = Expr::Ident(Ident::new(
                "_this$".into(),
                DUMMY_SP,
                SyntaxContext::empty(),
            ));
            return;
        }
        if matches!(expr, Expr::Fn(_)) {
            return;
        }
        expr.visit_mut_children_with(self);
    }
}

pub(crate) fn rewrite_this(expr: &mut Expr) {
    expr.visit_mut_with(&mut ThisRewriter);
}

fn has_di_create(member: &ClassMember) -> bool {
    let ClassMember::Method(method) = member else {
        return false;
    };
    if !method.is_static {
        return false;
    }
    let PropName::Computed(computed) = &method.key else {
        return false;
    };
    let Expr::Call(call) = &*computed.expr else {
        return false;
    };
    let Callee::Expr(callee) = &call.callee else {
        return false;
    };
    let Expr::Member(member) = &**callee else {
        return false;
    };
    let Expr::Ident(object) = &*member.obj else {
        return false;
    };
    let MemberProp::Ident(property) = &member.prop else {
        return false;
    };
    object.sym == "Symbol" && property.sym == "for"
}

fn build_di_create(dependencies: Vec<Expr>) -> ClassMethod {
    let container = Ident::new("container".into(), DUMMY_SP, SyntaxContext::empty());
    let args = dependencies
        .into_iter()
        .map(|dependency| {
            let resolve_call = Expr::Call(CallExpr {
                span: DUMMY_SP,
                callee: Callee::Expr(Box::new(Expr::Member(MemberExpr {
                    span: DUMMY_SP,
                    obj: Box::new(Expr::Ident(container.clone())),
                    prop: MemberProp::Ident(swc_core::ecma::ast::IdentName::new(
                        "resolve".into(),
                        DUMMY_SP,
                    )),
                }))),
                args: vec![ExprOrSpread {
                    spread: None,
                    expr: Box::new(dependency),
                }],
                type_args: None,
                ctxt: SyntaxContext::empty(),
            });
            ExprOrSpread {
                spread: None,
                expr: Box::new(Expr::Await(swc_core::ecma::ast::AwaitExpr {
                    span: DUMMY_SP,
                    arg: Box::new(resolve_call),
                })),
            }
        })
        .collect();
    let new_expr = Expr::New(NewExpr {
        span: DUMMY_SP,
        ctxt: SyntaxContext::empty(),
        callee: Box::new(Expr::This(swc_core::ecma::ast::ThisExpr { span: DUMMY_SP })),
        args: Some(args),
        type_args: None,
    });
    let body = swc_core::ecma::ast::FunctionBody {
        span: DUMMY_SP,
        stmts: vec![Stmt::Return(ReturnStmt {
            span: DUMMY_SP,
            arg: Some(Box::new(new_expr)),
        })],
    };
    ClassMethod {
        span: DUMMY_SP,
        key: PropName::Computed(swc_core::ecma::ast::ComputedPropName {
            span: DUMMY_SP,
            expr: Box::new(symbol_for("silent.di.create")),
        }),
        function: Box::new(Function {
            params: vec![Param {
                pat: Pat::Ident(swc_core::ecma::ast::BindingIdent {
                    id: container,
                    type_ann: None,
                }),
                decorators: Vec::new(),
                span: DUMMY_SP,
            }],
            decorators: Vec::new(),
            span: DUMMY_SP,
            ctxt: SyntaxContext::empty(),
            this_param: None,
            body: Some(body),
            is_generator: false,
            is_async: true,
            type_params: None,
            return_type: None,
        }),
        kind: MethodKind::Method,
        is_static: true,
        accessibility: None,
        is_abstract: false,
        is_optional: false,
        is_override: false,
    }
}

fn symbol_for(name: &str) -> Expr {
    Expr::Call(CallExpr {
        span: DUMMY_SP,
        callee: Callee::Expr(Box::new(Expr::Member(MemberExpr {
            span: DUMMY_SP,
            obj: Box::new(Expr::Ident(Ident::new(
                "Symbol".into(),
                DUMMY_SP,
                SyntaxContext::empty(),
            ))),
            prop: MemberProp::Ident(swc_core::ecma::ast::IdentName::new("for".into(), DUMMY_SP)),
        }))),
        args: vec![ExprOrSpread {
            spread: None,
            expr: Box::new(string_expr(name)),
        }],
        type_args: None,
        ctxt: SyntaxContext::empty(),
    })
}

pub(crate) fn string_expr(value: &str) -> Expr {
    Expr::Lit(Lit::Str(Str {
        span: DUMMY_SP,
        value: value.into(),
        raw: None,
    }))
}

fn this_parameter_type(function: &Function) -> Option<&TsType> {
    let this_param = function.this_param.as_ref()?;
    let type_ann = this_param.type_ann.as_ref()?;
    Some(type_ann.type_ann.as_ref())
}

fn view_context_types(ty: &TsType) -> Option<(TsType, Option<TsType>)> {
    match ty {
        TsType::TsTypeLit(lit) => {
            let vm = find_property_type(&lit.members, "vm")?;
            let preloader = find_property_type(&lit.members, "preloader")
                .or_else(|| find_property_type(&lit.members, "fallback"));
            Some((vm, preloader))
        }
        TsType::TsTypeRef(reference) => {
            let TsEntityName::Ident(name) = &reference.type_name else {
                return None;
            };
            if name.sym != "ViewContext" {
                return None;
            }
            let params = reference.type_params.as_ref()?;
            let vm = params.params.first()?.as_ref().clone();
            let preloader = params.params.get(1).map(|value| value.as_ref().clone());
            Some((vm, preloader))
        }
        TsType::TsParenthesizedType(paren) => view_context_types(&paren.type_ann),
        TsType::TsUnionOrIntersectionType(TsUnionOrIntersectionType::TsIntersectionType(
            intersection,
        )) => {
            let mut vm = None;
            let mut preloader = None;
            for member in &intersection.types {
                if let TsType::TsTypeLit(lit) = &**member {
                    if let Some(found) = find_property_type(&lit.members, "vm") {
                        vm = Some(found);
                    }
                    if let Some(found) = find_property_type(&lit.members, "preloader") {
                        preloader = Some(found);
                    }
                }
            }
            Some((vm?, preloader))
        }
        _ => None,
    }
}

fn find_property_type(members: &[TsTypeElement], name: &str) -> Option<TsType> {
    for member in members {
        let TsTypeElement::TsPropertySignature(property) = member else {
            continue;
        };
        if property_key(property) == Some(name.to_string()) {
            if let Some(type_ann) = &property.type_ann {
                return Some(type_ann.type_ann.as_ref().clone());
            }
        }
    }
    None
}

fn property_key(property: &TsPropertySignature) -> Option<String> {
    match &*property.key {
        Expr::Ident(ident) => Some(ident.sym.to_string()),
        Expr::Lit(Lit::Str(value)) => Some(value.value.to_string_lossy().into_owned()),
        _ => None,
    }
}

fn type_value_name(ty: &TsType) -> Option<String> {
    match ty {
        TsType::TsTypeRef(reference) => entity_local_name(&reference.type_name),
        TsType::TsTypeQuery(query) => match &query.expr_name {
            TsTypeQueryExpr::TsEntityName(entity) => entity_local_name(entity),
            TsTypeQueryExpr::Import(import) => {
                import.qualifier.as_ref().and_then(entity_local_name)
            }
        },
        TsType::TsParenthesizedType(paren) => type_value_name(&paren.type_ann),
        _ => None,
    }
}

fn entity_local_name(entity: &TsEntityName) -> Option<String> {
    match entity {
        TsEntityName::Ident(ident) => Some(ident.sym.to_string()),
        TsEntityName::TsQualifiedName(qualified) => Some(qualified.right.sym.to_string()),
    }
}

fn entity_name_string(entity: &TsEntityName) -> String {
    match entity {
        TsEntityName::Ident(ident) => ident.sym.to_string(),
        TsEntityName::TsQualifiedName(qualified) => {
            format!(
                "{}.{}",
                entity_name_string(&qualified.left),
                qualified.right.sym
            )
        }
    }
}

fn split_token(token: &str) -> Option<(String, String)> {
    let index = token.rfind('#')?;
    Some((token[..index].to_string(), token[index + 1..].to_string()))
}

pub fn transform(
    source: &str,
    filename: &str,
    options_json: &str,
    index_json: &str,
) -> Result<String, String> {
    swc_core::common::GLOBALS.set(&swc_core::common::Globals::new(), || {
        transform_inner(source, filename, options_json, index_json)
    })
}

fn transform_inner(
    source: &str,
    filename: &str,
    options_json: &str,
    index_json: &str,
) -> Result<String, String> {
    let options: SilentOptions = if options_json.trim().is_empty() {
        SilentOptions::default()
    } else {
        serde_json::from_str(options_json).map_err(|error| error.to_string())?
    };
    let index: Index = if index_json.trim().is_empty() {
        Index::default()
    } else {
        serde_json::from_str(index_json).map_err(|error| error.to_string())?
    };

    let mut swc_options = if options.swc.is_null() {
        Options::default()
    } else {
        serde_json::from_value::<Options>(options.swc.clone())
            .map_err(|error| format!("SWC options: {error}"))?
    };
    if swc_options.config.jsc.syntax.is_none() {
        swc_options.config.jsc.syntax =
            Some(Syntax::Typescript(swc_core::ecma::parser::TsSyntax {
                tsx: filename.ends_with(".tsx") || filename.ends_with(".jsx"),
                decorators: true,
                ..Default::default()
            }));
    }
    let path = PathBuf::from(filename);
    swc_options.config.adjust(&path);
    if swc_options.config.jsc.target.is_none() && swc_options.config.env.is_none() {
        swc_options.config.jsc.target = Some(EsVersion::Es2024);
    }
    let mut transform_config = swc_options
        .config
        .jsc
        .transform
        .as_ref()
        .cloned()
        .unwrap_or_default();
    if transform_config.decorator_version.is_none() {
        transform_config.decorator_version = Some(DecoratorVersion::V202311);
    }
    swc_options.config.jsc.transform = Some(transform_config).into();

    if swc_options.config.source_maps.is_none() {
        swc_options.config.source_maps = Some(SourceMapsConfig::Bool(true));
    }
    swc_options.swcrc = false;
    swc_options.filename = filename.to_string();

    let source_map = std::sync::Arc::new(SourceMap::default());
    let file = source_map.new_source_file(FileName::Real(path.clone()).into(), source.to_string());
    let comments = SingleThreadedComments::default();
    let handler = Handler::with_emitter_writer(Box::new(std::io::sink()), Some(source_map.clone()));
    let compiler = Compiler::new(source_map.clone());

    let module = parse_module(&source_map, &file, filename, &swc_options)?;
    let imports = ImportManager::new(&module);
    let errors = Rc::new(RefCell::new(Vec::new()));
    let mut pass = SilentPass::new(&path, index, &options, imports, errors.clone());

    let mut program = Program::Module(module);
    pass.process(&mut program);

    let output = compiler
        .process_js_with_custom_pass(
            file,
            Some(program),
            &handler,
            &swc_options,
            comments,
            |_program| NoopPass,
            |_| NoopPass,
        )
        .map_err(|error| format!("{error:?}"))?;

    let collected = errors.borrow().clone();
    if !collected.is_empty() {
        return Err(collected.join("\n"));
    }

    Ok(serde_json::to_string(&TransformResult {
        code: output.code,
        map: output.map,
        diagnostics: output.diagnostics,
    })
    .map_err(|error| error.to_string())?)
}

fn build_hmr_statement(module_id: &str, deps: &[String]) -> Result<Stmt, String> {
    let module = serde_json::to_string(module_id).map_err(|error| error.to_string())?;
    let mut code = String::new();
    code.push_str("if (import.meta.hot) {\n");
    code.push_str(&format!(
        "  import.meta.hot.accept((_mod$) => _hmrUpdate({module}, _mod$));\n"
    ));
    if !deps.is_empty() {
        let list = deps
            .iter()
            .map(|dependency| {
                serde_json::to_string(dependency).unwrap_or_else(|_| "\"\"".to_string())
            })
            .collect::<Vec<_>>()
            .join(", ");
        code.push_str(&format!(
            "  import.meta.hot.accept([{list}], (_mods) => _hmrInvalidate({module}, _mods));\n"
        ));
    }
    code.push_str("}\n");
    parse_statement(&code)
}

fn parse_statement(code: &str) -> Result<Stmt, String> {
    use swc_core::ecma::parser::{lexer::Lexer, EsSyntax, Parser, StringInput, Syntax};
    let source_map = SourceMap::default();
    let file = source_map.new_source_file(FileName::Anon.into(), code.to_string());
    let lexer = Lexer::new(
        Syntax::Es(EsSyntax::default()),
        EsVersion::EsNext,
        StringInput::from(&*file),
        None,
    );
    let mut parser = Parser::new_from(lexer);
    let module = parser
        .parse_module()
        .map_err(|error| format!("{error:?}"))?;
    for item in module.body {
        if let ModuleItem::Stmt(statement) = item {
            return Ok(statement);
        }
    }
    Err("HMR code did not produce a statement".to_string())
}

fn parse_module(
    _source_map: &SourceMap,
    file: &std::sync::Arc<swc_core::common::SourceFile>,
    filename: &str,
    options: &Options,
) -> Result<Module, String> {
    use swc_core::ecma::parser::{lexer::Lexer, Parser, StringInput};
    let syntax = options.config.jsc.syntax.clone().unwrap_or_else(|| {
        Syntax::Typescript(swc_core::ecma::parser::TsSyntax {
            tsx: filename.ends_with(".tsx") || filename.ends_with(".jsx"),
            decorators: true,
            ..Default::default()
        })
    });
    let lexer = Lexer::new(syntax, EsVersion::EsNext, StringInput::from(&**file), None);
    let mut parser = Parser::new_from(lexer);
    parser
        .parse_module()
        .map_err(|error| format!("parse error: {error:?}"))
}

struct NoopPass;

impl swc_core::ecma::ast::Pass for NoopPass {
    fn process(&mut self, _program: &mut Program) {}
}
