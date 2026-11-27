package dev.ivlev.silent.ui.demo

import dev.ivlev.silent.ui.annotations.Computed
import dev.ivlev.silent.ui.annotations.Reactive
import dev.ivlev.silent.ui.annotations.Watch
import dev.ivlev.silent.ui.layout.ScrollState
import dev.ivlev.silent.ui.lifecycle.ViewModel
import dev.ivlev.silent.ui.tokens.Theme
import dev.ivlev.silent.ui.tokens.Themes

enum class Route {
    LOGIN,
    DASHBOARD,
}

class LoginVM(
    private val auth: AuthApi,
) : ViewModel() {
    val form = LoginForm()

    @Reactive var serverMessage = ""
    @Reactive var viewedMessage = ""

    var onAuthenticated: (() -> Unit)? = null

    @Computed val canSubmit get() = form.isValid && !form.isSubmitting.value

    @Watch("serverMessage")
    fun onServerMessage(next: String, prev: String) {
        viewedMessage = next
    }

    override fun created() {
        form.onSubmit = { submit() }
    }

    private fun submit() {
        serverMessage = ""
        auth.login(form.email, form.password) { result ->
            if (disposed) return@login
            when (result) {
                is AuthResult.Success -> {
                    form.completeSubmit()
                    onAuthenticated?.invoke()
                }

                is AuthResult.Failure -> {
                    form.failSubmit(mapOf("email" to result.message))
                    serverMessage = result.message
                }
            }
        }
    }
}

class DashboardVM(
    repository: ProjectsRepository,
) : ViewModel() {
    val stats: List<Stat> = repository.stats()
    val projects: List<Project> = repository.projects()
    val scroll = ScrollState()

    @Reactive var selectedNav = "overview"
    @Reactive var query = ""
    @Reactive var workspaceName = "Silent UI"
    @Reactive var contactEmail = "team@silent.dev"
    @Reactive var timezone = "Europe/Moscow"
    @Reactive var teamSize = "12"
    @Reactive var defaultBranch = "main"
    @Reactive var notifications = "Email"
    @Reactive var emailNotifications = true

    @Computed val filteredProjects get() = projects.filter { it.name.contains(query, ignoreCase = true) }

    @Computed val heading get() = when (selectedNav) {
        "projects" -> "Проекты"
        "reports" -> "Отчёты"
        "settings" -> "Настройки"
        else -> "Обзор"
    }

    @Computed val subtitle get() = when (selectedNav) {
        "projects" -> "Список проектов, владельцев и статусов"
        "reports" -> "Метрики сборок и активность команды"
        "settings" -> "Параметры рабочего пространства"
        else -> "Сводка по проектам, задачам и сборкам"
    }

    @Watch("selectedNav", immediate = true)
    fun onNavigationChanged(next: String, prev: String) {
        scroll.scrollTo(0f)
    }
}

class AppVM(
    val login: LoginVM,
    val dashboard: DashboardVM,
) : ViewModel() {
    @Reactive var route = Route.LOGIN
    @Reactive var dark = false

    @Computed val theme get() = if (dark) Themes.dark else Themes.light

    override fun created() {
        login.onAuthenticated = {
            route = Route.DASHBOARD
        }
    }

    fun toggleTheme() {
        dark = !dark
    }

    fun logout() {
        login.form.reset()
        login.serverMessage = ""
        route = Route.LOGIN
    }

    override fun onDispose() {
        login.dispose()
        dashboard.dispose()
    }
}

fun themeOf(dark: Boolean): Theme = Themes.of(dark)
