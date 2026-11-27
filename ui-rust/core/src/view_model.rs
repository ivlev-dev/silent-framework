use std::any::Any;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

use crate::signal::{Effect, NodeId, Scope, Signal};
use crate::widget::Widget;

pub type Reactive<T> = Signal<T>;

struct MemoEntry {
    revision: u64,
    value: Box<dyn Any>,
}

thread_local! {
    static MEMOS: RefCell<HashMap<(u64, u64), MemoEntry>> =
        RefCell::new(HashMap::new());
    static WATCHERS: RefCell<HashMap<(u64, u64), Effect>> =
        RefCell::new(HashMap::new());
}

pub fn handle_id<T>(signal: &Signal<T>) -> u64 {
    signal.id()
}

pub fn type_vm_id<T: 'static>() -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::any::TypeId::of::<T>().hash(&mut hasher);
    hasher.finish()
}

pub fn memo<T: Clone + 'static>(
    vm: u64,
    key: u64,
    revision: u64,
    compute: impl FnOnce() -> T,
) -> T {
    let cached = MEMOS.with(|memos| {
        let memos = memos.borrow();
        memos.get(&(vm, key)).and_then(|entry| {
            if entry.revision == revision {
                entry.value.downcast_ref::<T>().cloned()
            } else {
                None
            }
        })
    });
    if let Some(value) = cached {
        return value;
    }
    let value = compute();
    MEMOS.with(|memos| {
        memos.borrow_mut().insert(
            (vm, key),
            MemoEntry {
                revision,
                value: Box::new(value.clone()),
            },
        );
    });
    value
}

pub fn watch(vm: u64, key: u64, f: impl Fn() + 'static) {
    let previous = WATCHERS.with(|watchers| watchers.borrow_mut().remove(&(vm, key)));
    if let Some(previous) = previous {
        previous.dispose();
    }
    let effect = crate::signal::effect(f);
    WATCHERS.with(|watchers| {
        watchers.borrow_mut().insert((vm, key), effect);
    });
}

pub fn dispose_vm(vm: u64) {
    MEMOS.with(|memos| {
        memos.borrow_mut().retain(|(id, _), _| *id != vm);
    });
    let watchers = WATCHERS.with(|watchers| {
        let mut watchers = watchers.borrow_mut();
        let keys: Vec<(u64, u64)> = watchers
            .keys()
            .filter(|(id, _)| *id == vm)
            .copied()
            .collect();
        keys.into_iter()
            .filter_map(|key| watchers.remove(&key))
            .collect::<Vec<_>>()
    });
    for watcher in watchers {
        watcher.dispose();
    }
}

pub trait ViewModel: Sized + 'static {
    fn view(&self) -> Widget;

    fn on_mount(&self) {}

    fn on_dispose(&self) {}

    fn on_frame(&self) {}

    fn needs_frame(&self) -> bool {
        false
    }

    fn scope(&self) -> Option<&Scope> {
        None
    }

    fn reactive_ids(&self) -> Vec<NodeId> {
        Vec::new()
    }

    fn setup_watchers(self: &Arc<Self>) {}

    fn vm_id(&self) -> u64 {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::{batch, Signal};

    #[test]
    fn memo_recomputes_only_on_revision_change() {
        let vm = 42u64;
        let runs = std::cell::Cell::new(0);
        let first = memo(vm, 1, 10, || {
            runs.set(runs.get() + 1);
            5u32
        });
        let second = memo(vm, 1, 10, || {
            runs.set(runs.get() + 1);
            6u32
        });
        let third = memo(vm, 1, 11, || {
            runs.set(runs.get() + 1);
            7u32
        });
        assert_eq!(first, 5);
        assert_eq!(second, 5);
        assert_eq!(third, 7);
        assert_eq!(runs.get(), 2);
        dispose_vm(vm);
    }

    #[test]
    fn watch_runs_initially_and_reacts() {
        let signal = Signal::new(0u32);
        let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let captured = seen.clone();
        watch(7, 1, move || {
            let value = signal.get();
            captured.borrow_mut().push(value);
        });
        assert_eq!(*seen.borrow(), vec![0]);
        signal.set(3);
        assert_eq!(*seen.borrow(), vec![0, 3]);
        dispose_vm(7);
    }

    #[test]
    fn dispose_vm_disposes_watchers() {
        let signal = Signal::new(0u32);
        let runs = std::rc::Rc::new(std::cell::Cell::new(0));
        let captured = runs.clone();
        watch(9, 1, move || {
            let _ = signal.get();
            captured.set(captured.get() + 1);
        });
        assert_eq!(runs.get(), 1);
        signal.set(1);
        assert_eq!(runs.get(), 2);
        dispose_vm(9);
        signal.set(2);
        assert_eq!(runs.get(), 2);
    }

    #[test]
    fn watch_uses_latest_registration() {
        let signal = Signal::new(0u32);
        let first = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let second = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let a = first.clone();
        watch(11, 1, move || {
            let value = signal.get();
            a.borrow_mut().push(value);
        });
        let b = second.clone();
        watch(11, 1, move || {
            let value = signal.get();
            b.borrow_mut().push(value);
        });
        assert_eq!(first.borrow().len(), 1);
        assert_eq!(second.borrow().len(), 1);
        signal.set(4);
        assert_eq!(*first.borrow(), vec![0]);
        assert_eq!(*second.borrow(), vec![0, 4]);
        dispose_vm(11);
    }

    #[test]
    fn memo_is_isolated_per_vm() {
        let a = memo(1, 5, 0, || 10u32);
        let b = memo(2, 5, 0, || 20u32);
        assert_eq!(a, 10);
        assert_eq!(b, 20);
        dispose_vm(1);
        dispose_vm(2);
    }

    #[test]
    fn memo_survives_batch_revision() {
        let signal = Signal::new(1u32);
        let rev = crate::signal::revision();
        let _ = memo(3, 1, rev, || signal.get());
        batch(|| signal.set(2));
        let next = crate::signal::revision();
        assert!(next > rev);
        dispose_vm(3);
    }
}
