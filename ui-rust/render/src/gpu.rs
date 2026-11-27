use crate::RenderError;

pub struct Gpu {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub backend: wgpu::Backend,
}

fn parse_backends(value: &str) -> Option<wgpu::Backends> {
    let mut backends = wgpu::Backends::empty();
    for part in value.split([',', '|', '+']) {
        let part = part.trim().to_ascii_lowercase();
        match part.as_str() {
            "" | "auto" | "primary" => backends |= wgpu::Backends::PRIMARY,
            "vulkan" | "vk" => backends |= wgpu::Backends::VULKAN,
            "gl" | "gles" | "opengl" => backends |= wgpu::Backends::GL,
            "metal" => backends |= wgpu::Backends::METAL,
            "dx12" | "d3d12" => backends |= wgpu::Backends::DX12,
            "all" => backends |= wgpu::Backends::all(),
            _ => return None,
        }
    }
    if backends.is_empty() {
        None
    } else {
        Some(backends)
    }
}

pub fn requested_backends() -> (Option<wgpu::Backends>, String) {
    match std::env::var("WGPU_BACKEND") {
        Ok(value) => match parse_backends(&value) {
            Some(backends) => (Some(backends), value),
            None => (None, format!("invalid WGPU_BACKEND={value}")),
        },
        Err(_) => (None, "auto".to_string()),
    }
}

fn create_gpu(backends: wgpu::Backends) -> Result<Gpu, RenderError> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
        apply_limit_buckets: false,
    }))
    .map_err(|error| RenderError::NoAdapter(format!("{backends:?}: {error}")))?;
    let info = adapter.get_info();
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("ui-render device"),
        ..Default::default()
    }))
    .map_err(|error| RenderError::Device(error.to_string()))?;
    let backend = info.backend;
    log::info!(
        "wgpu adapter: {} ({:?}, driver {})",
        info.name,
        backend,
        info.driver
    );
    Ok(Gpu {
        instance,
        adapter,
        device,
        queue,
        backend,
    })
}

pub fn init() -> Result<Gpu, RenderError> {
    let (explicit, label) = requested_backends();
    if let Some(backends) = explicit {
        return create_gpu(backends);
    }
    if label != "auto" {
        log::warn!("{label}; falling back to auto backend selection");
    }
    let attempts = [
        wgpu::Backends::VULKAN,
        wgpu::Backends::GL,
        wgpu::Backends::PRIMARY,
        wgpu::Backends::all(),
    ];
    let mut last = String::new();
    for backends in attempts {
        match create_gpu(backends) {
            Ok(gpu) => return Ok(gpu),
            Err(error) => last = error.to_string(),
        }
    }
    Err(RenderError::NoAdapter(last))
}
