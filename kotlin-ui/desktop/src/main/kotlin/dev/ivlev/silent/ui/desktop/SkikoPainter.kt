package dev.ivlev.silent.ui.desktop

import dev.ivlev.silent.ui.paint.Painter
import dev.ivlev.silent.ui.paint.TextMeasurer
import dev.ivlev.silent.ui.tokens.Color
import dev.ivlev.silent.ui.tokens.TextStyle
import org.jetbrains.skia.Canvas
import org.jetbrains.skia.Font
import org.jetbrains.skia.FontMgr
import org.jetbrains.skia.FontStyle
import org.jetbrains.skia.Paint
import org.jetbrains.skia.PaintMode
import org.jetbrains.skia.RRect
import org.jetbrains.skia.Rect
import org.jetbrains.skia.Typeface

class SkikoPainter(private val canvas: Canvas) : Painter {
    private val paint = Paint().apply { isAntiAlias = true }
    private val fonts = FontCache()

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
        canvas.clipRect(Rect.makeXYWH(x, y, width, height))
    }

    override fun rect(x: Float, y: Float, width: Float, height: Float, color: Color) {
        paint.color = color.argb.toInt()
        paint.mode = PaintMode.FILL
        canvas.drawRect(Rect.makeXYWH(x, y, width, height), paint)
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
        paint.mode = PaintMode.FILL
        canvas.drawRRect(RRect.makeLTRB(x, y, x + width, y + height, radius), paint)
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
        paint.mode = PaintMode.STROKE
        paint.strokeWidth = strokeWidth
        canvas.drawRRect(RRect.makeLTRB(x, y, x + width, y + height, radius), paint)
        paint.mode = PaintMode.FILL
    }

    override fun circle(centerX: Float, centerY: Float, radius: Float, color: Color) {
        paint.color = color.argb.toInt()
        paint.mode = PaintMode.FILL
        canvas.drawCircle(centerX, centerY, radius, paint)
    }

    override fun line(x1: Float, y1: Float, x2: Float, y2: Float, strokeWidth: Float, color: Color) {
        paint.color = color.argb.toInt()
        paint.mode = PaintMode.STROKE
        paint.strokeWidth = strokeWidth
        canvas.drawLine(x1, y1, x2, y2, paint)
        paint.mode = PaintMode.FILL
    }

    override fun text(text: String, x: Float, baseline: Float, style: TextStyle, color: Color) {
        paint.color = color.argb.toInt()
        paint.mode = PaintMode.FILL
        canvas.drawString(text, x, baseline, fonts.font(style), paint)
    }

    fun measureWidth(text: String, style: TextStyle): Float =
        fonts.font(style).measureTextWidth(text)

    fun ascent(style: TextStyle): Float = -fonts.font(style).metrics.ascent

    fun descent(style: TextStyle): Float = fonts.font(style).metrics.descent
}

class FontCache {
    private val regular: Typeface =
        FontMgr.default.matchFamilyStyle("sans-serif", FontStyle.NORMAL)
            ?: error("Не найден системный шрифт sans-serif")
    private val bold: Typeface =
        FontMgr.default.matchFamilyStyle("sans-serif", FontStyle.BOLD) ?: regular
    private val cache: MutableMap<Pair<Int, Int>, Font> = mutableMapOf()

    fun font(style: TextStyle): Font {
        val weightKey = if (style.weight >= 600) 700 else 400
        val key = weightKey to style.size.toInt()
        return cache.getOrPut(key) {
            Font(if (weightKey == 700) bold else regular, style.size)
        }
    }
}

class SkikoTextMeasurer : TextMeasurer {
    private val fonts = FontCache()

    override fun width(text: String, style: TextStyle): Float =
        fonts.font(style).measureTextWidth(text)

    override fun ascent(style: TextStyle): Float = -fonts.font(style).metrics.ascent

    override fun descent(style: TextStyle): Float = fonts.font(style).metrics.descent
}
