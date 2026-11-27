use ui_core::geometry::{Align, Edges, Justify, Length};
use ui_core::signal::Signal;
use ui_core::widget::{
    body_medium, body_small, hint, label_medium, title_small, ButtonVariant, IconName, NavItem,
    SurfaceTone, TagVariant, TextTone, Widget,
};
use ui_core::{responsive, view_model, Reactive};

use crate::auth::User;
use crate::projects::ProjectsState;

#[derive(ui_core::ViewModel)]
pub struct DashboardVm {
    pub user: User,
    #[reactive]
    pub tab: Reactive<usize>,
    #[reactive]
    pub dark: Reactive<bool>,
    pub logout: Signal<bool>,
    pub page_scroll: Signal<f32>,
    projects: ProjectsState,
}

impl DashboardVm {
    pub fn new(user: User, dark: bool) -> Self {
        Self {
            user,
            tab: Reactive::new(0),
            dark: Reactive::new(dark),
            logout: Signal::new(false),
            page_scroll: Signal::new(0.0),
            projects: ProjectsState::new(),
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
        let scroll_area = Widget::column(vec![content])
            .align(Align::Center)
            .width(Length::Fraction(1.0))
            .grow(1.0)
            .scrollable(self.page_scroll);
        let scroll_body = Widget::column(vec![
            Widget::spacer(57.0),
            scroll_area,
            Widget::spacer(64.0),
        ])
        .fill_viewport_height()
        .width(Length::Fraction(1.0));
        let top = Widget::column(vec![self.top_bar(), Widget::divider()])
            .gap(0.0)
            .width(Length::Fraction(1.0));
        let bottom_overlay = Widget::column(vec![bottom])
            .fill_viewport_height()
            .justify(Justify::End)
            .width(Length::Fraction(1.0));
        let main = Widget::stack(vec![scroll_body, top, bottom_overlay])
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

    pub fn load_projects_blocking(&self) {
        self.projects.load_blocking();
    }

    fn on_frame(&self) {
        self.projects.on_frame();
    }

    fn needs_frame(&self) -> bool {
        self.projects.needs_frame()
    }

    fn content(&self) -> Widget {
        if self.tab.get() == 1 {
            self.projects_content()
        } else {
            self.dashboard_content()
        }
    }

    fn dashboard_content(&self) -> Widget {
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

    fn projects_content(&self) -> Widget {
        let projects = &self.projects;
        let retry = projects.refresh_signal;
        let items = projects.items.get();
        let total = projects.total.get();
        let loading = projects.loading.get();
        let error = projects.error.get();
        let header = Widget::row(vec![
            Widget::column(vec![
                Widget::heading("Проекты", 2),
                Widget::text("Все проекты команды и их статусы")
                    .style(body_small())
                    .tone(TextTone::Secondary),
            ])
            .gap(4.0)
            .grow(1.0),
            Widget::button("Новый проект")
                .variant(ButtonVariant::Filled)
                .on_click(|| {}),
        ])
        .gap(16.0)
        .align(Align::End)
        .wrap();
        let search = Widget::text_field_plain("Поиск", projects.search)
            .placeholder("Название или владелец")
            .width_px(260.0);
        let status = Widget::select(
            "Статус",
            ProjectsState::status_options(),
            projects.status_index,
        )
        .width_px(180.0);
        let page_size = Widget::select(
            "Строк",
            ProjectsState::page_size_options(),
            projects.page_size_index,
        )
        .width_px(110.0);
        let refresh = projects.refresh_signal;
        let toolbar = Widget::row(vec![
            search,
            status,
            page_size,
            Widget::checkbox_signal("Плотно", projects.compact),
            Widget::checkbox_signal("Скролл в таблице", projects.internal_scroll),
            Widget::spacer(1.0).grow(1.0),
            Widget::button("Обновить")
                .variant(ButtonVariant::Outlined)
                .size(ui_core::widget::ControlSize::Small)
                .on_click(move || refresh.set(true)),
        ])
        .gap(12.0)
        .align(Align::End)
        .wrap();
        let body = if let Some(error) = error {
            Widget::card(vec![
                Widget::row(vec![
                    Widget::tag("Ошибка", TagVariant::Error),
                    Widget::text(error)
                        .style(body_small())
                        .tone(TextTone::Secondary),
                ])
                .gap(12.0)
                .wrap(),
                Widget::button("Повторить")
                    .variant(ButtonVariant::Outlined)
                    .size(ui_core::widget::ControlSize::Small)
                    .on_click(move || retry.set(true)),
            ])
            .gap(16.0)
            .padding_all(24.0)
        } else if loading && items.is_empty() {
            Widget::card(vec![
                Widget::row(vec![
                    Widget::spinner(),
                    Widget::text("Загрузка проектов…")
                        .style(body_medium())
                        .tone(TextTone::Secondary),
                ])
                .gap(12.0)
                .align(Align::Center),
                Widget::skeleton(14.0),
                Widget::skeleton(14.0),
                Widget::skeleton(14.0),
            ])
            .gap(12.0)
            .padding_all(24.0)
        } else if items.is_empty() {
            Widget::card(vec![
                Widget::glyph(IconName::Folder).icon_tone(TextTone::Secondary),
                Widget::text("Проектов не найдено").style(title_small()),
                Widget::text("Измените фильтры или создайте первый проект.")
                    .style(body_small())
                    .tone(TextTone::Secondary),
                Widget::button("Новый проект")
                    .variant(ButtonVariant::Filled)
                    .on_click(|| {}),
            ])
            .gap(12.0)
            .padding_all(24.0)
        } else {
            let rows = projects.rows();
            let pages = projects.pages();
            let range = projects.display_range();
            let table = Widget::data_table(
                ProjectsState::columns(),
                rows,
                projects.table_state(pages),
                if projects.internal_scroll.get() {
                    Some(420.0)
                } else {
                    None
                },
            )
            .total_rows(total)
            .display_range(range.0, range.1, range.2)
            .radius(0.0)
            .visible_when(responsive!(Xs => false, Xxl => true));
            let cards = Widget::grid(
                responsive!(Xs => 1usize, Md => 2, Xxl => 3),
                items
                    .iter()
                    .map(|project| {
                        Widget::card(vec![
                            Widget::row(vec![
                                Widget::text(project.name.clone())
                                    .style(label_medium())
                                    .tone(TextTone::Primary)
                                    .grow(1.0),
                                Widget::tag(project.status.label(), TagVariant::Primary),
                            ])
                            .gap(8.0)
                            .align(Align::Center)
                            .wrap(),
                            Widget::text(project.owner.clone())
                                .style(body_small())
                                .tone(TextTone::Secondary),
                            Widget::text(if project.tags.is_empty() {
                                "Без тегов".to_string()
                            } else {
                                project.tags.join(" · ")
                            })
                            .style(body_small())
                            .tone(TextTone::Tertiary),
                            Widget::row(vec![
                                Widget::text(crate::api::format_budget(project.budget))
                                    .style(label_medium()),
                                Widget::spacer(1.0).grow(1.0),
                                Widget::text(crate::api::format_date(project.created_at))
                                    .style(body_small())
                                    .tone(TextTone::Tertiary),
                            ])
                            .gap(8.0),
                        ])
                        .gap(10.0)
                        .padding_all(20.0)
                    })
                    .collect::<Vec<_>>(),
            )
            .gap(16.0)
            .visible_when(responsive!(Xs => true, Xxl => false));
            Widget::column(vec![
                Widget::row(vec![
                    Widget::text(format!("Найдено: {total}"))
                        .style(body_small())
                        .tone(TextTone::Secondary),
                    Widget::spacer(1.0).grow(1.0),
                    Widget::text(if loading {
                        "Обновление…"
                    } else {
                        "Данные silent-protocol"
                    })
                    .style(hint())
                    .tone(TextTone::Tertiary),
                ])
                .gap(8.0),
                table,
                cards,
            ])
            .gap(12.0)
        };
        Widget::column(vec![header, toolbar, body])
            .gap(20.0)
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
        .visible_when(responsive!(Xs => false, Xxl => true));
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
