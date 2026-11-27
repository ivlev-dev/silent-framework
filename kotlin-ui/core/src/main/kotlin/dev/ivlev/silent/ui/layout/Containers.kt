package dev.ivlev.silent.ui.layout

import dev.ivlev.silent.ui.reactive.MutableSignal
import dev.ivlev.silent.ui.responsive.ResponsiveValue
import dev.ivlev.silent.ui.tokens.Color
import dev.ivlev.silent.ui.tokens.Theme

class BoxScope internal constructor()

class Box(
    val padding: Float = 0f,
    val align: Align = Align.Stretch,
    val verticalAlign: Align = Align.Start,
    val fillWidth: Boolean = true,
    val fillHeight: Boolean = false,
    val width: Float? = null,
    val height: Float? = null,
    val minHeight: Float = 0f,
    val background: ((Theme) -> Color)? = null,
    val borderColor: ((Theme) -> Color)? = null,
    val radius: Float = 0f,
    content: BoxScope.() -> Unit,
) : Widget() {
    val children: List<Widget> = collectWidgets { BoxScope().content() }

    constructor(
        padding: Float = 0f,
        align: Align = Align.Stretch,
        verticalAlign: Align = Align.Start,
        fillWidth: Boolean = true,
        fillHeight: Boolean = false,
        width: Float? = null,
        height: Float? = null,
        minHeight: Float = 0f,
        background: ((Theme) -> Color)? = null,
        borderColor: ((Theme) -> Color)? = null,
        radius: Float = 0f,
        child: Widget,
    ) : this(
        padding, align, verticalAlign, fillWidth, fillHeight, width, height, minHeight, background, borderColor, radius, {},
    ) {
        childrenOverride = listOf(child)
    }

    private var childrenOverride: List<Widget>? = null

    private fun actualChildren(): List<Widget> = childrenOverride ?: children

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val innerWidth = (constraints.maxWidth - padding * 2f).coerceAtLeast(0f)
        val innerHeight = (constraints.maxHeight - padding * 2f).coerceAtLeast(0f)
        val childSizes = actualChildren().map { child ->
            child.measure(context, Constraints(0f, innerWidth, 0f, innerHeight))
        }
        val contentWidth = childSizes.maxOfOrNull { it.width } ?: 0f
        val contentHeight = childSizes.maxOfOrNull { it.height } ?: 0f
        val resolvedWidth = width ?: if (fillWidth && constraints.maxWidth.isFinite()) constraints.maxWidth else contentWidth + padding * 2f
        val resolvedHeight = height ?: when {
            fillHeight && constraints.maxHeight.isFinite() -> constraints.maxHeight
            else -> maxOf(contentHeight + padding * 2f, minHeight)
        }
        return constraints.constrain(Size(resolvedWidth, resolvedHeight))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val inner = Rect(
            bounds.x + padding,
            bounds.y + padding,
            (bounds.width - padding * 2f).coerceAtLeast(0f),
            (bounds.height - padding * 2f).coerceAtLeast(0f),
        )
        val nodes = actualChildren().map { child ->
            val size = child.measure(context, Constraints(0f, inner.width, 0f, inner.height))
            val childWidth = if (align == Align.Stretch) inner.width else size.width.coerceAtMost(inner.width)
            val childHeight = if (verticalAlign == Align.Stretch) inner.height else size.height.coerceAtMost(inner.height)
            val x = inner.x + when (align) {
                Align.Start, Align.Stretch -> 0f
                Align.Center -> (inner.width - childWidth) / 2f
                Align.End -> inner.width - childWidth
            }
            val y = inner.y + when (verticalAlign) {
                Align.Start, Align.Stretch -> 0f
                Align.Center -> (inner.height - childHeight) / 2f
                Align.End -> inner.height - childHeight
            }
            child.build(context, Rect(x, y, childWidth, childHeight))
        }
        return RenderNode(this, bounds, nodes)
    }
}

class ColumnScope internal constructor()

class Column(
    val gap: Float = 0f,
    val padding: Float = 0f,
    val align: Align = Align.Stretch,
    val justify: Justify = Justify.Start,
    val fillWidth: Boolean = true,
    val fillHeight: Boolean = false,
    val background: ((Theme) -> Color)? = null,
    content: ColumnScope.() -> Unit,
) : Widget() {
    val children: List<Widget> = collectWidgets { ColumnScope().content() }

    constructor(
        gap: Float = 0f,
        padding: Float = 0f,
        align: Align = Align.Stretch,
        justify: Justify = Justify.Start,
        fillWidth: Boolean = true,
        fillHeight: Boolean = false,
        background: ((Theme) -> Color)? = null,
        children: List<Widget>,
    ) : this(gap, padding, align, justify, fillWidth, fillHeight, background, {}) {
        childrenOverride = children
    }

    private var childrenOverride: List<Widget>? = null

    private fun actualChildren(): List<Widget> = childrenOverride ?: children

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val insets = padding * 2f
        val innerWidth = (constraints.maxWidth - insets).coerceAtLeast(0f)
        val totalGap = gap * (actualChildren().size - 1).coerceAtLeast(0)
        var fixedHeight = 0f
        var contentWidth = 0f
        var totalWeight = 0f
        val fixedSizes = mutableListOf<Size>()
        actualChildren().forEach { child ->
            if (child is Expanded) {
                totalWeight += child.weight
                fixedSizes.add(Size.Zero)
            } else {
                val size = child.measure(context, Constraints(0f, innerWidth, 0f, Float.POSITIVE_INFINITY))
                fixedSizes.add(size)
                fixedHeight += size.height
                contentWidth = maxOf(contentWidth, size.width)
            }
        }
        var expandedHeight = 0f
        if (totalWeight > 0f) {
            val available = if (constraints.maxHeight.isFinite()) {
                (constraints.maxHeight - insets - totalGap - fixedHeight).coerceAtLeast(0f)
            } else {
                0f
            }
            if (available > 0f) {
                expandedHeight = available
            } else {
                actualChildren().filterIsInstance<Expanded>().forEach { child ->
                    val size = child.content.measure(
                        context,
                        Constraints(0f, innerWidth, 0f, Float.POSITIVE_INFINITY),
                    )
                    expandedHeight += size.height
                }
            }
        }
        val contentHeight = fixedHeight + totalGap + expandedHeight
        val width = when {
            fillWidth && constraints.maxWidth.isFinite() -> constraints.maxWidth
            else -> contentWidth + insets
        }
        val height = when {
            fillHeight && constraints.maxHeight.isFinite() -> constraints.maxHeight
            else -> contentHeight + insets
        }
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val inner = Rect(
            bounds.x + padding,
            bounds.y + padding,
            (bounds.width - insetsHorizontal()).coerceAtLeast(0f),
            (bounds.height - insetsVertical()).coerceAtLeast(0f),
        )
        val childrenList = actualChildren()
        val totalGap = gap * (childrenList.size - 1).coerceAtLeast(0)
        val measured = childrenList.map { child ->
            if (child is Expanded) {
                null
            } else {
                child.measure(context, Constraints(0f, inner.width, 0f, Float.POSITIVE_INFINITY))
            }
        }
        val fixedHeight = measured.filterNotNull().sumOf { it.height.toDouble() }.toFloat()
        val totalWeight = childrenList.filterIsInstance<Expanded>().sumOf { it.weight.toDouble() }.toFloat()
        val freeHeight = (inner.height - totalGap - fixedHeight).coerceAtLeast(0f)
        val expandedHeight = if (totalWeight > 0f) freeHeight else 0f
        val contentHeight = fixedHeight + totalGap + expandedHeight
        var y = inner.y
        if (justify != Justify.Start && contentHeight < inner.height) {
            when (justify) {
                Justify.Center -> y += (inner.height - contentHeight) / 2f
                Justify.End -> y += inner.height - contentHeight
                else -> Unit
            }
        }
        val nodes = childrenList.mapIndexed { index, child ->
            val measuredSize = measured[index]
            val height = when {
                child is Expanded -> expandedHeight * child.weight / totalWeight.coerceAtLeast(1f)
                else -> measuredSize?.height ?: 0f
            }
            val width = when {
                align == Align.Stretch -> inner.width
                else -> measuredSize?.width?.coerceAtMost(inner.width) ?: inner.width
            }
            val x = inner.x + when (align) {
                Align.Center -> (inner.width - width) / 2f
                Align.End -> inner.width - width
                else -> 0f
            }
            val node = child.build(context, Rect(x, y, width, height))
            y += height
            if (index < childrenList.lastIndex) {
                y += if (justify == Justify.SpaceBetween && childrenList.size > 1) {
                    maxOf(gap, (inner.height - fixedHeight) / (childrenList.size - 1))
                } else {
                    gap
                }
            }
            node
        }
        return RenderNode(this, bounds, nodes)
    }

    private fun insetsHorizontal(): Float = padding * 2f

    private fun insetsVertical(): Float = padding * 2f
}

class RowScope internal constructor()

class Row(
    val gap: Float = 0f,
    val padding: Float = 0f,
    val align: Align = Align.Center,
    val justify: Justify = Justify.Start,
    val fillWidth: Boolean = true,
    val fillHeight: Boolean = false,
    val wrap: Boolean = false,
    val background: ((Theme) -> Color)? = null,
    content: RowScope.() -> Unit,
) : Widget() {
    val children: List<Widget> = collectWidgets { RowScope().content() }

    constructor(
        gap: Float = 0f,
        padding: Float = 0f,
        align: Align = Align.Center,
        justify: Justify = Justify.Start,
        fillWidth: Boolean = true,
        fillHeight: Boolean = false,
        wrap: Boolean = false,
        background: ((Theme) -> Color)? = null,
        children: List<Widget>,
    ) : this(gap, padding, align, justify, fillWidth, fillHeight, wrap, background, {}) {
        childrenOverride = children
    }

    private var childrenOverride: List<Widget>? = null

    private fun actualChildren(): List<Widget> = childrenOverride ?: children

    private data class WrapEntry(val widget: Widget, val size: Size)

    private data class WrapLine(val entries: List<WrapEntry>, val width: Float, val height: Float)

    private fun wrapLines(context: BuildContext, innerWidth: Float): List<WrapLine> {
        val lines = mutableListOf<WrapLine>()
        var current = mutableListOf<WrapEntry>()
        var currentWidth = 0f
        var currentHeight = 0f
        actualChildren().forEach { child ->
            val size = child.measure(context, Constraints(0f, innerWidth, 0f, Float.POSITIVE_INFINITY))
            val needed = if (current.isEmpty()) size.width else currentWidth + gap + size.width
            if (current.isNotEmpty() && needed > innerWidth) {
                lines.add(WrapLine(current.toList(), currentWidth, currentHeight))
                current = mutableListOf()
                currentWidth = 0f
                currentHeight = 0f
            }
            currentWidth += if (current.isEmpty()) size.width else gap + size.width
            currentHeight = maxOf(currentHeight, size.height)
            current.add(WrapEntry(child, size))
        }
        if (current.isNotEmpty()) lines.add(WrapLine(current.toList(), currentWidth, currentHeight))
        return lines
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val innerWidth = (constraints.maxWidth - padding * 2f).coerceAtLeast(0f)
        if (wrap) {
            val lines = wrapLines(context, innerWidth)
            val contentWidth = lines.maxOfOrNull { it.width } ?: 0f
            val contentHeight = lines.sumOf { it.height.toDouble() }.toFloat() +
                gap * (lines.size - 1).coerceAtLeast(0)
            val width = when {
                fillWidth && constraints.maxWidth.isFinite() -> constraints.maxWidth
                else -> contentWidth + padding * 2f
            }
            val height = when {
                fillHeight && constraints.maxHeight.isFinite() -> constraints.maxHeight
                else -> contentHeight + padding * 2f
            }
            return constraints.constrain(Size(width, height))
        }
        val totalGap = gap * (actualChildren().size - 1).coerceAtLeast(0)
        var fixedWidth = 0f
        var maxHeight = 0f
        var totalWeight = 0f
        actualChildren().forEach { child ->
            if (child is Expanded) {
                totalWeight += child.weight
            } else {
                val size = child.measure(context, Constraints(0f, innerWidth, 0f, Float.POSITIVE_INFINITY))
                fixedWidth += size.width
                maxHeight = maxOf(maxHeight, size.height)
            }
        }
        val width = when {
            fillWidth && constraints.maxWidth.isFinite() -> constraints.maxWidth
            else -> fixedWidth + totalGap + padding * 2f
        }
        if (totalWeight > 0f) {
            val freeWidth = (innerWidth - totalGap - fixedWidth).coerceAtLeast(0f)
            val expandedWidth = freeWidth / totalWeight
            actualChildren().filterIsInstance<Expanded>().forEach { child ->
                val size = child.content.measure(
                    context,
                    Constraints(expandedWidth, expandedWidth, 0f, Float.POSITIVE_INFINITY),
                )
                maxHeight = maxOf(maxHeight, size.height)
            }
        }
        val height = when {
            fillHeight && constraints.maxHeight.isFinite() -> constraints.maxHeight
            else -> maxHeight + padding * 2f
        }
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val inner = Rect(
            bounds.x + padding,
            bounds.y + padding,
            (bounds.width - padding * 2f).coerceAtLeast(0f),
            (bounds.height - padding * 2f).coerceAtLeast(0f),
        )
        if (wrap) {
            val lines = wrapLines(context, inner.width)
            var y = inner.y
            val nodes = mutableListOf<RenderNode>()
            lines.forEach { line ->
                var x = inner.x + when (justify) {
                    Justify.Center -> (inner.width - line.width) / 2f
                    Justify.End -> inner.width - line.width
                    else -> 0f
                }
                line.entries.forEach { entry ->
                    val height = when (align) {
                        Align.Stretch -> line.height
                        else -> entry.size.height
                    }
                    val offsetY = when (align) {
                        Align.Center -> (line.height - height) / 2f
                        Align.End -> line.height - height
                        else -> 0f
                    }
                    nodes.add(entry.widget.build(context, Rect(x, y + offsetY, entry.size.width, height)))
                    x += entry.size.width + gap
                }
                y += line.height + gap
            }
            return RenderNode(this, bounds, nodes)
        }
        val childrenList = actualChildren()
        val measured = childrenList.map { child ->
            if (child is Expanded) null
            else child.measure(context, Constraints(0f, inner.width, 0f, Float.POSITIVE_INFINITY))
        }
        val fixedWidth = measured.filterNotNull().sumOf { it.width.toDouble() }.toFloat()
        val totalGap = gap * (childrenList.size - 1).coerceAtLeast(0)
        val totalWeight = childrenList.filterIsInstance<Expanded>().sumOf { it.weight.toDouble() }.toFloat()
        val freeWidth = (inner.width - totalGap - fixedWidth).coerceAtLeast(0f)
        val expandedWidth = if (totalWeight > 0f) freeWidth else 0f
        val contentWidth = fixedWidth + totalGap + expandedWidth
        var x = inner.x
        if (justify != Justify.Start && contentWidth < inner.width) {
            when (justify) {
                Justify.Center -> x += (inner.width - contentWidth) / 2f
                Justify.End -> x += inner.width - contentWidth
                else -> Unit
            }
        }
        val nodes = childrenList.mapIndexed { index, child ->
            val measuredSize = measured[index]
            val width = when {
                child is Expanded -> expandedWidth * child.weight / totalWeight.coerceAtLeast(1f)
                else -> measuredSize?.width ?: 0f
            }
            val height = when {
                align == Align.Stretch -> inner.height
                else -> measuredSize?.height?.coerceAtMost(inner.height) ?: inner.height
            }
            val y = inner.y + when (align) {
                Align.Center -> (inner.height - height) / 2f
                Align.End -> inner.height - height
                else -> 0f
            }
            val node = child.build(context, Rect(x, y, width, height))
            x += width
            if (justify == Justify.SpaceBetween && childrenList.size > 1) {
                x += (inner.width - contentWidth) / (childrenList.size - 1)
            } else if (index < childrenList.lastIndex) {
                x += gap
            }
            node
        }
        return RenderNode(this, bounds, nodes)
    }
}

class Stack(
    val padding: Float = 0f,
    val align: Align = Align.Center,
    val verticalAlign: Align = Align.Center,
    val fillWidth: Boolean = true,
    val fillHeight: Boolean = false,
    val background: ((Theme) -> Color)? = null,
    content: BoxScope.() -> Unit,
) : Widget() {
    val children: List<Widget> = collectWidgets { BoxScope().content() }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val innerWidth = (constraints.maxWidth - padding * 2f).coerceAtLeast(0f)
        val innerHeight = (constraints.maxHeight - padding * 2f).coerceAtLeast(0f)
        val sizes = children.map { it.measure(context, Constraints(0f, innerWidth, 0f, innerHeight)) }
        val width = if (fillWidth && constraints.maxWidth.isFinite()) constraints.maxWidth
        else (sizes.maxOfOrNull { it.width } ?: 0f) + padding * 2f
        val height = if (fillHeight && constraints.maxHeight.isFinite()) constraints.maxHeight
        else (sizes.maxOfOrNull { it.height } ?: 0f) + padding * 2f
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val inner = Rect(
            bounds.x + padding,
            bounds.y + padding,
            (bounds.width - padding * 2f).coerceAtLeast(0f),
            (bounds.height - padding * 2f).coerceAtLeast(0f),
        )
        val nodes = children.map { child ->
            val size = child.measure(context, Constraints(0f, inner.width, 0f, inner.height))
            val width = if (align == Align.Stretch) inner.width else size.width.coerceAtMost(inner.width)
            val height = if (verticalAlign == Align.Stretch) inner.height else size.height.coerceAtMost(inner.height)
            val x = inner.x + when (align) {
                Align.Center -> (inner.width - width) / 2f
                Align.End -> inner.width - width
                else -> 0f
            }
            val y = inner.y + when (verticalAlign) {
                Align.Center -> (inner.height - height) / 2f
                Align.End -> inner.height - height
                else -> 0f
            }
            child.build(context, Rect(x, y, width, height))
        }
        return RenderNode(this, bounds, nodes)
    }
}

class GridScope internal constructor()

class Grid(
    val columns: ResponsiveValue<Int>,
    val gap: Float = 16f,
    val padding: Float = 0f,
    val fillWidth: Boolean = true,
    val background: ((Theme) -> Color)? = null,
    content: GridScope.() -> Unit,
) : Widget() {
    constructor(
        columns: Int,
        gap: Float = 16f,
        padding: Float = 0f,
        fillWidth: Boolean = true,
        background: ((Theme) -> Color)? = null,
        content: GridScope.() -> Unit,
    ) : this(
        dev.ivlev.silent.ui.responsive.responsive(columns),
        gap,
        padding,
        fillWidth,
        background,
        content,
    )

    val children: List<Widget> = collectWidgets { GridScope().content() }

    private fun columnCount(context: BuildContext): Int =
        columns.resolve(context.viewportWidth).coerceAtLeast(1)

    private fun cellWidth(innerWidth: Float, count: Int): Float =
        (innerWidth - gap * (count - 1)).coerceAtLeast(0f) / count.toFloat()

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val count = columnCount(context)
        val innerWidth = (constraints.maxWidth - padding * 2f).coerceAtLeast(0f)
        val width = if (fillWidth && constraints.maxWidth.isFinite()) constraints.maxWidth
        else innerWidth + padding * 2f
        val cell = cellWidth(innerWidth, count)
        val rows = children.chunked(count)
        var height = padding * 2f
        rows.forEachIndexed { rowIndex, row ->
            val rowHeight = row.maxOfOrNull { child ->
                child.measure(context, Constraints(0f, cell, 0f, Float.POSITIVE_INFINITY)).height
            } ?: 0f
            height += rowHeight
            if (rowIndex < rows.lastIndex) height += gap
        }
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val count = columnCount(context)
        val inner = Rect(
            bounds.x + padding,
            bounds.y + padding,
            (bounds.width - padding * 2f).coerceAtLeast(0f),
            (bounds.height - padding * 2f).coerceAtLeast(0f),
        )
        val cell = cellWidth(inner.width, count)
        val rows = children.chunked(count)
        var y = inner.y
        val nodes = mutableListOf<RenderNode>()
        rows.forEachIndexed { rowIndex, row ->
            val sizes = row.map { child ->
                child.measure(context, Constraints(0f, cell, 0f, Float.POSITIVE_INFINITY))
            }
            val rowHeight = sizes.maxOfOrNull { it.height } ?: 0f
            row.forEachIndexed { columnIndex, child ->
                val x = inner.x + columnIndex * (cell + gap)
                nodes.add(child.build(context, Rect(x, y, cell, rowHeight)))
            }
            y += rowHeight
            if (rowIndex < rows.lastIndex) y += gap
        }
        return RenderNode(this, bounds, nodes)
    }
}

class ScrollState {
    val offset: MutableSignal<Float> = MutableSignal(0f)
    var maxOffset: Float = 0f
        private set

    fun scrollBy(delta: Float) {
        offset.set((offset.value + delta).coerceIn(0f, maxOffset))
    }

    fun scrollTo(value: Float) {
        offset.set(value.coerceIn(0f, maxOffset))
    }

    internal fun updateBounds(contentHeight: Float, viewportHeight: Float) {
        maxOffset = (contentHeight - viewportHeight).coerceAtLeast(0f)
        if (offset.value > maxOffset) offset.set(maxOffset)
    }
}

class Scroll(
    val state: ScrollState = ScrollState(),
    val fillWidth: Boolean = true,
    content: () -> Widget,
) : Widget() {
    val child: Widget = isolateWidgets { content() }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val contentSize = child.measure(
            context,
            Constraints(0f, constraints.maxWidth, 0f, Float.POSITIVE_INFINITY),
        )
        val width = if (fillWidth && constraints.maxWidth.isFinite()) constraints.maxWidth else contentSize.width
        val height = if (constraints.maxHeight.isFinite()) {
            constraints.maxHeight
        } else {
            contentSize.height
        }
        state.updateBounds(contentSize.height, height)
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val contentSize = child.measure(
            context,
            Constraints(0f, bounds.width, 0f, Float.POSITIVE_INFINITY),
        )
        state.updateBounds(contentSize.height, bounds.height)
        val node = child.build(
            context,
            Rect(bounds.x, bounds.y - state.offset.value, bounds.width, contentSize.height),
        )
        return RenderNode(this, bounds, listOf(node))
    }
}

class ScreenScope internal constructor()

class Screen(
    val background: ((Theme) -> Color)? = { it.colors.background },
    content: ScreenScope.() -> Unit,
) : Widget() {
    val children: List<Widget> = collectWidgets { ScreenScope().content() }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 0f
        val height = if (constraints.maxHeight.isFinite()) constraints.maxHeight else 0f
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val nodes = children.map { child ->
            val size = child.measure(context, Constraints(0f, bounds.width, 0f, bounds.height))
            val height = maxOf(size.height, if (bounds.height > 0f) bounds.height else size.height)
            child.build(context, Rect(bounds.x, bounds.y, bounds.width, height))
        }
        return RenderNode(this, bounds, nodes)
    }
}

fun screen(background: ((Theme) -> Color)? = { it.colors.background }, content: ScreenScope.() -> Unit): Widget =
    Screen(background, content)

fun column(
    gap: Float = 0f,
    padding: Float = 0f,
    align: Align = Align.Stretch,
    fillWidth: Boolean = true,
    fillHeight: Boolean = false,
    content: ColumnScope.() -> Unit,
): Column = Column(gap, padding, align, Justify.Start, fillWidth, fillHeight, null, content)

fun row(
    gap: Float = 0f,
    padding: Float = 0f,
    align: Align = Align.Center,
    fillWidth: Boolean = true,
    fillHeight: Boolean = false,
    content: RowScope.() -> Unit,
): Row = Row(gap, padding, align, Justify.Start, fillWidth, fillHeight, false, null, content)


class ContentPage(
    val maxWidth: Float = 1440f,
    val compactPadding: Float = 16f,
    val widePadding: Float = 32f,
    val wideThreshold: Float = 840f,
    val verticalPadding: Float = 24f,
    content: () -> Widget,
) : Widget() {
    private val child: Widget = isolateWidgets { content() }

    private fun horizontalPadding(context: BuildContext): Float =
        if (context.viewportWidth >= wideThreshold) widePadding else compactPadding

    private fun pageWidth(constraints: Constraints): Float =
        if (constraints.maxWidth.isFinite()) minOf(constraints.maxWidth, maxWidth) else maxWidth

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = pageWidth(constraints)
        val padding = horizontalPadding(context)
        val innerWidth = (width - padding * 2f).coerceAtLeast(0f)
        val size = child.measure(
            context,
            Constraints(0f, innerWidth, 0f, Float.POSITIVE_INFINITY),
        )
        val height = size.height + verticalPadding * 2f
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val width = minOf(bounds.width, maxWidth)
        val x = bounds.x + (bounds.width - width) / 2f
        val padding = horizontalPadding(context)
        val inner = Rect(
            x + padding,
            bounds.y + verticalPadding,
            (width - padding * 2f).coerceAtLeast(0f),
            (bounds.height - verticalPadding * 2f).coerceAtLeast(0f),
        )
        val size = child.measure(
            context,
            Constraints(0f, inner.width, 0f, Float.POSITIVE_INFINITY),
        )
        return RenderNode(
            this,
            bounds,
            listOf(child.build(context, Rect(inner.x, inner.y, inner.width, size.height))),
        )
    }
}

fun contentPage(
    maxWidth: Float = 1440f,
    compactPadding: Float = 16f,
    widePadding: Float = 32f,
    verticalPadding: Float = 24f,
    content: () -> Widget,
): ContentPage = ContentPage(maxWidth, compactPadding, widePadding, verticalPadding = verticalPadding, content = content)
