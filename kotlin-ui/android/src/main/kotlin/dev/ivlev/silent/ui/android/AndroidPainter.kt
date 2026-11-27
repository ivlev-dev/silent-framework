package dev.ivlev.silent.ui.android

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import dev.ivlev.silent.ui.paint.Painter
import dev.ivlev.silent.ui.paint.TextMeasurer
import dev.ivlev.silent.ui.tokens.Color
import dev.ivlev.silent.ui.tokens.TextStyle

class AndroidPainter(private val canvas: Canvas) : Painter {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val typefaces = TypefaceCache()

    override fun save() {
        canvas.save()
    }

    override fun restore() {
        canvas.restore()
    }

    override fun translate(dx: Float, dy: Float) {
        canvas.translate(dx, dy)
    }

    override fun clip(x: Float, y: Float, width: Float, height: Float) {
        canvas.clipRect(x, y, x + width, y + height)
    }

    override fun rect(x: Float, y: Float, width: Float, height: Float, color: Color) {
        paint.color = color.argb.toInt()
        paint.style = Paint.Style.FILL
        canvas.drawRect(x, y, x + width, y + height, paint)
    }

    override fun roundRect(
        x: Float,
        y: Float,
        width: Float,
        height: Float,
        radius: Float,
        color: Color,
    ) {
        paint.color = color.argb.toInt()
        paint.style = Paint.Style.FILL
        canvas.drawRoundRect(x, y, x + width, y + height, radius, radius, paint)
    }

    override fun strokeRoundRect(
        x: Float,
        y: Float,
        width: Float,
        height: Float,
        radius: Float,
        strokeWidth: Float,
        color: Color,
    ) {
        paint.color = color.argb.toInt()
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = strokeWidth
        canvas.drawRoundRect(x, y, x + width, y + height, radius, radius, paint)
        paint.style = Paint.Style.FILL
    }

    override fun circle(centerX: Float, centerY: Float, radius: Float, color: Color) {
        paint.color = color.argb.toInt()
        paint.style = Paint.Style.FILL
        canvas.drawCircle(centerX, centerY, radius, paint)
    }

    override fun line(x1: Float, y1: Float, x2: Float, y2: Float, strokeWidth: Float, color: Color) {
        paint.color = color.argb.toInt()
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = strokeWidth
        canvas.drawLine(x1, y1, x2, y2, paint)
        paint.style = Paint.Style.FILL
    }

    override fun text(text: String, x: Float, baseline: Float, style: TextStyle, color: Color) {
        paint.color = color.argb.toInt()
        paint.style = Paint.Style.FILL
        paint.typeface = typefaces.forWeight(style.weight)
        paint.textSize = style.size
        canvas.drawText(text, x, baseline, paint)
    }
}

class AndroidTextMeasurer : TextMeasurer {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val typefaces = TypefaceCache()

    private fun prepare(style: TextStyle) {
        paint.typeface = typefaces.forWeight(style.weight)
        paint.textSize = style.size
    }

    override fun width(text: String, style: TextStyle): Float {
        prepare(style)
        return paint.measureText(text)
    }

    override fun ascent(style: TextStyle): Float {
        prepare(style)
        return -paint.fontMetrics.ascent
    }

    override fun descent(style: TextStyle): Float {
        prepare(style)
        return paint.fontMetrics.descent
    }
}

class TypefaceCache {
    private val cache: MutableMap<Int, Typeface> = mutableMapOf()

    fun forWeight(weight: Int): Typeface = cache.getOrPut(weight) {
        Typeface.create("sans-serif", if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)
    }
}
