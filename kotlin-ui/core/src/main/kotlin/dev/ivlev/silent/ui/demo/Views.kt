package dev.ivlev.silent.ui.demo

import dev.ivlev.silent.ui.form.bind
import dev.ivlev.silent.ui.layout.Align
import dev.ivlev.silent.ui.layout.Box
import dev.ivlev.silent.ui.layout.Column
import dev.ivlev.silent.ui.layout.ContentPage
import dev.ivlev.silent.ui.layout.Grid
import dev.ivlev.silent.ui.layout.NavItem
import dev.ivlev.silent.ui.layout.Row
import dev.ivlev.silent.ui.layout.Scroll
import dev.ivlev.silent.ui.layout.Spacer
import dev.ivlev.silent.ui.layout.Widget
import dev.ivlev.silent.ui.layout.adaptiveContent
import dev.ivlev.silent.ui.layout.adaptiveScaffold
import dev.ivlev.silent.ui.layout.expanded
import dev.ivlev.silent.ui.layout.screen
import dev.ivlev.silent.ui.lifecycle.View
import dev.ivlev.silent.ui.lifecycle.component
import dev.ivlev.silent.ui.responsive.responsive
import dev.ivlev.silent.ui.tokens.Spacing
import dev.ivlev.silent.ui.tokens.Typography
import dev.ivlev.silent.ui.widgets.Button
import dev.ivlev.silent.ui.widgets.ButtonVariant
import dev.ivlev.silent.ui.widgets.Card as CardWidget
import dev.ivlev.silent.ui.widgets.Checkbox
import dev.ivlev.silent.ui.widgets.Divider
import dev.ivlev.silent.ui.widgets.FieldType
import dev.ivlev.silent.ui.widgets.FormProgress
import dev.ivlev.silent.ui.widgets.Heading
import dev.ivlev.silent.ui.widgets.IconButton
import dev.ivlev.silent.ui.widgets.Table
import dev.ivlev.silent.ui.widgets.Tag
import dev.ivlev.silent.ui.widgets.TagTone
import dev.ivlev.silent.ui.widgets.Switch
import dev.ivlev.silent.ui.widgets.TextField
import dev.ivlev.silent.ui.widgets.Text as Label

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
                radius = 14f,
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
    private val onLogout: () -> Unit,
) : View {
    private val navItems = listOf(
        NavItem("overview", "Обзор", "O"),
        NavItem("projects", "Проекты", "P"),
        NavItem("reports", "Отчёты", "R"),
        NavItem("settings", "Настройки", "S"),
    )

    override fun content(): Widget = screen {
        adaptiveScaffold(
            items = navItems,
            selectedId = { vm.selectedNav },
            onSelect = { vm.selectedNav = it },
        ) {
            Column(fillWidth = true, fillHeight = true) {
                Box(fillWidth = true, background = { it.colors.surfaceContainerLowest }) {
                    ContentPage(verticalPadding = Spacing.x4) {
                        Row(fillWidth = true, align = Align.Center) {
                            expanded {
                                Column(gap = 4f, fillWidth = true) {
                                    Heading(vm.heading)
                                    Label(
                                        vm.subtitle,
                                        style = Typography.bodySmall,
                                        color = { it.colors.onSurfaceVariant },
                                    )
                                }
                            }
                            Row(gap = Spacing.x2, fillWidth = false) {
                                IconButton("Aa", label = "Тема", onClick = onToggleTheme)
                                Button("Выйти", variant = ButtonVariant.Secondary, onClick = onLogout)
                            }
                        }
                    }
                }
                Divider()
                expanded {
                    Scroll(state = vm.scroll) {
                        ContentPage(verticalPadding = Spacing.x5) {
                            Column(gap = Spacing.x6) {
                                when (vm.selectedNav) {
                                    "settings" -> settingsCard()
                                    "projects" -> projectsCard()
                                    "reports" -> statsGrid()
                                    else -> {
                                        statsGrid()
                                        projectsCard()
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private fun statsGrid(): Widget = Grid(
        columns = responsive(xs = 1, sm = 1, md = 2, xl = 3),
        gap = Spacing.x4,
    ) {
        vm.stats.forEach { stat ->
            CardWidget(padding = Spacing.x5, widePadding = Spacing.x6) {
                Column(gap = 6f) {
                    Label(
                        stat.label,
                        style = Typography.labelMedium,
                        color = { it.colors.onSurfaceMuted },
                    )
                    Heading(stat.value, level = 2)
                    Label(
                        stat.delta,
                        style = Typography.labelSmall,
                        color = { it.colors.success },
                    )
                }
            }
        }
    }

    private fun projectsCard(): Widget = CardWidget(padding = Spacing.x5, widePadding = Spacing.x6) {
        Column(gap = Spacing.x4) {
            Row(fillWidth = true, align = Align.Center) {
                Heading("Проекты", level = 2)
                expanded { Spacer() }
                Label(
                    "Найдено: ${vm.filteredProjects.size}",
                    style = Typography.labelMedium,
                    color = { it.colors.onSurfaceMuted },
                )
            }
            TextField(
                property = vm::query,
                label = "Поиск",
                hint = "Название проекта",
            )
            projectsContent()
        }
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

    private fun projectsContent(): Widget = adaptiveContent(
        narrow = {
            Column(gap = Spacing.x2) {
                vm.filteredProjects.forEach { project ->
                    CardWidget(
                        padding = Spacing.x4,
                        widePadding = Spacing.x5,
                        background = { it.colors.surfaceContainerLow },
                    ) {
                        Column(gap = 4f) {
                            Row(fillWidth = true, align = Align.Center) {
                                Label(project.name, style = Typography.titleSmall)
                                expanded { Spacer() }
                                Tag(project.status, toneFor(project.status))
                            }
                            Label(
                                "${project.owner} · ${project.updated}",
                                style = Typography.bodySmall,
                                color = { it.colors.onSurfaceVariant },
                            )
                        }
                    }
                }
            }
        },
        wide = {
            Table(
                headers = listOf("Проект", "Статус", "Владелец", "Обновлён"),
                rows = vm.filteredProjects.map {
                    listOf(it.name, it.status, it.owner, it.updated)
                },
                columnWeights = listOf(2.0f, 1.7f, 1.1f, 1.5f),
            )
        },
    )
}

fun toneFor(status: String): TagTone = when (status) {
    "Стабильно" -> TagTone.Success
    "Проверка" -> TagTone.Warning
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
            DashboardView(vm.dashboard, vm::toggleTheme, vm::logout),
        )
    }
}
