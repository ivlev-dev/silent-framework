use crate::geometry::UiError;
use crate::signal::{batch, Signal};
use std::any::Any;

pub trait FieldValue: Clone + PartialEq + 'static {
    fn is_filled(&self) -> bool;
    fn display(&self) -> String;
}

impl FieldValue for String {
    fn is_filled(&self) -> bool {
        !self.trim().is_empty()
    }

    fn display(&self) -> String {
        self.clone()
    }
}

impl FieldValue for bool {
    fn is_filled(&self) -> bool {
        *self
    }

    fn display(&self) -> String {
        if *self {
            "true".into()
        } else {
            "false".into()
        }
    }
}

impl FieldValue for f64 {
    fn is_filled(&self) -> bool {
        self.is_finite()
    }

    fn display(&self) -> String {
        self.to_string()
    }
}

type Validator<T> = Box<dyn Fn(&T) -> bool + 'static>;

struct Rule<T> {
    message: String,
    check: Validator<T>,
}

pub struct Field<T: FieldValue> {
    pub name: &'static str,
    pub label: String,
    pub value: Signal<T>,
    pub touched: Signal<bool>,
    pub errors: Signal<Vec<String>>,
    required: bool,
    rules: Vec<Rule<T>>,
}

impl<T: FieldValue + Default> Field<T> {
    pub fn new(name: &'static str, label: impl Into<String>) -> Self {
        Self::with_value(name, label, T::default())
    }

    pub fn clear(&self) {
        batch(|| {
            self.value.set(T::default());
            self.touched.set(false);
            self.errors.set(Vec::new());
        });
    }
}

impl<T: FieldValue> Field<T> {
    pub fn with_value(name: &'static str, label: impl Into<String>, value: T) -> Self {
        Self {
            name,
            label: label.into(),
            value: Signal::new(value),
            touched: Signal::new(false),
            errors: Signal::new(Vec::new()),
            required: false,
            rules: Vec::new(),
        }
    }

    pub fn from_parts(
        name: &'static str,
        label: impl Into<String>,
        value: Signal<T>,
        touched: Signal<bool>,
        errors: Signal<Vec<String>>,
    ) -> Self {
        Self {
            name,
            label: label.into(),
            value,
            touched,
            errors,
            required: false,
            rules: Vec::new(),
        }
    }

    pub fn required(mut self) -> Self {
        self.required = true;
        self
    }

    pub fn rule(
        mut self,
        message: impl Into<String>,
        check: impl Fn(&T) -> bool + 'static,
    ) -> Self {
        self.rules.push(Rule {
            message: message.into(),
            check: Box::new(check),
        });
        self
    }

    pub fn min_length(mut self, min: usize) -> Self
    where
        T: AsRef<str>,
    {
        let message = format!("Минимум {min} символов");
        self.rules.push(Rule {
            message,
            check: Box::new(move |value| value.as_ref().chars().count() >= min),
        });
        self
    }

    pub fn max_length(mut self, max: usize) -> Self
    where
        T: AsRef<str>,
    {
        let message = format!("Максимум {max} символов");
        self.rules.push(Rule {
            message,
            check: Box::new(move |value| value.as_ref().chars().count() <= max),
        });
        self
    }

    pub fn get(&self) -> T {
        self.value.get()
    }

    pub fn set(&self, value: T) {
        self.value.set(value);
    }

    pub fn is_required(&self) -> bool {
        self.required
    }

    pub fn is_filled(&self) -> bool {
        self.value.get().is_filled()
    }

    pub fn is_touched(&self) -> bool {
        self.touched.get()
    }

    pub fn touch(&self) {
        self.touched.set(true);
    }

    pub fn error(&self) -> Option<String> {
        self.errors.get().first().cloned()
    }

    pub fn set_error(&self, message: Option<String>) {
        match message {
            Some(message) => self.errors.set(vec![message]),
            None => self.errors.set(Vec::new()),
        }
    }

    pub fn validate(&self) -> bool {
        let value = self.value.peek();
        let mut errors = Vec::new();
        if self.required && !value.is_filled() {
            errors.push("Обязательное поле".to_string());
        } else {
            for rule in &self.rules {
                if !(rule.check)(&value) {
                    errors.push(rule.message.clone());
                }
            }
        }
        let valid = errors.is_empty();
        let changed = self.errors.peek() != errors;
        if changed {
            self.errors.set(errors);
        }
        valid
    }

    pub fn is_valid(&self) -> bool {
        let value = self.value.peek();
        if self.required && !value.is_filled() {
            return false;
        }
        self.rules.iter().all(|rule| (rule.check)(&value))
    }
}

pub trait FieldAccess {
    fn as_any(&self) -> &dyn Any;
    fn name(&self) -> &'static str;
    fn label(&self) -> &str;
    fn is_required(&self) -> bool;
    fn is_filled(&self) -> bool;
    fn is_touched(&self) -> bool;
    fn touch(&self);
    fn validate(&self) -> bool;
    fn is_valid(&self) -> bool;
    fn error(&self) -> Option<String>;
    fn set_error(&self, message: Option<String>);
    fn reset(&self);
    fn value_text(&self) -> String;
}

impl<T: FieldValue + Default> FieldAccess for Field<T> {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn name(&self) -> &'static str {
        self.name
    }

    fn label(&self) -> &str {
        &self.label
    }

    fn is_required(&self) -> bool {
        self.required
    }

    fn is_filled(&self) -> bool {
        self.value.peek().is_filled()
    }

    fn is_touched(&self) -> bool {
        self.touched.peek()
    }

    fn touch(&self) {
        self.touched.set(true);
    }

    fn validate(&self) -> bool {
        Field::validate(self)
    }

    fn is_valid(&self) -> bool {
        Field::is_valid(self)
    }

    fn error(&self) -> Option<String> {
        self.errors.peek().first().cloned()
    }

    fn set_error(&self, message: Option<String>) {
        self.set_error(message);
    }

    fn reset(&self) {
        self.clear();
    }

    fn value_text(&self) -> String {
        self.value.peek().display()
    }
}

pub fn email_error(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.contains(char::is_whitespace) {
        return Some("Некорректный email".to_string());
    }
    let mut parts = trimmed.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    let extra = parts.next();
    let domain_valid = domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !domain.contains(' ');
    if local.is_empty() || domain.is_empty() || extra.is_some() || !domain_valid {
        return Some("Некорректный email".to_string());
    }
    None
}

pub fn email_rule<T: AsRef<str> + FieldValue>(field: Field<T>) -> Field<T> {
    field.rule("Некорректный email", |value| {
        email_error(value.as_ref()).is_none()
    })
}

#[derive(Debug)]
pub struct FormState {
    pub submitting: Signal<bool>,
    pub submitted: Signal<bool>,
}

impl Default for FormState {
    fn default() -> Self {
        Self::new()
    }
}

impl FormState {
    pub fn new() -> Self {
        Self {
            submitting: Signal::new(false),
            submitted: Signal::new(false),
        }
    }

    pub fn validate(&self, fields: &[&dyn FieldAccess]) -> bool {
        let mut valid = true;
        for field in fields {
            if !field.validate() {
                field.touch();
                valid = false;
            }
        }
        valid
    }

    pub fn completion(&self, fields: &[&dyn FieldAccess]) -> f32 {
        let required: Vec<&&dyn FieldAccess> =
            fields.iter().filter(|field| field.is_required()).collect();
        if required.is_empty() {
            if fields.is_empty() {
                return 1.0;
            }
            let filled_count = fields.iter().filter(|field| field.is_filled()).count();
            return filled_count as f32 / fields.len() as f32;
        }
        let filled = required.iter().filter(|field| field.is_filled()).count();
        filled as f32 / required.len() as f32
    }

    pub fn is_dirty(&self, fields: &[&dyn FieldAccess]) -> bool {
        fields.iter().any(|field| field.is_touched())
    }

    pub fn reset(&self, fields: &[&dyn FieldAccess]) {
        batch(|| {
            for field in fields {
                field.reset();
            }
            self.submitting.set(false);
            self.submitted.set(false);
        });
    }

    pub fn set_field_errors(
        &self,
        fields: &[&dyn FieldAccess],
        errors: &[(&str, &str)],
    ) -> Result<(), UiError> {
        let mut unknown = Vec::new();
        for (name, message) in errors {
            match fields.iter().find(|field| field.name() == *name) {
                Some(field) => {
                    field.set_error(Some((*message).to_string()));
                    field.touch();
                }
                None => unknown.push((*name).to_string()),
            }
        }
        if unknown.is_empty() {
            Ok(())
        } else {
            Err(UiError(format!(
                "unknown form fields: {}",
                unknown.join(", ")
            )))
        }
    }
}

pub trait FormModel {
    fn fields(&self) -> Vec<&dyn FieldAccess>;
    fn state(&self) -> &FormState;

    fn is_valid(&self) -> bool {
        self.fields().iter().all(|field| field.is_valid())
    }

    fn is_dirty(&self) -> bool {
        self.state().is_dirty(&self.fields())
    }

    fn completion(&self) -> f32 {
        self.state().completion(&self.fields()).clamp(0.0, 1.0)
    }

    fn is_submitting(&self) -> bool {
        self.state().submitting.get()
    }

    fn set_submitting(&self, value: bool) {
        self.state().submitting.set(value);
    }

    fn submit(&self) -> bool {
        self.state().submitted.set(true);
        self.state().validate(&self.fields())
    }

    fn reset(&self) {
        self.state().reset(&self.fields());
    }

    fn set_field_errors(&self, errors: &[(&str, &str)]) -> Result<(), UiError> {
        self.state().set_field_errors(&self.fields(), errors)
    }
}

pub struct Form {
    fields: Vec<Box<dyn FieldAccess>>,
    state: FormState,
}

impl Form {
    pub fn new(fields: Vec<Box<dyn FieldAccess>>) -> Self {
        Self {
            fields,
            state: FormState::new(),
        }
    }

    pub fn field<T: FieldValue + 'static>(&self, name: &'static str) -> Option<&Field<T>> {
        self.fields
            .iter()
            .find(|field| field.name() == name)
            .and_then(|field| field.as_any().downcast_ref::<Field<T>>())
    }
}

impl FormModel for Form {
    fn fields(&self) -> Vec<&dyn FieldAccess> {
        self.fields.iter().map(|field| field.as_ref()).collect()
    }

    fn state(&self) -> &FormState {
        &self.state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn login_fields() -> (Field<String>, Field<String>, Field<bool>) {
        let email = Field::<String>::new("email", "Email")
            .required()
            .rule("Некорректный email", |value| {
                email_error(value).is_none()
            });
        let password = Field::<String>::new("password", "Пароль")
            .required()
            .min_length(8);
        let remember = Field::<bool>::with_value("remember", "Запомнить", false);
        (email, password, remember)
    }

    #[test]
    fn required_field_reports_error() {
        let email = Field::<String>::new("email", "Email").required();
        assert!(!email.validate());
        assert_eq!(email.error().as_deref(), Some("Обязательное поле"));
        email.set("a@b.co".into());
        assert!(email.validate());
        assert_eq!(email.error(), None);
    }

    #[test]
    fn min_length_and_email_validation() {
        let (email, password, _) = login_fields();
        email.set("not-an-email".into());
        assert!(!email.validate());
        assert_eq!(email.error().as_deref(), Some("Некорректный email"));
        email.set("user@example.com".into());
        assert!(email.validate());

        password.set("short".into());
        assert!(!password.validate());
        assert_eq!(password.error().as_deref(), Some("Минимум 8 символов"));
        password.set("longenough".into());
        assert!(password.validate());
    }

    #[test]
    fn form_state_completion_and_submit() {
        let (email, password, remember) = login_fields();
        let form = FormState::new();
        let fields: Vec<&dyn FieldAccess> = vec![&email, &password, &remember];
        assert_eq!(form.completion(&fields), 0.0);
        assert!(!form.validate(&fields));
        assert!(email.is_touched());
        assert!(password.is_touched());

        email.set("user@example.com".into());
        assert_eq!(form.completion(&fields), 0.5);
        password.set("supersecret".into());
        assert_eq!(form.completion(&fields), 1.0);
        assert!(form.validate(&fields));
        assert!(form.is_dirty(&fields));
    }

    #[test]
    fn server_errors_map_to_fields() {
        let (email, password, remember) = login_fields();
        let form = FormState::new();
        let fields: Vec<&dyn FieldAccess> = vec![&email, &password, &remember];
        form.set_field_errors(&fields, &[("email", "Уже занят")])
            .expect("known field");
        assert_eq!(email.error().as_deref(), Some("Уже занят"));
        assert!(email.is_touched());
        assert!(form.set_field_errors(&fields, &[("unknown", "x")]).is_err());
    }

    #[test]
    fn reset_clears_values_and_state() {
        let (email, password, remember) = login_fields();
        let form = FormState::new();
        let fields: Vec<&dyn FieldAccess> = vec![&email, &password, &remember];
        email.set("user@example.com".into());
        remember.set(true);
        form.submitted.set(true);
        form.reset(&fields);
        assert_eq!(email.value.peek(), "");
        assert!(!remember.value.peek());
        assert!(!form.submitted.peek());
        assert_eq!(form.completion(&fields), 0.0);
    }

    #[test]
    fn email_validation_cases() {
        assert!(email_error("a@b.co").is_none());
        assert!(email_error("").is_none());
        assert!(email_error("a@b").is_some());
        assert!(email_error("@b.co").is_some());
        assert!(email_error("a@b.co@c.co").is_some());
        assert!(email_error("a b@c.co").is_some());
    }
}
