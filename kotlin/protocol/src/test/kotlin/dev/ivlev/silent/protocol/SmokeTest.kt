package dev.ivlev.silent.protocol

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals

class SmokeTest {
    @Test
    fun simpleRoundTrip() {
        val value = Simple(
            email = "a@b.c",
            age = 7u,
            score = -3,
            createdAt = kotlinx.datetime.Instant.fromEpochMilliseconds(1_000),
        )
        val restored = SimpleCodec.decode(SimpleCodec.encode(value))
        assertEquals(value, restored)
    }

    @Test
    fun simpleWire() {
        val value = Simple(
            email = "a",
            age = 1u,
            score = 1,
            createdAt = kotlinx.datetime.Instant.fromEpochMilliseconds(0),
        )
        val bytes = SimpleCodec.encode(value)
        assertContentEquals(byteArrayOf(0x01, 0x00, 0x01, 0x61, 0x02), bytes)
    }

    @Test
    fun optionalBitmap() {
        val value = OptionalFields(a = 1, b = null, c = true, nested = null)
        val bytes = OptionalFieldsCodec.encode(value)
        assertContentEquals(byteArrayOf(0x05, 0x02, 0x01), bytes)
        assertEquals(value, OptionalFieldsCodec.decode(bytes))
    }
}
