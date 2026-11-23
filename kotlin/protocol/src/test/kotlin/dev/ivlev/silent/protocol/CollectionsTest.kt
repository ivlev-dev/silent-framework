package dev.ivlev.silent.protocol

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals

class CollectionsTest {
    @Test
    fun setIsSortedByUtf8() {
        val value = StringSet(setOf("b", "a", "é"))
        assertHex("030161016202c3a9", StringSetCodec.encode(value))
        assertEquals(value, StringSetCodec.decode(StringSetCodec.encode(value)))
    }

    @Test
    fun enumSetIsSortedByWireValue() {
        val value = EnumSet(setOf(Color.Blue, Color.Red, Color.Green))
        assertHex("03000102", EnumSetCodec.encode(value))
        assertEquals(value, EnumSetCodec.decode(EnumSetCodec.encode(value)))
    }

    @Test
    fun mapKeysAreSorted() {
        val value = IntMap(mapOf("b" to 2, "a" to 1))
        assertHex("02016102016204", IntMapCodec.encode(value))
        assertEquals(value, IntMapCodec.decode(IntMapCodec.encode(value)))
    }

    @Test
    fun integerMapKeysAreSortedNumerically() {
        val value = IntKeyMap(mapOf(2 to "b", -1 to "a"))
        assertHex("02010161040162", IntKeyMapCodec.encode(value))
        assertEquals(value, IntKeyMapCodec.decode(IntKeyMapCodec.encode(value)))
    }

    @Test
    fun enumMapKeysAreSortedByWireValue() {
        val value = EnumMap(mapOf(Color.Blue to 2, Color.Red to 1))
        assertHex("0200020204", EnumMapCodec.encode(value))
        assertEquals(value, EnumMapCodec.decode(EnumMapCodec.encode(value)))
    }

    @Test
    fun nullableListElementsUseBitmap() {
        val value = OptionalIntList(listOf(1, null, -1))
        assertHex("03050201", OptionalIntListCodec.encode(value))
        assertEquals(value, OptionalIntListCodec.decode(bytes("03050201")))
    }

    @Test
    fun nullableListBitmapSpansMultipleBytes() {
        val items = List(10) { index -> if (index % 3 == 0) null else index }
        val value = OptionalIntList(items)
        assertEquals(value, OptionalIntListCodec.decode(OptionalIntListCodec.encode(value)))
    }

    @Test
    fun nullableMapValuesUseBitmap() {
        val value = OptionalIntMap(mapOf("a" to 1, "b" to null))
        assertHex("02010161020162", OptionalIntMapCodec.encode(value))
        assertEquals(value, OptionalIntMapCodec.decode(bytes("02010161020162")))
    }

    @Test
    fun nullableMapValuesDecodeKeyOnce() {
        val value = OptionalIntMap(mapOf("hello" to 1, "world" to null))
        assertEquals(value, OptionalIntMapCodec.decode(OptionalIntMapCodec.encode(value)))
    }

    @Test
    fun stringArray() {
        val value = StringArrayBox(arrayOf("a", "b"))
        assertHex("0201610162", StringArrayBoxCodec.encode(value))
        assertContentEquals(value.items, StringArrayBoxCodec.decode(bytes("0201610162")).items)
    }

    @Test
    fun nullableArrayElements() {
        val value = OptionalArrayBox(arrayOf(1, null, 2))
        assertHex("03050204", OptionalArrayBoxCodec.encode(value))
        assertContentEquals(value.items, OptionalArrayBoxCodec.decode(OptionalArrayBoxCodec.encode(value)).items)
    }

    @Test
    fun nestedLists() {
        val value = Collections(
            list = emptyList(),
            nullableList = listOf(1, null),
            texts = setOf("b", "a"),
            tags = mapOf("x" to 1),
            optionalValues = mapOf("y" to null),
            array = arrayOf("z"),
            nestedLists = listOf(listOf(1), listOf(2, 3)),
        )
        val restored = CollectionsCodec.decode(CollectionsCodec.encode(value))
        assertEquals(value.list, restored.list)
        assertEquals(value.nullableList, restored.nullableList)
        assertEquals(value.texts, restored.texts)
        assertEquals(value.tags, restored.tags)
        assertEquals(value.optionalValues, restored.optionalValues)
        assertContentEquals(value.array, restored.array)
        assertEquals(value.nestedLists, restored.nestedLists)
    }
}
