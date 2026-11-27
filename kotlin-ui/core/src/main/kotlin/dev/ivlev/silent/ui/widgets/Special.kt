package dev.ivlev.silent.ui.widgets

import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.Constraints
import dev.ivlev.silent.ui.layout.HitRegion
import dev.ivlev.silent.ui.layout.Rect
import dev.ivlev.silent.ui.layout.RenderNode
import dev.ivlev.silent.ui.layout.Size
import dev.ivlev.silent.ui.layout.Widget
import dev.ivlev.silent.ui.tokens.Color
import dev.ivlev.silent.ui.tokens.Spacing
import dev.ivlev.silent.ui.tokens.Typography
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter

class DatePicker(
    val label: String = "Дата",
    val value: LocalDate? = null,
    val open: Boolean = false,
    val onSelect: (LocalDate) -> Unit = {},
    val min: LocalDate? = null,
    val max: LocalDate? = null,
) : Widget() {
    private val month: YearMonth = YearMonth.from(value ?: LocalDate.now())

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 320f
        return constraints.constrain(Size(width, 70f + if (open) 7 * 32f + 16f else 0f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        if (!open) return RenderNode(this, bounds, emptyList())
        val firstOffset = month.atDay(1).dayOfWeek.value - 1
        val days = month.lengthOfMonth()
        val cell = bounds.width / 7f
        val nodes = (1..days).map { day ->
            val date = month.atDay(day)
            val index = firstOffset + day - 1
            val x = bounds.x + (index % 7) * cell
            val y = bounds.y + 54f + (index / 7) * 32f
            HitRegion(
                onClick = { onSelect(date) },
                enabled = (min == null || !date.isBefore(min)) && (max == null || !date.isAfter(max)),
            ).build(context, Rect(x, y, cell, 32f))
        }
        return RenderNode(this, bounds, nodes)
    }
}

class DateRangePicker(
    val label: String = "Период",
    val start: LocalDate? = null,
    val end: LocalDate? = null,
    val open: Boolean = false,
    val onSelect: (LocalDate, LocalDate) -> Unit = { _, _ -> },
) : Widget() {
    private val month: YearMonth = YearMonth.from(start ?: LocalDate.now())

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 520f
        return constraints.constrain(Size(width, 70f + if (open) 7 * 32f + 16f else 0f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        if (!open) return RenderNode(this, bounds, emptyList())
        val days = month.lengthOfMonth()
        val cell = bounds.width / 7f
        val nodes = (1..days).map { day ->
            val date = month.atDay(day)
            val index = month.atDay(1).dayOfWeek.value - 1 + day - 1
            HitRegion(onClick = {
                val currentStart = start
                if (currentStart == null || end != null) {
                    onSelect(date, date)
                } else {
                    onSelect(currentStart, date)
                }
            }).build(
                context,
                Rect(
                    bounds.x + (index % 7) * cell,
                    bounds.y + 54f + (index / 7) * 32f,
                    cell,
                    32f,
                ),
            )
        }
        return RenderNode(this, bounds, nodes)
    }
}

class ColorPicker(
    val value: Color = Color.hex("#0E2A47"),
    val palette: List<Color> = listOf(
        Color.hex("#0E2A47"),
        Color.hex("#1F4E6B"),
        Color.hex("#9FB8C9"),
        Color.hex("#A8322A"),
        Color.hex("#1F6B45"),
        Color.hex("#7A5200"),
        Color.hex("#081A2E"),
        Color.hex("#F2F5F7"),
    ),
    val onSelect: (Color) -> Unit = {},
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 260f
        return constraints.constrain(Size(width, 80f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val size = 28f
        val gap = 8f
        val nodes = palette.mapIndexed { index, color ->
            HitRegion(onClick = { onSelect(color) }).build(
                context,
                Rect(bounds.x + index * (size + gap), bounds.y + 24f, size, size),
            )
        }
        return RenderNode(this, bounds, nodes)
    }
}

class RichTextEditor(
    val value: String = "",
    val placeholder: String = "Начните печатать…",
    val height: Float = 180f,
    val toolbar: List<String> = listOf("B", "I", "U", "•", "1.", "↶"),
    val onAction: (String) -> Unit = {},
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 480f
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val itemWidth = 36f
        val nodes = toolbar.mapIndexed { index, action ->
            HitRegion(onClick = { onAction(action) }).build(
                context,
                Rect(bounds.x + 8f + index * itemWidth, bounds.y + 8f, itemWidth, 32f),
            )
        }
        return RenderNode(this, bounds, nodes)
    }
}

fun dateLabel(date: LocalDate?): String =
    date?.format(DateTimeFormatter.ofPattern("dd.MM.yyyy")) ?: ""
