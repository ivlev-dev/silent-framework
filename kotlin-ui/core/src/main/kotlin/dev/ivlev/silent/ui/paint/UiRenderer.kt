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
import dev.ivlev.silent.ui.layout.SizedBox
import dev.ivlev.silent.ui.layout.Stack
import dev.ivlev.silent.ui.layout.Rect
import dev.ivlev.silent.ui.layout.HitRegion
import dev.ivlev.silent.ui.layout.ClickTarget
import dev.ivlev.silent.ui.layout.TextAlign
import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.Widget
import dev.ivlev.silent.ui.lifecycle.ViewComponent
import dev.ivlev.silent.ui.tokens.Color
import dev.ivlev.silent.ui.tokens.Control
import dev.ivlev.silent.ui.tokens.ControlSize
import dev.ivlev.silent.ui.tokens.Radii
import dev.ivlev.silent.ui.tokens.Spacing
import dev.ivlev.silent.ui.tokens.TextStyle
import dev.ivlev.silent.ui.tokens.Theme
import dev.ivlev.silent.ui.tokens.Typography
import dev.ivlev.silent.ui.widgets.Accordion
import dev.ivlev.silent.ui.widgets.Alert
import dev.ivlev.silent.ui.widgets.Avatar
import dev.ivlev.silent.ui.widgets.Badge
import dev.ivlev.silent.ui.widgets.Breadcrumbs
import dev.ivlev.silent.ui.widgets.Button
import dev.ivlev.silent.ui.widgets.ButtonVariant
import dev.ivlev.silent.ui.widgets.Card as CardWidget
import dev.ivlev.silent.ui.widgets.Checkbox
import dev.ivlev.silent.ui.widgets.CheckboxGroup
import dev.ivlev.silent.ui.widgets.Chip
import dev.ivlev.silent.ui.widgets.ColorPicker
import dev.ivlev.silent.ui.widgets.Combobox
import dev.ivlev.silent.ui.widgets.DataColumn
import dev.ivlev.silent.ui.widgets.DataState
import dev.ivlev.silent.ui.widgets.DataTable
import dev.ivlev.silent.ui.widgets.DatePicker
import dev.ivlev.silent.ui.widgets.DateRangePicker
import dev.ivlev.silent.ui.widgets.Dialog
import dev.ivlev.silent.ui.widgets.DialogSize
import dev.ivlev.silent.ui.widgets.Divider as DividerWidget
import dev.ivlev.silent.ui.widgets.Drawer
import dev.ivlev.silent.ui.widgets.DrawerSide
import dev.ivlev.silent.ui.widgets.EmptyState
import dev.ivlev.silent.ui.widgets.Fab
import dev.ivlev.silent.ui.widgets.Field
import dev.ivlev.silent.ui.widgets.FieldGroup
import dev.ivlev.silent.ui.widgets.FieldType
import dev.ivlev.silent.ui.widgets.FileField
import dev.ivlev.silent.ui.widgets.FileUpload
import dev.ivlev.silent.ui.widgets.FieldArray
import dev.ivlev.silent.ui.widgets.FormActions
import dev.ivlev.silent.ui.widgets.FormProgress as FormProgressWidget
import dev.ivlev.silent.ui.widgets.IconButton
import dev.ivlev.silent.ui.widgets.PopupController
import dev.ivlev.silent.ui.widgets.VectorIcon
import dev.ivlev.silent.ui.widgets.Label
import dev.ivlev.silent.ui.widgets.Link
import dev.ivlev.silent.ui.widgets.ListPanel
import dev.ivlev.silent.ui.widgets.Listbox
import dev.ivlev.silent.ui.widgets.Menu
import dev.ivlev.silent.ui.widgets.NumberField
import dev.ivlev.silent.ui.widgets.OtpInput
import dev.ivlev.silent.ui.widgets.Pagination
import dev.ivlev.silent.ui.widgets.Popover
import dev.ivlev.silent.ui.widgets.Progress
import dev.ivlev.silent.ui.widgets.RadioGroup
import dev.ivlev.silent.ui.widgets.RichTextEditor
import dev.ivlev.silent.ui.widgets.SegmentedButton
import dev.ivlev.silent.ui.widgets.Select
import dev.ivlev.silent.ui.widgets.Sheet
import dev.ivlev.silent.ui.widgets.SheetSide
import dev.ivlev.silent.ui.widgets.Skeleton
import dev.ivlev.silent.ui.widgets.Slider
import dev.ivlev.silent.ui.widgets.Snackbar
import dev.ivlev.silent.ui.widgets.Spinner
import dev.ivlev.silent.ui.widgets.Switch
import dev.ivlev.silent.ui.widgets.Table
import dev.ivlev.silent.ui.widgets.Tabs
import dev.ivlev.silent.ui.widgets.Tag
import dev.ivlev.silent.ui.widgets.TagInput
import dev.ivlev.silent.ui.widgets.TagTone
import dev.ivlev.silent.ui.widgets.Textarea
import dev.ivlev.silent.ui.widgets.Text
import dev.ivlev.silent.ui.widgets.TextField
import dev.ivlev.silent.ui.widgets.Tooltip
import dev.ivlev.silent.ui.widgets.TopAppBar
import dev.ivlev.silent.ui.widgets.TopAppBarVariant
import dev.ivlev.silent.ui.widgets.TreeSelect
import dev.ivlev.silent.ui.widgets.dateLabel
import dev.ivlev.silent.ui.tokens.Tone
import java.time.LocalDate
import java.time.YearMonth
import kotlin.math.roundToInt

class UiRenderer(
    private val painter: Painter,
    private val theme: Theme,
    private val measurer: TextMeasurer,
    private val hideFieldText: (TextField) -> Boolean = { false },
    private val focusedField: () -> TextField? = { null },
    private val hoveredPath: List<Int> = emptyList(),
    private val pressedPath: List<Int> = emptyList(),
    private val hoverPoint: dev.ivlev.silent.ui.layout.Offset? = null,
) {
    private var clipBounds: Rect? = null
    private val pathStack: ArrayDeque<Int> = ArrayDeque()
    private var nodeHovered = false
    private var nodePressed = false

    fun render(root: RenderNode) {
        paintNode(root)
    }

    private fun paintNode(node: RenderNode) {
        val currentPath = pathStack.toList()
        nodeHovered = currentPath == hoveredPath && currentPath.isNotEmpty()
        nodePressed = currentPath == pressedPath && currentPath.isNotEmpty()
        val previousHovered = nodeHovered
        val previousPressed = nodePressed
        when (val widget = node.widget) {
            is Screen -> paintBackground(node, widget.background)
            is ViewComponent -> painter.rect(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height, theme.colors.background)
            is Box -> paintSurface(node, widget.background, widget.borderColor, widget.radius, 1f)
            is Stack -> paintBackground(node, widget.background)
            is Column -> paintBackground(node, widget.background)
            is Row -> paintBackground(node, widget.background)
            is Grid -> paintBackground(node, widget.background)
            is CardWidget -> paintCard(node, widget)
            is VectorIcon -> paintVectorIcon(node, widget)
            is Label -> paintLabel(node, widget)
            is Text -> paintText(node, widget)
            is Link -> paintLink(node, widget)
            is Button -> paintButton(node, widget)
            is Fab -> paintFab(node, widget)
            is Badge -> paintBadge(node, widget)
            is Chip -> paintChip(node, widget)
            is Avatar -> paintAvatar(node, widget)
            is Spinner -> paintSpinner(node, widget)
            is Skeleton -> paintSkeleton(node, widget)
            is EmptyState -> paintEmptyState(node, widget)
            is Alert -> paintAlert(node, widget)
            is TopAppBar -> paintTopAppBar(node, widget)
            is Tabs -> paintTabs(node, widget)
            is SegmentedButton -> paintSegmented(node, widget)
            is Breadcrumbs -> paintBreadcrumbs(node, widget)
            is Pagination -> paintPagination(node, widget)
            is Accordion -> paintAccordion(node, widget)
            is ListPanel -> paintList(node, widget)
            is DataTable -> paintDataTable(node, widget)
            is CheckboxGroup -> paintCheckboxGroup(node, widget)
            is RadioGroup -> paintRadioGroup(node, widget)
            is Slider -> paintSlider(node, widget)
            is Textarea -> paintTextarea(node, widget)
            is NumberField -> paintNumberField(node, widget)
            is OtpInput -> paintOtp(node, widget)
            is TagInput -> paintTagInput(node, widget)
            is Combobox -> paintCombobox(node, widget)
            is TreeSelect -> paintTreeSelect(node, widget)
            is Field -> paintField(node, widget)
            is FieldGroup -> paintFieldGroup(node, widget)
            is FormActions -> Unit
            is FileUpload -> paintFileUpload(node, widget)
            is FileField -> paintFileField(node, widget)
            is FieldArray -> paintFieldArray(node, widget)
            is Listbox -> paintListbox(node, widget)
            is DatePicker -> paintDatePicker(node, widget)
            is DateRangePicker -> paintDateRangePicker(node, widget)
            is ColorPicker -> paintColorPicker(node, widget)
            is RichTextEditor -> paintRichText(node, widget)
            is Dialog -> paintDialog(node, widget)
            is Drawer -> paintDrawer(node, widget)
            is Sheet -> paintSheet(node, widget)
            is Popover -> paintPopover(node, widget)
            is Menu -> paintMenu(node, widget)
            is Tooltip -> paintTooltip(node, widget)
            is Snackbar -> paintSnackbar(node, widget)
            is HitRegion -> Unit
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
                val previous = clipBounds
                clipBounds = previous?.let { intersectRects(it, node.bounds) } ?: node.bounds
                node.children.forEachIndexed { index, child ->
                    pathStack.addLast(index)
                    paintNode(child)
                    pathStack.removeLast()
                }
                if (widget.state.maxOffset > 0f) {
                    val trackWidth = 5f
                    val trackX = node.bounds.right - trackWidth - 3f
                    val trackHeight = (node.bounds.height - 8f).coerceAtLeast(20f)
                    painter.roundRect(
                        trackX,
                        node.bounds.y + 4f,
                        trackWidth,
                        trackHeight,
                        trackWidth / 2f,
                        theme.colors.surfaceContainerHighest.withAlpha(0.8f),
                    )
                    val ratio = (node.bounds.height / (node.bounds.height + widget.state.maxOffset))
                        .coerceIn(0.08f, 1f)
                    val thumbHeight = (trackHeight * ratio).coerceAtLeast(24f)
                    val progress = (widget.state.offset.value / widget.state.maxOffset).coerceIn(0f, 1f)
                    val thumbY = node.bounds.y + 4f + (trackHeight - thumbHeight) * progress
                    painter.roundRect(
                        trackX,
                        thumbY,
                        trackWidth,
                        thumbHeight,
                        trackWidth / 2f,
                        theme.colors.onSurfaceMuted.withAlpha(0.65f),
                    )
                }
                clipBounds = previous
                painter.restore()
                return
            }

            is Spacer, is Expanded, is AdaptiveScaffold, is FormActions, is HitRegion -> Unit
            is SizedBox -> widget.background?.let { color -> paintBackground(node, color) }
            else -> Unit
        }
        if (nodeHovered || nodePressed) paintHoverState(node)
        node.children.forEachIndexed { index, child ->
            pathStack.addLast(index)
            paintNode(child)
            pathStack.removeLast()
        }
        nodeHovered = previousHovered
        nodePressed = previousPressed
    }

    private fun paintHoverState(node: RenderNode) {
        val widget = node.widget
        if (widget is TextField || widget is Select<*> || widget is DataTable || widget is ListPanel || widget is Table) return
        if (widget is CardWidget) return
        if (node.children.isNotEmpty() && widget !is HitRegion) return
        if (widget !is ClickTarget && widget !is HitRegion) return
        val radius = when (widget) {
            is Chip, is Avatar -> node.bounds.height / 2f
            is Button, is IconButton -> Radii.control
            is NavItemWidget -> Radii.md
            is Tag -> Radii.xs
            else -> Radii.sm
        }
        val alpha = if (nodePressed) 0.12f else 0.08f
        val layerColor = when (widget) {
            is Button -> when (widget.variant) {
                ButtonVariant.Primary, ButtonVariant.Filled -> theme.colors.onPrimary
                ButtonVariant.Tonal -> theme.colors.onPrimaryContainer
                else -> theme.colors.primary
            }
            is IconButton -> when (widget.variant) {
                ButtonVariant.Primary, ButtonVariant.Filled -> theme.colors.onPrimary
                ButtonVariant.Tonal -> theme.colors.onPrimaryContainer
                else -> theme.colors.onSurface
            }
            is NavItemWidget -> if (widget.selected) theme.colors.onPrimaryContainer else theme.colors.onSurface
            else -> theme.colors.onSurface
        }
        painter.roundRect(
            node.bounds.x,
            node.bounds.y,
            node.bounds.width,
            node.bounds.height,
            radius,
            layerColor.withAlpha(alpha),
        )
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
        if (widget.interactive && (nodeHovered || nodePressed)) {
            painter.strokeRoundRect(
                node.bounds.x,
                node.bounds.y,
                node.bounds.width,
                node.bounds.height,
                widget.radius,
                if (nodePressed) 2f else 1f,
                theme.colors.primary.withAlpha(if (nodePressed) 0.8f else 0.5f),
            )
        }
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
                    widget.size.textStyle,
                    theme.colors.onPrimary.withAlpha(alpha),
                    TextAlign.Center,
                    verticalCenter = true,
                )
            }

            ButtonVariant.Tonal -> {
                painter.roundRect(
                    bounds.x,
                    bounds.y,
                    bounds.width,
                    bounds.height,
                    Radii.control,
                    theme.colors.primaryContainer.withAlpha(alpha),
                )
                drawText(
                    if (widget.loading) "${widget.text}…" else widget.text,
                    bounds,
                    widget.size.textStyle,
                    theme.colors.onPrimaryContainer.withAlpha(alpha),
                    TextAlign.Center,
                    verticalCenter = true,
                )
            }

            ButtonVariant.Secondary, ButtonVariant.Outlined -> {
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
                    widget.size.textStyle,
                    theme.colors.primary.withAlpha(alpha),
                    TextAlign.Center,
                    verticalCenter = true,
                )
            }

            ButtonVariant.Ghost, ButtonVariant.Text -> {
                drawText(
                    widget.text,
                    bounds,
                    widget.size.textStyle,
                    theme.colors.primary.withAlpha(alpha),
                    TextAlign.Center,
                    verticalCenter = true,
                )
            }

            ButtonVariant.Filled -> {
                painter.roundRect(
                    bounds.x,
                    bounds.y,
                    bounds.width,
                    bounds.height,
                    Radii.control,
                    theme.colors.primary.withAlpha(alpha),
                )
                drawText(
                    widget.text,
                    bounds,
                    widget.size.textStyle,
                    theme.colors.onPrimary.withAlpha(alpha),
                    TextAlign.Center,
                    verticalCenter = true,
                )
            }
        }
        val iconColor = when (widget.variant) {
            ButtonVariant.Primary, ButtonVariant.Filled -> theme.colors.onPrimary
            ButtonVariant.Tonal -> theme.colors.onPrimaryContainer
            else -> theme.colors.primary
        }.withAlpha(alpha)
        widget.leadingIcon?.let { icon ->
            drawText(
                icon,
                Rect(bounds.x + 10f, bounds.y, 20f, bounds.height),
                widget.size.textStyle,
                iconColor,
                TextAlign.Center,
                verticalCenter = true,
                maxLines = 1,
            )
        }
        widget.trailingIcon?.let { icon ->
            drawText(
                icon,
                Rect(bounds.right - 30f, bounds.y, 20f, bounds.height),
                widget.size.textStyle,
                iconColor,
                TextAlign.Center,
                verticalCenter = true,
                maxLines = 1,
            )
        }
        if (widget.hovered) {
            val hoverColor = when (widget.variant) {
                ButtonVariant.Primary, ButtonVariant.Filled -> theme.colors.onPrimary
                ButtonVariant.Tonal -> theme.colors.onPrimaryContainer
                else -> theme.colors.primary
            }
            painter.roundRect(
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
                Radii.control,
                hoverColor.withAlpha(0.08f),
            )
        }
    }

    private fun paintIconButton(node: RenderNode, widget: IconButton) {
        val bounds = node.bounds
        val background = when (widget.variant) {
            ButtonVariant.Primary, ButtonVariant.Filled -> theme.colors.primary
            ButtonVariant.Tonal -> theme.colors.primaryContainer
            ButtonVariant.Text -> Color.Transparent
            else -> theme.colors.surfaceContainerHigh
        }
        if (background.argb != Color.Transparent.argb) {
            painter.roundRect(
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
                Radii.md,
                background.withAlpha(if (widget.enabled) 1f else 0.38f),
            )
        }
        val foreground = when (widget.variant) {
            ButtonVariant.Primary, ButtonVariant.Filled -> theme.colors.onPrimary
            ButtonVariant.Tonal -> theme.colors.onPrimaryContainer
            else -> theme.colors.onSurface
        }.withAlpha(if (widget.enabled) 1f else 0.38f)
        val iconSize = 20f
        val iconBounds = Rect(
            bounds.x + (bounds.width - iconSize) / 2f,
            bounds.y + (bounds.height - iconSize) / 2f,
            iconSize,
            iconSize,
        )
        val iconBackground = if (background.argb == Color.Transparent.argb) {
            theme.colors.surfaceContainerLowest
        } else {
            background
        }
        if (!drawIcon(widget.glyph, iconBounds, foreground, iconBackground)) {
            drawText(
                widget.glyph,
                bounds,
                TextStyle(widget.size.iconSize, widget.size.iconSize + 6f, 600),
                foreground,
                TextAlign.Center,
                verticalCenter = true,
            )
        }
    }

    private fun paintVectorIcon(node: RenderNode, widget: VectorIcon) {
        drawIcon(
            widget.name,
            node.bounds,
            widget.color?.invoke(theme) ?: theme.colors.onSurface,
        )
    }

    private fun drawIcon(
        name: String,
        bounds: Rect,
        color: Color,
        background: Color? = null,
    ): Boolean {
        val size = minOf(bounds.width, bounds.height)
        if (size <= 0f) return true
        val unit = size / 24f
        val left = bounds.x + (bounds.width - size) / 2f
        val top = bounds.y + (bounds.height - size) / 2f
        fun x(value: Float): Float = left + value * unit
        fun y(value: Float): Float = top + value * unit
        fun box(x0: Float, y0: Float, width: Float, height: Float, radius: Float = 0f) {
            painter.roundRect(x(value = x0), y(value = y0), width * unit, height * unit, radius * unit, color)
        }
        fun stroke(x0: Float, y0: Float, width: Float, height: Float, radius: Float = 0f) {
            painter.strokeRoundRect(x(value = x0), y(value = y0), width * unit, height * unit, radius * unit, 1.6f * unit, color)
        }
        fun line(x0: Float, y0: Float, x1: Float, y1: Float, width: Float = 2f) {
            painter.line(x(value = x0), y(value = y0), x(value = x1), y(value = y1), width * unit, color)
        }
        when (name) {
            "grid", "dashboard" -> {
                box(3f, 3f, 8f, 8f, 1f)
                box(13f, 3f, 8f, 5f, 1f)
                box(3f, 13f, 8f, 8f, 1f)
                box(13f, 10f, 8f, 11f, 1f)
            }
            "folder" -> {
                box(2f, 3f, 9f, 5f, 1.5f)
                box(2f, 5f, 20f, 16f, 2f)
            }
            "chart" -> {
                box(4f, 11f, 3f, 9f, 1f)
                box(10f, 7f, 3f, 13f, 1f)
                box(16f, 13f, 3f, 7f, 1f)
                line(2f, 22f, 22f, 22f, 1.6f)
            }
            "spark" -> {
                line(12f, 2f, 12f, 14f, 2f)
                line(5f, 8f, 19f, 8f, 2f)
                line(18f, 15f, 18f, 21f, 1.6f)
                line(15f, 18f, 21f, 18f, 1.6f)
            }
            "wallet" -> {
                stroke(2f, 5f, 20f, 15f, 2f)
                line(2f, 9f, 22f, 9f, 1.6f)
                box(14f, 12f, 6f, 4f, 1f)
            }
            "team", "people" -> {
                painter.circle(x(8.5f), y(8f), 3.2f * unit, color)
                painter.circle(x(17f), y(9f), 2.6f * unit, color)
                box(2f, 13f, 13f, 7f, 3.5f)
                box(14f, 14f, 8f, 6f, 3f)
            }
            "tags", "tag" -> {
                box(3f, 4f, 18f, 4f, 1.5f)
                box(3f, 10f, 18f, 4f, 1.5f)
                box(3f, 16f, 12f, 4f, 1.5f)
            }
            "type" -> {
                line(4f, 5f, 20f, 5f, 2f)
                line(12f, 5f, 12f, 19f, 2f)
                line(8f, 19f, 16f, 19f, 2f)
            }
            "form" -> {
                stroke(3f, 4f, 18f, 16f, 2f)
                line(7f, 9f, 17f, 9f, 1.6f)
                line(7f, 13f, 14f, 13f, 1.6f)
            }
            "compass" -> {
                painter.circle(x(12f), y(12f), 8f * unit, color)
                background?.let { painter.circle(x(12f), y(12f), 6.2f * unit, it) }
                line(12f, 7f, 12f, 12f, 1.8f)
                line(12f, 12f, 16f, 15f, 1.8f)
            }
            "gear" -> {
                painter.circle(x(12f), y(12f), 8f * unit, color)
                background?.let { painter.circle(x(12f), y(12f), 5.2f * unit, it) }
                box(10.7f, 1.5f, 2.6f, 3.2f, 0.8f)
                box(10.7f, 19.3f, 2.6f, 3.2f, 0.8f)
                box(1.5f, 10.7f, 3.2f, 2.6f, 0.8f)
                box(19.3f, 10.7f, 3.2f, 2.6f, 0.8f)
            }
            "gallery", "image" -> {
                stroke(3f, 4f, 18f, 16f, 2f)
                painter.circle(x(8.5f), y(9f), 1.7f * unit, color)
                line(5f, 17f, 10f, 12f, 1.6f)
                line(10f, 12f, 14f, 16f, 1.6f)
                line(13f, 15f, 17f, 10f, 1.6f)
                line(17f, 10f, 19f, 12f, 1.6f)
            }
            "more" -> {
                painter.circle(x(6f), y(12f), 1.8f * unit, color)
                painter.circle(x(12f), y(12f), 1.8f * unit, color)
                painter.circle(x(18f), y(12f), 1.8f * unit, color)
            }
            "back" -> {
                line(15f, 5f, 8f, 12f, 2f)
                line(8f, 12f, 15f, 19f, 2f)
            }
            "theme" -> {
                if (theme.isDark) {
                    painter.circle(x(12f), y(12f), 4f * unit, color)
                    line(12f, 2f, 12f, 5f, 1.8f)
                    line(12f, 19f, 12f, 22f, 1.8f)
                    line(2f, 12f, 5f, 12f, 1.8f)
                    line(19f, 12f, 22f, 12f, 1.8f)
                    line(5f, 5f, 7f, 7f, 1.8f)
                    line(17f, 17f, 19f, 19f, 1.8f)
                    line(19f, 5f, 17f, 7f, 1.8f)
                    line(7f, 17f, 5f, 19f, 1.8f)
                } else {
                    painter.circle(x(12f), y(12f), 8f * unit, color)
                    background?.let { painter.circle(x(16f), y(8f), 7f * unit, it) }
                }
            }
            else -> return false
        }
        return true
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
                Rect(bounds.x, bounds.y, bounds.width, 20f),
                Typography.labelMedium,
                theme.colors.onSurfaceMuted,
            )
        }
        val fieldRect = Rect(
            bounds.x,
            bounds.y + labelHeight,
            bounds.width,
            widget.size.height,
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
            if (widget.externalError != null) 2f else 1f,
            when {
                widget.externalError != null -> theme.colors.error
                nodeHovered -> theme.colors.primary.withAlpha(0.6f)
                else -> theme.colors.outlineVariant
            },
        )
        drawText(
            widget.selectedLabel,
            Rect(fieldRect.x + 14f, fieldRect.y, fieldRect.width - 44f, fieldRect.height),
            widget.size.textStyle,
            if (widget.selectedLabel == widget.placeholder) theme.colors.onSurfaceMuted else theme.colors.onSurface,
            verticalCenter = true,
            maxLines = 1,
        )
        drawText(
            "v",
            Rect(fieldRect.right - 32f, fieldRect.y, 24f, fieldRect.height),
            Typography.bodyMedium,
            theme.colors.onSurfaceMuted,
            TextAlign.Center,
            verticalCenter = true,
        )
        val open = widget.isOpen()
        if (open) {
            val top = fieldRect.bottom + 4f
            painter.roundRect(bounds.x, top, bounds.width, widget.options.size * 40f + 8f, Radii.md, theme.colors.surfaceBright)
            painter.strokeRoundRect(bounds.x, top, bounds.width, widget.options.size * 40f + 8f, Radii.md, 1f, theme.colors.outlineVariant)
            widget.options.forEachIndexed { index, option ->
                val selected = option.value == widget.binding.value
                val highlighted = index == PopupController.highlighted.value
                if (highlighted) {
                    painter.roundRect(bounds.x + 4f, top + 4f + index * 40f, bounds.width - 8f, 40f, Radii.sm, theme.colors.surfaceContainerHigh)
                }
                drawText(
                    option.label,
                    Rect(bounds.x + 14f, top + 4f + index * 40f, bounds.width - 28f, 40f),
                    Typography.bodySmall,
                    if (selected) theme.colors.primary else theme.colors.onSurface,
                    verticalCenter = true,
                    maxLines = 1,
                )
            }
        }
        widget.externalError?.let { error ->
            val y = if (open) fieldRect.bottom + widget.options.size * 40f + 8f else fieldRect.bottom + 2f
            drawText(error, Rect(bounds.x, y, bounds.width, 18f), Typography.bodySmall, theme.colors.error, maxLines = 1)
        }
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
            widget.controlHeight,
        )
        val focused = widget.focused || focusedField() === widget
        val borderColor = when {
            widget.controlError != null -> theme.colors.error
            focused -> theme.colors.primary
            nodeHovered -> theme.colors.primary.withAlpha(0.6f)
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
                widget.size.textStyle,
                color,
                verticalCenter = true,
                maxLines = 1,
            )
        }
        widget.controlError?.let { error ->
            drawText(
                error,
                dev.ivlev.silent.ui.layout.Rect(
                    bounds.x,
                    bounds.y + labelHeight + widget.controlHeight + 2f,
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
        val viewport = clipBounds?.let { intersectRects(bounds, it) } ?: bounds
        val headerTop = maxOf(bounds.y, viewport.y)
        val hoverColumn = if (nodeHovered && hoverPoint != null && hoverPoint.y <= headerTop + widget.headerHeight) {
            var cursor = bounds.x
            var result = -1
            widths.forEachIndexed { index, width ->
                if (hoverPoint.x in cursor..(cursor + width)) result = index
                cursor += width
            }
            result
        } else {
            -1
        }
        painter.rect(bounds.x, headerTop, bounds.width, widget.headerHeight, theme.colors.surfaceContainerLow)
        var x = bounds.x
        widget.headers.forEachIndexed { index, header ->
            if (hoverColumn == index) {
                painter.rect(x, headerTop, widths[index], widget.headerHeight, theme.colors.onSurface.withAlpha(0.04f))
            }
            drawText(
                header,
                Rect(x + 16f, headerTop, (widths[index] - 32f).coerceAtLeast(0f), widget.headerHeight),
                Typography.labelLarge,
                theme.colors.onSurfaceVariant,
                widget.columnAligns.getOrElse(index) { TextAlign.Start },
                verticalCenter = true,
                maxLines = 1,
            )
            x += widths[index]
        }
        painter.rect(bounds.x, headerTop + widget.headerHeight - 1f, bounds.width, 1f, theme.colors.outlineVariant)
        val hoverRow = if (nodeHovered && hoverPoint != null && hoverPoint.y > headerTop + widget.headerHeight) {
            ((hoverPoint.y - bounds.y - widget.headerHeight) / widget.rowHeight).toInt()
        } else {
            -1
        }
        val startRow = (((viewport.y - bounds.y - widget.headerHeight) / widget.rowHeight).toInt()).coerceAtLeast(0)
        val endRow = ((((viewport.bottom - bounds.y - widget.headerHeight) / widget.rowHeight).toInt()) + 2)
            .coerceAtMost(widget.rows.size)
        for (rowIndex in startRow until endRow) {
            val row = widget.rows[rowIndex]
            val rowY = bounds.y + widget.headerHeight + rowIndex * widget.rowHeight
            if (hoverRow == rowIndex) {
                painter.rect(bounds.x, rowY, bounds.width, widget.rowHeight, theme.colors.surfaceContainerLow)
            }
            var columnX = bounds.x
            row.forEachIndexed { columnIndex, value ->
                val width = widths.getOrElse(columnIndex) { 0f }
                val align = widget.columnAligns.getOrElse(columnIndex) { TextAlign.Start }
                val cell = Rect(columnX + 16f, rowY, (width - 32f).coerceAtLeast(0f), widget.rowHeight)
                when (columnIndex) {
                    widget.statusColumn -> paintTableStatus(cell, value)
                    widget.tagsColumn -> paintTableTags(cell, value)
                    else -> drawText(
                        value,
                        cell,
                        Typography.bodyMedium,
                        theme.colors.onSurface,
                        align,
                        verticalCenter = true,
                        maxLines = 1,
                    )
                }
                columnX += width
            }
            if (rowIndex < widget.rows.lastIndex) {
                painter.rect(
                    bounds.x,
                    rowY + widget.rowHeight - 1f,
                    bounds.width,
                    1f,
                    theme.colors.outlineVariant.withAlpha(0.6f),
                )
            }
        }
    }

    private fun paintTableStatus(cell: Rect, value: String) {
        val height = 20f
        val top = cell.y + (cell.height - height) / 2f
        val background = when (value) {
            "В работе", "Активен", "Стабильно" -> theme.colors.successContainer
            "Ревью", "На ревью", "Проверка" -> theme.colors.warningContainer
            "Готово", "Завершено" -> theme.colors.primaryContainer
            else -> theme.colors.surfaceContainerHigh
        }
        val foreground = when (value) {
            "В работе", "Активен", "Стабильно" -> theme.colors.success
            "Ревью", "На ревью", "Проверка" -> theme.colors.warning
            "Готово", "Завершено" -> theme.colors.onPrimaryContainer
            else -> theme.colors.onSurfaceVariant
        }
        val width = (measurer.width(value, Typography.labelSmall) + Spacing.x2 * 2f).coerceAtMost(cell.width)
        painter.roundRect(cell.x, top, width, height, Radii.xs, background)
        drawText(
            value,
            Rect(cell.x + Spacing.x2, top, (width - Spacing.x2 * 2f).coerceAtLeast(0f), height),
            Typography.labelSmall,
            foreground,
            TextAlign.Center,
            verticalCenter = true,
            maxLines = 1,
        )
    }

    private fun paintTableTags(cell: Rect, value: String) {
        val tags = value.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        if (tags.isEmpty()) {
            drawText("—", cell, Typography.bodyMedium, theme.colors.onSurfaceMuted, verticalCenter = true, maxLines = 1)
            return
        }
        val height = 20f
        val top = cell.y + (cell.height - height) / 2f
        var x = cell.x
        val visible = tags.take(2)
        visible.forEach { tag ->
            val label = "#$tag"
            val width = (measurer.width(label, Typography.labelSmall) + Spacing.x2 * 2f)
                .coerceAtMost((cell.right - x).coerceAtLeast(0f))
            if (width <= 0f) return@forEach
            painter.roundRect(x, top, width, height, Radii.xs, theme.colors.surfaceContainerHighest)
            drawText(
                label,
                Rect(x + Spacing.x2, top, (width - Spacing.x2 * 2f).coerceAtLeast(0f), height),
                Typography.labelSmall,
                theme.colors.onSurface,
                TextAlign.Center,
                verticalCenter = true,
                maxLines = 1,
            )
            x += width + Spacing.x1
        }
        val rest = tags.size - visible.size
        if (rest > 0 && x < cell.right) {
            val label = "+$rest"
            val width = (measurer.width(label, Typography.labelSmall) + Spacing.x2 * 2f)
                .coerceAtMost((cell.right - x).coerceAtLeast(0f))
            painter.roundRect(x, top, width, height, Radii.xs, theme.colors.secondaryContainer)
            drawText(
                label,
                Rect(x + Spacing.x2, top, (width - Spacing.x2 * 2f).coerceAtLeast(0f), height),
                Typography.labelSmall,
                theme.colors.onSecondaryContainer,
                TextAlign.Center,
                verticalCenter = true,
                maxLines = 1,
            )
        }
    }

    private fun paintTag(node: RenderNode, widget: Tag) {
        val background = when (widget.tone) {
            TagTone.Neutral -> theme.colors.surfaceContainerHigh
            TagTone.Primary -> theme.colors.primaryContainer
            TagTone.Success -> theme.colors.successContainer
            TagTone.Warning -> theme.colors.warningContainer
            TagTone.Error -> theme.colors.errorContainer
            TagTone.Info -> theme.colors.surfaceContainerHighest
        }
        val foreground = when (widget.tone) {
            TagTone.Neutral -> theme.colors.onSurfaceVariant
            TagTone.Primary -> theme.colors.onPrimaryContainer
            TagTone.Success -> theme.colors.success
            TagTone.Warning -> theme.colors.warning
            TagTone.Error -> theme.colors.onErrorContainer
            TagTone.Info -> theme.colors.onSurface
        }
        painter.roundRect(
            node.bounds.x,
            node.bounds.y,
            node.bounds.width,
            node.bounds.height,
            Radii.xs,
            background,
        )
        drawText(
            widget.text,
            dev.ivlev.silent.ui.layout.Rect(
                node.bounds.x + Spacing.x2,
                node.bounds.y,
                (node.bounds.width - Spacing.x2 * 2f).coerceAtLeast(0f),
                node.bounds.height,
            ),
            widget.textStyle(),
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
            val iconBounds = dev.ivlev.silent.ui.layout.Rect(iconX + 2f, bounds.y + (bounds.height - 20f) / 2f, 20f, 20f)
            val iconBackground = if (widget.selected) theme.colors.primaryContainer else theme.colors.surfaceContainerLow
            if (!drawIcon(widget.item.icon, iconBounds, contentColor, iconBackground)) {
                drawText(
                    widget.item.icon,
                    dev.ivlev.silent.ui.layout.Rect(iconX, bounds.y, 24f, bounds.height),
                    TextStyle(Control.iconMd, 24f, 600),
                    contentColor,
                    verticalCenter = true,
                )
            }
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
            val iconName = widget.item.icon.ifEmpty { widget.item.label.take(1) }
            val iconBounds = dev.ivlev.silent.ui.layout.Rect(bounds.x + (bounds.width - 20f) / 2f, bounds.y + 7f, 20f, 20f)
            val iconBackground = if (widget.selected) theme.colors.primaryContainer else theme.colors.surfaceContainerLow
            if (!drawIcon(iconName, iconBounds, contentColor, iconBackground)) {
                drawText(
                    iconName,
                    dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y + 8f, bounds.width, 24f),
                    TextStyle(Control.iconMd, 24f, 600),
                    contentColor,
                    TextAlign.Center,
                )
            }
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

    private fun intersectRects(first: Rect, second: Rect): Rect {
        val left = maxOf(first.x, second.x)
        val top = maxOf(first.y, second.y)
        val right = minOf(first.right, second.right)
        val bottom = minOf(first.bottom, second.bottom)
        return Rect(left, top, (right - left).coerceAtLeast(0f), (bottom - top).coerceAtLeast(0f))
    }

    private fun toneContainer(tone: Tone): Color = when (tone) {
        Tone.Neutral -> theme.colors.surfaceContainerHigh
        Tone.Primary -> theme.colors.primaryContainer
        Tone.Success -> theme.colors.successContainer
        Tone.Warning -> theme.colors.warningContainer
        Tone.Error -> theme.colors.errorContainer
        Tone.Info -> theme.colors.secondaryContainer
    }

    private fun toneContent(tone: Tone): Color = when (tone) {
        Tone.Neutral -> theme.colors.onSurfaceVariant
        Tone.Primary -> theme.colors.onPrimaryContainer
        Tone.Success -> theme.colors.success
        Tone.Warning -> theme.colors.warning
        Tone.Error -> theme.colors.error
        Tone.Info -> theme.colors.onSecondaryContainer
    }

    private fun paintLabel(node: RenderNode, widget: Label) {
        val color = widget.color?.invoke(theme)
            ?: if (widget.disabled) theme.colors.onSurfaceMuted else theme.colors.onSurface
        val text = if (widget.required) "${widget.text} *" else widget.text
        drawText(text, node.bounds, widget.style, color, widget.align, widget.maxLines, verticalCenter = true)
    }

    private fun paintLink(node: RenderNode, widget: Link) {
        drawText(
            widget.text,
            node.bounds,
            Typography.bodyMedium,
            theme.colors.primary,
            verticalCenter = true,
        )
        val width = measurer.width(widget.text, Typography.bodyMedium)
        val y = node.bounds.y + node.bounds.height - 3f
        painter.rect(node.bounds.x, y, width, 1f, theme.colors.primary.withAlpha(0.7f))
    }

    private fun paintFab(node: RenderNode, widget: Fab) {
        painter.roundRect(
            node.bounds.x,
            node.bounds.y,
            node.bounds.width,
            node.bounds.height,
            node.bounds.height / 2f,
            theme.colors.primaryContainer.withAlpha(if (widget.enabled) 1f else 0.38f),
        )
        val glyphX = if (widget.extended) node.bounds.x + 24f else node.bounds.x + (node.bounds.width - 24f) / 2f
        drawText(
            widget.glyph,
            dev.ivlev.silent.ui.layout.Rect(glyphX, node.bounds.y, 24f, node.bounds.height),
            TextStyle(22f, 24f, 600),
            theme.colors.onPrimaryContainer,
            verticalCenter = true,
        )
        if (widget.extended) {
            drawText(
                widget.text.orEmpty(),
                dev.ivlev.silent.ui.layout.Rect(
                    node.bounds.x + 56f,
                    node.bounds.y,
                    node.bounds.width - 72f,
                    node.bounds.height,
                ),
                Typography.labelLarge,
                theme.colors.onPrimaryContainer,
                verticalCenter = true,
            )
        }
    }

    private fun paintBadge(node: RenderNode, widget: Badge) {
        val bg = toneContainer(widget.tone)
        val fg = toneContent(widget.tone)
        if (widget.dot && widget.text.isEmpty()) {
            painter.circle(node.bounds.x + 4f, node.bounds.y + 9f, 4f, fg)
            return
        }
        painter.roundRect(
            node.bounds.x,
            node.bounds.y,
            node.bounds.width,
            node.bounds.height,
            node.bounds.height / 2f,
            bg,
        )
        drawText(widget.text, node.bounds, Typography.labelSmall, fg, TextAlign.Center, verticalCenter = true, maxLines = 1)
    }

    private fun paintChip(node: RenderNode, widget: Chip) {
        val bg = if (widget.selected) theme.colors.primaryContainer else theme.colors.surfaceContainerHigh
        val fg = if (widget.selected) theme.colors.onPrimaryContainer else theme.colors.onSurfaceVariant
        if (widget.enabled) {
            painter.roundRect(
                node.bounds.x,
                node.bounds.y,
                node.bounds.width,
                node.bounds.height,
                node.bounds.height / 2f,
                bg,
            )
        }
        var x = node.bounds.x + 12f
        widget.leadingIcon?.let { icon ->
            drawText(icon, dev.ivlev.silent.ui.layout.Rect(x, node.bounds.y, 18f, node.bounds.height), Typography.labelMedium, fg, verticalCenter = true)
            x += 18f
        }
        val trailing = if (widget.removable) 18f else 0f
        drawText(
            widget.text,
            dev.ivlev.silent.ui.layout.Rect(x, node.bounds.y, node.bounds.width - (x - node.bounds.x) - 12f - trailing, node.bounds.height),
            Typography.labelLarge,
            fg.withAlpha(if (widget.enabled) 1f else 0.38f),
            verticalCenter = true,
            maxLines = 1,
        )
        if (widget.removable) {
            drawText(
                "×",
                dev.ivlev.silent.ui.layout.Rect(node.bounds.right - 28f, node.bounds.y, 20f, node.bounds.height),
                Typography.labelLarge,
                fg,
                TextAlign.Center,
                verticalCenter = true,
            )
        }
    }

    private fun paintAvatar(node: RenderNode, widget: Avatar) {
        painter.circle(
            node.bounds.x + node.bounds.width / 2f,
            node.bounds.y + node.bounds.height / 2f,
            minOf(node.bounds.width, node.bounds.height) / 2f,
            toneContainer(widget.tone),
        )
        drawText(
            widget.initials,
            node.bounds,
            if (widget.size >= 48f) Typography.titleMedium else Typography.labelLarge,
            toneContent(widget.tone),
            TextAlign.Center,
            verticalCenter = true,
            maxLines = 1,
        )
    }

    private fun paintSpinner(node: RenderNode, widget: Spinner) {
        val color = widget.color?.invoke(theme) ?: theme.colors.primary
        val stroke = maxOf(2f, widget.size / 10f)
        painter.strokeRoundRect(
            node.bounds.x,
            node.bounds.y,
            node.bounds.width,
            node.bounds.height,
            widget.size / 2f,
            stroke,
            color.withAlpha(0.25f),
        )
        painter.line(
            node.bounds.x + widget.size * 0.18f,
            node.bounds.y + widget.size * 0.12f,
            node.bounds.x + widget.size * 0.5f,
            node.bounds.y,
            stroke,
            color,
        )
    }

    private fun paintSkeleton(node: RenderNode, widget: Skeleton) {
        painter.roundRect(
            node.bounds.x,
            node.bounds.y,
            node.bounds.width,
            node.bounds.height,
            widget.radius,
            theme.colors.surfaceContainerHighest,
        )
    }

    private fun paintEmptyState(node: RenderNode, widget: EmptyState) {
        val bounds = node.bounds
        drawText(
            widget.glyph,
            dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y + 6f, bounds.width, 48f),
            TextStyle(34f, 40f, 500),
            theme.colors.onSurfaceMuted,
            TextAlign.Center,
        )
        drawText(
            widget.title,
            dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y + 64f, bounds.width, 28f),
            Typography.titleMedium,
            theme.colors.onSurface,
            TextAlign.Center,
            maxLines = 1,
        )
        widget.description?.let { description ->
            drawText(
                description,
                dev.ivlev.silent.ui.layout.Rect(bounds.x + 16f, bounds.y + 94f, bounds.width - 32f, 44f),
                Typography.bodySmall,
                theme.colors.onSurfaceVariant,
                TextAlign.Center,
                maxLines = 2,
            )
        }
    }

    private fun paintAlert(node: RenderNode, widget: Alert) {
        val bounds = node.bounds
        painter.roundRect(
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            Radii.md,
            toneContainer(widget.tone),
        )
        painter.circle(bounds.x + 22f, bounds.y + bounds.height / 2f, 5f, toneContent(widget.tone))
        drawText(
            widget.title,
            dev.ivlev.silent.ui.layout.Rect(bounds.x + 40f, bounds.y + 12f, bounds.width - 160f, 24f),
            Typography.titleSmall,
            toneContent(widget.tone),
            maxLines = 1,
        )
        widget.description?.let { description ->
            drawText(
                description,
                dev.ivlev.silent.ui.layout.Rect(bounds.x + 40f, bounds.y + 34f, bounds.width - 160f, 24f),
                Typography.bodySmall,
                toneContent(widget.tone),
                maxLines = 1,
            )
        }
    }

    private fun paintTopAppBar(node: RenderNode, widget: TopAppBar) {
        val bounds = node.bounds
        painter.rect(bounds.x, bounds.y, bounds.width, bounds.height, theme.colors.surfaceContainerLowest)
        painter.rect(bounds.x, bounds.bottom - 1f, bounds.width, 1f, theme.colors.outlineVariant)
        val leadingWidth = if (widget.leading != null) 64f else 0f
        val titleTop = when (widget.variant) {
            TopAppBarVariant.Small -> bounds.y + 12f
            TopAppBarVariant.Medium -> bounds.y + 20f
            TopAppBarVariant.Large -> bounds.y + 52f
        }
        drawText(
            widget.title,
            dev.ivlev.silent.ui.layout.Rect(
                bounds.x + 16f + leadingWidth,
                titleTop,
                bounds.width - 32f - leadingWidth - 160f,
                32f,
            ),
            when (widget.variant) {
                TopAppBarVariant.Small -> Typography.titleMedium
                TopAppBarVariant.Medium -> Typography.headlineSmall
                TopAppBarVariant.Large -> Typography.headlineMedium
            },
            theme.colors.onSurface,
            maxLines = 1,
        )
        widget.subtitle?.let { subtitle ->
            drawText(
                subtitle,
                dev.ivlev.silent.ui.layout.Rect(
                    bounds.x + 16f + leadingWidth,
                    bounds.y + bounds.height - 26f,
                    bounds.width - 32f - leadingWidth - 160f,
                    20f,
                ),
                Typography.bodySmall,
                theme.colors.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }

    private fun paintTabs(node: RenderNode, widget: Tabs) {
        val bounds = node.bounds
        painter.rect(bounds.x, bounds.bottom - 1f, bounds.width, 1f, theme.colors.outlineVariant)
        val selected = widget.selected()
        val count = widget.items.size.coerceAtLeast(1)
        val itemWidth = bounds.width / count
        widget.items.forEachIndexed { index, item ->
            val color = if (index == selected) theme.colors.primary else theme.colors.onSurfaceVariant
            drawText(
                item,
                dev.ivlev.silent.ui.layout.Rect(bounds.x + index * itemWidth, bounds.y, itemWidth, bounds.height - 2f),
                Typography.labelLarge,
                color,
                TextAlign.Center,
                verticalCenter = true,
                maxLines = 1,
            )
            if (index == selected) {
                painter.rect(
                    bounds.x + index * itemWidth + itemWidth * 0.2f,
                    bounds.bottom - 2f,
                    itemWidth * 0.6f,
                    2f,
                    theme.colors.primary,
                )
            }
        }
    }

    private fun paintSegmented(node: RenderNode, widget: SegmentedButton) {
        val bounds = node.bounds
        painter.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, Radii.control, theme.colors.surfaceContainerHigh)
        val count = widget.options.size.coerceAtLeast(1)
        val itemWidth = bounds.width / count
        widget.options.forEachIndexed { index, option ->
            val selected = option.value == widget.selected
            if (selected) {
                painter.roundRect(
                    bounds.x + index * itemWidth + 2f,
                    bounds.y + 2f,
                    itemWidth - 4f,
                    bounds.height - 4f,
                    Radii.control - 2f,
                    theme.colors.surfaceContainerLowest,
                )
            }
            drawText(
                option.label,
                dev.ivlev.silent.ui.layout.Rect(
                    bounds.x + index * itemWidth,
                    bounds.y,
                    itemWidth,
                    bounds.height,
                ),
                Typography.labelLarge,
                if (selected) theme.colors.onSurface else theme.colors.onSurfaceVariant,
                TextAlign.Center,
                verticalCenter = true,
                maxLines = 1,
            )
        }
    }

    private fun paintBreadcrumbs(node: RenderNode, widget: Breadcrumbs) {
        val bounds = node.bounds
        val rects = widget.itemBounds(BuildContext(theme, measurer, bounds.width, bounds.height, 1f), bounds)
        val separatorWidth = measurer.width(" / ", Typography.bodySmall)
        widget.items.forEachIndexed { index, item ->
            val color = if (index == widget.items.lastIndex) theme.colors.onSurface else theme.colors.onSurfaceVariant
            drawText(
                item,
                rects[index],
                Typography.bodySmall,
                color,
                verticalCenter = true,
                maxLines = 1,
            )
            if (index < widget.items.lastIndex) {
                drawText(
                    "/",
                    Rect(rects[index].right + 4f, bounds.y, separatorWidth - 8f, bounds.height),
                    Typography.bodySmall,
                    theme.colors.onSurfaceMuted,
                    verticalCenter = true,
                    maxLines = 1,
                )
            }
        }
    }

    private fun paintPagination(node: RenderNode, widget: Pagination) {
        val bounds = node.bounds
        val slots = if (widget.showEdges) widget.pageCount + 2 else widget.pageCount
        val itemWidth = (bounds.width / slots.coerceAtLeast(1)).coerceAtMost(40f)
        val labels = mutableListOf("‹")
        for (index in 1..widget.pageCount) labels.add(index.toString())
        if (widget.showEdges) labels.add("›")
        labels.forEachIndexed { index, label ->
            val x = bounds.x + index * itemWidth
            val isPage = label.toIntOrNull() == widget.page
            if (isPage) {
                painter.roundRect(x, bounds.y, itemWidth, bounds.height, Radii.md, theme.colors.primaryContainer)
            }
            drawText(
                label,
                dev.ivlev.silent.ui.layout.Rect(x, bounds.y, itemWidth, bounds.height),
                Typography.labelLarge,
                if (isPage) theme.colors.onPrimaryContainer else theme.colors.onSurfaceVariant,
                TextAlign.Center,
                verticalCenter = true,
                maxLines = 1,
            )
        }
    }

    private fun paintAccordion(node: RenderNode, widget: Accordion) {
        val bounds = node.bounds
        var y = bounds.y
        widget.entries.forEachIndexed { index, entry ->
            val expanded = index in widget.expanded
            drawText(
                entry.title,
                dev.ivlev.silent.ui.layout.Rect(bounds.x + 16f, y, bounds.width - 64f, 48f),
                Typography.titleSmall,
                theme.colors.onSurface,
                verticalCenter = true,
                maxLines = 1,
            )
            drawText(
                if (expanded) "−" else "+",
                dev.ivlev.silent.ui.layout.Rect(bounds.right - 44f, y, 28f, 48f),
                Typography.titleMedium,
                theme.colors.onSurfaceVariant,
                TextAlign.Center,
                verticalCenter = true,
            )
            painter.rect(bounds.x, y + 47f, bounds.width, 1f, theme.colors.outlineVariant)
            y += 48f
            if (expanded) {
                y += 16f
                val contentHeight = node.children.firstOrNull { it.bounds.y >= y - 1f }
                    ?.let { child -> node.children.filter { it.bounds.y >= y - 1f }.maxOfOrNull { it.bounds.bottom - y } ?: 0f }
                    ?: 0f
                y += contentHeight + 16f
            }
        }
    }

    private fun paintList(node: RenderNode, widget: ListPanel) {
        val bounds = node.bounds
        val viewport = clipBounds?.let { intersectRects(bounds, it) } ?: bounds
        widget.visibleTop = viewport.y
        if (nodeHovered && hoverPoint != null) {
            widget.updateHover(hoverPoint.y)
        } else {
            widget.hoverRow = -1
        }
        val start = ((viewport.y - bounds.y) / 56f).toInt().coerceAtLeast(0)
        val end = (((viewport.bottom - bounds.y) / 56f).toInt() + 2).coerceAtMost(widget.items.size)
        for (index in start until end) {
            val item = widget.items[index]
            val y = bounds.y + index * 56f
            if (item.selected) {
                painter.rect(bounds.x, y, bounds.width, 56f, theme.colors.primaryContainer.withAlpha(0.5f))
            } else if (widget.hoverRow == index) {
                painter.rect(bounds.x, y, bounds.width, 56f, theme.colors.onSurface.withAlpha(0.06f))
            }
            item.leading?.let { leading ->
                painter.circle(bounds.x + 28f, y + 28f, 14f, theme.colors.surfaceContainerHigh)
                drawText(
                    leading,
                    dev.ivlev.silent.ui.layout.Rect(bounds.x + 14f, y + 14f, 28f, 28f),
                    Typography.labelLarge,
                    theme.colors.onSurfaceVariant,
                    TextAlign.Center,
                    maxLines = 1,
                )
            }
            val textX = if (item.leading != null) bounds.x + 56f else bounds.x + 16f
            drawText(
                item.title,
                dev.ivlev.silent.ui.layout.Rect(textX, y + (if (item.description != null) 8f else 0f), bounds.width - (textX - bounds.x) - 48f, 24f),
                Typography.bodyMedium,
                if (item.disabled) theme.colors.onSurfaceMuted else theme.colors.onSurface,
                maxLines = 1,
            )
            item.description?.let { description ->
                drawText(
                    description,
                    dev.ivlev.silent.ui.layout.Rect(textX, y + 30f, bounds.width - (textX - bounds.x) - 48f, 20f),
                    Typography.bodySmall,
                    theme.colors.onSurfaceVariant,
                    maxLines = 1,
                )
            }
            item.trailing?.let { trailing ->
                drawText(
                    trailing,
                    dev.ivlev.silent.ui.layout.Rect(bounds.right - 44f, y, 28f, 56f),
                    Typography.bodySmall,
                    theme.colors.onSurfaceMuted,
                    TextAlign.End,
                    verticalCenter = true,
                )
            }
            painter.rect(bounds.x, y + 55f, bounds.width, 1f, theme.colors.outlineVariant)
        }
    }

    private fun paintDataTable(node: RenderNode, widget: DataTable) {
        val bounds = node.bounds
        val viewport = clipBounds?.let { intersectRects(bounds, it) } ?: bounds
        if (viewport.width <= 0f || viewport.height <= 0f) return
        widget.visibleTop = viewport.y
        if (nodeHovered && hoverPoint != null) {
            widget.updateHover(hoverPoint.x, hoverPoint.y)
        } else {
            widget.hoverRow = -1
            widget.hoverColumn = -1
        }
        painter.rect(bounds.x, bounds.y, bounds.width, bounds.height, theme.colors.surfaceContainerLowest)
        val narrow = bounds.width < 600f
        val ordered = widget.displayColumns()
        val rowHeight = if (narrow) 96f else widget.rowHeight
        val bodyTop = bounds.y + 48f
        val paginationHeight = if (widget.pageCount > 1) 56f else 0f
        val footerTop = viewport.bottom - paginationHeight
        val rowsBottom = maxOf(bodyTop, footerTop)
        val startRow = if (narrow) {
            0
        } else {
            (((viewport.y - bodyTop) / rowHeight).toInt()).coerceAtLeast(0)
        }
        val endRow = if (widget.state == DataState.Ready) {
            (((rowsBottom - bodyTop) / rowHeight).toInt() + 2).coerceAtMost(widget.rows.size)
        } else {
            0
        }
        when (widget.state) {
            DataState.Ready -> {
                for (rowIndex in startRow until endRow) {
                    val row = widget.rows[rowIndex]
                    val y = bodyTop + rowIndex * rowHeight
                    val selected = rowIndex in widget.selectedRows
                    if (selected) {
                        painter.rect(bounds.x, y, bounds.width, rowHeight, theme.colors.primaryContainer.withAlpha(0.25f))
                    } else if (widget.hoverRow == rowIndex) {
                        painter.rect(bounds.x, y, bounds.width, rowHeight, theme.colors.onSurface.withAlpha(0.06f))
                    }
                    if (narrow) {
                        val title = row.firstOrNull().orEmpty()
                        drawText(
                            title,
                            Rect(bounds.x + 56f, y + 12f, bounds.width - 72f, 24f),
                            Typography.titleSmall,
                            theme.colors.onSurface,
                            maxLines = 1,
                        )
                        ordered.drop(1).take(3).forEachIndexed { index, column ->
                            val value = row.getOrNull(index + 1).orEmpty()
                            drawText(
                                "${column.header}: $value",
                                Rect(bounds.x + 56f, y + 38f + index * 18f, bounds.width - 72f, 18f),
                                Typography.bodySmall,
                                theme.colors.onSurfaceVariant,
                                maxLines = 1,
                            )
                        }
                    } else {
                        if (widget.selectable) {
                            val checkbox = Rect(bounds.x + 16f, y + (rowHeight - 18f) / 2f, 18f, 18f)
                            if (selected) {
                                painter.roundRect(checkbox.x, checkbox.y, 18f, 18f, 4f, theme.colors.primary)
                                painter.line(checkbox.x + 4f, checkbox.y + 9f, checkbox.x + 7f, checkbox.y + 12f, 2f, theme.colors.onPrimary)
                                painter.line(checkbox.x + 7f, checkbox.y + 12f, checkbox.x + 14f, checkbox.y + 5f, 2f, theme.colors.onPrimary)
                            } else {
                                painter.strokeRoundRect(checkbox.x, checkbox.y, 18f, 18f, 4f, 1f, theme.colors.outline)
                            }
                        }
                        var x = bounds.x + (if (widget.selectable) 44f else 0f)
                        ordered.forEachIndexed { index, column ->
                            val width = widget.columnWidth(bounds, index) - (if (widget.selectable && index == 0) 44f else 0f)
                            val value = row.getOrNull(widget.columns.indexOf(column)).orEmpty()
                            val cell = Rect(x + 12f, y, (width - 20f).coerceAtLeast(0f), rowHeight)
                            when (column.key) {
                                widget.statusKey -> paintTableStatus(cell, value)
                                widget.tagsKey -> paintTableTags(cell, value)
                                else -> drawText(
                                    value,
                                    cell,
                                    Typography.bodyMedium,
                                    theme.colors.onSurface,
                                    column.align,
                                    verticalCenter = true,
                                    maxLines = 1,
                                )
                            }
                            x += width
                        }
                        painter.rect(bounds.x, y + rowHeight - 1f, bounds.width, 1f, theme.colors.outlineVariant.withAlpha(0.6f))
                    }
                }
            }

            DataState.Loading -> {
                repeat(if (narrow) 3 else 4) { index ->
                    val y = bodyTop + index * rowHeight
                    if (y > rowsBottom) return@repeat
                    painter.roundRect(
                        bounds.x + 16f,
                        y + 12f,
                        bounds.width - 32f,
                        (rowHeight - 24f).coerceAtLeast(16f),
                        Radii.sm,
                        theme.colors.surfaceContainerHigh,
                    )
                }
            }

            DataState.Empty -> {
                drawText(
                    "Нет данных",
                    Rect(bounds.x, bodyTop + 24f, bounds.width, 32f),
                    Typography.titleSmall,
                    theme.colors.onSurfaceVariant,
                    TextAlign.Center,
                )
                drawText(
                    "Измените фильтры или добавьте запись",
                    Rect(bounds.x, bodyTop + 56f, bounds.width, 24f),
                    Typography.bodySmall,
                    theme.colors.onSurfaceMuted,
                    TextAlign.Center,
                )
            }

            DataState.Error -> {
                drawText(
                    "Не удалось загрузить данные",
                    Rect(bounds.x, bodyTop + 24f, bounds.width, 32f),
                    Typography.titleSmall,
                    theme.colors.error,
                    TextAlign.Center,
                )
                drawText(
                    "Повторить",
                    Rect(bounds.x, bodyTop + 64f, bounds.width, 32f),
                    Typography.labelLarge,
                    theme.colors.primary,
                    TextAlign.Center,
                )
            }
        }
        if (!narrow) {
            val headerTop = maxOf(bounds.y, viewport.y)
            painter.rect(bounds.x, headerTop, bounds.width, 48f, theme.colors.surfaceContainerLow)
            var x = bounds.x + (if (widget.selectable) 44f else 0f)
            ordered.forEachIndexed { index, column ->
                val width = widget.columnWidth(bounds, index) - (if (widget.selectable && index == 0) 44f else 0f)
                val sortMark = when {
                    widget.sortKey != column.key -> ""
                    widget.sortDirection == "ascending" -> " ^"
                    else -> " v"
                }
                drawText(
                    column.header + sortMark,
                    Rect(x + 12f, headerTop, width - 20f, 48f),
                    Typography.labelLarge,
                    theme.colors.onSurfaceMuted,
                    verticalCenter = true,
                    maxLines = 1,
                )
                if (widget.tableState.targetKey == column.key && widget.tableState.dragActive) {
                    painter.rect(x, headerTop + 45f, width, 2f, theme.colors.primary)
                }
                if (widget.tableState.resizeKey == column.key) {
                    val label = width.toInt().toString()
                    painter.roundRect(x + width - 42f, headerTop + 6f, 38f, 20f, Radii.sm, theme.colors.primary)
                    drawText(
                        label,
                        Rect(x + width - 42f, headerTop + 6f, 38f, 20f),
                        Typography.labelSmall,
                        theme.colors.onPrimary,
                        TextAlign.Center,
                        verticalCenter = true,
                        maxLines = 1,
                    )
                }
                x += width
            }
            if (widget.hoverColumn >= 0) {
                val hoverX = bounds.x + (if (widget.selectable) 44f else 0f)
                var offset = hoverX
                for (index in 0 until widget.hoverColumn) offset += widget.columnWidth(bounds, index)
                painter.rect(offset, headerTop, widget.columnWidth(bounds, widget.hoverColumn), 47f, theme.colors.onSurface.withAlpha(0.06f))
            }
            painter.rect(bounds.x, headerTop + 47f, bounds.width, 1f, theme.colors.outlineVariant)
            if (widget.tableState.dragActive) {
                val ghostX = widget.tableState.dragGhostX
                painter.roundRect(
                    ghostX - 60f,
                    headerTop - 48f,
                    120f,
                    36f,
                    Radii.sm,
                    theme.colors.primaryContainer.withAlpha(0.9f),
                )
                drawText(
                    widget.tableState.dragKey.orEmpty(),
                    Rect(ghostX - 56f, headerTop - 48f, 112f, 36f),
                    Typography.labelSmall,
                    theme.colors.onPrimaryContainer,
                    TextAlign.Center,
                    verticalCenter = true,
                    maxLines = 1,
                )
            }
        }
        if (footerTop < viewport.bottom) {
            if (widget.selectedRows.isNotEmpty()) {
                val bulkTop = footerTop - 48f
                painter.rect(bounds.x, bulkTop, bounds.width, 48f, theme.colors.primaryContainer.withAlpha(0.92f))
                drawText(
                    "Выбрано: ${widget.selectedRows.size}",
                    Rect(bounds.x + 16f, bulkTop, bounds.width - 220f, 48f),
                    Typography.labelLarge,
                    theme.colors.onPrimaryContainer,
                    verticalCenter = true,
                    maxLines = 1,
                )
                drawText(
                    "Снять выделение",
                    Rect(bounds.right - 170f, bulkTop, 150f, 48f),
                    Typography.labelMedium,
                    theme.colors.primary,
                    TextAlign.End,
                    verticalCenter = true,
                )
            }
            if (paginationHeight > 0f) {
                painter.rect(bounds.x, footerTop, bounds.width, paginationHeight, theme.colors.surfaceContainerLowest)
                painter.rect(bounds.x, footerTop, bounds.width, 1f, theme.colors.outlineVariant)
                val startRow = (widget.page - 1) * widget.pageSize + 1
                val endRow = minOf(widget.totalRows, widget.page * widget.pageSize)
                drawText(
                    if (widget.totalRows == 0) "0 из 0" else "$startRow–$endRow из ${widget.totalRows}",
                    Rect(bounds.x + 16f, footerTop, 220f, paginationHeight),
                    Typography.labelMedium,
                    theme.colors.onSurfaceVariant,
                    verticalCenter = true,
                    maxLines = 1,
                )
                widget.footerSlots(bounds).forEach { slot ->
                    when (slot.kind) {
                        DataTable.FooterKind.PageSize -> {
                            painter.roundRect(slot.bounds.x, slot.bounds.y, slot.bounds.width, slot.bounds.height, Radii.sm, theme.colors.surfaceContainerHigh)
                            drawText(slot.label, slot.bounds, Typography.labelMedium, theme.colors.onSurface, TextAlign.Center, verticalCenter = true, maxLines = 1)
                        }
                        DataTable.FooterKind.Page -> {
                            val active = slot.page == widget.page
                            if (active) {
                                painter.roundRect(slot.bounds.x, slot.bounds.y, slot.bounds.width, slot.bounds.height, Radii.md, theme.colors.primaryContainer)
                            }
                            drawText(
                                slot.label,
                                slot.bounds,
                                Typography.labelMedium,
                                if (active) theme.colors.onPrimaryContainer else theme.colors.onSurfaceVariant,
                                TextAlign.Center,
                                verticalCenter = true,
                                maxLines = 1,
                            )
                        }
                        else -> drawText(
                            slot.label,
                            slot.bounds,
                            Typography.labelMedium,
                            theme.colors.onSurfaceVariant,
                            TextAlign.Center,
                            verticalCenter = true,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }

    private fun paintCheckboxGroup(node: RenderNode, widget: CheckboxGroup) {
        val bounds = node.bounds
        val labelHeight = if (widget.label != null) 24f else 0f
        widget.label?.let { label ->
            drawText(label, dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, 20f), Typography.labelMedium, theme.colors.onSurface, maxLines = 1)
        }
        val columns = widget.columns.resolve(theme.let { 1440f }).coerceAtLeast(1)
        val cell = bounds.width / columns
        widget.options.forEachIndexed { index, option ->
            val x = bounds.x + (index % columns) * cell
            val y = bounds.y + labelHeight + (index / columns) * 36f
            val checked = option.value in widget.field.value
            if (checked) {
                painter.roundRect(x, y + 6f, 20f, 20f, Radii.xs, theme.colors.primary.withAlpha(if (widget.enabled) 1f else 0.38f))
                painter.line(x + 5f, y + 16f, x + 9f, y + 20f, 2f, theme.colors.onPrimary)
                painter.line(x + 9f, y + 20f, x + 16f, y + 10f, 2f, theme.colors.onPrimary)
            } else {
                painter.strokeRoundRect(x, y + 6f, 20f, 20f, Radii.xs, 1f, theme.colors.outline)
            }
            drawText(
                option.label,
                dev.ivlev.silent.ui.layout.Rect(x + 30f, y, cell - 36f, 32f),
                Typography.bodySmall,
                if (option.disabled) theme.colors.onSurfaceMuted else theme.colors.onSurface,
                verticalCenter = true,
                maxLines = 1,
            )
        }
        widget.error?.let { error ->
            drawText(
                error,
                dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.bottom - 20f, bounds.width, 20f),
                Typography.bodySmall,
                theme.colors.error,
                maxLines = 1,
            )
        }
    }

    private fun paintRadioGroup(node: RenderNode, widget: RadioGroup) {
        val bounds = node.bounds
        val labelHeight = if (widget.label != null) 24f else 0f
        widget.label?.let { label ->
            drawText(label, dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, 20f), Typography.labelMedium, theme.colors.onSurface, maxLines = 1)
        }
        val columns = if (bounds.width < 480f) 1 else if (widget.columns.resolve(bounds.width) > 1) 2 else 1
        val cell = bounds.width / columns
        widget.options.forEachIndexed { index, option ->
            val x = bounds.x + (index % columns) * cell
            val y = bounds.y + labelHeight + (index / columns) * 36f
            val checked = option.value == widget.field.value
            painter.circle(x + 10f, y + 16f, 9f, if (checked) theme.colors.primary else theme.colors.surfaceContainerLowest)
            if (!checked) painter.strokeRoundRect(x + 1f, y + 7f, 18f, 18f, 9f, 1f, theme.colors.outline)
            if (checked) painter.circle(x + 10f, y + 16f, 4f, theme.colors.onPrimary)
            drawText(
                option.label,
                dev.ivlev.silent.ui.layout.Rect(x + 30f, y, cell - 36f, 32f),
                Typography.bodySmall,
                if (option.disabled) theme.colors.onSurfaceMuted else theme.colors.onSurface,
                verticalCenter = true,
                maxLines = 1,
            )
        }
        widget.error?.let { error ->
            drawText(
                error,
                dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.bottom - 20f, bounds.width, 20f),
                Typography.bodySmall,
                theme.colors.error,
                maxLines = 1,
            )
        }
    }

    private fun paintSlider(node: RenderNode, widget: Slider) {
        val bounds = node.bounds
        val labelHeight = if (widget.label != null) 24f else 0f
        widget.label?.let { label ->
            drawText(label, dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, 20f), Typography.labelMedium, theme.colors.onSurface, maxLines = 1)
        }
        val output = "${widget.field.value.toInt()}${widget.unit}"
        drawText(
            output,
            dev.ivlev.silent.ui.layout.Rect(bounds.right - 80f, bounds.y, 80f, 20f),
            Typography.labelMedium,
            theme.colors.primary,
            TextAlign.End,
            maxLines = 1,
        )
        val trackY = bounds.y + labelHeight + 18f
        val trackWidth = bounds.width - 16f
        painter.roundRect(bounds.x + 8f, trackY, trackWidth, 4f, 2f, theme.colors.surfaceContainerHighest)
        painter.roundRect(bounds.x + 8f, trackY, trackWidth * widget.ratio, 4f, 2f, theme.colors.primary)
        painter.circle(bounds.x + 8f + trackWidth * widget.ratio, trackY + 2f, 8f, theme.colors.primary)
    }

    private fun paintTextarea(node: RenderNode, widget: Textarea) {
        val bounds = node.bounds
        val labelHeight = if (widget.label != null) TextField.LABEL_HEIGHT else 0f
        widget.label?.let { label ->
            drawText(label, dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, TextField.LABEL_HEIGHT), Typography.labelMedium, theme.colors.onSurfaceMuted, maxLines = 1)
        }
        val box = dev.ivlev.silent.ui.layout.Rect(
            bounds.x,
            bounds.y + labelHeight,
            bounds.width,
            (widget.rows * 24f + 24f).coerceAtLeast(80f),
        )
        painter.roundRect(box.x, box.y, box.width, box.height, Radii.control, theme.colors.surfaceContainerLowest)
        painter.strokeRoundRect(box.x, box.y, box.width, box.height, Radii.control, 1f, if (widget.controlError != null) theme.colors.error else theme.colors.outlineVariant)
        val lines = wrapText(widget.binding.value.ifEmpty { widget.hint.orEmpty() }, Typography.bodyMedium, box.width - 28f, measurer, maxLines = widget.rows)
        val color = if (widget.binding.value.isEmpty()) theme.colors.onSurfaceMuted else theme.colors.onSurface
        lines.forEachIndexed { index, line ->
            painter.text(line, box.x + 14f, box.y + 24f + index * Typography.bodyMedium.lineHeight, Typography.bodyMedium, color)
        }
        widget.controlError?.let { error ->
            drawText(error, dev.ivlev.silent.ui.layout.Rect(bounds.x, box.bottom + 2f, bounds.width, 18f), Typography.bodySmall, theme.colors.error, maxLines = 1)
        }
    }

    private fun paintNumberField(node: RenderNode, widget: NumberField) {
        paintTextField(node, widget)
        val labelHeight = if (widget.label != null) TextField.LABEL_HEIGHT else 0f
        val boxTop = node.bounds.y + labelHeight
        drawText(
            "−",
            dev.ivlev.silent.ui.layout.Rect(node.bounds.right - 72f, boxTop, 32f, widget.controlHeight),
            Typography.titleMedium,
            theme.colors.onSurfaceMuted,
            TextAlign.Center,
            verticalCenter = true,
        )
        drawText(
            "+",
            dev.ivlev.silent.ui.layout.Rect(node.bounds.right - 36f, boxTop, 32f, widget.controlHeight),
            Typography.titleMedium,
            theme.colors.onSurfaceMuted,
            TextAlign.Center,
            verticalCenter = true,
        )
        if (widget.unit.isNotEmpty()) {
            drawText(
                widget.unit,
                dev.ivlev.silent.ui.layout.Rect(node.bounds.right - 124f, boxTop, 40f, widget.controlHeight),
                Typography.bodySmall,
                theme.colors.onSurfaceMuted,
                TextAlign.End,
                verticalCenter = true,
            )
        }
    }

    private fun paintOtp(node: RenderNode, widget: OtpInput) {
        val bounds = node.bounds
        val length = widget.length.coerceAtLeast(1)
        val gap = 8f
        val box = ((bounds.width - gap * (length - 1)) / length).coerceAtMost(52f)
        val total = box * length + gap * (length - 1)
        var x = bounds.x + (bounds.width - total) / 2f
        widget.binding.value.take(length).forEachIndexed { index, char ->
            painter.roundRect(x, bounds.y + 4f, box, 48f, Radii.control, theme.colors.surfaceContainerLowest)
            painter.strokeRoundRect(x, bounds.y + 4f, box, 48f, Radii.control, 1f, theme.colors.outlineVariant)
            drawText(
                if (widget.mask) "•" else char.toString(),
                dev.ivlev.silent.ui.layout.Rect(x, bounds.y + 4f, box, 48f),
                Typography.titleMedium,
                theme.colors.onSurface,
                TextAlign.Center,
                verticalCenter = true,
            )
            x += box + gap
        }
        repeat((length - widget.binding.value.length).coerceAtLeast(0)) {
            painter.roundRect(x, bounds.y + 4f, box, 48f, Radii.control, theme.colors.surfaceContainerLow)
            painter.strokeRoundRect(x, bounds.y + 4f, box, 48f, Radii.control, 1f, theme.colors.outlineVariant)
            x += box + gap
        }
        widget.externalError?.let { error ->
            drawText(error, dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.bottom - 18f, bounds.width, 18f), Typography.bodySmall, theme.colors.error, TextAlign.Center)
        }
    }

    private fun paintTagInput(node: RenderNode, widget: TagInput) {
        val bounds = node.bounds
        val labelHeight = if (widget.label != null) 24f else 0f
        widget.label?.let { label ->
            drawText(label, dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, 20f), Typography.labelMedium, theme.colors.onSurfaceMuted, maxLines = 1)
        }
        val box = dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y + labelHeight, bounds.width, 48f)
        painter.roundRect(box.x, box.y, box.width, box.height, Radii.control, theme.colors.surfaceContainerLowest)
        painter.strokeRoundRect(box.x, box.y, box.width, box.height, Radii.control, 1f, theme.colors.outlineVariant)
        var x = box.x + 8f
        widget.values.value.take(3).forEach { value ->
            val chipWidth = measurer.width(value, Typography.labelSmall) + 28f
            painter.roundRect(x, box.y + 10f, chipWidth, 28f, 14f, theme.colors.surfaceContainerHigh)
            drawText(value, dev.ivlev.silent.ui.layout.Rect(x + 10f, box.y + 10f, chipWidth - 24f, 28f), Typography.labelSmall, theme.colors.onSurfaceVariant, verticalCenter = true, maxLines = 1)
            drawText("×", dev.ivlev.silent.ui.layout.Rect(x + chipWidth - 20f, box.y + 10f, 16f, 28f), Typography.labelSmall, theme.colors.onSurfaceMuted, TextAlign.Center, verticalCenter = true)
            x += chipWidth + 6f
        }
        drawText(widget.placeholder, dev.ivlev.silent.ui.layout.Rect(x + 4f, box.y, box.right - x - 12f, box.height), Typography.bodySmall, theme.colors.onSurfaceMuted, verticalCenter = true, maxLines = 1)
    }

    private fun paintCombobox(node: RenderNode, widget: Combobox) {
        val bounds = node.bounds
        val labelHeight = if (widget.label != null) 24f else 0f
        widget.label?.let { label ->
            drawText(label, dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, 20f), Typography.labelMedium, theme.colors.onSurfaceMuted, maxLines = 1)
        }
        painter.roundRect(bounds.x, bounds.y + labelHeight, bounds.width, 48f, Radii.control, theme.colors.surfaceContainerLowest)
        painter.strokeRoundRect(bounds.x, bounds.y + labelHeight, bounds.width, 48f, Radii.control, 1f, theme.colors.outlineVariant)
        drawText(
            widget.field.value.ifEmpty { widget.placeholder },
            dev.ivlev.silent.ui.layout.Rect(bounds.x + 14f, bounds.y + labelHeight, bounds.width - 44f, 48f),
            Typography.bodyMedium,
            if (widget.field.value.isEmpty()) theme.colors.onSurfaceMuted else theme.colors.onSurface,
            verticalCenter = true,
            maxLines = 1,
        )
        drawText("v", dev.ivlev.silent.ui.layout.Rect(bounds.right - 36f, bounds.y + labelHeight, 24f, 48f), Typography.bodyMedium, theme.colors.onSurfaceMuted, TextAlign.Center, verticalCenter = true)
        if (widget.open) {
            val listY = bounds.y + labelHeight + 48f
            painter.roundRect(bounds.x, listY, bounds.width, widget.options.size * 36f, Radii.md, theme.colors.surfaceContainerLowest)
            widget.options.forEachIndexed { index, option ->
                drawText(
                    option.label,
                    dev.ivlev.silent.ui.layout.Rect(bounds.x + 14f, listY + index * 36f, bounds.width - 28f, 36f),
                    Typography.bodySmall,
                    if (option.value == widget.field.value) theme.colors.primary else theme.colors.onSurface,
                    verticalCenter = true,
                    maxLines = 1,
                )
            }
        }
    }

    private fun paintTreeSelect(node: RenderNode, widget: TreeSelect) {
        val bounds = node.bounds
        val labelHeight = if (widget.label != null) 24f else 0f
        widget.label?.let { label ->
            drawText(label, dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, 20f), Typography.labelMedium, theme.colors.onSurfaceMuted, maxLines = 1)
        }
        painter.roundRect(bounds.x, bounds.y + labelHeight, bounds.width, 48f, Radii.control, theme.colors.surfaceContainerLowest)
        painter.strokeRoundRect(bounds.x, bounds.y + labelHeight, bounds.width, 48f, Radii.control, 1f, if (nodeHovered) theme.colors.primary.withAlpha(0.6f) else theme.colors.outlineVariant)
        drawText(
            "${widget.selected.value.size} выбрано",
            dev.ivlev.silent.ui.layout.Rect(bounds.x + 14f, bounds.y + labelHeight, bounds.width - 44f, 48f),
            Typography.bodyMedium,
            theme.colors.onSurface,
            verticalCenter = true,
            maxLines = 1,
        )
        drawText(
            if (widget.isOpen()) "v" else ">",
            Rect(bounds.right - 32f, bounds.y + labelHeight, 24f, 48f),
            Typography.bodyMedium,
            theme.colors.onSurfaceMuted,
            TextAlign.Center,
            verticalCenter = true,
            maxLines = 1,
        )
        if (widget.isOpen()) {
            val nodes = widget.visibleNodes()
            painter.roundRect(bounds.x, bounds.y + labelHeight + 52f, bounds.width, nodes.size * 40f + 8f, Radii.md, theme.colors.surfaceBright)
            painter.strokeRoundRect(bounds.x, bounds.y + labelHeight + 52f, bounds.width, nodes.size * 40f + 8f, Radii.md, 1f, theme.colors.outlineVariant)
            nodes.forEachIndexed { index, nodeValue ->
                val y = bounds.y + labelHeight + 56f + index * 40f
                if (nodeValue.children.isNotEmpty()) {
                    drawText(
                        if (nodeValue.value in widget.expanded.value) "v" else ">",
                        Rect(bounds.x + 4f, y, 32f, 40f),
                        Typography.bodySmall,
                        theme.colors.onSurfaceMuted,
                        TextAlign.Center,
                        verticalCenter = true,
                        maxLines = 1,
                    )
                }
                val boxX = bounds.x + 40f + nodeValue.depth * 16f
                val selected = nodeValue.value in widget.selected.value
                if (selected) {
                    painter.roundRect(boxX, y + 11f, 18f, 18f, Radii.xs, theme.colors.primary)
                    painter.line(boxX + 4f, y + 20f, boxX + 7f, y + 23f, 2f, theme.colors.onPrimary)
                    painter.line(boxX + 7f, y + 23f, boxX + 14f, y + 16f, 2f, theme.colors.onPrimary)
                } else {
                    painter.strokeRoundRect(boxX, y + 11f, 18f, 18f, Radii.xs, 1f, theme.colors.outline)
                }
                drawText(
                    nodeValue.label,
                    Rect(boxX + 26f, y, bounds.width - (boxX - bounds.x) - 32f, 40f),
                    Typography.bodySmall,
                    if (nodeValue.disabled) theme.colors.onSurfaceMuted else theme.colors.onSurface,
                    verticalCenter = true,
                    maxLines = 1,
                )
            }
        }
    }

    private fun paintField(node: RenderNode, widget: Field) {
        val bounds = node.bounds
        widget.label?.let { label ->
            drawText(
                (if (widget.required) "$label *" else label),
                dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, 20f),
                Typography.labelMedium,
                theme.colors.onSurface,
                maxLines = 1,
            )
        }
        val message = widget.error ?: widget.hint
        if (message != null) {
            drawText(
                message,
                dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.bottom - 20f, bounds.width, 20f),
                Typography.bodySmall,
                if (widget.error != null) theme.colors.error else theme.colors.onSurfaceMuted,
                maxLines = 1,
            )
        }
    }

    private fun paintFieldGroup(node: RenderNode, widget: FieldGroup) {
        val bounds = node.bounds
        var y = bounds.y
        widget.legend?.let { legend ->
            drawText(legend, dev.ivlev.silent.ui.layout.Rect(bounds.x, y, bounds.width, 22f), Typography.titleSmall, theme.colors.onSurface, maxLines = 1)
            y += 24f
        }
        widget.hint?.let { hint ->
            drawText(hint, dev.ivlev.silent.ui.layout.Rect(bounds.x, y, bounds.width, 20f), Typography.bodySmall, theme.colors.onSurfaceMuted, maxLines = 1)
        }
    }

    private fun paintFileUpload(node: RenderNode, widget: FileUpload) {
        val bounds = node.bounds
        painter.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, Radii.card, theme.colors.surfaceContainerLow)
        val dash = 8f
        var x = bounds.x + 12f
        while (x < bounds.right - 12f) {
            painter.rect(x, bounds.y + 1f, dash, 1f, theme.colors.outline)
            painter.rect(x, bounds.bottom - 2f, dash, 1f, theme.colors.outline)
            x += dash * 2f
        }
        drawText("^", dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y + 28f, bounds.width, 32f), TextStyle(26f, 30f, 600), theme.colors.onSurfaceMuted, TextAlign.Center)
        drawText(widget.title, dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y + 66f, bounds.width, 24f), Typography.titleSmall, theme.colors.onSurface, TextAlign.Center, maxLines = 1)
        drawText(widget.hint, dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y + 92f, bounds.width, 20f), Typography.bodySmall, theme.colors.onSurfaceMuted, TextAlign.Center, maxLines = 1)
    }

    private fun paintFileField(node: RenderNode, widget: FileField) {
        val bounds = node.bounds
        drawText(widget.label, dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, 20f), Typography.labelMedium, theme.colors.onSurfaceMuted, maxLines = 1)
        painter.roundRect(bounds.x, bounds.y + 22f, bounds.width, 48f, Radii.control, theme.colors.surfaceContainerLowest)
        painter.strokeRoundRect(bounds.x, bounds.y + 22f, bounds.width, 48f, Radii.control, 1f, theme.colors.outlineVariant)
        drawText(
            widget.value ?: "Выберите файл",
            dev.ivlev.silent.ui.layout.Rect(bounds.x + 14f, bounds.y + 22f, bounds.width - 120f, 48f),
            Typography.bodySmall,
            if (widget.value == null) theme.colors.onSurfaceMuted else theme.colors.onSurface,
            verticalCenter = true,
            maxLines = 1,
        )
        drawText("Обзор…", dev.ivlev.silent.ui.layout.Rect(bounds.right - 100f, bounds.y + 22f, 84f, 48f), Typography.labelLarge, theme.colors.primary, TextAlign.Center, verticalCenter = true)
    }

    private fun paintFieldArray(node: RenderNode, widget: FieldArray) {
        var y = node.bounds.y
        repeat(widget.count) { index ->
            val contentHeight = node.children
                .filter { it.bounds.y >= y - 0.5f && it.bounds.y < y + 200f }
                .maxOfOrNull { it.bounds.bottom - y } ?: 0f
            drawText(
                "×",
                Rect(node.bounds.right - 32f, y, 28f, 28f),
                Typography.labelLarge,
                theme.colors.onSurfaceMuted,
                TextAlign.Center,
                verticalCenter = true,
            )
            y += contentHeight + 8f
        }
        painter.roundRect(node.bounds.x, y, 120f, 40f, Radii.control, theme.colors.surfaceContainerHigh)
        drawText("+ Добавить", Rect(node.bounds.x, y, 120f, 40f), Typography.labelLarge, theme.colors.primary, TextAlign.Center, verticalCenter = true)
    }

    private fun paintListbox(node: RenderNode, widget: Listbox) {
        painter.roundRect(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height, Radii.md, theme.colors.surfaceBright)
        painter.strokeRoundRect(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height, Radii.md, 1f, theme.colors.outlineVariant)
        widget.options.forEachIndexed { index, option ->
            val y = node.bounds.y + 8f + index * 36f
            if (index == widget.selected) {
                painter.rect(node.bounds.x + 4f, y, node.bounds.width - 8f, 36f, theme.colors.primaryContainer.withAlpha(0.5f))
            }
            drawText(
                option,
                Rect(node.bounds.x + 14f, y, node.bounds.width - 28f, 36f),
                Typography.bodySmall,
                if (index == widget.selected) theme.colors.onPrimaryContainer else theme.colors.onSurface,
                verticalCenter = true,
                maxLines = 1,
            )
        }
    }

    private fun paintDatePicker(node: RenderNode, widget: DatePicker) {
        val bounds = node.bounds
        drawText(widget.label, dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, 20f), Typography.labelMedium, theme.colors.onSurfaceMuted, maxLines = 1)
        painter.roundRect(bounds.x, bounds.y + 22f, bounds.width, 44f, Radii.control, theme.colors.surfaceContainerLowest)
        painter.strokeRoundRect(bounds.x, bounds.y + 22f, bounds.width, 44f, Radii.control, 1f, theme.colors.outlineVariant)
        drawText(dateLabel(widget.value).ifEmpty { "дд.мм.гггг" }, dev.ivlev.silent.ui.layout.Rect(bounds.x + 14f, bounds.y + 22f, bounds.width - 50f, 44f), Typography.bodyMedium, if (widget.value == null) theme.colors.onSurfaceMuted else theme.colors.onSurface, verticalCenter = true, maxLines = 1)
        drawText("v", dev.ivlev.silent.ui.layout.Rect(bounds.right - 36f, bounds.y + 22f, 24f, 44f), Typography.bodyMedium, theme.colors.onSurfaceMuted, TextAlign.Center, verticalCenter = true)
        if (widget.open) paintCalendar(bounds, widget.value, 70f)
    }

    private fun paintCalendar(bounds: dev.ivlev.silent.ui.layout.Rect, selected: LocalDate?, topOffset: Float) {
        val month = YearMonth.from(selected ?: LocalDate.now())
        val cell = bounds.width / 7f
        val top = bounds.y + topOffset
        val weekdays = listOf("Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс")
        weekdays.forEachIndexed { index, day ->
            drawText(day, dev.ivlev.silent.ui.layout.Rect(bounds.x + index * cell, top, cell, 24f), Typography.labelSmall, theme.colors.onSurfaceMuted, TextAlign.Center)
        }
        val offset = month.atDay(1).dayOfWeek.value - 1
        for (day in 1..month.lengthOfMonth()) {
            val index = offset + day - 1
            val x = bounds.x + (index % 7) * cell
            val y = top + 24f + (index / 7) * 32f
            val isSelected = selected?.let { it.year == month.year && it.monthValue == month.monthValue && it.dayOfMonth == day } == true
            if (isSelected) painter.roundRect(x + 4f, y + 2f, cell - 8f, 28f, Radii.sm, theme.colors.primary)
            drawText(
                day.toString(),
                dev.ivlev.silent.ui.layout.Rect(x, y, cell, 32f),
                Typography.bodySmall,
                if (isSelected) theme.colors.onPrimary else theme.colors.onSurface,
                TextAlign.Center,
                verticalCenter = true,
            )
        }
    }

    private fun paintDateRangePicker(node: RenderNode, widget: DateRangePicker) {
        val bounds = node.bounds
        drawText(widget.label, dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, 20f), Typography.labelMedium, theme.colors.onSurfaceMuted, maxLines = 1)
        painter.roundRect(bounds.x, bounds.y + 22f, bounds.width, 44f, Radii.control, theme.colors.surfaceContainerLowest)
        painter.strokeRoundRect(bounds.x, bounds.y + 22f, bounds.width, 44f, Radii.control, 1f, theme.colors.outlineVariant)
        val text = "${dateLabel(widget.start).ifEmpty { "—" }}  —  ${dateLabel(widget.end).ifEmpty { "—" }}"
        drawText(text, dev.ivlev.silent.ui.layout.Rect(bounds.x + 14f, bounds.y + 22f, bounds.width - 50f, 44f), Typography.bodyMedium, theme.colors.onSurface, verticalCenter = true, maxLines = 1)
        if (widget.open) paintCalendar(bounds, widget.start, 70f)
    }

    private fun paintColorPicker(node: RenderNode, widget: ColorPicker) {
        val bounds = node.bounds
        drawText("Цвет", dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, 20f), Typography.labelMedium, theme.colors.onSurfaceMuted, maxLines = 1)
        widget.palette.forEachIndexed { index, color ->
            val x = bounds.x + index * 36f
            painter.roundRect(x, bounds.y + 24f, 28f, 28f, 8f, color)
            if (color == widget.value) {
                painter.strokeRoundRect(x - 2f, bounds.y + 22f, 32f, 32f, 9f, 2f, theme.colors.onSurface)
            }
        }
        drawText("#${widget.value.argb.toString(16).padStart(8, '0').takeLast(6).uppercase()}", dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y + 56f, bounds.width, 20f), Typography.labelSmall, theme.colors.onSurfaceMuted, maxLines = 1)
    }

    private fun paintRichText(node: RenderNode, widget: RichTextEditor) {
        val bounds = node.bounds
        painter.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, Radii.control, theme.colors.surfaceContainerLowest)
        painter.strokeRoundRect(bounds.x, bounds.y, bounds.width, bounds.height, Radii.control, 1f, theme.colors.outlineVariant)
        painter.rect(bounds.x + 1f, bounds.y + 48f, bounds.width - 2f, 1f, theme.colors.outlineVariant)
        widget.toolbar.forEachIndexed { index, action ->
            val x = bounds.x + 8f + index * 36f
            painter.roundRect(x, bounds.y + 8f, 32f, 32f, Radii.sm, theme.colors.surfaceContainerHigh)
            drawText(action, dev.ivlev.silent.ui.layout.Rect(x, bounds.y + 8f, 32f, 32f), Typography.labelLarge, theme.colors.onSurfaceVariant, TextAlign.Center, verticalCenter = true, maxLines = 1)
        }
        val text = widget.value.ifEmpty { widget.placeholder }
        val color = if (widget.value.isEmpty()) theme.colors.onSurfaceMuted else theme.colors.onSurface
        val lines = wrapText(text, Typography.bodyMedium, bounds.width - 32f, measurer, 6)
        lines.forEachIndexed { index, line ->
            painter.text(line, bounds.x + 16f, bounds.y + 72f + index * Typography.bodyMedium.lineHeight, Typography.bodyMedium, color)
        }
    }

    private fun paintDialog(node: RenderNode, widget: Dialog) {
        val bounds = node.bounds
        if (widget.modal) {
            painter.rect(bounds.x, bounds.y, bounds.width, bounds.height, theme.colors.scrim.withAlpha(0.42f))
        }
        val width = minOf(widget.panelWidth, bounds.width)
        val height = if (widget.fill) minOf(bounds.height - 48f, 560f) else widget.panelHeight(
            BuildContext(theme, measurer, bounds.width, bounds.height, 1f),
            width,
        )
        val panel = dev.ivlev.silent.ui.layout.Rect(
            bounds.x + (bounds.width - width) / 2f,
            bounds.y + (bounds.height - height) / 2f,
            width,
            height,
        )
        painter.roundRect(panel.x, panel.y, panel.width, panel.height, Radii.xl, theme.colors.surfaceBright)
        painter.strokeRoundRect(panel.x, panel.y, panel.width, panel.height, Radii.xl, 1f, theme.colors.outlineVariant)
        drawText(widget.title, dev.ivlev.silent.ui.layout.Rect(panel.x + 24f, panel.y + 20f, panel.width - 80f, 32f), Typography.titleLarge, theme.colors.onSurface, maxLines = 1)
        widget.description?.let { description ->
            drawText(description, dev.ivlev.silent.ui.layout.Rect(panel.x + 24f, panel.y + 52f, panel.width - 48f, 24f), Typography.bodySmall, theme.colors.onSurfaceVariant, maxLines = 1)
        }
        if (widget.showClose) {
            drawText("×", dev.ivlev.silent.ui.layout.Rect(panel.right - 52f, panel.y + 16f, 32f, 32f), Typography.titleLarge, theme.colors.onSurfaceMuted, TextAlign.Center, verticalCenter = true)
        }
    }

    private fun paintDrawer(node: RenderNode, widget: Drawer) {
        if (!widget.open) return
        val bounds = node.bounds
        if (widget.modal) painter.rect(bounds.x, bounds.y, bounds.width, bounds.height, theme.colors.scrim.withAlpha(0.42f))
        val width = minOf(widget.width, bounds.width)
        val panel = dev.ivlev.silent.ui.layout.Rect(if (widget.side == DrawerSide.Start) bounds.x else bounds.right - width, bounds.y, width, bounds.height)
        painter.rect(panel.x, panel.y, panel.width, panel.height, theme.colors.surfaceBright)
        painter.rect(panel.right - 1f, panel.y, 1f, panel.height, theme.colors.outlineVariant)
        widget.title?.let { title ->
            drawText(title, dev.ivlev.silent.ui.layout.Rect(panel.x + 16f, panel.y + 16f, panel.width - 64f, 32f), Typography.titleMedium, theme.colors.onSurface, maxLines = 1)
        }
        drawText("×", dev.ivlev.silent.ui.layout.Rect(panel.right - 44f, panel.y + 12f, 32f, 32f), Typography.titleLarge, theme.colors.onSurfaceMuted, TextAlign.Center, verticalCenter = true)
        painter.rect(panel.x, panel.y + 56f, panel.width, 1f, theme.colors.outlineVariant)
    }

    private fun paintSheet(node: RenderNode, widget: Sheet) {
        if (!widget.open) return
        val bounds = node.bounds
        if (widget.modal) painter.rect(bounds.x, bounds.y, bounds.width, bounds.height, theme.colors.scrim.withAlpha(0.42f))
        val panel = when (widget.side) {
            SheetSide.Bottom -> dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.bottom - minOf(320f, bounds.height), bounds.width, minOf(320f, bounds.height))
            SheetSide.Top -> dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, bounds.width, minOf(320f, bounds.height))
            SheetSide.Right -> dev.ivlev.silent.ui.layout.Rect(bounds.right - minOf(400f, bounds.width), bounds.y, minOf(400f, bounds.width), bounds.height)
            SheetSide.Left -> dev.ivlev.silent.ui.layout.Rect(bounds.x, bounds.y, minOf(400f, bounds.width), bounds.height)
        }
        painter.roundRect(panel.x, panel.y, panel.width, panel.height, Radii.xl, theme.colors.surfaceBright)
        painter.strokeRoundRect(panel.x, panel.y, panel.width, panel.height, Radii.xl, 1f, theme.colors.outlineVariant)
        if (widget.side == SheetSide.Bottom) {
            painter.roundRect(panel.x + panel.width / 2f - 18f, panel.y + 8f, 36f, 4f, 2f, theme.colors.outlineVariant)
        }
        drawText(widget.title, dev.ivlev.silent.ui.layout.Rect(panel.x + 20f, panel.y + 20f, panel.width - 80f, 32f), Typography.titleMedium, theme.colors.onSurface, maxLines = 1)
        widget.description?.let { description ->
            drawText(description, dev.ivlev.silent.ui.layout.Rect(panel.x + 20f, panel.y + 48f, panel.width - 48f, 24f), Typography.bodySmall, theme.colors.onSurfaceVariant, maxLines = 1)
        }
        drawText("×", dev.ivlev.silent.ui.layout.Rect(panel.right - 48f, panel.y + 12f, 32f, 32f), Typography.titleLarge, theme.colors.onSurfaceMuted, TextAlign.Center, verticalCenter = true)
    }

    private fun paintPopover(node: RenderNode, widget: Popover) {
        if (!widget.open) return
        val bounds = node.bounds
        painter.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, Radii.md, theme.colors.surfaceBright)
        painter.strokeRoundRect(bounds.x, bounds.y, bounds.width, bounds.height, Radii.md, 1f, theme.colors.outlineVariant)
        widget.title?.let { title ->
            drawText(title, dev.ivlev.silent.ui.layout.Rect(bounds.x + 16f, bounds.y + 12f, bounds.width - 56f, 24f), Typography.titleSmall, theme.colors.onSurface, maxLines = 1)
        }
        drawText("×", dev.ivlev.silent.ui.layout.Rect(bounds.right - 36f, bounds.y + 8f, 28f, 28f), Typography.titleMedium, theme.colors.onSurfaceMuted, TextAlign.Center, verticalCenter = true)
    }

    private fun paintMenu(node: RenderNode, widget: Menu) {
        if (!widget.open) return
        val bounds = node.bounds
        painter.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, Radii.md, theme.colors.surfaceBright)
        painter.strokeRoundRect(bounds.x, bounds.y, bounds.width, bounds.height, Radii.md, 1f, theme.colors.outlineVariant)
        widget.items.forEachIndexed { index, item ->
            val y = bounds.y + 8f + index * 40f
            if (index == widget.selected) {
                painter.rect(bounds.x + 4f, y, bounds.width - 8f, 40f, theme.colors.primaryContainer.withAlpha(0.5f))
            }
            drawText(
                item,
                dev.ivlev.silent.ui.layout.Rect(bounds.x + 16f, y, bounds.width - 48f, 40f),
                Typography.bodySmall,
                if (index in widget.disabled) theme.colors.onSurfaceMuted else theme.colors.onSurface,
                verticalCenter = true,
                maxLines = 1,
            )
            if (index == widget.selected) {
                val checkX = bounds.right - 24f
                val checkY = y + 20f
                painter.line(checkX - 6f, checkY, checkX - 2f, checkY + 4f, 2f, theme.colors.primary)
                painter.line(checkX - 2f, checkY + 4f, checkX + 6f, checkY - 5f, 2f, theme.colors.primary)
            }
        }
    }

    private fun paintTooltip(node: RenderNode, widget: Tooltip) {
        if (!widget.visible) return
        painter.roundRect(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height, Radii.sm, theme.colors.inverseSurface)
        drawText(widget.text, node.bounds, Typography.bodySmall, theme.colors.inverseOnSurface, TextAlign.Center, verticalCenter = true, maxLines = 1)
    }

    private fun paintSnackbar(node: RenderNode, widget: Snackbar) {
        if (!widget.open) return
        val bounds = node.bounds
        painter.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, Radii.md, theme.colors.inverseSurface)
        drawText(widget.message, dev.ivlev.silent.ui.layout.Rect(bounds.x + 16f, bounds.y, bounds.width - 180f, bounds.height), Typography.bodySmall, theme.colors.inverseOnSurface, verticalCenter = true, maxLines = 2)
        widget.actionLabel?.let { action ->
            drawText(action, dev.ivlev.silent.ui.layout.Rect(bounds.right - 150f, bounds.y, 90f, bounds.height), Typography.labelLarge, theme.colors.primary, TextAlign.End, verticalCenter = true, maxLines = 1)
        }
        drawText("×", dev.ivlev.silent.ui.layout.Rect(bounds.right - 40f, bounds.y, 32f, bounds.height), Typography.titleMedium, theme.colors.inverseOnSurface, TextAlign.Center, verticalCenter = true)
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
        painter.save()
        painter.clip(bounds.x, bounds.y, bounds.width, bounds.height)
        lines.forEachIndexed { index, line ->
            val display = ellipsize(line, style, bounds.width)
            val lineWidth = measurer.width(display, style)
            val x = when (align) {
                TextAlign.Start -> bounds.x
                TextAlign.Center -> bounds.x + (bounds.width - lineWidth) / 2f
                TextAlign.End -> bounds.x + bounds.width - lineWidth
            }
            painter.text(
                display,
                x,
                top + measurer.ascent(style) + index * style.lineHeight,
                style,
                color,
            )
        }
        painter.restore()
    }

    private fun ellipsize(text: String, style: TextStyle, maxWidth: Float): String {
        if (text.isEmpty() || measurer.width(text, style) <= maxWidth) return text
        var end = text.length
        while (end > 0) {
            val candidate = text.substring(0, end).trimEnd() + "…"
            if (measurer.width(candidate, style) <= maxWidth) return candidate
            end -= 1
        }
        return "…"
    }
}

fun percentLabel(value: Float): String = "${(value * 100f).roundToInt()}%"
