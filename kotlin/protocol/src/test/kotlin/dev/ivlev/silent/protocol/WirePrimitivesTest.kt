package dev.ivlev.silent.protocol

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals

class WirePrimitivesTest {
    @Test
    fun booleans() {
        assertHex("01", BoolBoxCodec.encode(BoolBox(true)))
        assertHex("00", BoolBoxCodec.encode(BoolBox(false)))
        assertEquals(BoolBox(true), BoolBoxCodec.decode(bytes("01")))
        assertEquals(BoolBox(false), BoolBoxCodec.decode(bytes("00")))
    }

    @Test
    fun uint32Varint() {
        assertHex("ac02", UIntBoxCodec.encode(UIntBox(300u)))
        assertEquals(UIntBox(300u), UIntBoxCodec.decode(bytes("ac02")))
    }

    @Test
    fun fixedLittleEndian() {
        val value = FixedBox(a = 0x01020304, b = 0x0102030405060708L)
        assertHex("04030201" + "0807060504030201", FixedBoxCodec.encode(value))
        assertEquals(value, FixedBoxCodec.decode(FixedBoxCodec.encode(value)))
    }

    @Test
    fun stringsUseUtf8Length() {
        assertHex("02d18f", TextBoxCodec.encode(TextBox("я")))
        assertEquals(TextBox("я"), TextBoxCodec.decode(bytes("02d18f")))
        assertHex("00", TextBoxCodec.encode(TextBox("")))
    }

    @Test
    fun byteArray() {
        val value = ByteArrayBox(byteArrayOf(1, 2, 3))
        assertHex("03010203", ByteArrayBoxCodec.encode(value))
        assertContentEquals(value.items, ByteArrayBoxCodec.decode(bytes("03010203")).items)
    }

    @Test
    fun packedIntArray() {
        val value = IntArrayBox(intArrayOf(1, 2))
        assertHex("08" + "01000000" + "02000000", IntArrayBoxCodec.encode(value))
        assertContentEquals(value.items, IntArrayBoxCodec.decode(IntArrayBoxCodec.encode(value)).items)
    }

    @Test
    fun listCountAndZigZag() {
        assertHex("020201", IntListCodec.encode(IntList(listOf(1, -1))))
        assertEquals(IntList(listOf(1, -1)), IntListCodec.decode(bytes("020201")))
    }

    @Test
    fun emptyCollections() {
        assertHex("00", IntListCodec.encode(IntList(emptyList())))
        assertHex("00", StringSetCodec.encode(StringSet(emptySet())))
        assertHex("00", IntMapCodec.encode(IntMap(emptyMap())))
        assertHex("00", OptionalIntMapCodec.encode(OptionalIntMap(emptyMap())))
    }

    @Test
    fun simpleMap() {
        assertHex("01016102", IntMapCodec.encode(IntMap(mapOf("a" to 1))))
        assertEquals(IntMap(mapOf("a" to 1)), IntMapCodec.decode(bytes("01016102")))
    }

    @Test
    fun enumUsesOrdinalByDefault() {
        assertHex("00", ColorBoxCodec.encode(ColorBox(Color.Red)))
        assertHex("01", ColorBoxCodec.encode(ColorBox(Color.Green)))
        assertHex("02", ColorBoxCodec.encode(ColorBox(Color.Blue)))
        assertEquals(ColorBox(Color.Blue), ColorBoxCodec.decode(bytes("02")))
    }
}
