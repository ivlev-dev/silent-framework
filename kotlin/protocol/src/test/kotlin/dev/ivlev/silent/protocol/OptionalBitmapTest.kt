package dev.ivlev.silent.protocol

import kotlin.test.Test
import kotlin.test.assertEquals

class OptionalBitmapTest {
    @Test
    fun bitmapMarksPresentFields() {
        val value = OptionalFields(a = 1, b = null, c = true, nested = null)
        assertHex("050201", OptionalFieldsCodec.encode(value))
        assertEquals(value, OptionalFieldsCodec.decode(bytes("050201")))
    }

    @Test
    fun emptyBitmapWhenNothingPresent() {
        val value = OptionalFields(a = null, b = null, c = null, nested = null)
        assertHex("00", OptionalFieldsCodec.encode(value))
        assertEquals(value, OptionalFieldsCodec.decode(bytes("00")))
    }

    @Test
    fun bitmapBitsFollowSortedNames() {
        val value = OptionalFields(a = null, b = null, c = null, nested = Inner(1, "x"))
        assertHex("08" + "0178" + "02", OptionalFieldsCodec.encode(value))
        assertEquals(value, OptionalFieldsCodec.decode(OptionalFieldsCodec.encode(value)))
    }

    @Test
    fun nestedMessageHasNoLengthPrefix() {
        val value = Outer(inner = Inner(1, "x"), maybe = null)
        assertHex("00" + "017802", OuterCodec.encode(value))
        assertEquals(value, OuterCodec.decode(bytes("00017802")))
    }

    @Test
    fun nestedBitmapIsLocalToMessage() {
        val value = Outer(inner = Inner(2, ""), maybe = Inner(3, "y"))
        assertHex("01" + "0004" + "017906", OuterCodec.encode(value))
        assertEquals(value, OuterCodec.decode(OuterCodec.encode(value)))
    }

    @Test
    fun recursiveOptional() {
        assertHex("00", NodeCodec.encode(Node(null)))
        assertHex("0100", NodeCodec.encode(Node(Node(null))))
        assertEquals(Node(Node(Node(null))), NodeCodec.decode(bytes("010100")))
    }

    @Test
    fun emptyMessageIsZeroBytes() {
        assertHex("", EmptyProtoCodec.encode(EmptyProto()))
        EmptyProtoCodec.decode(ByteArray(0))
    }

    @Test
    fun bitmapSpansMultipleBytes() {
        val value = ManyOptional(
            f01 = 1,
            f02 = null,
            f03 = null,
            f04 = null,
            f05 = null,
            f06 = null,
            f07 = null,
            f08 = null,
            f09 = -1,
            f10 = null,
        )
        assertHex("0101" + "02" + "01", ManyOptionalCodec.encode(value))
        assertEquals(value, ManyOptionalCodec.decode(bytes("01010201")))
    }
}
