package dev.ivlev.silent.ui.demo

import dev.ivlev.silent.ui.reactive.Disposable
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
)

data class Project(
    val name: String,
    val status: String,
    val updated: String,
    val owner: String,
)

interface ProjectsRepository {
    fun stats(): List<Stat>
    fun projects(): List<Project>
}

class FakeProjectsRepository : ProjectsRepository {
    override fun stats(): List<Stat> = listOf(
        Stat("Активные проекты", "24", "+12% за месяц"),
        Stat("Открытые задачи", "128", "8 в работе"),
        Stat("Успешные сборки", "96%", "за последние 7 дней"),
    )

    override fun projects(): List<Project> = listOf(
        Project("Silent UI", "В работе", "2 мин назад", "Анна"),
        Project("Silent Protocol", "Стабильно", "18 мин назад", "Илья"),
        Project("Design Tokens", "Проверка", "1 ч назад", "Мария"),
        Project("Docs Portal", "В работе", "3 ч назад", "Олег"),
        Project("Bench Suite", "Стабильно", "вчера", "Дарья"),
        Project("Release 1.0", "Планирование", "вчера", "Анна"),
    )
}
