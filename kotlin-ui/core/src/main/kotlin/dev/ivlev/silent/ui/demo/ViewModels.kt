package dev.ivlev.silent.ui.demo

import dev.ivlev.silent.ui.annotations.Computed
import dev.ivlev.silent.ui.annotations.Reactive
import dev.ivlev.silent.ui.annotations.Watch
import dev.ivlev.silent.ui.data.ApiProjectMeta
import dev.ivlev.silent.ui.data.ApiProjectPage
import dev.ivlev.silent.ui.data.ProjectApiExecutor
import dev.ivlev.silent.ui.data.ProjectQuery
import dev.ivlev.silent.ui.data.ProjectStatus
import dev.ivlev.silent.ui.data.ProjectsApi
import dev.ivlev.silent.ui.data.UiThread
import dev.ivlev.silent.ui.data.label
import dev.ivlev.silent.ui.layout.ScrollState
import dev.ivlev.silent.ui.lifecycle.ViewModel
import dev.ivlev.silent.ui.reactive.MutableSignal
import dev.ivlev.silent.ui.tokens.Theme
import dev.ivlev.silent.ui.tokens.Themes
import dev.ivlev.silent.ui.widgets.DataState
import kotlin.math.roundToInt

enum class Route {
    LOGIN,
    DASHBOARD,
    GALLERY,
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
    private val api: ProjectsApi,
) : ViewModel() {
    private val fallbackProjects: List<Project> = repository.projects()
    private val fallbackRows: List<ProjectRow> = fallbackProjects.mapIndexed { index, project ->
        ProjectRow.fromLocal(project, index)
    }

    @Reactive var stats: List<Stat> = repository.stats()
    @Reactive var projects: List<Project> = fallbackProjects
    @Reactive var owners: List<String> = repository.owners()
    @Reactive var tags: List<String> = repository.tags()
    @Reactive var statuses: List<StatusSummary> = repository.statuses()
    @Reactive var dashboardRows: List<ProjectRow> = fallbackRows.take(5)
    @Reactive var dashboardLoading = false
    @Reactive var dashboardError = ""
    @Reactive var projectRows: List<ProjectRow> = fallbackRows
    @Reactive var projectTotal = fallbackRows.size
    @Reactive var projectPage = 1
    @Reactive var projectPageSize = 10
    @Reactive var projectSort = "createdAt"
    @Reactive var projectOrder = "desc"
    @Reactive var projectsLoading = false
    @Reactive var projectsError = ""
    @Reactive var projectsLoaded = false
    @Reactive var selectedProjectRows: Set<Int> = emptySet()
    @Reactive var lastRefresh = ""

    val statusFilter = MutableSignal("")
    val ownerFilter = MutableSignal("")
    val tagFilter = MutableSignal("")
    val scroll = ScrollState()

    @Reactive var selectedNav = "overview"
    @Reactive var profileOpen = false
    @Reactive var query = ""
    @Reactive var workspaceName = "Silent UI"
    @Reactive var contactEmail = "team@silent.dev"
    @Reactive var timezone = "Europe/Moscow"
    @Reactive var teamSize = "12"
    @Reactive var defaultBranch = "main"
    @Reactive var notifications = "Email"
    @Reactive var emailNotifications = true

    @Computed val filteredProjects get() = projects.filter { it.name.contains(query, ignoreCase = true) }

    @Computed val projectPageCount get() = if (projectTotal <= 0) 1 else ((projectTotal + projectPageSize - 1) / projectPageSize)

    @Computed val projectsState get() = when {
        projectsLoading && projectRows.isEmpty() -> DataState.Loading
        projectsError.isNotEmpty() && projectRows.isEmpty() -> DataState.Error
        projectRows.isEmpty() -> DataState.Empty
        else -> DataState.Ready
    }

    @Computed val heading get() = when (selectedNav) {
        "projects" -> "Проекты"
        "reports" -> "Отчёты"
        "settings" -> "Настройки"
        else -> "Dashboard"
    }

    @Computed val subtitle get() = when (selectedNav) {
        "projects" -> "Список проектов, владельцев и статусов"
        "reports" -> "Метрики сборок и активность команды"
        "settings" -> "Параметры рабочего пространства"
        else -> "Сводка портфеля проектов: статусы, владельцы и теги"
    }

    override fun created() {
        refreshDashboard()
        if (selectedNav == "projects") refreshProjects()
    }

    override fun dispose() {
        super.dispose()
    }

    @Watch("selectedNav", immediate = true)
    fun onNavigationChanged(next: String, prev: String) {
        scroll.scrollTo(0f)
        if (next == "projects" && !projectsLoaded && !projectsLoading) {
            refreshProjects()
        }
    }

    fun selectNavigation(id: String) {
        selectedNav = id
        if (id == "projects" && !projectsLoaded && !projectsLoading) {
            refreshProjects()
        }
    }

    fun refreshDashboard() {
        if (dashboardLoading) return
        dashboardLoading = true
        ProjectApiExecutor.submit {
            val snapshot = runCatching { fetchDashboardSnapshot() }
            UiThread.post {
                if (disposed) return@post
                dashboardLoading = false
                snapshot.onSuccess { data ->
                    applyDashboard(data)
                    dashboardError = ""
                    lastRefresh = data.page.items.firstOrNull()?.let { "API" } ?: "API"
                }.onFailure { error ->
                    dashboardError = error.message ?: "Сервер недоступен"
                }
            }
        }
    }

    fun refreshDashboardBlocking() {
        dashboardLoading = true
        val snapshot = runCatching { fetchDashboardSnapshot() }
        dashboardLoading = false
        snapshot.onSuccess { data ->
            applyDashboard(data)
            dashboardError = ""
        }.onFailure { error ->
            dashboardError = error.message ?: "Сервер недоступен"
        }
    }

    fun refreshProjects(resetPage: Boolean = false) {
        if (projectsLoading) return
        if (resetPage) projectPage = 1
        projectsLoading = true
        if (projectRows.isEmpty()) projectsError = ""
        val request = ProjectQuery(
            page = projectPage,
            pageSize = projectPageSize,
            sort = projectSort,
            order = projectOrder,
            q = query,
            status = statusFilter.value.toProjectStatus(),
            owner = ownerFilter.value.ifBlank { null },
            tag = tagFilter.value.ifBlank { null },
        )
        ProjectApiExecutor.submit {
            val result = runCatching { api.projects(request) }
            UiThread.post {
                if (disposed) return@post
                projectsLoading = false
                result.onSuccess { page -> applyProjectPage(page) }
                    .onFailure { error ->
                        projectsError = error.message ?: "Сервер недоступен"
                        projectsLoaded = true
                        if (projectRows.isEmpty()) {
                            projectRows = fallbackRows
                            projectTotal = fallbackRows.size
                            projectPage = 1
                        }
                    }
            }
        }
    }

    fun refreshProjectsBlocking() {
        projectsLoading = true
        val request = ProjectQuery(
            page = projectPage,
            pageSize = projectPageSize,
            sort = projectSort,
            order = projectOrder,
            q = query,
            status = statusFilter.value.toProjectStatus(),
            owner = ownerFilter.value.ifBlank { null },
            tag = tagFilter.value.ifBlank { null },
        )
        val result = runCatching { api.projects(request) }
        projectsLoading = false
        result.onSuccess { applyProjectPage(it) }.onFailure { error ->
            projectsError = error.message ?: "Сервер недоступен"
            projectsLoaded = true
            if (projectRows.isEmpty()) {
                projectRows = fallbackRows
                projectTotal = fallbackRows.size
                projectPage = 1
            }
        }
    }

    fun applyProjectFilters() {
        refreshProjects(resetPage = true)
    }

    fun resetProjectFilters() {
        query = ""
        statusFilter.set("")
        ownerFilter.set("")
        tagFilter.set("")
        refreshProjects(resetPage = true)
    }

    fun setStatusFilter(value: String) {
        statusFilter.set(value)
        refreshProjects(resetPage = true)
    }

    fun setOwnerFilter(value: String) {
        ownerFilter.set(value)
        refreshProjects(resetPage = true)
    }

    fun setTagFilter(value: String) {
        tagFilter.set(value)
        refreshProjects(resetPage = true)
    }

    fun sortProjects(key: String) {
        if (projectSort == key) {
            projectOrder = if (projectOrder == "asc") "desc" else "asc"
        } else {
            projectSort = key
            projectOrder = "asc"
        }
        refreshProjects(resetPage = true)
    }

    fun changeProjectPageSize(size: Int) {
        if (size == projectPageSize) return
        projectPageSize = size
        projectPage = 1
        refreshProjects()
    }

    fun goToProjectPage(page: Int) {
        if (page < 1 || page > projectPageCount || page == projectPage) return
        projectPage = page
        refreshProjects()
    }

    fun toggleProjectSelection(index: Int, selected: Boolean) {
        selectedProjectRows = if (selected) {
            selectedProjectRows + index
        } else {
            selectedProjectRows - index
        }
    }

    private fun applyProjectPage(page: ApiProjectPage) {
        projectRows = page.items.map(ProjectRow::fromApi)
        projectTotal = page.total.toInt()
        projectPage = page.page.toInt().coerceAtLeast(1)
        projectPageSize = page.pageSize.toInt().coerceAtLeast(1)
        projectsError = ""
        projectsLoaded = true
        selectedProjectRows = emptySet()
        lastRefresh = "API"
    }

    private fun applyDashboard(data: DashboardSnapshot) {
        val total = data.page.total.toInt()
        stats = buildStats(total, data.counts, data.meta.owners.size, data.meta.tags.size)
        statuses = ProjectStatus.entries.map { status ->
            StatusSummary(
                label = status.label(),
                count = data.counts[status] ?: 0,
                total = total,
                tone = status.tone(),
            )
        }
        owners = data.meta.owners
        tags = data.meta.tags
        dashboardRows = data.page.items.take(5).map(ProjectRow::fromApi)
        projects = dashboardRows.map { row ->
            Project(
                name = row.name,
                status = row.statusLabel,
                updated = row.createdText,
                owner = row.owner,
                budget = row.budgetText,
                created = row.createdText,
                tags = row.tags,
            )
        }
    }

    private fun fetchDashboardSnapshot(): DashboardSnapshot {
        val page = api.projects(ProjectQuery(page = 1, pageSize = 10, sort = "createdAt", order = "desc"))
        val counts = ProjectStatus.entries.associateWith { status ->
            api.projects(
                ProjectQuery(
                    page = 1,
                    pageSize = 10,
                    sort = "createdAt",
                    order = "desc",
                    status = status,
                ),
            ).total.toInt()
        }
        val meta = api.meta()
        return DashboardSnapshot(page, counts, meta)
    }

    private fun buildStats(
        total: Int,
        counts: Map<ProjectStatus, Int>,
        ownerCount: Int,
        tagCount: Int,
    ): List<Stat> {
        fun percent(value: Int): Int = if (total == 0) 0 else (value * 100f / total).roundToInt()
        val active = counts[ProjectStatus.Active] ?: 0
        val review = counts[ProjectStatus.Review] ?: 0
        val done = counts[ProjectStatus.Done] ?: 0
        return listOf(
            Stat("Проекты", total.toString(), "$active в работе · $review на ревью", "folder", dev.ivlev.silent.ui.tokens.Tone.Primary),
            Stat("В работе", active.toString(), "${percent(active)}% портфеля", "chart", dev.ivlev.silent.ui.tokens.Tone.Success),
            Stat("На ревью", review.toString(), "${percent(review)}% ждут решения", "spark", dev.ivlev.silent.ui.tokens.Tone.Warning),
            Stat("Завершено", done.toString(), "${percent(done)}% портфеля", "wallet", dev.ivlev.silent.ui.tokens.Tone.Success),
            Stat("Владельцев", ownerCount.toString(), "Участники из справочника", "team", dev.ivlev.silent.ui.tokens.Tone.Neutral),
            Stat("Тегов", tagCount.toString(), "Сквозная рубрикация", "tags", dev.ivlev.silent.ui.tokens.Tone.Neutral),
        )
    }

    private fun ProjectStatus.tone(): dev.ivlev.silent.ui.tokens.Tone = when (this) {
        ProjectStatus.Active -> dev.ivlev.silent.ui.tokens.Tone.Success
        ProjectStatus.Review -> dev.ivlev.silent.ui.tokens.Tone.Warning
        ProjectStatus.Done -> dev.ivlev.silent.ui.tokens.Tone.Primary
        ProjectStatus.Paused -> dev.ivlev.silent.ui.tokens.Tone.Neutral
    }

    private data class DashboardSnapshot(
        val page: ApiProjectPage,
        val counts: Map<ProjectStatus, Int>,
        val meta: ApiProjectMeta,
    )
}

class AppVM(
    val login: LoginVM,
    val dashboard: DashboardVM,
) : ViewModel() {
    val gallery = GalleryVM()
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

    fun openGallery() {
        route = Route.GALLERY
    }

    fun backToDashboard() {
        route = Route.DASHBOARD
    }

    override fun onDispose() {
        login.dispose()
        dashboard.dispose()
        gallery.dispose()
    }
}

fun themeOf(dark: Boolean): Theme = Themes.of(dark)
