use swc_core::common::{FileName, SourceMap};
use swc_core::ecma::ast::{Decl, ModuleItem, Stmt};
use swc_core::ecma::parser::{lexer::Lexer, Parser, StringInput, Syntax, TsSyntax};

#[test]
fn parses_this_parameter() {
    let source = r#"
export function Counter(this: { vm: CounterVM }, props: { count: number }) {
  return null;
}
"#;
    let cm = SourceMap::default();
    let fm = cm.new_source_file(FileName::Real("/proj/counter.ts".into()).into(), source);
    let lexer = Lexer::new(
        Syntax::Typescript(TsSyntax {
            tsx: false,
            decorators: true,
            ..Default::default()
        }),
        swc_core::ecma::ast::EsVersion::EsNext,
        StringInput::from(&*fm),
        None,
    );
    let mut parser = Parser::new_from(lexer);
    let module = parser.parse_module().unwrap();
    for item in &module.body {
        let func = match item {
            ModuleItem::ModuleDecl(swc_core::ecma::ast::ModuleDecl::ExportDecl(export)) => {
                match &export.decl {
                    Decl::Fn(func) => Some(func),
                    _ => None,
                }
            }
            ModuleItem::Stmt(Stmt::Decl(Decl::Fn(func))) => Some(func),
            _ => None,
        };
        if let Some(func) = func {
            eprintln!("params={:?}", func.function.params);
            eprintln!("this={:?}", func.function.this_param);
        }
    }
}
