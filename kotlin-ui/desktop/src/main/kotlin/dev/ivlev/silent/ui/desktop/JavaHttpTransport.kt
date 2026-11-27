package dev.ivlev.silent.ui.desktop

import dev.ivlev.silent.ui.data.HttpResponse
import dev.ivlev.silent.ui.data.HttpTransport
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse.BodyHandlers
import java.time.Duration

class JavaHttpTransport : HttpTransport {
    private val client: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(4))
        .build()

    override fun get(url: String, accept: String): HttpResponse {
        val request = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(8))
            .header("Accept", accept)
            .GET()
            .build()
        val response = client.send(request, BodyHandlers.ofByteArray())
        return HttpResponse(
            status = response.statusCode(),
            contentType = response.headers().firstValue("content-type").orElse(null),
            body = response.body(),
        )
    }
}
