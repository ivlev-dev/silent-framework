use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::{format_ident, quote};
use syn::{
    parse_macro_input, Attribute, Data, DeriveInput, Expr, Fields, FnArg, ImplItem, ImplItemFn,
    ItemImpl, Path, Type,
};

fn reactive_fields(input: &DeriveInput) -> syn::Result<Vec<(syn::Field, syn::Ident, Type)>> {
    let Data::Struct(data) = &input.data else {
        return Err(syn::Error::new_spanned(
            &input.ident,
            "ViewModel can only be derived for structs",
        ));
    };
    let Fields::Named(fields) = &data.fields else {
        return Err(syn::Error::new_spanned(
            &input.ident,
            "ViewModel requires named fields",
        ));
    };
    let mut result = Vec::new();
    for field in &fields.named {
        if !has_attr(&field.attrs, "reactive") {
            continue;
        }
        let Some(ident) = field.ident.clone() else {
            continue;
        };
        let inner = signal_inner_type(&field.ty).ok_or_else(|| {
            syn::Error::new_spanned(
                &field.ty,
                "#[reactive] field must have type Signal<T> or Reactive<T>",
            )
        })?;
        result.push((field.clone(), ident, inner));
    }
    Ok(result)
}

fn has_attr(attrs: &[Attribute], name: &str) -> bool {
    attrs.iter().any(|attr| attr.path().is_ident(name))
}

fn signal_inner_type(ty: &Type) -> Option<Type> {
    let Type::Path(path) = ty else {
        return None;
    };
    let segment = path.path.segments.last()?;
    if segment.ident != "Signal" && segment.ident != "Reactive" {
        return None;
    }
    let syn::PathArguments::AngleBracketed(args) = &segment.arguments else {
        return None;
    };
    args.args.iter().find_map(|arg| match arg {
        syn::GenericArgument::Type(inner) => Some(inner.clone()),
        _ => None,
    })
}

#[proc_macro_derive(ViewModel, attributes(reactive))]
pub fn derive_view_model(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    match expand_view_model(&input) {
        Ok(tokens) => tokens.into(),
        Err(error) => error.to_compile_error().into(),
    }
}

fn expand_view_model(input: &DeriveInput) -> syn::Result<TokenStream2> {
    let ident = &input.ident;
    let fields = reactive_fields(input)?;
    let generics = &input.generics;
    let (impl_generics, type_generics, where_clause) = generics.split_for_impl();
    let mut methods = Vec::new();
    for (_, field_ident, inner) in &fields {
        let getter = format_ident!("{}", field_ident);
        let setter = format_ident!("set_{}", field_ident);
        let signal_getter = format_ident!("{}_signal", field_ident);
        let field_ty = &fields
            .iter()
            .find(|(_, name, _)| name == field_ident)
            .map(|(field, _, _)| field.ty.clone())
            .expect("field type");
        methods.push(quote! {
            pub fn #getter(&self) -> #inner {
                self.#getter.get()
            }

            pub fn #setter(&self, value: #inner) {
                self.#getter.set(value);
            }

            pub fn #signal_getter(&self) -> #field_ty {
                self.#getter
            }
        });
    }
    let vm_id = if let Some((_, first, _)) = fields.first() {
        quote! {
            #[doc(hidden)]
            pub fn __vm_id(&self) -> u64 {
                ::ui_core::view_model::handle_id(&self.#first)
            }
        }
    } else {
        quote! {
            #[doc(hidden)]
            pub fn __vm_id(&self) -> u64 {
                ::ui_core::view_model::type_vm_id::<Self>()
            }
        }
    };
    let reactive_ids = if fields.is_empty() {
        quote! {
            #[doc(hidden)]
            pub fn __reactive_ids(&self) -> ::std::vec::Vec<u64> {
                ::std::vec::Vec::new()
            }
        }
    } else {
        let ids = fields.iter().map(|(_, field_ident, _)| {
            quote! { self.#field_ident.id() }
        });
        quote! {
            #[doc(hidden)]
            pub fn __reactive_ids(&self) -> ::std::vec::Vec<u64> {
                ::std::vec![#(#ids),*]
            }
        }
    };
    Ok(quote! {
        impl #impl_generics #ident #type_generics #where_clause {
            #(#methods)*
            #vm_id
            #reactive_ids
        }
    })
}

#[proc_macro_attribute]
pub fn view_model(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let mut input = parse_macro_input!(item as ItemImpl);
    match expand_view_model_impl(&mut input) {
        Ok(tokens) => tokens.into(),
        Err(error) => error.to_compile_error().into(),
    }
}

struct WatchMethod {
    method: syn::Ident,
    fields: Vec<syn::Ident>,
}

struct ComputedMethod {
    method: syn::Ident,
    key: u64,
}

fn expand_view_model_impl(input: &mut ItemImpl) -> syn::Result<TokenStream2> {
    if self_type(&input.self_ty).is_none() {
        return Err(syn::Error::new_spanned(
            &input.self_ty,
            "view_model requires a named impl type",
        ));
    }
    let mut computed = Vec::new();
    let mut watches = Vec::new();
    let mut has_view = false;
    let mut has_on_mount = false;
    let mut has_on_dispose = false;
    let mut has_on_frame = false;
    let mut has_scope = false;
    for item in &mut input.items {
        let ImplItem::Fn(function) = item else {
            continue;
        };
        let name = function.sig.ident.to_string();
        match name.as_str() {
            "view" => has_view = true,
            "on_mount" => has_on_mount = true,
            "on_dispose" => has_on_dispose = true,
            "on_frame" => has_on_frame = true,
            "scope" => has_scope = true,
            _ => {}
        }
        if let Some(attr) = take_attr(&mut function.attrs, "computed") {
            let _ = attr;
            validate_self_method(function)?;
            computed.push(ComputedMethod {
                method: function.sig.ident.clone(),
                key: hash_name(&name),
            });
        }
        if let Some(attr) = take_attr(&mut function.attrs, "watch") {
            let fields = parse_watch_fields(&attr)?;
            validate_self_method(function)?;
            watches.push(WatchMethod {
                method: function.sig.ident.clone(),
                fields,
            });
        }
    }
    if !has_view {
        return Err(syn::Error::new_spanned(
            &input.self_ty,
            "view_model impl must define fn view(&self) -> Widget",
        ));
    }
    for computed in &computed {
        let method = &computed.method;
        let key = computed.key;
        if let Some(ImplItem::Fn(function)) = input
            .items
            .iter_mut()
            .find(|item| matches!(item, ImplItem::Fn(f) if f.sig.ident == *method))
        {
            let body = &function.block;
            let sig = &function.sig;
            let attrs = &function.attrs;
            let replacement = quote! {
                #(#attrs)*
                #sig {
                    let __revision = ::ui_core::signal::revision();
                    ::ui_core::view_model::memo(
                        self.__vm_id(),
                        #key,
                        __revision,
                        || #body,
                    )
                }
            };
            *function = syn::parse2(replacement)?;
        }
    }
    let mut forwards = Vec::new();
    if has_on_mount {
        forwards.push(quote! {
            fn on_mount(&self) {
                Self::on_mount(self);
            }
        });
    }
    if has_on_dispose {
        forwards.push(quote! {
            fn on_dispose(&self) {
                Self::on_dispose(self);
            }
        });
    }
    if has_on_frame {
        forwards.push(quote! {
            fn on_frame(&self) {
                Self::on_frame(self);
            }
        });
    }
    if has_scope {
        forwards.push(quote! {
            fn scope(&self) -> ::std::option::Option<&::ui_core::signal::Scope> {
                Self::scope(self)
            }
        });
    }
    let watcher_setup = if watches.is_empty() {
        quote! {}
    } else {
        let statements = watches.iter().map(|watch| {
            let method = &watch.method;
            let key = hash_name(&method.to_string());
            let field_reads = watch.fields.iter().map(|field| {
                quote! { let _ = __this.#field.get(); }
            });
            quote! {
                {
                    let __this = ::std::sync::Arc::clone(self);
                    let __first = ::std::cell::Cell::new(true);
                    ::ui_core::view_model::watch(self.__vm_id(), #key, move || {
                        #(#field_reads)*
                        if __first.replace(false) {
                            return;
                        }
                        __this.#method();
                    });
                }
            }
        });
        quote! {
            fn setup_watchers(self: &::std::sync::Arc<Self>) {
                #(#statements)*
            }
        }
    };
    let (impl_generics, _, where_clause) = input.generics.split_for_impl();
    let self_ty = &input.self_ty;
    Ok(quote! {
        #input

        impl #impl_generics ::ui_core::view_model::ViewModel for #self_ty #where_clause {
            fn view(&self) -> ::ui_core::widget::Widget {
                Self::view(self)
            }

            #(#forwards)*

            fn reactive_ids(&self) -> ::std::vec::Vec<u64> {
                self.__reactive_ids()
            }

            fn vm_id(&self) -> u64 {
                self.__vm_id()
            }

            #watcher_setup
        }
    })
}

fn self_type(ty: &Type) -> Option<syn::Ident> {
    let Type::Path(path) = ty else {
        return None;
    };
    if path.qself.is_some() {
        return None;
    }
    path.path
        .segments
        .last()
        .map(|segment| segment.ident.clone())
}

fn validate_self_method(function: &ImplItemFn) -> syn::Result<()> {
    let Some(first) = function.sig.inputs.first() else {
        return Err(syn::Error::new_spanned(
            &function.sig,
            "view model methods must take &self",
        ));
    };
    let FnArg::Receiver(receiver) = first else {
        return Err(syn::Error::new_spanned(
            &function.sig,
            "view model methods must take &self",
        ));
    };
    if receiver.reference.is_none() {
        return Err(syn::Error::new_spanned(
            &function.sig,
            "view model methods must take &self",
        ));
    }
    let _ = &function.sig.output;
    Ok(())
}

fn take_attr(attrs: &mut Vec<Attribute>, name: &str) -> Option<Attribute> {
    let position = attrs.iter().position(|attr| attr.path().is_ident(name))?;
    Some(attrs.remove(position))
}

fn parse_watch_fields(attr: &Attribute) -> syn::Result<Vec<syn::Ident>> {
    let expressions = attr
        .parse_args_with(syn::punctuated::Punctuated::<Expr, syn::Token![,]>::parse_terminated)?;
    let mut fields = Vec::new();
    for expression in expressions {
        match expression {
            Expr::Field(field) => {
                if let syn::Member::Named(name) = &field.member {
                    fields.push(name.clone());
                } else {
                    return Err(syn::Error::new_spanned(field, "watch expects self.field"));
                }
            }
            other => {
                return Err(syn::Error::new_spanned(other, "watch expects self.field"));
            }
        }
    }
    if fields.is_empty() {
        return Err(syn::Error::new_spanned(
            attr,
            "watch requires at least one self.field",
        ));
    }
    Ok(fields)
}

fn hash_name(name: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in name.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[proc_macro_derive(Injectable, attributes(inject, init, injectable, provides, reactive))]
pub fn derive_injectable(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    match expand_injectable(&input) {
        Ok(tokens) => tokens.into(),
        Err(error) => error.to_compile_error().into(),
    }
}

fn expand_injectable(input: &DeriveInput) -> syn::Result<TokenStream2> {
    let ident = &input.ident;
    if !input.generics.params.is_empty() {
        return Err(syn::Error::new_spanned(
            &input.generics,
            "Injectable does not support generic types",
        ));
    }
    let Data::Struct(data) = &input.data else {
        return Err(syn::Error::new_spanned(
            ident,
            "Injectable supports structs only",
        ));
    };
    let fields = match &data.fields {
        Fields::Named(fields) => fields.named.iter().collect::<Vec<_>>(),
        Fields::Unit => Vec::new(),
        Fields::Unnamed(_) => {
            return Err(syn::Error::new_spanned(
                ident,
                "Injectable requires named fields",
            ));
        }
    };
    let mut lifetime = quote! { ::ui_core::di::Lifetime::Singleton };
    let mut provided: Vec<Path> = Vec::new();
    for attr in &input.attrs {
        if attr.path().is_ident("injectable") {
            attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("singleton") {
                    lifetime = quote! { ::ui_core::di::Lifetime::Singleton };
                    return Ok(());
                }
                if meta.path.is_ident("scoped") {
                    lifetime = quote! { ::ui_core::di::Lifetime::Scoped };
                    return Ok(());
                }
                if meta.path.is_ident("transient") {
                    lifetime = quote! { ::ui_core::di::Lifetime::Transient };
                    return Ok(());
                }
                Err(meta.error("expected singleton, scoped or transient"))
            })?;
        }
        if attr.path().is_ident("provides") {
            let paths = attr.parse_args_with(
                syn::punctuated::Punctuated::<Path, syn::Token![,]>::parse_terminated,
            )?;
            provided.extend(paths);
        }
    }
    let mut initializers = Vec::new();
    for field in &fields {
        let Some(field_ident) = &field.ident else {
            continue;
        };
        if has_attr(&field.attrs, "inject") {
            let field_ty = &field.ty;
            let initialization = if let Some(inner) = arc_inner_type(field_ty) {
                if matches!(inner, Type::TraitObject(_)) {
                    quote! { container.resolve_trait::<#inner>()? }
                } else {
                    quote! { container.resolve::<#inner>()? }
                }
            } else {
                quote! { container.resolve::<#field_ty>()? }
            };
            initializers.push(quote! {
                #field_ident: {
                    let __value: #field_ty = #initialization;
                    __value
                }
            });
        } else if let Some(attr) = field.attrs.iter().find(|attr| attr.path().is_ident("init")) {
            let expr: Expr = attr.parse_args()?;
            initializers.push(quote! { #field_ident: #expr });
        } else {
            initializers.push(quote! { #field_ident: ::std::default::Default::default() });
        }
    }
    let trait_descriptors = provided.iter().map(|path| {
        quote! {
            ::ui_core::inventory::submit! {
                ::ui_core::di::ServiceDescriptor {
                    type_name: ::std::concat!(::std::stringify!(#ident), " as ", ::std::stringify!(#path)),
                    type_id: || ::std::any::TypeId::of::<dyn #path>(),
                    is_trait: true,
                    lifetime: #lifetime,
                    factory: |container| {
                        let concrete = container.resolve::<#ident>()?;
                        let value: ::std::sync::Arc<dyn #path> = concrete;
                        ::std::result::Result::Ok(
                            ::std::sync::Arc::new(value) as ::ui_core::di::AnyValue
                        )
                    },
                }
            }
        }
    });
    Ok(quote! {
        impl ::ui_core::di::Injectable for #ident {
            fn create(
                container: &::ui_core::di::Container,
            ) -> ::std::result::Result<Self, ::ui_core::di::DiError> {
                ::std::result::Result::Ok(Self {
                    #(#initializers),*
                })
            }
        }

        ::ui_core::inventory::submit! {
            ::ui_core::di::ServiceDescriptor {
                type_name: ::std::stringify!(#ident),
                type_id: || ::std::any::TypeId::of::<#ident>(),
                is_trait: false,
                lifetime: #lifetime,
                factory: |container| {
                    let value = <#ident as ::ui_core::di::Injectable>::create(container)?;
                    ::std::result::Result::Ok(
                        ::std::sync::Arc::new(::std::sync::Arc::new(value))
                            as ::ui_core::di::AnyValue
                    )
                },
            }
        }

        #(#trait_descriptors)*
    })
}

fn arc_inner_type(ty: &Type) -> Option<Type> {
    let Type::Path(path) = ty else {
        return None;
    };
    let segment = path.path.segments.last()?;
    if segment.ident != "Arc" {
        return None;
    }
    let syn::PathArguments::AngleBracketed(args) = &segment.arguments else {
        return None;
    };
    args.args.iter().find_map(|arg| match arg {
        syn::GenericArgument::Type(inner) => Some(inner.clone()),
        _ => None,
    })
}
