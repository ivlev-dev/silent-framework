use proc_macro2::TokenStream;
use quote::{quote, ToTokens};
use syn::{GenericArgument, Ident, Path, PathArguments, Type};

use crate::attrs::{ProtoAttrs, WireAttr};

#[derive(Clone)]
pub enum Kind {
    Bool,
    Int32,
    Int64,
    Uint32,
    Uint64,
    Float32,
    Float64,
    Fixed32,
    Fixed64,
    Date,
    String,
    Bytes,
    BytesBuf,
    Unit,
    Enum(Type),
    Message(Type),
    Option(Box<Kind>),
    Vec(Box<Kind>),
    Set(Box<Kind>),
    Map(Box<Kind>, Box<Kind>),
}

impl Kind {
    pub fn is_option(&self) -> bool {
        matches!(self, Self::Option(_))
    }
}

pub fn type_label(ty: &Type) -> String {
    ty.to_token_stream().to_string().replace(' ', "")
}

pub fn path_label(path: &Path) -> String {
    path.to_token_stream().to_string().replace(' ', "")
}

pub fn last_ident(ty: &Type) -> Option<&Ident> {
    match ty {
        Type::Path(path) if path.qself.is_none() => {
            path.path.segments.last().map(|segment| &segment.ident)
        }
        _ => None,
    }
}

fn single_type_arg<'a>(ty: &'a Type, name: &str) -> Option<&'a Type> {
    let path = match ty {
        Type::Path(path) if path.qself.is_none() => &path.path,
        _ => return None,
    };
    let segment = path.segments.last()?;
    if segment.ident != name {
        return None;
    }
    let arguments = match &segment.arguments {
        PathArguments::AngleBracketed(arguments) => arguments,
        _ => return None,
    };
    if arguments.args.len() != 1 {
        return None;
    }
    match &arguments.args[0] {
        GenericArgument::Type(inner) => Some(inner),
        _ => None,
    }
}

fn two_type_args<'a>(ty: &'a Type, name: &str) -> Option<(&'a Type, &'a Type)> {
    let path = match ty {
        Type::Path(path) if path.qself.is_none() => &path.path,
        _ => return None,
    };
    let segment = path.segments.last()?;
    if segment.ident != name {
        return None;
    }
    let arguments = match &segment.arguments {
        PathArguments::AngleBracketed(arguments) => arguments,
        _ => return None,
    };
    if arguments.args.len() != 2 {
        return None;
    }
    match (&arguments.args[0], &arguments.args[1]) {
        (GenericArgument::Type(key), GenericArgument::Type(value)) => Some((key, value)),
        _ => None,
    }
}

fn is_u8(ty: &Type) -> bool {
    last_ident(ty).is_some_and(|ident| ident == "u8")
}

fn has_type_arguments(ty: &Type) -> bool {
    match ty {
        Type::Path(path) if path.qself.is_none() => path.path.segments.iter().any(|segment| {
            matches!(&segment.arguments, PathArguments::AngleBracketed(arguments) if !arguments.args.is_empty())
        }),
        _ => false,
    }
}

fn unsupported_type(ty: &Type) -> syn::Error {
    syn::Error::new_spanned(
        ty,
        format!(
            "unsupported protocol type `{}`; supported types: bool, i32, i64, u32, u64, f32, f64, String, Vec<u8>, bytes::Bytes, Option<T>, Vec<T>, BTreeMap<K, V>, BTreeSet<T>, protocol structs and enums",
            type_label(ty)
        ),
    )
}

pub fn classify(ty: &Type, attrs: &ProtoAttrs) -> syn::Result<Kind> {
    if let Some(wire) = attrs.wire {
        return classify_wire(ty, wire);
    }
    let kind = classify_plain(ty)?;
    if attrs.is_enum {
        return match kind {
            Kind::Message(_) => Ok(Kind::Enum(ty.clone())),
            _ => Err(syn::Error::new_spanned(
                ty,
                "`#[proto(enum_type)]` requires a plain enum type",
            )),
        };
    }
    Ok(kind)
}

fn classify_wire(ty: &Type, wire: WireAttr) -> syn::Result<Kind> {
    let expected = match wire {
        WireAttr::Int32 => "i32",
        WireAttr::Uint32 | WireAttr::Fixed32 => "u32",
        WireAttr::Float32 => "f32",
        WireAttr::Fixed64 | WireAttr::Uint64 => "u64",
        WireAttr::Int64 | WireAttr::Date => "i64",
    };
    if !last_ident(ty).is_some_and(|ident| ident == expected) || has_type_arguments(ty) {
        let attribute = match wire {
            WireAttr::Int32 => "int32",
            WireAttr::Uint32 => "uint32",
            WireAttr::Float32 => "float32",
            WireAttr::Fixed32 => "fixed32",
            WireAttr::Fixed64 => "fixed64",
            WireAttr::Uint64 => "uint64",
            WireAttr::Int64 => "int64",
            WireAttr::Date => "date",
        };
        return Err(syn::Error::new_spanned(
            ty,
            format!(
                "`#[proto({attribute})]` requires type `{expected}`, found `{}`",
                type_label(ty)
            ),
        ));
    }
    Ok(match wire {
        WireAttr::Int32 => Kind::Int32,
        WireAttr::Uint32 => Kind::Uint32,
        WireAttr::Float32 => Kind::Float32,
        WireAttr::Fixed32 => Kind::Fixed32,
        WireAttr::Fixed64 => Kind::Fixed64,
        WireAttr::Uint64 => Kind::Uint64,
        WireAttr::Int64 => Kind::Int64,
        WireAttr::Date => Kind::Date,
    })
}

pub fn classify_plain(ty: &Type) -> syn::Result<Kind> {
    match ty {
        Type::Tuple(tuple) if tuple.elems.is_empty() => return Ok(Kind::Unit),
        Type::Tuple(tuple) => {
            return Err(syn::Error::new_spanned(
                tuple,
                "tuple types are not supported by the Rust protocol mapping",
            ))
        }
        Type::Array(array) => {
            return Err(syn::Error::new_spanned(
                array,
                "fixed-size arrays are not supported; use `Vec<T>` for protocol arrays",
            ))
        }
        Type::Slice(slice) => {
            return Err(syn::Error::new_spanned(
                slice,
                "slice types are not supported; use `Vec<T>`",
            ))
        }
        Type::Reference(reference) => {
            return Err(syn::Error::new_spanned(
                reference,
                "references are not supported; use owned protocol types",
            ))
        }
        Type::Ptr(pointer) => {
            return Err(syn::Error::new_spanned(
                pointer,
                "raw pointers are not supported by the protocol",
            ))
        }
        Type::ImplTrait(value) => {
            return Err(syn::Error::new_spanned(
                value,
                "`impl Trait` is not supported by the protocol",
            ))
        }
        Type::TraitObject(value) => {
            return Err(syn::Error::new_spanned(
                value,
                "trait objects are not supported by the protocol",
            ))
        }
        Type::Path(path) if path.qself.is_some() => {
            return Err(syn::Error::new_spanned(
                path,
                "qualified paths are not supported by the protocol",
            ))
        }
        Type::Path(_) => {}
        other => return Err(unsupported_type(other)),
    }

    let ident = last_ident(ty).expect("type path").to_string();
    match ident.as_str() {
        "bool" => Ok(Kind::Bool),
        "i32" => Ok(Kind::Int32),
        "i64" => Ok(Kind::Int64),
        "u32" => Ok(Kind::Uint32),
        "u64" => Ok(Kind::Uint64),
        "f32" => Ok(Kind::Float32),
        "f64" => Ok(Kind::Float64),
        "String" => Ok(Kind::String),
        "Bytes" => Ok(Kind::BytesBuf),
        "Vec" => {
            let inner = single_type_arg(ty, "Vec")
                .ok_or_else(|| unsupported_type(ty))?;
            if is_u8(inner) {
                return Ok(Kind::Bytes);
            }
            let inner = classify_plain(inner)?;
            Ok(Kind::Vec(Box::new(inner)))
        }
        "Option" => {
            let inner = single_type_arg(ty, "Option")
                .ok_or_else(|| unsupported_type(ty))?;
            let inner = classify_plain(inner)?;
            if inner.is_option() {
                return Err(syn::Error::new_spanned(
                    ty,
                    "nested `Option<Option<T>>` is not supported by the protocol",
                ));
            }
            if matches!(inner, Kind::Unit) {
                return Ok(Kind::Option(Box::new(Kind::Unit)));
            }
            Ok(Kind::Option(Box::new(inner)))
        }
        "BTreeMap" => {
            let (key, value) = two_type_args(ty, "BTreeMap")
                .ok_or_else(|| unsupported_type(ty))?;
            let key = classify_plain(key)?;
            let value = classify_plain(value)?;
            if key.is_option() {
                return Err(syn::Error::new_spanned(
                    key_type(ty),
                    "map keys cannot be optional",
                ));
            }
            if !valid_map_key(&key) {
                return Err(syn::Error::new_spanned(
                    key_type(ty),
                    "unsupported map key type; allowed: bool, integer types, String, enum",
                ));
            }
            Ok(Kind::Map(Box::new(key), Box::new(value)))
        }
        "BTreeSet" => {
            let inner = single_type_arg(ty, "BTreeSet")
                .ok_or_else(|| unsupported_type(ty))?;
            let inner = classify_plain(inner)?;
            if inner.is_option() {
                return Err(syn::Error::new_spanned(
                    ty,
                    "optional set elements are not supported by the protocol",
                ));
            }
            Ok(Kind::Set(Box::new(inner)))
        }
        "HashMap" | "HashSet" | "VecDeque" | "LinkedList" | "BinaryHeap" => Err(
            syn::Error::new_spanned(
                ty,
                "unordered or non-vector collections are not supported; use `BTreeMap`, `BTreeSet` or `Vec` for deterministic encoding",
            ),
        ),
        "Box" | "Rc" | "Arc" | "Cow" | "RefCell" | "Cell" | "Mutex" | "RwLock" => {
            Err(syn::Error::new_spanned(
                ty,
                "smart pointers and interior mutability are not supported by the protocol",
            ))
        }
        "u8" | "u16" | "i8" | "i16" | "u128" | "i128" | "usize" | "isize" | "char" | "str" => {
            Err(syn::Error::new_spanned(
                ty,
                format!(
                    "unsupported primitive type `{ident}`; the protocol supports bool, i32, i64, u32, u64, f32, f64"
                ),
            ))
        }
        _ => {
            if has_type_arguments(ty) {
                return Err(syn::Error::new_spanned(
                    ty,
                    format!(
                        "generic protocol types are not supported (`{}`); derive `SilentProto` on a concrete struct",
                        type_label(ty)
                    ),
                ));
            }
            Ok(Kind::Message(ty.clone()))
        }
    }
}

fn key_type(ty: &Type) -> &Type {
    two_type_args(ty, "BTreeMap")
        .map(|(key, _)| key)
        .unwrap_or(ty)
}

fn valid_map_key(kind: &Kind) -> bool {
    matches!(
        kind,
        Kind::Bool
            | Kind::Int32
            | Kind::Int64
            | Kind::Uint32
            | Kind::Uint64
            | Kind::Fixed32
            | Kind::Fixed64
            | Kind::String
            | Kind::Enum(_)
    )
}

pub fn encode(kind: &Kind, expr: &TokenStream) -> syn::Result<TokenStream> {
    Ok(match kind {
        Kind::Bool => quote!(encoder.write_bool(*#expr)?;),
        Kind::Int32 => quote!(encoder.write_int32(*#expr)?;),
        Kind::Int64 => quote!(encoder.write_int64(*#expr)?;),
        Kind::Uint32 => quote!(encoder.write_uint32(*#expr)?;),
        Kind::Uint64 => quote!(encoder.write_uint64(*#expr)?;),
        Kind::Float32 => quote!(encoder.write_float32(*#expr)?;),
        Kind::Float64 => quote!(encoder.write_float64(*#expr)?;),
        Kind::Fixed32 => quote!(encoder.write_fixed32(*#expr)?;),
        Kind::Fixed64 => quote!(encoder.write_fixed64(*#expr)?;),
        Kind::Date => quote!(encoder.write_date(*#expr)?;),
        Kind::String => quote!(encoder.write_string(#expr.as_str())?;),
        Kind::Bytes => quote!(encoder.write_bytes(#expr.as_slice())?;),
        Kind::BytesBuf => quote!(encoder.write_bytes(#expr.as_ref())?;),
        Kind::Unit => quote!(),
        Kind::Enum(_) => {
            quote!(encoder.write_enum(::silent_protocol::ProtoEnum::to_proto(*#expr))?;)
        }
        Kind::Message(_) => quote!(encoder.write_message(#expr)?;),
        Kind::Option(_) => {
            return Err(syn::Error::new(
                proc_macro2::Span::call_site(),
                "optional value in an unsupported position",
            ))
        }
        Kind::Vec(inner) => {
            if let Kind::Option(element) = &**inner {
                let encode_element = encode(element, &quote!(__item))?;
                quote! {
                    {
                        let __len = #expr.len();
                        encoder.write_length(__len)?;
                        let mut __bits = ::std::vec![0u8; __len.div_ceil(8)];
                        for (__index, __item) in #expr.iter().enumerate() {
                            if __item.is_some() {
                                __bits[__index / 8] |= 1u8 << (__index % 8);
                            }
                        }
                        encoder.write_raw(&__bits)?;
                        for __item in #expr.iter().flatten() {
                            #encode_element
                        }
                    }
                }
            } else {
                let encode_element = encode(inner, &quote!(__item))?;
                quote! {
                    {
                        let __len = #expr.len();
                        encoder.write_length(__len)?;
                        for __item in #expr.iter() {
                            #encode_element
                        }
                    }
                }
            }
        }
        Kind::Set(inner) => {
            let encode_element = encode(inner, &quote!(__item))?;
            quote! {
                {
                    let __len = #expr.len();
                    encoder.write_length(__len)?;
                    for __item in #expr.iter() {
                        #encode_element
                    }
                }
            }
        }
        Kind::Map(key, value) => {
            let encode_key = encode(key, &quote!(__key))?;
            if let Kind::Option(inner) = &**value {
                let encode_value = encode(inner, &quote!(__value))?;
                quote! {
                    {
                        let __len = #expr.len();
                        encoder.write_length(__len)?;
                        let mut __bits = ::std::vec![0u8; __len.div_ceil(8)];
                        for (__index, (_, __value)) in #expr.iter().enumerate() {
                            if __value.is_some() {
                                __bits[__index / 8] |= 1u8 << (__index % 8);
                            }
                        }
                        encoder.write_raw(&__bits)?;
                        for (__key, __value) in #expr.iter() {
                            #encode_key
                            if let Some(__value) = __value.as_ref() {
                                #encode_value
                            }
                        }
                    }
                }
            } else {
                let encode_value = encode(value, &quote!(__value))?;
                quote! {
                    {
                        let __len = #expr.len();
                        encoder.write_length(__len)?;
                        for (__key, __value) in #expr.iter() {
                            #encode_key
                            #encode_value
                        }
                    }
                }
            }
        }
    })
}

pub fn decode(kind: &Kind) -> syn::Result<TokenStream> {
    Ok(match kind {
        Kind::Bool => quote!(decoder.read_bool()?),
        Kind::Int32 => quote!(decoder.read_int32()?),
        Kind::Int64 => quote!(decoder.read_int64()?),
        Kind::Uint32 => quote!(decoder.read_uint32()?),
        Kind::Uint64 => quote!(decoder.read_uint64()?),
        Kind::Float32 => quote!(decoder.read_float32()?),
        Kind::Float64 => quote!(decoder.read_float64()?),
        Kind::Fixed32 => quote!(decoder.read_fixed32()?),
        Kind::Fixed64 => quote!(decoder.read_fixed64()?),
        Kind::Date => quote!(decoder.read_date()?),
        Kind::String => quote!(decoder.read_string()?),
        Kind::Bytes => quote!(decoder.read_byte_vec()?),
        Kind::BytesBuf => quote!(decoder.read_bytes()?),
        Kind::Unit => quote!(()),
        Kind::Enum(ty) => quote!({
            let __raw = decoder.read_enum_value()?;
            <#ty as ::silent_protocol::ProtoEnum>::from_proto(__raw)?
        }),
        Kind::Message(ty) => quote!(decoder.read_message::<#ty>()?),
        Kind::Option(_) => {
            return Err(syn::Error::new(
                proc_macro2::Span::call_site(),
                "optional value in an unsupported position",
            ))
        }
        Kind::Vec(inner) => {
            if let Kind::Option(element) = &**inner {
                let decode_element = decode(element)?;
                quote! {
                    {
                        let __len = decoder.read_length()?;
                        let __bits = decoder.read_bitmap(__len)?;
                        let mut __out = ::std::vec::Vec::with_capacity(__len.min(1024));
                        for __index in 0..__len {
                            if __bits.get(__index) {
                                __out.push(Some(#decode_element));
                            } else {
                                __out.push(None);
                            }
                        }
                        __out
                    }
                }
            } else {
                let decode_element = decode(inner)?;
                quote! {
                    {
                        let __len = decoder.read_length()?;
                        let mut __out = ::std::vec::Vec::with_capacity(__len.min(1024));
                        for _ in 0..__len {
                            __out.push(#decode_element);
                        }
                        __out
                    }
                }
            }
        }
        Kind::Set(inner) => {
            let decode_element = decode(inner)?;
            quote! {
                {
                    let __len = decoder.read_length()?;
                    let mut __out = ::std::collections::BTreeSet::new();
                    for _ in 0..__len {
                        __out.insert(#decode_element);
                    }
                    __out
                }
            }
        }
        Kind::Map(key, value) => {
            let decode_key = decode(key)?;
            if let Kind::Option(inner) = &**value {
                let decode_value = decode(inner)?;
                quote! {
                    {
                        let __len = decoder.read_length()?;
                        let __bits = decoder.read_bitmap(__len)?;
                        let mut __out = ::std::collections::BTreeMap::new();
                        for __index in 0..__len {
                            let __key = #decode_key;
                            if __bits.get(__index) {
                                __out.insert(__key, Some(#decode_value));
                            } else {
                                __out.insert(__key, None);
                            }
                        }
                        __out
                    }
                }
            } else {
                let decode_value = decode(value)?;
                quote! {
                    {
                        let __len = decoder.read_length()?;
                        let mut __out = ::std::collections::BTreeMap::new();
                        for _ in 0..__len {
                            let __key = #decode_key;
                            __out.insert(__key, #decode_value);
                        }
                        __out
                    }
                }
            }
        }
    })
}

pub fn schema_type(kind: &Kind) -> syn::Result<TokenStream> {
    Ok(match kind {
        Kind::Bool => quote!(::silent_protocol::SchemaType::Bool),
        Kind::Int32 => quote!(::silent_protocol::SchemaType::Int32),
        Kind::Int64 => quote!(::silent_protocol::SchemaType::Int64),
        Kind::Uint32 => quote!(::silent_protocol::SchemaType::Uint32),
        Kind::Uint64 => quote!(::silent_protocol::SchemaType::Uint64),
        Kind::Float32 => quote!(::silent_protocol::SchemaType::Float32),
        Kind::Float64 => quote!(::silent_protocol::SchemaType::Float64),
        Kind::Fixed32 => quote!(::silent_protocol::SchemaType::Fixed32),
        Kind::Fixed64 => quote!(::silent_protocol::SchemaType::Fixed64),
        Kind::Date => quote!(::silent_protocol::SchemaType::Date),
        Kind::String => quote!(::silent_protocol::SchemaType::String),
        Kind::Bytes | Kind::BytesBuf => quote!(::silent_protocol::SchemaType::Bytes),
        Kind::Unit => quote!(::silent_protocol::SchemaType::Unit),
        Kind::Enum(ty) => {
            let name = type_label(ty);
            quote!(::silent_protocol::SchemaType::Enum(#name))
        }
        Kind::Message(ty) => {
            let name = type_label(ty);
            quote!(::silent_protocol::SchemaType::Message(#name))
        }
        Kind::Option(inner) => {
            let inner = schema_type(inner)?;
            quote!(::silent_protocol::SchemaType::Optional(::std::boxed::Box::new(#inner)))
        }
        Kind::Vec(inner) => {
            let inner = schema_type(inner)?;
            quote!(::silent_protocol::SchemaType::Array(::std::boxed::Box::new(#inner)))
        }
        Kind::Set(inner) => {
            let inner = schema_type(inner)?;
            quote!(::silent_protocol::SchemaType::Set(::std::boxed::Box::new(#inner)))
        }
        Kind::Map(key, value) => {
            let key = schema_type(key)?;
            let value = schema_type(value)?;
            quote!(::silent_protocol::SchemaType::Map(
                ::std::boxed::Box::new(#key),
                ::std::boxed::Box::new(#value),
            ))
        }
    })
}
