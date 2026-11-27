use std::time::Duration;

pub trait AuthApi: Send + Sync {
    fn login(&self, email: &str, password: &str) -> Result<User, AuthError>;
    fn latency(&self) -> Duration;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct User {
    pub name: String,
    pub email: String,
}

impl User {
    pub fn demo() -> Self {
        Self {
            name: "Демо".to_string(),
            email: "demo@silent.dev".to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthError {
    InvalidCredentials,
    UnknownUser,
    Network,
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthError::InvalidCredentials => f.write_str("Неверный email или пароль"),
            AuthError::UnknownUser => f.write_str("Пользователь не найден"),
            AuthError::Network => f.write_str("Нет соединения с сервером"),
        }
    }
}

impl std::error::Error for AuthError {}

#[derive(ui_core::Injectable)]
#[provides(AuthApi)]
pub struct FakeAuthApi {
    #[init(Duration::from_millis(420))]
    latency: Duration,
}

impl FakeAuthApi {
    pub fn fast() -> Self {
        Self {
            latency: Duration::from_millis(0),
        }
    }
}

impl AuthApi for FakeAuthApi {
    fn login(&self, email: &str, password: &str) -> Result<User, AuthError> {
        let email = email.trim();
        if email.is_empty() {
            return Err(AuthError::UnknownUser);
        }
        let Some((local, domain)) = email.split_once('@') else {
            return Err(AuthError::InvalidCredentials);
        };
        if local.is_empty() || !domain.contains('.') {
            return Err(AuthError::InvalidCredentials);
        }
        if password != "secret123" {
            return Err(AuthError::InvalidCredentials);
        }
        let mut name = local.to_string();
        if let Some(first) = name.chars().next() {
            let upper: String = first.to_uppercase().collect();
            name.replace_range(0..first.len_utf8(), &upper);
        }
        Ok(User {
            name,
            email: email.to_string(),
        })
    }

    fn latency(&self) -> Duration {
        self.latency
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fake_auth_validates_credentials() {
        let api = FakeAuthApi::fast();
        let user = api.login("user@example.com", "secret123").expect("user");
        assert_eq!(user.name, "User");
        assert_eq!(user.email, "user@example.com");
        assert_eq!(
            api.login("user@example.com", "wrong"),
            Err(AuthError::InvalidCredentials)
        );
        assert_eq!(
            api.login("no-at-sign", "secret123"),
            Err(AuthError::InvalidCredentials)
        );
    }
}
