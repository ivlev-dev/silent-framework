package dev.ivlev.silent.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class OneOfTest {
    @Test
    fun createdVariant() {
        val value = Event(EventKind.Created, CreatedPayload(1), null, null)
        assertHex("0102", EventCodec.encode(value))
        assertEquals(value, EventCodec.decode(bytes("0102")))
    }

    @Test
    fun updatedVariant() {
        val value = Event(EventKind.Updated, null, UpdatedPayload("x"), null)
        assertHex("020178", EventCodec.encode(value))
        assertEquals(value, EventCodec.decode(bytes("020178")))
    }

    @Test
    fun emptyVariant() {
        val value = Event(EventKind.Deleted, null, null, Unit)
        assertHex("03", EventCodec.encode(value))
        val restored = EventCodec.decode(bytes("03"))
        assertEquals(EventKind.Deleted, restored.kind)
        assertEquals(Unit, restored.deleted)
        assertNull(restored.created)
        assertNull(restored.updated)
    }

    @Test
    fun primitivePayloads() {
        assertEquals(
            NumericEvent(EventKind.Created, 7, null, null),
            NumericEventCodec.decode(NumericEventCodec.encode(NumericEvent(EventKind.Created, 7, null, null))),
        )
        assertEquals(
            NumericEvent(EventKind.Updated, null, "z", null),
            NumericEventCodec.decode(NumericEventCodec.encode(NumericEvent(EventKind.Updated, null, "z", null))),
        )
        assertEquals(
            NumericEvent(EventKind.Deleted, null, null, Unit),
            NumericEventCodec.decode(NumericEventCodec.encode(NumericEvent(EventKind.Deleted, null, null, Unit))),
        )
    }

    @Test
    fun bitmapIsWrittenBeforeOneOf() {
        val value = EventWithLabel(EventKind.Created, "x", CreatedPayload(1), null)
        assertHex("010102" + "0178", EventWithLabelCodec.encode(value))
        assertEquals(value, EventWithLabelCodec.decode(EventWithLabelCodec.encode(value)))
    }

    @Test
    fun missingVariantFails() {
        assertFailsWith<ProtocolError> {
            EventCodec.encode(Event(EventKind.Created, null, null, null))
        }
    }

    @Test
    fun multipleVariantsFail() {
        assertFailsWith<ProtocolError> {
            EventCodec.encode(Event(EventKind.Created, CreatedPayload(1), UpdatedPayload("x"), Unit))
        }
    }

    @Test
    fun unknownDiscriminatorFails() {
        assertFailsWith<ProtocolError> { EventCodec.decode(bytes("04")) }
    }

    @Test
    fun enumValueWithoutVariantFails() {
        assertFailsWith<ProtocolError> { EventCodec.decode(bytes("05")) }
    }

    @Test
    fun discriminatorMismatchFails() {
        assertFailsWith<ProtocolError> {
            EventCodec.encode(Event(EventKind.Updated, CreatedPayload(1), null, null))
        }
    }
}
