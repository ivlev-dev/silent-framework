package dev.ivlev.silent.protocol

public object ProtoSort {
    public fun compareUtf8(left: String, right: String): Int {
        var leftIndex = 0
        var rightIndex = 0
        while (leftIndex < left.length && rightIndex < right.length) {
            val leftCodePoint = codePointAt(left, leftIndex)
            val rightCodePoint = codePointAt(right, rightIndex)
            if (leftCodePoint != rightCodePoint) {
                return leftCodePoint.compareTo(rightCodePoint)
            }
            leftIndex += charCount(leftCodePoint)
            rightIndex += charCount(rightCodePoint)
        }
        return (left.length - leftIndex).compareTo(right.length - rightIndex)
    }

    private fun codePointAt(value: String, index: Int): Int {
        val high = value[index]
        if (high.isHighSurrogate() && index + 1 < value.length) {
            val low = value[index + 1]
            if (low.isLowSurrogate()) {
                return 0x10000 + ((high.code - 0xD800) shl 10) + (low.code - 0xDC00)
            }
        }
        return high.code
    }

    private fun charCount(codePoint: Int): Int = if (codePoint > 0xFFFF) 2 else 1
}
