use crate::paths::relative_specifier;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use swc_core::common::{SyntaxContext, DUMMY_SP};
use swc_core::ecma::ast::{
    Ident, ImportDecl, ImportNamedSpecifier, ImportSpecifier, ImportStarAsSpecifier, Module,
    ModuleDecl, ModuleExportName, ModuleItem, Str,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportKind {
    Named,
    Default,
    Namespace,
}

#[derive(Debug, Clone)]
pub struct ImportRecord {
    pub source: String,
    pub imported: String,
    pub type_only: bool,
    pub kind: ImportKind,
    pub local: Ident,
}

pub struct ImportManager {
    pub records: HashMap<String, ImportRecord>,
    value_keys: HashMap<(String, String), Ident>,
    taken: HashSet<String>,
    new_imports: Vec<ImportDecl>,
}

impl ImportManager {
    pub fn new(module: &Module) -> Self {
        let mut records = HashMap::new();
        let mut value_keys = HashMap::new();
        let mut taken = HashSet::new();

        for item in &module.body {
            let ModuleItem::ModuleDecl(ModuleDecl::Import(decl)) = item else {
                continue;
            };
            let source = decl.src.value.to_string_lossy().into_owned();
            for specifier in &decl.specifiers {
                let (local, imported, kind, specifier_type_only) = match specifier {
                    ImportSpecifier::Named(named) => {
                        let imported = named
                            .imported
                            .as_ref()
                            .map(export_name)
                            .unwrap_or_else(|| named.local.sym.to_string());
                        (
                            named.local.clone(),
                            imported,
                            ImportKind::Named,
                            named.is_type_only,
                        )
                    }
                    ImportSpecifier::Default(default) => (
                        default.local.clone(),
                        "default".to_string(),
                        ImportKind::Default,
                        false,
                    ),
                    ImportSpecifier::Namespace(namespace) => (
                        namespace.local.clone(),
                        "*".to_string(),
                        ImportKind::Namespace,
                        false,
                    ),
                };
                let type_only = decl.type_only || specifier_type_only;
                taken.insert(local.sym.to_string());
                let record = ImportRecord {
                    source: source.clone(),
                    imported: imported.clone(),
                    type_only,
                    kind,
                    local: local.clone(),
                };
                if !type_only && kind == ImportKind::Named {
                    value_keys.insert((source.clone(), imported.clone()), local.clone());
                }
                if !type_only && kind == ImportKind::Default {
                    value_keys.insert((source.clone(), "default".to_string()), local.clone());
                }
                records.insert(local.sym.to_string(), record);
            }
        }

        Self {
            records,
            value_keys,
            taken,
            new_imports: Vec::new(),
        }
    }

    pub fn reserve(&mut self, name: &str) {
        self.taken.insert(name.to_string());
    }

    pub fn get(&self, local: &str) -> Option<&ImportRecord> {
        self.records.get(local)
    }

    pub fn is_taken(&self, name: &str) -> bool {
        self.taken.contains(name)
    }

    pub fn add_value_import(&mut self, from_file: &Path, source: &str, export: &str) -> Ident {
        if let Some(existing) = self
            .value_keys
            .get(&(source.to_string(), export.to_string()))
        {
            return existing.clone();
        }

        let module_source = if source.starts_with('.') {
            let target = crate::paths::resolve_import_path(from_file, source)
                .unwrap_or_else(|| source.to_string());
            relative_specifier(from_file, &target)
        } else {
            source.to_string()
        };

        if let Some(existing) = self
            .value_keys
            .get(&(module_source.clone(), export.to_string()))
        {
            return existing.clone();
        }

        let local_name = self.unique_name(export);
        let local = Ident::new(local_name.clone().into(), DUMMY_SP, SyntaxContext::empty());
        self.taken.insert(local_name);

        let specifier = if export == "default" {
            ImportSpecifier::Default(swc_core::ecma::ast::ImportDefaultSpecifier {
                span: DUMMY_SP,
                local: local.clone(),
            })
        } else if export == "*" {
            ImportSpecifier::Namespace(ImportStarAsSpecifier {
                span: DUMMY_SP,
                local: local.clone(),
            })
        } else {
            ImportSpecifier::Named(ImportNamedSpecifier {
                span: DUMMY_SP,
                local: local.clone(),
                imported: Some(ModuleExportName::Ident(Ident::new(
                    export.into(),
                    DUMMY_SP,
                    SyntaxContext::empty(),
                ))),
                is_type_only: false,
            })
        };

        self.new_imports.push(ImportDecl {
            span: DUMMY_SP,
            specifiers: vec![specifier],
            src: Box::new(Str {
                span: DUMMY_SP,
                value: module_source.clone().into(),
                raw: None,
            }),
            type_only: false,
            with: None,
            phase: Default::default(),
        });

        self.value_keys
            .insert((module_source, export.to_string()), local.clone());
        local
    }

    fn unique_name(&self, base: &str) -> String {
        if !self.taken.contains(base) {
            return base.to_string();
        }
        let mut index = 1usize;
        loop {
            let candidate = format!("_{base}{index}");
            if !self.taken.contains(&candidate) {
                return candidate;
            }
            index += 1;
        }
    }

    pub fn take_imports(&mut self) -> Vec<ImportDecl> {
        std::mem::take(&mut self.new_imports)
    }
}

fn export_name(name: &ModuleExportName) -> String {
    match name {
        ModuleExportName::Ident(ident) => ident.sym.to_string(),
        ModuleExportName::Str(value) => value.value.to_string_lossy().into_owned(),
    }
}
