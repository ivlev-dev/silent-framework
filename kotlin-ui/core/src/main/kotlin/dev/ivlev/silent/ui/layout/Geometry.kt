package dev.ivlev.silent.ui.layout

import dev.ivlev.silent.ui.paint.TextMeasurer
import dev.ivlev.silent.ui.tokens.Theme

data class Size(val width: Float, val height: Float) {
    companion object {
        val Zero = Size(0f, 0f)
    }
}

data class Offset(val x: Float, val y: Float) {
    companion object {
        val Zero = Offset(0f, 0f)
    }
}

data class Insets(
    val top: Float = 0f,
    val end: Float = 0f,
    val bottom: Float = 0f,
    val start: Float = 0f,
) {
    val horizontal: Float
        get() = start + end

    val vertical: Float
        get() = top + bottom

    companion object {
        fun all(value: Float): Insets = Insets(value, value, value, value)
        fun symmetric(horizontal: Float = 0f, vertical: Float = 0f): Insets =
            Insets(vertical, horizontal, vertical, horizontal)
    }
}

data class Rect(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
) {
    val right: Float
        get() = x + width

    val bottom: Float
        get() = y + height

    fun contains(px: Float, py: Float): Boolean = px >= x && px <= right && py >= y && py <= bottom

    fun inset(insets: Insets): Rect = Rect(
        x + insets.start,
        y + insets.top,
        (width - insets.horizontal).coerceAtLeast(0f),
        (height - insets.vertical).coerceAtLeast(0f),
    )

    fun translated(dx: Float, dy: Float): Rect = copy(x = x + dx, y = y + dy)

    companion object {
        val Zero = Rect(0f, 0f, 0f, 0f)
    }
}

data class Constraints(
    val minWidth: Float = 0f,
    val maxWidth: Float = Float.POSITIVE_INFINITY,
    val minHeight: Float = 0f,
    val maxHeight: Float = Float.POSITIVE_INFINITY,
) {
    fun constrain(size: Size): Size = Size(
        width = size.width.coerceIn(minWidth, maxWidth),
        height = size.height.coerceIn(minHeight, maxHeight),
    )

    companion object {
        fun tight(width: Float, height: Float): Constraints =
            Constraints(width, width, height, height)

        fun loose(maxWidth: Float, maxHeight: Float): Constraints =
            Constraints(0f, maxWidth, 0f, maxHeight)
    }
}

enum class Align {
    Start,
    Center,
    End,
    Stretch,
}

enum class Justify {
    Start,
    Center,
    End,
    SpaceBetween,
}

enum class TextAlign {
    Start,
    Center,
    End,
}

data class BuildContext(
    val theme: Theme,
    val textMeasurer: TextMeasurer,
    val viewportWidth: Float,
    val viewportHeight: Float,
    val density: Float = 1f,
)
