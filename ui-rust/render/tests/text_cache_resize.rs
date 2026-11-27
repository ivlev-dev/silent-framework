use ui_core::damage::Damage;
use ui_core::geometry::Size;
use ui_core::layout::{layout, LayoutOptions};
use ui_core::theme::Theme;
use ui_core::widget::Widget;
use ui_render::HeadlessRenderer;

fn tree(cols: usize, width: f32, height: f32) -> ui_core::layout::LayoutTree {
    let rows = (0..1200)
        .map(|index| Widget::text(format!("row {index}")))
        .collect::<Vec<_>>();
    let widget = Widget::grid(ui_core::responsive!(Xs => cols), rows)
        .gap(4.0)
        .padding_all(12.0);
    layout(
        &widget,
        Size::new(width, height),
        &Theme::light(),
        &LayoutOptions::empty(),
    )
}

#[test]
fn text_cache_survives_resize_and_scale_changes() {
    let theme = Theme::light();
    let mut renderer = HeadlessRenderer::new(1440, 900).expect("renderer");
    let first_tree = tree(20, 1440.0, 900.0);
    renderer
        .render_damage(&first_tree, &theme, 1.0, Damage::full())
        .expect("first frame");
    let first = renderer.stats();
    assert!(first.text_shaped >= 1200);
    renderer
        .render_damage(&first_tree, &theme, 1.0, Damage::full())
        .expect("second frame");
    let second = renderer.stats();
    assert_eq!(second.text_shaped, first.text_shaped);
    assert!(second.text_cache_hits > 0);

    for (width, height, scale) in [
        (3840u32, 2160u32, 2.0f32),
        (1440, 900, 1.0),
        (3840, 2160, 2.0),
        (1920, 1080, 1.5),
        (1440, 900, 1.0),
    ] {
        renderer.resize(width, height);
        let logical = Size::new(width as f32 / scale, height as f32 / scale);
        let current = tree(20, logical.width, logical.height);
        renderer
            .render_damage(&current, &theme, scale, Damage::full())
            .expect("resize frame");
        let stats = renderer.stats();
        assert!(stats.rendered);
        assert!(stats.text_cache_entries <= 2048);
        renderer
            .render_damage(&current, &theme, scale, Damage::full())
            .expect("cached resize frame");
        let cached = renderer.stats();
        assert_eq!(cached.text_shaped, stats.text_shaped);
    }
}
