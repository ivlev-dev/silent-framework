package dev.ivlev.silent.protocol

import kotlinx.datetime.Instant
import kotlin.test.Test
import kotlin.test.assertEquals

@Proto
data class AddressCross(val city: String, val zip: Int)

@Proto
data class UserCross(
    val active: Boolean,
    val address: AddressCross,
    val age: Int,
    val createdAt: Instant,
    val email: String?,
    val id: Long,
    val name: String,
    val roles: Set<String>,
    val score: Double,
    val tags: List<String>,
)

class CrossLanguageTest {
    @Test
    fun oneOfCrossVector() {
        val created = EventCross(
            kind = EventCrossKind.Created,
            created = PayloadCross(7, "hi"),
            updated = null,
            deleted = null,
        )
        assertHex("010e026869", EventCrossCodec.encode(created))
        val updated = EventCross(
            kind = EventCrossKind.Updated,
            created = null,
            updated = 42,
            deleted = null,
        )
        assertHex("0254", EventCrossCodec.encode(updated))
        val deleted = EventCross(
            kind = EventCrossKind.Deleted,
            created = null,
            updated = null,
            deleted = Unit,
        )
        assertHex("03", EventCrossCodec.encode(deleted))
    }

    @Test
    fun crossVector() {
        val value = UserCross(
            active = true,
            address = AddressCross("Москва", 101000),
            age = 30,
            createdAt = Instant.fromEpochMilliseconds(1700000000000),
            email = "user@example.com",
            id = 1234567890123,
            name = "Ivan",
            roles = setOf("admin", "user"),
            score = 12.5,
            tags = listOf("a", "b"),
        )
        assertHex("01010cd09cd0bed181d0bad0b2d0b090aa0c3c80a0abfef9621075736572406578616d706c652e636f6d9693d89fee47044976616e020561646d696e047573657200000000000029400201610162", UserCrossCodec.encode(value))
        assertEquals(value, UserCrossCodec.decode(UserCrossCodec.encode(value)))
    }
}

enum class EventCrossKind(override val protocolValue: Int) : ProtocolEnum {
    Created(1),
    Updated(2),
    Deleted(3),
}

@Proto
data class PayloadCross(val count: Int, val text: String)

@Proto
data class EventCross(
    val kind: EventCrossKind,
    @OneOf(1) val created: PayloadCross?,
    @OneOf(2) val updated: Int?,
    @OneOf(3) val deleted: Unit?,
)
