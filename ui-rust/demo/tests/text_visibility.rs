use ui_core::damage::Damage;
use ui_core::geometry::{Rect, Size};
use ui_core::layout::{LayoutNode, PaintData};
use ui_core::theme::{Theme, ThemeMode};
use ui_core::ui::{Ui, UiEvent};
use ui_core::view::View;
use ui_core::widget::Widget;
use ui_demo::{DashboardVm, GalleryVm, User};
use ui_render::HeadlessRenderer;

fn nodes(node: &LayoutNode, out: &mut Vec<LayoutNode>) {
    out.push(node.clone());
    for child in &node.children {
        nodes(child, out);
    }
}

fn text_rects(root: &LayoutNode, viewport: Size) -> Vec<(Rect, Rect, String)> {
    let mut all = Vec::new();
    nodes(root, &mut all);
    all.into_iter()
        .filter_map(|node| match &node.paint {
            PaintData::Text { text, .. } if !text.trim().is_empty() => {
                let visible = node.rect.intersect(&node.clip);
                if node.rect.width < 8.0
                    || node.rect.height < 6.0
                    || visible.width <= 0.0
                    || visible.height <= 0.0
                {
                    return None;
                }
                let area = visible.width * visible.height;
                if area < node.rect.width * node.rect.height * 0.35 || area < 20.0 {
                    return None;
                }
                let viewport = Rect::new(0.0, 0.0, viewport.width, viewport.height);
                Some((node.rect.intersect(&viewport), node.clip, text.clone()))
            }
            _ => None,
        })
        .collect()
}

fn has_ink(pixels: &[u8], width: u32, rect: Rect, clip: Rect) -> (bool, usize) {
    let region = rect.intersect(&clip).intersect(&Rect::new(
        0.0,
        0.0,
        width as f32,
        pixels.len() as f32 / (width as f32 * 4.0),
    ));
    let x0 = region.x.floor().max(0.0) as u32;
    let y0 = region.y.floor().max(0.0) as u32;
    let x1 = (region.right().ceil() as u32).min(width);
    let height = pixels.len() as u32 / (width * 4);
    let y1 = (region.bottom().ceil() as u32).min(height);
    if x1 <= x0 || y1 <= y0 {
        return (false, 0);
    }
    let mut histogram = std::collections::HashMap::<[u8; 3], usize>::new();
    for y in y0..y1 {
        for x in x0..x1 {
            let index = ((y * width + x) * 4) as usize;
            *histogram
                .entry([pixels[index], pixels[index + 1], pixels[index + 2]])
                .or_default() += 1;
        }
    }
    let Some((background, _)) = histogram.iter().max_by_key(|(_, count)| *count) else {
        return (false, 0);
    };
    let mut ink = 0;
    for y in y0..y1 {
        for x in x0..x1 {
            let index = ((y * width + x) * 4) as usize;
            let dr = pixels[index] as i32 - background[0] as i32;
            let dg = pixels[index + 1] as i32 - background[1] as i32;
            let db = pixels[index + 2] as i32 - background[2] as i32;
            if dr * dr + dg * dg + db * db > 35 * 35 {
                ink += 1;
            }
        }
    }
    (ink >= 3, ink)
}

fn assert_text_visible(label: &str, root: &LayoutNode, pixels: &[u8], width: u32, viewport: Size) {
    let rects = text_rects(root, viewport);
    assert!(!rects.is_empty(), "{label}: no visible text nodes");
    let mut failures = Vec::new();
    for (rect, clip, text) in &rects {
        let (visible, ink) = has_ink(pixels, width, *rect, *clip);
        if !visible {
            failures.push(format!("{text:?} rect {rect:?} clip {clip:?} ink {ink}"));
        }
    }
    let ratio = 1.0 - failures.len() as f32 / rects.len() as f32;
    assert!(
        ratio >= 0.97,
        "{label}: text disappeared for {} of {} nodes: {:?}",
        failures.len(),
        rects.len(),
        &failures[..failures.len().min(8)]
    );
}

fn dashboard(mode: ThemeMode) -> (Ui, HeadlessRenderer) {
    let theme = Theme::from_mode(mode);
    let vm = DashboardVm::new(User::demo(), mode == ThemeMode::Dark);
    let mut ui = Ui::new(theme);
    ui.resize(Size::new(1440.0, 900.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let mut renderer = HeadlessRenderer::new(1440, 900).expect("renderer");
    let _ = renderer
        .render_damage(ui.tree().expect("tree"), ui.theme(), 1.0, ui.damage())
        .expect("frame");
    ui.clear_damage();
    (ui, renderer)
}

#[test]
fn text_survives_hover_damage() {
    for mode in [ThemeMode::Light, ThemeMode::Dark] {
        let (mut ui, mut renderer) = dashboard(mode);
        let tree = ui.tree().expect("tree").clone();
        let button = {
            fn find(node: &LayoutNode) -> Option<Rect> {
                if matches!(&node.paint, PaintData::Button { label, .. } if label == "Выйти") {
                    return Some(node.rect);
                }
                node.children.iter().find_map(find)
            }
            find(&tree.root).expect("logout")
        };
        ui.handle_event(UiEvent::PointerMove(button.center()));
        let _ = ui.layout();
        let damage = ui.damage();
        assert!(!damage.is_empty());
        let pixels = renderer
            .render_damage(ui.tree().expect("tree"), ui.theme(), 1.0, damage)
            .expect("hover frame");
        assert_text_visible(
            "hover",
            &ui.tree().expect("tree").root,
            &pixels,
            1440,
            Size::new(1440.0, 900.0),
        );
    }
}

#[test]
fn text_survives_scroll_and_resize() {
    let theme = Theme::dark();
    let vm = GalleryVm::new(true);
    vm.section.set(1);
    let mut ui = Ui::new(theme.clone());
    ui.resize(Size::new(1440.0, 900.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let mut renderer = HeadlessRenderer::new(1440, 900).expect("renderer");
    let _ = renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, Damage::full())
        .expect("base");
    ui.clear_damage();
    let center = ui_core::Point::new(850.0, 450.0);
    ui.handle_event(UiEvent::PointerMove(center));
    ui.handle_event(UiEvent::Wheel { delta: 320.0 });
    for _ in 0..12 {
        ui.frame();
        let _ = ui.layout();
        let damage = ui.damage();
        if !damage.is_empty() {
            let _ = renderer
                .render_damage(ui.tree().expect("tree"), ui.theme(), 1.0, damage)
                .expect("scroll frame");
            ui.clear_damage();
        }
    }
    let pixels = renderer
        .render_damage(ui.tree().expect("tree"), ui.theme(), 1.0, Damage::full())
        .expect("scrolled");
    assert_text_visible(
        "scroll",
        &ui.tree().expect("tree").root,
        &pixels,
        1440,
        Size::new(1440.0, 900.0),
    );

    ui.resize(Size::new(1180.0, 760.0));
    renderer.resize(1180, 760);
    let _ = ui.layout();
    let pixels = renderer
        .render_damage(ui.tree().expect("tree"), ui.theme(), 1.0, ui.damage())
        .expect("resized");
    assert_text_visible(
        "resize",
        &ui.tree().expect("tree").root,
        &pixels,
        1180,
        Size::new(1180.0, 760.0),
    );
}

#[test]
fn text_survives_fast_resize_mode() {
    let theme = Theme::light();
    let vm = DashboardVm::new(User::demo(), false);
    let mut ui = Ui::new(theme.clone());
    ui.resize(Size::new(1440.0, 900.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let mut renderer = HeadlessRenderer::new(1440, 900).expect("renderer");
    renderer.set_fast_text(true);
    let _ = renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, Damage::full())
        .expect("base");
    for (width, height) in [(1400u32, 880u32), (1340, 830), (1280, 800)] {
        ui.resize(Size::new(width as f32, height as f32));
        renderer.resize(width, height);
        let _ = ui.layout();
        let _ = renderer
            .render_damage(ui.tree().expect("tree"), ui.theme(), 1.0, ui.damage())
            .expect("fast frame");
        ui.clear_damage();
    }
    renderer.set_fast_text(false);
    let _ = ui.layout();
    let pixels = renderer
        .render_damage(ui.tree().expect("tree"), ui.theme(), 1.0, ui.damage())
        .expect("exact frame");
    assert_text_visible(
        "fast resize",
        &ui.tree().expect("tree").root,
        &pixels,
        1280,
        Size::new(1280.0, 800.0),
    );
}

#[test]
fn widget_text_is_not_clipped_by_tight_rects() {
    let widget = Widget::column(vec![
        Widget::button("Очень длинная подпись кнопки").width_px(120.0),
        Widget::text("Длинный текст, который должен переноситься, а не исчезать.").max_width(180.0),
    ])
    .padding_all(20.0)
    .gap(12.0);
    let theme = Theme::light();
    let tree = ui_core::layout::layout(
        &widget,
        Size::new(260.0, 300.0),
        &theme,
        &ui_core::LayoutOptions::empty(),
    );
    let mut renderer = HeadlessRenderer::new(260, 300).expect("renderer");
    let pixels = renderer.render(&tree, &theme, 1.0).expect("frame");
    assert_text_visible("tight", &tree.root, &pixels, 260, Size::new(260.0, 300.0));
}
