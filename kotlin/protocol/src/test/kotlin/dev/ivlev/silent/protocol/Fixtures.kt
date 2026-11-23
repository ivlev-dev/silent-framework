package dev.ivlev.silent.protocol

import kotlinx.datetime.Instant

@Proto
data class Simple(
    val email: String,
    val age: UInt,
    @Int32 val score: Int,
    val createdAt: Instant,
)

@Proto
data class OptionalFields(
    val a: Int?,
    val b: String?,
    val c: Boolean?,
    val nested: Inner?,
)

@Proto
data class Inner(
    val value: Int,
    val text: String,
)

@Proto
data class Outer(
    val inner: Inner,
    val maybe: Inner?,
)

@Proto
data class Collections(
    val list: List<Int>,
    val nullableList: List<Int?>,
    val texts: Set<String>,
    val tags: Map<String, Int>,
    val optionalValues: Map<String, Int?>,
    val array: Array<String>,
    val nestedLists: List<List<Int>>,
)

@Proto
data class PrimitiveArrays(
    val bytes: ByteArray,
    val shorts: ShortArray,
    val ints: IntArray,
    val longs: LongArray,
    val floats: FloatArray,
    val doubles: DoubleArray,
)

@Proto
data class Scalars(
    val flag: Boolean,
    val tiny: Byte,
    val small: Short,
    val regular: Int,
    val big: Long,
    val utiny: UByte,
    val usmall: UShort,
    val unsigned: UInt,
    val ubig: ULong,
    val real: Float,
    val precise: Double,
    val text: String,
    val data: ByteArray,
    @Int32 val narrow: Long,
    @Uint32 val wide: Long,
    @Float32 val compact: Double,
    @Fixed32 val fixed: Long,
    @Fixed64 val fixed64: Long,
    @Uint64 val unsigned64: Long,
    @EpochMillis val millis: Long,
    val instant: Instant,
)

enum class EventKind(override val protocolValue: Int) : ProtocolEnum {
    Created(1),
    Updated(2),
    Deleted(3),
}

enum class Color {
    Red,
    Green,
    Blue,
}

@Proto
data class CreatedPayload(val id: Int)

@Proto
data class UpdatedPayload(val name: String)

@Proto
data class Event(
    val kind: EventKind,
    @OneOf(1) val created: CreatedPayload?,
    @OneOf(2) val updated: UpdatedPayload?,
    @OneOf(3) val deleted: Unit?,
)

@Proto
data class Palette(
    val color: Color,
    val colors: List<Color>,
    val maybe: Color?,
    val tagged: Set<Color>,
    val byColor: Map<Color, String>,
)

open class Base(open val id: Int)

@Proto
class Derived(
    id: Int,
    val name: String,
) : Base(id)

@Proto
data class Node(val child: Node?)

@Proto
data class IntList(val items: List<Int>)

@Proto
data class OptionalIntList(val items: List<Int?>)

@Proto
data class StringSet(val items: Set<String>)

@Proto
data class EnumSet(val items: Set<Color>)

@Proto
data class IntMap(val items: Map<String, Int>)

@Proto
data class OptionalIntMap(val items: Map<String, Int?>)

@Proto
data class IntKeyMap(val items: Map<Int, String>)

@Proto
data class EnumMap(val items: Map<Color, Int>)

@Proto
data class IntArrayBox(val items: IntArray)

@Proto
data class StringArrayBox(val items: Array<String>)

@Proto
data class OptionalArrayBox(val items: Array<Int?>)

@Proto
data class ByteArrayBox(val items: ByteArray)

@Proto
data class ColorBox(val color: Color)

@Proto
data class NumericEvent(
    val kind: EventKind,
    @OneOf(1) val count: Int?,
    @OneOf(2) val label: String?,
    @OneOf(3) val empty: Unit?,
)

@Proto
data class EventWithLabel(
    val kind: EventKind,
    val label: String?,
    @OneOf(1) val created: CreatedPayload?,
    @OneOf(3) val deleted: Unit?,
)

@Proto
data class TextBox(val text: String)

@Proto
data class BoolBox(val value: Boolean)

@Proto
data class UIntBox(val value: UInt)

@Proto
data class FixedBox(
    @Fixed32 val a: Int,
    @Fixed64 val b: Long,
)

@Proto
class EmptyProto

open class Overridable(open val value: Int)

@Proto
class OverriddenValue(
    override val value: Int,
    val extra: String,
) : Overridable(value)

@Proto
data class UnicodeNames(
    val я: Int,
    val a: Int,
)

@Proto
data class MutableNode(var child: MutableNode? = null)

typealias AliasInt = Int

@Proto
data class Aliased(val value: AliasInt)

class Holder {
    @Proto
    data class Nested(val value: Int)
}

@Proto
data class IntBox(val value: Int)

@Proto
data class InnerList(val items: List<Inner>)

@Proto
data class InnerMap(val items: Map<String, Inner>)

@Proto
data class OptionalInnerList(val items: List<Inner?>)

@Proto
data class InnerArray(val items: Array<Inner>)

@Proto
data class NumericCollections(
    val ints: Set<Int>,
    val longs: Set<Long>,
    val uints: Set<UInt>,
    val ulongs: Set<ULong>,
    val flags: Set<Boolean>,
    val byBoolean: Map<Boolean, String>,
    val byULong: Map<ULong, String>,
)

@Proto
data class UInt32Int(
    @Uint32 val value: Int,
)

@Proto
data class TimeBox(val at: Instant)

@Proto
data class EpochBox(
    @EpochMillis val value: Long,
)

@Proto
data class UInt64Box(
    @Uint64 val value: Long,
)

@Proto
data class EventKindSet(val items: Set<EventKind>)

@Proto
data class EventKindMap(val items: Map<EventKind, String>)

@Proto
data class ManyOptional(
    val f01: Int?,
    val f02: Int?,
    val f03: Int?,
    val f04: Int?,
    val f05: Int?,
    val f06: Int?,
    val f07: Int?,
    val f08: Int?,
    val f09: Int?,
    val f10: Int?,
)

