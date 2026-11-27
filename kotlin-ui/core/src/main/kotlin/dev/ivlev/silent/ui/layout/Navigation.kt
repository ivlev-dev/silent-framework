package dev.ivlev.silent.ui.layout

import dev.ivlev.silent.ui.responsive.Breakpoint
import dev.ivlev.silent.ui.tokens.Control
import dev.ivlev.silent.ui.tokens.Spacing

data class NavItem(
    val id: String,
    val label: String,
    val icon: String = "",
)

class NavItemWidget(
    val item: NavItem,
    val selected: Boolean,
    val vertical: Boolean,
    val showLabel: Boolean = true,
    val onSelect: (String) -> Unit,
) : Widget(), ClickTarget {
    override val acceptsInput: Boolean
        get() = true

    override fun activate() {
        click()
    }

    override fun click() {
        onSelect(item.id)
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val height = if (vertical) 48f else 56f
        return constraints.constrain(Size(constraints.maxWidth.coerceAtLeast(0f), height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class NavigationRail(
    val items: List<NavItem>,
    val selectedId: () -> String,
    val onSelect: (String) -> Unit,
    val expanded: Boolean = true,
    val width: Float = if (expanded) 260f else 80f,
    val brand: String = "Silent UI",
) : Widget() {
    private val itemWidgets: List<NavItemWidget> = isolateWidgets {
        items.map { item ->
            NavItemWidget(item, item.id == selectedId(), vertical = true, showLabel = expanded, onSelect = onSelect)
        }
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val height = if (constraints.maxHeight.isFinite()) constraints.maxHeight else 640f
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val header = if (expanded) 72f else 64f
        val nodes = itemWidgets.mapIndexed { index, widget ->
            val itemHeight = 48f
            widget.build(
                context,
                Rect(
                    bounds.x + 12f,
                    bounds.y + header + index * (itemHeight + 4f),
                    (bounds.width - 24f).coerceAtLeast(0f),
                    itemHeight,
                ),
            )
        }
        return RenderNode(this, bounds, nodes)
    }
}

class NavigationBar(
    val items: List<NavItem>,
    val selectedId: () -> String,
    val onSelect: (String) -> Unit,
    val height: Float = 68f,
) : Widget() {
    private val itemWidgets: List<NavItemWidget> = isolateWidgets {
        items.map { item ->
            NavItemWidget(item, item.id == selectedId(), vertical = false, onSelect = onSelect)
        }
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val count = itemWidgets.size.coerceAtLeast(1)
        val itemWidth = bounds.width / count
        val nodes = itemWidgets.mapIndexed { index, widget ->
            widget.build(
                context,
                Rect(bounds.x + index * itemWidth, bounds.y, itemWidth, bounds.height),
            )
        }
        return RenderNode(this, bounds, nodes)
    }
}

class AdaptiveScaffold(
    val items: List<NavItem>,
    val selectedId: () -> String,
    val onSelect: (String) -> Unit,
    val content: Widget,
    val railWidth: Float = 260f,
    val barHeight: Float = 68f,
) : Widget() {
    private val rail: NavigationRail = isolateWidgets {
        NavigationRail(items, selectedId, onSelect, expanded = true, width = railWidth)
    }
    private val bar: NavigationBar = isolateWidgets {
        NavigationBar(items, selectedId, onSelect, height = barHeight)
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 800f
        val height = if (constraints.maxHeight.isFinite()) constraints.maxHeight else 720f
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val wide = context.viewportWidth >= Breakpoint.XL.minWidth
        val nodes = mutableListOf<RenderNode>()
        if (wide) {
            val railNode = rail.build(context, Rect(bounds.x, bounds.y, railWidth, bounds.height))
            val contentBounds = Rect(
                bounds.x + railWidth,
                bounds.y,
                (bounds.width - railWidth).coerceAtLeast(0f),
                bounds.height,
            )
            val contentNode = content.build(context, contentBounds)
            nodes.add(railNode)
            nodes.add(contentNode)
        } else {
            val contentBounds = Rect(
                bounds.x,
                bounds.y,
                bounds.width,
                (bounds.height - barHeight).coerceAtLeast(0f),
            )
            val contentNode = content.build(context, contentBounds)
            val barNode = bar.build(
                context,
                Rect(bounds.x, bounds.y + bounds.height - barHeight, bounds.width, barHeight),
            )
            nodes.add(contentNode)
            nodes.add(barNode)
        }
        return RenderNode(this, bounds, nodes)
    }
}

fun adaptiveScaffold(
    items: List<NavItem>,
    selectedId: () -> String,
    onSelect: (String) -> Unit,
    railWidth: Float = 232f,
    barHeight: Float = Control.heightLg + Spacing.x5,
    content: () -> Widget,
): AdaptiveScaffold = AdaptiveScaffold(
    items = items,
    selectedId = selectedId,
    onSelect = onSelect,
    content = isolateWidgets { content() },
    railWidth = railWidth,
    barHeight = barHeight,
)

class ResponsiveContent(
    val threshold: Float = Breakpoint.XL.minWidth,
    private val narrow: () -> Widget,
    private val wide: () -> Widget,
) : Widget() {
    private fun selected(context: BuildContext): Widget =
        if (context.viewportWidth >= threshold) isolateWidgets(wide) else isolateWidgets(narrow)

    override fun measure(context: BuildContext, constraints: Constraints): Size =
        selected(context).measure(context, constraints)

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        selected(context).build(context, bounds)
}

fun adaptiveContent(
    threshold: Float = Breakpoint.XL.minWidth,
    narrow: () -> Widget,
    wide: () -> Widget,
): ResponsiveContent = ResponsiveContent(threshold, narrow, wide)
