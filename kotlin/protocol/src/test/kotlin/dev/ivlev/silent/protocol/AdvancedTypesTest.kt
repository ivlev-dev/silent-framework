package dev.ivlev.silent.protocol

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class AdvancedTypesTest {
    @Test
    fun mutablePropertiesRoundTrip() {
        val value = MutableNode(MutableNode(null))
        assertEquals(value, MutableNodeCodec.decode(MutableNodeCodec.encode(value)))
    }

    @Test
    fun typeAliasesAreTransparent() {
        assertHex("02", AliasedCodec.encode(Aliased(1)))
        assertEquals("Aliased{value:int32}", AliasedCodec.schemaFingerprint())
    }

    @Test
    fun nestedClassCodecName() {
        assertHex("02", Holder_NestedCodec.encode(Holder.Nested(1)))
        assertEquals(Holder.Nested(1), Holder_NestedCodec.decode(bytes("02")))
        assertEquals("Nested{value:int32}", Holder_NestedCodec.schemaFingerprint())
    }

    @Test
    fun int32RejectsOversizedVarint() {
        assertFailsWith<ProtocolError> { IntBoxCodec.decode(bytes("ffffffff1f")) }
    }

    @Test
    fun int32RoundTrip() {
        assertEquals(IntBox(Int.MIN_VALUE), IntBoxCodec.decode(IntBoxCodec.encode(IntBox(Int.MIN_VALUE))))
        assertEquals(IntBox(Int.MAX_VALUE), IntBoxCodec.decode(IntBoxCodec.encode(IntBox(Int.MAX_VALUE))))
    }

    @Test
    fun mutableNodeCycleIsDetected() {
        val node = MutableNode()
        node.child = node
        assertFailsWith<ProtocolError> { MutableNodeCodec.encode(node) }
    }

    @Test
    fun listOfMessages() {
        val value = InnerList(listOf(Inner(1, "x"), Inner(2, "")))
        assertHex("02" + "017802" + "0004", InnerListCodec.encode(value))
        assertEquals(value, InnerListCodec.decode(InnerListCodec.encode(value)))
    }

    @Test
    fun nullableElementsOfMessages() {
        val value = OptionalInnerList(listOf(null, Inner(1, "x")))
        assertHex("02" + "02" + "017802", OptionalInnerListCodec.encode(value))
        assertEquals(value, OptionalInnerListCodec.decode(OptionalInnerListCodec.encode(value)))
    }

    @Test
    fun mapOfMessages() {
        val value = InnerMap(mapOf("a" to Inner(1, "x")))
        assertHex("01" + "0161" + "017802", InnerMapCodec.encode(value))
        assertEquals(value, InnerMapCodec.decode(InnerMapCodec.encode(value)))
    }

    @Test
    fun arrayOfMessages() {
        val value = InnerArray(arrayOf(Inner(1, "x")))
        assertHex("01" + "017802", InnerArrayCodec.encode(value))
        assertContentEquals(value.items, InnerArrayCodec.decode(InnerArrayCodec.encode(value)).items)
    }

    @Test
    fun numericCollectionsAreSorted() {
        val value = NumericCollections(
            ints = setOf(3, -1, 0),
            longs = setOf(10L, -10L),
            uints = setOf(UInt.MAX_VALUE, 1u),
            ulongs = setOf(ULong.MAX_VALUE, 1uL),
            flags = setOf(true, false),
            byBoolean = mapOf(true to "t", false to "f"),
            byULong = mapOf(ULong.MAX_VALUE to "max", 1uL to "one"),
        )
        val encoded = NumericCollectionsCodec.encode(value)
        val restored = NumericCollectionsCodec.decode(encoded)
        assertEquals(value, restored)
        assertEquals(listOf(-1, 0, 3), restored.ints.toList())
        assertEquals(listOf(-10L, 10L), restored.longs.toList())
        assertEquals(listOf(1u, UInt.MAX_VALUE), restored.uints.toList())
        assertEquals(listOf(1uL, ULong.MAX_VALUE), restored.ulongs.toList())
        assertEquals(listOf(false, true), restored.flags.toList())
        assertEquals(listOf(false, true), restored.byBoolean.keys.toList())
        assertEquals(listOf(1uL, ULong.MAX_VALUE), restored.byULong.keys.toList())
    }

    @Test
    fun uint32OnIntKeepsBits() {
        assertHex("ffffffff0f", UInt32IntCodec.encode(UInt32Int(-1)))
        assertEquals(UInt32Int(-1), UInt32IntCodec.decode(bytes("ffffffff0f")))
        assertEquals(UInt32Int(Int.MIN_VALUE), UInt32IntCodec.decode(UInt32IntCodec.encode(UInt32Int(Int.MIN_VALUE))))
    }

    @Test
    fun explicitEnumSetsAndMapsUseWireCodes() {
        val set = EventKindSet(setOf(EventKind.Deleted, EventKind.Created))
        assertHex("020103", EventKindSetCodec.encode(set))
        val map = EventKindMap(mapOf(EventKind.Updated to "b", EventKind.Created to "a"))
        assertHex("02010161020162", EventKindMapCodec.encode(map))
        assertEquals(map, EventKindMapCodec.decode(EventKindMapCodec.encode(map)))
    }
}
