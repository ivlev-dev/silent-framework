use ui_core::signal::Signal;
use ui_core::theme::Theme;
use ui_core::ui::{Key, Ui, UiEvent};
use ui_core::view::{View, ViewSource};
use ui_core::view_model::ViewModel;
use ui_core::widget::Widget;
use ui_core::Container;
use ui_core::DiError;

use crate::auth::{AuthApi, User};
use crate::dashboard::DashboardVm;
use crate::gallery::GalleryVm;
use crate::login::LoginVm;

enum Screen {
    Login,
    Dashboard,
}

struct ErrorVm {
    message: String,
}

impl ViewModel for ErrorVm {
    fn view(&self) -> Widget {
        Widget::column(vec![
            Widget::heading("Не удалось загрузить приложение", 2),
            Widget::text(self.message.clone()),
        ])
        .padding_all(32.0)
        .gap(12.0)
    }
}

pub struct GalleryApp {
    dark: Option<Signal<bool>>,
    dialog: Option<Signal<bool>>,
    popover: Option<Signal<usize>>,
    focus_request: Option<Signal<Option<&'static str>>>,
}

impl GalleryApp {
    pub fn new() -> Self {
        Self {
            dark: None,
            dialog: None,
            popover: None,
            focus_request: None,
        }
    }
}

impl Default for GalleryApp {
    fn default() -> Self {
        Self::new()
    }
}

impl ui_platform::App for GalleryApp {
    fn start(&mut self) -> Box<dyn ViewSource> {
        let vm = GalleryVm::new(false);
        log::info!("gallery start: section {}", vm.section.peek());
        self.dark = Some(vm.dark);
        self.dialog = Some(vm.dialog);
        self.popover = Some(vm.popover);
        self.focus_request = Some(vm.focus_request);
        Box::new(View::new(vm))
    }

    fn on_frame(&mut self, ui: &mut Ui) {
        if let Some(dark) = self.dark {
            let is_dark = dark.peek();
            if is_dark != ui.theme().is_dark() {
                ui.set_theme(if is_dark {
                    Theme::dark()
                } else {
                    Theme::light()
                });
            }
        }
        if let Some(request) = self.focus_request {
            if let Some(key) = request.peek() {
                ui.focus_key(key);
                request.set(None);
            }
        }
    }

    fn on_event(&mut self, ui: &mut Ui, event: &UiEvent) -> bool {
        if let UiEvent::Key {
            key: Key::Char(character),
            modifiers,
            pressed: true,
        } = event
        {
            if modifiers.control && character.eq_ignore_ascii_case(&'d') {
                ui.toggle_theme();
                if let Some(dark) = self.dark {
                    dark.set(ui.theme().is_dark());
                }
                return true;
            }
        }
        if matches!(
            event,
            UiEvent::Key {
                key: Key::Escape,
                pressed: true,
                ..
            }
        ) {
            if let Some(popover) = self.popover {
                if popover.peek() != 0 {
                    popover.set(0);
                    return true;
                }
            }
            if let Some(dialog) = self.dialog {
                if dialog.peek() {
                    dialog.set(false);
                    return true;
                }
            }
        }
        false
    }
}

pub struct DemoApp {
    container: Container,
    screen: Screen,
    user: Option<Signal<Option<User>>>,
    dark: Option<Signal<bool>>,
    logout: Option<Signal<bool>>,
}

impl DemoApp {
    pub fn new(container: Container) -> Self {
        Self {
            container,
            screen: Screen::Login,
            user: None,
            dark: None,
            logout: None,
        }
    }

    fn login_view(&mut self) -> Box<dyn ViewSource> {
        self.dark = None;
        self.logout = None;
        match self.container.resolve_trait::<dyn AuthApi>() {
            Ok(auth) => {
                let vm = LoginVm::new(auth);
                self.user = Some(vm.user);
                Box::new(View::new(vm))
            }
            Err(error) => {
                self.user = None;
                Box::new(View::new(ErrorVm {
                    message: describe_error(&error),
                }))
            }
        }
    }
}

fn describe_error(error: &DiError) -> String {
    error.to_string()
}

impl ui_platform::App for DemoApp {
    fn start(&mut self) -> Box<dyn ViewSource> {
        self.login_view()
    }

    fn on_frame(&mut self, ui: &mut Ui) {
        match self.screen {
            Screen::Login => {
                if let Some(user) = self.user.and_then(|signal| signal.peek()) {
                    let vm = DashboardVm::new(user, false);
                    self.dark = Some(vm.dark);
                    self.logout = Some(vm.logout);
                    self.user = None;
                    ui.set_theme(Theme::light());
                    ui.set_view(View::new(vm));
                    self.screen = Screen::Dashboard;
                }
            }
            Screen::Dashboard => {
                if let Some(dark) = self.dark {
                    let is_dark = dark.peek();
                    if is_dark != ui.theme().is_dark() {
                        ui.set_theme(if is_dark {
                            Theme::dark()
                        } else {
                            Theme::light()
                        });
                    }
                }
                if self.logout.map(|signal| signal.peek()).unwrap_or(false) {
                    self.screen = Screen::Login;
                    ui.set_theme(Theme::light());
                    ui.set_source(self.login_view());
                }
            }
        }
    }

    fn on_event(&mut self, ui: &mut Ui, event: &UiEvent) -> bool {
        if let UiEvent::Key {
            key: Key::Char(character),
            modifiers,
            pressed: true,
        } = event
        {
            if modifiers.control && character.eq_ignore_ascii_case(&'d') {
                ui.toggle_theme();
                if let Some(dark) = self.dark {
                    dark.set(ui.theme().is_dark());
                }
                return true;
            }
        }
        false
    }
}
