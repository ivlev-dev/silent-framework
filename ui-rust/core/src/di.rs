use std::any::{Any, TypeId};
use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lifetime {
    Singleton,
    Scoped,
    Transient,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiError {
    NotRegistered {
        type_name: &'static str,
    },
    Cycle {
        chain: Vec<&'static str>,
    },
    Ambiguous {
        trait_name: &'static str,
        providers: Vec<&'static str>,
    },
    Disposed,
    TypeMismatch {
        type_name: &'static str,
    },
}

impl fmt::Display for DiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DiError::NotRegistered { type_name } => {
                write!(f, "service {type_name} is not registered")
            }
            DiError::Cycle { chain } => {
                write!(f, "dependency cycle detected: {}", chain.join(" -> "))
            }
            DiError::Ambiguous {
                trait_name,
                providers,
            } => {
                write!(
                    f,
                    "trait {trait_name} has multiple providers: {}",
                    providers.join(", ")
                )
            }
            DiError::Disposed => f.write_str("container is disposed"),
            DiError::TypeMismatch { type_name } => {
                write!(f, "service {type_name} has an unexpected stored type")
            }
        }
    }
}

impl std::error::Error for DiError {}

pub type AnyValue = Arc<dyn Any + Send + Sync>;
type AnyFactory = Arc<dyn Fn(&Container) -> Result<AnyValue, DiError> + Send + Sync>;

#[derive(Clone, Copy)]
pub struct ServiceDescriptor {
    pub type_name: &'static str,
    pub type_id: fn() -> TypeId,
    pub is_trait: bool,
    pub lifetime: Lifetime,
    pub factory: fn(&Container) -> Result<AnyValue, DiError>,
}

inventory::collect!(ServiceDescriptor);

pub trait Injectable: Sized + Send + Sync + 'static {
    fn create(container: &Container) -> Result<Self, DiError>;
}

struct ServiceIndex {
    concrete: HashMap<TypeId, ServiceDescriptor>,
    traits: HashMap<TypeId, Vec<ServiceDescriptor>>,
}

static SERVICE_INDEX: std::sync::OnceLock<ServiceIndex> = std::sync::OnceLock::new();

fn service_index() -> &'static ServiceIndex {
    SERVICE_INDEX.get_or_init(|| {
        let mut concrete = HashMap::new();
        let mut traits: HashMap<TypeId, Vec<ServiceDescriptor>> = HashMap::new();
        for descriptor in inventory::iter::<ServiceDescriptor> {
            let key = (descriptor.type_id)();
            if descriptor.is_trait {
                traits.entry(key).or_default().push(*descriptor);
            } else {
                concrete.entry(key).or_insert(*descriptor);
            }
        }
        ServiceIndex { concrete, traits }
    })
}

fn auto_descriptor(key: TypeId, type_name: &'static str) -> Result<ServiceDescriptor, DiError> {
    let index = service_index();
    if let Some(descriptor) = index.concrete.get(&key) {
        return Ok(*descriptor);
    }
    if let Some(providers) = index.traits.get(&key) {
        if providers.len() == 1 {
            return Ok(providers[0]);
        }
        return Err(DiError::Ambiguous {
            trait_name: type_name,
            providers: providers
                .iter()
                .map(|provider| provider.type_name)
                .collect(),
        });
    }
    Err(DiError::NotRegistered { type_name })
}

struct Registration {
    type_name: &'static str,
    lifetime: Lifetime,
    factory: AnyFactory,
}

struct ContainerInner {
    registrations: Mutex<HashMap<TypeId, Registration>>,
    cache: Mutex<HashMap<TypeId, AnyValue>>,
    children: Mutex<Vec<Weak<ContainerInner>>>,
    parent: Option<Container>,
    disposed: AtomicBool,
}

pub struct Container {
    inner: Arc<ContainerInner>,
}

impl Clone for Container {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl fmt::Debug for Container {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Container")
            .field("disposed", &self.is_disposed())
            .finish()
    }
}

impl Default for Container {
    fn default() -> Self {
        Self::new()
    }
}

impl Container {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(ContainerInner {
                registrations: Mutex::new(HashMap::new()),
                cache: Mutex::new(HashMap::new()),
                children: Mutex::new(Vec::new()),
                parent: None,
                disposed: AtomicBool::new(false),
            }),
        }
    }

    pub fn scope(&self) -> Self {
        let container = Self {
            inner: Arc::new(ContainerInner {
                registrations: Mutex::new(HashMap::new()),
                cache: Mutex::new(HashMap::new()),
                children: Mutex::new(Vec::new()),
                parent: Some(self.clone()),
                disposed: AtomicBool::new(false),
            }),
        };
        if let Ok(mut children) = self.inner.children.lock() {
            children.push(Arc::downgrade(&container.inner));
        }
        container
    }

    pub fn is_disposed(&self) -> bool {
        self.inner.disposed.load(Ordering::Acquire)
    }

    pub fn dispose(&self) {
        if self.inner.disposed.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Ok(mut cache) = self.inner.cache.lock() {
            cache.clear();
        }
        let children = self
            .inner
            .children
            .lock()
            .map(|children| {
                children
                    .iter()
                    .filter_map(Weak::upgrade)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for child in children {
            Container { inner: child }.dispose();
        }
    }

    pub fn bind<T, F>(&self, factory: F) -> Binding<'_>
    where
        T: Send + Sync + 'static,
        F: Fn(&Container) -> T + Send + Sync + 'static,
    {
        let wrapped: AnyFactory = Arc::new(move |container| {
            let value = Arc::new(factory(container));
            Ok(Arc::new(value) as AnyValue)
        });
        Binding::new(self, TypeId::of::<T>(), std::any::type_name::<T>(), wrapped)
    }

    pub fn bind_arc<T, F>(&self, factory: F) -> Binding<'_>
    where
        T: ?Sized + Send + Sync + 'static,
        F: Fn(&Container) -> Arc<T> + Send + Sync + 'static,
    {
        let wrapped: AnyFactory = Arc::new(move |container| {
            let value = factory(container);
            Ok(Arc::new(value) as AnyValue)
        });
        Binding::new(self, TypeId::of::<T>(), std::any::type_name::<T>(), wrapped)
    }

    pub fn bind_async<T, F, Fut>(&self, factory: F) -> Binding<'_>
    where
        T: Send + Sync + 'static,
        F: Fn(&Container) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = T> + Send + 'static,
    {
        let wrapped: AnyFactory = Arc::new(move |container| {
            let future = factory(container);
            let value = futures_lite_block_on(future);
            Ok(Arc::new(Arc::new(value)) as AnyValue)
        });
        Binding::new(self, TypeId::of::<T>(), std::any::type_name::<T>(), wrapped)
    }

    fn register(
        &self,
        key: TypeId,
        type_name: &'static str,
        lifetime: Lifetime,
        factory: AnyFactory,
    ) {
        if let Ok(mut registrations) = self.inner.registrations.lock() {
            registrations.insert(
                key,
                Registration {
                    type_name,
                    lifetime,
                    factory,
                },
            );
        }
    }

    fn find_registration(&self, key: TypeId) -> Option<(Container, Registration)> {
        let mut current = Some(self.clone());
        while let Some(container) = current {
            let found = container
                .inner
                .registrations
                .lock()
                .ok()
                .and_then(|registrations| {
                    registrations.get(&key).map(|registration| Registration {
                        type_name: registration.type_name,
                        lifetime: registration.lifetime,
                        factory: Arc::clone(&registration.factory),
                    })
                });
            if let Some(registration) = found {
                return Some((container, registration));
            }
            current = container.inner.parent.clone();
        }
        None
    }

    pub fn is_registered<T: ?Sized + 'static>(&self) -> bool {
        self.find_registration(TypeId::of::<T>()).is_some()
    }

    pub fn resolve<T>(&self) -> Result<Arc<T>, DiError>
    where
        T: Send + Sync + 'static,
    {
        self.resolve_any::<T>()
    }

    pub fn resolve_trait<T>(&self) -> Result<Arc<T>, DiError>
    where
        T: ?Sized + Send + Sync + 'static,
    {
        self.resolve_any::<T>()
    }

    pub async fn resolve_async<T>(&self) -> Result<Arc<T>, DiError>
    where
        T: Send + Sync + 'static,
    {
        self.resolve_any::<T>()
    }

    pub async fn resolve_trait_async<T>(&self) -> Result<Arc<T>, DiError>
    where
        T: ?Sized + Send + Sync + 'static,
    {
        self.resolve_any::<T>()
    }

    fn root(&self) -> Container {
        let mut current = self.clone();
        while let Some(parent) = current.inner.parent.clone() {
            current = parent;
        }
        current
    }

    fn resolve_any<T>(&self) -> Result<Arc<T>, DiError>
    where
        T: ?Sized + Send + Sync + 'static,
    {
        if self.is_disposed() {
            return Err(DiError::Disposed);
        }
        let key = TypeId::of::<T>();
        let type_name = std::any::type_name::<T>();
        let (lifetime, context, factory) = match self.find_registration(key) {
            Some((owner, registration)) => {
                let context = match registration.lifetime {
                    Lifetime::Singleton => owner,
                    Lifetime::Scoped | Lifetime::Transient => self.clone(),
                };
                (
                    registration.lifetime,
                    context,
                    FactorySource::Explicit(registration.factory),
                )
            }
            None => {
                let descriptor = auto_descriptor(key, type_name)?;
                let context = match descriptor.lifetime {
                    Lifetime::Singleton => self.root(),
                    Lifetime::Scoped | Lifetime::Transient => self.clone(),
                };
                (
                    descriptor.lifetime,
                    context,
                    FactorySource::Auto(descriptor.factory),
                )
            }
        };
        let cache_container = match lifetime {
            Lifetime::Singleton => context.clone(),
            Lifetime::Scoped | Lifetime::Transient => self.clone(),
        };
        if lifetime != Lifetime::Transient {
            if let Ok(cache) = cache_container.inner.cache.lock() {
                if let Some(value) = cache.get(&key) {
                    return downcast_value::<T>(value, type_name);
                }
            }
        }
        with_resolving(key, type_name, || {
            let value = factory.call(&context)?;
            if lifetime != Lifetime::Transient {
                if let Ok(mut cache) = cache_container.inner.cache.lock() {
                    cache.entry(key).or_insert_with(|| Arc::clone(&value));
                }
            }
            downcast_value::<T>(&value, type_name)
        })
    }
}

enum FactorySource {
    Explicit(AnyFactory),
    Auto(fn(&Container) -> Result<AnyValue, DiError>),
}

impl FactorySource {
    fn call(&self, container: &Container) -> Result<AnyValue, DiError> {
        match self {
            FactorySource::Explicit(factory) => factory(container),
            FactorySource::Auto(factory) => factory(container),
        }
    }
}

fn downcast_value<T>(value: &AnyValue, type_name: &'static str) -> Result<Arc<T>, DiError>
where
    T: ?Sized + Send + Sync + 'static,
{
    value
        .downcast_ref::<Arc<T>>()
        .map(Arc::clone)
        .ok_or(DiError::TypeMismatch { type_name })
}

thread_local! {
    static RESOLVE_STACK: std::cell::RefCell<Vec<(TypeId, &'static str)>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

fn with_resolving<R>(
    key: TypeId,
    type_name: &'static str,
    f: impl FnOnce() -> Result<R, DiError>,
) -> Result<R, DiError> {
    let cycle = RESOLVE_STACK.with(|stack| {
        let stack = stack.borrow();
        stack.iter().position(|(id, _)| *id == key).map(|position| {
            let mut chain: Vec<&'static str> =
                stack[position..].iter().map(|(_, name)| *name).collect();
            chain.push(type_name);
            chain
        })
    });
    if let Some(chain) = cycle {
        return Err(DiError::Cycle { chain });
    }
    RESOLVE_STACK.with(|stack| stack.borrow_mut().push((key, type_name)));
    let result = f();
    RESOLVE_STACK.with(|stack| {
        stack.borrow_mut().pop();
    });
    result
}

fn futures_lite_block_on<F: std::future::Future>(future: F) -> F::Output {
    struct ThreadWaker(std::thread::Thread);
    impl std::task::Wake for ThreadWaker {
        fn wake(self: std::sync::Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = std::task::Waker::from(std::sync::Arc::new(ThreadWaker(std::thread::current())));
    let mut context = std::task::Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    loop {
        match future.as_mut().poll(&mut context) {
            std::task::Poll::Ready(value) => return value,
            std::task::Poll::Pending => std::thread::park(),
        }
    }
}

pub struct Binding<'a> {
    container: &'a Container,
    key: TypeId,
    type_name: &'static str,
    factory: Option<AnyFactory>,
    lifetime: Lifetime,
}

impl<'a> Binding<'a> {
    fn new(
        container: &'a Container,
        key: TypeId,
        type_name: &'static str,
        factory: AnyFactory,
    ) -> Self {
        Self {
            container,
            key,
            type_name,
            factory: Some(factory),
            lifetime: Lifetime::Singleton,
        }
    }

    pub fn singleton(mut self) -> &'a Container {
        self.lifetime = Lifetime::Singleton;
        self.commit();
        self.container
    }

    pub fn scoped(mut self) -> &'a Container {
        self.lifetime = Lifetime::Scoped;
        self.commit();
        self.container
    }

    pub fn transient(mut self) -> &'a Container {
        self.lifetime = Lifetime::Transient;
        self.commit();
        self.container
    }

    fn commit(&mut self) {
        if let Some(factory) = self.factory.take() {
            self.container
                .register(self.key, self.type_name, self.lifetime, factory);
        }
    }
}

impl Drop for Binding<'_> {
    fn drop(&mut self) {
        self.commit();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Debug, PartialEq)]
    struct Counter {
        value: u32,
    }

    trait Greeter: Send + Sync {
        fn greet(&self) -> String;
    }

    struct English;

    impl Greeter for English {
        fn greet(&self) -> String {
            "hello".to_string()
        }
    }

    #[test]
    fn singleton_is_shared() {
        let container = Container::new();
        let created = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&created);
        container.bind::<Counter, _>(move |_| {
            counter.fetch_add(1, Ordering::SeqCst);
            Counter { value: 7 }
        });
        let first = container.resolve::<Counter>().expect("first");
        let second = container.resolve::<Counter>().expect("second");
        assert_eq!(first.value, 7);
        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(created.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn transient_is_new_each_time() {
        let container = Container::new();
        container
            .bind::<Counter, _>(|_| Counter { value: 1 })
            .transient();
        let first = container.resolve::<Counter>().expect("first");
        let second = container.resolve::<Counter>().expect("second");
        assert!(!Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn scoped_is_cached_per_scope() {
        let root = Container::new();
        root.bind::<Counter, _>(|_| Counter { value: 2 }).scoped();
        let first_scope = root.scope();
        let second_scope = root.scope();
        let a = first_scope.resolve::<Counter>().expect("a");
        let b = first_scope.resolve::<Counter>().expect("b");
        let c = second_scope.resolve::<Counter>().expect("c");
        assert!(Arc::ptr_eq(&a, &b));
        assert!(!Arc::ptr_eq(&a, &c));
    }

    #[test]
    fn missing_registration_reports_type() {
        let container = Container::new();
        let error = container.resolve::<Counter>().expect_err("missing");
        match error {
            DiError::NotRegistered { type_name } => assert!(type_name.contains("Counter")),
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn trait_object_resolves() {
        let container = Container::new();
        container.bind_arc::<dyn Greeter, _>(|_| Arc::new(English));
        let greeter = container.resolve_trait::<dyn Greeter>().expect("greeter");
        assert_eq!(greeter.greet(), "hello");
    }

    #[test]
    fn child_sees_parent_bindings() {
        let root = Container::new();
        root.bind::<Counter, _>(|_| Counter { value: 3 });
        let scope = root.scope();
        assert!(scope.is_registered::<Counter>());
        assert_eq!(scope.resolve::<Counter>().expect("counter").value, 3);
    }

    #[test]
    fn dispose_clears_scope_and_blocks_resolution() {
        let root = Container::new();
        root.bind::<Counter, _>(|_| Counter { value: 1 }).scoped();
        let scope = root.scope();
        let _ = scope.resolve::<Counter>().expect("first");
        scope.dispose();
        assert!(scope.is_disposed());
        assert!(matches!(scope.resolve::<Counter>(), Err(DiError::Disposed)));
        assert!(!root.is_disposed());
    }

    #[test]
    fn async_resolution_returns_value() {
        let container = Container::new();
        container.bind::<Counter, _>(|_| Counter { value: 9 });
        let value = futures_lite_block_on(async { container.resolve_async::<Counter>().await })
            .expect("async");
        assert_eq!(value.value, 9);
    }

    #[test]
    fn bind_async_factory_is_supported() {
        let container = Container::new();
        container.bind_async::<Counter, _, _>(|_| async { Counter { value: 11 } });
        let value = futures_lite_block_on(async { container.resolve_async::<Counter>().await })
            .expect("async");
        assert_eq!(value.value, 11);
    }

    #[test]
    fn singleton_factory_receives_owner_container() {
        let root = Container::new();
        root.bind::<Counter, _>(|_| Counter { value: 4 });
        let scope = root.scope();
        let value = scope.resolve::<Counter>().expect("value");
        assert_eq!(value.value, 4);
    }

    #[derive(Debug, PartialEq, crate::Injectable)]
    struct AutoRepo {
        value: u32,
    }

    trait AutoGreeter: Send + Sync {
        fn greet(&self) -> &'static str;
    }

    #[derive(crate::Injectable)]
    #[provides(AutoGreeter)]
    struct AutoEnglish;

    impl AutoGreeter for AutoEnglish {
        fn greet(&self) -> &'static str {
            "hi"
        }
    }

    trait AmbiguousApi: Send + Sync {}

    #[derive(crate::Injectable)]
    #[provides(AmbiguousApi)]
    struct ProviderA;

    impl AmbiguousApi for ProviderA {}

    #[derive(crate::Injectable)]
    #[provides(AmbiguousApi)]
    struct ProviderB;

    impl AmbiguousApi for ProviderB {}

    #[derive(crate::Injectable)]
    struct CycleX {
        #[inject]
        _y: Arc<CycleY>,
    }

    #[derive(crate::Injectable)]
    struct CycleY {
        #[inject]
        _x: Arc<CycleX>,
    }

    #[test]
    fn auto_registration_creates_concrete_service_without_bind() {
        let container = Container::new();
        let repo = container.resolve::<AutoRepo>().expect("auto repo");
        assert_eq!(repo.value, 0);
        let again = container.resolve::<AutoRepo>().expect("cached");
        assert!(Arc::ptr_eq(&repo, &again));
    }

    #[test]
    fn auto_registration_provides_single_trait_implementation() {
        let container = Container::new();
        let greeter = container
            .resolve_trait::<dyn AutoGreeter>()
            .expect("auto trait");
        assert_eq!(greeter.greet(), "hi");
    }

    #[test]
    fn multiple_trait_providers_are_ambiguous() {
        let container = Container::new();
        match container.resolve_trait::<dyn AmbiguousApi>() {
            Err(DiError::Ambiguous {
                trait_name,
                providers,
            }) => {
                assert!(trait_name.contains("AmbiguousApi"));
                assert_eq!(providers.len(), 2);
            }
            Ok(_) => panic!("expected ambiguous error"),
            Err(other) => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn auto_registration_detects_cycles() {
        let container = Container::new();
        match container.resolve::<CycleX>() {
            Err(DiError::Cycle { .. }) => {}
            Ok(_) => panic!("expected cycle error"),
            Err(other) => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn auto_registration_scope_isolated_for_scoped_services() {
        #[derive(crate::Injectable)]
        #[injectable(scoped)]
        struct ScopedValue {
            #[init(5u32)]
            value: u32,
        }
        let root = Container::new();
        let a = root.scope();
        let b = root.scope();
        let first = a.resolve::<ScopedValue>().expect("first");
        let again = a.resolve::<ScopedValue>().expect("again");
        let other = b.resolve::<ScopedValue>().expect("other");
        assert_eq!(first.value, 5);
        assert!(Arc::ptr_eq(&first, &again));
        assert!(!Arc::ptr_eq(&first, &other));
    }

    #[test]
    fn auto_registration_supports_init_attribute() {
        #[derive(crate::Injectable)]
        struct WithInit {
            #[init(41u32)]
            value: u32,
        }
        let container = Container::new();
        let value = container.resolve::<WithInit>().expect("with init");
        assert_eq!(value.value, 41);
    }
}
