package dev.ivlev.silent.ui.paint

import dev.ivlev.silent.ui.layout.AdaptiveScaffold
import dev.ivlev.silent.ui.layout.Box
import dev.ivlev.silent.ui.layout.Column
import dev.ivlev.silent.ui.layout.Expanded
import dev.ivlev.silent.ui.layout.Grid
import dev.ivlev.silent.ui.layout.NavItemWidget
import dev.ivlev.silent.ui.layout.NavigationBar
import dev.ivlev.silent.ui.layout.NavigationRail
import dev.ivlev.silent.ui.layout.RenderNode
import dev.ivlev.silent.ui.layout.Row
import dev.ivlev.silent.ui.layout.Screen
import dev.ivlev.silent.ui.layout.Scroll
import dev.ivlev.silent.ui.layout.Spacer
import dev.ivlev.silent.ui.layout.Stack
import dev.ivlev.silent.ui.layout.TextAlign
import dev.ivlev.silent.ui.layout.Widget
import dev.ivlev.silent.ui.lifecycle.ViewComponent
import dev.ivlev.silent.ui.tokens.Color
import dev.ivlev.silent.ui.tokens.Control
import dev.ivlev.silent.ui.tokens.Radii
import dev.ivlev.silent.ui.tokens.Spacing
import dev.ivlev.silent.ui.tokens.TextStyle
import dev.ivlev.silent.ui.tokens.Theme
import dev.ivlev.silent.ui.tokens.Typography
import dev.ivlev.silent.ui.widgets.Button
import dev.ivlev.silent.ui.widgets.ButtonVariant
import dev.ivlev.silent.ui.widgets.Card as CardWidget
import dev.ivlev.silent.ui.widgets.Checkbox
import dev.ivlev.silent.ui.widgets.Divider as DividerWidget
import dev.ivlev.silent.ui.widgets.FieldType
import dev.ivlev.silent.ui.widgets.FormProgress as FormProgressWidget
import dev.ivlev.silent.ui.widgets.IconButton
import dev.ivlev.silent.ui.widgets.Progress
import dev.ivlev.silent.ui.widgets.Select
import dev.ivlev.silent.ui.widgets.Switch
import dev.ivlev.silent.ui.widgets.Table
import dev.ivlev.silent.ui.widgets.Tag
import dev.ivlev.silent.ui.widgets.TagTone
import dev.ivlev.silent.ui.widgets.Text
import dev.ivlev.silent.ui.widgets.TextField
import kotlin.math.roundToInt

class UiRenderer(
    private val painter: Painter,
    private val theme: Theme,
    private val measurer: TextMeasurer,
    private val hideFieldText: (TextField) -> Boolean = { false },
    private val focusedField: () -> TextField? = { null },
) {
    fun render(root: RenderNode) {
        paintNode(root)
    }

    private fun paintNode(node: RenderNode) {
        when (val widget = node.widget) {
            is Screen -> paintBackground(node, widget.background)
            is ViewComponent -> painter.rect(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height, theme.colors.background)
            is Box -> paintSurface(node, widget.background, widget.borderColor, widget.radius, 1f)
            is Stack -> paintBackground(node, widget.background)
            is Column -> paintBackground(node, widget.background)
            is Row -> paintBackground(node, widget.background)
            is Grid -> paintBackground(node, widget.background)
            is CardWidget -> paintCard(node, widget)
            is Text -> paintText(node, widget)
            is Button -> paintButton(node, widget)
            is IconButton -> paintIconButton(node, widget)
            is Checkbox -> paintCheckbox(node, widget)
            is Switch -> paintSwitch(node, widget)
            is Select<*> -> paintSelect(node, widget)
            is DividerWidget -> paintDivider(node, widget)
            is Progress -> paintProgress(node, widget)
            is FormProgressWidget -> paintFormProgress(node, widget)
            is TextField -> paintTextField(node, widget)
            is Table -> paintTable(node, widget)
            is Tag -> paintTag(node, widget)
            is NavigationRail -> paintRail(node, widget)
            is NavigationBar -> paintBar(node, widget)
            is NavItemWidget -> paintNavItem(node, widget)
            is Scroll -> {
                painter.save()
                painter.clip(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height)
                node.children.forEach(::paintNode)
                painter.restore()
                return
            }

            is Spacer, is Expanded, is AdaptiveScaffold -> Unit
            else -> Unit
        }
        node.children.forEach(::paintNode)
    }

    private fun paintBackground(node: RenderNode, background: ((Theme) -> Color)?) {
        val color = background?.invoke(theme) ?: return
        painter.rect(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height, color)
    }

    private fun paintSurface(
        node: RenderNode,
        background: ((Theme) -> Color)?,
        borderColor: ((Theme) -> Color)?,
        radius: Float,
        strokeWidth: Float,
    ) {
        val bg = background?.invoke(theme)
        if (bg != null) {
            if (radius > 0f) {
                painter.roundRect(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height, radius, bg)
            } else {
                painter.rect(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height, bg)
            }
        }
        val border = borderColor?.invoke(theme)
        if (border != null && radius > 0f) {
            painter.strokeRoundRect(
                node.bounds.x,
                node.bounds.y,
                node.bounds.width,
                node.bounds.height,
                radius,
                strokeWidth,
                border,
            )
        }
    }

    private fun paintCard(node: RenderNode, widget: CardWidget) {
        paintSurface(node, widget.background, widget.borderColor, widget.radius, 1f)
    }

    private fun paintText(node: RenderNode, widget: Text) {
        val color = widget.color?.invoke(theme) ?: theme.colors.onSurface
        drawText(widget.text, node.bounds, widget.style, color, widget.align, widget.maxLines)
    }

    private fun paintButton(node: RenderNode, widget: Button) {
        val bounds = node.bounds
        val enabled = widget.enabled && !widget.loading
        val alpha = if (enabled) 1f else 0.38f
        when (widget.variant) {
            ButtonVariant.Primary -> {
                painter.roundRect(
                    bounds.x,
                    bounds.y,
                    bounds.width,
                    bounds.height,
                    Radii.control,
                    theme.colors.primary.withAlpha(alpha),
                )
                drawText(
                    if (widget.loading) "${widget.text}…" else widget.text,
                    bounds,
                    Typography.labelLarge,
                    theme.colors.onPrimary.withAlpha(alpha),
                    TextAlign.Center,
                    verticalCenter = true,
                )
            }

            ButtonVariant.Secondary -> {
                painter.strokeRoundRect(
                    bounds.x,
                    bounds.y,
                    bounds.width,
                    bounds.height,
                    Radii.control,
                    1f,
                    theme.colors.outline.withAlpha(alpha),
                )
                drawText(
                    widget.text,
                    bounds,
                    Typography.labelLarge,
                    theme.colors.primary.withAlpha(alpha),
                    TextAlign.Center,
                    verticalCenter = true,
                )
            }

            ButtonVariant.Ghost -> {
                drawText(
                    widget.text,
                    bounds,
                    Typography.labelLarge,
                    theme.colors.primary.withAlpha(alpha),
                    TextAlign.Center,
                    verticalCenter = true,
                )
            }
        }
    }

    private fun paintIconButton(node: RenderNode, widget: IconButton) {
        val bounds = node.bounds
        painter.roundRect(
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            Radii.md,
            theme.colors.surfaceContainerHigh,
        )
        drawText(
            widget.glyph,
            bounds,
            TextStyle(18f, 24f, 600),
            if (widget.enabled) theme.colors.onSurface else theme.colors.onSurface.withAlpha(0.38f),
            TextAlign.Center,
            verticalCenter = true,
        )
    }

    private fun paintCheckbox(node: RenderNode, widget: Checkbox) {
        val bounds = node.bounds
        val box = 20f
        val checked = widget.field.value
        if (checked) {
            painter.roundRect(bounds.x, bounds.y + 4f, box, box, Radii.xs, theme.colors.primary)
            painter.line(
                bounds.x + 5f,
                bounds.y + 14f,
                bounds.x + 9f,
                bounds.y + 18f,
                2f,
                theme.colors.onPrimary,
            )
            painter.line(
                bounds.x + 9f,
                bounds.y + 18f,
                bounds.x + 16f,
                bounds.y + 9f,
                2f,
                theme.colors.onPrimary,
            )
        } else {
            painter.strokeRoundRect(bounds.x, bounds.y + 4f, box, box, Radii.xs, 1f, theme.colors.outline)
        }
        widget.label?.let { label ->
            drawText(
                label,
                dev.ivlev.silent.ui.layout.Rect(bounds.x + 28f, bounds.y, bounds.width - 28f, bounds.height),
                Typography.bodySmall,
                theme.colors.onSurface,
                verticalCenter = true,
            )
        }
    }

    private fun paintSwitch(node: RenderNode, widget: Switch) {
        val bounds = node.bounds
        val trackWidth = 44f
        val trackHeight = 24f
        val checked = widget.field.value
        painter.roundRect(
            bounds.x,
            bounds.y + 2f,
            trackWidth,
            trackHeight,
            trackHeight / 2f,
            if (checked) theme.colors.primary else theme.colors.surfaceContainerHighest,
        )
        val thumbX = if (checked) bounds.x + trackWidth - 12f else bounds.x + 12f
        painter.circle(thumbX, bounds.y + 14f, 10f, if (checked) theme.colors.onPrimary else theme.colors.surfaceBright)
        widget.label?.let { label ->
            drawText(
                label,
                dev.ivlev.silent.ui.layout.Rect(bounds.x + 52f, bounds.y, bounds.width - 52f, bounds.height),
                Typography.bodySmall,
                theme.colors.onSurface,
                verticalCenter = true,
            )
        }
    }

    private fun paintSelect(node: RenderNode, widget: Select<*>) {
        val bounds = node.bounds
        val labelHeight = if (widget.label != null) 24f else 0f
        widget.label?.let { label ->
            drawText(
                label,
                dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, 20f),
                Typography.labelMedium,
                theme.colors.onSurfaceMuted,
            )
        }
        val fieldRect = dev.ivlev.silent.ui.layout.Rect(
            bounds.x,
            bounds.y + labelHeight,
            bounds.width,
            Control.heightLg,
        )
        painter.roundRect(
            fieldRect.x,
            fieldRect.y,
            fieldRect.width,
            fieldRect.height,
            Radii.control,
            theme.colors.surfaceContainerLowest,
        )
        painter.strokeRoundRect(
            fieldRect.x,
            fieldRect.y,
            fieldRect.width,
            fieldRect.height,
            Radii.control,
            1f,
            theme.colors.outlineVariant,
        )
        drawText(
            widget.selectedLabel,
            dev.ivlev.silent.ui.layout.Rect(
                fieldRect.x + 14f,
                fieldRect.y,
                fieldRect.width - 44f,
                fieldRect.height,
            ),
            Typography.bodyMedium,
            if (widget.selectedLabel == widget.placeholder) theme.colors.onSurfaceMuted else theme.colors.onSurface,
            verticalCenter = true,
        )
        drawText(
            "▾",
            dev.ivlev.silent.ui.layout.Rect(fieldRect.right - 32f, fieldRect.y, 24f, fieldRect.height),
            Typography.bodyMedium,
            theme.colors.onSurfaceMuted,
            TextAlign.Center,
            verticalCenter = true,
        )
    }

    private fun paintDivider(node: RenderNode, widget: DividerWidget) {
        painter.rect(
            node.bounds.x,
            node.bounds.y,
            node.bounds.width,
            node.bounds.height.coerceAtLeast(1f),
            widget.color?.invoke(theme) ?: theme.colors.outlineVariant,
        )
    }

    private fun paintProgress(node: RenderNode, widget: Progress) {
        val bounds = node.bounds
        painter.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, bounds.height / 2f, theme.colors.surfaceContainerHighest)
        val value = widget.currentValue()
        if (value > 0f) {
            painter.roundRect(
                bounds.x,
                bounds.y,
                bounds.width * value,
                bounds.height,
                bounds.height / 2f,
                widget.color?.invoke(theme) ?: theme.colors.primary,
            )
        }
    }

    private fun paintFormProgress(node: RenderNode, widget: FormProgressWidget) {
        val bounds = node.bounds
        val percent = widget.percent()
        if (widget.showLabel) {
            drawText(
                "Заполнено $percent%",
                dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, 20f),
                Typography.labelMedium,
                theme.colors.onSurfaceMuted,
            )
        }
        val barY = if (widget.showLabel) bounds.y + 26f else bounds.y + 4f
        painter.roundRect(bounds.x, barY, bounds.width, 6f, 3f, theme.colors.surfaceContainerHighest)
        if (percent > 0) {
            painter.roundRect(
                bounds.x,
                barY,
                bounds.width * percent / 100f,
                6f,
                3f,
                theme.colors.primary,
            )
        }
    }

    private fun paintTextField(node: RenderNode, widget: TextField) {
        val bounds = node.bounds
        val labelHeight = if (widget.label != null) TextField.LABEL_HEIGHT else 0f
        widget.label?.let { label ->
            drawText(
                label,
                dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, TextField.LABEL_HEIGHT),
                Typography.labelMedium,
                theme.colors.onSurfaceMuted,
            )
        }
        val fieldRect = dev.ivlev.silent.ui.layout.Rect(
            bounds.x,
            bounds.y + labelHeight,
            bounds.width,
            Control.heightLg,
        )
        val focused = focusedField() === widget
        val borderColor = when {
            widget.binding.error != null -> theme.colors.error
            focused -> theme.colors.primary
            else -> theme.colors.outlineVariant
        }
        painter.roundRect(
            fieldRect.x,
            fieldRect.y,
            fieldRect.width,
            fieldRect.height,
            Radii.control,
            theme.colors.surfaceContainerLowest,
        )
        painter.strokeRoundRect(
            fieldRect.x,
            fieldRect.y,
            fieldRect.width,
            fieldRect.height,
            Radii.control,
            if (focused) 2f else 1f,
            borderColor,
        )
        if (!hideFieldText(widget)) {
            val raw = widget.binding.value
            val display = when {
                raw.isEmpty() -> widget.hint ?: ""
                widget.fieldType == FieldType.Password -> "•".repeat(raw.length)
                else -> raw
            }
            val color = if (raw.isEmpty()) theme.colors.onSurfaceMuted else theme.colors.onSurface
            drawText(
                display,
                dev.ivlev.silent.ui.layout.Rect(
                    fieldRect.x + 14f,
                    fieldRect.y,
                    fieldRect.width - 28f,
                    fieldRect.height,
                ),
                Typography.bodyMedium,
                color,
                verticalCenter = true,
                maxLines = 1,
            )
        }
        widget.binding.error?.let { error ->
            drawText(
                error,
                dev.ivlev.silent.ui.layout.Rect(
                    bounds.x,
                    bounds.y + labelHeight + Control.heightLg + 2f,
                    bounds.width,
                    TextField.ERROR_HEIGHT,
                ),
                Typography.bodySmall,
                theme.colors.error,
                maxLines = 1,
            )
        }
    }

    private fun paintTable(node: RenderNode, widget: Table) {
        val bounds = node.bounds
        val weights = if (widget.columnWeights.size == widget.headers.size) {
            widget.columnWeights
        } else {
            List(widget.headers.size) { 1f }
        }
        val totalWeight = weights.sum().coerceAtLeast(0.01f)
        val widths = weights.map { bounds.width * it / totalWeight }
        var x = bounds.x
        widget.headers.forEachIndexed { index, header ->
            drawText(
                header,
                dev.ivlev.silent.ui.layout.Rect(x + 10f, bounds.y, widths[index] - 16f, widget.headerHeight),
                Typography.labelSmall,
                theme.colors.onSurfaceMuted,
                verticalCenter = true,
            )
            x += widths[index]
        }
        painter.rect(bounds.x, bounds.y + widget.headerHeight - 1f, bounds.width, 1f, theme.colors.outlineVariant)
        widget.rows.forEachIndexed { rowIndex, row ->
            val rowY = bounds.y + widget.headerHeight + rowIndex * widget.rowHeight
            var columnX = bounds.x
            row.forEachIndexed { columnIndex, value ->
                val width = widths.getOrElse(columnIndex) { 0f }
                drawText(
                    value,
                    dev.ivlev.silent.ui.layout.Rect(columnX + 10f, rowY, width - 16f, widget.rowHeight),
                    Typography.bodySmall,
                    theme.colors.onSurface,
                    verticalCenter = true,
                    maxLines = 1,
                )
                columnX += width
            }
            painter.rect(
                bounds.x,
                rowY + widget.rowHeight - 1f,
                bounds.width,
                1f,
                theme.colors.outlineVariant.withAlpha(0.6f),
            )
        }
    }

    private fun paintTag(node: RenderNode, widget: Tag) {
        val background = when (widget.tone) {
            TagTone.Neutral -> theme.colors.surfaceContainerHigh
            TagTone.Success -> theme.colors.successContainer
            TagTone.Warning -> theme.colors.warningContainer
            TagTone.Error -> theme.colors.errorContainer
        }
        val foreground = when (widget.tone) {
            TagTone.Neutral -> theme.colors.onSurfaceVariant
            TagTone.Success -> theme.colors.success
            TagTone.Warning -> theme.colors.warning
            TagTone.Error -> theme.colors.onErrorContainer
        }
        painter.roundRect(
            node.bounds.x,
            node.bounds.y,
            node.bounds.width,
            node.bounds.height,
            node.bounds.height / 2f,
            background,
        )
        drawText(
            widget.text,
            dev.ivlev.silent.ui.layout.Rect(
                node.bounds.x,
                node.bounds.y,
                node.bounds.width,
                node.bounds.height,
            ),
            Typography.labelSmall,
            foreground,
            TextAlign.Center,
            verticalCenter = true,
            maxLines = 1,
        )
    }

    private fun paintRail(node: RenderNode, widget: NavigationRail) {
        val bounds = node.bounds
        painter.rect(bounds.x, bounds.y, bounds.width, bounds.height, theme.colors.surfaceContainerLow)
        painter.rect(bounds.right - 1f, bounds.y, 1f, bounds.height, theme.colors.outlineVariant)
        if (widget.expanded) {
            drawText(
                widget.brand,
                dev.ivlev.silent.ui.layout.Rect(bounds.x + 20f, bounds.y + 20f, bounds.width - 32f, 28f),
                Typography.titleMedium,
                theme.colors.onSurface,
            )
            drawText(
                "WORKSPACE",
                dev.ivlev.silent.ui.layout.Rect(bounds.x + 20f, bounds.y + 46f, bounds.width - 32f, 18f),
                Typography.labelSmall,
                theme.colors.onSurfaceMuted,
            )
        } else {
            drawText(
                "S",
                dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y + 18f, bounds.width, 32f),
                Typography.headlineSmall,
                theme.colors.primary,
                TextAlign.Center,
            )
        }
    }

    private fun paintBar(node: RenderNode, widget: NavigationBar) {
        val bounds = node.bounds
        painter.rect(bounds.x, bounds.y, bounds.width, bounds.height, theme.colors.surfaceContainerLow)
        painter.rect(bounds.x, bounds.y, bounds.width, 1f, theme.colors.outlineVariant)
    }

    private fun paintNavItem(node: RenderNode, widget: NavItemWidget) {
        val bounds = node.bounds
        if (widget.selected) {
            painter.roundRect(
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
                Radii.md,
                theme.colors.primaryContainer,
            )
        }
        val contentColor = if (widget.selected) theme.colors.onPrimaryContainer else theme.colors.onSurfaceVariant
        if (widget.vertical) {
            val iconX = if (widget.showLabel) bounds.x + 16f else bounds.x + (bounds.width - 24f) / 2f
            drawText(
                widget.item.icon,
                dev.ivlev.silent.ui.layout.Rect(iconX, bounds.y, 24f, bounds.height),
                TextStyle(Control.iconMd, 24f, 600),
                contentColor,
                verticalCenter = true,
            )
            if (widget.showLabel) {
                drawText(
                    widget.item.label,
                    dev.ivlev.silent.ui.layout.Rect(bounds.x + 50f, bounds.y, bounds.width - 62f, bounds.height),
                    Typography.bodySmall,
                    contentColor,
                    verticalCenter = true,
                    maxLines = 1,
                )
            }
        } else {
            drawText(
                widget.item.icon.ifEmpty { widget.item.label.take(1) },
                dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y + 8f, bounds.width, 24f),
                TextStyle(Control.iconMd, 24f, 600),
                contentColor,
                TextAlign.Center,
            )
            drawText(
                widget.item.label,
                dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y + 32f, bounds.width, 20f),
                Typography.labelSmall,
                contentColor,
                TextAlign.Center,
                maxLines = 1,
            )
        }
    }

    private fun drawText(
        value: String,
        bounds: dev.ivlev.silent.ui.layout.Rect,
        style: TextStyle,
        color: Color,
        align: TextAlign = TextAlign.Start,
        maxLines: Int = Int.MAX_VALUE,
        verticalCenter: Boolean = false,
    ) {
        val lines = wrapText(value, style, bounds.width, measurer, maxLines)
        val blockHeight = lines.size * style.lineHeight
        val top = if (verticalCenter) bounds.y + (bounds.height - blockHeight) / 2f else bounds.y
        lines.forEachIndexed { index, line ->
            val lineWidth = measurer.width(line, style)
            val x = when (align) {
                TextAlign.Start -> bounds.x
                TextAlign.Center -> bounds.x + (bounds.width - lineWidth) / 2f
                TextAlign.End -> bounds.x + bounds.width - lineWidth
            }
            painter.text(
                line,
                x,
                top + measurer.ascent(style) + index * style.lineHeight,
                style,
                color,
            )
        }
    }
}

fun percentLabel(value: Float): String = "${(value * 100f).roundToInt()}%"
