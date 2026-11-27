package dev.ivlev.silent.ui.demo

import dev.ivlev.silent.ui.data.ApiProject
import dev.ivlev.silent.ui.data.ProjectStatus
import dev.ivlev.silent.ui.data.label
import dev.ivlev.silent.ui.reactive.Disposable
import dev.ivlev.silent.ui.tokens.Tone
import kotlinx.datetime.Instant
import java.text.NumberFormat
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

data class AuthUser(
    val name: String,
    val email: String,
)

sealed interface AuthResult {
    data class Success(val user: AuthUser) : AuthResult
    data class Failure(val message: String) : AuthResult
}

interface AuthApi {
    fun login(email: String, password: String, callback: (AuthResult) -> Unit)
}

class FakeAuthApi(
    private val delayMs: Long = 900,
) : AuthApi, Disposable {
    private val executor = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "silent-auth").apply { isDaemon = true }
    }

    override fun login(email: String, password: String, callback: (AuthResult) -> Unit) {
        val action = {
            val result = if (email.trim().lowercase() == "error@silent.dev") {
                AuthResult.Failure("Пользователь не найден")
            } else {
                AuthResult.Success(AuthUser(email.substringBefore('@').ifBlank { "user" }, email))
            }
            callback(result)
        }
        if (delayMs <= 0L) {
            action()
        } else {
            executor.schedule(action, delayMs, TimeUnit.MILLISECONDS)
        }
    }

    override fun dispose() {
        executor.shutdownNow()
    }
}

data class Stat(
    val label: String,
    val value: String,
    val delta: String,
    val icon: String = "",
    val tone: Tone = Tone.Neutral,
) {
    val hint: String
        get() = delta
}

data class Project(
    val name: String,
    val status: String,
    val updated: String,
    val owner: String,
    val budget: String = "",
    val created: String = "",
    val tags: List<String> = emptyList(),
)

data class ProjectRow(
    val id: UInt,
    val name: String,
    val owner: String,
    val status: ProjectStatus?,
    val statusLabel: String,
    val tags: List<String>,
    val budgetText: String,
    val createdText: String,
    val budget: Double = 0.0,
    val createdAtMillis: Long = 0L,
) {
    companion object {
        fun fromApi(project: ApiProject): ProjectRow = ProjectRow(
            id = project.id,
            name = project.name,
            owner = project.owner,
            status = project.status,
            statusLabel = project.status.label(),
            tags = project.tags,
            budgetText = formatBudget(project.budget),
            createdText = formatDate(project.createdAt),
            budget = project.budget,
            createdAtMillis = project.createdAt.toEpochMilliseconds(),
        )

        fun fromLocal(project: Project, index: Int): ProjectRow {
            val amount = project.budget
                .replace("\u00A0", "")
                .replace(" ", "")
                .removeSuffix("₽")
                .toDoubleOrNull()
                ?: 0.0
            val millis = runCatching {
                java.time.LocalDate.parse(project.created, DateTimeFormatter.ofPattern("dd.MM.yyyy"))
                    .atStartOfDay(ZoneId.systemDefault())
                    .toInstant()
                    .toEpochMilli()
            }.getOrDefault(0L)
            return ProjectRow(
                id = index.toUInt(),
                name = project.name,
                owner = project.owner,
                status = project.status.toProjectStatus(),
                statusLabel = project.status,
                tags = project.tags,
                budgetText = project.budget,
                createdText = project.created,
                budget = amount,
                createdAtMillis = millis,
            )
        }
    }
}

fun String.toProjectStatus(): ProjectStatus? = when (this) {
    "В работе", "active" -> ProjectStatus.Active
    "Ревью", "review" -> ProjectStatus.Review
    "Готово", "done" -> ProjectStatus.Done
    "Пауза", "paused" -> ProjectStatus.Paused
    else -> null
}

fun formatBudget(value: Double): String =
    "${NumberFormat.getNumberInstance(Locale.forLanguageTag("ru-RU")).apply { maximumFractionDigits = 0 }.format(value)} ₽"

fun formatDate(value: Instant): String =
    DateTimeFormatter.ofPattern("dd.MM.yyyy").withZone(ZoneId.systemDefault())
        .format(java.time.Instant.ofEpochMilli(value.toEpochMilliseconds()))

data class StatusSummary(
    val label: String,
    val count: Int,
    val total: Int,
    val tone: Tone,
) {
    val percent: Float
        get() = if (total == 0) 0f else count.toFloat() / total.toFloat()
}

interface ProjectsRepository {
    fun stats(): List<Stat>
    fun projects(): List<Project>
    fun owners(): List<String>
    fun tags(): List<String>
    fun statuses(): List<StatusSummary>
}

class FakeProjectsRepository : ProjectsRepository {
    override fun owners(): List<String> = listOf(
        "Ада Ловлейс",
        "Алан Тьюринг",
        "Барбара Лисков",
        "Грейс Хоппер",
        "Иван Лебедев",
        "Кэтрин Джонсон",
        "Линус Торвальдс",
        "Маргарет Гамильтон",
    )

    override fun tags(): List<String> = listOf(
        "api", "backend", "data", "design", "docs", "frontend",
        "infra", "mobile", "performance", "research", "security", "ui",
    )

    override fun statuses(): List<StatusSummary> = listOf(
        StatusSummary("В работе", 60, 240, Tone.Success),
        StatusSummary("Ревью", 60, 240, Tone.Warning),
        StatusSummary("Готово", 60, 240, Tone.Primary),
        StatusSummary("Пауза", 60, 240, Tone.Neutral),
    )
    override fun stats(): List<Stat> = listOf(
        Stat("Проекты", "240", "60 в работе · 60 на ревью", "folder", Tone.Primary),
        Stat("В работе", "60", "25% портфеля", "chart", Tone.Success),
        Stat("На ревью", "60", "25% ждут решения", "spark", Tone.Warning),
        Stat("Завершено", "60", "25% портфеля", "wallet", Tone.Success),
        Stat("Владельцев", "8", "Участники из справочника", "team", Tone.Neutral),
        Stat("Тегов", "12", "Сквозная рубрикация", "tags", Tone.Neutral),
    )

    override fun projects(): List<Project> = listOf(
        Project("Северный Атлас", "В работе", "27 нояб. 2026 г.", "Ада Ловлейс", "5 000 ₽", "27.11.2026", listOf("frontend")),
        Project("Вольный Мост", "Ревью", "27 нояб. 2026 г.", "Маргарет Гамильтон", "13 169 ₽", "27.11.2026", listOf("performance")),
        Project("Северный Компас", "Ревью", "26 нояб. 2026 г.", "Грейс Хоппер", "6 237 ₽", "26.11.2026", listOf("mobile", "security")),
        Project("Вольный Ключ", "Готово", "25 нояб. 2026 г.", "Линус Торвальдс", "14 406 ₽", "25.11.2026", listOf("design", "mobile")),
        Project("Северный Пульс", "Готово", "24 нояб. 2026 г.", "Алан Тьюринг", "7 474 ₽", "24.11.2026", listOf("ui", "backend", "performance")),
        Project("Тихий Контур", "В работе", "23 нояб. 2026 г.", "Кэтрин Джонсон", "9 820 ₽", "23.11.2026", listOf("ui", "research")),
    )
}
