pub mod backend;

use std::sync::Arc;

use backend::{InputBackend, RenderBackend, SurfaceBackend, WindowBackend, WinitInput};
use ui_core::clipboard::Clipboard;
use ui_core::geometry::Size;
use ui_core::theme::Theme;
use ui_core::ui::{Ui, UiEvent};
use ui_core::view::ViewSource;
use ui_render::gpu;
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::{Window, WindowId};

pub use backend::{InputBackend as Input, RenderBackend as Render, WindowBackend as WindowHandle};

#[derive(Debug, thiserror::Error)]
pub enum PlatformError {
    #[error("event loop error: {0}")]
    EventLoop(String),
    #[error("render error: {0}")]
    Render(#[from] ui_render::RenderError),
    #[error("window error: {0}")]
    Window(String),
}

pub trait App: 'static {
    fn start(&mut self) -> Box<dyn ViewSource>;
    fn on_frame(&mut self, _ui: &mut Ui) {}
    fn on_event(&mut self, _ui: &mut Ui, _event: &UiEvent) -> bool {
        false
    }
}

#[derive(Clone, Debug)]
pub struct DesktopConfig {
    pub title: String,
    pub width: u32,
    pub height: u32,
    pub min_width: u32,
    pub min_height: u32,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            title: "Silent UI".to_string(),
            width: 1120,
            height: 760,
            min_width: 360,
            min_height: 480,
        }
    }
}

struct SystemClipboard {
    inner: Option<arboard::Clipboard>,
}

impl SystemClipboard {
    fn new() -> Self {
        Self {
            inner: arboard::Clipboard::new().ok(),
        }
    }
}

impl Clipboard for SystemClipboard {
    fn get_text(&mut self) -> Option<String> {
        self.inner
            .as_mut()
            .and_then(|clipboard| clipboard.get_text().ok())
    }

    fn set_text(&mut self, text: String) {
        if let Some(clipboard) = self.inner.as_mut() {
            let _ = clipboard.set_text(text);
        }
    }
}

pub fn run<A: App>(app: A, config: DesktopConfig) -> Result<(), PlatformError> {
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init();
    let event_loop =
        EventLoop::new().map_err(|error| PlatformError::EventLoop(error.to_string()))?;
    event_loop.set_control_flow(ControlFlow::Poll);
    let mut runner = Runner {
        app,
        ui: Ui::new(Theme::light()),
        config,
        window: None,
        gpu: None,
        renderer: None,
        input: WinitInput::new(),
        scale: 1.0,
        started: false,
    };
    event_loop
        .run_app(&mut runner)
        .map_err(|error| PlatformError::EventLoop(error.to_string()))
}

struct Runner<A: App> {
    app: A,
    ui: Ui,
    config: DesktopConfig,
    window: Option<Arc<Window>>,
    gpu: Option<ui_render::Gpu>,
    renderer: Option<SurfaceBackend>,
    input: WinitInput,
    scale: f32,
    started: bool,
}

impl<A: App> Runner<A> {
    fn initialize(&mut self, event_loop: &ActiveEventLoop) {
        let attributes = Window::default_attributes()
            .with_title(self.config.title.clone())
            .with_inner_size(LogicalSize::new(self.config.width, self.config.height))
            .with_min_inner_size(LogicalSize::new(
                self.config.min_width,
                self.config.min_height,
            ));
        let window = match event_loop.create_window(attributes) {
            Ok(window) => Arc::new(window),
            Err(error) => {
                log::error!("failed to create window: {error}");
                event_loop.exit();
                return;
            }
        };
        window.set_ime_allowed(true);
        let gpu = match gpu::init() {
            Ok(gpu) => gpu,
            Err(error) => {
                log::error!("GPU initialization failed: {error}");
                event_loop.exit();
                return;
            }
        };
        let renderer = match SurfaceBackend::new(&gpu, Arc::clone(&window)) {
            Ok(renderer) => renderer,
            Err(error) => {
                log::error!("failed to create surface: {error}");
                event_loop.exit();
                return;
            }
        };
        self.scale = window.scale_factor() as f32;
        self.ui.resize(window.logical_size());
        self.ui.set_clipboard(Box::new(SystemClipboard::new()));
        if !self.started {
            self.started = true;
            self.ui.set_source(self.app.start());
        }
        self.renderer = Some(renderer);
        self.gpu = Some(gpu);
        self.window = Some(window);
    }

    fn redraw(&mut self) {
        let (Some(window), Some(gpu), Some(renderer)) = (
            self.window.as_ref(),
            self.gpu.as_ref(),
            self.renderer.as_mut(),
        ) else {
            return;
        };
        self.scale = window.scale_factor() as f32;
        self.app.on_frame(&mut self.ui);
        self.ui.frame();
        let logical = window.logical_size();
        self.ui.resize(logical);
        let theme = self.ui.theme().clone();
        let tree = self.ui.layout();
        if let Err(error) = renderer.render(&gpu.device, &gpu.queue, tree, &theme, self.scale) {
            log::error!("render failed: {error}");
        }
        WindowBackend::set_cursor(window.as_ref(), self.ui.state().cursor);
    }

    fn handle_window_event(&mut self, event_loop: &ActiveEventLoop, event: WindowEvent) {
        match &event {
            WindowEvent::CloseRequested => {
                event_loop.exit();
                return;
            }
            WindowEvent::RedrawRequested => {
                self.redraw();
                return;
            }
            WindowEvent::Resized(size) => {
                if let (Some(gpu), Some(renderer)) = (self.gpu.as_ref(), self.renderer.as_mut()) {
                    renderer.resize(&gpu.device, size.width, size.height);
                }
                self.ui.resize(Size::new(
                    size.width as f32 / self.scale,
                    size.height as f32 / self.scale,
                ));
            }
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                self.scale = *scale_factor as f32;
                if let Some(window) = &self.window {
                    self.ui.resize(window.logical_size());
                }
            }
            _ => {}
        }
        let events = self.input.translate(&event, self.scale);
        for event in events {
            self.dispatch(event);
        }
    }

    fn dispatch(&mut self, event: UiEvent) {
        if self.app.on_event(&mut self.ui, &event) {
            return;
        }
        self.ui.handle_event(event);
    }
}

impl<A: App> ApplicationHandler for Runner<A> {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_none() {
            self.initialize(event_loop);
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        if self.window.as_ref().map(|window| window.id()) != Some(window_id) {
            return;
        }
        self.handle_window_event(event_loop, event);
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if let Some(window) = &self.window {
            window.request_redraw();
        }
    }
}
