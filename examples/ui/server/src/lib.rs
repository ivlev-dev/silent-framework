pub mod error;
pub mod model;
pub mod query;
pub mod routes;
pub mod store;
pub mod uploads;
pub mod wire;

use std::{
    env, fmt,
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    time::Duration,
};

pub use routes::{build_router, AppState};
pub use store::Store;

pub const DEFAULT_PORT: u16 = 6108;
pub const DEFAULT_DELAY_MS: u64 = 120;

#[derive(Debug, Clone)]
pub struct Config {
    pub addr: SocketAddr,
    pub db_path: PathBuf,
    pub uploads_dir: PathBuf,
    pub delay: Duration,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_vars(env::vars())
    }

    pub fn from_vars<I>(vars: I) -> Result<Self, ConfigError>
    where
        I: IntoIterator<Item = (String, String)>,
    {
        let mut host = String::from("127.0.0.1");
        let mut port = DEFAULT_PORT;
        let mut delay_ms = DEFAULT_DELAY_MS;
        let mut db_path = None;
        let mut uploads_dir = None;

        for (key, value) in vars {
            match key.as_str() {
                "UI_SERVER_HOST" => host = value,
                "UI_SERVER_PORT" => {
                    port = value.trim().parse().map_err(|_| {
                        ConfigError::new(format!("UI_SERVER_PORT must be a u16, got `{value}`"))
                    })?;
                }
                "SILENT_UI_DELAY_MS" => {
                    delay_ms = value.trim().parse().map_err(|_| {
                        ConfigError::new(format!("SILENT_UI_DELAY_MS must be a u64, got `{value}`"))
                    })?;
                }
                "UI_SERVER_DB" => db_path = Some(PathBuf::from(value)),
                "UI_SERVER_UPLOADS" => uploads_dir = Some(PathBuf::from(value)),
                _ => {}
            }
        }

        let ip: IpAddr = host.parse().map_err(|_| {
            ConfigError::new(format!(
                "UI_SERVER_HOST must be an IP address, got `{host}`"
            ))
        })?;
        let data_dir = default_data_dir();

        Ok(Self {
            addr: SocketAddr::new(ip, port),
            db_path: db_path.unwrap_or_else(|| data_dir.join("projects.redb")),
            uploads_dir: uploads_dir.unwrap_or_else(|| data_dir.join("uploads")),
            delay: Duration::from_millis(delay_ms),
        })
    }
}

pub fn default_data_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(".data")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError {
    message: String,
}

impl ConfigError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ConfigError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(pairs: &[(&str, &str)]) -> Result<Config, ConfigError> {
        Config::from_vars(
            pairs
                .iter()
                .map(|(key, value)| ((*key).to_owned(), (*value).to_owned())),
        )
    }

    #[test]
    fn uses_defaults() {
        let config = config(&[]).expect("defaults");
        assert_eq!(config.addr.port(), DEFAULT_PORT);
        assert_eq!(config.delay, Duration::from_millis(DEFAULT_DELAY_MS));
        assert!(config.db_path.ends_with("projects.redb"));
    }

    #[test]
    fn overrides_from_env() {
        let config = config(&[
            ("UI_SERVER_PORT", "7000"),
            ("SILENT_UI_DELAY_MS", "0"),
            ("UI_SERVER_DB", "/tmp/custom.redb"),
        ])
        .expect("overrides");
        assert_eq!(config.addr.port(), 7000);
        assert!(config.delay.is_zero());
        assert_eq!(config.db_path, PathBuf::from("/tmp/custom.redb"));
    }

    #[test]
    fn rejects_invalid_port_and_delay() {
        assert!(config(&[("UI_SERVER_PORT", "not-a-port")]).is_err());
        assert!(config(&[("SILENT_UI_DELAY_MS", "fast")]).is_err());
        assert!(config(&[("UI_SERVER_HOST", "localhost")]).is_err());
    }
}
