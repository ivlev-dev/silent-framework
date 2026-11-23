package dev.ivlev.silent.protocol

public object ProtoNumbers {
    public fun toByte(value: Int): Byte {
        if (value < Byte.MIN_VALUE || value > Byte.MAX_VALUE) {
            throw ProtocolError("value out of byte range: $value")
        }
        return value.toByte()
    }

    public fun toShort(value: Int): Short {
        if (value < Short.MIN_VALUE || value > Short.MAX_VALUE) {
            throw ProtocolError("value out of short range: $value")
        }
        return value.toShort()
    }

    public fun toUByte(value: Int): UByte {
        if (value < 0 || value > 0xFF) {
            throw ProtocolError("value out of ubyte range: $value")
        }
        return value.toUByte()
    }

    public fun toUShort(value: Int): UShort {
        if (value < 0 || value > 0xFFFF) {
            throw ProtocolError("value out of ushort range: $value")
        }
        return value.toUShort()
    }

    public fun requireInt32(value: Long): Int {
        if (value < Int.MIN_VALUE.toLong() || value > Int.MAX_VALUE.toLong()) {
            throw ProtocolError("value out of int32 range: $value")
        }
        return value.toInt()
    }

    public fun requireUInt32(value: Long): Int {
        if (value < 0L || value > 0xFFFF_FFFFL) {
            throw ProtocolError("value out of uint32 range: $value")
        }
        return value.toInt()
    }

    public fun uint32ToLong(value: Int): Long = value.toLong() and 0xFFFF_FFFFL
}
