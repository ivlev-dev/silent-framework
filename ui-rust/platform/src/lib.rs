pub mod backend;

use std::sync::Arc;
use std::time::{Duration, Instant};

use backend::{
    effective_ui_scale, initial_window_size, InputBackend, RenderBackend, SurfaceBackend,
    WindowBackend, WinitInput,
};
use ui_core::clipboard::Clipboard;
use ui_core::damage::Damage;
use ui_core::geometry::Size;
use ui_core::theme::Theme;
use ui_core::ui::{Ui, UiEvent};
use ui_core::view::ViewSource;
use ui_render::gpu;
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
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
    event_loop.set_control_flow(ControlFlow::Wait);
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
        pending_resize: None,
        resize_until: None,
        resize_event_at: None,
        fast_text: false,
        debug_overlay: false,
        frames: 0,
        fps: 0.0,
        last_present: None,
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
    pending_resize: Option<(u32, u32)>,
    resize_until: Option<Instant>,
    resize_event_at: Option<Instant>,
    fast_text: bool,
    debug_overlay: bool,
    frames: u64,
    fps: f32,
    last_present: Option<Instant>,
}

impl<A: App> Runner<A> {
    fn initialize(&mut self, event_loop: &ActiveEventLoop) {
        let monitor = event_loop
            .primary_monitor()
            .or_else(|| event_loop.available_monitors().next());
        let monitor_size = monitor
            .as_ref()
            .map(|monitor| monitor.size())
            .unwrap_or_else(|| {
                winit::dpi::PhysicalSize::new(self.config.width, self.config.height)
            });
        let system_scale = monitor
            .as_ref()
            .map(|monitor| monitor.scale_factor())
            .unwrap_or(1.0);
        let ui_scale = effective_ui_scale(monitor_size.width, system_scale);
        let initial = initial_window_size(monitor_size);
        let attributes = Window::default_attributes()
            .with_title(self.config.title.clone())
            .with_inner_size(initial)
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
        self.scale = ui_scale;
        let logical = Size::new(
            initial.width as f32 / ui_scale,
            initial.height as f32 / ui_scale,
        );
        self.ui.resize(logical);
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
        self.scale = window
            .current_monitor()
            .map(|monitor| effective_ui_scale(monitor.size().width, monitor.scale_factor()))
            .unwrap_or_else(|| effective_ui_scale(3840, window.scale_factor()));
        let resize_started = Instant::now();
        if let Some((width, height)) = self.pending_resize.take() {
            renderer.resize(&gpu.device, width, height);
            log::debug!(
                "resize applied {}x{} in {:.2} ms",
                width,
                height,
                resize_started.elapsed().as_secs_f64() * 1000.0
            );
        }
        let was_active = self.ui.source_needs_frame();
        self.app.on_frame(&mut self.ui);
        self.ui.frame();
        let physical = window.physical_size();
        self.ui.resize(Size::new(
            physical.width as f32 / self.scale,
            physical.height as f32 / self.scale,
        ));
        let _ = self.ui.layout();
        let real_damage = self.ui.damage();
        if real_damage.is_empty() && !self.debug_overlay {
            return;
        }
        let viewport = Size::new(
            window.physical_size().width as f32 / self.scale,
            window.physical_size().height as f32 / self.scale,
        );
        if self.debug_overlay {
            let area = real_damage.area(viewport);
            let total = (viewport.width * viewport.height).max(1.0) as f64;
            let rects = if real_damage.full {
                1
            } else if real_damage.rect.is_some() {
                1
            } else {
                0
            };
            let stats = renderer.stats();
            let text = format!(
                "FPS {:.0} · кадры {}\ndirty rects: {} · {} px ({:.1}%)\nfull: {} · layout rebuilds {}\ntext cache: {} entries · {} hits · {} shaped\nrx {}x{} @ {:.2}x · {:?}\nF12 — скрыть overlay",
                self.fps,
                self.frames + 1,
                rects,
                area as u64,
                area / total * 100.0,
                real_damage.full,
                self.ui.layout_rebuilds(),
                stats.text_cache_entries,
                stats.text_cache_hits,
                stats.text_shaped,
                viewport.width as u32,
                viewport.height as u32,
                self.scale,
                gpu.backend,
            );
            renderer.set_debug_text(Some(text));
        }
        let damage = if self.debug_overlay {
            Damage::full()
        } else {
            real_damage
        };
        let theme = self.ui.theme().clone();
        let tree = self.ui.layout();
        if let Err(error) =
            renderer.render(&gpu.device, &gpu.queue, tree, &theme, self.scale, damage)
        {
            log::error!("render failed: {error}");
        } else {
            self.ui.clear_damage();
        }
        if self.debug_overlay {
            let now = Instant::now();
            if let Some(previous) = self.last_present {
                let dt = now.duration_since(previous).as_secs_f32();
                if dt > 0.0 {
                    let instant = 1.0 / dt;
                    self.fps = if self.fps <= 0.0 {
                        instant
                    } else {
                        self.fps * 0.9 + instant * 0.1
                    };
                }
            }
            self.last_present = Some(now);
            self.frames += 1;
            window.request_redraw();
        }
        if let Some(started) = self.resize_event_at.take() {
            log::info!(
                "resize frame {}x{}: event -> present {:.2} ms",
                renderer_size(renderer).0,
                renderer_size(renderer).1,
                started.elapsed().as_secs_f64() * 1000.0
            );
        }
        WindowBackend::set_cursor(window.as_ref(), self.ui.state().cursor);
        if was_active {
            window.request_redraw();
        }
    }

    fn handle_window_event(&mut self, event_loop: &ActiveEventLoop, event: WindowEvent) {
        if let WindowEvent::KeyboardInput { event, .. } = &event {
            if event.state == ElementState::Pressed
                && event.physical_key == PhysicalKey::Code(KeyCode::F12)
            {
                self.debug_overlay = !self.debug_overlay;
                if !self.debug_overlay {
                    if let Some(renderer) = self.renderer.as_mut() {
                        renderer.set_debug_text(None);
                    }
                    self.ui.invalidate();
                }
                if let Some(window) = &self.window {
                    window.request_redraw();
                }
                return;
            }
        }
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
                if size.width > 0 && size.height > 0 {
                    self.pending_resize = Some((size.width, size.height));
                    let now = Instant::now();
                    self.resize_until = Some(now + Duration::from_millis(160));
                    self.resize_event_at = Some(now);
                    if let Some(renderer) = self.renderer.as_mut() {
                        renderer.set_fast_text(true);
                    }
                    self.fast_text = true;
                    self.ui.resize(Size::new(
                        size.width as f32 / self.scale,
                        size.height as f32 / self.scale,
                    ));
                }
            }
            WindowEvent::ScaleFactorChanged { .. } => {
                self.scale = self
                    .window
                    .as_ref()
                    .and_then(|window| window.current_monitor())
                    .map(|monitor| effective_ui_scale(monitor.size().width, monitor.scale_factor()))
                    .unwrap_or(self.scale);
                if let Some(window) = &self.window {
                    let size = window.physical_size();
                    self.ui.resize(Size::new(
                        size.width as f32 / self.scale,
                        size.height as f32 / self.scale,
                    ));
                }
            }
            _ => {}
        }
        if matches!(event, WindowEvent::Resized(_)) {
            if let Some(window) = &self.window {
                window.request_redraw();
            }
        }
        let events = self.input.translate(&event, self.scale);
        for event in events {
            self.dispatch(event);
        }
    }

    fn dispatch(&mut self, event: UiEvent) {
        if !self.app.on_event(&mut self.ui, &event) {
            self.ui.handle_event(event);
        }
        if self.ui.needs_frame() {
            if let Some(window) = &self.window {
                window.request_redraw();
            }
        }
    }
}

fn renderer_size(renderer: &SurfaceBackend) -> (u32, u32) {
    let config = renderer.config();
    (config.width, config.height)
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

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.pending_resize.is_some() {
            if let Some(window) = &self.window {
                window.request_redraw();
            }
            event_loop.set_control_flow(ControlFlow::Poll);
            return;
        }
        if self.debug_overlay {
            if let Some(window) = &self.window {
                window.request_redraw();
            }
            event_loop.set_control_flow(ControlFlow::WaitUntil(
                Instant::now() + Duration::from_millis(16),
            ));
            return;
        }
        if let Some(until) = self.resize_until {
            if Instant::now() < until {
                event_loop.set_control_flow(ControlFlow::WaitUntil(until));
                return;
            }
            self.resize_until = None;
            if self.fast_text {
                self.fast_text = false;
                if let Some(renderer) = self.renderer.as_mut() {
                    renderer.set_fast_text(false);
                }
                self.ui.invalidate();
                if let Some(window) = &self.window {
                    window.request_redraw();
                }
                event_loop.set_control_flow(ControlFlow::Poll);
                return;
            }
        }
        if self.ui.needs_frame() {
            if let Some(window) = &self.window {
                window.request_redraw();
            }
            event_loop.set_control_flow(ControlFlow::WaitUntil(
                Instant::now() + Duration::from_millis(16),
            ));
        } else {
            event_loop.set_control_flow(ControlFlow::Wait);
        }
    }
}
