use std::error::Error;
use std::path::PathBuf;
use std::time::Instant;

use ui_core::layout::{layout, LayoutOptions};
use ui_core::view_model::ViewModel;
use ui_core::{Container, Size, Theme};
use ui_demo::{AuthApi, DashboardVm, LoginVm, User};
use ui_platform::DesktopConfig;
use ui_render::HeadlessRenderer;

#[derive(Default)]
struct Options {
    headless: bool,
    out: Option<PathBuf>,
    width: u32,
    height: u32,
    dashboard: bool,
    dark: bool,
    bench: u32,
}

fn parse_options() -> Result<Options, Box<dyn Error>> {
    let mut options = Options {
        width: 1280,
        height: 800,
        ..Options::default()
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--headless" => options.headless = true,
            "--out" => {
                options.out = Some(PathBuf::from(args.next().ok_or("--out требует путь")?));
            }
            "--width" => {
                options.width = args
                    .next()
                    .ok_or("--width требует число")?
                    .parse()
                    .map_err(|_| "--width: ожидается число")?;
            }
            "--height" => {
                options.height = args
                    .next()
                    .ok_or("--height требует число")?
                    .parse()
                    .map_err(|_| "--height: ожидается число")?;
            }
            "--screen" => {
                let value = args.next().ok_or("--screen требует login|dashboard")?;
                options.dashboard = match value.as_str() {
                    "login" => false,
                    "dashboard" => true,
                    other => return Err(format!("неизвестный экран: {other}").into()),
                };
            }
            "--dark" => options.dark = true,
            "--bench" => {
                options.bench = args
                    .next()
                    .ok_or("--bench требует число кадров")?
                    .parse()
                    .map_err(|_| "--bench: ожидается число")?;
            }
            "--help" | "-h" => {
                println!(
                    "ui-demo [--headless --out PATH] [--screen login|dashboard] [--dark] \
                     [--width N --height N] [--bench N]\n\
                     env: WGPU_BACKEND=vulkan|gl|metal|dx12|auto"
                );
                std::process::exit(0);
            }
            other => return Err(format!("неизвестный аргумент: {other}").into()),
        }
    }
    Ok(options)
}

fn main() -> Result<(), Box<dyn Error>> {
    let options = parse_options()?;
    let container = Container::new();
    if options.headless {
        render_headless(&container, &options)?;
    } else {
        let config = DesktopConfig {
            title: "Silent UI — Rust GPU".to_string(),
            width: 1120,
            height: 760,
            ..DesktopConfig::default()
        };
        ui_platform::run(ui_demo::DemoApp::new(container), config)?;
    }
    Ok(())
}

fn render_headless(container: &Container, options: &Options) -> Result<(), Box<dyn Error>> {
    let theme = if options.dark {
        Theme::dark()
    } else {
        Theme::light()
    };
    let widget = if options.dashboard {
        let vm = DashboardVm::new(User::demo(), options.dark);
        vm.view()
    } else {
        let auth = container.resolve_trait::<dyn AuthApi>()?;
        let vm = LoginVm::new(auth);
        vm.view()
    };
    let size = Size::new(options.width as f32, options.height as f32);
    let mut renderer = HeadlessRenderer::new(options.width, options.height)?;
    if options.bench > 0 {
        let frames = options.bench.max(1);
        let mut total = 0.0f64;
        let mut worst = 0.0f64;
        for _ in 0..frames {
            let started = Instant::now();
            let tree = layout(&widget, size, &theme, &LayoutOptions::empty());
            renderer.render_offscreen(&tree, &theme, 1.0)?;
            let elapsed = started.elapsed().as_secs_f64() * 1000.0;
            total += elapsed;
            worst = worst.max(elapsed);
        }
        let average = total / frames as f64;
        println!(
            "bench: {} frames, avg {:.2} ms ({:.1} fps), worst {:.2} ms, backend {:?}",
            frames,
            average,
            1000.0 / average.max(0.001),
            worst,
            renderer.backend()
        );
    }
    let tree = layout(&widget, size, &theme, &LayoutOptions::empty());
    let path = options
        .out
        .clone()
        .unwrap_or_else(|| PathBuf::from("/tmp/ui-rust.png"));
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    renderer.save_png(&tree, &theme, 1.0, &path)?;
    println!(
        "headless: {}x{}, backend {:?}, nodes {}, saved {}",
        options.width,
        options.height,
        renderer.backend(),
        tree.node_count(),
        path.display()
    );
    Ok(())
}
