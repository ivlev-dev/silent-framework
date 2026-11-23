use std::collections::BTreeSet;

use proc_macro2::TokenStream;
use quote::quote;
use syn::{DataEnum, Expr, ExprLit, Ident, Lit};

pub fn expand(ident: &Ident, data: &DataEnum) -> syn::Result<TokenStream> {
    let mut values = Vec::new();
    let mut seen = BTreeSet::new();
    let mut next: i64 = 0;
    for variant in &data.variants {
        if !matches!(variant.fields, syn::Fields::Unit) {
            return Err(syn::Error::new_spanned(
                &variant.fields,
                "protocol enums must contain only unit variants",
            ));
        }
        let value = match &variant.discriminant {
            Some((_, expr)) => literal_value(expr)?,
            None => next,
        };
        if value < 0 {
            return Err(syn::Error::new_spanned(
                variant,
                "protocol enum discriminants must be non-negative",
            ));
        }
        if value > i64::from(i32::MAX) {
            return Err(syn::Error::new_spanned(
                variant,
                "protocol enum discriminants must not exceed 2^31 - 1",
            ));
        }
        if !seen.insert(value) {
            return Err(syn::Error::new_spanned(
                variant,
                format!("duplicate protocol enum discriminant {value}"),
            ));
        }
        next = value + 1;
        values.push((variant.ident.clone(), value as u32));
    }
    let name = ident.to_string();
    let arms = values.iter().map(|(variant, value)| {
        quote! {
            #value => ::core::result::Result::Ok(Self::#variant),
        }
    });
    Ok(quote! {
        impl ::silent_protocol::ProtoEnum for #ident {
            const NAME: &'static str = #name;

            fn to_proto(self) -> u32 {
                self as u32
            }

            fn from_proto(value: u32) -> ::core::result::Result<Self, ::silent_protocol::ProtocolError> {
                match value {
                    #(#arms)*
                    _ => ::core::result::Result::Err(
                        ::silent_protocol::ProtocolError::unknown_enum_value(Self::NAME, value),
                    ),
                }
            }
        }
    })
}

fn literal_value(expr: &Expr) -> syn::Result<i64> {
    let literal = match expr {
        Expr::Lit(ExprLit {
            lit: Lit::Int(literal),
            ..
        }) => literal,
        _ => {
            return Err(syn::Error::new_spanned(
                expr,
                "protocol enum discriminants must be integer literals",
            ))
        }
    };
    literal.base10_parse::<i64>()
}
