package dev.ivlev.silent.ui.demo

import dev.ivlev.silent.ui.layout.Align
import dev.ivlev.silent.ui.layout.Box
import dev.ivlev.silent.ui.widgets.CardScope
import dev.ivlev.silent.ui.layout.Column
import dev.ivlev.silent.ui.layout.ContentPage
import dev.ivlev.silent.ui.layout.Grid
import dev.ivlev.silent.ui.layout.NavItem
import dev.ivlev.silent.ui.layout.NavigationBar
import dev.ivlev.silent.ui.layout.NavigationRail
import dev.ivlev.silent.ui.layout.Row
import dev.ivlev.silent.ui.layout.Scroll
import dev.ivlev.silent.ui.layout.SizedBox
import dev.ivlev.silent.ui.layout.Spacer
import dev.ivlev.silent.ui.layout.Stack
import dev.ivlev.silent.ui.layout.Widget
import dev.ivlev.silent.ui.layout.adaptiveScaffold
import dev.ivlev.silent.ui.layout.expanded
import dev.ivlev.silent.ui.layout.screen
import dev.ivlev.silent.ui.form.bind
import dev.ivlev.silent.ui.form.signalBinding
import dev.ivlev.silent.ui.lifecycle.View
import dev.ivlev.silent.ui.lifecycle.component
import dev.ivlev.silent.ui.responsive.responsive
import dev.ivlev.silent.ui.tokens.Spacing
import dev.ivlev.silent.ui.tokens.Tone
import dev.ivlev.silent.ui.tokens.Typography
import dev.ivlev.silent.ui.widgets.Accordion
import dev.ivlev.silent.ui.widgets.AccordionEntry
import dev.ivlev.silent.ui.widgets.Alert
import dev.ivlev.silent.ui.widgets.AlertDialog
import dev.ivlev.silent.ui.widgets.Avatar
import dev.ivlev.silent.ui.widgets.Badge
import dev.ivlev.silent.ui.widgets.Breadcrumbs
import dev.ivlev.silent.ui.widgets.Button
import dev.ivlev.silent.ui.widgets.ButtonVariant
import dev.ivlev.silent.ui.widgets.Card as CardWidget
import dev.ivlev.silent.ui.widgets.Checkbox
import dev.ivlev.silent.ui.widgets.CheckboxGroup
import dev.ivlev.silent.ui.widgets.ChoiceOption
import dev.ivlev.silent.ui.widgets.Chip
import dev.ivlev.silent.ui.widgets.ColorPicker
import dev.ivlev.silent.ui.widgets.Combobox
import dev.ivlev.silent.ui.widgets.DataColumn
import dev.ivlev.silent.ui.widgets.DataState
import dev.ivlev.silent.ui.widgets.DataTable
import dev.ivlev.silent.ui.widgets.DatePicker
import dev.ivlev.silent.ui.widgets.DateRangePicker
import dev.ivlev.silent.ui.widgets.Dialog
import dev.ivlev.silent.ui.widgets.DialogSize
import dev.ivlev.silent.ui.widgets.Divider
import dev.ivlev.silent.ui.widgets.Drawer
import dev.ivlev.silent.ui.widgets.EmptyState
import dev.ivlev.silent.ui.widgets.Fab
import dev.ivlev.silent.ui.widgets.Field
import dev.ivlev.silent.ui.widgets.FieldGroup
import dev.ivlev.silent.ui.widgets.FieldType
import dev.ivlev.silent.ui.widgets.FieldArray
import dev.ivlev.silent.ui.widgets.FileField
import dev.ivlev.silent.ui.widgets.FileUpload
import dev.ivlev.silent.ui.widgets.FormActions
import dev.ivlev.silent.ui.widgets.FormProgress
import dev.ivlev.silent.ui.widgets.Heading
import dev.ivlev.silent.ui.widgets.Icon as IconWidget
import dev.ivlev.silent.ui.widgets.IconButton
import dev.ivlev.silent.ui.widgets.Label
import dev.ivlev.silent.ui.widgets.Link
import dev.ivlev.silent.ui.widgets.ListItem
import dev.ivlev.silent.ui.widgets.ListPanel
import dev.ivlev.silent.ui.widgets.Listbox
import dev.ivlev.silent.ui.widgets.Menu
import dev.ivlev.silent.ui.widgets.NumberField
import dev.ivlev.silent.ui.widgets.OtpInput
import dev.ivlev.silent.ui.widgets.Pagination
import dev.ivlev.silent.ui.widgets.Popover
import dev.ivlev.silent.ui.widgets.Progress
import dev.ivlev.silent.ui.widgets.RadioGroup
import dev.ivlev.silent.ui.widgets.RichTextEditor
import dev.ivlev.silent.ui.widgets.SearchField
import dev.ivlev.silent.ui.widgets.SegmentOption
import dev.ivlev.silent.ui.widgets.SegmentedButton
import dev.ivlev.silent.ui.widgets.Select
import dev.ivlev.silent.ui.widgets.SelectOption
import dev.ivlev.silent.ui.widgets.Sheet
import dev.ivlev.silent.ui.widgets.Skeleton
import dev.ivlev.silent.ui.widgets.Slider
import dev.ivlev.silent.ui.widgets.Snackbar
import dev.ivlev.silent.ui.widgets.Spinner
import dev.ivlev.silent.ui.widgets.Switch
import dev.ivlev.silent.ui.widgets.Table
import dev.ivlev.silent.ui.widgets.Tag
import dev.ivlev.silent.ui.widgets.TagInput
import dev.ivlev.silent.ui.widgets.TagTone
import dev.ivlev.silent.ui.widgets.Tabs
import dev.ivlev.silent.ui.widgets.Text
import dev.ivlev.silent.ui.widgets.TextField
import dev.ivlev.silent.ui.widgets.Textarea
import dev.ivlev.silent.ui.widgets.Tooltip
import dev.ivlev.silent.ui.widgets.TopAppBar
import dev.ivlev.silent.ui.widgets.TopAppBarVariant
import dev.ivlev.silent.ui.widgets.TreeSelect
import dev.ivlev.silent.ui.widgets.TreeSelectNode
import dev.ivlev.silent.ui.widgets.TableDensity
import dev.ivlev.silent.ui.tokens.ControlSize
import java.time.LocalDate

class GalleryView(
    private val vm: GalleryVM,
    private val onBack: () -> Unit,
    private val onToggleTheme: () -> Unit,
) : View {
    private val emailBinding = signalBinding(vm.email, "g-email")
    private val textBinding = signalBinding(vm.text, "g-text")
    private val textareaBinding = signalBinding(vm.textarea, "g-textarea")
    private val numberBinding = signalBinding(vm.number, "g-number")
    private val selectBinding = signalBinding(vm.select, "g-select")
    private val comboBinding = signalBinding(vm.combo, "g-combo")
    private val otpBinding = signalBinding(vm.otp, "g-otp")
    private val tagsBinding = signalBinding(vm.tags, "g-tags")
    private val checkABinding = signalBinding(vm.checkboxA, "g-check-a")
    private val checkBBinding = signalBinding(vm.checkboxB, "g-check-b")
    private val checkCBinding = signalBinding(vm.checkboxC, "g-check-c")
    private val checksBinding = signalBinding(vm.selectedChecks, "g-checks")
    private val radioBinding = signalBinding(vm.radio, "g-radio")
    private val switchBinding = signalBinding(vm.switch, "g-switch")
    private val sliderBinding = signalBinding(vm.slider, "g-slider")
    private val treeBinding = signalBinding(vm.tree, "g-tree")

    private val navItems = listOf(
        NavItem("foundations", "Основы", "type"),
        NavItem("forms", "Формы", "form"),
        NavItem("navigation", "Навигация", "compass"),
        NavItem("data", "Данные", "chart"),
        NavItem("extras", "Ещё", "more"),
    )

    override fun content(): Widget = Stack(fillWidth = true, fillHeight = true) {
        adaptiveScaffold(
            items = navItems,
            selectedId = { vm.section.value },
            onSelect = { vm.selectSection(it) },
        ) {
            Column(fillWidth = true, fillHeight = true) {
                Box(fillWidth = true, background = { it.colors.surfaceContainerLowest }) {
                    ContentPage(verticalPadding = Spacing.x3) {
                        Row(fillWidth = true, align = Align.Center) {
                            IconButton("<", label = "Назад", onClick = onBack)
                            expanded {
                                Column(gap = 2f, fillWidth = true) {
                                    Heading("Галерея компонентов", level = 2)
                                    Label(
                                        "41 компонент · формы · состояния",
                                        style = Typography.bodySmall,
                                        color = { it.colors.onSurfaceVariant },
                                    )
                                }
                            }
                            IconButton("Aa", label = "Тема", onClick = onToggleTheme)
                        }
                    }
                }
                Divider()
                expanded {
                    Scroll(state = vm.scroll) {
                        ContentPage(verticalPadding = Spacing.x5) {
                            Column(gap = Spacing.x5) {
                                when (vm.section.value) {
                                    "forms" -> formsSection()
                                    "navigation" -> navigationSection()
                                    "data" -> dataSection()
                                    "extras" -> extrasSection()
                                    else -> foundationsSection()
                                }
                            }
                        }
                    }
                }
            }
        }
        if (vm.dialogOpen.value) {
            Dialog(
                open = true,
                title = "Диалог",
                description = "Модальное окно с backdrop и закрытием по клику.",
                fill = true,
                modal = true,
                onClose = { vm.dialogOpen.set(false) },
                content = {
                    Column(gap = Spacing.x3) {
                        Text("Фокус, Escape и кнопки действий — в полном приложении.")
                        Label(
                            "Содержимое диалога использует те же токены и контролы.",
                            style = Typography.bodySmall,
                            color = { it.colors.onSurfaceVariant },
                        )
                    }
                },
                actions = {
                    Row(gap = Spacing.x2, fillWidth = false) {
                        Button("Отмена", variant = ButtonVariant.Text, onClick = { vm.dialogOpen.set(false) })
                        Button("Ок", onClick = { vm.dialogOpen.set(false) })
                    }
                },
            )
        }
        if (vm.drawerOpen.value) {
            Drawer(
                open = true,
                title = "Drawer",
                onClose = { vm.drawerOpen.set(false) },
                content = {
                    Column(gap = Spacing.x3) {
                        Text("Боковая навигация и фильтры.")
                        ListPanel(
                            items = listOf(
                                ListItem("Профиль", "Настройки аккаунта", "P"),
                                ListItem("Команда", "Участники и роли", "T"),
                                ListItem("Биллинг", "Тариф и счета", "B"),
                            ),
                        )
                    }
                },
                footer = {
                    Button("Закрыть", variant = ButtonVariant.Secondary, fullWidth = true, onClick = { vm.drawerOpen.set(false) })
                },
            )
        }
        if (vm.sheetOpen.value) {
            Sheet(
                open = true,
                title = "Sheet",
                description = "Нижняя панель с действиями.",
                onClose = { vm.sheetOpen.set(false) },
                content = {
                    Column(gap = Spacing.x3) {
                        Text("Быстрые действия и параметры выбранного элемента.")
                        Button("Продолжить", fullWidth = true, onClick = { vm.sheetOpen.set(false) })
                    }
                },
            )
        }
    }

    private fun example(title: String, description: String? = null, body: CardScope.() -> Unit): Widget =
        CardWidget(padding = Spacing.x5, widePadding = Spacing.x6) {
            val scope = this
            Column(gap = Spacing.x3) {
                Heading(title, level = 3)
                description?.let { text ->
                    Label(text, style = Typography.bodySmall, color = { it.colors.onSurfaceVariant })
                }
                scope.body()
            }
        }

    private fun foundationsSection(): Widget = Column(gap = Spacing.x4) {
        example("Типографика") {
            Column(gap = 6f) {
                Text("Display", style = Typography.displaySmall)
                Heading("Headline", level = 2)
                Text("Title", style = Typography.titleLarge)
                Text("Body medium — основной текст интерфейса.", style = Typography.bodyMedium)
                Label("LABEL SMALL", style = Typography.labelSmall)
                Link("Ссылка в тексте", onClick = {})
            }
        }
        example("Кнопки", "filled / tonal / outlined / text, размеры 32/40/48, loading, disabled, icon") {
            Column(gap = Spacing.x3) {
                Row(wrap = true, gap = Spacing.x2) {
                    Button("Filled", onClick = {})
                    Button("Tonal", variant = ButtonVariant.Tonal, onClick = {})
                    Button("Outlined", variant = ButtonVariant.Secondary, onClick = {})
                    Button("Text", variant = ButtonVariant.Text, onClick = {})
                }
                Row(wrap = true, gap = Spacing.x2, align = Align.Center) {
                    Button("32", size = ControlSize.SM, onClick = {})
                    Button("40", size = ControlSize.MD, onClick = {})
                    Button("48", size = ControlSize.LG, onClick = {})
                }
                Row(wrap = true, gap = Spacing.x2, align = Align.Center) {
                    Button("С иконкой", leadingIcon = "+", onClick = {})
                    Button("Loading", loading = true, onClick = {})
                    Button("Disabled", enabled = false, onClick = {})
                    Button("Hover", hovered = true, onClick = {})
                }
                Row(wrap = true, gap = Spacing.x2) {
                    IconButton("Aa", label = "Тема", onClick = {})
                    IconButton("+", label = "Добавить", variant = ButtonVariant.Primary, onClick = {})
                    Fab("+", text = "Создать")
                    Fab("+")
                }
            }
        }
        example("Tag / Badge / Chip / Avatar") {
            Column(gap = Spacing.x3) {
                Row(wrap = true, gap = Spacing.x2, align = Align.Center) {
                    Tag("Default", TagTone.Neutral)
                    Tag("Success", TagTone.Success)
                    Tag("Warning", TagTone.Warning)
                    Tag("Error", TagTone.Error)
                    Badge("3")
                    Badge("", dot = true)
                }
                Row(wrap = true, gap = Spacing.x2, align = Align.Center) {
                    Chip("Kotlin", selected = true)
                    Chip("Android", onClick = {})
                    Chip("Removable", removable = true, onClick = {})
                    Avatar("Анна Иванова")
                    Avatar("Silent UI", size = 32f)
                    Avatar("AI", size = 56f)
                }
            }
        }
        example("Progress / Spinner / Skeleton") {
            Column(gap = Spacing.x3) {
                Progress(0.62f)
                Progress(1f)
                Row(wrap = true, gap = Spacing.x3, align = Align.Center) {
                    Spinner(20f)
                    Spinner(32f)
                    Skeleton(width = 180f, height = 16f)
                    Skeleton(width = 80f, height = 32f, radius = 8f)
                }
            }
        }
        example("Alert / EmptyState") {
            Column(gap = Spacing.x3) {
                Alert("Информация", "Новая версия доступна для установки.", Tone.Info, action = {
                    Button("Обновить", size = ControlSize.SM, variant = ButtonVariant.Text, onClick = {})
                })
                Alert("Ошибка", "Не удалось сохранить изменения.", Tone.Error)
                EmptyState(
                    "Пока ничего нет",
                    "Добавьте первый проект, чтобы увидеть данные.",
                    "□",
                    action = { Button("Создать проект", onClick = {}) },
                )
            }
        }
        example("Card / Divider / Icon") {
            Column(gap = Spacing.x3) {
                CardWidget(padding = Spacing.x5) {
                    Column(gap = 8f) {
                        Heading("Карточка", level = 3)
                        Text("Body с токенами цвета и отступами 20/24.")
                        Divider()
                        Row(gap = Spacing.x2, align = Align.Center) {
                            IconWidget("O", 18f)
                            IconWidget("S", 18f)
                            Label("Actions / Footer")
                            expanded { Spacer() }
                            Button("Действие", variant = ButtonVariant.Text, onClick = {})
                        }
                    }
                }
            }
        }
    }

    private fun formsSection(): Widget = Column(gap = Spacing.x4) {
        example("Прогресс формы", "заполнено / пусто / ошибка · клик по полю фокусирует ввод") {
            Column(gap = Spacing.x3) {
                FormProgress(vm.form)
                Row(fillWidth = true, gap = Spacing.x3, align = Align.Start) {
                    SizedBox(width = 88f) { Tag("Заполнено", TagTone.Success) }
                    expanded {
                        TextField(vm.form.emailField, label = "Email")
                    }
                }
                Row(fillWidth = true, gap = Spacing.x3, align = Align.Start) {
                    SizedBox(width = 88f) { Tag("Пусто", TagTone.Neutral) }
                    expanded {
                        TextField(vm.form.passwordField, label = "Пароль", type = FieldType.Password)
                    }
                }
                Row(fillWidth = true, gap = Spacing.x3, align = Align.Start) {
                    SizedBox(width = 88f) { Tag("Ошибка", TagTone.Error) }
                    expanded {
                        TextField(emailBinding, label = "Проверка", externalError = "Проверьте значение")
                    }
                }
            }
        }
        example("TextField", "default / focus / error / disabled / sizes") {
            Column(gap = Spacing.x3) {
                TextField(emailBinding, label = "Email", hint = "name@company.com", type = FieldType.Email)
                TextField(textBinding, label = "Focused", focused = true)
                TextField(emailBinding, label = "Error", externalError = "Некорректное значение")
                TextField(emailBinding, label = "Disabled", enabled = false)
                Row(wrap = true, gap = Spacing.x2) {
                    TextField(emailBinding, label = "32", size = ControlSize.SM)
                    TextField(emailBinding, label = "40", size = ControlSize.MD)
                    TextField(emailBinding, label = "48", size = ControlSize.LG)
                }
                SearchField(signalBinding(vm.text, "g-search"), placeholder = "Поиск по компонентам")
            }
        }
        example("Textarea / NumberField / OTP") {
            Column(gap = Spacing.x3) {
                Textarea(textareaBinding, label = "Комментарий", rows = 4)
                NumberField(numberBinding, label = "Количество", unit = "шт", min = 0f, max = 99f)
                OtpInput(otpBinding, externalError = null)
            }
        }
        example("Select / Combobox / TreeSelect") {
            Column(gap = Spacing.x3) {
                Select(
                    options = listOf(
                        SelectOption("design", "Дизайн"),
                        SelectOption("dev", "Разработка"),
                        SelectOption("ops", "Эксплуатация"),
                    ),
                    binding = selectBinding,
                    label = "Направление",
                    open = true,
                )
                Combobox(
                    options = listOf(
                        SelectOption("Silent UI", "Silent UI"),
                        SelectOption("Silent Protocol", "Silent Protocol"),
                        SelectOption("Silent Core", "Silent Core"),
                    ),
                    field = comboBinding,
                    label = "Проект",
                    open = true,
                )
                TreeSelect(
                    nodes = listOf(
                        TreeSelectNode(
                            "src",
                            "src",
                            children = listOf(
                                TreeSelectNode("ui", "ui", depth = 1, children = listOf(TreeSelectNode("widgets", "widgets", depth = 2))),
                                TreeSelectNode("core", "core", depth = 1),
                            ),
                        ),
                        TreeSelectNode("docs", "docs"),
                    ),
                    selected = treeBinding,
                    label = "Компоненты",
                )
            }
        }
        example("Checkbox / CheckboxGroup / Radio / Switch") {
            Column(gap = Spacing.x3) {
                Checkbox(checkABinding, label = "Запомнить меня")
                Checkbox(checkBBinding, label = "Disabled", enabled = false)
                CheckboxGroup(
                    options = listOf(
                        ChoiceOption("one", "Первый"),
                        ChoiceOption("two", "Второй"),
                        ChoiceOption("three", "Третий"),
                    ),
                    field = checksBinding,
                    label = "CheckboxGroup",
                )
                RadioGroup(
                    options = listOf(
                        ChoiceOption("one", "Option one"),
                        ChoiceOption("two", "Option two"),
                        ChoiceOption("three", "Option three", disabled = true),
                    ),
                    field = radioBinding,
                    label = "RadioGroup",
                )
                Switch(switchBinding, label = "Уведомления")
                Switch(switchBinding, label = "Disabled", enabled = false)
            }
        }
        example("Slider / TagInput") {
            Column(gap = Spacing.x3) {
                Slider(sliderBinding, label = "Плотность", unit = "%")
                TagInput(tagsBinding, label = "Теги", suggestions = listOf("web", "desktop", "android"))
            }
        }
        example("Field / FieldGroup / FormActions / FormProgress") {
            Column(gap = Spacing.x3) {
                Field(
                    label = "Составное поле",
                    hint = "Field управляет подписью и сообщением",
                    required = true,
                ) {
                    TextField(emailBinding)
                }
                FieldGroup(
                    legend = "Профиль",
                    hint = "1 / 2 / 3 колонки по брейкпоинтам",
                ) {
                    Grid(columns = responsive(xs = 1, md = 2, xl = 3), gap = Spacing.x3) {
                        TextField(emailBinding, label = "Имя")
                        TextField(textBinding, label = "Фамилия")
                        TextField(textBinding, label = "Город")
                    }
                }
                FormProgress(vm.form)
                FormActions(
                    loading = false,
                    onSubmit = {},
                    onReset = {},
                )
            }
        }
        example("FieldArray / Listbox") {
            Column(gap = Spacing.x3) {
                FieldArray(count = 2) { index ->
                    TextField(emailBinding, label = "Участник ${index + 1}")
                }
                Listbox(
                    options = listOf("Вариант A", "Вариант B", "Вариант C"),
                    selected = 1,
                )
            }
        }
        example("FileField / FileUpload") {
            Column(gap = Spacing.x3) {
                FileField(label = "Документ", value = "passport.pdf")
                FileField(label = "Без файла")
                FileUpload()
            }
        }
    }

    private fun navigationSection(): Widget = Column(gap = Spacing.x4) {
        example("TopAppBar") {
            Column(gap = Spacing.x3) {
                TopAppBar("Silent UI", "TopAppBar · small", actions = { IconButton("Aa", onClick = {}) })
                TopAppBar(
                    "Компоненты",
                    "medium · leading/actions",
                    variant = TopAppBarVariant.Medium,
                    leading = { IconButton("<", label = "Назад", onClick = onBack) },
                    actions = { Button("Действие", size = ControlSize.SM, onClick = {}) },
                )
            }
        }
        example("Tabs / SegmentedButton") {
            Column(gap = Spacing.x3) {
                Tabs(
                    items = listOf("Обзор", "Формы", "Данные", "Настройки"),
                    selected = { vm.selectedTab.value },
                    onSelect = { vm.selectedTab.set(it) },
                )
                SegmentedButton(
                    options = listOf(
                        SegmentOption("list", "Список"),
                        SegmentOption("grid", "Сетка"),
                        SegmentOption("cards", "Карточки"),
                    ),
                    selected = vm.segment.value,
                    onSelect = { vm.segment.set(it) },
                )
            }
        }
        example("Breadcrumbs / Pagination") {
            Column(gap = Spacing.x3) {
                Breadcrumbs(listOf("Главная", "Проекты", "Silent UI"))
                Pagination(vm.page.value, 5, vm::onPage)
            }
        }
        example("Accordion") {
            Accordion(
                entries = listOf(
                    AccordionEntry("Что входит в MVP") {
                        Text("Сигналы, формы, layout, DI, desktop и Android.")
                    },
                    AccordionEntry("Какие ограничения") {
                        Text("Компоненты рендерятся на Canvas; accessibility — частично.")
                    },
                ),
                expanded = vm.accordion.value,
                onToggle = vm::toggleAccordion,
            )
        }
        example("List") {
            ListPanel(
                items = listOf(
                    ListItem("Активные проекты", "24 проекта", "A", "24", selected = true),
                    ListItem("Задачи", "128 открытых", "T", "128"),
                    ListItem("Сборки", "96% успешных", "B", "96%"),
                ),
            )
        }
        example("NavigationRail / NavigationBar", "rail 260 на xl, bottom bar ниже") {
            Column(gap = Spacing.x3) {
                Box(fillWidth = true, minHeight = 240f, background = { it.colors.surfaceContainerLow }) {
                    NavigationRail(
                        items = navItems,
                        selectedId = { vm.section.value },
                        onSelect = { vm.selectSection(it) },
                        width = 220f,
                    )
                }
                NavigationBar(
                    items = navItems,
                    selectedId = { vm.section.value },
                    onSelect = { vm.selectSection(it) },
                )
            }
        }
    }

    private fun dataSection(): Widget = Column(gap = Spacing.x4) {
        example("Table") {
            Table(
                headers = listOf("Проект", "Статус", "Владелец"),
                rows = listOf(
                    listOf("Silent UI", "В работе", "Анна"),
                    listOf("Silent Protocol", "Стабильно", "Илья"),
                    listOf("Design Tokens", "Проверка", "Мария"),
                ),
                columnWeights = listOf(2f, 1.2f, 1f),
            )
        }
        example("DataTable", "header 44 / row 48, selection, sort, cards на узком, empty/loading/error") {
            Column(gap = Spacing.x3) {
                Row(wrap = true, gap = Spacing.x2) {
                    Button("Ready", size = ControlSize.SM, onClick = { vm.dataState.set(DataState.Ready) })
                    Button("Loading", size = ControlSize.SM, onClick = { vm.dataState.set(DataState.Loading) })
                    Button("Empty", size = ControlSize.SM, onClick = { vm.dataState.set(DataState.Empty) })
                    Button("Error", size = ControlSize.SM, onClick = { vm.dataState.set(DataState.Error) })
                }
                Row(wrap = true, gap = Spacing.x2) {
                    Button("Compact", size = ControlSize.SM, onClick = { vm.tableState.density = TableDensity.Compact })
                    Button("Default", size = ControlSize.SM, onClick = { vm.tableState.density = TableDensity.Default })
                    Button("Comfortable", size = ControlSize.SM, onClick = { vm.tableState.density = TableDensity.Comfortable })
                    Button("Сбросить ширины", size = ControlSize.SM, variant = ButtonVariant.Text, onClick = { vm.tableState.resetWidths() })
                }
                DataTable(
                    columns = listOf(
                        DataColumn("name", "Проект", weight = 2f, sortable = true),
                        DataColumn("status", "Статус", weight = 1.4f),
                        DataColumn("owner", "Владелец", weight = 1.2f),
                        DataColumn("updated", "Обновлён", weight = 1.4f),
                    ),
                    rows = listOf(
                        listOf("Silent UI", "В работе", "Анна", "2 мин назад"),
                        listOf("Silent Protocol", "Стабильно", "Илья", "18 мин назад"),
                        listOf("Design Tokens", "Проверка", "Мария", "1 ч назад"),
                        listOf("Docs Portal", "В работе", "Олег", "3 ч назад"),
                    ),
                    selectedRows = vm.dataSelected.value,
                    onSelectRow = vm::toggleRow,
                    sortKey = vm.sortKey.value,
                    sortDirection = vm.sortDir.value,
                    onSort = vm::sort,
                    page = vm.page.value,
                    pageCount = 5,
                    onPage = vm::onPage,
                    state = vm.dataState.value,
                    onRetry = { vm.dataState.set(DataState.Ready) },
                    onClearSelection = { vm.dataSelected.set(emptySet()) },
                    tableState = vm.tableState,
                )
                DataTable(
                    columns = listOf(DataColumn("name", "Компактная", weight = 1f)),
                    rows = listOf(listOf("Compact row")),
                    state = DataState.Ready,
                    compact = true,
                    selectable = false,
                )
            }
        }
        example("Pagination / List") {
            Column(gap = Spacing.x3) {
                Pagination(vm.page.value, 5, vm::onPage)
                ListPanel(
                    items = listOf(
                        ListItem("Empty state", "Нет записей", "∅", null),
                        ListItem("Disabled row", "Недоступно", "×", null, disabled = true),
                    ),
                )
            }
        }
    }

    private fun extrasSection(): Widget = Column(gap = Spacing.x4) {
        example("Dialog / AlertDialog", "backdrop, close, actions") {
            Column(gap = Spacing.x3) {
                Row(wrap = true, gap = Spacing.x2) {
                    Button("Открыть Dialog", onClick = { vm.dialogOpen.set(true) })
                    Button("Открыть Drawer", variant = ButtonVariant.Secondary, onClick = { vm.drawerOpen.set(true) })
                    Button("Открыть Sheet", variant = ButtonVariant.Tonal, onClick = { vm.sheetOpen.set(true) })
                }
                SizedBox(height = 300f, background = { it.colors.surfaceContainerLow }, content = {
                    Dialog(
                        title = "Предпросмотр диалога",
                        description = "Предпросмотр внутри галереи.",
                        modal = false,
                        fill = false,
                        content = { Text("Тело диалога") },
                        actions = { Button("Ок", size = ControlSize.SM, onClick = {}) },
                    )
                })
                SizedBox(height = 240f, background = { it.colors.surfaceContainerLow }, content = {
                    AlertDialog(
                        title = "Удалить проект?",
                        description = "Действие нельзя отменить.",
                        confirmLabel = "Удалить",
                        modal = false,
                        onConfirm = {},
                        onClose = {},
                    )
                })
            }
        }
        example("Drawer / Sheet", "модальные панели поверх контента, scrim и закрытие") {
            Column(gap = Spacing.x3) {
                Label(
                    "Откройте панель, чтобы проверить backdrop, ширину и действия.",
                    style = Typography.bodySmall,
                    color = { it.colors.onSurfaceVariant },
                )
                Row(wrap = true, gap = Spacing.x2) {
                    Button("Открыть Drawer", variant = ButtonVariant.Secondary, onClick = { vm.drawerOpen.set(true) })
                    Button("Открыть Sheet", variant = ButtonVariant.Tonal, onClick = { vm.sheetOpen.set(true) })
                }
            }
        }
        example("Popover / Menu / Tooltip / Snackbar") {
            Column(gap = Spacing.x3) {
                Row(wrap = true, gap = Spacing.x3, align = Align.Start) {
                    Popover(title = "Popover", width = 240f) {
                        Column(gap = 4f) {
                            Text("Содержимое поповера")
                            Button("Действие", size = ControlSize.SM, variant = ButtonVariant.Text, onClick = {})
                        }
                    }
                    Menu(
                        items = listOf("Редактировать", "Дублировать", "Удалить"),
                        selected = 0,
                        disabled = setOf(2),
                    )
                    Tooltip("Подсказка")
                }
                Snackbar(
                    open = vm.snackbarOpen.value,
                    message = "Изменения сохранены",
                    actionLabel = "Отменить",
                    onAction = { vm.snackbarOpen.set(false) },
                    onClose = { vm.snackbarOpen.set(false) },
                )
                if (!vm.snackbarOpen.value) {
                    Button("Показать Snackbar", onClick = { vm.snackbarOpen.set(true) })
                }
            }
        }
        example("DatePicker / DateRangePicker / ColorPicker") {
            Column(gap = Spacing.x3) {
                SizedBox(height = 360f, background = { it.colors.surfaceContainerLow }, content = {
                    DatePicker(
                        label = "Дата",
                        value = vm.date.value,
                        open = true,
                        onSelect = { vm.date.set(it) },
                    )
                })
                SizedBox(height = 360f, background = { it.colors.surfaceContainerLow }, content = {
                    DateRangePicker(
                        label = "Период",
                        start = vm.date.value,
                        end = vm.dateEnd.value,
                        open = true,
                        onSelect = { start, end ->
                            vm.date.set(start)
                            vm.dateEnd.set(end)
                        },
                    )
                })
                ColorPicker(
                    value = dev.ivlev.silent.ui.tokens.Color.hex(vm.selectedColor.value),
                    onSelect = { color ->
                        vm.selectedColor.set("#" + color.argb.toString(16).padStart(8, '0').takeLast(6))
                    },
                )
            }
        }
        example("FileUpload / RichTextEditor") {
            Column(gap = Spacing.x3) {
                FileUpload()
                RichTextEditor(value = "Silent UI — это дизайн-система.")
            }
        }
    }
}
