pub mod gpu;
pub mod headless;
pub mod painter;

pub use gpu::{init as init_gpu, Gpu};
pub use headless::{HeadlessRenderer, HEADLESS_FORMAT};
pub use painter::Painter;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("no suitable GPU adapter found: {0}")]
    NoAdapter(String),
    #[error("failed to create GPU device: {0}")]
    Device(String),
    #[error("failed to create surface: {0}")]
    Surface(String),
    #[error("text rendering failed: {0}")]
    Text(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("PNG encoding failed: {0}")]
    Png(String),
}
