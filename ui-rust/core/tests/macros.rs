use std::cell::Cell;
use std::rc::Rc;

use ui_core::{layout::PaintData, view_model, Reactive, Size, Theme, Ui, View, Widget};

#[derive(ui_core::ViewModel)]
struct LoginVm {
    #[reactive]
    email: Reactive<String>,
    #[reactive]
    password: Reactive<String>,
    #[reactive]
    remember: Reactive<bool>,
    computed_runs: Cell<u32>,
    watched: Rc<Cell<u32>>,
}

#[view_model]
impl LoginVm {
    fn new() -> Self {
        Self {
            email: Reactive::new(String::new()),
            password: Reactive::new(String::new()),
            remember: Reactive::new(false),
            computed_runs: Cell::new(0),
            watched: Rc::new(Cell::new(0)),
        }
    }

    fn view(&self) -> Widget {
        Widget::column(vec![Widget::text(format!(
            "{}:{}",
            self.email.get(),
            self.password.get()
        ))])
    }

    #[computed]
    fn can_submit(&self) -> bool {
        self.computed_runs.set(self.computed_runs.get() + 1);
        !self.email.get().is_empty() && self.password.get().chars().count() >= 8
    }

    #[watch(self.email)]
    fn on_email(&self) {
        self.watched.set(self.watched.get() + 1);
    }
}

#[test]
fn reactive_field_generates_getter_setter_and_signal() {
    let vm = LoginVm::new();
    vm.set_email("user@example.com".to_string());
    assert_eq!(vm.email(), "user@example.com");
    assert_eq!(vm.email_signal().get(), "user@example.com");
    assert_eq!(vm.password(), "");
}

#[test]
fn computed_is_memoized_per_revision() {
    let vm = LoginVm::new();
    vm.set_email("user@example.com".to_string());
    vm.set_password("supersecret".to_string());
    assert!(vm.can_submit());
    assert!(vm.can_submit());
    assert_eq!(vm.computed_runs.get(), 1);
    vm.set_password("changedpassword".to_string());
    assert!(vm.can_submit());
    assert_eq!(vm.computed_runs.get(), 2);
}

#[test]
fn watch_skips_mount_and_reacts_to_changes() {
    let vm = LoginVm::new();
    let watched = Rc::clone(&vm.watched);
    let email = vm.email;
    let scope = ui_core::View::new(vm);
    assert_eq!(watched.get(), 0);
    email.set("a@b.co".to_string());
    assert_eq!(watched.get(), 1);
    scope.dispose();
    email.set("c@d.co".to_string());
    assert_eq!(watched.get(), 1);
}

#[test]
fn view_rerenders_through_ui_on_signal_change() {
    let vm = LoginVm::new();
    let email = vm.email;
    let mut ui = Ui::new(Theme::light());
    ui.resize(Size::new(400.0, 300.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let first = ui
        .tree()
        .expect("tree")
        .root
        .children
        .first()
        .expect("text")
        .clone();
    match &first.paint {
        PaintData::Text { text, .. } => assert_eq!(text, ":"),
        _ => panic!("expected text"),
    }
    email.set("user@example.com".to_string());
    let _ = ui.layout();
    let second = ui
        .tree()
        .expect("tree")
        .root
        .children
        .first()
        .expect("text")
        .clone();
    match &second.paint {
        PaintData::Text { text, .. } => assert_eq!(text, "user@example.com:"),
        _ => panic!("expected text"),
    }
}
