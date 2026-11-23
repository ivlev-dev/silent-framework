package dev.ivlev.silent.protocol

import kotlinx.datetime.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TimeAndStringsTest {
    @Test
    fun instantUsesEpochMilliseconds() {
        assertHex("00", TimeBoxCodec.encode(TimeBox(Instant.fromEpochMilliseconds(0))))
        assertHex("d00f", TimeBoxCodec.encode(TimeBox(Instant.fromEpochMilliseconds(1_000))))
        assertHex("cf0f", TimeBoxCodec.encode(TimeBox(Instant.fromEpochMilliseconds(-1_000))))
        assertHex("d00f", EpochBoxCodec.encode(EpochBox(1_000)))
    }

    @Test
    fun unsigned64UsesRawBits() {
        assertHex("01", UInt64BoxCodec.encode(UInt64Box(1)))
        assertHex("ffffffffffffffffff01", UInt64BoxCodec.encode(UInt64Box(-1)))
        assertEquals(UInt64Box(-1), UInt64BoxCodec.decode(bytes("ffffffffffffffffff01")))
    }

    @Test
    fun negativeInstants() {
        val value = Simple("", 0u, 0, Instant.fromEpochMilliseconds(-1_000))
        assertEquals(value.createdAt, SimpleCodec.decode(SimpleCodec.encode(value)).createdAt)
    }

    @Test
    fun epochMillisAnnotation() {
        val value = Scalars(
            flag = false,
            tiny = 0,
            small = 0,
            regular = 0,
            big = 0,
            utiny = 0u,
            usmall = 0u,
            unsigned = 0u,
            ubig = 0u,
            real = 0f,
            precise = 0.0,
            text = "",
            data = ByteArray(0),
            narrow = 0,
            wide = 0,
            compact = 0.0,
            fixed = 0,
            fixed64 = 0,
            unsigned64 = 0,
            millis = 1234,
            instant = Instant.fromEpochMilliseconds(1234),
        )
        val restored = ScalarsCodec.decode(ScalarsCodec.encode(value))
        assertEquals(value.millis, restored.millis)
        assertEquals(value.instant, restored.instant)
    }

    @Test
    fun utf8StringLengthInBytes() {
        val value = TextBox("😀")
        assertHex("04f09f9880", TextBoxCodec.encode(value))
        assertEquals(value, TextBoxCodec.decode(bytes("04f09f9880")))
    }

    @Test
    fun utf8RoundTrip() {
        val value = TextBox("Привет, 世界! 😀")
        assertEquals(value, TextBoxCodec.decode(TextBoxCodec.encode(value)))
    }

    @Test
    fun utf8OrderingUsesCodePoints() {
        assertTrue(ProtoSort.compareUtf8("a", "b") < 0)
        assertTrue(ProtoSort.compareUtf8("é", "z") > 0)
        assertTrue(ProtoSort.compareUtf8("\uE000", "\uD83D\uDE00") < 0)
        assertEquals(0, ProtoSort.compareUtf8("\uD83D\uDE00", "😀"))
        assertTrue(ProtoSort.compareUtf8("ab", "abc") < 0)
    }

    @Test
    fun largeStringRoundTrip() {
        val text = buildString { repeat(10_000) { append("я") } }
        val restored = TextBoxCodec.decode(TextBoxCodec.encode(TextBox(text)))
        assertEquals(text, restored.text)
    }
}
