use std::any::Any;
use std::cell::{Cell, RefCell};
use std::marker::PhantomData;

pub type NodeId = u64;

type ComputedFn = Box<dyn Fn() -> Box<dyn Any>>;
type EffectFn = Box<dyn Fn()>;

enum NodeKind {
    Signal,
    Computed(RefCell<Option<ComputedFn>>),
    Effect(RefCell<Option<EffectFn>>),
    Scope,
}

struct Node {
    kind: NodeKind,
    value: RefCell<Option<Box<dyn Any>>>,
    sources: RefCell<Vec<NodeId>>,
    observers: RefCell<Vec<NodeId>>,
    children: RefCell<Vec<NodeId>>,
    dirty: Cell<bool>,
    disposed: Cell<bool>,
    owner: Option<NodeId>,
}

impl Node {
    fn new(kind: NodeKind, owner: Option<NodeId>) -> Self {
        Self {
            kind,
            value: RefCell::new(None),
            sources: RefCell::new(Vec::new()),
            observers: RefCell::new(Vec::new()),
            children: RefCell::new(Vec::new()),
            dirty: Cell::new(false),
            disposed: Cell::new(false),
            owner,
        }
    }
}

struct Runtime {
    nodes: Vec<Option<Node>>,
    observers: Vec<NodeId>,
    owners: Vec<NodeId>,
    batch_depth: u32,
    pending: Vec<NodeId>,
    running: Vec<NodeId>,
    revision: u64,
    flush_guard: u32,
}

impl Runtime {
    fn new() -> Self {
        Self {
            nodes: Vec::new(),
            observers: Vec::new(),
            owners: Vec::new(),
            batch_depth: 0,
            pending: Vec::new(),
            running: Vec::new(),
            revision: 0,
            flush_guard: 0,
        }
    }

    fn node(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(id as usize).and_then(|node| node.as_ref())
    }

    fn node_mut(&mut self, id: NodeId) -> Option<&mut Node> {
        self.nodes
            .get_mut(id as usize)
            .and_then(|node| node.as_mut())
    }

    fn push_node(&mut self, kind: NodeKind) -> NodeId {
        let id = self.nodes.len() as NodeId;
        let owner = self.owners.last().copied();
        self.nodes.push(Some(Node::new(kind, owner)));
        if let Some(owner) = owner {
            if let Some(parent) = self.node(owner) {
                parent.children.borrow_mut().push(id);
            }
        }
        id
    }
}

thread_local! {
    static RUNTIME: RefCell<Runtime> = RefCell::new(Runtime::new());
}

fn with_runtime<R>(f: impl FnOnce(&mut Runtime) -> R) -> R {
    RUNTIME.with(|runtime| f(&mut runtime.borrow_mut()))
}

pub fn revision() -> u64 {
    with_runtime(|runtime| runtime.revision)
}

fn create_node(kind: NodeKind) -> NodeId {
    with_runtime(|runtime| runtime.push_node(kind))
}

fn link(observer: NodeId, source: NodeId) {
    with_runtime(|runtime| {
        let Some(obs) = runtime.node(observer) else {
            return;
        };
        let mut sources = obs.sources.borrow_mut();
        if !sources.contains(&source) {
            sources.push(source);
        }
        drop(sources);
        if let Some(src) = runtime.node(source) {
            let mut observers = src.observers.borrow_mut();
            if !observers.contains(&observer) {
                observers.push(observer);
            }
        }
    });
}

fn subscribe(id: NodeId) {
    let observer = with_runtime(|runtime| runtime.observers.last().copied());
    if let Some(observer) = observer {
        link(observer, id);
    }
}

fn clear_sources(id: NodeId) {
    let sources = with_runtime(|runtime| {
        runtime
            .node(id)
            .map(|node| std::mem::take(&mut *node.sources.borrow_mut()))
            .unwrap_or_default()
    });
    for source in sources {
        with_runtime(|runtime| {
            if let Some(node) = runtime.node(source) {
                node.observers.borrow_mut().retain(|obs| *obs != id);
            }
        });
    }
}

fn evaluate_computed(id: NodeId) {
    let function = with_runtime(|runtime| {
        let node = runtime.node(id)?;
        match &node.kind {
            NodeKind::Computed(cell) => cell.borrow_mut().take(),
            _ => None,
        }
    });
    let Some(function) = function else {
        return;
    };
    clear_sources(id);
    let owner = with_runtime(|runtime| runtime.node(id).and_then(|node| node.owner));
    with_runtime(|runtime| {
        runtime.observers.push(id);
        if let Some(owner) = owner {
            runtime.owners.push(owner);
        }
    });
    let result = function();
    with_runtime(|runtime| {
        runtime.observers.pop();
        if owner.is_some() {
            runtime.owners.pop();
        }
    });
    with_runtime(|runtime| {
        if let Some(node) = runtime.node_mut(id) {
            *node.value.borrow_mut() = Some(result);
            node.dirty.set(false);
            if let NodeKind::Computed(cell) = &node.kind {
                *cell.borrow_mut() = Some(function);
            }
        }
    });
}

fn ensure_computed(id: NodeId) {
    loop {
        let dirty = with_runtime(|runtime| {
            runtime.node(id).map(|node| match node.kind {
                NodeKind::Computed(_) => node.dirty.get(),
                _ => false,
            })
        });
        match dirty {
            Some(true) => evaluate_computed(id),
            _ => return,
        }
    }
}

fn read_value<T: Clone + 'static>(id: NodeId, track: bool) -> T {
    ensure_computed(id);
    if track {
        subscribe(id);
    }
    let value = with_runtime(|runtime| {
        runtime.node(id).and_then(|node| {
            node.value
                .borrow()
                .as_ref()
                .and_then(|value| value.downcast_ref::<T>().cloned())
        })
    });
    match value {
        Some(value) => value,
        None => panic!(
            "signal {id} does not contain a value of type {}",
            std::any::type_name::<T>()
        ),
    }
}

fn mark_dependents(id: NodeId, effects: &mut Vec<NodeId>, visited: &mut Vec<NodeId>) {
    if visited.contains(&id) {
        return;
    }
    visited.push(id);
    let observers = with_runtime(|runtime| {
        runtime
            .node(id)
            .map(|node| node.observers.borrow().clone())
            .unwrap_or_default()
    });
    for observer in observers {
        let is_effect = with_runtime(|runtime| {
            runtime
                .node(observer)
                .map(|node| matches!(node.kind, NodeKind::Effect(_)))
                .unwrap_or(false)
        });
        if is_effect {
            if !effects.contains(&observer) {
                effects.push(observer);
            }
        } else {
            with_runtime(|runtime| {
                if let Some(node) = runtime.node(observer) {
                    node.dirty.set(true);
                }
            });
            mark_dependents(observer, effects, visited);
        }
    }
}

fn run_effect(id: NodeId) {
    let is_running = with_runtime(|runtime| runtime.running.contains(&id));
    if is_running {
        return;
    }
    let function = with_runtime(|runtime| {
        let node = runtime.node(id)?;
        if node.disposed.get() {
            return None;
        }
        match &node.kind {
            NodeKind::Effect(cell) => cell.borrow_mut().take(),
            _ => None,
        }
    });
    let Some(function) = function else {
        return;
    };
    clear_sources(id);
    let owner = with_runtime(|runtime| runtime.node(id).and_then(|node| node.owner));
    with_runtime(|runtime| {
        runtime.running.push(id);
        runtime.observers.push(id);
        if let Some(owner) = owner {
            runtime.owners.push(owner);
        }
    });
    function();
    with_runtime(|runtime| {
        runtime.observers.pop();
        if owner.is_some() {
            runtime.owners.pop();
        }
        runtime.running.pop();
        if let Some(node) = runtime.node_mut(id) {
            if let NodeKind::Effect(cell) = &node.kind {
                *cell.borrow_mut() = Some(function);
            }
        }
    });
}

fn flush_pending() {
    let depth = with_runtime(|runtime| runtime.batch_depth);
    if depth > 0 {
        return;
    }
    let already_flushing = with_runtime(|runtime| runtime.flush_guard > 0);
    if already_flushing {
        return;
    }
    with_runtime(|runtime| runtime.flush_guard += 1);
    let mut iterations = 0;
    loop {
        let pending = with_runtime(|runtime| std::mem::take(&mut runtime.pending));
        if pending.is_empty() {
            break;
        }
        for id in pending {
            run_effect(id);
        }
        iterations += 1;
        if iterations > 64 {
            with_runtime(|runtime| runtime.pending.clear());
            log::warn!("reactive effect loop exceeded 64 iterations");
            break;
        }
    }
    with_runtime(|runtime| runtime.flush_guard -= 1);
}

fn notify(id: NodeId) {
    let mut effects = Vec::new();
    let mut visited = Vec::new();
    mark_dependents(id, &mut effects, &mut visited);
    if effects.is_empty() {
        return;
    }
    with_runtime(|runtime| {
        for effect in effects {
            if !runtime.pending.contains(&effect) {
                runtime.pending.push(effect);
            }
        }
    });
    flush_pending();
}

fn dispose_node(id: NodeId) {
    let (children, sources, cleanup) = with_runtime(|runtime| {
        let Some(node) = runtime.node_mut(id) else {
            return (Vec::new(), Vec::new(), Vec::new());
        };
        if node.disposed.replace(true) {
            return (Vec::new(), Vec::new(), Vec::new());
        }
        let children = std::mem::take(&mut *node.children.borrow_mut());
        let sources = std::mem::take(&mut *node.sources.borrow_mut());
        let mut cleanup: Vec<Box<dyn Any>> = Vec::new();
        if let Some(value) = node.value.borrow_mut().take() {
            cleanup.push(value);
        }
        match &node.kind {
            NodeKind::Effect(cell) => {
                if let Some(function) = cell.borrow_mut().take() {
                    cleanup.push(Box::new(function));
                }
            }
            NodeKind::Computed(cell) => {
                if let Some(function) = cell.borrow_mut().take() {
                    cleanup.push(Box::new(function));
                }
            }
            NodeKind::Signal | NodeKind::Scope => {}
        }
        (children, sources, cleanup)
    });
    drop(cleanup);
    for child in children {
        dispose_node(child);
    }
    for source in sources {
        with_runtime(|runtime| {
            if let Some(node) = runtime.node(source) {
                node.observers.borrow_mut().retain(|obs| *obs != id);
            }
        });
    }
}

pub struct BatchGuard {
    _private: (),
}

impl BatchGuard {
    pub fn new() -> Self {
        with_runtime(|runtime| runtime.batch_depth += 1);
        Self { _private: () }
    }
}

impl Default for BatchGuard {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for BatchGuard {
    fn drop(&mut self) {
        let depth = with_runtime(|runtime| {
            runtime.batch_depth = runtime.batch_depth.saturating_sub(1);
            runtime.batch_depth
        });
        if depth == 0 {
            flush_pending();
        }
    }
}

pub fn batch<R>(f: impl FnOnce() -> R) -> R {
    let _guard = BatchGuard::new();
    f()
}

pub fn untracked<R>(f: impl FnOnce() -> R) -> R {
    let saved = with_runtime(|runtime| std::mem::take(&mut runtime.observers));
    let result = f();
    with_runtime(|runtime| runtime.observers = saved);
    result
}

pub struct Signal<T> {
    id: NodeId,
    _marker: PhantomData<fn() -> T>,
}

impl<T> Clone for Signal<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for Signal<T> {}

impl<T> std::fmt::Debug for Signal<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Signal").field("id", &self.id).finish()
    }
}

impl<T: Default + Clone + 'static> Default for Signal<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}

impl<T> Signal<T> {
    pub fn id(&self) -> NodeId {
        self.id
    }

    pub fn is_disposed(&self) -> bool {
        with_runtime(|runtime| {
            runtime
                .node(self.id)
                .map(|node| node.disposed.get())
                .unwrap_or(true)
        })
    }
}

impl<T: Clone + 'static> Signal<T> {
    pub fn new(value: T) -> Self {
        let id = create_node(NodeKind::Signal);
        with_runtime(|runtime| {
            if let Some(node) = runtime.node_mut(id) {
                *node.value.borrow_mut() = Some(Box::new(value));
            }
            runtime.revision += 1;
        });
        Self {
            id,
            _marker: PhantomData,
        }
    }

    pub fn get(&self) -> T {
        read_value(self.id, true)
    }

    pub fn peek(&self) -> T {
        read_value(self.id, false)
    }

    pub fn set(&self, value: T) {
        with_runtime(|runtime| {
            if let Some(node) = runtime.node_mut(self.id) {
                *node.value.borrow_mut() = Some(Box::new(value));
                runtime.revision += 1;
            }
        });
        notify(self.id);
    }

    pub fn update(&self, f: impl FnOnce(&mut T)) {
        let mut value = self.peek();
        f(&mut value);
        self.set(value);
    }

    pub fn toggle(&self)
    where
        T: std::ops::Not<Output = T>,
    {
        let value = self.peek();
        self.set(!value);
    }
}

pub struct Computed<T> {
    id: NodeId,
    _marker: PhantomData<fn() -> T>,
}

impl<T> Clone for Computed<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for Computed<T> {}

impl<T> std::fmt::Debug for Computed<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Computed").field("id", &self.id).finish()
    }
}

impl<T: Clone + 'static> Computed<T> {
    pub fn new(f: impl Fn() -> T + 'static) -> Self {
        let id = create_node(NodeKind::Computed(RefCell::new(Some(Box::new(
            move || Box::new(f()) as Box<dyn Any>,
        )))));
        with_runtime(|runtime| {
            if let Some(node) = runtime.node_mut(id) {
                node.dirty.set(true);
            }
        });
        Self {
            id,
            _marker: PhantomData,
        }
    }

    pub fn id(&self) -> NodeId {
        self.id
    }

    pub fn get(&self) -> T {
        read_value(self.id, true)
    }

    pub fn peek(&self) -> T {
        read_value(self.id, false)
    }
}

pub struct Effect {
    id: NodeId,
}

impl Effect {
    pub fn id(&self) -> NodeId {
        self.id
    }

    pub fn dispose(&self) {
        dispose_node(self.id);
    }
}

pub fn effect(f: impl Fn() + 'static) -> Effect {
    let id = create_node(NodeKind::Effect(RefCell::new(Some(Box::new(f)))));
    run_effect(id);
    Effect { id }
}

pub struct Scope {
    id: NodeId,
}

impl Scope {
    pub fn new(f: impl FnOnce()) -> Self {
        let id = create_node(NodeKind::Scope);
        with_runtime(|runtime| runtime.owners.push(id));
        f();
        with_runtime(|runtime| {
            runtime.owners.pop();
        });
        Self { id }
    }

    pub fn id(&self) -> NodeId {
        self.id
    }

    pub fn create<T>(f: impl FnOnce(&Scope) -> T) -> (Scope, T) {
        let id = create_node(NodeKind::Scope);
        let scope = Scope { id };
        let value = scope.enter(|| f(&scope));
        (scope, value)
    }

    pub fn enter<R>(&self, f: impl FnOnce() -> R) -> R {
        with_runtime(|runtime| runtime.owners.push(self.id));
        let result = f();
        with_runtime(|runtime| {
            runtime.owners.pop();
        });
        result
    }

    pub fn adopt(&self, node: NodeId) {
        with_runtime(|runtime| {
            let previous = runtime.node(node).and_then(|node| node.owner);
            if let Some(previous) = previous {
                if let Some(parent) = runtime.node(previous) {
                    parent.children.borrow_mut().retain(|child| *child != node);
                }
            }
            if let Some(node_ref) = runtime.node_mut(node) {
                node_ref.owner = Some(self.id);
            }
            if let Some(scope) = runtime.node(self.id) {
                let mut children = scope.children.borrow_mut();
                if !children.contains(&node) {
                    children.push(node);
                }
            }
        });
    }

    pub fn dispose(&self) {
        dispose_node(self.id);
    }
}

impl Drop for Scope {
    fn drop(&mut self) {
        let should_dispose = RUNTIME
            .try_with(|runtime| {
                runtime
                    .borrow()
                    .node(self.id)
                    .map(|node| node.owner.is_none())
                    .unwrap_or(false)
            })
            .unwrap_or(false);
        if should_dispose {
            dispose_node(self.id);
        }
    }
}

pub struct Memo<T> {
    computed: Computed<T>,
}

impl<T: Clone + 'static> Memo<T> {
    pub fn new(f: impl Fn() -> T + 'static) -> Self {
        Self {
            computed: Computed::new(f),
        }
    }

    pub fn get(&self) -> T {
        self.computed.get()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    #[test]
    fn signal_read_and_write() {
        let signal = Signal::new(1u32);
        assert_eq!(signal.get(), 1);
        signal.set(2);
        assert_eq!(signal.get(), 2);
        signal.update(|value| *value += 3);
        assert_eq!(signal.peek(), 5);
    }

    #[test]
    fn effect_reruns_on_change() {
        let signal = Signal::new(1u32);
        let runs = Rc::new(RefCell::new(Vec::new()));
        let captured = runs.clone();
        let effect = effect(move || {
            captured.borrow_mut().push(signal.get());
        });
        assert_eq!(*runs.borrow(), vec![1]);
        signal.set(2);
        assert_eq!(*runs.borrow(), vec![1, 2]);
        effect.dispose();
        signal.set(3);
        assert_eq!(*runs.borrow(), vec![1, 2]);
    }

    #[test]
    fn computed_caches_and_invalidates() {
        let signal = Signal::new(2i64);
        let calls = Rc::new(RefCell::new(0u32));
        let calls_clone = calls.clone();
        let computed = Computed::new(move || {
            *calls_clone.borrow_mut() += 1;
            signal.get() * 10
        });
        assert_eq!(*calls.borrow(), 0);
        assert_eq!(computed.get(), 20);
        assert_eq!(computed.get(), 20);
        assert_eq!(*calls.borrow(), 1);
        signal.set(3);
        assert_eq!(computed.get(), 30);
        assert_eq!(*calls.borrow(), 2);
    }

    #[test]
    fn computed_chain_propagates() {
        let signal = Signal::new(1u32);
        let doubled = Computed::new(move || signal.get() * 2);
        let plus_one = Computed::new(move || doubled.get() + 1);
        assert_eq!(plus_one.get(), 3);
        signal.set(5);
        assert_eq!(plus_one.get(), 11);
    }

    #[test]
    fn effect_on_computed_updates() {
        let signal = Signal::new(1u32);
        let doubled = Computed::new(move || signal.get() * 2);
        let seen = Rc::new(RefCell::new(Vec::new()));
        let captured = seen.clone();
        let _effect = effect(move || {
            captured.borrow_mut().push(doubled.get());
        });
        assert_eq!(*seen.borrow(), vec![2]);
        signal.set(4);
        assert_eq!(*seen.borrow(), vec![2, 8]);
    }

    #[test]
    fn batch_joins_notifications() {
        let a = Signal::new(0i32);
        let b = Signal::new(0i32);
        let sum = Rc::new(RefCell::new(0i32));
        let runs = Rc::new(RefCell::new(0u32));
        let sum_clone = sum.clone();
        let runs_clone = runs.clone();
        let _effect = effect(move || {
            *sum_clone.borrow_mut() = a.get() + b.get();
            *runs_clone.borrow_mut() += 1;
        });
        assert_eq!(*runs.borrow(), 1);
        batch(|| {
            a.set(1);
            b.set(2);
            assert_eq!(*sum.borrow(), 0);
        });
        assert_eq!(*sum.borrow(), 3);
        assert_eq!(*runs.borrow(), 2);
    }

    #[test]
    fn scope_disposes_children() {
        let signal = Signal::new(0u32);
        let runs = Rc::new(RefCell::new(0u32));
        let captured = runs.clone();
        let scope = Scope::new(move || {
            effect(move || {
                let _ = signal.get();
                *captured.borrow_mut() += 1;
            });
        });
        assert_eq!(*runs.borrow(), 1);
        scope.dispose();
        signal.set(1);
        assert_eq!(*runs.borrow(), 1);
    }

    #[test]
    fn untracked_read_does_not_subscribe() {
        let signal = Signal::new(0u32);
        let runs = Rc::new(RefCell::new(0u32));
        let captured = runs.clone();
        let _effect = effect(move || {
            let _ = signal.peek();
            *captured.borrow_mut() += 1;
        });
        signal.set(1);
        assert_eq!(*runs.borrow(), 1);
    }

    #[test]
    fn peek_does_not_subscribe() {
        let signal = Signal::new(0u32);
        let runs = Rc::new(RefCell::new(0u32));
        let captured = runs.clone();
        let _effect = effect(move || {
            let _ = untracked(|| signal.get());
            *captured.borrow_mut() += 1;
        });
        signal.set(9);
        assert_eq!(*runs.borrow(), 1);
    }

    #[test]
    fn revision_grows_on_write() {
        let before = revision();
        let signal = Signal::new(1u8);
        signal.set(2);
        assert!(revision() > before);
    }
}
