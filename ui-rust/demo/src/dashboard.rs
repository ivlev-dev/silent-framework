use ui_core::geometry::{Align, Edges, Length};
use ui_core::signal::Signal;
use ui_core::widget::{
    body_small, label_medium, title_small, ButtonVariant, IconName, NavItem, SurfaceTone,
    TagVariant, TextTone, Widget,
};
use ui_core::{responsive, view_model, Reactive};

use crate::auth::User;

#[derive(ui_core::ViewModel)]
pub struct DashboardVm {
    pub user: User,
    #[reactive]
    pub tab: Reactive<usize>,
    #[reactive]
    pub dark: Reactive<bool>,
    pub logout: Signal<bool>,
}

impl DashboardVm {
    pub fn new(user: User, dark: bool) -> Self {
        Self {
            user,
            tab: Reactive::new(0),
            dark: Reactive::new(dark),
            logout: Signal::new(false),
        }
    }
}

const SECTIONS: [(&str, &str); 4] = [
    ("Dashboard", "Сводка портфеля проектов и последние события"),
    ("Проекты", "Все проекты команды и их статусы"),
    ("Команда", "Участники и владельцы проектов"),
    ("Настройки", "Профиль, тема и плотность интерфейса"),
];

#[view_model]
impl DashboardVm {
    fn view(&self) -> Widget {
        let tab = self.tab;
        let rail_items = self.nav_items();
        let rail = Widget::column(vec![
            Widget::row(vec![
                brand_mark(),
                Widget::text("Silent Projects")
                    .style(title_small())
                    .tone(TextTone::Primary),
            ])
            .gap(10.0)
            .align(Align::Center),
            Widget::nav_rail(rail_items.clone(), self.tab)
                .expanded(true)
                .on_select(move |index| tab.set(index)),
        ])
        .surface(SurfaceTone::Rail)
        .padding(Edges::symmetric(12.0, 20.0))
        .gap(24.0)
        .width_px(260.0);
        let bottom_tab = self.tab;
        let bottom = Widget::column(vec![
            Widget::divider(),
            Widget::nav_bar(rail_items, self.tab)
                .on_select(move |index| bottom_tab.set(index))
                .height_px(64.0)
                .surface(SurfaceTone::Rail),
        ])
        .gap(0.0)
        .width(Length::Fraction(1.0))
        .pin_bottom()
        .visible_when(responsive!(Xs => true, Xl => false));
        let content = self.content();
        let main = Widget::column(vec![self.top_bar(), Widget::divider(), content, bottom])
            .gap(0.0)
            .align(Align::Center)
            .width(Length::Fraction(1.0))
            .fill_viewport_height()
            .grow(1.0);
        Widget::row(vec![
            rail.visible_when(responsive!(Xs => false, Xl => true)),
            Widget::vertical_divider().visible_when(responsive!(Xs => false, Xl => true)),
            main,
        ])
        .align(Align::Stretch)
        .gap(0.0)
    }

    fn nav_items(&self) -> Vec<NavItem> {
        vec![
            NavItem {
                icon: IconName::Home,
                label: "Dashboard".to_string(),
            },
            NavItem {
                icon: IconName::Folder,
                label: "Проекты".to_string(),
            },
            NavItem {
                icon: IconName::User,
                label: "Команда".to_string(),
            },
            NavItem {
                icon: IconName::Settings,
                label: "Настройки".to_string(),
            },
        ]
    }

    fn top_bar(&self) -> Widget {
        let logout = self.logout;
        let title = SECTIONS
            .get(self.tab.get())
            .map(|(title, _)| *title)
            .unwrap_or("Dashboard");
        let actions = Widget::row(vec![
            Widget::tag("Beta", TagVariant::Success)
                .visible_when(responsive!(Xs => false, Md => true)),
            Widget::spacer(1.0).grow(1.0),
            Widget::tag(self.user.name.clone(), TagVariant::Secondary)
                .visible_when(responsive!(Xs => false, Lg => true)),
            Widget::switch_signal("Тёмная тема", self.dark)
                .width_px(160.0)
                .visible_when(responsive!(Xs => false, Md => true)),
            Widget::switch_signal("", self.dark)
                .width_px(48.0)
                .visible_when(responsive!(Xs => true, Md => false)),
            Widget::button("Выйти")
                .variant(ButtonVariant::Text)
                .size(ui_core::widget::ControlSize::Small)
                .on_click(move || logout.set(true)),
        ])
        .gap(12.0)
        .align(Align::Center)
        .grow(1.0);
        Widget::row(vec![
            brand_mark().visible_when(responsive!(Xs => true, Xl => false)),
            Widget::text(title)
                .style(title_small())
                .tone(TextTone::Primary),
            actions,
        ])
        .height_px(56.0)
        .padding_responsive(responsive!(
            Xs => Edges::symmetric(16.0, 0.0),
            Md => Edges::symmetric(24.0, 0.0),
            Xl => Edges::symmetric(32.0, 0.0)
        ))
        .max_width(1440.0)
        .width(Length::Fraction(1.0))
        .gap(12.0)
        .align(Align::Center)
        .surface(SurfaceTone::Page)
    }

    fn content(&self) -> Widget {
        let tab = self.tab.get();
        let (title, description) = SECTIONS.get(tab).copied().unwrap_or(SECTIONS[0]);
        let header = Widget::row(vec![
            Widget::column(vec![
                Widget::heading(title, 2),
                Widget::text(description)
                    .style(body_small())
                    .tone(TextTone::Secondary)
                    .visible_when(responsive!(Xs => false, Md => true)),
            ])
            .gap(4.0)
            .grow(1.0),
            Widget::button("Все проекты")
                .variant(ButtonVariant::Outlined)
                .size(ui_core::widget::ControlSize::Medium),
        ])
        .gap(16.0)
        .align(Align::End)
        .wrap();
        let stats = self.stats();
        let table = self.table_card();
        Widget::column(vec![header, stats, table])
            .gap(24.0)
            .grow(1.0)
            .max_width(1440.0)
            .width(Length::Fraction(1.0))
            .padding_responsive(responsive!(
                Xs => Edges { top: 24.0, right: 16.0, bottom: 88.0, left: 16.0 },
                Md => Edges::symmetric(24.0, 24.0),
                Xl => Edges::symmetric(32.0, 24.0)
            ))
    }

    fn stats(&self) -> Widget {
        Widget::grid(
            responsive!(Xs => 2usize, Md => 2, Xxl => 4),
            vec![
                stat_card(
                    "Всего проектов",
                    "128",
                    "+12% за месяц",
                    IconName::Folder,
                    SurfaceTone::PrimaryContainer,
                    TextTone::Primary,
                    0.82,
                ),
                stat_card(
                    "В работе",
                    "42",
                    "33% портфеля",
                    IconName::Chart,
                    SurfaceTone::SuccessContainer,
                    TextTone::Primary,
                    0.66,
                ),
                stat_card(
                    "На ревью",
                    "9",
                    "Ждут решения",
                    IconName::Check,
                    SurfaceTone::WarningContainer,
                    TextTone::Primary,
                    0.24,
                ),
                stat_card(
                    "Завершено",
                    "77",
                    "60% портфеля",
                    IconName::ArrowRight,
                    SurfaceTone::SecondaryContainer,
                    TextTone::Primary,
                    0.6,
                ),
            ],
        )
        .gap(16.0)
    }

    fn table_card(&self) -> Widget {
        let header = Widget::row(vec![
            Widget::column(vec![
                Widget::text("Последние проекты")
                    .style(title_small())
                    .tone(TextTone::Primary),
                Widget::text("Обновлено только что")
                    .style(body_small())
                    .tone(TextTone::Secondary),
            ])
            .gap(2.0)
            .grow(1.0),
            Widget::tag("Live", TagVariant::Success)
                .visible_when(responsive!(Xs => false, Md => true)),
            Widget::button("Открыть все")
                .variant(ButtonVariant::Text)
                .size(ui_core::widget::ControlSize::Small)
                .visible_when(responsive!(Xs => false, Md => true)),
        ])
        .gap(12.0)
        .align(Align::Center);
        let rows = vec![
            vec![
                "Silent Framework".to_string(),
                "Ада Ловлейс".to_string(),
                "Активен".to_string(),
                "₽4.2M".to_string(),
            ],
            vec![
                "Silent Protocol".to_string(),
                "Грейс Хоппер".to_string(),
                "На ревью".to_string(),
                "₽1.8M".to_string(),
            ],
            vec![
                "Design System".to_string(),
                "Дитер Рамс".to_string(),
                "Активен".to_string(),
                "₽980K".to_string(),
            ],
            vec![
                "Kotlin Runtime".to_string(),
                "Барбара Лисков".to_string(),
                "Завершён".to_string(),
                "₽2.4M".to_string(),
            ],
        ];
        let desktop_table = Widget::table(
            vec![
                "Проект".to_string(),
                "Владелец".to_string(),
                "Статус".to_string(),
                "Бюджет".to_string(),
            ],
            rows.clone(),
        )
        .column_weights(vec![1.8, 1.4, 1.0, 0.9])
        .tag_column(2, TagVariant::Primary)
        .visible_when(responsive!(Xs => false, Xl => true));
        let mobile_rows = rows
            .iter()
            .take(3)
            .map(|row| vec![row[0].clone(), row[2].clone()])
            .collect();
        let mobile_table = Widget::table(
            vec!["Проект".to_string(), "Статус".to_string()],
            mobile_rows,
        )
        .column_weights(vec![1.6, 1.0])
        .tag_column(1, TagVariant::Primary)
        .visible_when(responsive!(Xs => true, Xl => false));
        Widget::card(vec![header, desktop_table, mobile_table])
            .padding_all(20.0)
            .gap(16.0)
    }
}

fn brand_mark() -> Widget {
    Widget::row(vec![Widget::text("S")
        .style(title_small())
        .tone(TextTone::OnPrimary)])
    .surface(SurfaceTone::Primary)
    .radius(8.0)
    .width_px(32.0)
    .height_px(32.0)
    .align(Align::Center)
    .justify(ui_core::geometry::Justify::Center)
}

fn stat_card(
    label: &str,
    value: &str,
    hint: &str,
    icon: IconName,
    surface: SurfaceTone,
    tone: TextTone,
    progress: f32,
) -> Widget {
    let icon_tile = Widget::row(vec![Widget::glyph(icon).icon_tone(tone)])
        .surface(surface)
        .radius(10.0)
        .width_px(38.0)
        .height_px(38.0)
        .align(Align::Center)
        .justify(ui_core::geometry::Justify::Center)
        .visible_when(responsive!(Xs => false, Md => true));
    Widget::card(vec![
        Widget::row(vec![
            Widget::text(label)
                .style(label_medium())
                .tone(TextTone::Secondary)
                .grow(1.0),
            icon_tile,
        ])
        .gap(12.0)
        .align(Align::Center),
        Widget::heading(value, 3),
        Widget::text(hint)
            .style(body_small())
            .tone(TextTone::Secondary),
        Widget::progress(progress).visible_when(responsive!(Xs => false, Md => true)),
    ])
    .padding_responsive(responsive!(
        Xs => Edges::all(16.0),
        Md => Edges::all(20.0)
    ))
    .gap(12.0)
    .width(Length::Fraction(1.0))
}
