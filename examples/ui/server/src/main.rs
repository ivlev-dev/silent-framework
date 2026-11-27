use std::error::Error;

use silent_example_ui_server::{build_router, AppState, Config, Store};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info")),
        )
        .init();

    let config = Config::from_env()?;
    let store = Store::open(&config.db_path)?;
    let seeded = store.seed_if_empty()?;
    if seeded > 0 {
        tracing::info!(count = seeded, "seeded projects");
    }
    tokio::fs::create_dir_all(&config.uploads_dir).await?;

    let state = AppState {
        store,
        delay: config.delay,
        uploads_dir: config.uploads_dir.clone(),
    };
    let app = build_router(state);
    let listener = TcpListener::bind(config.addr).await?;

    tracing::info!(
        address = %config.addr,
        database = %config.db_path.display(),
        uploads = %config.uploads_dir.display(),
        delay_ms = config.delay.as_millis(),
        "silent example ui server listening"
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::error!(error = %error, "failed to listen for shutdown signal");
    }
}
