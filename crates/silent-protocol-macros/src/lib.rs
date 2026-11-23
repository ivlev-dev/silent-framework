//! Derive-макрос `SilentProto` для крейта `silent-protocol`.
//!
//! Для структуры с именованными полями макрос генерирует реализацию
//! `SilentProto` (кодирование, декодирование и схему), для enum — реализацию
//! `ProtoEnum`. Поля сортируются по имени (UTF-8), `Option<T>` выносится в
//! bitmap присутствия, oneof-группы кодируются как enum-дискриминатор и
//! payload выбранного варианта.
//!
//! # Атрибуты `#[proto(...)]`
//!
//! | Атрибут | Где | Назначение |
//! | --- | --- | --- |
//! | `int32`, `uint32`, `int64`, `uint64`, `float32`, `fixed32`, `fixed64`, `date` | поле | Явный wire-тип; требует `i32`, `u32`, `i64`, `u64`, `f32` соответственно |
//! | `enum_type` | поле | Использовать enum-поле вне oneof |
//! | `oneof(Enum::Variant)` | поле | Отнести `Option<T>`-поле к oneof-группе |
//! | `rename = "name"` | поле | Имя поля в схеме и порядок сортировки |
//! | `skip` | поле | Не кодировать поле и исключить его из схемы |
//!
//! Атрибуты можно объединять в одном `#[proto(...)]` через запятую.
//! `skip` не сочетается с другими атрибутами; у oneof-поля не может быть
//! явного wire-типа или `enum_type`.
//!
//! # Пример
//!
//! ```ignore
//! use silent_protocol::{ProtoEnum, SilentProto};
//!
//! #[derive(Debug, PartialEq, Eq, Clone, Copy, SilentProto)]
//! enum Kind {
//!     Created = 1,
//!     Deleted = 2,
//! }
//!
//! #[derive(Debug, PartialEq, SilentProto)]
//! struct Event {
//!     kind: Kind,
//!     #[proto(oneof(Kind::Created))]
//!     created: Option<String>,
//!     #[proto(oneof(Kind::Deleted))]
//!     deleted: Option<()>,
//! }
//!
//! let event = Event {
//!     kind: Kind::Created,
//!     created: Some("id".into()),
//!     deleted: None,
//! };
//! let bytes = event.encode().unwrap();
//! assert_eq!(Event::decode(&bytes).unwrap(), event);
//! ```

mod attrs;
mod derive_enum;
mod derive_struct;
mod kind;

use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use syn::{parse_macro_input, DeriveInput};

/// Реализует протокольное кодирование для структуры или enum.
///
/// Поддерживаются структуры с именованными полями и enum только из unit-
/// вариантов. Generic-типы, tuple-структуры, unit-структуры и union не
/// поддерживаются. Поведение атрибутов описано в документации крейта.
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
