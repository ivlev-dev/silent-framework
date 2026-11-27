use ui_core::geometry::Size;
use ui_core::layout::{LayoutNode, PaintData};
use ui_core::ui::{Ui, UiEvent};
use ui_core::view::View;
use ui_core::view_model::ViewModel;
use ui_core::UiEvent::Wheel;
use ui_demo::{DashboardVm, GalleryVm, User};

fn scroll_node(node: &LayoutNode, out: &mut Option<(ui_core::Rect, f32)>) {
    if node.scrollable {
        *out = Some((node.rect, node.content_height));
    }
    for child in &node.children {
        scroll_node(child, out);
    }
}

#[test]
fn gallery_scrolls_content_and_shows_scrollbar() {
    let vm = GalleryVm::new(false);
    vm.section.set(1);
    let page_scroll = vm.page_scroll;
    let mut ui = Ui::new(ui_core::Theme::light());
    ui.resize(Size::new(1440.0, 900.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let mut info = None;
    scroll_node(&ui.tree().expect("tree").root, &mut info);
    let (rect, content) = info.expect("scroll area");
    assert!(content > rect.height);
    assert!(rect.y >= 57.0, "scroll viewport is below sticky top bar");
    ui.handle_event(UiEvent::PointerMove(ui_core::Point::new(
        rect.center().x,
        rect.center().y,
    )));
    ui.clear_damage();
    ui.handle_event(Wheel { delta: 200.0 });
    assert!(ui.needs_frame(), "wheel starts a smooth scroll");
    let mut samples = Vec::new();
    for _ in 0..12 {
        ui.frame();
        let _ = ui.layout();
        samples.push(page_scroll.peek());
    }
    assert!(samples.windows(2).all(|pair| pair[1] >= pair[0] - 0.01));
    assert!(page_scroll.peek() > 0.0);
    assert!(
        (page_scroll.peek() - 200.0).abs() < 0.5,
        "clamped to target"
    );
    ui.clear_damage();
    assert!(!ui.needs_frame(), "scroll animation stops in idle");
    let _ = ui.layout();
    let mut after = None;
    scroll_node(&ui.tree().expect("tree").root, &mut after);
    let (_, _, offset) = {
        fn find(node: &LayoutNode) -> Option<f32> {
            if node.scrollable {
                return Some(node.scroll_offset);
            }
            for child in &node.children {
                if let Some(value) = find(child) {
                    return Some(value);
                }
            }
            None
        }
        (0, 0, find(&ui.tree().expect("tree").root).expect("offset"))
    };
    assert!(offset > 0.0);
}

#[test]
fn gallery_scroll_screenshot() {
    for (name, mode) in [
        ("gallery-scroll-1440-light", ui_core::ThemeMode::Light),
        ("gallery-scroll-1440-dark", ui_core::ThemeMode::Dark),
    ] {
        let theme = ui_core::Theme::from_mode(mode);
        let vm = GalleryVm::new(mode == ui_core::ThemeMode::Dark);
        vm.section.set(1);
        vm.page_scroll.set(300.0);
        let tree = ui_core::layout::layout(
            &vm.view(),
            Size::new(1440.0, 900.0),
            &theme,
            &ui_core::LayoutOptions::empty(),
        );
        let mut renderer = ui_render::HeadlessRenderer::new(1440, 900).expect("renderer");
        let pixels = renderer.render(&tree, &theme, 1.0).expect("render");
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../screenshots");
        std::fs::create_dir_all(&dir).expect("screenshots dir");
        ui_render::headless::write_png(&dir.join(format!("{name}.png")), 1440, 900, &pixels)
            .expect("png");
    }
}

#[test]
fn gallery_screenshot_sections_fit_without_horizontal_overflow() {
    for section in 0..=5 {
        let vm = GalleryVm::new(true);
        vm.section.set(section);
        let theme = ui_core::Theme::dark();
        let tree = ui_core::layout::layout(
            &vm.view(),
            Size::new(390.0, 844.0),
            &theme,
            &ui_core::LayoutOptions::empty(),
        );
        fn check(node: &LayoutNode) {
            if node.rect.width > 0.0 {
                assert!(node.rect.x >= -0.5);
                assert!(node.rect.right() <= 390.5, "overflow: {:?}", node.rect);
            }
            for child in &node.children {
                check(child);
            }
        }
        check(&tree.root);
    }
}

fn describe(node: &LayoutNode) -> String {
    match &node.paint {
        ui_core::layout::PaintData::Text { text, .. } => format!("text {text:?}"),
        ui_core::layout::PaintData::Button { label, .. } => format!("button {label:?}"),
        other => format!("{:?} {other:?}", node.role),
    }
}

fn assert_children_contained(node: &LayoutNode, path: &str) {
    if node.scrollable {
        for child in &node.children {
            assert_children_contained(child, path);
        }
        return;
    }
    for child in &node.children {
        if child.rect.width > 0.5 && child.rect.height > 0.5 {
            let tolerance = 1.5;
            assert!(
                child.rect.x >= node.rect.x - tolerance
                    && child.rect.y >= node.rect.y - tolerance
                    && child.rect.right() <= node.rect.right() + tolerance
                    && child.rect.bottom() <= node.rect.bottom() + tolerance,
                "{}: child {:?} ({}) escapes parent {:?} {:?}",
                path,
                child.rect,
                describe(child),
                node.rect,
                node.role
            );
        }
        assert_children_contained(child, path);
    }
}

#[test]
fn gallery_children_stay_inside_parent_bounds() {
    for width in [390.0, 840.0, 1440.0, 1920.0] {
        let theme = ui_core::Theme::light();
        for section in 0..=5 {
            let vm = GalleryVm::new(false);
            vm.section.set(section);
            let tree = ui_core::layout::layout(
                &vm.view(),
                Size::new(width, 900.0),
                &theme,
                &ui_core::LayoutOptions::empty(),
            );
            assert_children_contained(&tree.root, &format!("{width}px section {section}"));
        }
    }
}

fn find_all<'a>(node: &'a LayoutNode, out: &mut Vec<&'a LayoutNode>) {
    out.push(node);
    for child in &node.children {
        find_all(child, out);
    }
}

#[test]
fn gallery_layout_uses_spacing_and_control_tokens() {
    let theme = ui_core::Theme::light();
    let vm = GalleryVm::new(false);
    vm.section.set(1);
    let tree = ui_core::layout::layout(
        &vm.view(),
        Size::new(1440.0, 900.0),
        &theme,
        &ui_core::LayoutOptions::empty(),
    );
    let mut nodes = Vec::new();
    find_all(&tree.root, &mut nodes);
    let cards: Vec<_> = nodes
        .iter()
        .filter(|node| node.role == ui_core::Role::Card)
        .collect();
    assert_eq!(cards.len(), 5, "forms section cards");
    let content_x = 261.0 + 32.0;
    let card_width = (1440.0 - 261.0 - 32.0 * 2.0 - 16.0) / 2.0;
    assert_eq!(cards[0].rect.x, content_x);
    assert_eq!(cards[0].rect.width, card_width);
    assert_eq!(cards[1].rect.x, content_x + card_width + 16.0);
    assert_eq!(
        cards[0].rect.x + theme.sizes.card_padding,
        cards[0].children[0].rect.x
    );
    let field = nodes
        .iter()
        .find(|node| matches!(node.paint, PaintData::TextField { .. }))
        .expect("text field");
    let expected =
        theme.typography.label_large.line_height + 6.0 + theme.scaled(theme.sizes.input_height);
    assert_eq!(field.rect.height, expected);
    assert_eq!(
        field.rect.width,
        card_width - theme.sizes.card_padding * 2.0
    );
}

#[test]
fn dashboard_children_stay_inside_parent_bounds() {
    for width in [390.0, 840.0, 1440.0, 1920.0] {
        let theme = ui_core::Theme::light();
        let vm = DashboardVm::new(User::demo(), false);
        let tree = ui_core::layout::layout(
            &vm.view(),
            Size::new(width, 900.0),
            &theme,
            &ui_core::LayoutOptions::empty(),
        );
        assert_children_contained(&tree.root, &format!("dashboard {width}px"));
    }
}

#[test]
fn gallery_controls_use_uniform_heights() {
    let theme = ui_core::Theme::light();
    let vm = GalleryVm::new(false);
    let tree = ui_core::layout::layout(
        &vm.view(),
        Size::new(1440.0, 900.0),
        &theme,
        &ui_core::LayoutOptions::empty(),
    );
    let mut nodes = Vec::new();
    find_all(&tree.root, &mut nodes);
    let height = |label: &str| {
        nodes
            .iter()
            .find_map(|node| match &node.paint {
                PaintData::Button {
                    label: value, size, ..
                } if value == label => Some((node.rect.height, *size)),
                _ => None,
            })
            .unwrap_or_else(|| panic!("button {label}"))
    };
    assert_eq!(height("Filled").0, theme.sizes.control_height);
    assert_eq!(height("Small").0, theme.sizes.control_height_sm);
    assert_eq!(height("Large").0, theme.sizes.control_height_lg);
}
