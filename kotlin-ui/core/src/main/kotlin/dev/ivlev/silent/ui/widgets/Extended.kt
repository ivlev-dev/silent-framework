package dev.ivlev.silent.ui.widgets

import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.ClickTarget
import dev.ivlev.silent.ui.layout.Constraints
import dev.ivlev.silent.ui.layout.HitRegion
import dev.ivlev.silent.ui.layout.Rect
import dev.ivlev.silent.ui.layout.RenderNode
import dev.ivlev.silent.ui.layout.Size
import dev.ivlev.silent.ui.layout.TextAlign
import dev.ivlev.silent.ui.layout.Widget
import dev.ivlev.silent.ui.layout.isolateWidgets
import dev.ivlev.silent.ui.tokens.Color
import dev.ivlev.silent.ui.tokens.Control
import dev.ivlev.silent.ui.tokens.ControlSize
import dev.ivlev.silent.ui.tokens.Radii
import dev.ivlev.silent.ui.tokens.Spacing
import dev.ivlev.silent.ui.tokens.TextStyle
import dev.ivlev.silent.ui.tokens.Theme
import dev.ivlev.silent.ui.tokens.Tone
import dev.ivlev.silent.ui.tokens.Typography
import kotlin.math.max

class Label(
    text: String,
    style: TextStyle = Typography.labelMedium,
    color: ((Theme) -> Color)? = null,
    val required: Boolean = false,
    val disabled: Boolean = false,
) : Text(text, style, color)

class Link(
    val text: String,
    val onClick: () -> Unit = {},
    val external: Boolean = false,
) : Widget(), ClickTarget {
    override val acceptsInput: Boolean
        get() = true

    override fun activate() = click()

    override fun click() = onClick()

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = context.textMeasurer.width(text, Typography.bodyMedium) + if (external) 14f else 0f
        return constraints.constrain(Size(width, Typography.bodyMedium.lineHeight))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class Fab(
    val glyph: String,
    val text: String? = null,
    val extended: Boolean = text != null,
    val size: ControlSize = ControlSize.LG,
    val enabled: Boolean = true,
    val onClick: () -> Unit = {},
) : Widget(), ClickTarget {
    override val acceptsInput: Boolean
        get() = enabled

    override fun activate() = click()

    override fun click() {
        if (enabled) onClick()
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val height = if (extended) maxOf(size.height, 56f) else 56f
        val width = if (extended) {
            56f + context.textMeasurer.width(text.orEmpty(), Typography.labelLarge) + Spacing.x6
        } else {
            56f
        }
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class Badge(
    val text: String,
    val tone: Tone = Tone.Error,
    val dot: Boolean = false,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (dot && text.isEmpty()) 8f
        else context.textMeasurer.width(text, Typography.labelSmall) + 12f
        return constraints.constrain(Size(width, 18f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class Chip(
    val text: String,
    val selected: Boolean = false,
    val removable: Boolean = false,
    val enabled: Boolean = true,
    val leadingIcon: String? = null,
    val onClick: (() -> Unit)? = null,
) : Widget(), ClickTarget {
    override val acceptsInput: Boolean
        get() = enabled && onClick != null

    override fun activate() = click()

    override fun click() {
        if (acceptsInput) onClick?.invoke()
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = context.textMeasurer.width(text, Typography.labelLarge) +
            Spacing.x3 * 2f +
            (if (leadingIcon != null) 18f else 0f) +
            (if (removable) 18f else 0f)
        return constraints.constrain(Size(width, 32f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class Avatar(
    val name: String,
    val size: Float = 40f,
    val image: String? = null,
    val tone: Tone = Tone.Primary,
    val onClick: (() -> Unit)? = null,
) : Widget(), ClickTarget {
    val initials: String
        get() = name.trim().split(' ').filter { it.isNotBlank() }
            .take(2).joinToString("") { it.first().uppercase() }

    override val acceptsInput: Boolean
        get() = onClick != null

    override fun activate() = click()

    override fun click() {
        onClick?.invoke()
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size =
        constraints.constrain(Size(size, size))

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class Spinner(
    val size: Float = 20f,
    val color: ((Theme) -> Color)? = null,
    val label: String? = null,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size =
        constraints.constrain(Size(size, size))

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class Skeleton(
    val width: Float? = null,
    val height: Float = 16f,
    val radius: Float = Radii.sm,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val resolved = width ?: if (constraints.maxWidth.isFinite()) constraints.maxWidth else 160f
        return constraints.constrain(Size(resolved, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class EmptyState(
    val title: String,
    val description: String? = null,
    val glyph: String = "□",
    val action: (() -> Widget)? = null,
) : Widget() {
    private val actionWidget: Widget? = action?.let { isolateWidgets(it) }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        val actionHeight = actionWidget?.measure(context, Constraints(0f, width, 0f, 100f))?.height ?: 0f
        val height = 80f + Typography.titleMedium.lineHeight + (if (description != null) 64f else 0f) +
            (if (actionWidget != null) actionHeight + Spacing.x4 else 0f)
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val nodes = mutableListOf<RenderNode>()
        actionWidget?.let { widget ->
            val size = widget.measure(context, Constraints(0f, bounds.width, 0f, 100f))
            nodes.add(
                widget.build(
                    context,
                    Rect(
                        bounds.x + (bounds.width - size.width) / 2f,
                        bounds.y + bounds.height - size.height,
                        size.width,
                        size.height,
                    ),
                ),
            )
        }
        return RenderNode(this, bounds, nodes)
    }
}

class Alert(
    val title: String,
    val description: String? = null,
    val tone: Tone = Tone.Info,
    val action: (() -> Widget)? = null,
    val dismissible: Boolean = false,
) : Widget() {
    private val actionWidget: Widget? = action?.let { isolateWidgets(it) }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        val base = 52f + (if (description != null) 24f else 0f)
        return constraints.constrain(Size(width, maxOf(base, 64f)))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val nodes = mutableListOf<RenderNode>()
        actionWidget?.let { widget ->
            val size = widget.measure(context, Constraints(0f, 120f, 0f, 60f))
            nodes.add(
                widget.build(
                    context,
                    Rect(bounds.right - size.width - 16f, bounds.y + (bounds.height - size.height) / 2f, size.width, size.height),
                ),
            )
        }
        return RenderNode(this, bounds, nodes)
    }
}

enum class TopAppBarVariant {
    Small,
    Medium,
    Large,
}

class TopAppBar(
    val title: String,
    val subtitle: String? = null,
    val variant: TopAppBarVariant = TopAppBarVariant.Small,
    val leading: (() -> Widget)? = null,
    val actions: (() -> Widget)? = null,
    val elevated: Boolean = false,
) : Widget() {
    private val leadingWidget: Widget? = leading?.let { isolateWidgets(it) }
    private val actionsWidget: Widget? = actions?.let { isolateWidgets(it) }

    val barHeight: Float
        get() = when (variant) {
            TopAppBarVariant.Small -> 64f
            TopAppBarVariant.Medium -> 88f
            TopAppBarVariant.Large -> 112f
        }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 720f
        return constraints.constrain(Size(width, barHeight))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val nodes = mutableListOf<RenderNode>()
        leadingWidget?.let { widget ->
            val size = widget.measure(context, Constraints(0f, 80f, 0f, bounds.height))
            nodes.add(
                widget.build(
                    context,
                    Rect(bounds.x + 16f, bounds.y + (bounds.height - size.height) / 2f, size.width, size.height),
                ),
            )
        }
        actionsWidget?.let { widget ->
            val size = widget.measure(context, Constraints(0f, bounds.width / 2f, 0f, bounds.height))
            nodes.add(
                widget.build(
                    context,
                    Rect(
                        bounds.right - size.width - 16f,
                        bounds.y + (bounds.height - size.height) / 2f,
                        size.width,
                        size.height,
                    ),
                ),
            )
        }
        return RenderNode(this, bounds, nodes)
    }
}

class Tabs(
    val items: List<String>,
    val selected: () -> Int,
    val onSelect: (Int) -> Unit,
    val scrollable: Boolean = false,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 480f
        return constraints.constrain(Size(width, 48f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val count = items.size.coerceAtLeast(1)
        val itemWidth = if (scrollable) maxOf(120f, bounds.width / count) else bounds.width / count
        val nodes = items.mapIndexed { index, _ ->
            HitRegion(onClick = { onSelect(index) }).build(
                context,
                Rect(bounds.x + itemWidth * index, bounds.y, itemWidth, bounds.height),
            )
        }
        return RenderNode(this, bounds, nodes)
    }
}

data class SegmentOption(val value: String, val label: String, val icon: String? = null)

class SegmentedButton(
    val options: List<SegmentOption>,
    val selected: String,
    val onSelect: (String) -> Unit,
    var multi: Boolean = false,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        return constraints.constrain(Size(width, 40f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val count = options.size.coerceAtLeast(1)
        val itemWidth = bounds.width / count
        val nodes = options.mapIndexed { index, option ->
            HitRegion(onClick = { onSelect(option.value) }).build(
                context,
                Rect(bounds.x + itemWidth * index, bounds.y, itemWidth, bounds.height),
            )
        }
        return RenderNode(this, bounds, nodes)
    }
}

class Breadcrumbs(
    val items: List<String>,
    val onSelect: (Int) -> Unit = {},
) : Widget() {
    fun itemBounds(context: BuildContext, bounds: Rect): List<Rect> {
        val separatorWidth = context.textMeasurer.width(" / ", Typography.bodySmall)
        val result = mutableListOf<Rect>()
        var x = bounds.x
        items.forEachIndexed { index, item ->
            val width = context.textMeasurer.width(item, Typography.bodySmall)
            result.add(Rect(x, bounds.y, width, bounds.height))
            x += width
            if (index < items.lastIndex) x += separatorWidth
        }
        return result
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val text = items.joinToString(" / ")
        return constraints.constrain(Size(context.textMeasurer.width(text, Typography.bodySmall), 24f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val rects = itemBounds(context, bounds)
        val nodes = items.mapIndexed { index, _ ->
            HitRegion(onClick = { onSelect(index) }).build(context, rects[index])
        }
        return RenderNode(this, bounds, nodes)
    }
}

class Pagination(
    val page: Int,
    val pageCount: Int,
    val onPage: (Int) -> Unit,
    val showEdges: Boolean = true,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size =
        constraints.constrain(Size(if (constraints.maxWidth.isFinite()) constraints.maxWidth else 320f, 40f))

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val slots = if (showEdges) pageCount + 2 else pageCount
        val itemWidth = (bounds.width / slots.coerceAtLeast(1)).coerceAtMost(40f)
        val nodes = mutableListOf<RenderNode>()
        if (showEdges) {
            nodes.add(HitRegion(onClick = { onPage((page - 1).coerceAtLeast(1)) }).build(
                context,
                Rect(bounds.x, bounds.y, itemWidth, bounds.height),
            ))
        }
        for (index in 1..pageCount) {
            nodes.add(HitRegion(onClick = { onPage(index) }).build(
                context,
                Rect(bounds.x + itemWidth * (if (showEdges) index else index - 1), bounds.y, itemWidth, bounds.height),
            ))
        }
        if (showEdges) {
            nodes.add(HitRegion(onClick = { onPage((page + 1).coerceAtMost(pageCount)) }).build(
                context,
                Rect(bounds.right - itemWidth, bounds.y, itemWidth, bounds.height),
            ))
        }
        return RenderNode(this, bounds, nodes)
    }
}

class AccordionEntry(
    val title: String,
    val content: () -> Widget,
)

class Accordion(
    val entries: List<AccordionEntry>,
    val expanded: Set<Int>,
    val onToggle: (Int) -> Unit,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 480f
        var height = 0f
        entries.forEachIndexed { index, entry ->
            height += 48f
            if (index in expanded) {
                val content = isolateWidgets(entry.content)
                height += content.measure(context, Constraints(0f, width, 0f, Float.POSITIVE_INFINITY)).height + 16f
            }
        }
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val nodes = mutableListOf<RenderNode>()
        var y = bounds.y
        entries.forEachIndexed { index, entry ->
            nodes.add(HitRegion(onClick = { onToggle(index) }).build(
                context,
                Rect(bounds.x, y, bounds.width, 48f),
            ))
            y += 48f
            if (index in expanded) {
                val content = isolateWidgets(entry.content)
                val size = content.measure(context, Constraints(0f, bounds.width, 0f, Float.POSITIVE_INFINITY))
                nodes.add(content.build(context, Rect(bounds.x + 16f, y, (bounds.width - 32f).coerceAtLeast(0f), size.height)))
                y += size.height + 16f
            }
        }
        return RenderNode(this, bounds, nodes)
    }
}

data class ListItem(
    val title: String,
    val description: String? = null,
    val leading: String? = null,
    val trailing: String? = null,
    val selected: Boolean = false,
    val disabled: Boolean = false,
)

class ListPanel(
    val items: List<ListItem>,
    val onSelect: (Int) -> Unit = {},
) : Widget(), ClickTarget {
    private var lastBounds: Rect = Rect.Zero
    var visibleTop: Float = Float.NaN
    var hoverRow: Int = -1

    override fun hoverBoundsAt(x: Float, y: Float, bounds: Rect): Rect {
        val top = maxOf(lastBounds.y, if (visibleTop.isFinite()) visibleTop else lastBounds.y)
        val row = ((y - top) / 56f).toInt()
        return if (row in items.indices) Rect(bounds.x, top + row * 56f, bounds.width, 56f) else bounds
    }

    fun updateHover(y: Float) {
        val top = maxOf(lastBounds.y, if (visibleTop.isFinite()) visibleTop else lastBounds.y)
        hoverRow = ((y - top) / 56f).toInt()
        if (hoverRow !in items.indices) hoverRow = -1
    }

    override val acceptsInput: Boolean
        get() = true

    override fun activate() = Unit

    override fun click() = Unit

    override fun activateAt(x: Float, y: Float) {
        if (lastBounds.width <= 0f) return
        val top = maxOf(lastBounds.y, if (visibleTop.isFinite()) visibleTop else lastBounds.y)
        val index = ((y - top) / 56f).toInt()
        val item = items.getOrNull(index) ?: return
        if (!item.disabled) onSelect(index)
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        return constraints.constrain(Size(width, items.size * 56f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        lastBounds = bounds
        return RenderNode(this, bounds, emptyList())
    }
}

data class DataColumn(
    val key: String,
    val header: String,
    val align: TextAlign = TextAlign.Start,
    val weight: Float = 1f,
    val sortable: Boolean = false,
)

enum class DataState {
    Ready,
    Loading,
    Empty,
    Error,
}

enum class TableDensity(val rowHeight: Float) {
    Compact(48f),
    Default(56f),
    Comfortable(64f),
}

class TableState {
    var order: List<String> = emptyList()
    val widths: MutableMap<String, Float> = mutableMapOf()
    var density: TableDensity = TableDensity.Default
    var dragKey: String? = null
    var dragStartX: Float = 0f
    var dragGhostX: Float = 0f
    var dragActive: Boolean = false
    var resizeKey: String? = null
    var resizeStartWidth: Float = 0f
    var resizeStartX: Float = 0f
    var targetKey: String? = null

    fun ensureOrder(columns: List<DataColumn>) {
        val keys = columns.map { it.key }
        if (order.size != keys.size || order.toSet() != keys.toSet()) order = keys
    }

    fun ordered(columns: List<DataColumn>): List<DataColumn> {
        ensureOrder(columns)
        val map = columns.associateBy { it.key }
        return order.mapNotNull { map[it] }
    }

    fun resetWidths() {
        widths.clear()
    }

    fun reset() {
        widths.clear()
        order = emptyList()
        dragKey = null
        resizeKey = null
        dragActive = false
        targetKey = null
    }
}

class DataTable(
    val columns: List<DataColumn>,
    val rows: List<List<String>>,
    val selectedRows: Set<Int> = emptySet(),
    val onSelectRow: (Int, Boolean) -> Unit = { _, _ -> },
    val sortKey: String? = null,
    val sortDirection: String = "ascending",
    val onSort: (String) -> Unit = {},
    val page: Int = 1,
    val pageCount: Int = 1,
    val pageSize: Int = 10,
    val totalRows: Int = rows.size,
    val pageSizeOptions: List<Int> = listOf(10, 20, 50),
    val onPage: (Int) -> Unit = {},
    val onPageSize: (Int) -> Unit = {},
    val state: DataState = DataState.Ready,
    val compact: Boolean = false,
    val selectable: Boolean = true,
    val onRetry: () -> Unit = {},
    val onClearSelection: () -> Unit = {},
    val tableState: TableState = TableState(),
    val rowDragEnabled: Boolean = false,
    val onMoveRow: (Int, Int) -> Unit = { _, _ -> },
    val statusKey: String? = null,
    val tagsKey: String? = null,
) : Widget(), ClickTarget {
    enum class FooterKind {
        First,
        Previous,
        Page,
        Ellipsis,
        Next,
        Last,
        PageSize,
    }

    data class FooterSlot(
        val label: String,
        val page: Int?,
        val kind: FooterKind,
        val bounds: Rect,
    )

    val rowHeight: Float
        get() = if (compact) tableState.density.rowHeight.coerceAtMost(48f) else tableState.density.rowHeight

    private var lastBounds: Rect = Rect.Zero
    var visibleTop: Float = Float.NaN
    var hoverRow: Int = -1
    var hoverColumn: Int = -1

    private fun headerTop(): Float =
        maxOf(lastBounds.y, if (visibleTop.isFinite()) visibleTop else lastBounds.y)

    override fun hoverBoundsAt(x: Float, y: Float, bounds: Rect): Rect {
        val narrow = lastBounds.width < 600f
        val headerBottom = headerTop() + 48f
        if (!narrow && y in headerTop()..headerBottom) {
            var left = lastBounds.x
            displayColumns().forEachIndexed { index, _ ->
                val width = columnWidth(lastBounds, index)
                if (x in left..(left + width)) return Rect(left, headerTop(), width, 48f)
                left += width
            }
        }
        val rowHeight = if (narrow) 96f else rowHeight
        val row = ((y - headerBottom) / rowHeight).toInt()
        if (row in rows.indices) {
            return Rect(bounds.x, headerBottom + row * rowHeight, bounds.width, rowHeight)
        }
        return bounds
    }

    fun updateHover(x: Float, y: Float) {
        val narrow = lastBounds.width < 600f
        val headerBottom = headerTop() + 48f
        if (!narrow && y in headerTop()..headerBottom) {
            hoverRow = -1
            hoverColumn = -1
            var left = lastBounds.x
            displayColumns().forEachIndexed { index, _ ->
                val width = columnWidth(lastBounds, index)
                if (x in left..(left + width)) hoverColumn = index
                left += width
            }
        } else {
            hoverColumn = -1
            val rowHeight = if (narrow) 96f else rowHeight
            hoverRow = ((y - headerBottom) / rowHeight).toInt()
            if (hoverRow !in rows.indices) hoverRow = -1
        }
    }

    override val acceptsInput: Boolean
        get() = true

    override fun activate() = Unit

    override fun click() = Unit

    override fun cursorAt(x: Float, y: Float): dev.ivlev.silent.ui.layout.UiCursor {
        if (y >= headerTop() && y <= headerTop() + 48f) {
            val key = headerKeyAt(x, y)
            val edge = key?.let { candidate ->
                var left = lastBounds.x
                var result = false
                displayColumns().forEachIndexed { index, column ->
                    val width = columnWidth(lastBounds, index)
                    if (column.key == candidate && x > left + width - 10f) result = true
                    left += width
                }
                result
            } ?: false
            return if (edge) dev.ivlev.silent.ui.layout.UiCursor.ColResize
            else dev.ivlev.silent.ui.layout.UiCursor.Grab
        }
        return dev.ivlev.silent.ui.layout.UiCursor.Pointer
    }

    override fun activateAt(x: Float, y: Float) {
        if (lastBounds.width <= 0f) return
        val narrow = lastBounds.width < 600f
        val headerBottom = headerTop() + 48f
        if (y < headerBottom && !narrow) {
            val ordered = tableState.ordered(columns)
            var left = lastBounds.x
            ordered.forEach { column ->
                val width = columnWidth(lastBounds, ordered.indexOf(column))
                if (x in left..(left + width) && column.sortable) {
                    onSort(column.key)
                    return
                }
                left += width
            }
            return
        }
        if (state != DataState.Ready) {
            if (state == DataState.Error) onRetry()
            return
        }
        val rowIndex = ((y - headerBottom) / if (narrow) 96f else rowHeight).toInt()
        if (rowIndex in rows.indices) {
            if (selectable || !rowDragEnabled) onSelectRow(rowIndex, rowIndex !in selectedRows)
        }
    }

    override fun doubleClickAt(x: Float, y: Float) {
        if (y < lastBounds.y + 48f) {
            val key = tableState.resizeKey ?: headerKeyAt(x, y)
            if (key != null) tableState.widths.remove(key)
            else tableState.resetWidths()
        }
    }

    override fun dragStartAt(x: Float, y: Float) {
        if (y < headerTop() || y >= headerTop() + 48f) return
        val ordered = tableState.ordered(columns)
        var left = lastBounds.x
        ordered.forEach { column ->
            val width = columnWidth(lastBounds, ordered.indexOf(column))
            if (x in left..(left + width)) {
                val nearRight = x > left + width - 10f
                if (nearRight) {
                    tableState.resizeKey = column.key
                    tableState.resizeStartX = x
                    tableState.resizeStartWidth = width
                } else {
                    tableState.dragKey = column.key
                    tableState.dragStartX = x
                    tableState.dragGhostX = x
                    tableState.dragActive = false
                }
                return
            }
            left += width
        }
    }

    override fun dragMoveTo(x: Float, y: Float) {
        tableState.resizeKey?.let { key ->
            val delta = x - tableState.resizeStartX
            tableState.widths[key] = (tableState.resizeStartWidth + delta).coerceIn(64f, lastBounds.width * 0.7f)
            return
        }
        val key = tableState.dragKey ?: return
        if (!tableState.dragActive && kotlin.math.abs(x - tableState.dragStartX) > 6f) {
            tableState.dragActive = true
        }
        if (!tableState.dragActive) return
        tableState.dragGhostX = x
        val ordered = tableState.ordered(columns)
        var left = lastBounds.x
        ordered.forEachIndexed { index, column ->
            val width = columnWidth(lastBounds, index)
            if (x in left..(left + width)) {
                tableState.targetKey = column.key.takeIf { it != key }
                return
            }
            left += width
        }
    }

    override fun dragEndAt(x: Float, y: Float) {
        val key = tableState.dragKey
        val target = tableState.targetKey
        if (tableState.dragActive && key != null && target != null && key != target) {
            val from = tableState.order.indexOf(key)
            val to = tableState.order.indexOf(target)
            if (from >= 0 && to >= 0) {
                val next = tableState.order.toMutableList()
                next.removeAt(from)
                next.add(to, key)
                tableState.order = next
            }
        }
        tableState.resizeKey = null
        tableState.dragKey = null
        tableState.dragActive = false
        tableState.targetKey = null
    }

    fun displayColumns(): List<DataColumn> = tableState.ordered(columns)

    fun headerKeyAt(x: Float, y: Float): String? {
        if (y < headerTop() || y > headerTop() + 48f) return null
        val ordered = tableState.ordered(columns)
        var left = lastBounds.x
        ordered.forEachIndexed { index, column ->
            val width = columnWidth(lastBounds, index)
            if (x in left..(left + width)) return column.key
            left += width
        }
        return null
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 640f
        val narrow = context.viewportWidth < 600f
        val body = when (state) {
            DataState.Loading -> if (narrow) rows.size.coerceAtLeast(3) * 96f else rows.size.coerceAtLeast(4) * rowHeight
            DataState.Empty, DataState.Error -> 160f
            DataState.Ready -> if (narrow) rows.size * 96f else rows.size * rowHeight
        }
        val pagination = if (pageCount > 1) 56f else 0f
        return Size(width, 48f + body + pagination)
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        lastBounds = bounds
        val nodes = mutableListOf<RenderNode>()
        if (selectedRows.isNotEmpty()) {
            val bulkY = bounds.bottom - (if (pageCount > 1) 56f else 0f) - 48f
            nodes.add(HitRegion(onClick = onClearSelection).build(
                context,
                Rect(bounds.right - 180f, bulkY, 164f, 48f),
            ))
        }
        if (pageCount > 1) {
            footerSlots(bounds).forEach { slot ->
                val action = when (slot.kind) {
                    FooterKind.First -> { { onPage(1) } }
                    FooterKind.Previous -> { { onPage((page - 1).coerceAtLeast(1)) } }
                    FooterKind.Page -> { { onPage(slot.page ?: 1) } }
                    FooterKind.Next -> { { onPage((page + 1).coerceAtMost(pageCount)) } }
                    FooterKind.Last -> { { onPage(pageCount) } }
                    FooterKind.PageSize -> {
                        {
                            val index = pageSizeOptions.indexOf(pageSize).coerceAtLeast(0)
                            onPageSize(pageSizeOptions[(index + 1).mod(pageSizeOptions.size.coerceAtLeast(1))])
                        }
                    }
                    FooterKind.Ellipsis -> null
                }
                if (action != null) {
                    nodes.add(HitRegion(onClick = action).build(context, slot.bounds))
                }
            }
        }
        return RenderNode(this, bounds, nodes)
    }

    fun footerSlots(bounds: Rect): List<FooterSlot> {
        if (pageCount <= 1) return emptyList()
        val y = bounds.bottom - 52f
        val height = 40f
        var x = bounds.right - 16f
        val slots = mutableListOf<FooterSlot>()
        fun addBack(label: String, slotPage: Int?, kind: FooterKind, width: Float) {
            x -= width
            slots.add(FooterSlot(label, slotPage, kind, Rect(x, y, width, height)))
        }
        addBack("»", pageCount, FooterKind.Last, 28f)
        addBack("›", page + 1, FooterKind.Next, 28f)
        pageTokens().asReversed().forEach { token ->
            if (token == null) {
                addBack("…", null, FooterKind.Ellipsis, 24f)
            } else {
                addBack(token.toString(), token, FooterKind.Page, 32f)
            }
        }
        addBack("‹", page - 1, FooterKind.Previous, 28f)
        addBack("«", 1, FooterKind.First, 28f)
        x -= 16f
        val sizeWidth = 112f
        x -= sizeWidth
        slots.add(FooterSlot("Строк: $pageSize", null, FooterKind.PageSize, Rect(x, y, sizeWidth, height)))
        return slots
    }

    private fun pageTokens(): List<Int?> {
        if (pageCount <= 8) return (1..pageCount).toList()
        val current = page.coerceIn(1, pageCount)
        return when {
            current <= 4 -> listOf(1, 2, 3, 4, 5, null, pageCount)
            current >= pageCount - 3 -> listOf(1, null, pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount)
            else -> listOf(1, null, current - 1, current, current + 1, null, pageCount)
        }
    }

    fun columnWidth(bounds: Rect, index: Int): Float {
        val ordered = tableState.ordered(columns)
        val widths = ordered.map { column ->
            tableState.widths[column.key] ?: (bounds.width * column.weight / ordered.sumOf { it.weight.toDouble() }.toFloat().coerceAtLeast(0.01f))
        }
        val total = widths.sum()
        val width = widths.getOrElse(index) { 0f }
        return if (total > bounds.width && total > 0f) width * bounds.width / total else width
    }

    fun columnX(bounds: Rect, index: Int): Float {
        var x = bounds.x
        for (position in 0 until index) x += columnWidth(bounds, position)
        return x
    }
}

class Icon(
    val glyph: String,
    val size: Float = 20f,
) : Text(glyph, TextStyle(size, size + 6f, 500))

class VectorIcon(
    val name: String,
    val size: Float = 20f,
    val color: ((Theme) -> Color)? = null,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size =
        constraints.constrain(Size(size, size))

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}
