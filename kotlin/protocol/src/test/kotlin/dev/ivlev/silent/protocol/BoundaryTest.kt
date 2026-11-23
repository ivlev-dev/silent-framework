package dev.ivlev.silent.protocol

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BoundaryTest {
    private fun scalars(
        flag: Boolean = false,
        tiny: Byte = 0,
        small: Short = 0,
        regular: Int = 0,
        big: Long = 0,
        utiny: UByte = 0u,
        usmall: UShort = 0u,
        unsigned: UInt = 0u,
        ubig: ULong = 0u,
        real: Float = 0f,
        precise: Double = 0.0,
        text: String = "",
        data: ByteArray = ByteArray(0),
        narrow: Long = 0,
        wide: Long = 0,
        compact: Double = 0.0,
        fixed: Long = 0,
        fixed64: Long = 0,
        unsigned64: Long = 0,
        millis: Long = 0,
    ): Scalars = Scalars(
        flag, tiny, small, regular, big, utiny, usmall, unsigned, ubig, real, precise, text, data,
        narrow, wide, compact, fixed, fixed64, unsigned64, millis,
        kotlinx.datetime.Instant.fromEpochMilliseconds(millis),
    )

    private fun assertScalarsEquals(expected: Scalars, actual: Scalars) {
        assertEquals(expected.flag, actual.flag)
        assertEquals(expected.tiny, actual.tiny)
        assertEquals(expected.small, actual.small)
        assertEquals(expected.regular, actual.regular)
        assertEquals(expected.big, actual.big)
        assertEquals(expected.utiny, actual.utiny)
        assertEquals(expected.usmall, actual.usmall)
        assertEquals(expected.unsigned, actual.unsigned)
        assertEquals(expected.ubig, actual.ubig)
        assertEquals(expected.real.toRawBits(), actual.real.toRawBits())
        assertEquals(expected.precise.toRawBits(), actual.precise.toRawBits())
        assertEquals(expected.text, actual.text)
        assertContentEquals(expected.data, actual.data)
        assertEquals(expected.narrow, actual.narrow)
        assertEquals(expected.wide, actual.wide)
        assertEquals(expected.compact.toRawBits(), actual.compact.toRawBits())
        assertEquals(expected.fixed, actual.fixed)
        assertEquals(expected.fixed64, actual.fixed64)
        assertEquals(expected.unsigned64, actual.unsigned64)
        assertEquals(expected.millis, actual.millis)
        assertEquals(expected.instant, actual.instant)
    }

    @Test
    fun signedIntegerBounds() {
        val value = scalars(
            tiny = Byte.MIN_VALUE,
            small = Short.MIN_VALUE,
            regular = Int.MIN_VALUE,
            big = Long.MIN_VALUE,
            narrow = Int.MIN_VALUE.toLong(),
        )
        assertScalarsEquals(value, ScalarsCodec.decode(ScalarsCodec.encode(value)))
        val maximum = scalars(
            tiny = Byte.MAX_VALUE,
            small = Short.MAX_VALUE,
            regular = Int.MAX_VALUE,
            big = Long.MAX_VALUE,
            narrow = Int.MAX_VALUE.toLong(),
        )
        assertScalarsEquals(maximum, ScalarsCodec.decode(ScalarsCodec.encode(maximum)))
    }

    @Test
    fun unsignedBounds() {
        val value = scalars(
            utiny = UByte.MAX_VALUE,
            usmall = UShort.MAX_VALUE,
            unsigned = UInt.MAX_VALUE,
            ubig = ULong.MAX_VALUE,
            wide = 0xFFFF_FFFFL,
            unsigned64 = -1L,
        )
        assertScalarsEquals(value, ScalarsCodec.decode(ScalarsCodec.encode(value)))
    }

    @Test
    fun fixedBounds() {
        val value = scalars(fixed = 0xFFFF_FFFFL, fixed64 = Long.MIN_VALUE)
        assertScalarsEquals(value, ScalarsCodec.decode(ScalarsCodec.encode(value)))
    }

    @Test
    fun floatingPointSpecialValues() {
        val value = scalars(
            real = Float.NaN,
            precise = Double.NEGATIVE_INFINITY,
            compact = Double.POSITIVE_INFINITY,
        )
        assertScalarsEquals(value, ScalarsCodec.decode(ScalarsCodec.encode(value)))
        val negativeZero = scalars(real = -0.0f, precise = -0.0)
        assertScalarsEquals(negativeZero, ScalarsCodec.decode(ScalarsCodec.encode(negativeZero)))
    }

    @Test
    fun longZigZagUsesTenBytes() {
        val bytes = ScalarsCodec.encode(scalars(big = Long.MIN_VALUE))
        assertTrue(bytes.size >= 10)
    }

    @Test
    fun int32ZigZagBounds() {
        val min = scalars(regular = Int.MIN_VALUE)
        val bytes = ScalarsCodec.encode(min)
        assertScalarsEquals(min, ScalarsCodec.decode(bytes))
    }

    @Test
    fun maxSizedCollectionsRoundTrip() {
        val values = List(10_000) { it }
        val restored = IntListCodec.decode(IntListCodec.encode(IntList(values)))
        assertEquals(values, restored.items)
    }

    @Test
    fun primitiveArraysRoundTrip() {
        val value = PrimitiveArrays(
            bytes = byteArrayOf(-1, 0, 127),
            shorts = shortArrayOf(Short.MIN_VALUE, -1, 0, Short.MAX_VALUE),
            ints = intArrayOf(Int.MIN_VALUE, -1, 0, Int.MAX_VALUE),
            longs = longArrayOf(Long.MIN_VALUE, -1, 0, Long.MAX_VALUE),
            floats = floatArrayOf(Float.NaN, -0.0f, Float.POSITIVE_INFINITY),
            doubles = doubleArrayOf(Double.NEGATIVE_INFINITY, -0.0, 1.0),
        )
        val restored = PrimitiveArraysCodec.decode(PrimitiveArraysCodec.encode(value))
        assertContentEquals(value.bytes, restored.bytes)
        assertContentEquals(value.shorts, restored.shorts)
        assertContentEquals(value.ints, restored.ints)
        assertContentEquals(value.longs, restored.longs)
        assertContentEquals(value.floats.map { it.toRawBits() }, restored.floats.map { it.toRawBits() })
        assertContentEquals(value.doubles.map { it.toRawBits() }, restored.doubles.map { it.toRawBits() })
    }
}
