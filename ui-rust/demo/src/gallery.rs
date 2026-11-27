use ui_core::form::Field;
use ui_core::geometry::{Align, Edges, Justify, Length};
use ui_core::signal::Signal;
use ui_core::widget::{
    body_medium, body_small, hint, label_large, label_medium, title_small, ButtonVariant,
    ControlSize, IconName, NavItem, SurfaceTone, TagVariant, TextTone, Widget,
};
use ui_core::{responsive, view_model, Reactive};

const SECTIONS: [&str; 6] = ["Обзор", "Формы", "Навигация", "Данные", "Оверлеи", "Медиа"];

#[derive(ui_core::ViewModel)]
pub struct GalleryVm {
    #[reactive]
    pub section: Reactive<usize>,
    #[reactive]
    pub dark: Reactive<bool>,
    name: Signal<String>,
    email: Signal<String>,
    bio: Signal<String>,
    number: Signal<String>,
    name_touched: Signal<bool>,
    name_errors: Signal<Vec<String>>,
    remember: Signal<bool>,
    notify: Signal<bool>,
    plan: Signal<usize>,
    radio: Signal<usize>,
    slider: Signal<f32>,
    otp: Signal<String>,
    tab: Signal<usize>,
    accordion: Signal<bool>,
    page: Signal<usize>,
    dense: Signal<bool>,
    pub dialog: Signal<bool>,
    pub popover: Signal<usize>,
    pub focus_request: Signal<Option<&'static str>>,
    pub page_scroll: Signal<f32>,
    data_rows: std::rc::Rc<Vec<Vec<String>>>,
    order: Signal<Vec<usize>>,
    widths: Signal<Vec<f32>>,
    selected_rows: Signal<Vec<usize>>,
    sort: Signal<Option<usize>>,
    sort_ascending: Signal<bool>,
    scroll: Signal<f32>,
}

impl GalleryVm {
    pub fn new(dark: bool) -> Self {
        Self {
            section: Reactive::new(0),
            dark: Reactive::new(dark),
            name: Signal::new("Ada Lovelace".to_string()),
            email: Signal::new("ada@silent.dev".to_string()),
            bio: Signal::new("Проектирую Silent UI и пишу GPU-рендерер.".to_string()),
            number: Signal::new("42".to_string()),
            name_touched: Signal::new(true),
            name_errors: Signal::new(Vec::new()),
            remember: Signal::new(true),
            notify: Signal::new(false),
            plan: Signal::new(1),
            radio: Signal::new(0),
            slider: Signal::new(0.62),
            otp: Signal::new("1234".to_string()),
            tab: Signal::new(0),
            accordion: Signal::new(true),
            page: Signal::new(0),
            dense: Signal::new(false),
            dialog: Signal::new(true),
            popover: Signal::new(0),
            focus_request: Signal::new(None),
            page_scroll: Signal::new(0.0),
            data_rows: std::rc::Rc::new(
                (0..10_000)
                    .map(|index| {
                        vec![
                            format!("Проект {}", index + 1),
                            ["Ада", "Грейс", "Дитер", "Барбара"][index % 4].to_string(),
                            ["Активен", "На ревью", "Завершён"][index % 3].to_string(),
                            format!("₽{:.1}M", 0.4 + (index % 50) as f32 * 0.1),
                        ]
                    })
                    .collect(),
            ),
            order: Signal::new(vec![0, 1, 2, 3]),
            widths: Signal::new(vec![320.0, 220.0, 180.0, 160.0]),
            selected_rows: Signal::new(vec![1]),
            sort: Signal::new(Some(0)),
            sort_ascending: Signal::new(true),
            scroll: Signal::new(0.0),
        }
    }
}

#[view_model]
impl GalleryVm {
    fn view(&self) -> Widget {
        let section = self.section;
        let nav_items: Vec<NavItem> = SECTIONS
            .iter()
            .enumerate()
            .map(|(index, title)| NavItem {
                icon: match index {
                    0 => IconName::Home,
                    1 => IconName::Settings,
                    2 => IconName::Menu,
                    3 => IconName::Chart,
                    4 => IconName::Plus,
                    _ => IconName::Folder,
                },
                label: (*title).to_string(),
            })
            .collect();
        let rail = Widget::column(vec![
            Widget::row(vec![
                brand_mark(),
                Widget::text("Silent Gallery")
                    .style(title_small())
                    .tone(TextTone::Primary),
            ])
            .gap(10.0)
            .align(Align::Center),
            Widget::nav_rail(nav_items.clone(), self.section)
                .expanded(true)
                .on_select(move |index| section.set(index)),
        ])
        .surface(SurfaceTone::Rail)
        .padding(Edges::symmetric(12.0, 20.0))
        .gap(24.0)
        .width_px(260.0);
        let bottom_section = self.section;
        let bottom = Widget::column(vec![
            Widget::divider(),
            Widget::nav_bar(nav_items, self.section)
                .on_select(move |index| bottom_section.set(index))
                .height_px(64.0)
                .surface(SurfaceTone::Rail),
        ])
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
        let shell = Widget::row(vec![
            rail.visible_when(responsive!(Xs => false, Xl => true)),
            Widget::vertical_divider().visible_when(responsive!(Xs => false, Xl => true)),
            main,
        ])
        .align(Align::Stretch)
        .gap(0.0)
        .fill_viewport_height();
        if self.popover.get() == 0 {
            shell
        } else {
            Widget::stack(vec![shell, self.popover_layer()]).height(Length::Fraction(1.0))
        }
    }

    fn popover_layer(&self) -> Widget {
        let close = self.popover;
        let kind = self.popover.get();
        let plan = self.plan;
        let panel = match kind {
            1 => Widget::card(vec![
                Widget::text("Выберите цвет").style(label_large()),
                Widget::grid(
                    responsive!(Xs => 6usize),
                    [
                        SurfaceTone::Primary,
                        SurfaceTone::SecondaryContainer,
                        SurfaceTone::SuccessContainer,
                        SurfaceTone::WarningContainer,
                        SurfaceTone::ErrorContainer,
                        SurfaceTone::Highest,
                    ]
                    .into_iter()
                    .map(|tone| Widget::spacer(28.0).surface(tone).radius(8.0))
                    .collect(),
                )
                .gap(8.0),
                Widget::row(vec![
                    Widget::tag("#D9D5CB", TagVariant::Primary),
                    Widget::tag("#17181B", TagVariant::Neutral),
                ])
                .gap(8.0),
            ])
            .padding_all(16.0)
            .gap(12.0)
            .width_px(320.0)
            .clickable(|| {}),
            2 => Widget::card(vec![
                Widget::text("Сентябрь 2026").style(label_large()),
                Widget::grid(
                    responsive!(Xs => 7usize),
                    (1..=28)
                        .map(|day| {
                            Widget::tag(
                                day.to_string(),
                                if day == 14 {
                                    TagVariant::Primary
                                } else {
                                    TagVariant::Neutral
                                },
                            )
                        })
                        .collect(),
                )
                .gap(6.0),
            ])
            .padding_all(16.0)
            .gap(12.0)
            .width_px(360.0)
            .clickable(|| {}),
            3 => Widget::card(vec![
                Widget::text("Select").style(label_large()),
                popover_option("Free", 0, plan, close),
                popover_option("Team", 1, plan, close),
                popover_option("Enterprise", 2, plan, close),
            ])
            .padding_all(12.0)
            .gap(6.0)
            .width_px(260.0)
            .clickable(|| {}),
            4 => Widget::card(vec![
                Widget::text("TreeSelect").style(label_large()),
                Widget::text("— Проекты").style(body_small()),
                Widget::text("   — Silent Framework").style(body_small()),
                Widget::text("   — Silent Protocol").style(body_small()),
                Widget::text("— Команда").style(body_small()),
            ])
            .padding_all(12.0)
            .gap(6.0)
            .width_px(280.0)
            .clickable(|| {}),
            _ => Widget::card(vec![
                Widget::text("Menu").style(label_large()),
                menu_item("Открыть"),
                menu_item("Дублировать"),
                menu_item("Удалить"),
            ])
            .padding_all(12.0)
            .gap(4.0)
            .width_px(220.0)
            .clickable(|| {}),
        };
        Widget::column(vec![panel])
            .fill_viewport_height()
            .justify(Justify::Center)
            .align(Align::Center)
            .surface(SurfaceTone::Scrim)
            .clickable(move || close.set(0))
    }

    fn top_bar(&self) -> Widget {
        let title = SECTIONS
            .get(self.section.get())
            .copied()
            .unwrap_or("Gallery");
        Widget::row(vec![
            brand_mark().visible_when(responsive!(Xs => true, Xl => false)),
            Widget::text("Silent Gallery")
                .style(title_small())
                .tone(TextTone::Primary),
            Widget::tag("GPU", TagVariant::Primary),
            Widget::spacer(1.0).grow(1.0),
            Widget::switch_signal("Тёмная тема", self.dark)
                .width_px(160.0)
                .visible_when(responsive!(Xs => false, Md => true)),
            Widget::switch_signal("", self.dark)
                .width_px(48.0)
                .visible_when(responsive!(Xs => true, Md => false)),
            Widget::tag(title, TagVariant::Info).visible_when(responsive!(Xs => false, Md => true)),
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
        let section = self.section.get();
        let body = match section {
            1 => self.forms_section(),
            2 => self.navigation_section(),
            3 => self.data_section(),
            4 => self.overlays_section(),
            5 => self.media_section(),
            _ => self.overview_section(),
        };
        Widget::column(vec![body])
            .gap(24.0)
            .grow(1.0)
            .max_width(1440.0)
            .width(Length::Fraction(1.0))
            .padding_responsive(responsive!(
                Xs => Edges::symmetric(16.0, 24.0),
                Md => Edges::symmetric(24.0, 24.0),
                Xl => Edges::symmetric(32.0, 24.0)
            ))
    }

    fn overview_section(&self) -> Widget {
        Widget::grid(
            responsive!(Xs => 1usize, Md => 2, Xl => 2, Xxl => 4),
            vec![
                section_card(
                    "Типографика",
                    "Text, Heading, Label, Link",
                    vec![
                        Widget::text("Body medium 16/1.55").style(body_medium()),
                        Widget::text("Body small 14/1.5")
                            .style(body_small())
                            .tone(TextTone::Secondary),
                        Widget::heading("Headline 24", 4),
                        Widget::text("LABEL 12 SEMIBOLD")
                            .style(label_medium())
                            .tone(TextTone::Tertiary),
                        Widget::link("Открыть документацию").link_click(|| {}),
                    ],
                ),
                section_card(
                    "Кнопки",
                    "filled / tonal / outlined / text",
                    vec![
                        Widget::row(vec![
                            Widget::button("Filled")
                                .variant(ButtonVariant::Filled)
                                .on_click(|| {}),
                            Widget::button("Tonal")
                                .variant(ButtonVariant::Tonal)
                                .on_click(|| {}),
                        ])
                        .gap(8.0)
                        .wrap(),
                        Widget::row(vec![
                            Widget::button("Outlined")
                                .variant(ButtonVariant::Outlined)
                                .on_click(|| {}),
                            Widget::button("Text").variant(ButtonVariant::Text),
                        ])
                        .gap(8.0)
                        .wrap(),
                        Widget::row(vec![
                            Widget::button("Small").size(ControlSize::Small),
                            Widget::button("Large").size(ControlSize::Large),
                            Widget::button("Loading").loading(true).enabled(false),
                        ])
                        .gap(8.0)
                        .wrap(),
                        Widget::row(vec![
                            Widget::icon_button(IconName::Search, "Поиск"),
                            Widget::icon_button(IconName::Settings, "Настройки"),
                            Widget::fab(IconName::Plus, "Добавить"),
                        ])
                        .gap(12.0)
                        .align(Align::Center),
                    ],
                ),
                section_card(
                    "Метки и статусы",
                    "Tag, Badge, Chip, Avatar",
                    vec![
                        Widget::row(vec![
                            Widget::tag("Default", TagVariant::Neutral),
                            Widget::tag("Primary", TagVariant::Primary),
                            Widget::tag("Success", TagVariant::Success),
                        ])
                        .gap(8.0)
                        .wrap(),
                        Widget::row(vec![
                            Widget::tag("Warning", TagVariant::Warning),
                            Widget::tag("Error", TagVariant::Error),
                            Widget::badge("Beta", TagVariant::Info),
                        ])
                        .gap(8.0)
                        .wrap(),
                        Widget::row(vec![
                            Widget::avatar("AL"),
                            Widget::avatar("GH").surface(SurfaceTone::SuccessContainer),
                            Widget::spinner(),
                        ])
                        .gap(12.0)
                        .align(Align::Center),
                        Widget::skeleton(14.0),
                        Widget::skeleton(14.0).width(Length::Fraction(0.6)),
                    ],
                ),
                section_card(
                    "Alert",
                    "Информационные сообщения",
                    vec![
                        alert(
                            "Обновление доступно",
                            "Silent UI 0.15 приносит новые токены плотности.",
                            SurfaceTone::PrimaryContainer,
                            IconName::Check,
                        ),
                        alert(
                            "Проверьте настройки",
                            "Некоторые поля требуют внимания.",
                            SurfaceTone::WarningContainer,
                            IconName::Settings,
                        ),
                        alert(
                            "Ошибка соединения",
                            "Повторите попытку позже.",
                            SurfaceTone::ErrorContainer,
                            IconName::Plus,
                        ),
                    ],
                ),
                section_card(
                    "Empty state",
                    "Пустые состояния",
                    vec![empty_state(
                        IconName::Folder,
                        "Пока нет проектов",
                        "Создайте первый проект, чтобы увидеть статистику.",
                    )],
                ),
                section_card(
                    "Popover / Menu",
                    "Top layer не обрезается карточкой",
                    vec![
                        Widget::row(vec![
                            popover_button("ColorPicker", 1, self.popover),
                            popover_button("DatePicker", 2, self.popover),
                        ])
                        .gap(8.0)
                        .wrap(),
                        Widget::row(vec![
                            popover_button("Select", 3, self.popover),
                            popover_button("TreeSelect", 4, self.popover),
                            popover_button("Menu", 5, self.popover),
                        ])
                        .gap(8.0)
                        .wrap(),
                    ],
                ),
                section_card(
                    "Card",
                    "Header, body, footer",
                    vec![Widget::card(vec![
                        Widget::text("Card header").style(label_large()),
                        Widget::text("Тело карточки с описанием и действиями.")
                            .style(body_small())
                            .tone(TextTone::Secondary),
                        Widget::divider(),
                        Widget::row(vec![
                            Widget::button("Отмена").variant(ButtonVariant::Text),
                            Widget::spacer(1.0).grow(1.0),
                            Widget::button("Сохранить").variant(ButtonVariant::Filled),
                        ])
                        .gap(8.0)
                        .wrap(),
                    ])
                    .gap(12.0)
                    .padding_all(16.0)],
                ),
            ],
        )
        .gap(16.0)
    }

    fn forms_section(&self) -> Widget {
        let name_field = Field::from_parts(
            "name",
            "Имя",
            self.name,
            self.name_touched,
            self.name_errors,
        );
        Widget::grid(
            responsive!(Xs => 1usize, Md => 2),
            vec![
                section_card(
                    "TextField",
                    "default / filled / error / disabled",
                    vec![
                        Widget::text_field(&name_field, "Имя")
                            .placeholder("Введите имя")
                            .key("gallery-name"),
                        Widget::text_field_plain("Email", self.email)
                            .placeholder("you@example.com")
                            .key("gallery-email"),
                        Widget::text_field_plain("Ошибка", self.email)
                            .help("Некорректный email")
                            .invalid(true),
                        Widget::text_field_plain("Disabled", self.email).enabled(false),
                        Widget::text_field_plain("Textarea", self.bio)
                            .multiline()
                            .help("Многострочное поле")
                            .key("gallery-bio"),
                        Widget::text_field_plain("Поиск", self.email)
                            .placeholder("Поиск по проектам")
                            .leading_icon(IconName::Search),
                    ],
                ),
                section_card(
                    "Select / Combobox / TreeSelect",
                    "Нативный select, combobox и дерево",
                    vec![
                        Widget::select(
                            "План",
                            vec![
                                "Free".to_string(),
                                "Team".to_string(),
                                "Enterprise".to_string(),
                            ],
                            self.plan,
                        ),
                        Widget::select(
                            "Combobox",
                            vec!["Любой".to_string(), "Активные".to_string()],
                            self.plan,
                        ),
                        Widget::select(
                            "TreeSelect",
                            vec![
                                "Все".to_string(),
                                "— Проекты".to_string(),
                                "— Команда".to_string(),
                            ],
                            self.plan,
                        ),
                        Widget::checkbox_signal("Запомнить меня", self.remember),
                        Widget::row(vec![
                            Widget::checkbox_signal("Email", self.remember),
                            Widget::checkbox_signal("Push", self.notify),
                        ])
                        .gap(16.0),
                        Widget::switch_signal("Уведомления", self.notify),
                    ],
                ),
                section_card(
                    "Radio / Slider / OTP",
                    "Выбор, диапазон и код",
                    vec![
                        Widget::radio("Стандарт", self.radio, 0),
                        Widget::radio("Компактно", self.radio, 1),
                        Widget::slider(self.slider, Some("Плотность".to_string())),
                        Widget::otp(self.otp, 4),
                        Widget::row(vec![
                            Widget::tag("design", TagVariant::Primary),
                            Widget::tag("gpu", TagVariant::Secondary),
                            Widget::tag("rust", TagVariant::Success),
                        ])
                        .gap(8.0),
                        Widget::text_field_plain("NumberField", self.number).placeholder("42"),
                    ],
                ),
                section_card(
                    "Progress + статусы",
                    "Секции формы и клик по статусу",
                    vec![
                        Widget::form_progress(0.5).form_label("Профиль"),
                        status_row(
                            "Основное",
                            "Заполнено",
                            TagVariant::Success,
                            "gallery-name",
                            self.focus_request,
                        ),
                        status_row(
                            "Email",
                            "Ошибка",
                            TagVariant::Error,
                            "gallery-email",
                            self.focus_request,
                        ),
                        status_row(
                            "Био",
                            "Пусто",
                            TagVariant::Neutral,
                            "gallery-bio",
                            self.focus_request,
                        ),
                    ],
                ),
                section_card(
                    "Field group / actions",
                    "Композиция формы",
                    vec![
                        Widget::text_field(&name_field, "Имя"),
                        Widget::text_field_plain("Email", self.email),
                        Widget::form_progress(0.6).form_label("Заполнено"),
                        Widget::row(vec![
                            Widget::button("Сбросить").variant(ButtonVariant::Text),
                            Widget::spacer(1.0).grow(1.0),
                            Widget::button("Сохранить")
                                .variant(ButtonVariant::Filled)
                                .on_click(|| {}),
                        ])
                        .gap(8.0)
                        .wrap(),
                    ],
                ),
            ],
        )
        .gap(16.0)
    }

    fn navigation_section(&self) -> Widget {
        let accordion = self.accordion;
        let page = self.page;
        let tabs = Widget::row(vec![
            tab_button("Обзор", 0, self.tab),
            tab_button("Проекты", 1, self.tab),
            tab_button("Команда", 2, self.tab),
        ])
        .gap(4.0)
        .wrap();
        let accordion_widget = Widget::card(vec![
            Widget::row(vec![
                Widget::text("Как работает damage-рендеринг?")
                    .style(label_large())
                    .grow(1.0),
                Widget::button("Показать")
                    .variant(ButtonVariant::Text)
                    .size(ControlSize::Small)
                    .on_click(move || accordion.update(|value| *value = !*value)),
            ])
            .align(Align::Center),
            Widget::text("Перерисовывается только объединённый грязный прямоугольник; idle не рендерит кадры.")
                .style(body_small())
                .tone(TextTone::Secondary)
                .visible_when(responsive_static(self.accordion.get())),
        ])
        .padding_all(16.0)
        .gap(12.0);
        Widget::grid(
            responsive!(Xs => 1usize, Md => 2),
            vec![
                section_card(
                    "Tabs / Breadcrumbs",
                    "Навигация внутри страницы",
                    vec![
                        tabs,
                        breadcrumbs(&["Главная", "Проекты", "Silent UI"]),
                        Widget::row(vec![
                            Widget::button("Назад")
                                .variant(ButtonVariant::Outlined)
                                .size(ControlSize::Small)
                                .on_click(move || {
                                    page.update(|value| *value = value.saturating_sub(1))
                                }),
                            Widget::button("Вперёд")
                                .variant(ButtonVariant::Outlined)
                                .size(ControlSize::Small)
                                .on_click(move || {
                                    page.update(|value| *value = (*value + 1).min(3))
                                }),
                        ])
                        .gap(8.0),
                        Widget::row(vec![
                            Widget::tag("1", TagVariant::Primary),
                            Widget::tag("2", TagVariant::Neutral),
                            Widget::tag("3", TagVariant::Neutral),
                        ])
                        .gap(6.0),
                    ],
                ),
                section_card(
                    "Accordion / List",
                    "Раскрывающиеся секции и список",
                    vec![
                        accordion_widget,
                        Widget::column(vec![
                            list_item(IconName::Folder, "Silent Framework", "12 задач"),
                            Widget::divider(),
                            list_item(IconName::User, "Ада Ловейс", "Owner"),
                            Widget::divider(),
                            list_item(IconName::Chart, "Dashboard", "Обновлено"),
                        ])
                        .gap(10.0),
                        Widget::button("Показать ещё").variant(ButtonVariant::Text),
                    ],
                ),
            ],
        )
        .gap(16.0)
    }

    fn data_section(&self) -> Widget {
        let dense = self.dense;
        let page = self.page;
        let toolbar = Widget::row(vec![
            Widget::text("DataTable").style(title_small()).grow(1.0),
            Widget::button(if self.dense.get() {
                "Compact"
            } else {
                "Comfortable"
            })
            .variant(ButtonVariant::Outlined)
            .size(ControlSize::Small)
            .on_click(move || dense.update(|value| *value = !*value)),
            Widget::button("Экспорт")
                .variant(ButtonVariant::Text)
                .size(ControlSize::Small),
        ])
        .gap(8.0)
        .align(Align::Center);
        let state = ui_core::widget::DataTableState {
            order: self.order,
            widths: self.widths,
            compact: self.dense,
            selected: self.selected_rows,
            sort: self.sort,
            sort_ascending: self.sort_ascending,
            page: self.page,
            pages: 4,
            scroll: self.scroll,
        };
        let table = Widget::data_table(
            vec![
                ui_core::widget::DataColumn {
                    title: "Проект".to_string(),
                    width: 320.0,
                    align: Align::Start,
                    tag: None,
                },
                ui_core::widget::DataColumn {
                    title: "Владелец".to_string(),
                    width: 220.0,
                    align: Align::Start,
                    tag: None,
                },
                ui_core::widget::DataColumn {
                    title: "Статус".to_string(),
                    width: 180.0,
                    align: Align::Start,
                    tag: Some(TagVariant::Primary),
                },
                ui_core::widget::DataColumn {
                    title: "Бюджет".to_string(),
                    width: 160.0,
                    align: Align::End,
                    tag: None,
                },
            ],
            self.data_rows.clone(),
            state,
            Some(360.0),
        );
        let empty = empty_state(
            IconName::Folder,
            "Нет данных",
            "Измените фильтры или создайте первый проект.",
        );
        let loading = Widget::column(vec![
            Widget::skeleton(16.0),
            Widget::skeleton(16.0),
            Widget::skeleton(16.0),
        ])
        .gap(12.0);
        Widget::column(vec![
            Widget::card(vec![toolbar, table])
                .gap(12.0)
                .padding_all(20.0),
            Widget::grid(
                responsive!(Xs => 1usize, Md => 2, Xl => 2, Xxl => 3),
                vec![
                    section_card(
                        "Selection / Sort",
                        "Сортировка и выбранная строка",
                        vec![
                            Widget::row(vec![
                                Widget::tag("selected row", TagVariant::Primary),
                                Widget::tag("sort name ↑", TagVariant::Info),
                                Widget::tag("pagination", TagVariant::Neutral),
                            ])
                            .gap(8.0)
                            .wrap(),
                            Widget::row(vec![
                                Widget::button("Стр. 1")
                                    .variant(ButtonVariant::Tonal)
                                    .size(ControlSize::Small)
                                    .on_click(move || page.set(0)),
                                Widget::button("Стр. 2")
                                    .variant(ButtonVariant::Outlined)
                                    .size(ControlSize::Small)
                                    .on_click(move || page.set(1)),
                                Widget::button("Стр. 3")
                                    .variant(ButtonVariant::Outlined)
                                    .size(ControlSize::Small)
                                    .on_click(move || page.set(2)),
                            ])
                            .gap(6.0),
                        ],
                    ),
                    section_card("Loading", "Skeleton-состояние", vec![loading]),
                    section_card(
                        "Empty / Error",
                        "Пусто и ошибка",
                        vec![
                            empty,
                            alert(
                                "Ошибка загрузки",
                                "Сервер недоступен.",
                                SurfaceTone::ErrorContainer,
                                IconName::Plus,
                            ),
                        ],
                    ),
                ],
            )
            .gap(16.0),
        ])
        .gap(16.0)
    }

    fn overlays_section(&self) -> Widget {
        let close = self.dialog;
        let open = self.dialog;
        let dialog_body = Widget::card(vec![
            Widget::row(vec![
                Widget::column(vec![
                    Widget::text("Dialog")
                        .style(title_small())
                        .tone(TextTone::Primary),
                    Widget::text("Оверлей поверх контента")
                        .style(body_small())
                        .tone(TextTone::Secondary),
                ])
                .gap(2.0)
                .grow(1.0),
                Widget::button("Закрыть")
                    .variant(ButtonVariant::Text)
                    .size(ControlSize::Small)
                    .on_click(move || close.set(false)),
            ])
            .align(Align::Center),
            Widget::divider(),
            Widget::text("Backdrop, фокус и Escape — в web; в Rust MVP показан визуальный слой.")
                .style(body_small()),
            Widget::row(vec![
                Widget::button("Отмена")
                    .variant(ButtonVariant::Text)
                    .on_click(move || close.set(false)),
                Widget::spacer(1.0).grow(1.0),
                Widget::button("Подтвердить").variant(ButtonVariant::Filled),
            ])
            .gap(8.0)
            .wrap(),
        ])
        .gap(14.0)
        .padding_all(20.0)
        .max_width(420.0)
        .width(Length::Fraction(1.0));
        let dialog_preview = if self.dialog.get() {
            Widget::stack(vec![
                Widget::column(vec![
                    Widget::row(vec![
                        Widget::text("Фоновый контент").style(label_large()),
                        Widget::spacer(1.0).grow(1.0),
                        Widget::tag("backdrop", TagVariant::Info),
                    ])
                    .align(Align::Center)
                    .wrap(),
                    Widget::skeleton(12.0),
                    Widget::skeleton(12.0),
                    Widget::skeleton(12.0),
                ])
                .gap(12.0)
                .padding_all(20.0)
                .surface(SurfaceTone::Card)
                .radius(16.0)
                .height_px(380.0),
                Widget::column(vec![dialog_body])
                    .height_px(380.0)
                    .justify(Justify::Center)
                    .align(Align::Center)
                    .surface(SurfaceTone::Scrim),
            ])
            .height_px(380.0)
        } else {
            Widget::card(vec![
                Widget::text("Dialog закрыт")
                    .style(body_medium())
                    .tone(TextTone::Secondary),
                Widget::button("Открыть диалог")
                    .variant(ButtonVariant::Filled)
                    .on_click(move || open.set(true)),
            ])
            .gap(12.0)
            .padding_all(20.0)
        };
        Widget::grid(
            responsive!(Xs => 1usize, Md => 2),
            vec![
                section_card("Dialog", "Модальный слой", vec![dialog_preview]),
                section_card(
                    "AlertDialog / Sheet",
                    "Подтверждение и нижний лист",
                    vec![
                        Widget::card(vec![
                            Widget::text("Удалить проект?").style(label_large()),
                            Widget::text("Действие необратимо.")
                                .style(body_small())
                                .tone(TextTone::Secondary),
                            Widget::row(vec![
                                Widget::button("Отмена").variant(ButtonVariant::Text),
                                Widget::spacer(1.0).grow(1.0),
                                Widget::button("Удалить").variant(ButtonVariant::Danger),
                            ])
                            .gap(8.0)
                            .wrap(),
                        ])
                        .gap(10.0)
                        .padding_all(16.0),
                        Widget::card(vec![
                            Widget::row(vec![
                                Widget::text("Sheet"),
                                Widget::spacer(1.0).grow(1.0),
                                Widget::tag("bottom", TagVariant::Neutral),
                            ]),
                            Widget::text("Нижний лист для мобильных действий.")
                                .style(body_small())
                                .tone(TextTone::Secondary),
                        ])
                        .gap(8.0)
                        .padding_all(16.0),
                    ],
                ),
                section_card(
                    "Drawer / Popover",
                    "Боковая панель и поповер",
                    vec![
                        Widget::card(vec![
                            Widget::text("Drawer").style(label_large()),
                            Widget::text("Навигация и фильтры")
                                .style(body_small())
                                .tone(TextTone::Secondary),
                            Widget::divider(),
                            list_item(IconName::Home, "Главная", ""),
                            list_item(IconName::Settings, "Настройки", ""),
                        ])
                        .gap(10.0)
                        .padding_all(16.0)
                        .width_px(260.0),
                        Widget::card(vec![
                            Widget::text("Popover").style(label_large()),
                            Widget::text("Быстрые действия")
                                .style(body_small())
                                .tone(TextTone::Secondary),
                            Widget::row(vec![
                                Widget::tag("Edit", TagVariant::Primary),
                                Widget::tag("Duplicate", TagVariant::Neutral),
                            ])
                            .gap(6.0),
                        ])
                        .gap(8.0)
                        .padding_all(14.0)
                        .width_px(200.0),
                    ],
                ),
                section_card(
                    "Menu / Tooltip / Snackbar",
                    "Меню и уведомления",
                    vec![
                        menu_item("Открыть"),
                        menu_item("Переименовать"),
                        Widget::divider(),
                        Widget::row(vec![
                            Widget::tag("Tooltip", TagVariant::Info),
                            Widget::text("Подсказка при наведении")
                                .style(body_small())
                                .tone(TextTone::Secondary),
                        ])
                        .gap(8.0)
                        .wrap(),
                        Widget::card(vec![Widget::row(vec![
                            Widget::text("Проект сохранён")
                                .style(body_medium())
                                .tone(TextTone::InverseOnSurface),
                            Widget::spacer(1.0).grow(1.0),
                            Widget::tag("Snackbar", TagVariant::Success),
                        ])
                        .align(Align::Center)
                        .wrap()])
                        .padding_all(12.0)
                        .surface(SurfaceTone::InverseSurface),
                    ],
                ),
            ],
        )
        .gap(16.0)
    }

    fn media_section(&self) -> Widget {
        let days: Vec<Widget> = (1..=28)
            .map(|day| {
                Widget::tag(
                    day.to_string(),
                    if day == 14 {
                        TagVariant::Primary
                    } else {
                        TagVariant::Neutral
                    },
                )
            })
            .collect();
        let calendar = Widget::grid(responsive!(Xs => 7usize), days).gap(6.0);
        let swatches = [
            SurfaceTone::Primary,
            SurfaceTone::SecondaryContainer,
            SurfaceTone::SuccessContainer,
            SurfaceTone::WarningContainer,
            SurfaceTone::ErrorContainer,
            SurfaceTone::Highest,
        ];
        let colors = Widget::grid(
            responsive!(Xs => 3usize, Md => 6),
            swatches
                .into_iter()
                .map(|tone| Widget::spacer(32.0).surface(tone).radius(8.0))
                .collect(),
        )
        .gap(8.0);
        Widget::grid(
            responsive!(Xs => 1usize, Md => 2),
            vec![
                section_card(
                    "DatePicker",
                    "Календарь и выбранный день",
                    vec![
                        Widget::row(vec![
                            Widget::text("Сентябрь 2026").style(label_large()).grow(1.0),
                            Widget::tag("14", TagVariant::Primary),
                        ])
                        .align(Align::Center),
                        calendar,
                    ],
                ),
                section_card(
                    "DateRangePicker",
                    "Диапазон дат",
                    vec![
                        Widget::text("10 — 18 сентября").style(body_medium()),
                        Widget::row(vec![
                            Widget::tag("10", TagVariant::Primary),
                            Widget::tag("18", TagVariant::Primary),
                            Widget::tag("8 дней", TagVariant::Info),
                        ])
                        .gap(8.0),
                    ],
                ),
                section_card(
                    "ColorPicker",
                    "Токены палитры",
                    vec![
                        colors,
                        Widget::row(vec![
                            Widget::tag("#0E2A47", TagVariant::Primary),
                            Widget::tag("#9FB8C9", TagVariant::Neutral),
                        ])
                        .gap(8.0),
                    ],
                ),
                section_card(
                    "FileUpload",
                    "Загрузка файла",
                    vec![Widget::card(vec![
                        Widget::row(vec![
                            Widget::glyph(IconName::Plus),
                            Widget::text("Перетащите файл"),
                        ])
                        .gap(8.0)
                        .align(Align::Center)
                        .wrap(),
                        Widget::text("PNG, JPG до 10 МБ")
                            .style(body_small())
                            .tone(TextTone::Secondary),
                        Widget::button("Выбрать файл")
                            .variant(ButtonVariant::Outlined)
                            .on_click(|| {}),
                    ])
                    .gap(10.0)
                    .padding_all(16.0)],
                ),
                section_card(
                    "RichTextEditor",
                    "Тулбар и содержимое",
                    vec![
                        Widget::row(vec![
                            Widget::button("B")
                                .variant(ButtonVariant::Text)
                                .size(ControlSize::Small),
                            Widget::button("I")
                                .variant(ButtonVariant::Text)
                                .size(ControlSize::Small),
                            Widget::button("U")
                                .variant(ButtonVariant::Text)
                                .size(ControlSize::Small),
                            Widget::button("•")
                                .variant(ButtonVariant::Text)
                                .size(ControlSize::Small),
                            Widget::button("↶")
                                .variant(ButtonVariant::Text)
                                .size(ControlSize::Small),
                        ])
                        .gap(4.0)
                        .wrap(),
                        Widget::text_field_plain("Текст", self.bio).multiline(),
                        Widget::text("Форматирование в MVP — визуальный тулбар.")
                            .style(hint())
                            .tone(TextTone::Tertiary),
                    ],
                ),
            ],
        )
        .gap(16.0)
    }
}

fn responsive_static(visible: bool) -> ui_core::Responsive<bool> {
    ui_core::Responsive::constant(visible)
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
    .justify(Justify::Center)
}

fn section_card(title: &str, description: &str, children: Vec<Widget>) -> Widget {
    let mut content = vec![Widget::column(vec![
        Widget::text(title)
            .style(label_large())
            .tone(TextTone::Primary),
        Widget::text(description)
            .style(hint())
            .tone(TextTone::Tertiary),
    ])
    .gap(2.0)];
    content.extend(children);
    Widget::card(content)
        .padding_all(20.0)
        .gap(14.0)
        .width(Length::Fraction(1.0))
}

fn tab_button(label: &str, index: usize, signal: Signal<usize>) -> Widget {
    let selected = signal.get() == index;
    Widget::button(label)
        .variant(if selected {
            ButtonVariant::Tonal
        } else {
            ButtonVariant::Text
        })
        .size(ControlSize::Small)
        .on_click(move || signal.set(index))
}

fn breadcrumbs(items: &[&str]) -> Widget {
    let mut children = Vec::new();
    for (index, item) in items.iter().enumerate() {
        if index > 0 {
            children.push(
                Widget::text("›")
                    .style(label_medium())
                    .tone(TextTone::Tertiary),
            );
        }
        children.push(
            Widget::text(*item)
                .style(body_small())
                .tone(if index + 1 == items.len() {
                    TextTone::Primary
                } else {
                    TextTone::Secondary
                }),
        );
    }
    Widget::row(children).gap(6.0).wrap()
}

fn list_item(icon: IconName, label: &str, meta: &str) -> Widget {
    Widget::row(vec![
        Widget::row(vec![Widget::glyph(icon).icon_tone(TextTone::Secondary)])
            .surface(SurfaceTone::Container)
            .radius(8.0)
            .width_px(32.0)
            .height_px(32.0)
            .align(Align::Center)
            .justify(Justify::Center),
        Widget::text(label).style(body_medium()).grow(1.0),
        Widget::text(meta).style(hint()).tone(TextTone::Tertiary),
    ])
    .gap(10.0)
    .align(Align::Center)
}

fn alert(title: &str, message: &str, surface: SurfaceTone, icon: IconName) -> Widget {
    Widget::row(vec![
        Widget::row(vec![Widget::glyph(icon).icon_tone(TextTone::Primary)])
            .surface(surface)
            .radius(8.0)
            .width_px(32.0)
            .height_px(32.0)
            .align(Align::Center)
            .justify(Justify::Center),
        Widget::column(vec![
            Widget::text(title).style(label_large()),
            Widget::text(message)
                .style(hint())
                .tone(TextTone::Secondary),
        ])
        .gap(2.0)
        .grow(1.0),
    ])
    .surface(surface)
    .radius(12.0)
    .padding_all(12.0)
    .gap(10.0)
    .align(Align::Center)
}

fn empty_state(icon: IconName, title: &str, description: &str) -> Widget {
    Widget::column(vec![
        Widget::row(vec![Widget::glyph(icon)])
            .surface(SurfaceTone::Container)
            .radius(20.0)
            .width_px(48.0)
            .height_px(48.0)
            .align(Align::Center)
            .justify(Justify::Center),
        Widget::text(title).style(label_large()),
        Widget::text(description)
            .style(hint())
            .tone(TextTone::Secondary),
        Widget::button("Создать")
            .variant(ButtonVariant::Filled)
            .size(ControlSize::Small)
            .on_click(|| {}),
    ])
    .gap(8.0)
    .align(Align::Center)
    .justify(Justify::Center)
    .padding_all(20.0)
}

fn menu_item(label: &str) -> Widget {
    Widget::row(vec![
        Widget::text(label).style(body_medium()).grow(1.0),
        Widget::text("↵").style(hint()).tone(TextTone::Tertiary),
    ])
    .padding(Edges::symmetric(8.0, 6.0))
    .gap(8.0)
    .align(Align::Center)
}

fn popover_button(label: &str, kind: usize, signal: Signal<usize>) -> Widget {
    Widget::button(label)
        .variant(ButtonVariant::Outlined)
        .size(ControlSize::Small)
        .on_click(move || signal.set(kind))
}

fn popover_option(label: &str, value: usize, plan: Signal<usize>, close: Signal<usize>) -> Widget {
    Widget::row(vec![
        Widget::text(label).style(body_medium()).grow(1.0),
        Widget::tag(
            if plan.get() == value { "selected" } else { "" },
            TagVariant::Primary,
        ),
    ])
    .padding_all(8.0)
    .clickable(move || {
        plan.set(value);
        close.set(0);
    })
}

fn status_row(
    label: &str,
    status: &str,
    variant: TagVariant,
    key: &'static str,
    request: Signal<Option<&'static str>>,
) -> Widget {
    Widget::row(vec![
        Widget::glyph(match variant {
            TagVariant::Success => IconName::Check,
            TagVariant::Error => IconName::Plus,
            _ => IconName::Folder,
        })
        .icon_tone(match variant {
            TagVariant::Error => TextTone::Error,
            TagVariant::Success => TextTone::Primary,
            _ => TextTone::Tertiary,
        }),
        Widget::text(label).style(body_medium()).grow(1.0),
        Widget::tag(status, variant),
    ])
    .padding_all(6.0)
    .gap(8.0)
    .align(Align::Center)
    .clickable(move || request.set(Some(key)))
}
