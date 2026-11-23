package dev.ivlev.silent.protocol

import kotlin.test.Test
import kotlin.test.assertFailsWith

class ErrorHandlingTest {
    @Test
    fun truncatedMessage() {
        assertFailsWith<ProtocolError> { SimpleCodec.decode(ByteArray(0)) }
        assertFailsWith<ProtocolError> { EventCodec.decode(ByteArray(0)) }
        assertFailsWith<ProtocolError> { OptionalFieldsCodec.decode(bytes("05")) }
    }

    @Test
    fun truncatedString() {
        assertFailsWith<ProtocolError> { SimpleCodec.decode(bytes("0100056162")) }
    }

    @Test
    fun trailingBytes() {
        val encoded = SimpleCodec.encode(
            Simple("a", 1u, 1, kotlinx.datetime.Instant.fromEpochMilliseconds(0)),
        )
        assertFailsWith<ProtocolError> { SimpleCodec.decode(encoded + byteArrayOf(0)) }
    }

    @Test
    fun invalidBoolean() {
        assertFailsWith<ProtocolError> { OptionalFieldsCodec.decode(bytes("050202")) }
    }

    @Test
    fun varintOverflow() {
        assertFailsWith<ProtocolError> {
            SimpleCodec.decode(ByteArray(11) { 0xFF.toByte() })
        }
    }

    @Test
    fun uint32Overflow() {
        assertFailsWith<ProtocolError> { UIntBoxCodec.decode(bytes("ffffffff1f")) }
    }

    @Test
    fun packedArrayLengthMustBeAligned() {
        assertFailsWith<ProtocolError> { IntArrayBoxCodec.decode(bytes("03010203")) }
    }

    @Test
    fun collectionCountExceedsRemainingBytes() {
        assertFailsWith<ProtocolError> { IntListCodec.decode(bytes("0202")) }
    }

    @Test
    fun collectionCountExceedsLimit() {
        assertFailsWith<ProtocolError> { IntListCodec.decode(bytes("80808001")) }
        assertFailsWith<ProtocolError> { IntListCodec.decode(bytes("ffffffff0f")) }
    }

    @Test
    fun unknownEnumValue() {
        assertFailsWith<ProtocolError> { ColorBoxCodec.decode(bytes("03")) }
    }

    @Test
    fun maxSizeOnEncode() {
        val options = ProtocolOptions(maxSize = 8)
        assertFailsWith<ProtocolError> {
            SimpleCodec.encode(Simple("long-enough-text", 1u, 1, kotlinx.datetime.Instant.fromEpochMilliseconds(0)), options)
        }
    }

    @Test
    fun maxSizeOnDecode() {
        val encoded = SimpleCodec.encode(
            Simple("long-enough-text", 1u, 1, kotlinx.datetime.Instant.fromEpochMilliseconds(0)),
        )
        assertFailsWith<ProtocolError> {
            SimpleCodec.decode(encoded, ProtocolOptions(maxSize = 8))
        }
    }

    @Test
    fun depthLimitOnEncode() {
        var node = Node(null)
        repeat(300) { node = Node(node) }
        assertFailsWith<ProtocolError> { NodeCodec.encode(node) }
    }

    @Test
    fun depthLimitOnDecode() {
        val encoded = ByteArray(301) { index -> if (index == 300) 0 else 1 }
        assertFailsWith<ProtocolError> { NodeCodec.decode(encoded) }
    }

    @Test
    fun customDepthLimit() {
        assertFailsWith<ProtocolError> {
            NodeCodec.decode(bytes("0100"), ProtocolOptions(maxDepth = 1))
        }
    }

    @Test
    fun cyclicObjectGraph() {
        val first = MutableNode()
        val second = MutableNode()
        first.child = second
        second.child = first
        assertFailsWith<ProtocolError> { MutableNodeCodec.encode(first) }
    }
}
