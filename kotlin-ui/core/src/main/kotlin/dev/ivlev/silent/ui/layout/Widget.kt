package dev.ivlev.silent.ui.layout

import dev.ivlev.silent.ui.widgets.TextField

abstract class Widget {
    init {
        WidgetScope.register(this)
    }

    abstract fun measure(context: BuildContext, constraints: Constraints): Size

    open fun build(context: BuildContext, bounds: Rect): RenderNode {
        measure(context, Constraints.tight(bounds.width, bounds.height))
        return RenderNode(this, bounds, emptyList())
    }
}

data class RenderNode(
    val widget: Widget,
    val bounds: Rect,
    val children: List<RenderNode>,
)

internal object WidgetScope {
    private val stack: ThreadLocal<ArrayDeque<MutableList<Widget>>> = ThreadLocal.withInitial { ArrayDeque() }

    fun register(widget: Widget) {
        stack.get().lastOrNull()?.add(widget)
    }

    fun collect(block: () -> Unit): List<Widget> {
        val target = mutableListOf<Widget>()
        stack.get().addLast(target)
        return try {
            block()
            target
        } finally {
            stack.get().removeLast()
        }
    }

    fun <T> isolate(block: () -> T): T {
        val target = mutableListOf<Widget>()
        stack.get().addLast(target)
        return try {
            block()
        } finally {
            stack.get().removeLast()
        }
    }
}

fun collectWidgets(block: () -> Unit): List<Widget> = WidgetScope.collect(block)

fun <T> isolateWidgets(block: () -> T): T = WidgetScope.isolate(block)

class Spacer(val width: Float = 0f, val height: Float = 0f) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size =
        constraints.constrain(Size(width, height))
}

class Expanded internal constructor(
    val weight: Float,
    val content: Widget,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size =
        content.measure(context, constraints)

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, listOf(content.build(context, bounds)))
}

fun expanded(weight: Float = 1f, content: () -> Widget): Expanded {
    require(weight > 0f) { "weight должен быть больше 0" }
    val child = isolateWidgets { content() }
    return Expanded(weight, child)
}

fun layoutRoot(
    widget: Widget,
    context: BuildContext,
    width: Float,
    height: Float,
): RenderNode {
    val constraints = Constraints(0f, width, 0f, height)
    val size = widget.measure(context, constraints)
    val bounds = Rect(0f, 0f, width, maxOf(size.height, height))
    return widget.build(context, bounds)
}

data class HitResult(
    val target: HitTarget,
    val path: List<Int>,
    val bounds: Rect,
)

enum class UiCursor {
    Default,
    Pointer,
    Text,
    Grab,
    Grabbing,
    ColResize,
}

class HitTester {
    fun hit(root: RenderNode, x: Float, y: Float): HitTarget? = hitResult(root, x, y)?.target

    fun hitResult(root: RenderNode, x: Float, y: Float): HitResult? {
        if (!root.bounds.contains(x, y)) return null
        val path = mutableListOf<Int>()
        return hitAt(root, x, y, path)
    }

    private fun hitAt(node: RenderNode, x: Float, y: Float, path: MutableList<Int>): HitResult? {
        if (!node.bounds.contains(x, y)) return null
        node.children.forEachIndexed { index, child ->
            path.add(index)
            val result = hitAt(child, x, y, path)
            if (result != null) return result
            path.removeAt(path.lastIndex)
        }
        val target = (node.widget as? HitTarget)?.takeIf { it.acceptsInput }
        return target?.let { HitResult(it, path.toList(), node.bounds) }
    }

    fun hitTextField(root: RenderNode, x: Float, y: Float): TextField? =
        hit(root, x, y) as? TextField
}

interface HitTarget {
    val acceptsInput: Boolean
    val cursor: UiCursor
        get() = UiCursor.Default
    fun cursorAt(x: Float, y: Float): UiCursor = cursor
    fun hoverBoundsAt(x: Float, y: Float, bounds: Rect): Rect = bounds
    fun activate()
    fun activateAt(x: Float, y: Float) = activate()
    fun secondaryActivate() = Unit
    fun dragStartAt(x: Float, y: Float) = Unit
    fun dragMoveTo(x: Float, y: Float) = Unit
    fun dragEndAt(x: Float, y: Float) = Unit
    fun doubleClickAt(x: Float, y: Float) = Unit
}

interface ClickTarget : HitTarget {
    override val cursor: UiCursor
        get() = UiCursor.Pointer
    fun click()
}

class HitRegion(
    private val onClick: () -> Unit,
    private val enabled: Boolean = true,
) : Widget(), ClickTarget {
    override val cursor: UiCursor
        get() = UiCursor.Pointer
    override val acceptsInput: Boolean
        get() = enabled

    override fun activate() {
        click()
    }

    override fun click() {
        if (enabled) onClick()
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size = Size.Zero

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

fun RenderNode.findAllTextFields(): List<Pair<TextField, Rect>> {
    val result = mutableListOf<Pair<TextField, Rect>>()
    fun walk(node: RenderNode) {
        val widget = node.widget
        if (widget is TextField) result.add(widget to node.bounds)
        node.children.forEach(::walk)
    }
    walk(this)
    return result
}


fun RenderNode.findVisibleTextFields(): List<Pair<TextField, Rect>> {
    val result = mutableListOf<Pair<TextField, Rect>>()
    fun walk(node: RenderNode, clip: Rect?) {
        val nodeClip = if (node.widget is Scroll) {
            if (clip == null) {
                node.bounds
            } else {
                val left = maxOf(clip.x, node.bounds.x)
                val top = maxOf(clip.y, node.bounds.y)
                val right = minOf(clip.right, node.bounds.right)
                val bottom = minOf(clip.bottom, node.bounds.bottom)
                Rect(left, top, (right - left).coerceAtLeast(0f), (bottom - top).coerceAtLeast(0f))
            }
        } else {
            clip
        }
        if (node.widget is TextField) {
            val visible = nodeClip == null ||
                (node.bounds.x >= nodeClip.x - 0.5f &&
                    node.bounds.y >= nodeClip.y - 0.5f &&
                    node.bounds.right <= nodeClip.right + 0.5f &&
                    node.bounds.bottom <= nodeClip.bottom + 0.5f)
            if (visible) result.add(node.widget to node.bounds)
        }
        node.children.forEach { walk(it, nodeClip) }
    }
    walk(this, null)
    return result
}


fun RenderNode.findByPath(path: List<Int>): RenderNode? {
    var node: RenderNode = this
    path.forEach { index ->
        node = node.children.getOrNull(index) ?: return null
    }
    return node
}

class SizedBox(
    val width: Float? = null,
    val height: Float? = null,
    val background: ((dev.ivlev.silent.ui.tokens.Theme) -> dev.ivlev.silent.ui.tokens.Color)? = null,
    content: () -> Widget,
) : Widget() {
    private val child: Widget = isolateWidgets(content)

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val childSize = child.measure(
            context,
            Constraints(
                0f,
                width ?: constraints.maxWidth,
                0f,
                height ?: constraints.maxHeight,
            ),
        )
        return constraints.constrain(
            Size(width ?: childSize.width, height ?: childSize.height),
        )
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, listOf(child.build(context, bounds)))
}
