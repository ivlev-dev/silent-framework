use std::path::PathBuf;

use ui_core::layout::{layout, LayoutNode, LayoutOptions, LayoutTree, PaintData, Role};
use ui_core::theme::{Theme, ThemeMode};
use ui_core::view_model::ViewModel;
use ui_core::{Container, Size};
use ui_demo::{AuthApi, DashboardVm, GalleryVm, LoginVm, User};
use ui_render::headless::write_png;
use ui_render::HeadlessRenderer;

struct Frame {
    tree: LayoutTree,
    pixels: Vec<u8>,
    width: u32,
    theme: Theme,
}

fn render_dashboard(width: u32, height: u32, mode: ThemeMode) -> Frame {
    let theme = Theme::from_mode(mode);
    let vm = DashboardVm::new(User::demo(), mode == ThemeMode::Dark);
    let tree = layout(
        &vm.view(),
        Size::new(width as f32, height as f32),
        &theme,
        &LayoutOptions::empty(),
    );
    render_tree(tree, theme, width, height)
}

fn render_login(width: u32, height: u32, mode: ThemeMode) -> Frame {
    let theme = Theme::from_mode(mode);
    let container = Container::new();
    let auth = container.resolve_trait::<dyn AuthApi>().expect("auth");
    let vm = LoginVm::new(auth);
    let tree = layout(
        &vm.view(),
        Size::new(width as f32, height as f32),
        &theme,
        &LayoutOptions::empty(),
    );
    render_tree(tree, theme, width, height)
}

fn render_gallery(
    width: u32,
    height: u32,
    mode: ThemeMode,
    section: usize,
    popover: usize,
) -> Frame {
    let theme = Theme::from_mode(mode);
    let vm = GalleryVm::new(mode == ThemeMode::Dark);
    vm.section.set(section.min(5));
    vm.popover.set(popover.min(5));
    let tree = layout(
        &vm.view(),
        Size::new(width as f32, height as f32),
        &theme,
        &LayoutOptions::empty(),
    );
    render_tree(tree, theme, width, height)
}

fn render_tree(tree: LayoutTree, theme: Theme, width: u32, height: u32) -> Frame {
    let mut renderer = HeadlessRenderer::new(width, height).expect("headless renderer");
    let pixels = renderer.render(&tree, &theme, 1.0).expect("frame");
    Frame {
        tree,
        pixels,
        width,
        theme,
    }
}

fn pixel(frame: &Frame, x: f32, y: f32) -> [u8; 4] {
    let x = x as u32;
    let y = y as u32;
    let index = ((y * frame.width + x) * 4) as usize;
    [
        frame.pixels[index],
        frame.pixels[index + 1],
        frame.pixels[index + 2],
        frame.pixels[index + 3],
    ]
}

fn color_matches(pixel: [u8; 4], color: ui_core::Color) -> bool {
    let expected = color.to_rgba8();
    (pixel[0] as i32 - expected[0] as i32).abs() <= 2
        && (pixel[1] as i32 - expected[1] as i32).abs() <= 2
        && (pixel[2] as i32 - expected[2] as i32).abs() <= 2
}

fn cards<'a>(node: &'a LayoutNode, out: &mut Vec<&'a LayoutNode>) {
    if node.role == Role::Card && node.rect.width > 0.0 {
        out.push(node);
    }
    for child in &node.children {
        cards(child, out);
    }
}

fn tables<'a>(node: &'a LayoutNode, out: &mut Vec<&'a LayoutNode>) {
    if matches!(node.paint, PaintData::Table { .. }) && node.rect.width > 0.0 {
        out.push(node);
    }
    for child in &node.children {
        tables(child, out);
    }
}

fn nav_bars<'a>(node: &'a LayoutNode, out: &mut Vec<&'a LayoutNode>) {
    if node.role == Role::Navigation && node.rect.width > 0.0 && node.rect.height <= 64.5 {
        out.push(node);
    }
    for child in &node.children {
        nav_bars(child, out);
    }
}

fn assert_no_horizontal_overflow(node: &LayoutNode, width: f32) {
    if node.rect.width > 0.0 {
        assert!(
            node.rect.right() <= width + 0.5,
            "node {} overflows horizontally: {:?}",
            node.id,
            node.rect
        );
        assert!(node.rect.x >= -0.5, "node {} has negative x", node.id);
    }
    for child in &node.children {
        assert_no_horizontal_overflow(child, width);
    }
}

#[test]
fn dashboard_desktop_tokens_and_colors() {
    let frame = render_dashboard(1440, 900, ThemeMode::Light);
    let theme = &frame.theme;
    assert_eq!(frame.tree.viewport, Size::new(1440.0, 900.0));
    assert_no_horizontal_overflow(&frame.tree.root, 1440.0);
    let mut found_cards = Vec::new();
    cards(&frame.tree.root, &mut found_cards);
    assert!(found_cards.len() >= 5);
    assert_eq!(found_cards[0].radius, 16.0);
    let card = found_cards[0];
    assert!(color_matches(
        pixel(&frame, card.rect.x + 8.0, card.rect.y + 8.0),
        theme.card_surface()
    ));
    let mut found_tables = Vec::new();
    tables(&frame.tree.root, &mut found_tables);
    assert_eq!(found_tables.len(), 1);
    assert_eq!(found_tables[0].rect.height, 48.0 + 4.0 * 56.0);
    let page = pixel(&frame, 1435.0, 3.0);
    assert!(color_matches(page, theme.palette.page));
    let rail = frame.tree.root.children.first().expect("rail wrapper");
    assert_eq!(rail.rect.width, 260.0);
    assert_eq!(rail.rect.height, 900.0);
    assert!(color_matches(
        pixel(&frame, 4.0, 300.0),
        theme.rail_surface()
    ));
}

#[test]
fn dashboard_mobile_uses_bottom_navigation_and_no_overflow() {
    for mode in [ThemeMode::Light, ThemeMode::Dark] {
        let frame = render_dashboard(390, 844, mode);
        assert_no_horizontal_overflow(&frame.tree.root, 390.0);
        let rail_width = frame
            .tree
            .root
            .children
            .first()
            .map(|node| node.rect.width)
            .unwrap_or(0.0);
        assert!(rail_width < 1.0, "rail must be hidden on mobile");
        let mut bars = Vec::new();
        nav_bars(&frame.tree.root, &mut bars);
        assert!(!bars.is_empty(), "bottom navigation is missing");
        let bar = bars[0];
        assert_eq!(bar.rect.height, 64.0);
        assert!((bar.rect.bottom() - 844.0).abs() < 1.0);
        let mut found_tables = Vec::new();
        tables(&frame.tree.root, &mut found_tables);
        assert_eq!(found_tables[0].rect.height, 48.0 + 3.0 * 56.0);
    }
}

#[test]
fn dashboard_large_viewport_is_capped_by_content_max() {
    let frame = render_dashboard(1920, 1080, ThemeMode::Dark);
    assert_no_horizontal_overflow(&frame.tree.root, 1920.0);
    let mut widest: f32 = 0.0;
    let mut capped_group = false;
    fn visit(node: &LayoutNode, widest: &mut f32, capped_group: &mut bool) {
        if node.rect.width > 0.0 && node.id != 0 {
            if node.role == Role::Group && (node.rect.width - 1440.0).abs() < 0.5 {
                *capped_group = true;
            }
            if node.role != Role::Group && node.role != Role::Divider {
                *widest = widest.max(node.rect.width);
            }
        }
        for child in &node.children {
            visit(child, widest, capped_group);
        }
    }
    visit(&frame.tree.root, &mut widest, &mut capped_group);
    assert!(widest <= 1660.0, "content exceeds main width: {widest}");
    assert!(capped_group, "content column is not capped at 1440");
    let page = pixel(&frame, 1915.0, 3.0);
    assert!(color_matches(page, frame.theme.palette.page));
}

#[test]
fn login_card_spacing_and_metrics() {
    let frame = render_login(1440, 900, ThemeMode::Light);
    assert_no_horizontal_overflow(&frame.tree.root, 1440.0);
    let mut found_cards = Vec::new();
    cards(&frame.tree.root, &mut found_cards);
    assert_eq!(found_cards.len(), 1);
    let card = found_cards[0];
    assert_eq!(card.rect.width, 460.0);
    assert_eq!(card.radius, 16.0);
    assert!((card.rect.center().x - 720.0).abs() < 1.0);
    let fields: Vec<&LayoutNode> = Vec::new();
    let _ = fields;
    let text_fields: Vec<&LayoutNode> = {
        let mut out = Vec::new();
        fn collect<'a>(node: &'a LayoutNode, out: &mut Vec<&'a LayoutNode>) {
            if matches!(node.paint, PaintData::TextField { .. }) && node.rect.width > 0.0 {
                out.push(node);
            }
            for child in &node.children {
                collect(child, out);
            }
        }
        collect(&frame.tree.root, &mut out);
        out
    };
    assert_eq!(text_fields.len(), 2);
    assert!(text_fields[0].rect.y + text_fields[0].rect.height < text_fields[1].rect.y);
    let gap = text_fields[1].rect.y - (text_fields[0].rect.y + text_fields[0].rect.height);
    assert!((gap - 20.0).abs() < 1.5, "field gap is {gap}");
    assert!(color_matches(
        pixel(&frame, card.rect.x + 8.0, card.rect.y + 8.0),
        frame.theme.card_surface()
    ));
}

#[test]
fn headless_snapshots_are_written() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../screenshots");
    std::fs::create_dir_all(&dir).expect("screenshots dir");
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if entry.path().extension().and_then(|value| value.to_str()) == Some("png")
                && (name.starts_with("login-")
                    || name.starts_with("dashboard-")
                    || name.starts_with("gallery-"))
            {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let sizes = [
        (390u32, 844u32),
        (840, 900),
        (1440, 900),
        (1920, 1080),
        (3840, 2160),
    ];
    let modes = [("light", ThemeMode::Light), ("dark", ThemeMode::Dark)];
    let mut cases: Vec<(String, u32, u32, ThemeMode, Option<usize>)> = Vec::new();
    for (width, height) in sizes {
        for (mode_name, mode) in modes {
            cases.push((
                format!("dashboard-{width}x{height}-{mode_name}"),
                width,
                height,
                mode,
                None,
            ));
            cases.push((
                format!("login-{width}x{height}-{mode_name}"),
                width,
                height,
                mode,
                Some(usize::MAX),
            ));
            cases.push((
                format!("gallery-{width}x{height}-{mode_name}"),
                width,
                height,
                mode,
                Some(0),
            ));
        }
    }
    for section in 1..=5 {
        cases.push((
            format!("gallery-section-{section}-1440-dark"),
            1440,
            900,
            ThemeMode::Dark,
            Some(section),
        ));
    }
    for (name, width, height, mode, kind) in cases {
        let frame = match kind {
            Some(usize::MAX) => render_login(width, height, mode),
            Some(section) => render_gallery(width, height, mode, section, 0),
            None => render_dashboard(width, height, mode),
        };
        assert_eq!(frame.pixels.len(), (width * height * 4) as usize);
        let path = dir.join(format!("{name}.png"));
        write_png(&path, width, height, &frame.pixels).expect("write png");
        let metadata = std::fs::metadata(&path).expect("png metadata");
        assert!(metadata.len() > 4096);
    }
}
