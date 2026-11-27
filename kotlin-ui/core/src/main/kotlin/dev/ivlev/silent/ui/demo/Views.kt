package dev.ivlev.silent.ui.demo

import dev.ivlev.silent.ui.form.bind
import dev.ivlev.silent.ui.form.signalBinding
import dev.ivlev.silent.ui.layout.Align
import dev.ivlev.silent.ui.layout.Box
import dev.ivlev.silent.ui.layout.Column
import dev.ivlev.silent.ui.layout.ContentPage
import dev.ivlev.silent.ui.layout.Grid
import dev.ivlev.silent.ui.layout.Justify
import dev.ivlev.silent.ui.layout.NavItem
import dev.ivlev.silent.ui.layout.Row
import dev.ivlev.silent.ui.layout.Scroll
import dev.ivlev.silent.ui.layout.SizedBox
import dev.ivlev.silent.ui.layout.Spacer
import dev.ivlev.silent.ui.layout.Stack
import dev.ivlev.silent.ui.layout.TextAlign
import dev.ivlev.silent.ui.layout.Widget
import dev.ivlev.silent.ui.layout.adaptiveContent
import dev.ivlev.silent.ui.layout.adaptiveScaffold
import dev.ivlev.silent.ui.layout.expanded
import dev.ivlev.silent.ui.layout.isolateWidgets
import dev.ivlev.silent.ui.layout.screen
import dev.ivlev.silent.ui.lifecycle.View
import dev.ivlev.silent.ui.lifecycle.component
import dev.ivlev.silent.ui.responsive.Breakpoint
import dev.ivlev.silent.ui.responsive.responsive
import dev.ivlev.silent.ui.tokens.ControlSize
import dev.ivlev.silent.ui.tokens.Radii
import dev.ivlev.silent.ui.tokens.Spacing
import dev.ivlev.silent.ui.tokens.Tone
import dev.ivlev.silent.ui.tokens.Typography
import dev.ivlev.silent.ui.widgets.Alert
import dev.ivlev.silent.ui.widgets.Avatar
import dev.ivlev.silent.ui.widgets.Button
import dev.ivlev.silent.ui.widgets.ButtonVariant
import dev.ivlev.silent.ui.widgets.Card as CardWidget
import dev.ivlev.silent.ui.widgets.Checkbox
import dev.ivlev.silent.ui.widgets.Dialog
import dev.ivlev.silent.ui.widgets.DataColumn
import dev.ivlev.silent.ui.widgets.DataTable
import dev.ivlev.silent.ui.widgets.Divider
import dev.ivlev.silent.ui.widgets.FieldType
import dev.ivlev.silent.ui.widgets.FormProgress
import dev.ivlev.silent.ui.widgets.Heading
import dev.ivlev.silent.ui.widgets.IconButton
import dev.ivlev.silent.ui.widgets.Pagination
import dev.ivlev.silent.ui.widgets.Progress
import dev.ivlev.silent.ui.widgets.Select
import dev.ivlev.silent.ui.widgets.SelectOption
import dev.ivlev.silent.ui.widgets.Table
import dev.ivlev.silent.ui.widgets.Tag
import dev.ivlev.silent.ui.widgets.TagTone
import dev.ivlev.silent.ui.widgets.Switch
import dev.ivlev.silent.ui.widgets.VectorIcon
import dev.ivlev.silent.ui.widgets.TextField
import dev.ivlev.silent.ui.widgets.Text as Label
import kotlin.math.roundToInt

class LoginView(
    private val vm: LoginVM,
    private val onToggleTheme: () -> Unit,
) : View {
    override fun content(): Widget = screen {
        Box(
            padding = Spacing.x4,
            fillWidth = true,
            fillHeight = true,
            align = Align.Center,
            verticalAlign = Align.Center,
        ) {
            CardWidget(
                padding = 28f,
                widePadding = 32f,
                maxWidth = 480f,
                radius = 16f,
            ) {
                Column(gap = Spacing.x4) {
                    Row(fillWidth = true, align = Align.Start) {
                        Column(gap = 4f, fillWidth = false) {
                            Heading("Вход")
                            Label(
                                "Рабочее пространство Silent",
                                style = Typography.bodySmall,
                                color = { it.colors.onSurfaceVariant },
                            )
                        }
                        expanded { Spacer() }
                        IconButton("Aa", label = "Тема", onClick = onToggleTheme)
                    }
                    TextField(
                        vm.form.emailField,
                        label = "Email",
                        hint = "name@company.com",
                        type = FieldType.Email,
                    )
                    TextField(
                        vm.form.passwordField,
                        label = "Пароль",
                        hint = "Минимум 8 символов",
                        type = FieldType.Password,
                    )
                    Checkbox(vm.form.rememberField, label = "Запомнить меня")
                    if (vm.serverMessage.isNotEmpty()) {
                        Label(
                            vm.serverMessage,
                            style = Typography.bodySmall,
                            color = { it.colors.error },
                        )
                    }
                    Button(
                        text = "Войти",
                        enabled = vm.canSubmit,
                        loading = vm.form.isSubmitting.value,
                        fullWidth = true,
                        onClick = vm.form::submit,
                    )
                    FormProgress(vm.form)
                    Divider()
                    Label(
                        "Демо: error@silent.dev показывает серверную ошибку",
                        style = Typography.labelSmall,
                        color = { it.colors.onSurfaceMuted },
                    )
                }
            }
        }
    }
}

class DashboardView(
    private val vm: DashboardVM,
    private val onToggleTheme: () -> Unit,
    private val onOpenGallery: () -> Unit,
    private val onLogout: () -> Unit,
) : View {
    private val navItems = listOf(
        NavItem("overview", "Обзор", "grid"),
        NavItem("projects", "Проекты", "folder"),
        NavItem("reports", "Отчёты", "chart"),
        NavItem("settings", "Настройки", "gear"),
    )

    override fun content(): Widget = screen {
        Stack(fillWidth = true, fillHeight = true) {
            adaptiveScaffold(
                items = navItems,
                selectedId = { vm.selectedNav },
                onSelect = { vm.selectNavigation(it) },
                railWidth = 260f,
            ) {
                Column(fillWidth = true, fillHeight = true) {
                    topBar()
                    pageHeader()
                    Divider()
                    expanded {
                        Scroll(state = vm.scroll) {
                            ContentPage(maxWidth = 1920f, verticalPadding = Spacing.x4) {
                                when (vm.selectedNav) {
                                    "settings" -> settingsCard()
                                    "projects" -> projectsCard()
                                    "reports" -> reportsContent()
                                    else -> overviewContent()
                                }
                            }
                        }
                    }
                }
            }
            if (vm.profileOpen) {
                Dialog(
                    open = true,
                    title = "Профиль",
                    description = "Алексей Лебедев · demo@silent.dev",
                    fill = true,
                    modal = true,
                    onClose = { vm.profileOpen = false },
                    content = {
                        Column(gap = Spacing.x3) {
                            Label(
                                "Аккаунт демо-пространства Silent Projects.",
                                style = Typography.bodySmall,
                                color = { it.colors.onSurfaceVariant },
                            )
                        }
                    },
                    actions = {
                        Row(gap = Spacing.x2, fillWidth = false) {
                            Button(
                                "Отмена",
                                variant = ButtonVariant.Text,
                                onClick = { vm.profileOpen = false },
                            )
                            Button(
                                "Выйти",
                                onClick = {
                                    vm.profileOpen = false
                                    onLogout()
                                },
                            )
                        }
                    },
                )
            }
        }
    }

    private fun topBar(): Widget =
        Box(
            fillWidth = true,
            height = 64f,
            verticalAlign = Align.Center,
            background = { it.colors.surfaceContainerLowest },
        ) {
            ContentPage(maxWidth = 1920f, verticalPadding = 0f) {
                adaptiveContent(
                    threshold = Breakpoint.XL.minWidth,
                    narrow = { topBarRow(0f) },
                    wide = { topBarRow(54f) },
                )
            }
        }

    private fun topBarRow(leading: Float): Widget = Row(fillWidth = true, align = Align.Center, gap = Spacing.x2) {
        if (leading > 0f) Spacer(width = leading)
        Label("Silent Projects", style = Typography.titleMedium)
        expanded { Spacer() }
        IconButton("gallery", label = "Галерея", variant = ButtonVariant.Text, onClick = onOpenGallery)
        IconButton("theme", label = "Тема", variant = ButtonVariant.Text, onClick = onToggleTheme)
        Avatar(
            name = "Алексей Лебедев",
            size = 40f,
            tone = Tone.Neutral,
            onClick = { vm.profileOpen = true },
        )
    }

    private fun pageHeader(): Widget =
        Box(fillWidth = true, background = { it.colors.surfaceContainerLowest }) {
            ContentPage(maxWidth = 1920f, verticalPadding = Spacing.x4) {
                adaptiveContent(
                    threshold = Breakpoint.LG.minWidth,
                    narrow = {
                        Column(gap = Spacing.x3, align = Align.Start, fillWidth = true) {
                            titleBlock()
                            headerAction()
                        }
                    },
                    wide = {
                        Row(fillWidth = true, align = Align.Center) {
                            expanded { titleBlock() }
                            headerAction()
                        }
                    },
                )
            }
        }

    private fun titleBlock(): Widget = Column(gap = 4f, fillWidth = true) {
        Label(vm.heading, style = Typography.displaySmall, maxLines = 1)
        Label(
            vm.subtitle,
            style = Typography.bodySmall,
            color = { it.colors.onSurfaceVariant },
            maxLines = 2,
        )
    }

    private fun headerAction(): Widget {
        if (vm.selectedNav != "overview") return Spacer()
        return Button(
            "Все проекты",
            variant = ButtonVariant.Tonal,
            size = ControlSize.SM,
            onClick = { vm.selectNavigation("projects") },
        )
    }

    private fun overviewContent(): Widget = Column(gap = Spacing.x6) {
        if (vm.dashboardError.isNotEmpty()) {
            Alert(
                title = "API недоступен — показаны локальные данные",
                description = vm.dashboardError,
                tone = Tone.Warning,
                action = {
                    Button(
                        "Повторить",
                        variant = ButtonVariant.Text,
                        size = ControlSize.SM,
                        onClick = { vm.refreshDashboard() },
                    )
                },
            )
        }
        metricsGrid()
        adaptiveContent(
            threshold = 1024f,
            narrow = {
                Column(gap = Spacing.x6) {
                    statusesCard()
                    teamCard()
                }
            },
            wide = {
                adaptiveContent(
                    threshold = Breakpoint.XXXXL.minWidth,
                    narrow = {
                        Row(gap = Spacing.x6, align = Align.Stretch) {
                            expanded(1.15f) { statusesCard() }
                            expanded(1f) { teamCard() }
                        }
                    },
                    wide = {
                        Row(gap = Spacing.x6, align = Align.Stretch) {
                            expanded(1.35f) { statusesCard() }
                            expanded(1f) { teamCard() }
                        }
                    },
                )
            },
        )
        recentProjectsCard()
    }

    private fun reportsContent(): Widget = Column(gap = Spacing.x6) {
        metricsGrid()
        statusesCard()
    }

    private fun metricsGrid(): Widget = Grid(
        columns = responsive(xs = 2, sm = 2, md = 2, lg = 3, xl = 3, `2xl` = 3, `3xl` = 6),
        gap = Spacing.x4,
    ) {
        vm.stats.forEach { stat -> statCard(stat) }
    }

    private fun statCard(stat: Stat): Widget = CardWidget(
        padding = Spacing.x4,
        widePadding = Spacing.x4,
        radius = Radii.card,
        height = 180f,
    ) {
        Column(gap = Spacing.x3, fillHeight = true, justify = Justify.SpaceBetween) {
            Row(fillWidth = true, align = Align.Center, gap = Spacing.x3) {
                expanded {
                    Label(
                        stat.label,
                        style = Typography.labelMedium,
                        color = { it.colors.onSurfaceMuted },
                        maxLines = 1,
                    )
                }
                statIcon(stat)
            }
            Label(stat.value, style = Typography.headlineLarge, maxLines = 1)
            SizedBox(height = 40f) {
                Label(
                    stat.hint,
                    style = Typography.bodySmall,
                    color = { it.colors.onSurfaceVariant },
                    maxLines = 2,
                )
            }
        }
    }

    private fun statIcon(stat: Stat): Widget = Box(
        width = 38f,
        height = 38f,
        fillWidth = false,
        fillHeight = false,
        align = Align.Center,
        verticalAlign = Align.Center,
        radius = Radii.md,
        background = { theme ->
            when (stat.tone) {
                Tone.Primary -> theme.colors.primaryContainer
                Tone.Success -> theme.colors.successContainer
                Tone.Warning -> theme.colors.warningContainer
                else -> theme.colors.surfaceContainer
            }
        },
    ) {
        VectorIcon(
            name = stat.icon,
            size = 20f,
            color = { theme ->
                when (stat.tone) {
                    Tone.Primary -> theme.colors.onPrimaryContainer
                    Tone.Success -> theme.colors.success
                    Tone.Warning -> theme.colors.warning
                    else -> theme.colors.onSurfaceVariant
                }
            },
        )
    }

    private fun statusesCard(): Widget = CardWidget(
        padding = Spacing.x5,
        widePadding = Spacing.x6,
        radius = Radii.card,
    ) {
        Column(gap = Spacing.x5) {
            Row(fillWidth = true, align = Align.Center) {
                expanded { Heading("Статусы", level = 3) }
                Label(
                    "${vm.statuses.firstOrNull()?.total ?: vm.projects.size} проектов",
                    style = Typography.bodySmall,
                    color = { it.colors.onSurfaceMuted },
                    maxLines = 1,
                )
            }
            Column(gap = Spacing.x4) {
                vm.statuses.forEach { status -> statusRow(status) }
            }
        }
    }

    private fun statusRow(status: StatusSummary): Widget = Column(gap = Spacing.x2) {
        Row(fillWidth = true, align = Align.Center, gap = Spacing.x3) {
            Tag(status.label, toneFor(status.label), compact = true)
            expanded {
                Label(
                    "${status.count} из ${status.total}",
                    style = Typography.bodySmall,
                    color = { it.colors.onSurfaceVariant },
                    maxLines = 1,
                )
            }
            Label(
                "${(status.percent * 100f).roundToInt()}%",
                style = Typography.labelLarge,
                maxLines = 1,
            )
        }
        Progress(value = status.percent, height = 6f)
    }

    private fun teamCard(): Widget = CardWidget(
        padding = Spacing.x5,
        widePadding = Spacing.x6,
        radius = Radii.card,
    ) {
        Column(gap = Spacing.x5) {
            Heading("Команда и теги", level = 3)
            metaBlock("Владельцы", vm.owners.size) {
                vm.owners.map { owner -> Tag(owner, TagTone.Neutral, compact = true) }
            }
            Divider()
            metaBlock("Теги", vm.tags.size) {
                vm.tags.map { tag -> Tag("#$tag", TagTone.Info, compact = true) }
            }
        }
    }

    private fun metaBlock(title: String, count: Int, chips: () -> List<Widget>): Widget =
        Column(gap = Spacing.x2) {
            Row(fillWidth = true, align = Align.Center) {
                expanded {
                    Label(
                        title,
                        style = Typography.labelMedium,
                        color = { it.colors.onSurfaceMuted },
                        maxLines = 1,
                    )
                }
                Label(
                    count.toString(),
                    style = Typography.bodySmall,
                    color = { it.colors.onSurfaceMuted },
                    maxLines = 1,
                )
            }
            Row(
                gap = Spacing.x1,
                align = Align.Center,
                fillWidth = true,
                wrap = true,
                children = isolateWidgets { chips() },
            )
        }

    private fun recentProjectsCard(): Widget = CardWidget(
        padding = 0f,
        widePadding = 0f,
        radius = Radii.card,
    ) {
        Column(fillWidth = true) {
            Row(fillWidth = true, align = Align.Center, padding = Spacing.x4) {
                expanded {
                    Column(gap = 2f, fillWidth = true) {
                        Heading("Последние проекты", level = 3)
                        Label(
                            "Пять последних записей портфеля",
                            style = Typography.bodySmall,
                            color = { it.colors.onSurfaceVariant },
                            maxLines = 1,
                        )
                    }
                }
                Button(
                    "Открыть таблицу",
                    variant = ButtonVariant.Text,
                    size = ControlSize.SM,
                    onClick = { vm.selectNavigation("projects") },
                )
            }
            Divider()
            adaptiveContent(
                threshold = Breakpoint.LG.minWidth,
                narrow = { recentProjectsCompact() },
                wide = {
                    Table(
                        headers = listOf("Проект", "Владелец", "Статус", "Теги", "Бюджет", "Создан"),
                        rows = vm.dashboardRows.take(5).map { project ->
                            listOf(
                                project.name,
                                project.owner,
                                project.statusLabel,
                                project.tags.joinToString(","),
                                project.budgetText,
                                project.createdText,
                            )
                        },
                        columnWeights = listOf(190f, 140f, 110f, 170f, 100f, 120f),
                        columnAligns = listOf(
                            TextAlign.Start,
                            TextAlign.Start,
                            TextAlign.Start,
                            TextAlign.Start,
                            TextAlign.End,
                            TextAlign.End,
                        ),
                        statusColumn = 2,
                        tagsColumn = 3,
                        rowHeight = 48f,
                        headerHeight = 40f,
                    )
                },
            )
        }
    }

    private fun recentProjectsCompact(): Widget = Column(fillWidth = true) {
        vm.dashboardRows.take(5).forEachIndexed { index, project ->
            Column(gap = Spacing.x1, padding = Spacing.x4, fillWidth = true) {
                Row(fillWidth = true, align = Align.Center, gap = Spacing.x2) {
                    expanded {
                        Label(project.name, style = Typography.titleSmall, maxLines = 1)
                    }
                    Tag(project.statusLabel, toneFor(project.statusLabel), compact = true)
                }
                Row(fillWidth = true, align = Align.Center, gap = Spacing.x2) {
                    expanded {
                        Label(
                            "${project.owner} · ${project.createdText}",
                            style = Typography.bodySmall,
                            color = { it.colors.onSurfaceVariant },
                            maxLines = 1,
                        )
                    }
                    Label(project.budgetText, style = Typography.labelMedium, maxLines = 1)
                }
            }
            if (index < 4) Divider()
        }
    }

    private fun projectsCard(): Widget = CardWidget(padding = Spacing.x5, widePadding = Spacing.x6) {
        Column(gap = Spacing.x4) {
            adaptiveContent(
                threshold = Breakpoint.LG.minWidth,
                narrow = {
                    Column(gap = Spacing.x2, align = Align.Start, fillWidth = true) {
                        projectTitle()
                        Button(
                            "Обновить",
                            variant = ButtonVariant.Secondary,
                            size = ControlSize.SM,
                            onClick = { vm.refreshProjects() },
                        )
                    }
                },
                wide = {
                    Row(fillWidth = true, align = Align.Center, gap = Spacing.x3) {
                        expanded { projectTitle() }
                        Button(
                            "Обновить",
                            variant = ButtonVariant.Secondary,
                            size = ControlSize.SM,
                            onClick = { vm.refreshProjects() },
                        )
                    }
                },
            )
            if (vm.projectsError.isNotEmpty()) {
                Alert(
                    title = "API недоступен",
                    description = vm.projectsError,
                    tone = Tone.Warning,
                    action = {
                        Button(
                            "Повторить",
                            variant = ButtonVariant.Text,
                            size = ControlSize.SM,
                            onClick = { vm.refreshProjects() },
                        )
                    },
                )
            }
            projectFilters()
            adaptiveContent(
                threshold = 1024f,
                narrow = { projectsMobileList() },
                wide = {
                    DataTable(
                        columns = listOf(
                    DataColumn("name", "Название", weight = 2.1f, sortable = true),
                    DataColumn("owner", "Владелец", weight = 1.5f, sortable = true),
                    DataColumn("status", "Статус", weight = 1.0f, sortable = true),
                    DataColumn("tags", "Теги", weight = 1.7f),
                    DataColumn("budget", "Бюджет", align = TextAlign.End, weight = 0.9f, sortable = true),
                    DataColumn("createdAt", "Создан", align = TextAlign.End, weight = 1.05f, sortable = true),
                ),
                rows = vm.projectRows.map { project ->
                    listOf(
                        project.name,
                        project.owner,
                        project.statusLabel,
                        project.tags.joinToString(","),
                        project.budgetText,
                        project.createdText,
                    )
                },
                selectedRows = vm.selectedProjectRows,
                onSelectRow = vm::toggleProjectSelection,
                sortKey = vm.projectSort,
                sortDirection = if (vm.projectOrder == "asc") "ascending" else "descending",
                onSort = vm::sortProjects,
                page = vm.projectPage,
                pageCount = vm.projectPageCount,
                pageSize = vm.projectPageSize,
                totalRows = vm.projectTotal,
                onPage = vm::goToProjectPage,
                onPageSize = vm::changeProjectPageSize,
                state = vm.projectsState,
                onRetry = { vm.refreshProjects() },
                onClearSelection = { vm.selectedProjectRows = emptySet() },
                        statusKey = "status",
                        tagsKey = "tags",
                    )
                },
            )
        }
    }

    private fun projectsMobileList(): Widget = Column(fillWidth = true) {
        vm.projectRows.forEachIndexed { index, project ->
            Column(gap = Spacing.x1, padding = Spacing.x4, fillWidth = true) {
                Row(fillWidth = true, align = Align.Center, gap = Spacing.x2) {
                    expanded { Label(project.name, style = Typography.titleSmall, maxLines = 1) }
                    Tag(project.statusLabel, toneFor(project.statusLabel), compact = true)
                }
                Label(
                    project.owner,
                    style = Typography.bodySmall,
                    color = { it.colors.onSurfaceVariant },
                    maxLines = 1,
                )
                Row(fillWidth = true, align = Align.Center, gap = Spacing.x2) {
                    Row(gap = Spacing.x1, align = Align.Center, fillWidth = false) {
                        project.tags.take(3).forEach { tag -> Tag("#$tag", TagTone.Info, compact = true) }
                    }
                    expanded { Spacer() }
                    Label(project.budgetText, style = Typography.labelMedium, maxLines = 1)
                }
            }
            if (index < vm.projectRows.lastIndex) Divider()
        }
        if (vm.projectPageCount > 1) {
            Pagination(page = vm.projectPage, pageCount = vm.projectPageCount, onPage = vm::goToProjectPage)
        }
    }

    private fun projectTitle(): Widget = Column(gap = 2f, fillWidth = true) {
        Heading("Проекты", level = 2)
        Label(
            "${if (vm.projectsError.isEmpty()) "Данные API" else "Локальный fallback"} · найдено ${vm.projectTotal}",
            style = Typography.bodySmall,
            color = { it.colors.onSurfaceVariant },
            maxLines = 2,
        )
    }

    private fun projectFilters(): Widget = Column(gap = Spacing.x3) {
        Grid(
            columns = responsive(xs = 1, sm = 2, md = 2, xl = 4),
            gap = Spacing.x3,
        ) {
            TextField(
                property = vm::query,
                label = "Поиск",
                hint = "Название или владелец",
            )
            Select(
                options = statusOptions,
                binding = signalBinding(vm.statusFilter, "projects-status"),
                label = "Статус",
                onSelect = { vm.setStatusFilter(it) },
            )
            Select(
                options = ownerOptions(),
                binding = signalBinding(vm.ownerFilter, "projects-owner"),
                label = "Владелец",
                onSelect = { vm.setOwnerFilter(it) },
            )
            Select(
                options = tagOptions(),
                binding = signalBinding(vm.tagFilter, "projects-tag"),
                label = "Тег",
                onSelect = { vm.setTagFilter(it) },
            )
        }
        Row(fillWidth = true, align = Align.Center, gap = Spacing.x2) {
            expanded { Spacer() }
            Button(
                "Сбросить",
                variant = ButtonVariant.Text,
                size = ControlSize.SM,
                onClick = { vm.resetProjectFilters() },
            )
            Button("Найти", size = ControlSize.SM, onClick = { vm.applyProjectFilters() })
        }
    }

    private val statusOptions: List<SelectOption<String>> = listOf(
        SelectOption("", "Все статусы"),
        SelectOption("active", "В работе"),
        SelectOption("review", "Ревью"),
        SelectOption("done", "Готово"),
        SelectOption("paused", "Пауза"),
    )

    private fun ownerOptions(): List<SelectOption<String>> = buildList {
        add(SelectOption("", "Все"))
        vm.owners.forEach { owner -> add(SelectOption(owner, owner)) }
    }

    private fun tagOptions(): List<SelectOption<String>> = buildList {
        add(SelectOption("", "Все"))
        vm.tags.forEach { tag -> add(SelectOption(tag, "#$tag")) }
    }

    private fun settingsCard(): Widget = CardWidget(padding = Spacing.x5, widePadding = Spacing.x6) {
        Column(gap = Spacing.x5) {
            Heading("Настройки пространства", level = 2)
            Label(
                "Поля раскладываются в 1, 2 или 3 колонки по брейкпоинтам.",
                style = Typography.bodySmall,
                color = { it.colors.onSurfaceVariant },
            )
            Grid(columns = responsive(xs = 1, md = 2, xl = 3), gap = Spacing.x4) {
                TextField(property = vm::workspaceName, label = "Рабочее пространство")
                TextField(
                    property = vm::contactEmail,
                    label = "Контактный email",
                    type = FieldType.Email,
                )
                TextField(property = vm::timezone, label = "Часовой пояс")
                TextField(property = vm::teamSize, label = "Команда, человек", type = FieldType.Number)
                TextField(property = vm::defaultBranch, label = "Основная ветка")
                TextField(property = vm::notifications, label = "Уведомления")
            }
            Switch(bind(vm::emailNotifications), label = "Email-уведомления")
            Row(fillWidth = true, align = Align.Center) {
                expanded { Spacer() }
                Button("Сохранить", onClick = {})
            }
        }
    }

}

fun toneFor(status: String): TagTone = when (status) {
    "В работе", "Стабильно" -> TagTone.Success
    "Ревью", "На ревью", "Проверка" -> TagTone.Warning
    "Готово", "Завершено" -> TagTone.Primary
    else -> TagTone.Neutral
}

class AppView(
    private val vm: AppVM,
) : View {
    override fun content(): Widget = when (vm.route) {
        Route.LOGIN -> component(
            vm.login,
            LoginView(vm.login, vm::toggleTheme),
        )

        Route.DASHBOARD -> component(
            vm.dashboard,
            DashboardView(vm.dashboard, vm::toggleTheme, vm::openGallery, vm::logout),
        )

        Route.GALLERY -> component(
            vm.gallery,
            GalleryView(vm.gallery, vm::backToDashboard, vm::toggleTheme),
        )
    }
}
