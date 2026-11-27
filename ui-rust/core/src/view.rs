use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;

use crate::signal::{Effect, Scope};
use crate::view_model::{dispose_vm, ViewModel};
use crate::widget::Widget;

pub trait ViewSource {
    fn widget(&self) -> Widget;
    fn on_frame(&self);
    fn needs_frame(&self) -> bool {
        false
    }
    fn dispose(&self);
}

pub struct View<VM: ViewModel> {
    vm: Arc<VM>,
    render: Arc<dyn Fn(&VM) -> Widget>,
    widget: Rc<RefCell<Option<Widget>>>,
    effect: RefCell<Option<Effect>>,
    own_scope: Option<Scope>,
    alive: Cell<bool>,
}

impl<VM: ViewModel> View<VM> {
    pub fn new(vm: VM) -> Self {
        Self::with_render(vm, |vm| vm.view())
    }

    pub fn with_render(vm: VM, render: impl Fn(&VM) -> Widget + 'static) -> Self {
        let vm = Arc::new(vm);
        let widget: Rc<RefCell<Option<Widget>>> = Rc::new(RefCell::new(None));
        let own_scope = if vm.scope().is_some() {
            None
        } else {
            let scope = Scope::new(|| {});
            for id in vm.reactive_ids() {
                scope.adopt(id);
            }
            Some(scope)
        };
        let render = Arc::new(render);
        let view = Self {
            vm: Arc::clone(&vm),
            render,
            widget,
            effect: RefCell::new(None),
            own_scope,
            alive: Cell::new(true),
        };
        let build = {
            let vm = Arc::clone(&vm);
            let render = Arc::clone(&view.render);
            let widget = Rc::clone(&view.widget);
            move || {
                let tree = render(&vm);
                tree.track_signals();
                *widget.borrow_mut() = Some(tree);
            }
        };
        let effect = match vm.scope() {
            Some(scope) => scope.enter(|| crate::signal::effect(build)),
            None => view
                .own_scope
                .as_ref()
                .expect("own scope")
                .enter(|| crate::signal::effect(build)),
        };
        *view.effect.borrow_mut() = Some(effect);
        let setup = || {
            VM::setup_watchers(&vm);
        };
        match vm.scope() {
            Some(scope) => scope.enter(setup),
            None => view.own_scope.as_ref().expect("own scope").enter(setup),
        }
        vm.on_mount();
        view
    }

    pub fn vm(&self) -> &VM {
        &self.vm
    }

    pub fn vm_arc(&self) -> Arc<VM> {
        Arc::clone(&self.vm)
    }

    pub fn dispose(&self) {
        if !self.alive.replace(false) {
            return;
        }
        self.vm.on_dispose();
        if let Some(effect) = self.effect.borrow_mut().take() {
            effect.dispose();
        }
        match self.vm.scope() {
            Some(scope) => scope.dispose(),
            None => {
                if let Some(scope) = &self.own_scope {
                    scope.dispose();
                }
            }
        }
        dispose_vm(self.vm.vm_id());
        *self.widget.borrow_mut() = None;
    }
}

impl<VM: ViewModel> ViewSource for View<VM> {
    fn widget(&self) -> Widget {
        let existing = self.widget.borrow().clone();
        match existing {
            Some(widget) => widget,
            None => {
                let tree = (self.render)(&self.vm);
                tree.track_signals();
                *self.widget.borrow_mut() = Some(tree.clone());
                tree
            }
        }
    }

    fn on_frame(&self) {
        if self.alive.get() {
            self.vm.on_frame();
        }
    }

    fn needs_frame(&self) -> bool {
        self.alive.get() && self.vm.needs_frame()
    }

    fn dispose(&self) {
        View::dispose(self);
    }
}

impl<VM: ViewModel> Drop for View<VM> {
    fn drop(&mut self) {
        View::dispose(self);
    }
}

pub fn component<VM: ViewModel, F: Fn(&VM) -> Widget + 'static>(vm: VM, view_fn: F) -> View<VM> {
    View::with_render(vm, view_fn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::{Scope, Signal};
    use crate::widget::Widget;

    struct TestVm {
        count: Signal<u32>,
        scope: Scope,
        mounted: std::rc::Rc<std::cell::Cell<bool>>,
        disposed: std::rc::Rc<std::cell::Cell<bool>>,
    }

    impl TestVm {
        fn new() -> Self {
            let (scope, count) = Scope::create(|_| Signal::new(0u32));
            Self {
                count,
                scope,
                mounted: std::rc::Rc::new(std::cell::Cell::new(false)),
                disposed: std::rc::Rc::new(std::cell::Cell::new(false)),
            }
        }
    }

    impl ViewModel for TestVm {
        fn view(&self) -> Widget {
            Widget::text(format!("count = {}", self.count.get()))
        }

        fn on_mount(&self) {
            self.mounted.set(true);
        }

        fn on_dispose(&self) {
            self.disposed.set(true);
        }

        fn scope(&self) -> Option<&Scope> {
            Some(&self.scope)
        }

        fn reactive_ids(&self) -> Vec<crate::signal::NodeId> {
            vec![self.count.id()]
        }

        fn vm_id(&self) -> u64 {
            self.count.id()
        }
    }

    #[test]
    fn view_builds_and_updates_on_signal() {
        let vm = TestVm::new();
        let count = vm.count;
        let mounted = vm.mounted.clone();
        let view = View::new(vm);
        assert!(mounted.get());
        assert!(matches!(
            view.widget().kind,
            crate::widget::WidgetKind::Text(_)
        ));
        count.set(1);
        let widget = view.widget();
        match widget.kind {
            crate::widget::WidgetKind::Text(text) => assert_eq!(text.content, "count = 1"),
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn dispose_calls_lifecycle_and_disposes_scope() {
        let vm = TestVm::new();
        let disposed_flag = vm.disposed.clone();
        let count = vm.count;
        let renders = Rc::new(Cell::new(0usize));
        let captured = Rc::clone(&renders);
        let view = component(vm, move |vm| {
            captured.set(captured.get() + 1);
            Widget::text(format!("count = {}", vm.count.get()))
        });
        view.dispose();
        assert!(disposed_flag.get());
        let after_dispose = renders.get();
        count.set(99);
        assert_eq!(renders.get(), after_dispose);
    }

    #[test]
    fn scopeless_vm_signals_are_disposed_with_view() {
        struct ScopelessVm {
            value: Signal<u32>,
        }
        impl ViewModel for ScopelessVm {
            fn view(&self) -> Widget {
                Widget::text(format!("{}", self.value.get()))
            }

            fn reactive_ids(&self) -> Vec<crate::signal::NodeId> {
                vec![self.value.id()]
            }
        }
        let vm = ScopelessVm {
            value: Signal::new(1u32),
        };
        let value = vm.value;
        let view = View::new(vm);
        assert!(!value.is_disposed());
        view.dispose();
        assert!(value.is_disposed());
    }

    #[test]
    fn component_uses_custom_render() {
        struct PlainVm {
            value: Signal<u32>,
        }
        impl ViewModel for PlainVm {
            fn view(&self) -> Widget {
                Widget::text("default")
            }
        }
        let vm = PlainVm {
            value: Signal::new(4u32),
        };
        let value = vm.value;
        let view = component(vm, |vm| Widget::text(format!("v={}", vm.value.get())));
        match view.widget().kind {
            crate::widget::WidgetKind::Text(text) => assert_eq!(text.content, "v=4"),
            _ => panic!("text"),
        }
        value.set(5);
        match view.widget().kind {
            crate::widget::WidgetKind::Text(text) => assert_eq!(text.content, "v=5"),
            _ => panic!("text"),
        }
    }
}
