package dev.ivlev.silent.ui.layout

class HoverState {
    var hoverPath: List<Int> = emptyList()
        private set
    var pressedPath: List<Int> = emptyList()
        private set
    var hoverBounds: Rect? = null
        private set

    fun updateHover(result: HitResult?): Rect? {
        val previous = hoverBounds
        hoverPath = result?.path ?: emptyList()
        hoverBounds = result?.bounds
        return merge(previous, hoverBounds)
    }

    fun press(result: HitResult?): Rect? {
        pressedPath = result?.path ?: emptyList()
        return result?.bounds
    }

    fun release(): Rect? {
        val previous = hoverBounds
        pressedPath = emptyList()
        return previous
    }

    fun clear(): Rect? {
        val previous = hoverBounds
        hoverPath = emptyList()
        pressedPath = emptyList()
        hoverBounds = null
        return previous
    }

    val isHovering: Boolean
        get() = hoverPath.isNotEmpty()

    private fun merge(first: Rect?, second: Rect?): Rect? {
        if (first == null) return second
        if (second == null) return first
        val left = minOf(first.x, second.x)
        val top = minOf(first.y, second.y)
        val right = maxOf(first.right, second.right)
        val bottom = maxOf(first.bottom, second.bottom)
        return Rect(left, top, right - left, bottom - top)
    }
}
