package dev.ivlev.silent.protocol

import kotlin.test.assertEquals

private const val HEX = "0123456789abcdef"

internal fun hex(bytes: ByteArray): String = buildString {
    for (byte in bytes) {
        val value = byte.toInt() and 0xFF
        append(HEX[value ushr 4])
        append(HEX[value and 0x0F])
    }
}

internal fun bytes(text: String): ByteArray {
    val clean = text.filterNot { it.isWhitespace() }
    require(clean.length % 2 == 0) { "hex length must be even" }
    val result = ByteArray(clean.length / 2)
    for (index in result.indices) {
        result[index] = clean.substring(index * 2, index * 2 + 2).toInt(16).toByte()
    }
    return result
}

internal fun assertHex(expected: String, actual: ByteArray) {
    assertEquals(expected.lowercase().filterNot { it.isWhitespace() }, hex(actual))
}
