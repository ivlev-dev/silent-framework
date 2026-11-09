use crate::index::Index;
use crate::paths::{is_source_file, module_token, resolve_import_path};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use swc_core::common::{FileName, SourceMap};
use swc_core::ecma::ast::{
    Decl, EsVersion, Expr, ImportSpecifier, MemberProp, Module, ModuleDecl, ModuleExportName,
    ModuleItem, Pat, TsEntityName,
};
use swc_core::ecma::parser::{lexer::Lexer, Parser, StringInput, Syntax, TsSyntax};

const SKIPPED_DIRECTORIES: [&str; 10] = [
    "node_modules",
    "dist",
    "build",
    "out",
    "coverage",
    ".next",
    ".nuxt",
    ".vite",
    ".turbo",
    "target",
];

#[derive(Debug, Clone)]
struct ImportInfo {
    source: String,
    imported: String,
}

fn parse_module(path: &Path) -> Option<Module> {
    let source = fs::read_to_string(path).ok()?;
    let source_map = SourceMap::default();
    let file = source_map.new_source_file(FileName::Real(path.to_path_buf()).into(), source);
    let lexer = Lexer::new(
        Syntax::Typescript(TsSyntax {
            tsx: path
                .extension()
                .and_then(|value| value.to_str())
                .map(|extension| extension == "tsx" || extension == "jsx")
                .unwrap_or(false),
            decorators: true,
            ..Default::default()
        }),
        EsVersion::EsNext,
        StringInput::from(&*file),
        None,
    );
    let mut parser = Parser::new_from(lexer);
    parser.parse_module().ok()
}

fn module_export_name(name: &ModuleExportName) -> String {
    match name {
        ModuleExportName::Ident(ident) => ident.sym.to_string(),
        ModuleExportName::Str(value) => value.value.to_string_lossy().into_owned(),
    }
}

fn collect_imports(module: &Module) -> HashMap<String, ImportInfo> {
    let mut imports = HashMap::new();
    for item in &module.body {
        let ModuleItem::ModuleDecl(ModuleDecl::Import(decl)) = item else {
            continue;
        };
        let source = decl.src.value.to_string_lossy().into_owned();
        for specifier in &decl.specifiers {
            match specifier {
                ImportSpecifier::Named(named) => {
                    let imported = named
                        .imported
                        .as_ref()
                        .map(module_export_name)
                        .unwrap_or_else(|| named.local.sym.to_string());
                    imports.insert(
                        named.local.sym.to_string(),
                        ImportInfo {
                            source: source.clone(),
                            imported,
                        },
                    );
                }
                ImportSpecifier::Default(default) => {
                    imports.insert(
                        default.local.sym.to_string(),
                        ImportInfo {
                            source: source.clone(),
                            imported: "default".to_string(),
                        },
                    );
                }
                ImportSpecifier::Namespace(namespace) => {
                    imports.insert(
                        namespace.local.sym.to_string(),
                        ImportInfo {
                            source: source.clone(),
                            imported: "*".to_string(),
                        },
                    );
                }
            }
        }
    }
    imports
}

fn entity_from_expr(expr: &Expr) -> Option<TsEntityName> {
    match expr {
        Expr::Ident(ident) => Some(TsEntityName::Ident(ident.clone())),
        Expr::Member(member) => {
            let Expr::Ident(object) = &*member.obj else {
                return None;
            };
            let MemberProp::Ident(property) = &member.prop else {
                return None;
            };
            Some(TsEntityName::TsQualifiedName(Box::new(
                swc_core::ecma::ast::TsQualifiedName {
                    span: member.span,
                    left: TsEntityName::Ident(object.clone()),
                    right: property.clone(),
                },
            )))
        }
        _ => None,
    }
}

fn interface_token(
    file: &Path,
    imports: &HashMap<String, ImportInfo>,
    expr: &TsEntityName,
) -> Option<String> {
    match expr {
        TsEntityName::Ident(ident) => {
            let local = ident.sym.to_string();
            if let Some(import) = imports.get(&local) {
                if import.imported == "*" {
                    return None;
                }
                if let Some(module) = resolve_import_path(file, &import.source) {
                    return Some(format!("{module}#{}", import.imported));
                }
            }
            Some(module_token(file, &local))
        }
        TsEntityName::TsQualifiedName(qualified) => {
            let TsEntityName::Ident(left) = &qualified.left else {
                return None;
            };
            let local = left.sym.to_string();
            let import = imports.get(&local)?;
            let module = resolve_import_path(file, &import.source)?;
            Some(format!("{module}#{}", qualified.right.sym))
        }
    }
}

fn collect_implements(
    file: &Path,
    module: &Module,
    imports: &HashMap<String, ImportInfo>,
    index: &mut Index,
) {
    let impl_token = |ident: &swc_core::ecma::ast::Ident| module_token(file, ident.sym.as_ref());

    for item in &module.body {
        let Some(class) = class_from_item(item) else {
            continue;
        };
        let ident = &class.ident;
        let implementation = impl_token(ident);
        for implemented in &class.class.implements {
            let Some(entity) = entity_from_expr(&implemented.expr) else {
                continue;
            };
            let Some(token) = interface_token(file, imports, &entity) else {
                continue;
            };
            let entry = index.interfaces.entry(token).or_default();
            if !entry.iter().any(|value| value == &implementation) {
                entry.push(implementation.clone());
            }
        }
    }
}

fn class_from_item(item: &ModuleItem) -> Option<&swc_core::ecma::ast::ClassDecl> {
    match item {
        ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(export)) => match &export.decl {
            Decl::Class(class) => Some(class),
            _ => None,
        },
        ModuleItem::Stmt(swc_core::ecma::ast::Stmt::Decl(Decl::Class(class))) => Some(class),
        _ => None,
    }
}

fn collect_exported_names(module: &Module) -> Vec<String> {
    let mut names = Vec::new();

    for item in &module.body {
        match item {
            ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(export)) => {
                collect_decl_names(&export.decl, &mut names);
            }
            ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(named)) => {
                if named.src.is_some() {
                    continue;
                }
                for specifier in &named.specifiers {
                    if let swc_core::ecma::ast::ExportSpecifier::Named(specifier) = specifier {
                        if specifier.is_type_only {
                            continue;
                        }
                        let name = specifier
                            .exported
                            .as_ref()
                            .map(module_export_name)
                            .unwrap_or_else(|| module_export_name(&specifier.orig));
                        if !names.iter().any(|value| value == &name) {
                            names.push(name);
                        }
                    }
                }
            }
            ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(export)) => {
                match &export.decl {
                    swc_core::ecma::ast::DefaultDecl::Class(class) => {
                        if let Some(ident) = &class.ident {
                            if !names.iter().any(|value| value == ident.sym.as_ref()) {
                                names.push(ident.sym.to_string());
                            }
                        }
                    }
                    swc_core::ecma::ast::DefaultDecl::Fn(func) => {
                        if let Some(ident) = &func.ident {
                            if !names.iter().any(|value| value == ident.sym.as_ref()) {
                                names.push(ident.sym.to_string());
                            }
                        }
                    }
                    _ => {}
                }
                names.push("default".to_string());
            }
            _ => {}
        }
    }

    names
}

fn collect_decl_names(decl: &Decl, names: &mut Vec<String>) {
    match decl {
        Decl::Class(class) => {
            names.push(class.ident.sym.to_string());
        }
        Decl::Fn(func) => {
            names.push(func.ident.sym.to_string());
        }
        Decl::Var(var) => {
            for declarator in &var.decls {
                if let Pat::Ident(ident) = &declarator.name {
                    names.push(ident.id.sym.to_string());
                }
            }
        }
        _ => {}
    }
}

fn walk(directory: &Path, root: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || SKIPPED_DIRECTORIES.contains(&name.as_ref()) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if !path.starts_with(root) {
            continue;
        }
        if file_type.is_dir() {
            walk(&path, root, files);
        } else if file_type.is_file() && is_source_file(&path) {
            files.push(path);
        }
    }
}

pub fn scan(root: &Path) -> Index {
    let root = crate::paths::normalize_path(root);
    let mut files = Vec::new();
    walk(&root, &root, &mut files);

    let mut index = Index::default();

    for file in files {
        let Some(module) = parse_module(&file) else {
            continue;
        };
        let imports = collect_imports(&module);
        collect_implements(&file, &module, &imports, &mut index);

        let names = collect_exported_names(&module);
        if !names.is_empty() {
            let module_path = crate::paths::module_path_without_extension(&file);
            index.values.insert(module_path, names);
        }
    }

    index
}
