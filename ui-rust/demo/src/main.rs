use std::error::Error;
use std::path::PathBuf;
use std::time::Instant;

use ui_core::damage::Damage;
use ui_core::layout::{layout, LayoutOptions};
use ui_core::layout::{LayoutNode, PaintData};
use ui_core::view_model::ViewModel;
use ui_core::{Container, Size, Theme, Ui, UiEvent, View};
use ui_demo::{AuthApi, DashboardVm, GalleryVm, LoginVm, User};
use ui_platform::DesktopConfig;
use ui_render::HeadlessRenderer;

#[derive(Default)]
struct Options {
    headless: bool,
    out: Option<PathBuf>,
    width: u32,
    height: u32,
    dashboard: bool,
    gallery: bool,
    section: usize,
    popover: usize,
    scroll: f32,
    tab: usize,
    dark: bool,
    bench: u32,
    perf: u32,
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
                let value = args
                    .next()
                    .ok_or("--screen требует login|dashboard|gallery")?;
                options.dashboard = value == "dashboard";
                options.gallery = value == "gallery";
                if !matches!(value.as_str(), "login" | "dashboard" | "gallery") {
                    return Err(format!("неизвестный экран: {value}").into());
                }
            }
            "--section" => {
                options.section = args
                    .next()
                    .ok_or("--section требует число")?
                    .parse()
                    .map_err(|_| "--section: ожидается число")?;
            }
            "--popover" => {
                options.popover = args
                    .next()
                    .ok_or("--popover требует число")?
                    .parse()
                    .map_err(|_| "--popover: ожидается число")?;
            }
            "--scroll" => {
                options.scroll = args
                    .next()
                    .ok_or("--scroll требует число")?
                    .parse()
                    .map_err(|_| "--scroll: ожидается число")?;
            }
            "--tab" => {
                options.tab = args
                    .next()
                    .ok_or("--tab требует число")?
                    .parse()
                    .map_err(|_| "--tab: ожидается число")?;
            }
            "--dark" => options.dark = true,
            "--bench" => {
                options.bench = args
                    .next()
                    .ok_or("--bench требует число кадров")?
                    .parse()
                    .map_err(|_| "--bench: ожидается число")?;
            }
            "--perf" => {
                options.perf = args
                    .next()
                    .unwrap_or_else(|| "120".to_string())
                    .parse()
                    .map_err(|_| "--perf: ожидается число")?;
            }
            "--help" | "-h" => {
                println!(
                    "ui-demo [--headless --out PATH] [--screen login|dashboard] [--dark] \
                     [--width N --height N] [--bench N] [--perf N] [--section N] [--popover N] [--scroll N]\n\
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
    if options.perf > 0 {
        run_perf(&container, &options)?;
    } else if options.headless {
        render_headless(&container, &options)?;
    } else {
        let config = DesktopConfig {
            title: "Silent UI — Rust GPU".to_string(),
            width: 1120,
            height: 760,
            ..DesktopConfig::default()
        };
        if options.gallery {
            ui_platform::run(ui_demo::GalleryApp::new(), config)?;
        } else {
            ui_platform::run(ui_demo::DemoApp::new(container), config)?;
        }
    }
    Ok(())
}

fn percentile(values: &mut [f64], percentile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let index = ((values.len() as f64 - 1.0) * percentile).round() as usize;
    values[index.min(values.len() - 1)]
}

fn find_data_table(node: &LayoutNode) -> Option<(ui_core::Rect, usize)> {
    if let PaintData::DataTable { rows, .. } = &node.paint {
        if node.rect.width > 0.0 {
            return Some((node.rect, rows.len()));
        }
    }
    for child in &node.children {
        if let Some(found) = find_data_table(child) {
            return Some(found);
        }
    }
    None
}

fn find_button(node: &LayoutNode) -> Option<ui_core::Rect> {
    if matches!(&node.paint, PaintData::Button { .. }) && node.rect.width > 0.0 {
        return Some(node.rect);
    }
    for child in &node.children {
        if let Some(rect) = find_button(child) {
            return Some(rect);
        }
    }
    None
}

fn measure(
    ui: &mut Ui,
    renderer: &mut HeadlessRenderer,
    theme: &Theme,
    frames: usize,
    damage: Option<Damage>,
) -> (f64, f64, u64) {
    let mut timings = Vec::with_capacity(frames);
    let mut pixels = 0u64;
    for _ in 0..frames {
        let _ = ui.layout();
        let current = damage.unwrap_or_else(|| ui.damage());
        if current.is_empty() {
            timings.push(0.0);
            continue;
        }
        let tree = ui.tree().expect("tree");
        let started = Instant::now();
        let stats = renderer
            .render_offscreen_damage(tree, theme, 1.0, current)
            .expect("render");
        timings.push(started.elapsed().as_secs_f64() * 1000.0);
        pixels += stats.damage_pixels;
        ui.clear_damage();
    }
    let avg = timings.iter().sum::<f64>() / timings.len() as f64;
    let p99 = percentile(&mut timings, 0.99);
    (avg, p99, pixels)
}

fn run_perf(container: &Container, options: &Options) -> Result<(), Box<dyn std::error::Error>> {
    let frames = options.perf.max(1) as usize;
    for (width, height) in [(1440u32, 900u32), (3840, 2160)] {
        let theme = Theme::light();
        let auth = container.resolve_trait::<dyn AuthApi>()?;
        let vm = LoginVm::new(auth);
        let email = vm.email;
        let baseline = email.peek();
        let mut ui = Ui::new(theme.clone());
        ui.resize(Size::new(width as f32, height as f32));
        ui.set_view(View::new(vm));
        let _ = ui.layout();
        let mut renderer = HeadlessRenderer::new(width, height)?;
        let tree = ui.tree().expect("tree");
        let _ = renderer.render_offscreen_damage(tree, &theme, 1.0, ui.damage())?;
        ui.clear_damage();

        let mut idle_frames = 0usize;
        for _ in 0..frames {
            let _ = ui.layout();
            if !ui.damage().is_empty() {
                idle_frames += 1;
                ui.clear_damage();
            }
        }
        println!("perf {width}x{height} idle: rendered {idle_frames}/{frames} frames, damage 0 px");

        let (avg, p99, pixels) = {
            let mut timings = Vec::with_capacity(frames);
            let mut pixels = 0u64;
            for index in 0..frames {
                let next = format!("{baseline}{index}");
                email.set(next);
                let _ = ui.layout();
                let damage = ui.damage();
                let tree = ui.tree().expect("tree");
                let started = Instant::now();
                let stats = renderer
                    .render_offscreen_damage(tree, &theme, 1.0, damage)
                    .expect("render input");
                timings.push(started.elapsed().as_secs_f64() * 1000.0);
                pixels += stats.damage_pixels;
                ui.clear_damage();
            }
            let avg = timings.iter().sum::<f64>() / timings.len() as f64;
            let p99 = percentile(&mut timings, 0.99);
            (avg, p99, pixels)
        };
        println!(
            "perf {width}x{height} input: avg {avg:.2} ms, p99 {p99:.2} ms, damaged {:.0} px/frame",
            pixels as f64 / frames as f64
        );
        email.set(baseline.clone());
        let _ = ui.layout();
        ui.clear_damage();

        let button = {
            let tree = ui.tree().expect("tree");
            find_button(&tree.root).expect("login button")
        };
        let center = button.center();
        let (avg, p99, pixels) = {
            let mut timings = Vec::with_capacity(frames);
            let mut pixels = 0u64;
            for index in 0..frames {
                let point = if index % 2 == 0 {
                    center
                } else {
                    ui_core::Point::new(1.0, 1.0)
                };
                ui.handle_event(UiEvent::PointerMove(point));
                let _ = ui.layout();
                let damage = ui.damage();
                let tree = ui.tree().expect("tree");
                let started = Instant::now();
                let stats = renderer
                    .render_offscreen_damage(tree, &theme, 1.0, damage)
                    .expect("render hover");
                timings.push(started.elapsed().as_secs_f64() * 1000.0);
                pixels += stats.damage_pixels;
                ui.clear_damage();
            }
            let avg = timings.iter().sum::<f64>() / timings.len() as f64;
            let p99 = percentile(&mut timings, 0.99);
            (avg, p99, pixels)
        };
        println!(
            "perf {width}x{height} hover: avg {avg:.2} ms, p99 {p99:.2} ms, damaged {:.0} px/frame",
            pixels as f64 / frames as f64
        );

        let (avg, p99, pixels) = {
            let mut timings = Vec::with_capacity(frames);
            let mut pixels = 0u64;
            for _ in 0..frames {
                ui.handle_event(UiEvent::Wheel { delta: 40.0 });
                let _ = ui.layout();
                let damage = ui.damage();
                let tree = ui.tree().expect("tree");
                let started = Instant::now();
                let stats = renderer
                    .render_offscreen_damage(tree, &theme, 1.0, damage)
                    .expect("render scroll");
                timings.push(started.elapsed().as_secs_f64() * 1000.0);
                pixels += stats.damage_pixels;
                ui.clear_damage();
            }
            let avg = timings.iter().sum::<f64>() / timings.len() as f64;
            let p99 = percentile(&mut timings, 0.99);
            (avg, p99, pixels)
        };
        println!(
            "perf {width}x{height} scroll: avg {avg:.2} ms, p99 {p99:.2} ms, damaged {:.0} px/frame",
            pixels as f64 / frames as f64
        );

        let full = Damage::full();
        let (avg, p99, _) = measure(&mut ui, &mut renderer, &theme, frames, Some(full));
        println!(
            "perf {width}x{height} full: avg {avg:.2} ms, p99 {p99:.2} ms, damaged {} px/frame",
            width as u64 * height as u64
        );

        let gallery = GalleryVm::new(false);
        gallery.section.set(3);
        let mut table_ui = Ui::new(theme.clone());
        table_ui.resize(Size::new(width as f32, height as f32));
        table_ui.set_view(View::new(gallery));
        let _ = table_ui.layout();
        let _ = renderer.render_offscreen_damage(
            table_ui.tree().expect("tree"),
            &theme,
            1.0,
            table_ui.damage(),
        )?;
        let table = find_data_table(&table_ui.tree().expect("tree").root).expect("data table");
        table_ui.clear_damage();
        table_ui.handle_event(UiEvent::PointerMove(ui_core::Point::new(
            table.0.center().x,
            table.0.y + 120.0,
        )));
        let mut timings = Vec::with_capacity(frames);
        let mut pixels = 0u64;
        for _ in 0..frames {
            table_ui.handle_event(UiEvent::Wheel { delta: 480.0 });
            let _ = table_ui.layout();
            let damage = table_ui.damage();
            let tree = table_ui.tree().expect("tree");
            let started = Instant::now();
            let stats = renderer
                .render_offscreen_damage(tree, &theme, 1.0, damage)
                .expect("render table scroll");
            timings.push(started.elapsed().as_secs_f64() * 1000.0);
            pixels += stats.damage_pixels;
            table_ui.clear_damage();
        }
        let avg = timings.iter().sum::<f64>() / timings.len() as f64;
        let p99 = percentile(&mut timings, 0.99);
        let visible = find_data_table(&table_ui.tree().expect("tree").root)
            .map(|(_, rows)| rows)
            .unwrap_or(0);
        println!(
            "perf {width}x{height} table-10k-scroll: avg {avg:.2} ms, p99 {p99:.2} ms, damaged {:.0} px/frame, visible rows {visible}",
            pixels as f64 / frames as f64
        );
    }

    let theme = Theme::light();
    let auth = container.resolve_trait::<dyn AuthApi>()?;
    let vm = LoginVm::new(auth);
    let mut ui = Ui::new(theme.clone());
    ui.resize(Size::new(1440.0, 900.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let mut renderer = HeadlessRenderer::new(1440, 900)?;
    let _ = renderer.render_offscreen_damage(ui.tree().expect("tree"), &theme, 1.0, ui.damage())?;
    ui.clear_damage();
    let mut timings = Vec::with_capacity(24);
    for frame in 0..24 {
        let (width, height, scale) = if frame % 2 == 0 {
            (3840u32, 2160u32, 2.0f32)
        } else {
            (1440, 900, 1.0)
        };
        renderer.resize(width, height);
        ui.resize(Size::new(width as f32 / scale, height as f32 / scale));
        let started = Instant::now();
        let _ = ui.layout();
        let _ = renderer.render_offscreen_damage(
            ui.tree().expect("tree"),
            &theme,
            scale,
            Damage::full(),
        )?;
        ui.clear_damage();
        timings.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    let avg = timings.iter().sum::<f64>() / timings.len() as f64;
    let p99 = percentile(&mut timings, 0.99);
    println!(
        "perf resize 1440x900<->3840x2160 (scale 1/2): avg {avg:.2} ms, p99 {p99:.2} ms, cache {} entries",
        renderer.stats().text_cache_entries
    );
    Ok(())
}

fn render_headless(container: &Container, options: &Options) -> Result<(), Box<dyn Error>> {
    let theme = if options.dark {
        Theme::dark()
    } else {
        Theme::light()
    };
    let widget = if options.gallery {
        let vm = GalleryVm::new(options.dark);
        vm.section.set(options.section.min(5));
        vm.popover.set(options.popover.min(5));
        vm.page_scroll.set(options.scroll.max(0.0));
        vm.view()
    } else if options.dashboard {
        let vm = DashboardVm::new(User::demo(), options.dark);
        vm.tab.set(options.tab.min(3));
        vm.page_scroll.set(options.scroll.max(0.0));
        if options.tab == 1 {
            vm.load_projects_blocking();
        }
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
