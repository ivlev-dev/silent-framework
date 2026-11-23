use syn::punctuated::Punctuated;
use syn::{Attribute, Expr, Lit, Meta, Path, Token};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WireAttr {
    Int32,
    Uint32,
    Float32,
    Fixed32,
    Fixed64,
    Uint64,
    Int64,
    Date,
}

#[derive(Clone, Default)]
pub struct ProtoAttrs {
    pub skip: bool,
    pub rename: Option<String>,
    pub wire: Option<WireAttr>,
    pub is_enum: bool,
    pub oneof: Vec<Path>,
}

fn wire_from_ident(ident: &str) -> Option<WireAttr> {
    Some(match ident {
        "int32" => WireAttr::Int32,
        "uint32" => WireAttr::Uint32,
        "float32" => WireAttr::Float32,
        "fixed32" => WireAttr::Fixed32,
        "fixed64" => WireAttr::Fixed64,
        "uint64" => WireAttr::Uint64,
        "int64" => WireAttr::Int64,
        "date" => WireAttr::Date,
        _ => return None,
    })
}

pub fn parse(attrs: &[Attribute]) -> syn::Result<ProtoAttrs> {
    let mut result = ProtoAttrs::default();
    for attr in attrs {
        if !attr.path().is_ident("proto") {
            continue;
        }
        let items = attr.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated)?;
        for item in items {
            match item {
                Meta::Path(path) => {
                    let ident = path.get_ident().ok_or_else(|| {
                        syn::Error::new_spanned(&path, "expected a bare attribute name")
                    })?;
                    let name = ident.to_string();
                    if name == "skip" {
                        if result.skip {
                            return Err(syn::Error::new_spanned(
                                ident,
                                "duplicate `skip` attribute",
                            ));
                        }
                        result.skip = true;
                    } else if name == "enum_type" {
                        if result.is_enum {
                            return Err(syn::Error::new_spanned(
                                ident,
                                "duplicate `enum_type` attribute",
                            ));
                        }
                        result.is_enum = true;
                    } else if let Some(wire) = wire_from_ident(&name) {
                        if result.wire.is_some() {
                            return Err(syn::Error::new_spanned(
                                ident,
                                "duplicate wire type attribute",
                            ));
                        }
                        result.wire = Some(wire);
                    } else {
                        return Err(syn::Error::new_spanned(
                            ident,
                            format!(
                                "unknown proto attribute `{name}`; expected one of: int32, uint32, int64, uint64, float32, fixed32, fixed64, date, enum_type, skip, rename, oneof"
                            ),
                        ));
                    }
                }
                Meta::NameValue(name_value) => {
                    if !name_value.path.is_ident("rename") {
                        return Err(syn::Error::new_spanned(
                            &name_value.path,
                            "unknown proto attribute; only `rename = \"...\"` is supported",
                        ));
                    }
                    if result.rename.is_some() {
                        return Err(syn::Error::new_spanned(
                            &name_value.path,
                            "duplicate `rename` attribute",
                        ));
                    }
                    match &name_value.value {
                        Expr::Lit(expr_lit) => match &expr_lit.lit {
                            Lit::Str(value) => {
                                if value.value().is_empty() {
                                    return Err(syn::Error::new_spanned(
                                        value,
                                        "renamed field name must not be empty",
                                    ));
                                }
                                result.rename = Some(value.value());
                            }
                            other => {
                                return Err(syn::Error::new_spanned(
                                    other,
                                    "`rename` expects a string literal",
                                ))
                            }
                        },
                        other => {
                            return Err(syn::Error::new_spanned(
                                other,
                                "`rename` expects a string literal",
                            ))
                        }
                    }
                }
                Meta::List(list) => {
                    if !list.path.is_ident("oneof") {
                        return Err(syn::Error::new_spanned(
                            &list.path,
                            "unknown proto attribute group; only `oneof(Enum::Variant)` is supported",
                        ));
                    }
                    let path: Path = list.parse_args()?;
                    if path.segments.len() < 2 {
                        return Err(syn::Error::new_spanned(
                            path,
                            "`oneof` expects an enum variant path such as `EventKind::Created`",
                        ));
                    }
                    result.oneof.push(path);
                }
            }
        }
    }
    if result.skip
        && (result.rename.is_some()
            || result.wire.is_some()
            || result.is_enum
            || !result.oneof.is_empty())
    {
        return Err(syn::Error::new(
            proc_macro2::Span::call_site(),
            "`skip` cannot be combined with other proto attributes",
        ));
    }
    if !result.oneof.is_empty() && (result.wire.is_some() || result.is_enum) {
        return Err(syn::Error::new(
            proc_macro2::Span::call_site(),
            "oneof fields cannot have an explicit wire type or `enum_type` attribute",
        ));
    }
    Ok(result)
}
