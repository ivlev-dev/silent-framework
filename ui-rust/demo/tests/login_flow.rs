use std::sync::Arc;
use std::time::{Duration, Instant};

use ui_core::layout::PaintData;
use ui_core::view_model::ViewModel;
use ui_core::{Container, Size, Theme, Ui, View};
use ui_demo::{AuthApi, FakeAuthApi, LoginVm, User};

fn wait_for_user(vm: &LoginVm, timeout: Duration) -> Option<User> {
    let started = Instant::now();
    loop {
        vm.poll();
        if let Some(user) = vm.user.peek() {
            return Some(user);
        }
        if started.elapsed() > timeout {
            return None;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn di_resolves_auth_without_bind() {
    let container = Container::new();
    let api = container
        .resolve_trait::<dyn AuthApi>()
        .expect("auto registered auth");
    let user = api.login("user@example.com", "secret123").expect("login");
    assert_eq!(user.email, "user@example.com");
}

#[test]
fn login_success_sets_user() {
    let api: Arc<dyn AuthApi> = Arc::new(FakeAuthApi::fast());
    let vm = LoginVm::new(api);
    vm.email.set("user@example.com".to_string());
    vm.password.set("secret123".to_string());
    vm.submit();
    assert!(vm.submitting.peek());
    let user = wait_for_user(&vm, Duration::from_secs(2)).expect("user");
    assert_eq!(user.name, "User");
    assert!(!vm.submitting.peek());
    assert!(vm.error.peek().is_none());
}

#[test]
fn login_error_is_reported() {
    let api: Arc<dyn AuthApi> = Arc::new(FakeAuthApi::fast());
    let vm = LoginVm::new(api);
    vm.email.set("user@example.com".to_string());
    vm.password.set("wrongpass".to_string());
    vm.submit();
    let user = wait_for_user(&vm, Duration::from_secs(2));
    assert!(user.is_none());
    let error = vm.error.peek().expect("error");
    assert!(error.contains("Неверный"));
    assert!(!vm.submitting.peek());
}

#[test]
fn invalid_form_does_not_submit() {
    let api: Arc<dyn AuthApi> = Arc::new(FakeAuthApi::fast());
    let vm = LoginVm::new(api);
    vm.email.set("bad".to_string());
    vm.password.set("short".to_string());
    vm.submit();
    assert!(!vm.submitting.peek());
    assert!(!vm.email_errors.peek().is_empty());
    assert!(!vm.password_errors.peek().is_empty());
}

#[test]
fn ui_click_submit_renders_dashboard_state() {
    let api: Arc<dyn AuthApi> = Arc::new(FakeAuthApi::fast());
    let vm = LoginVm::new(api);
    vm.email.set("user@example.com".to_string());
    vm.password.set("secret123".to_string());
    let user_signal = vm.user;
    let mut ui = Ui::new(Theme::light());
    ui.resize(Size::new(520.0, 800.0));
    ui.set_view(View::new(vm));
    let tree = ui.layout();
    let center = find_button(tree).expect("submit button").rect.center();
    ui.handle_event(ui_core::UiEvent::PointerMove(center));
    ui.handle_event(ui_core::UiEvent::PointerDown(center));
    ui.handle_event(ui_core::UiEvent::PointerUp(center));
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(2) {
        ui.frame();
        let _ = ui.layout();
        if let Some(user) = user_signal.peek() {
            assert_eq!(user.email, "user@example.com");
            return;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    panic!("user was not set after clicking submit");
}

#[test]
fn login_view_has_fields_and_button() {
    let api: Arc<dyn AuthApi> = Arc::new(FakeAuthApi::fast());
    let vm = LoginVm::new(api);
    let widget = vm.view();
    let tree = ui_core::layout::layout(
        &widget,
        Size::new(520.0, 800.0),
        &Theme::light(),
        &ui_core::layout::LayoutOptions::empty(),
    );
    let mut fields = 0;
    let mut buttons = 0;
    let mut progress = 0;
    let mut stack = vec![&tree.root];
    while let Some(node) = stack.pop() {
        match &node.paint {
            PaintData::TextField { .. } => fields += 1,
            PaintData::Button { .. } => buttons += 1,
            PaintData::FormProgress { .. } => progress += 1,
            _ => {}
        }
        stack.extend(node.children.iter());
    }
    assert_eq!(fields, 2);
    assert_eq!(buttons, 1);
    assert_eq!(progress, 1);
}

fn find_button(tree: &ui_core::layout::LayoutTree) -> Option<&ui_core::layout::LayoutNode> {
    let mut stack = vec![&tree.root];
    while let Some(node) = stack.pop() {
        if matches!(&node.paint, PaintData::Button { .. }) {
            return Some(node);
        }
        stack.extend(node.children.iter());
    }
    None
}
