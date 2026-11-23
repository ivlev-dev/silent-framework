package dev.ivlev.silent.protocol

public class ProtoWriter(
    private val options: ProtocolOptions = ProtocolOptions.Default,
    initialCapacity: Int = 64,
) {
    private var buffer: ByteArray = ByteArray(initialCapacity.coerceAtLeast(16))
    private var size: Int = 0
    private var depth: Int = 0
    private var active: MutableList<Any>? = null

    public val length: Int
        get() = size

    public fun enter(value: Any) {
        depth += 1
        if (depth > options.maxDepth) {
            throw ProtocolError("maximum nesting depth of ${options.maxDepth} exceeded")
        }
        val stack = active ?: ArrayList<Any>().also { active = it }
        for (index in stack.indices) {
            if (stack[index] === value) {
                throw ProtocolError("cyclic object reference detected")
            }
        }
        stack.add(value)
    }

    public fun leave(value: Any) {
        val stack = active
        if (stack != null) {
            for (index in stack.indices.reversed()) {
                if (stack[index] === value) {
                    stack.removeAt(index)
                    break
                }
            }
        }
        depth -= 1
    }

    public fun writeBoolean(value: Boolean) {
        writeRawByte(if (value) 1 else 0)
    }

    public fun writeRawByte(value: Int) {
        ensureCapacity(1)
        buffer[size] = value.toByte()
        size += 1
    }

    public fun writeInt32(value: Int) {
        val zigZag = (value shl 1) xor (value shr 31)
        writeVarint(zigZag.toLong() and 0xFFFF_FFFFL)
    }

    public fun writeInt64(value: Long) {
        writeVarint((value shl 1) xor (value shr 63))
    }

    public fun writeUInt(value: Int) {
        writeVarint(value.toLong() and 0xFFFF_FFFFL)
    }

    public fun writeUInt64(value: Long) {
        writeVarint(value)
    }

    public fun writeVarint(value: Long) {
        var current = value
        while (current and 0x7FL.inv() != 0L) {
            ensureCapacity(1)
            buffer[size] = ((current and 0x7F) or 0x80).toByte()
            size += 1
            current = current ushr 7
        }
        ensureCapacity(1)
        buffer[size] = current.toByte()
        size += 1
    }

    public fun writeFixed32(value: Int) {
        ensureCapacity(4)
        buffer[size] = value.toByte()
        buffer[size + 1] = (value ushr 8).toByte()
        buffer[size + 2] = (value ushr 16).toByte()
        buffer[size + 3] = (value ushr 24).toByte()
        size += 4
    }

    public fun writeFixed64(value: Long) {
        ensureCapacity(8)
        for (index in 0 until 8) {
            buffer[size + index] = (value ushr (index * 8)).toByte()
        }
        size += 8
    }

    public fun writeFloat32(value: Float) {
        writeFixed32(value.toRawBits())
    }

    public fun writeFloat64(value: Double) {
        writeFixed64(value.toRawBits())
    }

    public fun writeString(value: String) {
        val bytes = value.encodeToByteArray()
        writeVarint(bytes.size.toLong())
        writeRaw(bytes, 0, bytes.size)
    }

    public fun writeBytes(value: ByteArray) {
        writeVarint(value.size.toLong())
        writeRaw(value, 0, value.size)
    }

    public fun writeRaw(source: ByteArray, offset: Int = 0, count: Int = source.size) {
        if (offset < 0 || count < 0 || offset + count > source.size) {
            throw ProtocolError("invalid raw slice")
        }
        ensureCapacity(count)
        source.copyInto(buffer, size, offset, offset + count)
        size += count
    }

    public fun reserveBitmap(bitCount: Int): Int {
        if (bitCount < 0) throw ProtocolError("negative bitmap size")
        val byteCount = (bitCount + 7) ushr 3
        ensureCapacity(byteCount)
        val start = size
        buffer.fill(0, start, start + byteCount)
        size += byteCount
        return start
    }

    public fun setBit(bitmapOffset: Int, index: Int) {
        val position = bitmapOffset + (index ushr 3)
        val mask = 1 shl (index and 7)
        buffer[position] = (buffer[position].toInt() or mask).toByte()
    }

    public fun toByteArray(): ByteArray = buffer.copyOf(size)

    private fun ensureCapacity(extra: Int) {
        val required = size + extra
        if (required < 0 || required > options.maxSize) {
            throw ProtocolError("message exceeds maximum size of ${options.maxSize} bytes")
        }
        if (required <= buffer.size) return
        var capacity = buffer.size
        while (capacity < required) {
            capacity = if (capacity > Int.MAX_VALUE / 2) Int.MAX_VALUE else capacity shl 1
        }
        buffer = buffer.copyOf(capacity.coerceAtMost(options.maxSize))
    }
}
