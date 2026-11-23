package dev.ivlev.silent.protocol

public class ProtoReader(
    private val buffer: ByteArray,
    private var position: Int = 0,
    private val limit: Int = buffer.size,
    private val options: ProtocolOptions = ProtocolOptions.Default,
) {
    private var depth: Int = 0

    init {
        if (position < 0 || limit < position || limit > buffer.size) {
            throw ProtocolError("invalid reader bounds")
        }
        if (limit > options.maxSize) {
            throw ProtocolError("message exceeds maximum size of ${options.maxSize} bytes")
        }
    }

    public val remaining: Int
        get() = limit - position

    public fun enter() {
        depth += 1
        if (depth > options.maxDepth) {
            throw ProtocolError("maximum nesting depth of ${options.maxDepth} exceeded")
        }
    }

    public fun leave() {
        depth -= 1
    }

    public fun readBoolean(): Boolean = when (val value = readRawByte()) {
        0 -> false
        1 -> true
        else -> throw ProtocolError("invalid boolean byte: $value")
    }

    public fun readRawByte(): Int {
        if (position >= limit) throw ProtocolError("truncated message")
        val value = buffer[position].toInt() and 0xFF
        position += 1
        return value
    }

    public fun readInt32(): Int {
        val raw = readVarint()
        if (raw ushr 32 != 0L) {
            throw ProtocolError("int32 value out of range")
        }
        val value = raw and 0xFFFF_FFFFL
        return ((value ushr 1) xor -(value and 1L)).toInt()
    }

    public fun readInt64(): Long = readVarint().let { (it ushr 1) xor -(it and 1L) }

    public fun readUInt32(): Int {
        val value = readVarint()
        if (value ushr 32 != 0L) {
            throw ProtocolError("uint32 value out of range")
        }
        return value.toInt()
    }

    public fun readUInt64(): Long = readVarint()

    public fun readEnumCode(): Int {
        val value = readUInt32().toLong() and 0xFFFF_FFFFL
        if (value > Int.MAX_VALUE.toLong()) {
            throw ProtocolError("enum value out of range: $value")
        }
        return value.toInt()
    }

    public fun readVarint(): Long {
        var result = 0L
        var shift = 0
        for (index in 0 until 10) {
            val value = readRawByte()
            if (index == 9 && (value and 0xFE) != 0) {
                throw ProtocolError("varint overflow")
            }
            result = result or ((value and 0x7F).toLong() shl shift)
            if (value and 0x80 == 0) return result
            shift += 7
        }
        throw ProtocolError("varint is too long")
    }

    public fun readFixed32(): Int {
        require(4)
        val value = (buffer[position].toInt() and 0xFF) or
            ((buffer[position + 1].toInt() and 0xFF) shl 8) or
            ((buffer[position + 2].toInt() and 0xFF) shl 16) or
            ((buffer[position + 3].toInt() and 0xFF) shl 24)
        position += 4
        return value
    }

    public fun readFixed64(): Long {
        require(8)
        var value = 0L
        for (index in 0 until 8) {
            value = value or ((buffer[position + index].toLong() and 0xFFL) shl (index * 8))
        }
        position += 8
        return value
    }

    public fun readFloat32(): Float = Float.fromBits(readFixed32())

    public fun readFloat64(): Double = Double.fromBits(readFixed64())

    public fun readString(): String {
        val byteCount = readLength()
        require(byteCount)
        val value = buffer.decodeToString(position, position + byteCount)
        position += byteCount
        return value
    }

    public fun readBytes(): ByteArray {
        val byteCount = readLength()
        require(byteCount)
        val value = buffer.copyOfRange(position, position + byteCount)
        position += byteCount
        return value
    }

    public fun readLength(): Int {
        val value = readVarint()
        if (value < 0L || value > Int.MAX_VALUE.toLong()) {
            throw ProtocolError("length out of range: $value")
        }
        if (value > remaining.toLong()) {
            throw ProtocolError("truncated value: expected $value bytes, got $remaining")
        }
        return value.toInt()
    }

    public fun readCount(minElementSize: Int = 1): Int {
        val value = readVarint()
        if (value < 0L || value > options.maxCollectionSize.toLong()) {
            throw ProtocolError("collection size out of range: $value")
        }
        if (minElementSize > 0 && value * minElementSize > remaining.toLong()) {
            throw ProtocolError("collection size exceeds remaining bytes: $value")
        }
        return value.toInt()
    }

    public fun readBitmapOffset(bitCount: Int): Int {
        if (bitCount < 0) throw ProtocolError("negative bitmap size")
        val byteCount = (bitCount + 7) ushr 3
        require(byteCount)
        val offset = position
        position += byteCount
        return offset
    }

    public fun isSet(bitmapOffset: Int, index: Int): Boolean {
        val position = bitmapOffset + (index ushr 3)
        return (buffer[position].toInt() and (1 shl (index and 7))) != 0
    }

    public fun requireEnd() {
        if (position != limit) {
            throw ProtocolError("trailing bytes: ${limit - position}")
        }
    }

    private fun require(count: Int) {
        if (count < 0 || count > remaining) {
            throw ProtocolError("truncated message: expected $count bytes, got $remaining")
        }
    }
}
