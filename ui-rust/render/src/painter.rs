use std::collections::HashMap;

use bytemuck::{Pod, Zeroable};
use cosmic_text::{Attrs, Buffer, Family, FontSystem, Metrics, Shaping, SwashCache, Weight};
use glyphon::{Cache, Resolution, TextArea, TextAtlas, TextBounds, TextRenderer, Viewport};
use lyon::math::point;
use lyon::path::Path;
use lyon::tessellation::{
    BuffersBuilder, FillOptions, FillTessellator, FillVertex, StrokeOptions, StrokeTessellator,
    StrokeVertex, VertexBuffers,
};
use ui_core::color::Color;
use ui_core::damage::Damage;
use ui_core::geometry::{Align, Point, Rect, Size};
use ui_core::layout::{measure_text, DataTableDragMode, LayoutNode, LayoutTree, PaintData};
use ui_core::theme::{TextStyle, Theme};
use ui_core::widget::{ButtonVariant, IconName, TagVariant};

use crate::RenderError;

const SAMPLE_COUNT: u32 = 4;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Vertex {
    position: [f32; 2],
    color: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Globals {
    resolution: [f32; 2],
    padding: [f32; 2],
}

struct TextCmd {
    text: String,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    style: TextStyle,
    color: [u8; 4],
    clip: Rect,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct TextKey {
    text: String,
    size: u32,
    line_height: u32,
    weight: u16,
    tracking: u32,
    width: u32,
    height: u32,
}

impl TextKey {
    fn new(command: &TextCmd, scale: f32, snap: u32) -> Self {
        let width = command.width.max(1.0) * scale;
        let width = if snap > 1 {
            ((width / snap as f32).round() * snap as f32).max(snap as f32)
        } else {
            width
        };
        Self {
            text: command.text.clone(),
            size: (command.style.size * scale).to_bits(),
            line_height: (command.style.line_height * scale).to_bits(),
            weight: command.style.weight.weight(),
            tracking: command.style.tracking.to_bits(),
            width: width.to_bits(),
            height: (command.height.max(1.0) * scale).to_bits(),
        }
    }
}

struct TextEntry {
    buffer: Buffer,
    last_used: u64,
}

const TEXT_CACHE_LIMIT: usize = 2048;

#[derive(Default)]
struct TextCache {
    entries: HashMap<TextKey, TextEntry>,
    frame: u64,
    shaped: u64,
    hits: u64,
}

impl TextCache {
    fn begin_frame(&mut self) {
        self.frame = self.frame.wrapping_add(1);
    }

    fn ensure(&mut self, key: TextKey, font_system: &mut FontSystem) {
        if let Some(entry) = self.entries.get_mut(&key) {
            entry.last_used = self.frame;
            self.hits += 1;
            return;
        }
        let metrics = Metrics::new(
            f32::from_bits(key.size),
            f32::from_bits(key.line_height).max(1.0),
        );
        let mut buffer = Buffer::new(font_system, metrics);
        buffer.set_size(
            Some(f32::from_bits(key.width)),
            Some(f32::from_bits(key.height)),
        );
        let attrs = Attrs::new()
            .family(Family::SansSerif)
            .weight(Weight(key.weight));
        buffer.set_text(&key.text, &attrs, Shaping::Advanced, None);
        buffer.shape_until_scroll(font_system, false);
        self.entries.insert(
            key,
            TextEntry {
                buffer,
                last_used: self.frame,
            },
        );
        self.shaped += 1;
    }

    fn end_frame(&mut self) {
        if self.entries.len() <= TEXT_CACHE_LIMIT {
            return;
        }
        let current = self.frame;
        while self.entries.len() > TEXT_CACHE_LIMIT {
            let victim = self
                .entries
                .iter()
                .filter(|(_, entry)| entry.last_used < current)
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(key, _)| key.clone());
            match victim {
                Some(key) => {
                    self.entries.remove(&key);
                }
                None => break,
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RenderStats {
    pub rendered: bool,
    pub full: bool,
    pub damage_pixels: u64,
    pub text_cache_entries: usize,
    pub text_shaped: u64,
    pub text_cache_hits: u64,
}

struct Scene {
    _msaa_texture: wgpu::Texture,
    msaa_view: wgpu::TextureView,
    _resolve_texture: wgpu::Texture,
    resolve_view: wgpu::TextureView,
    bind_group: wgpu::BindGroup,
    size: (u32, u32),
}

pub struct Painter {
    format: wgpu::TextureFormat,
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    bind_group: wgpu::BindGroup,
    globals: wgpu::Buffer,
    font_system: FontSystem,
    swash_cache: SwashCache,
    atlas: TextAtlas,
    text_renderer: TextRenderer,
    viewport: Viewport,
    vertices: Vec<Vertex>,
    indices: Vec<u32>,
    texts: Vec<TextCmd>,
    text_cache: TextCache,
    scene: Option<Scene>,
    blit_pipeline: wgpu::RenderPipeline,
    blit_bind_group_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    force_full_next: bool,
    text_width_snap: u32,
    debug_text: Option<String>,
    last_stats: RenderStats,
}

impl Painter {
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, format: wgpu::TextureFormat) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ui-render shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });
        let globals = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("ui-render globals"),
            size: std::mem::size_of::<Globals>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ui-render globals layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("ui-render globals bind group"),
            layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: globals.as_entire_binding(),
            }],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("ui-render pipeline layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let attributes = wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x4];
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ui-render pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Vertex>() as wgpu::BufferAddress,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &attributes,
                })],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState {
                count: SAMPLE_COUNT,
                ..wgpu::MultisampleState::default()
            },
            multiview_mask: None,
            cache: None,
        });
        let cache = Cache::new(device);
        let mut atlas = TextAtlas::new(device, queue, &cache, format);
        let text_renderer = TextRenderer::new(
            &mut atlas,
            device,
            wgpu::MultisampleState {
                count: SAMPLE_COUNT,
                ..wgpu::MultisampleState::default()
            },
            None,
        );
        let viewport = Viewport::new(device, &cache);
        let blit_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("ui-render blit layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });
        let blit_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("ui-render blit pipeline layout"),
            bind_group_layouts: &[Some(&blit_bind_group_layout)],
            immediate_size: 0,
        });
        let blit_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ui-render blit pipeline"),
            layout: Some(&blit_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("blit_vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("blit_fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("ui-render blit sampler"),
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });
        Self {
            format,
            device: device.clone(),
            queue: queue.clone(),
            pipeline,
            bind_group,
            globals,
            font_system: FontSystem::new(),
            swash_cache: SwashCache::new(),
            atlas,
            text_renderer,
            viewport,
            vertices: Vec::new(),
            indices: Vec::new(),
            texts: Vec::new(),
            text_cache: TextCache::default(),
            scene: None,
            blit_pipeline,
            blit_bind_group_layout,
            sampler,
            force_full_next: true,
            text_width_snap: 0,
            debug_text: None,
            last_stats: RenderStats::default(),
        }
    }

    pub fn format(&self) -> wgpu::TextureFormat {
        self.format
    }

    pub fn set_fast_text(&mut self, fast: bool) {
        self.text_width_snap = if fast { 32 } else { 0 };
    }

    pub fn set_debug_text(&mut self, text: Option<String>) {
        self.debug_text = text;
    }

    pub fn render(
        &mut self,
        target: &wgpu::TextureView,
        size: (u32, u32),
        tree: &LayoutTree,
        theme: &Theme,
        scale: f32,
        damage: Damage,
    ) -> Result<RenderStats, RenderError> {
        self.ensure_scene(size);
        let viewport = Size::new(size.0 as f32, size.1 as f32);
        if self.force_full_next {
            self.force_full_next = false;
            self.last_stats = RenderStats::default();
            self.last_stats.full = true;
            self.render_full(target, size, tree, theme, scale)?;
            return Ok(self.last_stats);
        }
        let damage = damage.clamp(Size::new(size.0 as f32 / scale, size.1 as f32 / scale));
        if damage.is_empty() {
            self.last_stats = RenderStats {
                rendered: false,
                ..RenderStats::default()
            };
            return Ok(self.last_stats);
        }
        if damage.full {
            self.render_full(target, size, tree, theme, scale)?;
            return Ok(self.last_stats);
        }
        let region = damage.rect.expect("damage rect");
        self.build_scene(tree, theme, scale, Some(region), viewport);
        self.upload_globals(size);
        self.viewport.update(
            &self.queue,
            Resolution {
                width: size.0,
                height: size.1,
            },
        );
        self.prepare_text(scale)?;
        let physical = Rect::new(
            region.x * scale,
            region.y * scale,
            region.width * scale,
            region.height * scale,
        );
        self.render_frame(target, size, physical, false, theme)?;
        self.last_stats = RenderStats {
            rendered: true,
            full: false,
            damage_pixels: (physical.width * physical.height) as u64,
            text_cache_entries: self.text_cache.entries.len(),
            text_shaped: self.text_cache.shaped,
            text_cache_hits: self.text_cache.hits,
        };
        Ok(self.last_stats)
    }

    pub fn stats(&self) -> RenderStats {
        self.last_stats
    }

    fn render_full(
        &mut self,
        target: &wgpu::TextureView,
        size: (u32, u32),
        tree: &LayoutTree,
        theme: &Theme,
        scale: f32,
    ) -> Result<(), RenderError> {
        let viewport = Size::new(size.0 as f32 / scale, size.1 as f32 / scale);
        self.build_scene(tree, theme, scale, None, viewport);
        self.upload_globals(size);
        self.viewport.update(
            &self.queue,
            Resolution {
                width: size.0,
                height: size.1,
            },
        );
        self.prepare_text(scale)?;
        self.render_frame(
            target,
            size,
            Rect::new(0.0, 0.0, size.0 as f32, size.1 as f32),
            true,
            theme,
        )?;
        self.last_stats = RenderStats {
            rendered: true,
            full: true,
            damage_pixels: size.0 as u64 * size.1 as u64,
            text_cache_entries: self.text_cache.entries.len(),
            text_shaped: self.text_cache.shaped,
            text_cache_hits: self.text_cache.hits,
        };
        Ok(())
    }

    fn build_scene(
        &mut self,
        tree: &LayoutTree,
        theme: &Theme,
        scale: f32,
        damage: Option<Rect>,
        viewport: Size,
    ) {
        self.vertices.clear();
        self.indices.clear();
        self.texts.clear();
        self.fill_rounded_rect(
            Rect::new(0.0, 0.0, viewport.width, viewport.height),
            0.0,
            theme.palette.page,
            scale,
        );
        self.paint_node(&tree.root, theme, scale, damage);
        if let Some(text) = self.debug_text.clone() {
            let style = TextStyle::new(12.0, 17.0, ui_core::theme::FontWeight::Medium);
            let lines = text.lines().count().max(1) as f32;
            let panel = Rect::new(12.0, 12.0, 340.0, lines * style.line_height + 20.0);
            self.fill_rounded_rect(
                panel,
                8.0,
                Color::from_hex(0x000000).with_alpha(0.78),
                scale,
            );
            self.push_text(
                &text,
                Rect::new(
                    panel.x + 12.0,
                    panel.y + 10.0,
                    panel.width - 24.0,
                    panel.height - 20.0,
                ),
                style,
                Color::from_hex(0xECECEF),
                Align::Start,
                Rect::new(0.0, 0.0, viewport.width, viewport.height),
                scale,
            );
        }
    }

    fn prepare_text(&mut self, scale: f32) -> Result<(), RenderError> {
        self.text_cache.begin_frame();
        {
            let keys: Vec<TextKey> = self
                .texts
                .iter()
                .map(|command| TextKey::new(command, scale, self.text_width_snap))
                .collect();
            let Painter {
                text_cache,
                font_system,
                ..
            } = self;
            for key in keys {
                text_cache.ensure(key, font_system);
            }
        }
        let texts = &self.texts;
        let cache = &self.text_cache;
        let Painter {
            device,
            queue,
            font_system,
            swash_cache,
            atlas,
            text_renderer,
            viewport,
            ..
        } = self;
        let mut areas = Vec::with_capacity(texts.len());
        for command in texts {
            let key = TextKey::new(command, scale, self.text_width_snap);
            let Some(entry) = cache.entries.get(&key) else {
                return Err(RenderError::Text(format!(
                    "text buffer disappeared from cache for {:?}",
                    command.text
                )));
            };
            let bounds = TextBounds {
                left: (command.clip.x * scale).floor().max(0.0) as i32,
                top: (command.clip.y * scale).floor().max(0.0) as i32,
                right: (command.clip.right() * scale).ceil() as i32,
                bottom: (command.clip.bottom() * scale).ceil() as i32,
            };
            areas.push(TextArea {
                buffer: &entry.buffer,
                left: command.x * scale,
                top: command.y * scale,
                scale: 1.0,
                bounds,
                default_color: cosmic_text::Color::rgba(
                    command.color[0],
                    command.color[1],
                    command.color[2],
                    command.color[3],
                ),
                custom_glyphs: &[],
            });
        }
        text_renderer
            .prepare(
                device,
                queue,
                font_system,
                atlas,
                viewport,
                areas,
                swash_cache,
            )
            .map_err(|error| RenderError::Text(error.to_string()))?;
        self.text_cache.end_frame();
        Ok(())
    }

    fn ensure_scene(&mut self, size: (u32, u32)) {
        if let Some(scene) = &self.scene {
            if scene.size == size {
                return;
            }
        }
        let size3d = wgpu::Extent3d {
            width: size.0.max(1),
            height: size.1.max(1),
            depth_or_array_layers: 1,
        };
        let msaa_texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("ui-render scene msaa"),
            size: size3d,
            mip_level_count: 1,
            sample_count: SAMPLE_COUNT,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let msaa_view = msaa_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let resolve_texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("ui-render scene"),
            size: size3d,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let resolve_view = resolve_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("ui-render scene bind group"),
            layout: &self.blit_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&resolve_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });
        self.scene = Some(Scene {
            _msaa_texture: msaa_texture,
            msaa_view,
            _resolve_texture: resolve_texture,
            resolve_view,
            bind_group,
            size,
        });
        self.force_full_next = true;
    }

    fn upload_globals(&self, size: (u32, u32)) {
        let globals = Globals {
            resolution: [size.0 as f32, size.1 as f32],
            padding: [0.0, 0.0],
        };
        self.queue
            .write_buffer(&self.globals, 0, bytemuck::bytes_of(&globals));
    }

    fn render_frame(
        &mut self,
        target: &wgpu::TextureView,
        size: (u32, u32),
        region: Rect,
        full: bool,
        theme: &Theme,
    ) -> Result<(), RenderError> {
        let vertex_buffer = self.create_buffer(
            "ui-render vertices",
            bytemuck::cast_slice(&self.vertices),
            wgpu::BufferUsages::VERTEX,
        );
        let index_buffer = self.create_buffer(
            "ui-render indices",
            bytemuck::cast_slice(&self.indices),
            wgpu::BufferUsages::INDEX,
        );
        let Some(scene) = self.scene.as_ref() else {
            return Ok(());
        };
        let msaa_view = scene.msaa_view.clone();
        let resolve_view = scene.resolve_view.clone();
        let scene_bind_group = scene.bind_group.clone();
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("ui-render encoder"),
            });
        {
            let background = theme.palette.page.to_linear_rgba();
            let load = if full {
                wgpu::LoadOp::Clear(wgpu::Color {
                    r: background[0] as f64,
                    g: background[1] as f64,
                    b: background[2] as f64,
                    a: background[3] as f64,
                })
            } else {
                wgpu::LoadOp::Load
            };
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ui-render scene pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &msaa_view,
                    resolve_target: Some(&resolve_view),
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            let scissor = Rect::new(
                region.x.max(0.0).floor(),
                region.y.max(0.0).floor(),
                region.width.max(0.0).ceil(),
                region.height.max(0.0).ceil(),
            );
            let x = scissor.x.min(size.0 as f32) as u32;
            let y = scissor.y.min(size.1 as f32) as u32;
            let width = scissor.width.min(size.0 as f32 - x as f32).max(0.0) as u32;
            let height = scissor.height.min(size.1 as f32 - y as f32).max(0.0) as u32;
            pass.set_scissor_rect(x, y, width.max(1), height.max(1));
            if !self.indices.is_empty() {
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &self.bind_group, &[]);
                pass.set_vertex_buffer(0, vertex_buffer.slice(..));
                pass.set_index_buffer(index_buffer.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..self.indices.len() as u32, 0, 0..1);
            }
            self.text_renderer
                .render(&self.atlas, &self.viewport, &mut pass)
                .map_err(|error| RenderError::Text(error.to_string()))?;
        }
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ui-render blit pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.blit_pipeline);
            pass.set_bind_group(0, &scene_bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit(Some(encoder.finish()));
        Ok(())
    }

    fn create_buffer(
        &self,
        label: &str,
        contents: &[u8],
        usage: wgpu::BufferUsages,
    ) -> wgpu::Buffer {
        let size = contents.len().max(4) as u64;
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size,
            usage: usage | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.queue.write_buffer(&buffer, 0, contents);
        buffer
    }

    fn paint_node(&mut self, node: &LayoutNode, theme: &Theme, scale: f32, damage: Option<Rect>) {
        if let Some(region) = damage {
            let bounds = Rect::new(
                node.rect.x - 12.0,
                node.rect.y - 12.0,
                node.rect.width + 24.0,
                node.rect.height + 24.0,
            );
            if bounds.intersect(&region).is_empty() {
                return;
            }
        }
        if node.shadow > 0.0 {
            let level = theme.elevation_level(node.shadow);
            if level.alpha > 0.0 {
                for layer in 0..3 {
                    let spread = level.blur * (layer as f32 + 1.0) / 6.0;
                    let shadow_rect = Rect::new(
                        node.rect.x - spread,
                        node.rect.y + level.offset_y,
                        node.rect.width + spread * 2.0,
                        node.rect.height + spread * 2.0,
                    );
                    self.fill_rounded_rect(
                        shadow_rect,
                        node.radius + spread,
                        theme
                            .palette
                            .shadow
                            .with_alpha(level.alpha * (1.0 - layer as f32 * 0.28)),
                        scale,
                    );
                }
            }
        }
        if node.background.is_some() || node.border.is_some() {
            self.draw_rounded_rect(
                node.rect,
                node.radius,
                node.background,
                node.border.map(|border| (border.width, border.color)),
                scale,
            );
        }
        if node.hovered
            && (node.role == ui_core::Role::Card
                || (matches!(&node.paint, PaintData::Tag { .. })
                    && node.interaction.click.is_some()))
        {
            self.fill_rounded_rect(
                node.rect,
                node.radius,
                theme.palette.on_surface.with_alpha(0.06),
                scale,
            );
        }
        match &node.paint {
            PaintData::None => {}
            PaintData::Text {
                text,
                style,
                color,
                align,
            } => {
                self.push_text(text, node.rect, *style, *color, *align, node.clip, scale);
            }
            PaintData::Button {
                label,
                variant,
                size,
                icon,
                loading,
                enabled,
                hovered,
                pressed,
            } => {
                let foreground = match variant {
                    ButtonVariant::Primary | ButtonVariant::Filled => theme.palette.on_primary,
                    ButtonVariant::Tonal => theme.palette.on_secondary_container,
                    ButtonVariant::Danger => theme.palette.on_error,
                    ButtonVariant::Secondary | ButtonVariant::Outlined => theme.palette.primary,
                    ButtonVariant::Ghost | ButtonVariant::Text => theme.palette.primary,
                };
                let foreground = if *enabled {
                    foreground
                } else {
                    theme.palette.text_disabled
                };
                if *enabled && (*hovered || *pressed) {
                    self.fill_rounded_rect(
                        node.rect,
                        node.radius,
                        foreground.with_alpha(if *pressed { 0.12 } else { 0.08 }),
                        scale,
                    );
                }
                let base = if matches!(size, ui_core::widget::ControlSize::Small) {
                    theme.typography.label_medium
                } else {
                    theme.typography.label_large
                };
                let style = TextStyle {
                    size: size.font_size(),
                    line_height: base.line_height,
                    weight: base.weight,
                    tracking: base.tracking,
                };
                let label_width = measure_text(label, style, node.rect.width).width;
                let icon_space = if icon.is_some() { 20.0 } else { 0.0 };
                let loading_space = if *loading { 16.0 } else { 0.0 };
                let total = label_width + icon_space + loading_space;
                let mut x = node.rect.x + (node.rect.width - total) / 2.0;
                let center_y = node.rect.center().y;
                if let Some(icon) = icon {
                    let rect = Rect::new(x, center_y - 9.0, 18.0, 18.0);
                    self.paint_icon(*icon, rect, foreground, scale);
                    x += 20.0;
                }
                if *loading {
                    self.paint_spinner(Rect::new(x, center_y - 7.0, 14.0, 14.0), foreground, scale);
                    x += 16.0;
                }
                let text_rect = Rect::new(
                    x,
                    center_y - style.line_height / 2.0,
                    label_width.max(1.0) + 1.0,
                    style.line_height,
                );
                self.push_text(
                    label,
                    text_rect,
                    style,
                    foreground,
                    Align::Start,
                    node.clip,
                    scale,
                );
            }
            PaintData::TextField {
                value,
                label,
                placeholder,
                password,
                invalid,
                focused,
                hovered,
                enabled,
                leading_icon,
                caret,
                selection,
                help,
            } => {
                let label_style = theme.typography.label_large;
                let label_color = if !*enabled {
                    theme.palette.text_disabled
                } else if *invalid {
                    theme.palette.error
                } else {
                    theme.palette.on_surface_variant
                };
                self.push_text(
                    label,
                    Rect::new(
                        node.rect.x,
                        node.rect.y,
                        node.rect.width,
                        label_style.line_height,
                    ),
                    label_style,
                    label_color,
                    Align::Start,
                    node.clip,
                    scale,
                );
                let field_rect = Rect::new(
                    node.rect.x,
                    node.rect.y + label_style.line_height + 6.0,
                    node.rect.width,
                    theme.scaled(theme.sizes.input_height),
                );
                let border_color = if *invalid {
                    theme.palette.error
                } else if *focused {
                    theme.palette.focus_ring
                } else if *hovered {
                    theme.palette.outline
                } else {
                    theme.palette.outline_variant
                };
                self.draw_rounded_rect(
                    field_rect,
                    theme.radius.control,
                    Some(theme.palette.surface_container_lowest),
                    Some((theme.sizes.border_width, border_color)),
                    scale,
                );
                if *focused {
                    let ring = Rect::new(
                        field_rect.x - theme.sizes.focus_ring_offset,
                        field_rect.y - theme.sizes.focus_ring_offset,
                        field_rect.width + theme.sizes.focus_ring_offset * 2.0,
                        field_rect.height + theme.sizes.focus_ring_offset * 2.0,
                    );
                    self.stroke_rounded_rect(
                        ring,
                        theme.radius.control + theme.sizes.focus_ring_offset,
                        theme.sizes.focus_ring_width,
                        border_color,
                        scale,
                    );
                }
                let display = if *password {
                    "•".repeat(value.chars().count())
                } else {
                    value.clone()
                };
                let text_style = theme.typography.body_medium;
                let text_color = if !*enabled {
                    theme.palette.text_disabled
                } else if display.is_empty() {
                    theme.palette.on_surface_muted
                } else {
                    theme.palette.on_surface
                };
                let content = if display.is_empty() {
                    placeholder.clone()
                } else {
                    display
                };
                let mut text_x = field_rect.x + 12.0;
                if let Some(icon) = leading_icon {
                    self.paint_icon(
                        *icon,
                        Rect::new(field_rect.x + 12.0, field_rect.center().y - 9.0, 18.0, 18.0),
                        if *enabled {
                            theme.palette.on_surface_variant
                        } else {
                            theme.palette.text_disabled
                        },
                        scale,
                    );
                    text_x += 26.0;
                }
                let text_y = field_rect.center().y - text_style.line_height / 2.0;
                if let Some((start, end)) = selection {
                    let prefix = |count: usize| -> String {
                        if *password {
                            "•".repeat(count)
                        } else {
                            value.chars().take(count).collect()
                        }
                    };
                    let start_width =
                        measure_text(&prefix(*start), text_style, f32::INFINITY).width;
                    let end_width = measure_text(&prefix(*end), text_style, f32::INFINITY).width;
                    if end_width > start_width {
                        self.fill_rounded_rect(
                            Rect::new(
                                text_x + start_width,
                                field_rect.center().y - text_style.size * 0.62,
                                end_width - start_width,
                                text_style.size * 1.24,
                            ),
                            2.0,
                            theme.palette.primary.with_alpha(0.22),
                            scale,
                        );
                    }
                }
                self.push_text(
                    &content,
                    Rect::new(
                        text_x,
                        text_y,
                        field_rect.width - (text_x - field_rect.x) - 12.0,
                        text_style.line_height,
                    ),
                    text_style,
                    text_color,
                    Align::Start,
                    node.clip,
                    scale,
                );
                if let Some(caret) = caret {
                    let prefix: String = if *password {
                        "•".repeat(*caret)
                    } else {
                        value.chars().take(*caret).collect()
                    };
                    let width = measure_text(&prefix, text_style, f32::INFINITY).width;
                    let caret_x = (text_x + width).min(field_rect.right() - 4.0);
                    let caret_rect = Rect::new(
                        caret_x,
                        field_rect.center().y - text_style.size * 0.65,
                        1.5,
                        text_style.size * 1.3,
                    );
                    self.fill_rounded_rect(caret_rect, 0.5, theme.palette.primary, scale);
                }
                if let Some(help) = help {
                    let helper_color = if *invalid {
                        theme.palette.error
                    } else {
                        theme.palette.on_surface_variant
                    };
                    let helper_style = theme.typography.body_small;
                    let helper_y = field_rect.bottom() + 6.0;
                    self.push_text(
                        help,
                        Rect::new(
                            node.rect.x,
                            helper_y,
                            node.rect.width,
                            helper_style.line_height,
                        ),
                        helper_style,
                        helper_color,
                        Align::Start,
                        node.clip,
                        scale,
                    );
                }
            }
            PaintData::Checkbox {
                label,
                checked,
                focused,
                hovered,
            } => {
                let box_size = theme.sizes.icon;
                let box_rect = Rect::new(
                    node.rect.x,
                    node.rect.center().y - box_size / 2.0,
                    box_size,
                    box_size,
                );
                let fill = if *checked {
                    theme.palette.primary
                } else {
                    theme.palette.surface_container_lowest
                };
                self.draw_rounded_rect(
                    box_rect,
                    theme.radius.xs,
                    Some(fill),
                    Some((
                        theme.sizes.border_width,
                        if *checked || *hovered {
                            theme.palette.primary
                        } else {
                            theme.palette.outline
                        },
                    )),
                    scale,
                );
                if *focused {
                    let ring = Rect::new(
                        box_rect.x - theme.sizes.focus_ring_offset,
                        box_rect.y - theme.sizes.focus_ring_offset,
                        box_rect.width + theme.sizes.focus_ring_offset * 2.0,
                        box_rect.height + theme.sizes.focus_ring_offset * 2.0,
                    );
                    self.stroke_rounded_rect(
                        ring,
                        theme.radius.xs + theme.sizes.focus_ring_offset,
                        theme.sizes.focus_ring_width,
                        theme.palette.focus_ring,
                        scale,
                    );
                }
                if *checked {
                    self.paint_icon(IconName::Check, box_rect, theme.palette.on_primary, scale);
                }
                self.push_text(
                    label,
                    Rect::new(
                        box_rect.right() + 8.0,
                        node.rect.center().y - theme.typography.body_medium.line_height / 2.0,
                        node.rect.width - box_size - 8.0,
                        theme.typography.body_medium.line_height,
                    ),
                    theme.typography.body_medium,
                    theme.palette.on_surface,
                    Align::Start,
                    node.clip,
                    scale,
                );
            }
            PaintData::Switch {
                label,
                checked,
                focused,
                hovered,
            } => {
                let track = Rect::new(node.rect.x, node.rect.center().y - 12.0, 44.0, 24.0);
                let track_color = if *checked {
                    theme.palette.primary
                } else {
                    theme.palette.surface_container_highest
                };
                let border_color = if *checked || *hovered {
                    theme.palette.primary
                } else {
                    theme.palette.outline
                };
                self.draw_rounded_rect(
                    track,
                    12.0,
                    Some(track_color),
                    Some((theme.sizes.border_width, border_color)),
                    scale,
                );
                if *focused {
                    let ring = Rect::new(
                        track.x - theme.sizes.focus_ring_offset,
                        track.y - theme.sizes.focus_ring_offset,
                        track.width + theme.sizes.focus_ring_offset * 2.0,
                        track.height + theme.sizes.focus_ring_offset * 2.0,
                    );
                    self.stroke_rounded_rect(
                        ring,
                        12.0 + theme.sizes.focus_ring_offset,
                        theme.sizes.focus_ring_width,
                        theme.palette.focus_ring,
                        scale,
                    );
                }
                let knob_x = if *checked {
                    track.right() - 3.0 - 18.0
                } else {
                    track.x + 3.0
                };
                self.fill_rounded_rect(
                    Rect::new(knob_x, track.center().y - 9.0, 18.0, 18.0),
                    9.0,
                    if *checked {
                        theme.palette.on_primary
                    } else {
                        theme.palette.outline
                    },
                    scale,
                );
                self.push_text(
                    label,
                    Rect::new(
                        track.right() + 8.0,
                        node.rect.center().y - theme.typography.body_medium.line_height / 2.0,
                        node.rect.width - 56.0,
                        theme.typography.body_medium.line_height,
                    ),
                    theme.typography.body_medium,
                    theme.palette.on_surface,
                    Align::Start,
                    node.clip,
                    scale,
                );
            }
            PaintData::Select {
                label,
                value,
                focused,
            } => {
                let label_style = theme.typography.label_large;
                self.push_text(
                    label,
                    Rect::new(
                        node.rect.x,
                        node.rect.y,
                        node.rect.width,
                        label_style.line_height,
                    ),
                    label_style,
                    theme.palette.on_surface_variant,
                    Align::Start,
                    node.clip,
                    scale,
                );
                let field_rect = Rect::new(
                    node.rect.x,
                    node.rect.y + label_style.line_height + 6.0,
                    node.rect.width,
                    theme.scaled(theme.sizes.input_height),
                );
                self.draw_rounded_rect(
                    field_rect,
                    theme.radius.control,
                    Some(theme.palette.surface_container_lowest),
                    Some((
                        theme.sizes.border_width,
                        if *focused {
                            theme.palette.focus_ring
                        } else {
                            theme.palette.outline_variant
                        },
                    )),
                    scale,
                );
                if *focused {
                    let ring = Rect::new(
                        field_rect.x - theme.sizes.focus_ring_offset,
                        field_rect.y - theme.sizes.focus_ring_offset,
                        field_rect.width + theme.sizes.focus_ring_offset * 2.0,
                        field_rect.height + theme.sizes.focus_ring_offset * 2.0,
                    );
                    self.stroke_rounded_rect(
                        ring,
                        theme.radius.control + theme.sizes.focus_ring_offset,
                        theme.sizes.focus_ring_width,
                        theme.palette.focus_ring,
                        scale,
                    );
                }
                self.push_text(
                    value,
                    Rect::new(
                        field_rect.x + 12.0,
                        field_rect.center().y - theme.typography.body_medium.line_height / 2.0,
                        field_rect.width - 44.0,
                        theme.typography.body_medium.line_height,
                    ),
                    theme.typography.body_medium,
                    theme.palette.on_surface,
                    Align::Start,
                    node.clip,
                    scale,
                );
                self.paint_icon(
                    IconName::ChevronDown,
                    Rect::new(
                        field_rect.right() - 28.0,
                        field_rect.center().y - 9.0,
                        18.0,
                        18.0,
                    ),
                    theme.palette.text_secondary,
                    scale,
                );
            }
            PaintData::Progress { value, label } => {
                let style = theme.typography.label_medium;
                let track_y = if label.is_some() {
                    let label_text = label.as_deref().unwrap_or_default();
                    self.push_text(
                        label_text,
                        Rect::new(
                            node.rect.x,
                            node.rect.y,
                            node.rect.width - 52.0,
                            style.line_height,
                        ),
                        style,
                        theme.palette.on_surface_variant,
                        Align::Start,
                        node.clip,
                        scale,
                    );
                    let percent = format!("{:.0}%", value * 100.0);
                    self.push_text(
                        &percent,
                        Rect::new(node.rect.x, node.rect.y, node.rect.width, style.line_height),
                        style,
                        theme.palette.on_surface_variant,
                        Align::End,
                        node.clip,
                        scale,
                    );
                    node.rect.y + style.line_height + 4.0
                } else {
                    node.rect.center().y - 3.0
                };
                let track = Rect::new(node.rect.x, track_y, node.rect.width, 6.0);
                self.fill_rounded_rect(track, 3.0, theme.palette.surface_container_highest, scale);
                let width = node.rect.width * value.clamp(0.0, 1.0);
                if width > 0.0 {
                    self.fill_rounded_rect(
                        Rect::new(track.x, track.y, width, 6.0),
                        3.0,
                        theme.palette.primary,
                        scale,
                    );
                }
            }
            PaintData::FormProgress { value, label } => {
                let style = theme.typography.label_medium;
                self.push_text(
                    label,
                    Rect::new(
                        node.rect.x,
                        node.rect.y,
                        node.rect.width - 52.0,
                        style.line_height,
                    ),
                    style,
                    theme.palette.on_surface_variant,
                    Align::Start,
                    node.clip,
                    scale,
                );
                let percent = format!("{:.0}%", value * 100.0);
                self.push_text(
                    &percent,
                    Rect::new(node.rect.x, node.rect.y, node.rect.width, style.line_height),
                    style,
                    theme.palette.on_surface,
                    Align::End,
                    node.clip,
                    scale,
                );
                let track = Rect::new(
                    node.rect.x,
                    node.rect.y + style.line_height + 6.0,
                    node.rect.width,
                    6.0,
                );
                self.fill_rounded_rect(track, 3.0, theme.palette.surface_container_highest, scale);
                let width = node.rect.width * value.clamp(0.0, 1.0);
                if width > 0.0 {
                    self.fill_rounded_rect(
                        Rect::new(track.x, track.y, width, 6.0),
                        3.0,
                        theme.palette.primary,
                        scale,
                    );
                }
            }
            PaintData::NavItem {
                icon,
                label,
                selected,
                vertical,
                expanded,
                hovered,
            } => {
                let color = if *selected {
                    theme.nav_selected_text()
                } else if *hovered {
                    theme.palette.on_surface
                } else {
                    theme.palette.on_surface_variant
                };
                if *hovered && !*selected {
                    self.fill_rounded_rect(
                        node.rect,
                        node.radius,
                        theme.palette.on_surface.with_alpha(0.06),
                        scale,
                    );
                }
                if *vertical && *expanded {
                    let icon_rect = Rect::new(
                        node.rect.x + 14.0,
                        node.rect.center().y - 9.0,
                        theme.sizes.icon,
                        theme.sizes.icon,
                    );
                    self.paint_icon(*icon, icon_rect, color, scale);
                    self.push_text(
                        label,
                        Rect::new(
                            icon_rect.right() + 12.0,
                            node.rect.center().y - theme.typography.label_medium.line_height / 2.0,
                            node.rect.right() - icon_rect.right() - 20.0,
                            theme.typography.label_medium.line_height,
                        ),
                        theme.typography.label_medium,
                        color,
                        Align::Start,
                        node.clip,
                        scale,
                    );
                } else if *vertical {
                    let icon_rect = Rect::new(
                        node.rect.center().x - theme.sizes.icon / 2.0,
                        node.rect.y + 12.0,
                        theme.sizes.icon,
                        theme.sizes.icon,
                    );
                    self.paint_icon(*icon, icon_rect, color, scale);
                    let style = theme.typography.label_medium;
                    self.push_text(
                        label,
                        Rect::new(
                            node.rect.x + 4.0,
                            icon_rect.bottom() + 4.0,
                            node.rect.width - 8.0,
                            style.line_height,
                        ),
                        style,
                        color,
                        Align::Center,
                        node.clip,
                        scale,
                    );
                } else {
                    let icon_rect = Rect::new(
                        node.rect.center().x - theme.sizes.icon_lg / 2.0,
                        node.rect.y + 10.0,
                        theme.sizes.icon_lg,
                        theme.sizes.icon_lg,
                    );
                    self.paint_icon(*icon, icon_rect, color, scale);
                    let style = theme.typography.label_medium;
                    self.push_text(
                        label,
                        Rect::new(
                            node.rect.x + 6.0,
                            icon_rect.bottom() + 2.0,
                            node.rect.width - 12.0,
                            style.line_height,
                        ),
                        style,
                        color,
                        Align::Center,
                        node.clip,
                        scale,
                    );
                }
            }
            PaintData::DataTable {
                columns,
                rows,
                widths,
                compact,
                selected,
                sort,
                sort_ascending,
                page,
                pages,
                scroll,
                total_rows,
                display_total,
                display_range,
                hover_column,
                hover_row,
                drag,
            } => {
                let header_height = theme.sizes.table_header_height;
                let row_height = if *compact {
                    theme.sizes.table_row_compact
                } else {
                    theme.scaled(theme.sizes.table_row_height)
                };
                let bulk_height = if selected.is_empty() { 0.0 } else { 40.0 };
                let footer_height = 48.0;
                let body_top = node.rect.y + header_height;
                let body_bottom = node.rect.bottom() - footer_height - bulk_height;
                let line_color = theme.palette.outline_variant;
                let body_clip = Rect::new(
                    node.rect.x,
                    body_top,
                    node.rect.width,
                    (body_bottom - body_top).max(0.0),
                )
                .intersect(&node.clip);
                let total_width: f32 = widths.iter().sum::<f32>().max(1.0);
                let scale_width = node.rect.width / total_width;
                let mut column_rects = Vec::with_capacity(widths.len());
                let mut x = node.rect.x;
                for width in widths {
                    let scaled = width * scale_width;
                    column_rects.push(Rect::new(x, node.rect.y, scaled, header_height));
                    x += scaled;
                }
                let remainder = *scroll % row_height;
                let mut y = body_top - remainder;
                for (row_index, row) in rows {
                    if y + row_height <= body_top {
                        y += row_height;
                        continue;
                    }
                    if y >= body_bottom {
                        break;
                    }
                    let visible_top = y.max(body_top);
                    let visible_bottom = (y + row_height).min(body_bottom);
                    let visible = Rect::new(
                        node.rect.x,
                        visible_top,
                        node.rect.width,
                        (visible_bottom - visible_top).max(0.0),
                    );
                    if selected.contains(row_index) {
                        self.fill_rounded_rect(
                            visible,
                            0.0,
                            theme.palette.secondary_container,
                            scale,
                        );
                    } else if *hover_row == Some(*row_index) {
                        self.fill_rounded_rect(
                            visible,
                            0.0,
                            theme.palette.surface_container_high,
                            scale,
                        );
                    } else if row_index % 2 == 1 {
                        self.fill_rounded_rect(
                            visible,
                            0.0,
                            theme.palette.surface_container_low.with_alpha(0.6),
                            scale,
                        );
                    }
                    if visible_bottom - 1.0 >= body_top {
                        self.fill_rounded_rect(
                            Rect::new(node.rect.x, visible_bottom - 1.0, node.rect.width, 1.0),
                            0.0,
                            line_color,
                            scale,
                        );
                    }
                    for (column_index, cell) in row.iter().enumerate() {
                        let Some(column) = columns.get(column_index) else {
                            break;
                        };
                        let rect = column_rects[column_index];
                        if let Some(variant) = column.tag {
                            let (bg, fg) = tag_colors(theme, variant);
                            let style = theme.typography.label_medium;
                            let text_width = measure_text(cell, style, rect.width - 32.0).width;
                            let chip = Rect::new(
                                rect.x + 16.0,
                                y + row_height / 2.0 - 12.0,
                                (text_width + 16.0).min(rect.width - 32.0).max(1.0),
                                24.0,
                            );
                            self.fill_rounded_rect(chip, theme.radius.xs, bg, scale);
                            self.push_text(
                                cell,
                                Rect::new(
                                    chip.x + 8.0,
                                    chip.y + chip.height / 2.0 - style.line_height / 2.0,
                                    chip.width - 16.0,
                                    style.line_height,
                                ),
                                style,
                                fg,
                                Align::Start,
                                body_clip,
                                scale,
                            );
                        } else {
                            let style = theme.typography.body_medium;
                            self.push_text(
                                cell,
                                Rect::new(
                                    rect.x + 16.0,
                                    y + row_height / 2.0 - style.line_height / 2.0,
                                    rect.width - 32.0,
                                    style.line_height,
                                ),
                                style,
                                theme.palette.on_surface,
                                match column.align {
                                    Align::End => Align::End,
                                    Align::Center => Align::Center,
                                    _ => Align::Start,
                                },
                                body_clip,
                                scale,
                            );
                        }
                    }
                    y += row_height;
                }
                self.fill_rounded_rect(
                    Rect::new(node.rect.x, node.rect.y, node.rect.width, header_height),
                    0.0,
                    theme.table_header_surface(),
                    scale,
                );
                self.fill_rounded_rect(
                    Rect::new(
                        node.rect.x,
                        node.rect.y + header_height - 1.0,
                        node.rect.width,
                        1.0,
                    ),
                    0.0,
                    line_color,
                    scale,
                );
                for (index, column) in columns.iter().enumerate() {
                    let rect = column_rects[index];
                    if *hover_column == Some(index) {
                        self.fill_rounded_rect(
                            Rect::new(rect.x, rect.y, rect.width, header_height),
                            0.0,
                            theme.palette.primary_container.with_alpha(0.35),
                            scale,
                        );
                    }
                    let label = if *sort == Some(index) {
                        format!(
                            "{} {}",
                            column.title,
                            if *sort_ascending { "↑" } else { "↓" }
                        )
                    } else {
                        column.title.clone()
                    };
                    let style = theme.typography.label_large;
                    self.push_text(
                        &label,
                        Rect::new(
                            rect.x + 16.0,
                            rect.y + header_height / 2.0 - style.line_height / 2.0,
                            rect.width - 32.0,
                            style.line_height,
                        ),
                        style,
                        theme.palette.on_surface_variant,
                        Align::Start,
                        node.clip,
                        scale,
                    );
                }
                if let Some(drag) = drag {
                    match drag.mode {
                        DataTableDragMode::Reorder => {
                            if let Some(source) = column_rects.get(drag.source) {
                                self.fill_rounded_rect(
                                    Rect::new(source.x, node.rect.y, source.width, header_height),
                                    0.0,
                                    theme.palette.surface_container_lowest.with_alpha(0.5),
                                    scale,
                                );
                            }
                            if let Some(target) = column_rects.get(drag.target) {
                                self.fill_rounded_rect(
                                    Rect::new(target.x, node.rect.y, target.width, header_height),
                                    0.0,
                                    theme.palette.primary_container.with_alpha(0.45),
                                    scale,
                                );
                            }
                            if let Some(source) = column_rects.get(drag.source) {
                                let ghost = Rect::new(
                                    drag.ghost_x - source.width / 2.0,
                                    node.rect.y - 4.0,
                                    source.width,
                                    header_height,
                                );
                                self.fill_rounded_rect(
                                    Rect::new(
                                        ghost.x + 2.0,
                                        ghost.y + 4.0,
                                        ghost.width,
                                        ghost.height,
                                    ),
                                    8.0,
                                    theme.palette.shadow.with_alpha(0.18),
                                    scale,
                                );
                                self.fill_rounded_rect(
                                    ghost,
                                    8.0,
                                    theme.palette.surface_container_lowest,
                                    scale,
                                );
                                self.draw_rounded_rect(
                                    ghost,
                                    8.0,
                                    None,
                                    Some((theme.sizes.border_width, theme.palette.outline_variant)),
                                    scale,
                                );
                                let style = theme.typography.label_large;
                                self.push_text(
                                    &columns[drag.source].title,
                                    Rect::new(
                                        ghost.x + 12.0,
                                        ghost.y + header_height / 2.0 - style.line_height / 2.0,
                                        ghost.width - 24.0,
                                        style.line_height,
                                    ),
                                    style,
                                    theme.palette.on_surface,
                                    Align::Start,
                                    node.clip,
                                    scale,
                                );
                            }
                        }
                        DataTableDragMode::Resize => {
                            if let Some(width) = drag.width_badge {
                                let label = format!("{width:.0}px");
                                let style = theme.typography.label_small;
                                let text_width = measure_text(&label, style, f32::INFINITY).width;
                                let badge = Rect::new(
                                    drag.ghost_x - text_width / 2.0 - 6.0,
                                    node.rect.y + header_height + 4.0,
                                    text_width + 12.0,
                                    20.0,
                                );
                                self.fill_rounded_rect(
                                    badge,
                                    theme.radius.xs,
                                    theme.palette.primary,
                                    scale,
                                );
                                self.push_text(
                                    &label,
                                    Rect::new(
                                        badge.x + 6.0,
                                        badge.y + 10.0 - style.line_height / 2.0,
                                        badge.width - 12.0,
                                        style.line_height,
                                    ),
                                    style,
                                    theme.palette.on_primary,
                                    Align::Center,
                                    node.clip,
                                    scale,
                                );
                            }
                        }
                    }
                }
                let footer_top = node.rect.bottom() - footer_height - bulk_height;
                if !selected.is_empty() {
                    let bulk = Rect::new(node.rect.x, footer_top, node.rect.width, bulk_height);
                    self.fill_rounded_rect(bulk, 0.0, theme.palette.primary_container, scale);
                    let style = theme.typography.label_medium;
                    self.push_text(
                        &format!("Выбрано: {}", selected.len()),
                        Rect::new(
                            bulk.x + 16.0,
                            bulk.y + bulk.height / 2.0 - style.line_height / 2.0,
                            bulk.width - 32.0,
                            style.line_height,
                        ),
                        style,
                        theme.palette.on_primary_container,
                        Align::Start,
                        node.clip,
                        scale,
                    );
                }
                let pagination = Rect::new(
                    node.rect.x,
                    footer_top + bulk_height,
                    node.rect.width,
                    footer_height,
                );
                self.fill_rounded_rect(
                    Rect::new(pagination.x, pagination.y, pagination.width, 1.0),
                    0.0,
                    line_color,
                    scale,
                );
                let style = theme.typography.label_medium;
                let range = display_range
                    .map(|(first, last, total)| format!("{first}–{last} из {total}"))
                    .or_else(|| {
                        display_total.map(|total| {
                            let size = rows.len().max(1);
                            let first = page * size + 1;
                            let last = (first + rows.len().saturating_sub(1)).min(total);
                            format!("{first}–{last} из {total}")
                        })
                    });
                let label = match range {
                    Some(range) => range,
                    None => format!(
                        "Стр. {} из {} · {} строк",
                        page + 1,
                        pages.max(&1),
                        total_rows
                    ),
                };
                self.push_text(
                    &label,
                    Rect::new(
                        pagination.x + 16.0,
                        pagination.y + pagination.height / 2.0 - style.line_height / 2.0,
                        (pagination.width - 32.0).max(0.0),
                        style.line_height,
                    ),
                    style,
                    theme.palette.on_surface_variant,
                    Align::Start,
                    node.clip,
                    scale,
                );
                let slots = ui_core::layout::pagination_slots(*page, *pages);
                let button = 28.0;
                let gap = 4.0;
                let total_width =
                    slots.len() as f32 * button + slots.len().saturating_sub(1) as f32 * gap;
                let mut x = (pagination.right() - 16.0 - total_width).max(pagination.x + 16.0);
                let y = pagination.y + (pagination.height - button) / 2.0;
                for slot in slots {
                    if slot == usize::MAX {
                        self.push_text(
                            "…",
                            Rect::new(x, y, button, button),
                            style,
                            theme.palette.on_surface_muted,
                            Align::Center,
                            node.clip,
                            scale,
                        );
                    } else {
                        let active = slot == *page;
                        if active {
                            self.fill_rounded_rect(
                                Rect::new(x, y, button, button),
                                6.0,
                                theme.palette.primary,
                                scale,
                            );
                        }
                        self.push_text(
                            &(slot + 1).to_string(),
                            Rect::new(x, y, button, button),
                            style,
                            if active {
                                theme.palette.on_primary
                            } else {
                                theme.palette.on_surface_variant
                            },
                            Align::Center,
                            node.clip,
                            scale,
                        );
                    }
                    x += button + gap;
                }
            }
            PaintData::Table {
                headers,
                rows,
                weights,
                striped,
                tag_column,
                tag_variant,
                compact,
                selected_row,
                sort_column,
                sort_ascending,
                page,
                pages,
            } => {
                let row_height = if *compact {
                    theme.sizes.table_row_compact
                } else {
                    theme.scaled(theme.sizes.table_row_height)
                };
                let header_height = theme.sizes.table_header_height;
                let total_weight: f32 = weights.iter().sum::<f32>().max(1.0);
                let mut column_x = node.rect.x;
                let widths: Vec<f32> = weights
                    .iter()
                    .map(|weight| node.rect.width * weight / total_weight)
                    .collect();
                let line_color = theme.palette.outline_variant;
                self.fill_rounded_rect(
                    Rect::new(node.rect.x, node.rect.y, node.rect.width, header_height),
                    0.0,
                    theme.table_header_surface(),
                    scale,
                );
                self.fill_rounded_rect(
                    Rect::new(
                        node.rect.x,
                        node.rect.y + header_height - 1.0,
                        node.rect.width,
                        1.0,
                    ),
                    0.0,
                    line_color,
                    scale,
                );
                for (index, header) in headers.iter().enumerate() {
                    let width = widths.get(index).copied().unwrap_or(0.0);
                    let label = if *sort_column == Some(index) {
                        format!("{} {}", header, if *sort_ascending { "↑" } else { "↓" })
                    } else {
                        header.clone()
                    };
                    self.push_text(
                        &label,
                        Rect::new(
                            column_x + 16.0,
                            node.rect.y + header_height / 2.0
                                - theme.typography.label_large.line_height / 2.0,
                            width - 32.0,
                            theme.typography.label_large.line_height,
                        ),
                        theme.typography.label_large,
                        theme.palette.on_surface_variant,
                        Align::Start,
                        node.clip,
                        scale,
                    );
                    column_x += width;
                }
                let mut y = node.rect.y + header_height;
                for (row_index, row) in rows.iter().enumerate() {
                    if *selected_row == Some(row_index) {
                        self.fill_rounded_rect(
                            Rect::new(node.rect.x, y, node.rect.width, row_height),
                            0.0,
                            theme.palette.secondary_container.with_alpha(0.7),
                            scale,
                        );
                    } else if *striped && row_index % 2 == 1 {
                        self.fill_rounded_rect(
                            Rect::new(node.rect.x, y, node.rect.width, row_height),
                            0.0,
                            theme.palette.surface_container_low.with_alpha(0.6),
                            scale,
                        );
                    }
                    self.fill_rounded_rect(
                        Rect::new(node.rect.x, y + row_height - 1.0, node.rect.width, 1.0),
                        0.0,
                        line_color,
                        scale,
                    );
                    let mut x = node.rect.x;
                    for (column, value) in row.iter().enumerate() {
                        let width = widths.get(column).copied().unwrap_or(0.0);
                        if Some(column) == *tag_column {
                            let (bg, fg) = tag_colors(theme, *tag_variant);
                            let style = theme.typography.label_medium;
                            let text_width = measure_text(value, style, width - 32.0).width;
                            let chip = Rect::new(
                                x + 16.0,
                                y + row_height / 2.0 - 12.0,
                                (text_width + 16.0).min(width - 32.0),
                                24.0,
                            );
                            self.fill_rounded_rect(chip, theme.radius.xs, bg, scale);
                            self.push_text(
                                value,
                                Rect::new(
                                    chip.x + 8.0,
                                    chip.y + chip.height / 2.0 - style.line_height / 2.0,
                                    chip.width - 16.0,
                                    style.line_height,
                                ),
                                style,
                                fg,
                                Align::Start,
                                node.clip,
                                scale,
                            );
                        } else {
                            self.push_text(
                                value,
                                Rect::new(
                                    x + 16.0,
                                    y + row_height / 2.0
                                        - theme.typography.body_medium.line_height / 2.0,
                                    width - 32.0,
                                    theme.typography.body_medium.line_height,
                                ),
                                theme.typography.body_medium,
                                theme.palette.on_surface,
                                Align::Start,
                                node.clip,
                                scale,
                            );
                        }
                        x += width;
                    }
                    y += row_height;
                }
                if let Some(page) = page {
                    let footer = Rect::new(node.rect.x, y, node.rect.width, 48.0);
                    self.fill_rounded_rect(
                        Rect::new(footer.x, footer.y, footer.width, 1.0),
                        0.0,
                        line_color,
                        scale,
                    );
                    let style = theme.typography.label_medium;
                    let label = format!("Стр. {} из {}", page + 1, pages.max(&1));
                    self.push_text(
                        &label,
                        Rect::new(
                            footer.x,
                            footer.center().y - style.line_height / 2.0,
                            footer.width,
                            style.line_height,
                        ),
                        style,
                        theme.palette.on_surface_variant,
                        Align::End,
                        node.clip,
                        scale,
                    );
                }
            }
            PaintData::Tag { label, variant } => {
                let (bg, fg) = tag_colors(theme, *variant);
                self.fill_rounded_rect(node.rect, theme.radius.xs, bg, scale);
                let style = theme.typography.label_medium;
                self.push_text(
                    label,
                    Rect::new(
                        node.rect.x + 8.0,
                        node.rect.center().y - style.line_height / 2.0,
                        node.rect.width - 16.0,
                        style.line_height,
                    ),
                    style,
                    fg,
                    Align::Start,
                    node.clip,
                    scale,
                );
            }
            PaintData::Icon { icon, color } => {
                self.paint_icon(*icon, node.rect, *color, scale);
            }
            PaintData::Link {
                label,
                color,
                hovered,
            } => {
                let color = if *hovered {
                    &theme.palette.primary_hover
                } else {
                    color
                };
                let style = theme.typography.body_medium;
                self.push_text(
                    label,
                    node.rect,
                    style,
                    *color,
                    Align::Start,
                    node.clip,
                    scale,
                );
                let width = measure_text(label, style, f32::INFINITY)
                    .width
                    .min(node.rect.width);
                self.fill_rounded_rect(
                    Rect::new(node.rect.x, node.rect.bottom() - 1.0, width, 1.0),
                    0.0,
                    *color,
                    scale,
                );
            }
            PaintData::IconButton {
                icon,
                variant,
                size,
                enabled,
                hovered,
                pressed,
                ..
            } => {
                let foreground = match variant {
                    ButtonVariant::Primary | ButtonVariant::Filled => theme.palette.on_primary,
                    ButtonVariant::Tonal => theme.palette.on_secondary_container,
                    ButtonVariant::Danger => theme.palette.on_error,
                    _ => theme.palette.primary,
                };
                let foreground = if *enabled {
                    foreground
                } else {
                    theme.palette.text_disabled
                };
                if *enabled && (*hovered || *pressed) {
                    self.fill_rounded_rect(
                        node.rect,
                        node.radius,
                        foreground.with_alpha(if *pressed { 0.12 } else { 0.08 }),
                        scale,
                    );
                }
                let icon_size = theme.sizes.icon;
                self.paint_icon(
                    *icon,
                    Rect::new(
                        node.rect.center().x - icon_size / 2.0,
                        node.rect.center().y - icon_size / 2.0,
                        icon_size,
                        icon_size,
                    ),
                    foreground,
                    scale,
                );
                let _ = size;
            }
            PaintData::Fab { icon } => {
                let icon_size = theme.sizes.icon_lg;
                self.paint_icon(
                    *icon,
                    Rect::new(
                        node.rect.center().x - icon_size / 2.0,
                        node.rect.center().y - icon_size / 2.0,
                        icon_size,
                        icon_size,
                    ),
                    theme.palette.on_primary,
                    scale,
                );
            }
            PaintData::Avatar {
                initials,
                background,
                foreground,
            } => {
                self.fill_rounded_rect(node.rect, node.rect.width / 2.0, *background, scale);
                let style = theme.typography.label_large;
                let width = measure_text(initials, style, f32::INFINITY).width;
                self.push_text(
                    initials,
                    Rect::new(
                        node.rect.center().x - width / 2.0,
                        node.rect.center().y - style.line_height / 2.0,
                        width + 1.0,
                        style.line_height,
                    ),
                    style,
                    *foreground,
                    Align::Start,
                    node.clip,
                    scale,
                );
            }
            PaintData::Spinner => {
                let radius = (node.rect.width.min(node.rect.height) / 2.0 - 2.0).max(1.0);
                let path = arc_path(
                    node.rect.center(),
                    radius,
                    -std::f32::consts::FRAC_PI_2,
                    std::f32::consts::PI * 1.25,
                );
                self.stroke_path(&path, 2.5, theme.palette.primary, scale);
            }
            PaintData::Skeleton { radius } => {
                self.fill_rounded_rect(
                    node.rect,
                    *radius,
                    theme.palette.surface_container_high,
                    scale,
                );
            }
            PaintData::Radio {
                label,
                checked,
                focused,
                hovered,
            } => {
                let size = theme.sizes.icon;
                let circle = Rect::new(node.rect.x, node.rect.center().y - size / 2.0, size, size);
                self.fill_rounded_rect(
                    circle,
                    size / 2.0,
                    theme.palette.surface_container_lowest,
                    scale,
                );
                self.draw_rounded_rect(
                    circle,
                    size / 2.0,
                    None,
                    Some((
                        theme.sizes.border_width,
                        if *checked || *hovered {
                            theme.palette.primary
                        } else {
                            theme.palette.outline
                        },
                    )),
                    scale,
                );
                if *checked {
                    self.fill_rounded_rect(
                        Rect::new(
                            circle.x + size * 0.28,
                            circle.y + size * 0.28,
                            size * 0.44,
                            size * 0.44,
                        ),
                        size * 0.22,
                        theme.palette.primary,
                        scale,
                    );
                }
                if *focused {
                    self.stroke_rounded_rect(
                        Rect::new(
                            circle.x - theme.sizes.focus_ring_offset,
                            circle.y - theme.sizes.focus_ring_offset,
                            circle.width + theme.sizes.focus_ring_offset * 2.0,
                            circle.height + theme.sizes.focus_ring_offset * 2.0,
                        ),
                        size / 2.0 + theme.sizes.focus_ring_offset,
                        theme.sizes.focus_ring_width,
                        theme.palette.focus_ring,
                        scale,
                    );
                }
                self.push_text(
                    label,
                    Rect::new(
                        circle.right() + 8.0,
                        node.rect.center().y - theme.typography.body_medium.line_height / 2.0,
                        node.rect.width - size - 8.0,
                        theme.typography.body_medium.line_height,
                    ),
                    theme.typography.body_medium,
                    theme.palette.on_surface,
                    Align::Start,
                    node.clip,
                    scale,
                );
            }
            PaintData::Slider { value, label } => {
                let style = theme.typography.label_medium;
                let track_y = if let Some(label) = label {
                    self.push_text(
                        label,
                        Rect::new(
                            node.rect.x,
                            node.rect.y,
                            node.rect.width - 48.0,
                            style.line_height,
                        ),
                        style,
                        theme.palette.on_surface_variant,
                        Align::Start,
                        node.clip,
                        scale,
                    );
                    let percent = format!("{:.0}%", value * 100.0);
                    self.push_text(
                        &percent,
                        Rect::new(node.rect.x, node.rect.y, node.rect.width, style.line_height),
                        style,
                        theme.palette.on_surface_variant,
                        Align::End,
                        node.clip,
                        scale,
                    );
                    node.rect.y + style.line_height + 10.0
                } else {
                    node.rect.center().y
                };
                let track = Rect::new(
                    node.rect.x + 9.0,
                    track_y - 3.0,
                    (node.rect.width - 18.0).max(1.0),
                    6.0,
                );
                self.fill_rounded_rect(track, 3.0, theme.palette.surface_container_highest, scale);
                let filled = track.width * value.clamp(0.0, 1.0);
                self.fill_rounded_rect(
                    Rect::new(track.x, track.y, filled, 6.0),
                    3.0,
                    theme.palette.primary,
                    scale,
                );
                self.fill_rounded_rect(
                    Rect::new(track.x + filled - 9.0, track.y - 6.0, 18.0, 18.0),
                    9.0,
                    theme.palette.primary,
                    scale,
                );
            }
            PaintData::Otp {
                value,
                length,
                focused,
            } => {
                let gap = 8.0;
                let box_width =
                    ((node.rect.width - gap * (*length as f32 - 1.0)) / *length as f32).max(20.0);
                let chars: Vec<char> = value.chars().collect();
                for index in 0..*length {
                    let box_rect = Rect::new(
                        node.rect.x + index as f32 * (box_width + gap),
                        node.rect.y,
                        box_width,
                        node.rect.height,
                    );
                    self.draw_rounded_rect(
                        box_rect,
                        theme.radius.control,
                        Some(theme.palette.surface_container_lowest),
                        Some((
                            theme.sizes.border_width,
                            if *focused {
                                theme.palette.focus_ring
                            } else {
                                theme.palette.outline_variant
                            },
                        )),
                        scale,
                    );
                    if let Some(character) = chars.get(index) {
                        let style = theme.typography.title_large;
                        let text = character.to_string();
                        let width = measure_text(&text, style, f32::INFINITY).width;
                        self.push_text(
                            &text,
                            Rect::new(
                                box_rect.center().x - width / 2.0,
                                box_rect.center().y - style.line_height / 2.0,
                                width + 1.0,
                                style.line_height,
                            ),
                            style,
                            theme.palette.on_surface,
                            Align::Start,
                            node.clip,
                            scale,
                        );
                    }
                }
            }
            PaintData::Divider { vertical } => {
                let rect = if *vertical {
                    Rect::new(node.rect.center().x, node.rect.y, 1.0, node.rect.height)
                } else {
                    Rect::new(node.rect.x, node.rect.center().y, node.rect.width, 1.0)
                };
                self.fill_rounded_rect(rect, 0.0, theme.palette.outline_variant, scale);
            }
        }
        for child in &node.children {
            self.paint_node(child, theme, scale, damage);
        }
        if node.scrollable && node.content_height > node.rect.height + 1.0 {
            let track_height = node.rect.height - 8.0;
            let ratio = (node.rect.height / node.content_height).clamp(0.08, 1.0);
            let thumb_height = (track_height * ratio).max(24.0);
            let max_offset = (node.content_height - node.rect.height).max(1.0);
            let thumb_y = node.rect.y
                + 4.0
                + (track_height - thumb_height) * (node.scroll_offset / max_offset);
            self.fill_rounded_rect(
                Rect::new(node.rect.right() - 5.0, thumb_y, 3.0, thumb_height),
                1.5,
                theme.palette.outline.with_alpha(0.55),
                scale,
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn push_text(
        &mut self,
        text: &str,
        rect: Rect,
        style: TextStyle,
        color: Color,
        align: Align,
        clip: Rect,
        scale: f32,
    ) {
        if text.is_empty() || rect.width <= 1.0 || rect.height <= 1.0 {
            return;
        }
        if rect.bottom() <= clip.y
            || rect.y >= clip.bottom()
            || rect.right() <= clip.x
            || rect.x >= clip.right()
        {
            return;
        }
        let measured = measure_text(text, style, rect.width).width;
        let width = measured.min(rect.width);
        let x = match align {
            Align::Center => rect.x + (rect.width - width) / 2.0,
            Align::End => rect.right() - width,
            _ => rect.x,
        };
        self.texts.push(TextCmd {
            text: text.to_string(),
            x,
            y: rect.y,
            width: rect.width.max(1.0),
            height: rect.height.max(1.0),
            style,
            color: color.to_rgba8(),
            clip,
        });
        let _ = scale;
    }

    fn draw_rounded_rect(
        &mut self,
        rect: Rect,
        radius: f32,
        fill: Option<Color>,
        stroke: Option<(f32, Color)>,
        scale: f32,
    ) {
        if let Some(fill) = fill {
            self.fill_rounded_rect(rect, radius, fill, scale);
        }
        if let Some((width, color)) = stroke {
            if width > 0.0 {
                let inset = width * 0.5;
                let inner = Rect::new(
                    rect.x + inset,
                    rect.y + inset,
                    (rect.width - width).max(0.0),
                    (rect.height - width).max(0.0),
                );
                self.stroke_rounded_rect(inner, (radius - inset).max(0.0), width, color, scale);
            }
        }
    }

    fn fill_rounded_rect(&mut self, rect: Rect, radius: f32, color: Color, scale: f32) {
        if rect.width <= 0.0 || rect.height <= 0.0 || color.a <= 0.0 {
            return;
        }
        let path = rounded_rect_path(rect, radius);
        self.fill_path(&path, color, scale);
    }

    fn stroke_rounded_rect(
        &mut self,
        rect: Rect,
        radius: f32,
        width: f32,
        color: Color,
        scale: f32,
    ) {
        if rect.width <= 0.0 || rect.height <= 0.0 || width <= 0.0 {
            return;
        }
        let path = rounded_rect_path(rect, radius);
        self.stroke_path(&path, width, color, scale);
    }

    fn fill_path(&mut self, path: &Path, color: Color, scale: f32) {
        let mut buffers: VertexBuffers<Point2, u32> = VertexBuffers::new();
        let mut tessellator = FillTessellator::new();
        let options = FillOptions::default();
        let result = tessellator.tessellate_path(
            path,
            &options,
            &mut BuffersBuilder::new(&mut buffers, |vertex: FillVertex| {
                let position = vertex.position();
                Point2 {
                    x: position.x,
                    y: position.y,
                }
            }),
        );
        if result.is_err() {
            return;
        }
        self.append_geometry(&buffers, color, scale);
    }

    fn stroke_path(&mut self, path: &Path, width: f32, color: Color, scale: f32) {
        let mut buffers: VertexBuffers<Point2, u32> = VertexBuffers::new();
        let mut tessellator = StrokeTessellator::new();
        let options = StrokeOptions::default()
            .with_line_width(width * scale)
            .with_tolerance(0.1);
        let result = tessellator.tessellate_path(
            path,
            &options,
            &mut BuffersBuilder::new(&mut buffers, |vertex: StrokeVertex| {
                let position = vertex.position();
                Point2 {
                    x: position.x,
                    y: position.y,
                }
            }),
        );
        if result.is_err() {
            return;
        }
        self.append_geometry(&buffers, color, scale);
    }

    fn append_geometry(&mut self, buffers: &VertexBuffers<Point2, u32>, color: Color, scale: f32) {
        let base = self.vertices.len() as u32;
        let rgba = color.to_linear_rgba();
        for vertex in &buffers.vertices {
            self.vertices.push(Vertex {
                position: [vertex.x * scale, vertex.y * scale],
                color: rgba,
            });
        }
        for index in &buffers.indices {
            self.indices.push(base + index);
        }
    }

    fn paint_icon(&mut self, icon: IconName, rect: Rect, color: Color, scale: f32) {
        let path = icon_path(icon, rect);
        self.stroke_path(&path, 1.8, color, scale);
    }

    fn paint_spinner(&mut self, rect: Rect, color: Color, scale: f32) {
        let radius = rect.width.min(rect.height) / 2.0;
        let center = rect.center();
        let path = arc_path(center, radius, -1.2, 1.8);
        self.stroke_path(&path, 2.0, color, scale);
    }
}

#[derive(Clone, Copy)]
struct Point2 {
    x: f32,
    y: f32,
}

fn rounded_rect_path(rect: Rect, radius: f32) -> Path {
    let radius = radius.min(rect.width / 2.0).min(rect.height / 2.0).max(0.0);
    let mut builder = Path::builder();
    if radius <= 0.5 {
        builder.begin(point(rect.x, rect.y));
        builder.line_to(point(rect.right(), rect.y));
        builder.line_to(point(rect.right(), rect.bottom()));
        builder.line_to(point(rect.x, rect.bottom()));
        builder.end(true);
        return builder.build();
    }
    let segments = 8;
    let corners = [
        (
            Point::new(rect.x + radius, rect.y + radius),
            std::f32::consts::PI,
            std::f32::consts::PI * 1.5,
        ),
        (
            Point::new(rect.right() - radius, rect.y + radius),
            -std::f32::consts::FRAC_PI_2,
            0.0,
        ),
        (
            Point::new(rect.right() - radius, rect.bottom() - radius),
            0.0,
            std::f32::consts::FRAC_PI_2,
        ),
        (
            Point::new(rect.x + radius, rect.bottom() - radius),
            std::f32::consts::FRAC_PI_2,
            std::f32::consts::PI,
        ),
    ];
    builder.begin(Point2::new(rect.x, rect.y + radius).into());
    for (center, start, end) in corners {
        for step in 1..=segments {
            let t = step as f32 / segments as f32;
            let angle = start + (end - start) * t;
            let x = center.x + radius * angle.cos();
            let y = center.y + radius * angle.sin();
            builder.line_to(point(x, y));
        }
    }
    builder.end(true);
    builder.build()
}

impl Point2 {
    fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
}

impl From<Point2> for lyon::math::Point {
    fn from(value: Point2) -> Self {
        point(value.x, value.y)
    }
}

fn arc_path(center: Point, radius: f32, start: f32, end: f32) -> Path {
    let mut builder = Path::builder();
    let segments = 12;
    builder.begin(point(
        center.x + radius * start.cos(),
        center.y + radius * start.sin(),
    ));
    for step in 1..=segments {
        let t = step as f32 / segments as f32;
        let angle = start + (end - start) * t;
        builder.line_to(point(
            center.x + radius * angle.cos(),
            center.y + radius * angle.sin(),
        ));
    }
    builder.end(false);
    builder.build()
}

fn polyline_path(points: &[Point]) -> Path {
    let mut builder = Path::builder();
    if let Some(first) = points.first() {
        builder.begin(point(first.x, first.y));
        for vertex in &points[1..] {
            builder.line_to(point(vertex.x, vertex.y));
        }
    }
    builder.end(false);
    builder.build()
}

fn icon_path(icon: IconName, rect: Rect) -> Path {
    let left = rect.x;
    let top = rect.y;
    let width = rect.width;
    let height = rect.height;
    let relative = |x: f32, y: f32| Point::new(left + width * x, top + height * y);
    match icon {
        IconName::Check => polyline_path(&[
            relative(0.2, 0.55),
            relative(0.43, 0.78),
            relative(0.82, 0.28),
        ]),
        IconName::ChevronDown => polyline_path(&[
            relative(0.25, 0.4),
            relative(0.5, 0.65),
            relative(0.75, 0.4),
        ]),
        IconName::ChevronRight => polyline_path(&[
            relative(0.4, 0.25),
            relative(0.65, 0.5),
            relative(0.4, 0.75),
        ]),
        IconName::Search => {
            let mut path = circle_path(relative(0.45, 0.45), width * 0.28);
            path = append_path(
                &path,
                &polyline_path(&[relative(0.66, 0.66), relative(0.85, 0.85)]),
            );
            path
        }
        IconName::User => {
            let head = circle_path(relative(0.5, 0.32), width * 0.18);
            let shoulders = arc_path(
                relative(0.5, 0.9),
                width * 0.34,
                std::f32::consts::PI,
                std::f32::consts::PI * 2.0,
            );
            append_path(&head, &shoulders)
        }
        IconName::Lock => {
            let body = rectangle_path(Rect::new(
                left + width * 0.25,
                top + height * 0.45,
                width * 0.5,
                height * 0.4,
            ));
            let shackle = arc_path(
                relative(0.5, 0.45),
                width * 0.18,
                std::f32::consts::PI,
                std::f32::consts::PI * 2.0,
            );
            append_path(&body, &shackle)
        }
        IconName::Folder => polyline_path(&[
            relative(0.12, 0.3),
            relative(0.38, 0.3),
            relative(0.46, 0.4),
            relative(0.88, 0.4),
            relative(0.88, 0.8),
            relative(0.12, 0.8),
            relative(0.12, 0.3),
        ]),
        IconName::Home => polyline_path(&[
            relative(0.15, 0.5),
            relative(0.5, 0.18),
            relative(0.85, 0.5),
            relative(0.85, 0.85),
            relative(0.15, 0.85),
            relative(0.15, 0.5),
        ]),
        IconName::Chart => append_path(
            &polyline_path(&[relative(0.2, 0.2), relative(0.2, 0.8)]),
            &append_path(
                &polyline_path(&[relative(0.5, 0.4), relative(0.5, 0.8)]),
                &polyline_path(&[relative(0.8, 0.55), relative(0.8, 0.8)]),
            ),
        ),
        IconName::Settings => {
            let outer = circle_path(relative(0.5, 0.5), width * 0.3);
            let inner = circle_path(relative(0.5, 0.5), width * 0.08);
            append_path(&outer, &inner)
        }
        IconName::Menu => append_path(
            &polyline_path(&[relative(0.2, 0.32), relative(0.8, 0.32)]),
            &append_path(
                &polyline_path(&[relative(0.2, 0.5), relative(0.8, 0.5)]),
                &polyline_path(&[relative(0.2, 0.68), relative(0.8, 0.68)]),
            ),
        ),
        IconName::Mail => append_path(
            &rectangle_path(Rect::new(
                left + width * 0.15,
                top + height * 0.28,
                width * 0.7,
                height * 0.44,
            )),
            &polyline_path(&[
                relative(0.15, 0.28),
                relative(0.5, 0.55),
                relative(0.85, 0.28),
            ]),
        ),
        IconName::Plus => append_path(
            &polyline_path(&[relative(0.5, 0.2), relative(0.5, 0.8)]),
            &polyline_path(&[relative(0.2, 0.5), relative(0.8, 0.5)]),
        ),
        IconName::ArrowRight => append_path(
            &polyline_path(&[relative(0.2, 0.5), relative(0.8, 0.5)]),
            &polyline_path(&[
                relative(0.58, 0.28),
                relative(0.8, 0.5),
                relative(0.58, 0.72),
            ]),
        ),
    }
}

fn circle_path(center: Point, radius: f32) -> Path {
    arc_path(center, radius, 0.0, std::f32::consts::PI * 2.0)
}

fn rectangle_path(rect: Rect) -> Path {
    rounded_rect_path(rect, 0.0)
}

fn append_path(a: &Path, b: &Path) -> Path {
    let mut builder = Path::builder();
    for event in a.iter() {
        builder = apply_event(builder, event);
    }
    for event in b.iter() {
        builder = apply_event(builder, event);
    }
    builder.build()
}

fn apply_event(
    mut builder: lyon::path::path::Builder,
    event: lyon::path::PathEvent,
) -> lyon::path::path::Builder {
    use lyon::path::PathEvent;
    match event {
        PathEvent::Begin { at } => {
            builder.begin(at);
        }
        PathEvent::Line { to, .. } => {
            builder.line_to(to);
        }
        PathEvent::Quadratic { ctrl, to, .. } => {
            builder.quadratic_bezier_to(ctrl, to);
        }
        PathEvent::Cubic {
            ctrl1, ctrl2, to, ..
        } => {
            builder.cubic_bezier_to(ctrl1, ctrl2, to);
        }
        PathEvent::End { close, .. } => {
            builder.end(close);
        }
    }
    builder
}

fn tag_colors(theme: &Theme, variant: TagVariant) -> (Color, Color) {
    match variant {
        TagVariant::Neutral => (
            theme.palette.surface_container_high,
            theme.palette.on_surface_variant,
        ),
        TagVariant::Primary => (
            theme.palette.primary_container,
            theme.palette.on_primary_container,
        ),
        TagVariant::Secondary => (
            theme.palette.secondary_container,
            theme.palette.on_secondary_container,
        ),
        TagVariant::Success => (
            theme.palette.success_container,
            theme.palette.on_success_container,
        ),
        TagVariant::Warning => (
            theme.palette.warning_container,
            theme.palette.on_warning_container,
        ),
        TagVariant::Error => (
            theme.palette.error_container,
            theme.palette.on_error_container,
        ),
        TagVariant::Info => (
            theme.palette.surface_container_highest,
            theme.palette.on_surface,
        ),
    }
}

pub fn window_size(node: &LayoutNode) -> Size {
    Size::new(node.rect.width, node.rect.height)
}

pub fn layout_bounds(tree: &LayoutTree) -> Rect {
    tree.root.rect
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(index: usize) -> TextKey {
        TextKey {
            text: format!("text {index}"),
            size: 16.0f32.to_bits(),
            line_height: 20.0f32.to_bits(),
            weight: 400,
            tracking: 0.0f32.to_bits(),
            width: 200.0f32.to_bits(),
            height: 20.0f32.to_bits(),
        }
    }

    fn command(width: f32) -> TextCmd {
        TextCmd {
            text: "resize".to_string(),
            x: 0.0,
            y: 0.0,
            width,
            height: 20.0,
            style: TextStyle::new(16.0, 20.0, ui_core::theme::FontWeight::Regular),
            color: [255, 255, 255, 255],
            clip: Rect::new(0.0, 0.0, 400.0, 40.0),
        }
    }

    #[test]
    fn fast_text_reuses_bucket_for_small_width_changes() {
        let first = TextKey::new(&command(100.0), 2.0, 32);
        let second = TextKey::new(&command(101.0), 2.0, 32);
        assert_eq!(first.width, second.width);
        let exact = TextKey::new(&command(101.0), 2.0, 0);
        assert_ne!(first.width, exact.width);
    }

    #[test]
    fn current_frame_keys_are_never_evicted() {
        let mut cache = TextCache::default();
        cache.begin_frame();
        for index in 0..(TEXT_CACHE_LIMIT + 64) {
            cache.entries.insert(
                key(index),
                TextEntry {
                    buffer: Buffer::new_empty(Metrics::new(16.0, 20.0)),
                    last_used: cache.frame,
                },
            );
        }
        cache.end_frame();
        assert_eq!(cache.entries.len(), TEXT_CACHE_LIMIT + 64);
        cache.begin_frame();
        cache.entries.insert(
            key(0),
            TextEntry {
                buffer: Buffer::new_empty(Metrics::new(16.0, 20.0)),
                last_used: cache.frame,
            },
        );
        cache.end_frame();
        assert_eq!(cache.entries.len(), TEXT_CACHE_LIMIT);
        assert!(cache.entries.contains_key(&key(0)));
    }
}
