use std::path::Path;
use std::sync::mpsc;

use ui_core::damage::Damage;
use ui_core::layout::LayoutTree;
use ui_core::theme::Theme;

use crate::gpu::{self, Gpu};
use crate::painter::Painter;
use crate::RenderError;

pub const HEADLESS_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;

pub struct HeadlessRenderer {
    gpu: Gpu,
    painter: Painter,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    width: u32,
    height: u32,
}

impl HeadlessRenderer {
    pub fn new(width: u32, height: u32) -> Result<Self, RenderError> {
        Self::with_gpu(gpu::init()?, width, height)
    }

    pub fn with_gpu(gpu: Gpu, width: u32, height: u32) -> Result<Self, RenderError> {
        let width = width.max(1);
        let height = height.max(1);
        let painter = Painter::new(&gpu.device, &gpu.queue, HEADLESS_FORMAT);
        let texture = gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("ui-render headless"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: HEADLESS_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        Ok(Self {
            gpu,
            painter,
            texture,
            view,
            width,
            height,
        })
    }

    pub fn size(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        let width = width.max(1);
        let height = height.max(1);
        if (width, height) == (self.width, self.height) {
            return;
        }
        let texture = self.gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("ui-render headless"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: HEADLESS_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        self.view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.texture = texture;
        self.width = width;
        self.height = height;
    }

    pub fn backend(&self) -> wgpu::Backend {
        self.gpu.backend
    }

    pub fn set_fast_text(&mut self, fast: bool) {
        self.painter.set_fast_text(fast);
    }

    pub fn render_offscreen(
        &mut self,
        tree: &LayoutTree,
        theme: &Theme,
        scale: f32,
    ) -> Result<(), RenderError> {
        self.render_offscreen_damage(tree, theme, scale, Damage::full())?;
        Ok(())
    }

    pub fn render_offscreen_damage(
        &mut self,
        tree: &LayoutTree,
        theme: &Theme,
        scale: f32,
        damage: Damage,
    ) -> Result<crate::painter::RenderStats, RenderError> {
        let stats = self.painter.render(
            &self.view,
            (self.width, self.height),
            tree,
            theme,
            scale,
            damage,
        )?;
        self.gpu
            .device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: None,
            })
            .map_err(|error| RenderError::Device(error.to_string()))?;
        Ok(stats)
    }

    pub fn render(
        &mut self,
        tree: &LayoutTree,
        theme: &Theme,
        scale: f32,
    ) -> Result<Vec<u8>, RenderError> {
        self.render_damage(tree, theme, scale, Damage::full())
    }

    pub fn render_damage(
        &mut self,
        tree: &LayoutTree,
        theme: &Theme,
        scale: f32,
        damage: Damage,
    ) -> Result<Vec<u8>, RenderError> {
        self.render_offscreen_damage(tree, theme, scale, damage)?;
        self.read_pixels()
    }

    pub fn stats(&self) -> crate::painter::RenderStats {
        self.painter.stats()
    }

    fn read_pixels(&self) -> Result<Vec<u8>, RenderError> {
        let bytes_per_pixel = 4u32;
        let unpadded_bytes_per_row = self.width * bytes_per_pixel;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let padded_bytes_per_row = unpadded_bytes_per_row.div_ceil(align) * align;
        let buffer = self.gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("ui-render readback"),
            size: (padded_bytes_per_row * self.height) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self
            .gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("ui-render readback encoder"),
            });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(self.height),
                },
            },
            wgpu::Extent3d {
                width: self.width,
                height: self.height,
                depth_or_array_layers: 1,
            },
        );
        self.gpu.queue.submit(Some(encoder.finish()));
        let slice = buffer.slice(..);
        let (sender, receiver) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });
        self.gpu
            .device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: None,
            })
            .map_err(|error| RenderError::Device(error.to_string()))?;
        let mapped = receiver
            .recv()
            .map_err(|error| RenderError::Device(error.to_string()))?;
        mapped.map_err(|error| RenderError::Device(error.to_string()))?;
        let data = slice
            .get_mapped_range()
            .map_err(|error| RenderError::Device(error.to_string()))?;
        let mut pixels = Vec::with_capacity((unpadded_bytes_per_row * self.height) as usize);
        for row in 0..self.height {
            let start = (row * padded_bytes_per_row) as usize;
            let end = start + unpadded_bytes_per_row as usize;
            pixels.extend_from_slice(&data[start..end]);
        }
        drop(data);
        buffer.unmap();
        Ok(pixels)
    }

    pub fn save_png(
        &mut self,
        tree: &LayoutTree,
        theme: &Theme,
        scale: f32,
        path: impl AsRef<Path>,
    ) -> Result<(), RenderError> {
        let pixels = self.render(tree, theme, scale)?;
        write_png(path.as_ref(), self.width, self.height, &pixels)
    }
}

pub fn write_png(path: &Path, width: u32, height: u32, pixels: &[u8]) -> Result<(), RenderError> {
    let file = std::fs::File::create(path)?;
    let writer = std::io::BufWriter::new(file);
    let mut encoder = png::Encoder::new(writer, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .map_err(|error| RenderError::Png(error.to_string()))?;
    writer
        .write_image_data(pixels)
        .map_err(|error| RenderError::Png(error.to_string()))?;
    Ok(())
}
