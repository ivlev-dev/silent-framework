use std::collections::BTreeMap;

use proc_macro2::{Span, TokenStream};
use quote::quote;
use syn::punctuated::Punctuated;
use syn::{DataStruct, Fields, Ident, Path, Type, TypePath};

use crate::attrs::{self, ProtoAttrs};
use crate::kind::{self, Kind};

struct FieldModel {
    ident: Ident,
    ty: Type,
    name: String,
    attrs: ProtoAttrs,
    kind: Option<Kind>,
}

struct VariantModel {
    field_index: usize,
    path: Path,
    name: String,
    payload: Kind,
}

struct GroupModel {
    enum_ty: Type,
    enum_name: String,
    discriminator: usize,
    variants: Vec<VariantModel>,
    span: Span,
}

enum EntryModel {
    Field { index: usize, name: String },
    OneOf { group: usize, name: String },
}

impl EntryModel {
    fn name(&self) -> &str {
        match self {
            Self::Field { name, .. } => name,
            Self::OneOf { name, .. } => name,
        }
    }
}

fn option_inner(ty: &Type) -> Option<&Type> {
    let path = match ty {
        Type::Path(path) if path.qself.is_none() => &path.path,
        _ => return None,
    };
    let segment = path.segments.last()?;
    if segment.ident != "Option" {
        return None;
    }
    let arguments = match &segment.arguments {
        syn::PathArguments::AngleBracketed(arguments) => arguments,
        _ => return None,
    };
    if arguments.args.len() != 1 {
        return None;
    }
    match &arguments.args[0] {
        syn::GenericArgument::Type(inner) => Some(inner),
        _ => None,
    }
}

fn path_prefix(path: &Path) -> Option<Path> {
    let count = path.segments.len();
    if count < 2 {
        return None;
    }
    let mut segments = Punctuated::new();
    for segment in path.segments.iter().take(count - 1) {
        segments.push(segment.clone());
    }
    Some(Path {
        leading_colon: path.leading_colon,
        segments,
    })
}

fn path_type(path: &Path) -> Type {
    Type::Path(TypePath {
        qself: None,
        path: path.clone(),
    })
}

fn ident_of(path: &Path) -> Ident {
    path.segments
        .last()
        .map(|segment| segment.ident.clone())
        .expect("path segment")
}

fn matches_enum_type(ty: &Type, enum_ident: &Ident) -> bool {
    kind::last_ident(ty).is_some_and(|ident| ident == enum_ident)
}

pub fn expand(ident: &Ident, data: &DataStruct) -> syn::Result<TokenStream> {
    let named = match &data.fields {
        Fields::Named(named) => &named.named,
        Fields::Unit => {
            return Err(syn::Error::new_spanned(
                ident,
                "`SilentProto` requires a struct with named fields",
            ))
        }
        Fields::Unnamed(unnamed) => {
            return Err(syn::Error::new_spanned(
                unnamed,
                "tuple structs are not supported; use named fields",
            ))
        }
    };

    let mut fields = Vec::with_capacity(named.len());
    for field in named {
        let field_ident = field.ident.clone().expect("named field");
        let attrs = attrs::parse(&field.attrs)?;
        let name = attrs
            .rename
            .clone()
            .unwrap_or_else(|| field_ident.to_string());
        fields.push(FieldModel {
            ident: field_ident,
            ty: field.ty.clone(),
            name,
            attrs,
            kind: None,
        });
    }

    let groups = build_groups(&fields)?;
    let mut discriminator_groups = vec![None; fields.len()];
    for (group_index, group) in groups.iter().enumerate() {
        discriminator_groups[group.discriminator] = Some(group_index);
    }

    for (index, field) in fields.iter_mut().enumerate() {
        if field.attrs.skip || !field.attrs.oneof.is_empty() {
            continue;
        }
        if discriminator_groups[index].is_some() {
            if field.attrs.wire.is_some() {
                return Err(syn::Error::new_spanned(
                    &field.ty,
                    "oneof discriminator cannot have an explicit wire type",
                ));
            }
            field.kind = Some(Kind::Enum(field.ty.clone()));
        } else {
            field.kind = Some(kind::classify(&field.ty, &field.attrs)?);
        }
    }

    let mut entries = Vec::new();
    for (index, field) in fields.iter().enumerate() {
        if field.attrs.skip || !field.attrs.oneof.is_empty() {
            continue;
        }
        if let Some(group) = discriminator_groups[index] {
            entries.push(EntryModel::OneOf {
                group,
                name: field.name.clone(),
            });
        } else {
            entries.push(EntryModel::Field {
                index,
                name: field.name.clone(),
            });
        }
    }
    entries.sort_by(|left, right| left.name().as_bytes().cmp(right.name().as_bytes()));
    for pair in entries.windows(2) {
        if pair[0].name() == pair[1].name() {
            return Err(syn::Error::new(
                Span::call_site(),
                format!("duplicate protocol field name `{}`", pair[0].name()),
            ));
        }
    }

    let bitmap_len = entries
        .iter()
        .filter(|entry| {
            matches!(entry, EntryModel::Field { index, .. } if fields[*index].kind.as_ref().is_some_and(Kind::is_option))
        })
        .count()
        .div_ceil(8);

    let encoder = generate_write(&fields, &groups, &entries, bitmap_len)?;
    let decoder = generate_read(&fields, &groups, &entries, bitmap_len)?;
    let schema = generate_schema(&fields, &groups, &entries)?;

    let all_idents: Vec<&Ident> = fields.iter().map(|field| &field.ident).collect();

    Ok(quote! {
        impl ::silent_protocol::SilentProto for #ident {
            fn write(
                &self,
                encoder: &mut ::silent_protocol::Encoder<'_>,
            ) -> ::core::result::Result<(), ::silent_protocol::ProtocolError> {
                #encoder
                ::core::result::Result::Ok(())
            }

            fn read(
                decoder: &mut ::silent_protocol::Decoder<'_>,
            ) -> ::core::result::Result<Self, ::silent_protocol::ProtocolError> {
                #decoder
                ::core::result::Result::Ok(Self { #(#all_idents),* })
            }

            fn schema() -> ::std::vec::Vec<::silent_protocol::SchemaEntry> {
                #schema
            }
        }
    })
}

fn build_groups(fields: &[FieldModel]) -> syn::Result<Vec<GroupModel>> {
    let mut groups: BTreeMap<String, (Path, Vec<(usize, Path)>)> = BTreeMap::new();
    for (index, field) in fields.iter().enumerate() {
        if field.attrs.oneof.is_empty() {
            continue;
        }
        if field.attrs.oneof.len() > 1 {
            return Err(syn::Error::new_spanned(
                &field.attrs.oneof[1],
                "a field cannot belong to multiple oneof groups",
            ));
        }
        let path = &field.attrs.oneof[0];
        let prefix = path_prefix(path).ok_or_else(|| {
            syn::Error::new_spanned(
                path,
                "expected an enum variant path such as `Kind::Variant`",
            )
        })?;
        groups
            .entry(kind::path_label(&prefix))
            .or_insert_with(|| (prefix, Vec::new()))
            .1
            .push((index, path.clone()));
    }

    let mut result = Vec::new();
    for (_, (enum_path, variants)) in groups {
        let enum_name_ident = ident_of(&enum_path);
        let enum_name = enum_name_ident.to_string();
        let enum_label = kind::path_label(&enum_path);
        let enum_ty = path_type(&enum_path);

        let mut seen_variants = Vec::new();
        let mut models = Vec::new();
        for (index, variant_path) in variants {
            let label = kind::path_label(&variant_path);
            if seen_variants.contains(&label) {
                return Err(syn::Error::new_spanned(
                    &variant_path,
                    format!("enum variant `{label}` is used in multiple oneof variants"),
                ));
            }
            seen_variants.push(label);
            let field = &fields[index];
            let inner = option_inner(&field.ty).ok_or_else(|| {
                syn::Error::new_spanned(
                    &field.ty,
                    format!(
                        "oneof variant field `{}` must have type `Option<T>`",
                        field.ident
                    ),
                )
            })?;
            let payload = kind::classify_plain(inner)?;
            if payload.is_option() {
                return Err(syn::Error::new_spanned(
                    inner,
                    "nested optional oneof payloads are not supported",
                ));
            }
            models.push(VariantModel {
                field_index: index,
                path: variant_path,
                name: field.name.clone(),
                payload,
            });
        }
        let mut seen_names = Vec::new();
        for model in &models {
            if seen_names.contains(&model.name) {
                return Err(syn::Error::new_spanned(
                    &model.path,
                    format!("duplicate oneof variant name `{}`", model.name),
                ));
            }
            seen_names.push(model.name.clone());
        }

        let mut candidates = Vec::new();
        for (index, field) in fields.iter().enumerate() {
            if field.attrs.skip || !field.attrs.oneof.is_empty() {
                continue;
            }
            if let Some(inner) = option_inner(&field.ty) {
                if matches_enum_type(inner, &enum_name_ident) {
                    return Err(syn::Error::new_spanned(
                        &field.ty,
                        format!("oneof discriminator `{}` must not be optional", field.ident),
                    ));
                }
                continue;
            }
            if matches_enum_type(&field.ty, &enum_name_ident) {
                candidates.push(index);
            }
        }
        let discriminator = match candidates.as_slice() {
            [] => {
                return Err(syn::Error::new_spanned(
                    &enum_ty,
                    format!(
                    "no discriminator field of type `{enum_label}` found for oneof `{enum_name}`"
                ),
                ))
            }
            [single] => *single,
            _ => {
                return Err(syn::Error::new_spanned(
                    &enum_ty,
                    format!(
                    "multiple fields of type `{enum_label}` make the oneof discriminator ambiguous"
                ),
                ))
            }
        };
        result.push(GroupModel {
            enum_ty,
            enum_name,
            discriminator,
            variants: models,
            span: discriminator_span(fields, discriminator),
        });
    }
    let mut discriminators = Vec::new();
    for group in &result {
        if discriminators.contains(&group.discriminator) {
            return Err(syn::Error::new(
                group.span,
                "a field cannot be the discriminator of multiple oneofs",
            ));
        }
        discriminators.push(group.discriminator);
    }
    Ok(result)
}

fn discriminator_span(fields: &[FieldModel], index: usize) -> Span {
    fields[index].ident.span()
}

fn generate_write(
    fields: &[FieldModel],
    groups: &[GroupModel],
    entries: &[EntryModel],
    bitmap_len: usize,
) -> syn::Result<TokenStream> {
    let mut bitmap_sets = TokenStream::new();
    let mut body = TokenStream::new();
    let mut bit = 0usize;
    for entry in entries {
        match entry {
            EntryModel::Field { index, .. } => {
                let field = &fields[*index];
                let kind = field.kind.as_ref().expect("field kind");
                if let Kind::Option(inner) = kind {
                    let field_ident = &field.ident;
                    bitmap_sets.extend(quote! {
                        if self.#field_ident.is_some() {
                            __bitmap[#bit / 8] |= 1u8 << (#bit % 8);
                        }
                    });
                    let encode_inner = kind::encode(inner, &quote!(__value))?;
                    body.extend(quote! {
                        if let Some(__value) = self.#field_ident.as_ref() {
                            #encode_inner
                        }
                    });
                    bit += 1;
                } else {
                    let encode_value = kind::encode(kind, &quote!(__value))?;
                    let field_ident = &field.ident;
                    body.extend(quote! {
                        {
                            let __value = &self.#field_ident;
                            #encode_value
                        }
                    });
                }
            }
            EntryModel::OneOf { group, .. } => {
                let oneof = generate_write_oneof(fields, &groups[*group])?;
                body.extend(oneof);
            }
        }
    }
    let bitmap = if bitmap_len == 0 {
        quote!()
    } else {
        quote! {
            let mut __bitmap = [0u8; #bitmap_len];
            #bitmap_sets
            encoder.write_raw(&__bitmap)?;
        }
    };
    Ok(quote! {
        #bitmap
        #body
    })
}

fn generate_write_oneof(fields: &[FieldModel], group: &GroupModel) -> syn::Result<TokenStream> {
    let enum_ty = &group.enum_ty;
    let enum_name = &group.enum_name;
    let discriminator = &fields[group.discriminator].ident;
    let mut presence = TokenStream::new();
    let mut branches = TokenStream::new();
    for (index, variant) in group.variants.iter().enumerate() {
        let field = &fields[variant.field_index];
        let field_ident = &field.ident;
        presence.extend(quote! {
            if self.#field_ident.is_some() {
                __present += 1;
            }
        });
        let field_name = &variant.name;
        let variant_path = &variant.path;
        let encode_payload = kind::encode(&variant.payload, &quote!(__payload))?;
        let condition = quote!(
            __raw == <#enum_ty as ::silent_protocol::ProtoEnum>::to_proto(#variant_path)
        );
        let body = quote! {
            {
                let __payload = self.#field_ident.as_ref().ok_or_else(|| {
                    ::silent_protocol::ProtocolError::oneof_mismatch(
                        #enum_name,
                        #field_name,
                        __raw,
                    )
                })?;
                #encode_payload
            }
        };
        if index == 0 {
            branches.extend(quote!(if #condition #body));
        } else {
            branches.extend(quote!(else if #condition #body));
        }
    }
    Ok(quote! {
        {
            let mut __present = 0usize;
            #presence
            if __present != 1 {
                return ::core::result::Result::Err(
                    ::silent_protocol::ProtocolError::oneof_cardinality(#enum_name, __present),
                );
            }
            let __raw = <#enum_ty as ::silent_protocol::ProtoEnum>::to_proto(self.#discriminator);
            encoder.write_enum(__raw)?;
            #branches
            else {
                return ::core::result::Result::Err(
                    ::silent_protocol::ProtocolError::unknown_oneof_variant(#enum_name, __raw),
                );
            }
        }
    })
}

fn generate_read(
    fields: &[FieldModel],
    groups: &[GroupModel],
    entries: &[EntryModel],
    bitmap_len: usize,
) -> syn::Result<TokenStream> {
    let mut body = TokenStream::new();
    for field in fields {
        if field.attrs.skip {
            let ident = &field.ident;
            body.extend(quote! {
                let #ident = ::core::default::Default::default();
            });
        }
    }
    let bitmap = if bitmap_len == 0 {
        quote!()
    } else {
        let optional_count = entries
            .iter()
            .filter(|entry| {
                matches!(entry, EntryModel::Field { index, .. } if fields[*index].kind.as_ref().is_some_and(Kind::is_option))
            })
            .count();
        quote!(let __bits = decoder.read_bitmap(#optional_count)?;)
    };
    let mut bit = 0usize;
    for entry in entries {
        match entry {
            EntryModel::Field { index, .. } => {
                let field = &fields[*index];
                let field_ident = &field.ident;
                let kind = field.kind.as_ref().expect("field kind");
                if let Kind::Option(inner) = kind {
                    let decode_inner = kind::decode(inner)?;
                    body.extend(quote! {
                        let #field_ident = if __bits.get(#bit) {
                            Some(#decode_inner)
                        } else {
                            None
                        };
                    });
                    bit += 1;
                } else {
                    let decode_value = kind::decode(kind)?;
                    body.extend(quote! {
                        let #field_ident = #decode_value;
                    });
                }
            }
            EntryModel::OneOf { group, .. } => {
                let oneof = generate_read_oneof(fields, &groups[*group])?;
                body.extend(oneof);
            }
        }
    }
    Ok(quote! {
        #bitmap
        #body
    })
}

fn generate_read_oneof(fields: &[FieldModel], group: &GroupModel) -> syn::Result<TokenStream> {
    let enum_ty = &group.enum_ty;
    let enum_name = &group.enum_name;
    let discriminator = &fields[group.discriminator].ident;
    let idents: Vec<&Ident> = group
        .variants
        .iter()
        .map(|variant| &fields[variant.field_index].ident)
        .collect();
    let mut branches = TokenStream::new();
    for (index, variant) in group.variants.iter().enumerate() {
        let variant_path = &variant.path;
        let decode_payload = kind::decode(&variant.payload)?;
        let mut values = TokenStream::new();
        for (other, _ident) in idents.iter().enumerate() {
            let value = if other == index {
                quote!(Some(#decode_payload))
            } else {
                quote!(None)
            };
            values.extend(quote!(#value,));
        }
        let condition = quote!(
            __raw == <#enum_ty as ::silent_protocol::ProtoEnum>::to_proto(#variant_path)
        );
        let body = quote! { { ( #values ) } };
        if index == 0 {
            branches.extend(quote!(if #condition #body));
        } else {
            branches.extend(quote!(else if #condition #body));
        }
    }
    Ok(quote! {
        let __raw = decoder.read_enum_value()?;
        let #discriminator = <#enum_ty as ::silent_protocol::ProtoEnum>::from_proto(__raw)?;
        let ( #(#idents,)* ) = #branches
        else {
            return ::core::result::Result::Err(
                ::silent_protocol::ProtocolError::unknown_oneof_variant(#enum_name, __raw),
            );
        };
    })
}

fn generate_schema(
    fields: &[FieldModel],
    groups: &[GroupModel],
    entries: &[EntryModel],
) -> syn::Result<TokenStream> {
    let mut items = TokenStream::new();
    for entry in entries {
        match entry {
            EntryModel::Field { index, name } => {
                let field = &fields[*index];
                let kind = field.kind.as_ref().expect("field kind");
                let (ty, optional) = match kind {
                    Kind::Option(inner) => (kind::schema_type(inner)?, true),
                    other => (kind::schema_type(other)?, false),
                };
                items.extend(quote! {
                    ::silent_protocol::SchemaEntry::Field(::silent_protocol::SchemaField {
                        name: #name,
                        ty: #ty,
                        optional: #optional,
                    }),
                });
            }
            EntryModel::OneOf { group, name } => {
                let oneof = &groups[*group];
                let enum_ty = &oneof.enum_ty;
                let enum_name = &oneof.enum_name;
                let mut variants = TokenStream::new();
                for variant in &oneof.variants {
                    let variant_path = &variant.path;
                    let variant_name = &variant.name;
                    let ty = kind::schema_type(&variant.payload)?;
                    variants.extend(quote! {
                        ::silent_protocol::SchemaVariant {
                            value: <#enum_ty as ::silent_protocol::ProtoEnum>::to_proto(#variant_path),
                            field: #variant_name,
                            ty: #ty,
                        },
                    });
                }
                items.extend(quote! {
                    ::silent_protocol::SchemaEntry::OneOf(::silent_protocol::SchemaOneOf {
                        name: #name,
                        enum_name: #enum_name,
                        variants: {
                            let mut __variants = ::std::vec![#variants];
                            __variants.sort_by_key(|__variant| __variant.value);
                            __variants
                        },
                    }),
                });
            }
        }
    }
    Ok(quote! {
        ::std::vec![#items]
    })
}
