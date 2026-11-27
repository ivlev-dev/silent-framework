use ui_core::damage::Damage;
use ui_core::geometry::Size;
use ui_core::signal::Signal;
use ui_core::theme::{TextStyle, Theme};
use ui_core::view_model::ViewModel;
use ui_core::{Ui, View, Widget};
use ui_render::HeadlessRenderer;

struct TestVm {
    first: Signal<String>,
    second: Signal<String>,
    font_size: Signal<f32>,
}

impl ViewModel for TestVm {
    fn view(&self) -> Widget {
        let size = self.font_size.get();
        Widget::column(vec![
            Widget::text(self.first.get()).style(TextStyle::new(
                size,
                size * 1.4,
                ui_core::theme::FontWeight::Regular,
            )),
            Widget::spacer(20.0),
            Widget::text(self.second.get()),
        ])
        .padding_all(24.0)
        .gap(16.0)
    }
}

#[test]
fn damage_is_partial_for_text_change() {
    let vm = TestVm {
        first: Signal::new("first".to_string()),
        second: Signal::new("second".to_string()),
        font_size: Signal::new(16.0),
    };
    let first = vm.first;
    let mut ui = Ui::new(Theme::light());
    ui.resize(Size::new(500.0, 300.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    assert!(ui.damage().full);
    let mut renderer = HeadlessRenderer::new(500, 300).expect("renderer");
    let theme = Theme::light();
    let pixels = renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, ui.damage())
        .expect("initial full frame");
    assert_eq!(pixels.len(), 500 * 300 * 4);
    ui.clear_damage();
    first.set("first changed value".to_string());
    let _ = ui.layout();
    let damage = ui.damage();
    assert!(!damage.full, "text change must damage a region");
    let partial_pixels = renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, damage)
        .expect("partial");
    let stats = renderer.stats();
    assert!(stats.rendered);
    assert!(!stats.full);
    assert!(stats.damage_pixels < 500 * 300);
    let full_pixels = renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, Damage::full())
        .expect("full");
    assert_eq!(
        partial_pixels, full_pixels,
        "partial redraw must match a full redraw"
    );
}

#[test]
fn idle_frame_is_skipped() {
    let vm = TestVm {
        first: Signal::new("a".to_string()),
        second: Signal::new("b".to_string()),
        font_size: Signal::new(16.0),
    };
    let mut ui = Ui::new(Theme::light());
    ui.resize(Size::new(320.0, 200.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let mut renderer = HeadlessRenderer::new(320, 200).expect("renderer");
    let theme = Theme::light();
    renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, ui.damage())
        .expect("first");
    ui.clear_damage();
    let _ = ui.layout();
    assert!(ui.damage().is_empty());
    let stats = renderer
        .render_offscreen_damage(ui.tree().expect("tree"), &theme, 1.0, ui.damage())
        .expect("idle");
    assert!(!stats.rendered);
    assert_eq!(stats.damage_pixels, 0);
}

#[test]
fn text_cache_reuses_and_invalidates() {
    let vm = TestVm {
        first: Signal::new("hello".to_string()),
        second: Signal::new("world".to_string()),
        font_size: Signal::new(16.0),
    };
    let first = vm.first;
    let font_size = vm.font_size;
    let mut ui = Ui::new(Theme::light());
    ui.resize(Size::new(320.0, 200.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let mut renderer = HeadlessRenderer::new(320, 200).expect("renderer");
    let theme = Theme::light();
    renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, ui.damage())
        .expect("first");
    let first_stats = renderer.stats();
    assert!(first_stats.text_shaped >= 2);
    ui.clear_damage();
    renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, Damage::full())
        .expect("second");
    let second_stats = renderer.stats();
    assert_eq!(
        second_stats.text_shaped, first_stats.text_shaped,
        "identical text must not be shaped again"
    );
    assert!(second_stats.text_cache_hits > 0);

    first.set("new text".to_string());
    let _ = ui.layout();
    renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, ui.damage())
        .expect("text change");
    let changed_stats = renderer.stats();
    assert!(changed_stats.text_shaped > second_stats.text_shaped);

    font_size.set(22.0);
    let _ = ui.layout();
    renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, ui.damage())
        .expect("style change");
    let style_stats = renderer.stats();
    assert!(
        style_stats.text_shaped > changed_stats.text_shaped,
        "style change must invalidate shaping"
    );

    ui.resize(Size::new(260.0, 200.0));
    let _ = ui.layout();
    renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, ui.damage())
        .expect("width change");
    let width_stats = renderer.stats();
    assert!(
        width_stats.text_shaped > style_stats.text_shaped,
        "width change must invalidate shaping"
    );
}
