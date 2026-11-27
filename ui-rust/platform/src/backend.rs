use std::sync::Arc;

use ui_core::geometry::{Point, Size};
use ui_core::layout::{CursorShape, LayoutTree};
use ui_core::theme::Theme;
use ui_core::ui::{Key, Modifiers, UiEvent};
use ui_render::gpu::Gpu;
use ui_render::painter::Painter;
use ui_render::RenderError;
use winit::dpi::PhysicalSize;
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::keyboard::{Key as WinitKey, NamedKey};
use winit::window::{CursorIcon, Window, WindowId};

use crate::PlatformError;

pub trait WindowBackend {
    fn physical_size(&self) -> PhysicalSize<u32>;
    fn scale_factor(&self) -> f64;
    fn logical_size(&self) -> Size;
    fn request_redraw(&self);
    fn set_cursor(&self, cursor: CursorShape);
    fn set_title(&self, title: &str);
    fn id(&self) -> WindowId;
}

impl WindowBackend for Window {
    fn physical_size(&self) -> PhysicalSize<u32> {
        self.inner_size()
    }

    fn scale_factor(&self) -> f64 {
        self.scale_factor()
    }

    fn logical_size(&self) -> Size {
        let size = self.inner_size();
        let scale = self.scale_factor() as f32;
        Size::new(size.width as f32 / scale, size.height as f32 / scale)
    }

    fn request_redraw(&self) {
        self.request_redraw();
    }

    fn set_cursor(&self, cursor: CursorShape) {
        let icon = match cursor {
            CursorShape::Default => CursorIcon::Default,
            CursorShape::Pointer => CursorIcon::Pointer,
            CursorShape::Text => CursorIcon::Text,
        };
        self.set_cursor(icon);
    }

    fn set_title(&self, title: &str) {
        self.set_title(title);
    }

    fn id(&self) -> WindowId {
        self.id()
    }
}

pub trait RenderBackend {
    fn format(&self) -> wgpu::TextureFormat;
    fn resize(&mut self, device: &wgpu::Device, width: u32, height: u32);
    fn render(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        tree: &LayoutTree,
        theme: &Theme,
        scale: f32,
    ) -> Result<(), RenderError>;
}

pub struct SurfaceBackend {
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    painter: Painter,
}

impl SurfaceBackend {
    pub fn new(gpu: &Gpu, window: Arc<Window>) -> Result<Self, PlatformError> {
        let size = window.inner_size();
        let surface = gpu
            .instance
            .create_surface(window)
            .map_err(|error| PlatformError::Window(error.to_string()))?;
        let mut config = surface
            .get_default_config(&gpu.adapter, size.width.max(1), size.height.max(1))
            .ok_or_else(|| PlatformError::Window("surface is not supported".to_string()))?;
        let capabilities = surface.get_capabilities(&gpu.adapter);
        if let Some(format) = capabilities.formats.iter().copied().find(|f| f.is_srgb()) {
            config.format = format;
        }
        config.present_mode = wgpu::PresentMode::AutoVsync;
        surface.configure(&gpu.device, &config);
        let painter = Painter::new(&gpu.device, &gpu.queue, config.format);
        Ok(Self {
            surface,
            config,
            painter,
        })
    }

    pub fn config(&self) -> &wgpu::SurfaceConfiguration {
        &self.config
    }
}

impl RenderBackend for SurfaceBackend {
    fn format(&self) -> wgpu::TextureFormat {
        self.config.format
    }

    fn resize(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        if width == 0 || height == 0 {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(device, &self.config);
    }

    fn render(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        tree: &LayoutTree,
        theme: &Theme,
        scale: f32,
    ) -> Result<(), RenderError> {
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => frame,
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                self.surface.configure(device, &self.config);
                frame
            }
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(device, &self.config);
                return Ok(());
            }
            wgpu::CurrentSurfaceTexture::Timeout
            | wgpu::CurrentSurfaceTexture::Occluded
            | wgpu::CurrentSurfaceTexture::Validation => return Ok(()),
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        self.painter.render(
            &view,
            (self.config.width, self.config.height),
            tree,
            theme,
            scale,
        )?;
        queue.present(frame);
        Ok(())
    }
}

pub trait InputBackend {
    fn pointer(&self) -> Point;
    fn modifiers(&self) -> Modifiers;
    fn translate(&mut self, event: &WindowEvent, scale: f32) -> Vec<UiEvent>;
}

#[derive(Default)]
pub struct WinitInput {
    modifiers: Modifiers,
    pointer: Point,
}

impl WinitInput {
    pub fn new() -> Self {
        Self::default()
    }
}

impl InputBackend for WinitInput {
    fn pointer(&self) -> Point {
        self.pointer
    }

    fn modifiers(&self) -> Modifiers {
        self.modifiers
    }

    fn translate(&mut self, event: &WindowEvent, scale: f32) -> Vec<UiEvent> {
        match event {
            WindowEvent::ModifiersChanged(modifiers) => {
                let state = modifiers.state();
                self.modifiers = Modifiers {
                    shift: state.shift_key(),
                    control: state.control_key(),
                    alt: state.alt_key(),
                    meta: state.super_key(),
                };
                Vec::new()
            }
            WindowEvent::CursorMoved { position, .. } => {
                self.pointer = Point::new(position.x as f32 / scale, position.y as f32 / scale);
                vec![UiEvent::PointerMove(self.pointer)]
            }
            WindowEvent::CursorLeft { .. } => vec![UiEvent::PointerLeave],
            WindowEvent::MouseInput { state, button, .. } => {
                if *button != MouseButton::Left {
                    return Vec::new();
                }
                match state {
                    ElementState::Pressed => vec![UiEvent::PointerDown(self.pointer)],
                    ElementState::Released => vec![UiEvent::PointerUp(self.pointer)],
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let scroll = match delta {
                    winit::event::MouseScrollDelta::LineDelta(_, y) => y * 40.0,
                    winit::event::MouseScrollDelta::PixelDelta(position) => position.y as f32,
                };
                vec![UiEvent::Wheel { delta: scroll }]
            }
            WindowEvent::KeyboardInput { event, .. } => {
                if event.state != ElementState::Pressed {
                    return Vec::new();
                }
                if let Some(key) = map_key(&event.logical_key) {
                    vec![UiEvent::Key {
                        key,
                        modifiers: self.modifiers,
                        pressed: true,
                    }]
                } else if let Some(text) = &event.text {
                    if self.modifiers.control || self.modifiers.meta || text.is_empty() {
                        Vec::new()
                    } else {
                        vec![UiEvent::Text(text.to_string())]
                    }
                } else {
                    Vec::new()
                }
            }
            WindowEvent::Ime(winit::event::Ime::Commit(text)) => {
                vec![UiEvent::Ime(text.clone())]
            }
            WindowEvent::Touch(touch) => {
                let point = Point::new(
                    touch.location.x as f32 / scale,
                    touch.location.y as f32 / scale,
                );
                match touch.phase {
                    winit::event::TouchPhase::Started => vec![UiEvent::PointerDown(point)],
                    winit::event::TouchPhase::Moved => vec![UiEvent::PointerMove(point)],
                    winit::event::TouchPhase::Ended | winit::event::TouchPhase::Cancelled => {
                        vec![UiEvent::PointerUp(point)]
                    }
                }
            }
            WindowEvent::Focused(false) => vec![UiEvent::FocusLost],
            _ => Vec::new(),
        }
    }
}

fn map_key(key: &WinitKey) -> Option<Key> {
    match key {
        WinitKey::Named(named) => match named {
            NamedKey::Tab => Some(Key::Tab),
            NamedKey::Enter => Some(Key::Enter),
            NamedKey::Escape => Some(Key::Escape),
            NamedKey::Backspace => Some(Key::Backspace),
            NamedKey::Delete => Some(Key::Delete),
            NamedKey::ArrowLeft => Some(Key::ArrowLeft),
            NamedKey::ArrowRight => Some(Key::ArrowRight),
            NamedKey::ArrowUp => Some(Key::ArrowUp),
            NamedKey::ArrowDown => Some(Key::ArrowDown),
            NamedKey::Home => Some(Key::Home),
            NamedKey::End => Some(Key::End),
            NamedKey::Space => Some(Key::Space),
            _ => None,
        },
        WinitKey::Character(text) => text.chars().next().map(Key::Char),
        _ => None,
    }
}
