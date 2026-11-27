package dev.ivlev.silent.ui.widgets

import dev.ivlev.silent.ui.form.FieldBinding
import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.ClickTarget
import dev.ivlev.silent.ui.layout.Constraints
import dev.ivlev.silent.ui.layout.HitRegion
import dev.ivlev.silent.ui.layout.Rect
import dev.ivlev.silent.ui.layout.RenderNode
import dev.ivlev.silent.ui.layout.Size
import dev.ivlev.silent.ui.layout.Spacer
import dev.ivlev.silent.ui.layout.Widget
import dev.ivlev.silent.ui.reactive.MutableSignal
import dev.ivlev.silent.ui.layout.collectWidgets
import dev.ivlev.silent.ui.layout.isolateWidgets
import dev.ivlev.silent.ui.responsive.ResponsiveValue
import dev.ivlev.silent.ui.responsive.responsive
import dev.ivlev.silent.ui.tokens.Color
import dev.ivlev.silent.ui.tokens.ControlSize
import dev.ivlev.silent.ui.tokens.Radii
import dev.ivlev.silent.ui.tokens.Spacing
import dev.ivlev.silent.ui.tokens.Theme
import dev.ivlev.silent.ui.tokens.Typography
import kotlin.math.roundToInt

data class ChoiceOption(
    val value: String,
    val label: String,
    val description: String? = null,
    val disabled: Boolean = false,
)

class CheckboxGroup(
    val options: List<ChoiceOption>,
    val field: FieldBinding<Set<String>>,
    val columns: ResponsiveValue<Int> = responsive(xs = 1, md = 2),
    val label: String? = null,
    val error: String? = null,
    val enabled: Boolean = true,
) : Widget() {
    private fun count(context: BuildContext): Int = columns.resolve(context.viewportWidth).coerceAtLeast(1)

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        val rows = (options.size + count(context) - 1) / count(context)
        val labelHeight = if (label != null) 24f else 0f
        val errorHeight = if (error != null) 20f else 0f
        return constraints.constrain(Size(width, labelHeight + rows * 36f + errorHeight))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val columns = count(context)
        val labelHeight = if (label != null) 24f else 0f
        val cellWidth = bounds.width / columns
        val nodes = options.mapIndexed { index, option ->
            val row = index / columns
            val column = index % columns
            HitRegion(
                onClick = { toggle(option.value) },
                enabled = enabled && !option.disabled,
            ).build(
                context,
                Rect(
                    bounds.x + column * cellWidth,
                    bounds.y + labelHeight + row * 36f,
                    cellWidth,
                    36f,
                ),
            )
        }
        return RenderNode(this, bounds, nodes)
    }

    private fun toggle(value: String) {
        if (!enabled) return
        val next = if (value in field.value) field.value - value else field.value + value
        field.value = next
        field.touch()
    }
}

class RadioGroup(
    val options: List<ChoiceOption>,
    val field: FieldBinding<String>,
    val columns: ResponsiveValue<Int> = responsive(xs = 1, md = 2),
    val label: String? = null,
    val error: String? = null,
    val enabled: Boolean = true,
) : Widget() {
    private fun count(context: BuildContext): Int = columns.resolve(context.viewportWidth).coerceAtLeast(1)

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        val rows = (options.size + count(context) - 1) / count(context)
        val labelHeight = if (label != null) 24f else 0f
        val errorHeight = if (error != null) 20f else 0f
        return constraints.constrain(Size(width, labelHeight + rows * 36f + errorHeight))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val columns = count(context)
        val labelHeight = if (label != null) 24f else 0f
        val cellWidth = bounds.width / columns
        val nodes = options.mapIndexed { index, option ->
            HitRegion(
                onClick = {
                    if (enabled && !option.disabled) {
                        field.value = option.value
                        field.touch()
                    }
                },
                enabled = enabled && !option.disabled,
            ).build(
                context,
                Rect(
                    bounds.x + (index % columns) * cellWidth,
                    bounds.y + labelHeight + (index / columns) * 36f,
                    cellWidth,
                    36f,
                ),
            )
        }
        return RenderNode(this, bounds, nodes)
    }
}

class Slider(
    val field: FieldBinding<Float>,
    val min: Float = 0f,
    val max: Float = 100f,
    val step: Float = 1f,
    val label: String? = null,
    val unit: String = "",
    val enabled: Boolean = true,
) : Widget(), ClickTarget {
    override val acceptsInput: Boolean
        get() = enabled

    override fun activate() = click()

    override fun click() = Unit

    override fun activateAt(x: Float, y: Float) {
        if (!enabled) return
        val ratio = ((x - lastBounds.x) / lastBounds.width.coerceAtLeast(1f)).coerceIn(0f, 1f)
        val raw = min + ratio * (max - min)
        val stepped = (raw / step).roundToInt() * step
        field.value = stepped.coerceIn(min, max)
        field.touch()
    }

    private var lastBounds: Rect = Rect.Zero

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 320f
        val labelHeight = if (label != null) 24f else 0f
        return constraints.constrain(Size(width, labelHeight + 40f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        lastBounds = bounds
        return RenderNode(this, bounds, emptyList())
    }

    val ratio: Float
        get() = ((this.field.value - min) / (max - min).coerceAtLeast(0.0001f)).coerceIn(0f, 1f)
}

class NumberField(
    binding: FieldBinding<String>,
    label: String? = null,
    val unit: String = "",
    val min: Float? = null,
    val max: Float? = null,
    val step: Float = 1f,
    enabled: Boolean = true,
) : TextField(binding, label, null, FieldType.Number, enabled, ControlSize.LG) {
    fun decrease() {
        val current = binding.value.toFloatOrNull() ?: 0f
        binding.value = format((current - step).coerceAtLeast(min ?: Float.NEGATIVE_INFINITY))
    }

    fun increase() {
        val current = binding.value.toFloatOrNull() ?: 0f
        binding.value = format((current + step).coerceAtMost(max ?: Float.POSITIVE_INFINITY))
    }

    private fun format(value: Float): String =
        if (value % 1f == 0f) value.toInt().toString() else value.toString()
}

class Textarea(
    binding: FieldBinding<String>,
    label: String? = null,
    hint: String? = null,
    val rows: Int = 4,
    enabled: Boolean = true,
) : TextField(binding, label, hint, FieldType.Text, enabled, ControlSize.LG) {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        val labelHeight = if (label != null) LABEL_HEIGHT else 0f
        val errorHeight = if (controlError != null) ERROR_HEIGHT else 0f
        return constraints.constrain(Size(width, labelHeight + rows * 24f + 24f + errorHeight))
    }
}

class OtpInput(
    binding: FieldBinding<String>,
    val length: Int = 6,
    val mask: Boolean = false,
    val groups: List<Int> = listOf(3, 3),
    override val externalError: String? = null,
) : TextField(binding, null, null, FieldType.Text, true) {

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        val errorHeight = if (externalError != null) ERROR_HEIGHT else 0f
        return constraints.constrain(Size(width, 56f + errorHeight))
    }
}

class TagInput(
    val values: FieldBinding<List<String>>,
    val label: String? = null,
    val placeholder: String = "Добавить…",
    val suggestions: List<String> = emptyList(),
    val enabled: Boolean = true,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        return constraints.constrain(Size(width, if (label != null) 80f else 56f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class Combobox(
    val options: List<SelectOption<String>>,
    val field: FieldBinding<String>,
    val label: String? = null,
    val placeholder: String = "Начните ввод…",
    val open: Boolean = false,
    val onSelect: (String) -> Unit = {},
    val enabled: Boolean = true,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        return constraints.constrain(Size(width, 48f + (if (open) options.size * 36f else 0f)))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        if (!open) return RenderNode(this, bounds, emptyList())
        val nodes = options.mapIndexed { index, option ->
            HitRegion(onClick = {
                field.value = option.value
                field.touch()
                onSelect(option.value)
            }).build(context, Rect(bounds.x, bounds.y + 48f + index * 36f, bounds.width, 36f))
        }
        return RenderNode(this, bounds, nodes)
    }
}

data class TreeSelectNode(
    val value: String,
    val label: String,
    val depth: Int = 0,
    val children: List<TreeSelectNode> = emptyList(),
    val disabled: Boolean = false,
)

class TreeSelect(
    val nodes: List<TreeSelectNode>,
    val selected: FieldBinding<Set<String>>,
    val open: Boolean = true,
    val label: String? = null,
    val popupId: String = label ?: "tree-select",
) : Widget(), ClickTarget {
    val expanded: MutableSignal<Set<String>> = MutableSignal(
        nodes.filter { it.children.isNotEmpty() }.map { it.value }.toSet(),
    )

    fun isOpen(): Boolean = open || PopupController.isOpen(popupId)

    override val acceptsInput: Boolean
        get() = true

    override fun activate() = click()

    override fun click() {
        PopupController.toggle(popupId)
    }

    fun visibleNodes(): List<TreeSelectNode> {
        val result = mutableListOf<TreeSelectNode>()
        fun walk(source: List<TreeSelectNode>) {
            source.forEach { node ->
                result.add(node)
                if (node.value in expanded.value) walk(node.children)
            }
        }
        walk(nodes)
        return result
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        return constraints.constrain(Size(width, 48f + if (isOpen()) visibleNodes().size * 40f else 0f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        if (!isOpen()) return RenderNode(this, bounds, emptyList())
        val nodes = visibleNodes()
        PopupController.installHandler { key ->
            when (key) {
                PopupKey.Escape -> {
                    PopupController.close()
                    true
                }
                else -> false
            }
        }
        val regions = mutableListOf<RenderNode>()
        nodes.forEachIndexed { index, node ->
            val y = bounds.y + 48f + index * 40f
            if (node.children.isNotEmpty()) {
                regions.add(
                    HitRegion(onClick = {
                        expanded.set(
                            if (node.value in expanded.value) expanded.value - node.value else expanded.value + node.value,
                        )
                    }).build(context, Rect(bounds.x + 4f, y, 32f, 40f)),
                )
            }
            regions.add(
                HitRegion(
                    onClick = {
                        if (!node.disabled) {
                            val subtree = subtreeValues(node)
                            val allSelected = subtree.all { it in selected.value }
                            selected.value = if (allSelected) selected.value - subtree else selected.value + subtree
                            selected.touch()
                        }
                    },
                    enabled = !node.disabled,
                ).build(context, Rect(bounds.x + 36f, y, bounds.width - 40f, 40f)),
            )
        }
        return RenderNode(this, bounds, regions)
    }

    private fun subtreeValues(node: TreeSelectNode): Set<String> {
        val result = linkedSetOf(node.value)
        node.children.forEach { child -> result.addAll(subtreeValues(child)) }
        return result
    }
}

class Field(
    val label: String? = null,
    val hint: String? = null,
    val error: String? = null,
    val required: Boolean = false,
    val content: () -> Widget,
) : Widget() {
    private val child: Widget = isolateWidgets { content() }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        val childSize = child.measure(context, Constraints(0f, width, 0f, Float.POSITIVE_INFINITY))
        val labelHeight = if (label != null) 22f else 0f
        val message = error ?: hint
        val messageHeight = if (message != null) 20f else 0f
        return constraints.constrain(Size(width, labelHeight + childSize.height + messageHeight))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val labelHeight = if (label != null) 22f else 0f
        val childSize = child.measure(context, Constraints(0f, bounds.width, 0f, Float.POSITIVE_INFINITY))
        return RenderNode(
            this,
            bounds,
            listOf(
                child.build(
                    context,
                    Rect(bounds.x, bounds.y + labelHeight, bounds.width, childSize.height),
                ),
            ),
        )
    }
}

class FieldGroup(
    val legend: String? = null,
    val hint: String? = null,
    val columns: ResponsiveValue<Int> = responsive(xs = 1),
    content: () -> Widget,
) : Widget() {
    private val child: Widget = isolateWidgets(content)

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 480f
        val childSize = child.measure(context, Constraints(0f, width, 0f, Float.POSITIVE_INFINITY))
        val header = (if (legend != null) 24f else 0f) + (if (hint != null) 20f else 0f)
        return constraints.constrain(Size(width, header + childSize.height + 8f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val header = (if (legend != null) 24f else 0f) + (if (hint != null) 20f else 0f)
        val childSize = child.measure(context, Constraints(0f, bounds.width, 0f, Float.POSITIVE_INFINITY))
        return RenderNode(
            this,
            bounds,
            listOf(child.build(context, Rect(bounds.x, bounds.y + header, bounds.width, childSize.height))),
        )
    }
}

class FormActions(
    val align: dev.ivlev.silent.ui.layout.Align = dev.ivlev.silent.ui.layout.Align.End,
    val submitLabel: String = "Сохранить",
    val resetLabel: String = "Сбросить",
    val loading: Boolean = false,
    val enabled: Boolean = true,
    val showReset: Boolean = true,
    val onSubmit: () -> Unit = {},
    val onReset: () -> Unit = {},
) : Widget() {
    private val buttons: List<Widget> = isolateWidgets {
        listOf(
            if (showReset) Button(resetLabel, enabled = enabled && !loading, variant = ButtonVariant.Text, size = ControlSize.MD, onClick = onReset) else Spacer(),
            Button(submitLabel, enabled = enabled, loading = loading, size = ControlSize.MD, onClick = onSubmit),
        )
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        return constraints.constrain(Size(width, 48f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val sizes = buttons.map { it.measure(context, Constraints(0f, bounds.width, 0f, 48f)) }
        val total = sizes.sumOf { it.width.toDouble() }.toFloat() + Spacing.x2 * (buttons.size - 1)
        var x = when (align) {
            dev.ivlev.silent.ui.layout.Align.Start -> bounds.x
            dev.ivlev.silent.ui.layout.Align.Center -> bounds.x + (bounds.width - total) / 2f
            dev.ivlev.silent.ui.layout.Align.End, dev.ivlev.silent.ui.layout.Align.Stretch -> bounds.right - total
        }
        val nodes = buttons.mapIndexed { index, widget ->
            val size = sizes[index]
            val node = widget.build(context, Rect(x, bounds.y + (bounds.height - size.height) / 2f, size.width, size.height))
            x += size.width + Spacing.x2
            node
        }
        return RenderNode(this, bounds, nodes)
    }
}

class FileUpload(
    val title: String = "Перетащите файлы или выберите",
    val hint: String = "PDF, PNG, JPG до 10 МБ",
    val enabled: Boolean = true,
    val onPick: () -> Unit = {},
) : Widget(), ClickTarget {
    override val acceptsInput: Boolean
        get() = enabled

    override fun activate() = click()

    override fun click() {
        if (enabled) onPick()
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        return constraints.constrain(Size(width, 140f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class FileField(
    val label: String = "Файл",
    val value: String? = null,
    val enabled: Boolean = true,
    val onPick: () -> Unit = {},
) : Widget(), ClickTarget {
    override val acceptsInput: Boolean
        get() = enabled

    override fun activate() = click()

    override fun click() {
        if (enabled) onPick()
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        return constraints.constrain(Size(width, 70f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class SearchField(
    binding: FieldBinding<String>,
    placeholder: String = "Поиск",
    enabled: Boolean = true,
) : TextField(binding, null, placeholder, FieldType.Text, enabled) {
    val placeholderText: String
        get() = hint.orEmpty()
}

class FieldArray(
    val count: Int,
    val onAdd: () -> Unit = {},
    val onRemove: (Int) -> Unit = {},
    val renderItem: (Int) -> Widget,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 360f
        var height = 0f
        repeat(count) { index ->
            height += isolateWidgets { renderItem(index) }
                .measure(context, Constraints(0f, width, 0f, Float.POSITIVE_INFINITY)).height + 8f
        }
        return constraints.constrain(Size(width, height + 48f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val nodes = mutableListOf<RenderNode>()
        var y = bounds.y
        repeat(count) { index ->
            val widget = isolateWidgets { renderItem(index) }
            val size = widget.measure(context, Constraints(0f, bounds.width - 40f, 0f, Float.POSITIVE_INFINITY))
            nodes.add(widget.build(context, Rect(bounds.x, y, bounds.width - 40f, size.height)))
            nodes.add(HitRegion(onClick = { onRemove(index) }).build(
                context,
                Rect(bounds.right - 32f, y, 28f, 28f),
            ))
            y += size.height + 8f
        }
        nodes.add(HitRegion(onClick = onAdd).build(context, Rect(bounds.x, y, 120f, 40f)))
        return RenderNode(this, bounds, nodes)
    }
}

class Listbox(
    val options: List<String>,
    val selected: Int = -1,
    val onSelect: (Int) -> Unit = {},
    val enabled: Boolean = true,
) : Widget(), ClickTarget {
    private var lastBounds: Rect = Rect.Zero
    override val acceptsInput: Boolean
        get() = enabled
    override fun activate() = Unit
    override fun click() = Unit
    override fun activateAt(x: Float, y: Float) {
        if (!enabled || lastBounds.height <= 0f) return
        val index = ((y - lastBounds.y - 8f) / 36f).toInt()
        if (index in options.indices) onSelect(index)
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 240f
        return constraints.constrain(Size(width, options.size * 36f + 16f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        lastBounds = bounds
        return RenderNode(this, bounds, emptyList())
    }
}
