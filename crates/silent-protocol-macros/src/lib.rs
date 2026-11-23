mod attrs;
mod derive_enum;
mod derive_struct;
mod kind;

use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use syn::{parse_macro_input, DeriveInput};

#[proc_macro_derive(SilentProto, attributes(proto))]
pub fn silent_proto(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    match expand(input) {
        Ok(tokens) => tokens.into(),
        Err(error) => error.to_compile_error().into(),
    }
}

fn expand(input: DeriveInput) -> syn::Result<TokenStream2> {
    if !input.generics.params.is_empty() {
        return Err(syn::Error::new_spanned(
            &input.generics,
            "`SilentProto` does not support generic types",
        ));
    }
    match &input.data {
        syn::Data::Struct(data) => derive_struct::expand(&input.ident, data),
        syn::Data::Enum(data) => derive_enum::expand(&input.ident, data),
        syn::Data::Union(data) => Err(syn::Error::new_spanned(
            data.union_token,
            "`SilentProto` does not support unions",
        )),
    }
}
