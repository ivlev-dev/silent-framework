package dev.ivlev.silent.protocol

import com.google.gson.Gson
import kotlin.system.measureNanoTime

@Proto
data class BenchAddress(val city: String, val zip: Int)

@Proto
data class BenchUser(
    val id: Long,
    val name: String,
    val email: String?,
    val age: Int,
    val active: Boolean,
    val address: BenchAddress,
    val tags: List<String>,
    val score: Double,
)

private fun sample() = BenchUser(
    id = 1234567890123,
    name = "Ivan",
    email = "user@example.com",
    age = 30,
    active = true,
    address = BenchAddress("Москва", 101000),
    tags = listOf("a", "b"),
    score = 12.5,
)

private fun bench(label: String, bytes: Int, run: () -> Unit) {
    repeat(20_000) { run() }
    val iterations = 200_000
    var best = Double.MAX_VALUE
    repeat(5) {
        var sink: Any? = null
        val elapsed = measureNanoTime {
            repeat(iterations) { sink = run() }
        }.toDouble() / 1_000_000_000.0
        if (sink == null) error("unreachable")
        if (elapsed < best) best = elapsed
    }
    val ops = iterations / best
    val mb = ops * bytes / 1_000_000.0
    println("%-20s %10.0f ops/s  %6.1f MB/s".format(label, ops, mb))
}

fun main() {
    val value = sample()
    val bytes = BenchUserCodec.encode(value)
    val json = Gson().toJson(value)
    println("size ${bytes.size} B, json ${json.length} B, hex ${bytes.joinToString("") { "%02x".format(it) }}")

    bench("static encode", bytes.size) { BenchUserCodec.encode(value) }
    bench("static decode", bytes.size) { BenchUserCodec.decode(bytes) }
    bench("json stringify", json.length) { Gson().toJson(value) }
    bench("json parse", json.length) { Gson().fromJson(json, BenchUser::class.java) }
}
