use std::cell::RefCell;
use std::rc::Rc;
use std::sync::{mpsc, Arc};

use ui_core::form::Field;
use ui_core::geometry::{Align, Edges, Justify, Length};
use ui_core::signal::Signal;
use ui_core::widget::{
    brand, footer, hint, subtitle, title_small, ButtonVariant, IconName, SurfaceTone, TagVariant,
    TextTone, Widget,
};
use ui_core::{view_model, Reactive};

use crate::auth::{AuthApi, AuthError, User};

type LoginResult = Result<User, AuthError>;
type PendingLogin = Rc<RefCell<Option<mpsc::Receiver<LoginResult>>>>;

fn brand_mark() -> Widget {
    Widget::row(vec![Widget::text("S")
        .style(title_small())
        .tone(TextTone::OnPrimary)])
    .surface(SurfaceTone::Primary)
    .radius(8.0)
    .width_px(32.0)
    .height_px(32.0)
    .align(Align::Center)
    .justify(Justify::Center)
}

#[derive(ui_core::ViewModel)]
pub struct LoginVm {
    #[reactive]
    pub email: Reactive<String>,
    #[reactive]
    pub password: Reactive<String>,
    #[reactive]
    pub remember: Reactive<bool>,
    pub auth: Arc<dyn AuthApi>,
    pub submitting: Signal<bool>,
    pub error: Signal<Option<String>>,
    pub user: Signal<Option<User>>,
    pub email_errors: Signal<Vec<String>>,
    pub email_touched: Signal<bool>,
    pub password_errors: Signal<Vec<String>>,
    pub password_touched: Signal<bool>,
    pending: PendingLogin,
}

#[derive(Clone)]
struct LoginActions {
    auth: Arc<dyn AuthApi>,
    email: Reactive<String>,
    password: Reactive<String>,
    submitting: Signal<bool>,
    error: Signal<Option<String>>,
    user: Signal<Option<User>>,
    email_errors: Signal<Vec<String>>,
    email_touched: Signal<bool>,
    password_errors: Signal<Vec<String>>,
    password_touched: Signal<bool>,
    pending: PendingLogin,
}

impl LoginActions {
    fn submit(&self) {
        if self.submitting.peek() {
            return;
        }
        let email = self.email.peek();
        let password = self.password.peek();
        let mut valid = true;
        self.email_errors.set(Vec::new());
        self.password_errors.set(Vec::new());
        if email.trim().is_empty() {
            self.email_errors.set(vec!["Введите email".to_string()]);
            self.email_touched.set(true);
            valid = false;
        } else if !email.contains('@') || !email.contains('.') {
            self.email_errors
                .set(vec!["Некорректный email".to_string()]);
            self.email_touched.set(true);
            valid = false;
        }
        if password.chars().count() < 8 {
            self.password_errors
                .set(vec!["Минимум 8 символов".to_string()]);
            self.password_touched.set(true);
            valid = false;
        }
        if !valid {
            self.error.set(Some("Проверьте поля формы".to_string()));
            return;
        }
        let (sender, receiver) = mpsc::channel();
        let api = Arc::clone(&self.auth);
        let latency = api.latency();
        std::thread::spawn(move || {
            if !latency.is_zero() {
                std::thread::sleep(latency);
            }
            let result = api.login(&email, &password);
            let _ = sender.send(result);
        });
        *self.pending.borrow_mut() = Some(receiver);
        self.submitting.set(true);
        self.error.set(None);
    }

    fn poll(&self) {
        let received = {
            let mut pending = self.pending.borrow_mut();
            let Some(receiver) = pending.as_ref() else {
                return;
            };
            match receiver.try_recv() {
                Ok(result) => {
                    *pending = None;
                    Some(Ok(result))
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    *pending = None;
                    Some(Err(AuthError::Network))
                }
                Err(mpsc::TryRecvError::Empty) => None,
            }
        };
        match received {
            Some(Ok(Ok(user))) => {
                self.submitting.set(false);
                self.error.set(None);
                self.user.set(Some(user));
            }
            Some(Ok(Err(error))) | Some(Err(error)) => {
                self.submitting.set(false);
                self.error.set(Some(error.to_string()));
            }
            None => {}
        }
    }
}

#[view_model]
impl LoginVm {
    pub fn new(auth: Arc<dyn AuthApi>) -> Self {
        Self {
            email: Reactive::new("demo@silent.dev".to_string()),
            password: Reactive::new("secret123".to_string()),
            remember: Reactive::new(true),
            auth,
            submitting: Signal::new(false),
            error: Signal::new(None),
            user: Signal::new(None),
            email_errors: Signal::new(Vec::new()),
            email_touched: Signal::new(false),
            password_errors: Signal::new(Vec::new()),
            password_touched: Signal::new(false),
            pending: Rc::new(RefCell::new(None)),
        }
    }

    pub fn submit(&self) {
        self.actions().submit();
    }

    pub fn poll(&self) {
        self.actions().poll();
    }

    fn on_frame(&self) {
        self.poll();
    }

    fn needs_frame(&self) -> bool {
        self.submitting.peek()
    }

    #[computed]
    pub fn can_submit(&self) -> bool {
        !self.submitting.get()
            && self.email.get().contains('@')
            && self.password.get().chars().count() >= 8
    }

    #[computed]
    pub fn completion(&self) -> f32 {
        let mut filled = 0;
        if self.email.get().contains('@') {
            filled += 1;
        }
        if self.password.get().chars().count() >= 8 {
            filled += 1;
        }
        filled as f32 / 2.0
    }

    #[watch(self.email, self.password)]
    fn on_credentials(&self) {
        self.error.set(None);
    }

    fn actions(&self) -> LoginActions {
        LoginActions {
            auth: Arc::clone(&self.auth),
            email: self.email,
            password: self.password,
            submitting: self.submitting,
            error: self.error,
            user: self.user,
            email_errors: self.email_errors,
            email_touched: self.email_touched,
            password_errors: self.password_errors,
            password_touched: self.password_touched,
            pending: Rc::clone(&self.pending),
        }
    }

    fn view(&self) -> Widget {
        let email_field = Field::from_parts(
            "email",
            "Email",
            self.email,
            self.email_touched,
            self.email_errors,
        );
        let password_field = Field::from_parts(
            "password",
            "Пароль",
            self.password,
            self.password_touched,
            self.password_errors,
        );
        let actions = self.actions();
        let submit_actions = actions.clone();
        let submit_on_enter = actions.clone();
        let mut fields: Vec<Widget> = vec![
            Widget::row(vec![
                brand_mark(),
                Widget::column(vec![
                    Widget::text("Silent Projects")
                        .style(brand())
                        .tone(TextTone::Primary),
                    Widget::text("Silent UI · GPU")
                        .style(hint())
                        .tone(TextTone::Tertiary),
                ])
                .gap(2.0)
                .grow(1.0),
                Widget::tag("Демо", TagVariant::Info),
            ])
            .gap(12.0)
            .align(Align::Center),
            Widget::column(vec![
                Widget::heading("Вход в аккаунт", 2),
                Widget::text("Продолжите работу в Silent Projects")
                    .style(subtitle())
                    .tone(TextTone::Secondary),
            ])
            .gap(6.0),
            Widget::text_field(&email_field, "Email").placeholder("you@example.com"),
            Widget::text_field(&password_field, "Пароль")
                .password()
                .help("Минимум 8 символов")
                .on_submit(move || submit_on_enter.submit()),
            Widget::checkbox_signal("Запомнить меня", self.remember).height_px(24.0),
        ];
        let error = self.error.get();
        if let Some(error) = error {
            fields.push(
                Widget::column(vec![Widget::text(error)
                    .style(hint())
                    .tone(TextTone::OnErrorContainer)])
                .surface(SurfaceTone::ErrorContainer)
                .radius(10.0)
                .padding_all(12.0),
            );
        }
        fields.push(
            Widget::button("Войти")
                .variant(ButtonVariant::Filled)
                .icon(IconName::ArrowRight)
                .size(ui_core::widget::ControlSize::Large)
                .width(Length::Fraction(1.0))
                .enabled(self.can_submit())
                .loading(self.submitting.get())
                .on_click(move || submit_actions.submit()),
        );
        fields.push(Widget::form_progress(self.completion()).form_label("Заполнено"));
        fields.push(
            Widget::column(vec![
                Widget::divider(),
                Widget::row(vec![
                    Widget::text("Демо-доступ")
                        .style(footer())
                        .tone(TextTone::Tertiary),
                    Widget::spacer(1.0).grow(1.0),
                    Widget::text("demo@silent.dev / secret123")
                        .style(footer())
                        .tone(TextTone::Secondary),
                ])
                .gap(12.0)
                .align(Align::Center),
            ])
            .gap(16.0),
        );
        let card = Widget::card(fields)
            .padding_responsive(ui_core::responsive!(
                Xs => Edges::all(24.0),
                Md => Edges::all(32.0)
            ))
            .gap(20.0)
            .width(Length::Fraction(1.0))
            .max_width(460.0);
        Widget::column(vec![card])
            .padding_responsive(ui_core::responsive!(
                Xs => Edges::all(16.0),
                Md => Edges::all(24.0),
                Xl => Edges::all(32.0)
            ))
            .justify(Justify::Center)
            .align(Align::Center)
    }
}
