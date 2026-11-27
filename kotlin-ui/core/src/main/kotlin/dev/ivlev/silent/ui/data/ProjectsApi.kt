package dev.ivlev.silent.ui.data

import dev.ivlev.silent.ui.reactive.Disposable
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

const val PROTOCOL_CONTENT_TYPE: String = "application/x-silent-protocol"

object ApiSettings {
    val baseUrl: String
        get() = System.getenv("SILENT_API_URL")
            ?.trim()
            ?.trimEnd('/')
            ?.takeIf { it.isNotEmpty() }
            ?: "http://127.0.0.1:6108"
}

data class HttpResponse(
    val status: Int,
    val contentType: String?,
    val body: ByteArray,
)

interface HttpTransport {
    fun get(url: String, accept: String): HttpResponse
}

class UrlConnectionTransport(
    private val connectTimeoutMs: Int = 4_000,
    private val readTimeoutMs: Int = 8_000,
) : HttpTransport {
    override fun get(url: String, accept: String): HttpResponse {
        val connection = URL(url).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "GET"
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.setRequestProperty("Accept", accept)
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.use { it.readBytes() } ?: ByteArray(0)
            HttpResponse(status, connection.contentType, body)
        } finally {
            connection.disconnect()
        }
    }
}

data class ProjectQuery(
    val page: Int = 1,
    val pageSize: Int = 10,
    val sort: String = "createdAt",
    val order: String = "desc",
    val q: String? = null,
    val status: ProjectStatus? = null,
    val owner: String? = null,
    val tag: String? = null,
    val budgetMin: Double? = null,
    val budgetMax: Double? = null,
    val createdFrom: String? = null,
    val createdTo: String? = null,
) {
    fun toQueryString(): String {
        val values = linkedMapOf<String, String>()
        values["page"] = page.toString()
        values["pageSize"] = pageSize.toString()
        values["sort"] = sort
        values["order"] = order
        q?.takeIf { it.isNotBlank() }?.let { values["q"] = it }
        status?.let { values["status"] = it.wireName() }
        owner?.takeIf { it.isNotBlank() }?.let { values["owner"] = it }
        tag?.takeIf { it.isNotBlank() }?.let { values["tag"] = it }
        budgetMin?.let { values["budgetMin"] = it.toString() }
        budgetMax?.let { values["budgetMax"] = it.toString() }
        createdFrom?.takeIf { it.isNotBlank() }?.let { values["createdFrom"] = it }
        createdTo?.takeIf { it.isNotBlank() }?.let { values["createdTo"] = it }
        return values.entries.joinToString("&") { (key, value) ->
            "${encode(key)}=${encode(value)}"
        }
    }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())
}

class ProjectsApiException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

interface ProjectsApi {
    fun projects(query: ProjectQuery): ApiProjectPage

    fun meta(): ApiProjectMeta
}

class RemoteProjectsApi(
    private val transport: HttpTransport,
    private val baseUrl: String = ApiSettings.baseUrl,
) : ProjectsApi {
    override fun projects(query: ProjectQuery): ApiProjectPage {
        val bytes = request("/api/projects?${query.toQueryString()}")
        return try {
            ApiProjectPageCodec.decode(bytes)
        } catch (error: RuntimeException) {
            throw ProjectsApiException("Некорректный ответ /api/projects", error)
        }
    }

    override fun meta(): ApiProjectMeta {
        val bytes = request("/api/meta")
        return try {
            ApiProjectMetaCodec.decode(bytes)
        } catch (error: RuntimeException) {
            throw ProjectsApiException("Некорректный ответ /api/meta", error)
        }
    }

    private fun request(path: String): ByteArray {
        val response = try {
            transport.get("$baseUrl$path", PROTOCOL_CONTENT_TYPE)
        } catch (error: Exception) {
            throw ProjectsApiException("Сервер недоступен: $baseUrl", error)
        }
        if (response.status !in 200..299) {
            throw ProjectsApiException("HTTP ${response.status} для $path")
        }
        val contentType = response.contentType.orEmpty().substringBefore(';').trim()
        if (contentType != PROTOCOL_CONTENT_TYPE) {
            throw ProjectsApiException("Неожиданный Content-Type: $contentType")
        }
        return response.body
    }
}

object UiThread {
    @Volatile
    private var dispatcher: (() -> Unit) -> Unit = { action -> action() }

    fun install(next: (() -> Unit) -> Unit) {
        dispatcher = next
    }

    fun post(action: () -> Unit) {
        dispatcher(action)
    }
}

fun ProjectStatus.wireName(): String = when (this) {
    ProjectStatus.Active -> "active"
    ProjectStatus.Review -> "review"
    ProjectStatus.Done -> "done"
    ProjectStatus.Paused -> "paused"
}

fun ProjectStatus.label(): String = when (this) {
    ProjectStatus.Active -> "В работе"
    ProjectStatus.Review -> "Ревью"
    ProjectStatus.Done -> "Готово"
    ProjectStatus.Paused -> "Пауза"
}

fun ProjectStatus.toneName(): String = when (this) {
    ProjectStatus.Active -> "success"
    ProjectStatus.Review -> "warning"
    ProjectStatus.Done -> "primary"
    ProjectStatus.Paused -> "neutral"
}

object ProjectApiExecutor : Disposable {
    private val executor = Executors.newFixedThreadPool(4) { runnable ->
        Thread(runnable, "silent-api").apply { isDaemon = true }
    }

    fun submit(action: () -> Unit) {
        executor.execute(action)
    }

    override fun dispose() {
        executor.shutdownNow()
        runCatching { executor.awaitTermination(1, TimeUnit.SECONDS) }
    }
}
