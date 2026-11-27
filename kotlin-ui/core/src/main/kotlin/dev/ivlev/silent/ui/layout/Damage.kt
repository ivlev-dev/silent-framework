package dev.ivlev.silent.ui.layout

class DamageAccumulator {
    private var current: Rect? = null

    val isEmpty: Boolean
        get() = current == null

    fun add(rect: Rect) {
        if (rect.width <= 0f || rect.height <= 0f) return
        current = current?.let { merge(it, rect) } ?: rect
    }

    fun addAll(rects: Iterable<Rect>) {
        rects.forEach(::add)
    }

    fun take(): Rect? {
        val result = current
        current = null
        return result
    }

    fun peek(): Rect? = current

    private fun merge(first: Rect, second: Rect): Rect {
        val left = minOf(first.x, second.x)
        val top = minOf(first.y, second.y)
        val right = maxOf(first.right, second.right)
        val bottom = maxOf(first.bottom, second.bottom)
        return Rect(left, top, right - left, bottom - top)
    }
}
