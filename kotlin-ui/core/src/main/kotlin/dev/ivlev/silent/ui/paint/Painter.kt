package dev.ivlev.silent.ui.paint

import dev.ivlev.silent.ui.tokens.Color
import dev.ivlev.silent.ui.tokens.TextStyle

interface Painter {
    fun save()
    fun restore()
    fun translate(dx: Float, dy: Float)
    fun clip(x: Float, y: Float, width: Float, height: Float)
    fun rect(x: Float, y: Float, width: Float, height: Float, color: Color)
    fun roundRect(x: Float, y: Float, width: Float, height: Float, radius: Float, color: Color)
    fun strokeRoundRect(
        x: Float,
        y: Float,
        width: Float,
        height: Float,
        radius: Float,
        strokeWidth: Float,
        color: Color,
    )
    fun circle(centerX: Float, centerY: Float, radius: Float, color: Color)
    fun line(x1: Float, y1: Float, x2: Float, y2: Float, strokeWidth: Float, color: Color)
    fun text(text: String, x: Float, baseline: Float, style: TextStyle, color: Color)
}

class RecordingPainter : Painter {
    sealed interface Command {
        data object Save : Command
        data object Restore : Command
        data class Translate(val dx: Float, val dy: Float) : Command
        data class Clip(val x: Float, val y: Float, val width: Float, val height: Float) : Command
        data class Rect(val x: Float, val y: Float, val width: Float, val height: Float, val color: Color) : Command
        data class RoundRect(
            val x: Float,
            val y: Float,
            val width: Float,
            val height: Float,
            val radius: Float,
            val color: Color,
        ) : Command
        data class Circle(val centerX: Float, val centerY: Float, val radius: Float, val color: Color) : Command
        data class Line(
            val x1: Float,
            val y1: Float,
            val x2: Float,
            val y2: Float,
            val strokeWidth: Float,
            val color: Color,
        ) : Command
        data class Text(
            val text: String,
            val x: Float,
            val baseline: Float,
            val style: TextStyle,
            val color: Color,
        ) : Command
    }

    val commands: MutableList<Command> = mutableListOf()

    override fun save() {
        commands.add(Command.Save)
    }

    override fun restore() {
        commands.add(Command.Restore)
    }

    override fun translate(dx: Float, dy: Float) {
        commands.add(Command.Translate(dx, dy))
    }

    override fun clip(x: Float, y: Float, width: Float, height: Float) {
        commands.add(Command.Clip(x, y, width, height))
    }

    override fun rect(x: Float, y: Float, width: Float, height: Float, color: Color) {
        commands.add(Command.Rect(x, y, width, height, color))
    }

    override fun roundRect(x: Float, y: Float, width: Float, height: Float, radius: Float, color: Color) {
        commands.add(Command.RoundRect(x, y, width, height, radius, color))
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
        commands.add(Command.Rect(x, y, width, height, color))
    }

    override fun circle(centerX: Float, centerY: Float, radius: Float, color: Color) {
        commands.add(Command.Circle(centerX, centerY, radius, color))
    }

    override fun line(x1: Float, y1: Float, x2: Float, y2: Float, strokeWidth: Float, color: Color) {
        commands.add(Command.Line(x1, y1, x2, y2, strokeWidth, color))
    }

    override fun text(text: String, x: Float, baseline: Float, style: TextStyle, color: Color) {
        commands.add(Command.Text(text, x, baseline, style, color))
    }
}
