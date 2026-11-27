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

class HitTester {
    fun hit(root: RenderNode, x: Float, y: Float): HitTarget? {
        if (!root.bounds.contains(x, y)) return null
        for (child in root.children.asReversed()) {
            val result = hit(child, x, y)
            if (result != null) return result
        }
        return (root.widget as? HitTarget)?.takeIf { it.acceptsInput }
    }

    fun hitTextField(root: RenderNode, x: Float, y: Float): TextField? {
        val target = hit(root, x, y)
        return target as? TextField
    }
}

interface HitTarget {
    val acceptsInput: Boolean
    fun activate()
    fun secondaryActivate() = Unit
}

interface ClickTarget : HitTarget {
    fun click()
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
