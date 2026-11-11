pub mod imports;
pub mod index;
pub mod jsx;
pub mod paths;
pub mod scan;
#[path = "template-plan.rs"]
mod template_plan;
pub mod transform;

pub use index::Index;
pub use scan::scan;
pub use transform::{transform, SilentOptions};

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
