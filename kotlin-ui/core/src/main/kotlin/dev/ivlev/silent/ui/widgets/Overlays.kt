package dev.ivlev.silent.ui.widgets

import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.Constraints
import dev.ivlev.silent.ui.layout.HitRegion
import dev.ivlev.silent.ui.layout.Rect
import dev.ivlev.silent.ui.layout.RenderNode
import dev.ivlev.silent.ui.layout.Size
import dev.ivlev.silent.ui.layout.Widget
import dev.ivlev.silent.ui.layout.Row
import dev.ivlev.silent.ui.layout.isolateWidgets
import dev.ivlev.silent.ui.tokens.Spacing
import dev.ivlev.silent.ui.tokens.Tone
import dev.ivlev.silent.ui.tokens.Typography

enum class DialogSize {
    Small,
    Medium,
    Large,
}

class Dialog(
    val open: Boolean = true,
    val title: String,
    val description: String? = null,
    val size: DialogSize = DialogSize.Medium,
    val modal: Boolean = true,
    val fill: Boolean = false,
    val showClose: Boolean = true,
    val onClose: () -> Unit = {},
    val content: (() -> Widget)? = null,
    val actions: (() -> Widget)? = null,
) : Widget() {
    private val contentWidget: Widget? = content?.let { isolateWidgets(it) }
    private val actionsWidget: Widget? = actions?.let { isolateWidgets(it) }

    val panelWidth: Float
        get() = when (size) {
            DialogSize.Small -> 360f
            DialogSize.Medium -> 480f
            DialogSize.Large -> 720f
        }

    fun panelHeight(context: BuildContext, width: Float): Float {
        val contentHeight = contentWidget?.measure(
            context,
            Constraints(0f, (width - 48f).coerceAtLeast(0f), 0f, Float.POSITIVE_INFINITY),
        )?.height ?: 0f
        val actionsHeight = actionsWidget?.measure(
            context,
            Constraints(0f, (width - 48f).coerceAtLeast(0f), 0f, 80f),
        )?.height ?: 0f
        return 84f + (if (description != null) 24f else 0f) +
            contentHeight + (if (actionsWidget != null) actionsHeight + Spacing.x4 else 0f)
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        if (fill) {
            val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 800f
            val height = if (constraints.maxHeight.isFinite()) constraints.maxHeight else 600f
            return constraints.constrain(Size(width, height))
        }
        val width = minOf(panelWidth, if (constraints.maxWidth.isFinite()) constraints.maxWidth else panelWidth)
        return constraints.constrain(Size(width, panelHeight(context, width)))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val nodes = mutableListOf<RenderNode>()
        if (modal) {
            nodes.add(HitRegion(onClick = onClose).build(context, bounds))
        }
        val width = minOf(panelWidth, bounds.width)
        val height = if (fill) minOf(bounds.height - 48f, 560f) else panelHeight(context, width)
        val panel = Rect(
            bounds.x + (bounds.width - width) / 2f,
            bounds.y + (bounds.height - height) / 2f,
            width,
            height,
        )
        if (showClose) {
            nodes.add(HitRegion(onClick = onClose).build(
                context,
                Rect(panel.right - 48f, panel.y + 8f, 40f, 40f),
            ))
        }
        var y = panel.y + 72f
        contentWidget?.let { widget ->
            val size = widget.measure(context, Constraints(0f, panel.width - 48f, 0f, Float.POSITIVE_INFINITY))
            nodes.add(widget.build(context, Rect(panel.x + 24f, y, panel.width - 48f, size.height)))
            y += size.height + Spacing.x4
        }
        actionsWidget?.let { widget ->
            val size = widget.measure(context, Constraints(0f, panel.width - 48f, 0f, 80f))
            nodes.add(
                widget.build(
                    context,
                    Rect(panel.right - 24f - size.width, panel.bottom - 24f - size.height, size.width, size.height),
                ),
            )
        }
        return RenderNode(this, bounds, nodes)
    }
}

class AlertDialog(
    val open: Boolean = true,
    val title: String,
    val description: String,
    val tone: Tone = Tone.Warning,
    val confirmLabel: String = "Продолжить",
    val cancelLabel: String = "Отмена",
    val modal: Boolean = true,
    val onConfirm: () -> Unit = {},
    val onClose: () -> Unit = {},
) : Widget() {
    private val dialog = Dialog(
        open = open,
        title = title,
        description = description,
        size = DialogSize.Small,
        showClose = false,
        modal = modal,
        onClose = onClose,
        actions = {
            Row(gap = Spacing.x2, fillWidth = false) {
                Button(cancelLabel, variant = ButtonVariant.Text, onClick = onClose)
                Button(confirmLabel, variant = ButtonVariant.Primary, onClick = onConfirm)
            }
        },
    )

    override fun measure(context: BuildContext, constraints: Constraints): Size =
        dialog.measure(context, constraints)

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, listOf(dialog.build(context, bounds)))
}

enum class DrawerSide {
    Start,
    End,
}

class Drawer(
    val open: Boolean,
    val side: DrawerSide = DrawerSide.Start,
    val modal: Boolean = true,
    val width: Float = 300f,
    val title: String? = null,
    val onClose: () -> Unit = {},
    val content: (() -> Widget)? = null,
    val footer: (() -> Widget)? = null,
) : Widget() {
    private val contentWidget: Widget? = content?.let { isolateWidgets(it) }
    private val footerWidget: Widget? = footer?.let { isolateWidgets(it) }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        if (!open) return Size.Zero
        val fullWidth = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 800f
        val fullHeight = if (constraints.maxHeight.isFinite()) constraints.maxHeight else 600f
        return constraints.constrain(Size(fullWidth, fullHeight))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        if (!open) return RenderNode(this, bounds, emptyList())
        val nodes = mutableListOf<RenderNode>()
        if (modal) nodes.add(HitRegion(onClick = onClose).build(context, bounds))
        val panelWidth = minOf(width, bounds.width)
        val panelX = if (side == DrawerSide.Start) bounds.x else bounds.right - panelWidth
        val panel = Rect(panelX, bounds.y, panelWidth, bounds.height)
        nodes.add(HitRegion(onClick = onClose).build(context, Rect(panel.right - 44f, panel.y + 12f, 32f, 32f)))
        contentWidget?.let { widget ->
            val size = widget.measure(
                context,
                Constraints(0f, panel.width - 32f, 0f, Float.POSITIVE_INFINITY),
            )
            nodes.add(
                widget.build(
                    context,
                    Rect(panel.x + 16f, panel.y + 68f, panel.width - 32f, size.height),
                ),
            )
        }
        footerWidget?.let { widget ->
            val size = widget.measure(context, Constraints(0f, panel.width - 32f, 0f, 80f))
            nodes.add(
                widget.build(
                    context,
                    Rect(panel.x + 16f, panel.bottom - 16f - size.height, panel.width - 32f, size.height),
                ),
            )
        }
        return RenderNode(this, bounds, nodes)
    }
}

enum class SheetSide {
    Top,
    Right,
    Bottom,
    Left,
}

class Sheet(
    val open: Boolean = true,
    val side: SheetSide = SheetSide.Bottom,
    val title: String,
    val description: String? = null,
    val modal: Boolean = true,
    val onClose: () -> Unit = {},
    val content: (() -> Widget)? = null,
) : Widget() {
    private val contentWidget: Widget? = content?.let { isolateWidgets(it) }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        if (!open) return Size.Zero
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 480f
        val height = if (constraints.maxHeight.isFinite()) constraints.maxHeight else 400f
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        if (!open) return RenderNode(this, bounds, emptyList())
        val nodes = mutableListOf<RenderNode>()
        if (modal) nodes.add(HitRegion(onClick = onClose).build(context, bounds))
        val panel = when (side) {
            SheetSide.Bottom -> Rect(bounds.x, bounds.bottom - minOf(320f, bounds.height), bounds.width, minOf(320f, bounds.height))
            SheetSide.Top -> Rect(bounds.x, bounds.y, bounds.width, minOf(320f, bounds.height))
            SheetSide.Right -> Rect(bounds.right - minOf(400f, bounds.width), bounds.y, minOf(400f, bounds.width), bounds.height)
            SheetSide.Left -> Rect(bounds.x, bounds.y, minOf(400f, bounds.width), bounds.height)
        }
        nodes.add(HitRegion(onClick = onClose).build(context, Rect(panel.right - 44f, panel.y + 12f, 32f, 32f)))
        contentWidget?.let { widget ->
            val size = widget.measure(context, Constraints(0f, panel.width - 32f, 0f, Float.POSITIVE_INFINITY))
            nodes.add(widget.build(context, Rect(panel.x + 16f, panel.y + 72f, panel.width - 32f, size.height)))
        }
        return RenderNode(this, bounds, nodes)
    }
}

class Popover(
    val open: Boolean = true,
    val width: Float = 260f,
    val title: String? = null,
    val onClose: () -> Unit = {},
    val content: (() -> Widget)? = null,
) : Widget() {
    private val contentWidget: Widget? = content?.let { isolateWidgets(it) }
    private val height: Float = 120f

    override fun measure(context: BuildContext, constraints: Constraints): Size =
        constraints.constrain(Size(minOf(width, constraints.maxWidth), if (open) height else 0f))

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        if (!open) return RenderNode(this, bounds, emptyList())
        val nodes = mutableListOf<RenderNode>()
        nodes.add(HitRegion(onClick = onClose).build(context, Rect(bounds.right - 36f, bounds.y + 8f, 24f, 24f)))
        contentWidget?.let { widget ->
            val size = widget.measure(context, Constraints(0f, bounds.width - 32f, 0f, Float.POSITIVE_INFINITY))
            nodes.add(widget.build(context, Rect(bounds.x + 16f, bounds.y + 48f, bounds.width - 32f, size.height)))
        }
        return RenderNode(this, bounds, nodes)
    }
}

class Menu(
    val items: List<String>,
    val open: Boolean = true,
    val selected: Int = -1,
    val disabled: Set<Int> = emptySet(),
    val onSelect: (Int) -> Unit = {},
    val label: String? = null,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 240f
        return constraints.constrain(Size(width, if (open) items.size * 40f + 16f else 0f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        if (!open) return RenderNode(this, bounds, emptyList())
        val nodes = items.mapIndexed { index, _ ->
            HitRegion(
                onClick = { onSelect(index) },
                enabled = index !in disabled,
            ).build(context, Rect(bounds.x, bounds.y + 8f + index * 40f, bounds.width, 40f))
        }
        return RenderNode(this, bounds, nodes)
    }
}

class Tooltip(
    val text: String,
    val visible: Boolean = true,
    val placement: String = "top",
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        if (!visible) return Size.Zero
        val width = context.textMeasurer.width(text, Typography.bodySmall) + 20f
        return constraints.constrain(Size(width, 32f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class Snackbar(
    val open: Boolean = true,
    val message: String,
    val actionLabel: String? = "Отменить",
    val tone: Tone = Tone.Neutral,
    val onAction: () -> Unit = {},
    val onClose: () -> Unit = {},
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 480f
        return constraints.constrain(Size(width, if (open) 56f else 0f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        if (!open) return RenderNode(this, bounds, emptyList())
        val nodes = mutableListOf<RenderNode>()
        if (actionLabel != null) {
            nodes.add(HitRegion(onClick = onAction).build(
                context,
                Rect(bounds.right - 120f, bounds.y, 72f, bounds.height),
            ))
        }
        nodes.add(HitRegion(onClick = onClose).build(
            context,
            Rect(bounds.right - 40f, bounds.y, 40f, bounds.height),
        ))
        return RenderNode(this, bounds, nodes)
    }
}
