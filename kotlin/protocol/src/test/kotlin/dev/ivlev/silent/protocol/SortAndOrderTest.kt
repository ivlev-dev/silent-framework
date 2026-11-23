package dev.ivlev.silent.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SortAndOrderTest {
    @Test
    fun fieldsSortedByUtf8Bytes() {
        assertHex("02" + "02", UnicodeNamesCodec.encode(UnicodeNames(я = 1, a = 1)))
        assertEquals("UnicodeNames{a:int32;я:int32}", UnicodeNamesCodec.schemaFingerprint())
    }

    @Test
    fun utf8OrderDiffersFromUtf16ForSupplementary() {
        assertTrue(ProtoSort.compareUtf8("\uE000", "\uD83D\uDE00") < 0)
        assertTrue("\uE000" > "\uD83D\uDE00")
    }

    @Test
    fun stringSetOrderMatchesFieldOrder() {
        val value = StringSet(setOf("\uE000", "\uD83D\uDE00", "a"))
        val encoded = StringSetCodec.encode(value)
        assertHex("03" + "0161" + "03ee8080" + "04f09f9880", encoded)
        assertEquals(value, StringSetCodec.decode(encoded))
    }

    @Test
    fun descendingValuesAreStillEncodedInAscendingKeyOrder() {
        val value = IntKeyMap(mapOf(10 to "a", -10 to "b", 0 to "c"))
        val encoded = IntKeyMapCodec.encode(value)
        val restored = IntKeyMapCodec.decode(encoded)
        assertEquals(value, restored)
        assertHex(
            "03" +
                "13" + "0162" +
                "00" + "0163" +
                "14" + "0161",
            encoded,
        )
    }
}
