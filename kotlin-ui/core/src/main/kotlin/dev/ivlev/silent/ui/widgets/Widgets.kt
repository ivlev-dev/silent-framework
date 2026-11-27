package dev.ivlev.silent.ui.widgets

import dev.ivlev.silent.ui.form.FieldBinding
import dev.ivlev.silent.ui.form.FormModel
import dev.ivlev.silent.ui.form.bind
import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.ClickTarget
import dev.ivlev.silent.ui.layout.Constraints
import dev.ivlev.silent.ui.layout.HitTarget
import dev.ivlev.silent.ui.layout.RenderNode
import dev.ivlev.silent.ui.layout.Rect
import dev.ivlev.silent.ui.layout.Size
import dev.ivlev.silent.ui.layout.TextAlign
import dev.ivlev.silent.ui.layout.Widget
import dev.ivlev.silent.ui.layout.collectWidgets
import dev.ivlev.silent.ui.paint.textBlockHeight
import dev.ivlev.silent.ui.paint.wrapText
import dev.ivlev.silent.ui.tokens.Color
import dev.ivlev.silent.ui.tokens.Control
import dev.ivlev.silent.ui.tokens.ControlSize
import dev.ivlev.silent.ui.tokens.Radii
import dev.ivlev.silent.ui.tokens.Spacing
import dev.ivlev.silent.ui.tokens.TextStyle
import dev.ivlev.silent.ui.tokens.Theme
import dev.ivlev.silent.ui.tokens.Typography
import kotlin.math.roundToInt
import kotlin.reflect.KMutableProperty0

open class Text(
    val text: String,
    val style: TextStyle = Typography.bodyMedium,
    val color: ((Theme) -> Color)? = null,
    val align: TextAlign = TextAlign.Start,
    val maxLines: Int = Int.MAX_VALUE,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val maxWidth = constraints.maxWidth
        val lines = wrapText(text, style, maxWidth, context.textMeasurer, maxLines)
        val lineWidth = lines.maxOfOrNull { context.textMeasurer.width(it, style) } ?: 0f
        val width = if (maxWidth.isFinite()) minOf(lineWidth, maxWidth) else lineWidth
        return constraints.constrain(Size(width, textBlockHeight(lines.size, style)))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class Heading(
    text: String,
    level: Int = 1,
    color: ((Theme) -> Color)? = null,
) : Text(
    text = text,
    style = when (level.coerceIn(1, 3)) {
        1 -> Typography.headlineLarge
        2 -> Typography.headlineMedium
        else -> Typography.headlineSmall
    },
    color = color,
)

enum class ButtonVariant {
    Primary,
    Tonal,
    Secondary,
    Ghost,
    Filled,
    Outlined,
    Text,
}

class Button(
    val text: String,
    val enabled: Boolean = true,
    val loading: Boolean = false,
    val variant: ButtonVariant = ButtonVariant.Primary,
    val size: ControlSize = ControlSize.MD,
    val leadingIcon: String? = null,
    val trailingIcon: String? = null,
    val hovered: Boolean = false,
    val fullWidth: Boolean = false,
    val onClick: () -> Unit,
) : Widget(), ClickTarget {
    override val acceptsInput: Boolean
        get() = enabled && !loading

    override fun activate() {
        click()
    }

    override fun click() {
        if (acceptsInput) onClick()
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val label = if (loading) "$text…" else text
        val iconWidth = if (leadingIcon != null || trailingIcon != null || loading) size.iconSize + Spacing.x2 else 0f
        val width = when {
            fullWidth && constraints.maxWidth.isFinite() -> constraints.maxWidth
            else -> context.textMeasurer.width(label, size.textStyle) +
                size.horizontalPadding * 2f + iconWidth
        }
        return constraints.constrain(Size(width, size.height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class IconButton(
    val glyph: String,
    val label: String? = null,
    val enabled: Boolean = true,
    val size: ControlSize = ControlSize.MD,
    val variant: ButtonVariant = ButtonVariant.Ghost,
    val onClick: () -> Unit,
) : Widget(), ClickTarget {
    override val acceptsInput: Boolean
        get() = enabled

    override fun activate() {
        click()
    }

    override fun click() {
        if (enabled) onClick()
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size =
        constraints.constrain(Size(maxOf(Control.touchTarget, size.height), maxOf(Control.touchTarget, size.height)))

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class Checkbox(
    val field: FieldBinding<Boolean>,
    val label: String? = null,
    val enabled: Boolean = true,
) : Widget(), ClickTarget {
    override val acceptsInput: Boolean
        get() = enabled

    override fun activate() {
        click()
    }

    override fun click() {
        if (!enabled) return
        field.value = !field.value
        field.touch()
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val textWidth = label?.let { context.textMeasurer.width(it, Typography.bodySmall) } ?: 0f
        val width = 20f + if (label != null) Spacing.x2 + textWidth else 0f
        return constraints.constrain(Size(width, 28f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class Switch(
    val field: FieldBinding<Boolean>,
    val label: String? = null,
    val enabled: Boolean = true,
) : Widget(), ClickTarget {
    override val acceptsInput: Boolean
        get() = enabled

    override fun activate() {
        click()
    }

    override fun click() {
        if (!enabled) return
        field.value = !field.value
        field.touch()
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val textWidth = label?.let { context.textMeasurer.width(it, Typography.bodySmall) } ?: 0f
        val width = 44f + if (label != null) Spacing.x2 + textWidth else 0f
        return constraints.constrain(Size(width, 28f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

data class SelectOption<T>(val value: T, val label: String)

class Select<T>(
    val options: List<SelectOption<T>>,
    val binding: FieldBinding<T>,
    val label: String? = null,
    val placeholder: String = "Выберите",
    val enabled: Boolean = true,
    val open: Boolean = false,
    val size: ControlSize = ControlSize.LG,
    val externalError: String? = null,
    val popupId: String = binding.key.ifBlank { label ?: "select" },
    val onSelect: (T) -> Unit = {},
) : Widget(), ClickTarget {
    fun isOpen(): Boolean = open || PopupController.isOpen(popupId)

    override val acceptsInput: Boolean
        get() = enabled && options.isNotEmpty()

    override fun activate() {
        click()
    }

    override fun click() {
        if (!acceptsInput) return
        val currentIndex = options.indexOfFirst { it.value == binding.value }
        PopupController.toggle(popupId, currentIndex.coerceAtLeast(0))
    }

    val selectedLabel: String
        get() = options.firstOrNull { it.value == binding.value }?.label ?: placeholder

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 300f
        val labelHeight = if (label != null) 24f else 0f
        val errorHeight = if (externalError != null) 20f else 0f
        return constraints.constrain(
            Size(width, labelHeight + size.height + errorHeight + if (isOpen()) options.size * 40f + 8f else 0f),
        )
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        if (!isOpen()) return RenderNode(this, bounds, emptyList())
        val currentIndex = options.indexOfFirst { it.value == binding.value }
        PopupController.highlighted.set(
            PopupController.highlighted.value.coerceIn(0, (options.size - 1).coerceAtLeast(0)),
        )
        PopupController.installHandler { key ->
            val last = options.lastIndex
            when (key) {
                PopupKey.Up -> {
                    PopupController.highlighted.set((PopupController.highlighted.value - 1).coerceAtLeast(0))
                    true
                }
                PopupKey.Down -> {
                    PopupController.highlighted.set((PopupController.highlighted.value + 1).coerceAtMost(last))
                    true
                }
                PopupKey.Home -> {
                    PopupController.highlighted.set(0)
                    true
                }
                PopupKey.End -> {
                    PopupController.highlighted.set(last.coerceAtLeast(0))
                    true
                }
                PopupKey.Enter -> {
                    options.getOrNull(PopupController.highlighted.value)?.let { option ->
                        binding.value = option.value
                        binding.touch()
                        onSelect(option.value)
                    }
                    PopupController.close()
                    true
                }
                PopupKey.Escape -> {
                    PopupController.close()
                    true
                }
            }
        }
        val labelHeight = if (label != null) 24f else 0f
        val top = bounds.y + labelHeight + size.height + 4f
        val nodes = options.mapIndexed { index, option ->
            dev.ivlev.silent.ui.layout.HitRegion(onClick = {
                binding.value = option.value
                binding.touch()
                onSelect(option.value)
                PopupController.close()
            }, enabled = enabled).build(
                context,
                Rect(bounds.x, top + 4f + index * 40f, bounds.width, 40f),
            )
        }
        if (currentIndex < 0) PopupController.highlighted.set(0)
        return RenderNode(this, bounds, nodes)
    }
}

class CardScope internal constructor()

class Card(
    val padding: Float = Spacing.x4,
    val widePadding: Float = padding,
    val wideThreshold: Float = 840f,
    val maxWidth: Float = Float.POSITIVE_INFINITY,
    val radius: Float = Radii.card,
    val background: ((Theme) -> Color)? = { it.colors.surfaceContainerLowest },
    val borderColor: ((Theme) -> Color)? = { it.colors.outlineVariant },
    val fillHeight: Boolean = false,
    val height: Float? = null,
    val minHeight: Float = 0f,
    val interactive: Boolean = false,
    val onClick: () -> Unit = {},
    content: CardScope.() -> Unit,
) : Widget(), ClickTarget {
    val children: List<Widget> = collectWidgets { CardScope().content() }

    override val acceptsInput: Boolean
        get() = interactive

    override fun activate() = click()

    override fun click() {
        if (interactive) onClick()
    }

    private fun paddingFor(context: BuildContext): Float =
        if (context.viewportWidth >= wideThreshold) widePadding else padding

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val limit = minOf(constraints.maxWidth, maxWidth)
        val padding = paddingFor(context)
        val innerLimit = (limit - padding * 2f).coerceAtLeast(0f)
        val sizes = children.map { it.measure(context, Constraints(0f, innerLimit, 0f, Float.POSITIVE_INFINITY)) }
        val contentWidth = sizes.maxOfOrNull { it.width } ?: 0f
        val contentHeight = sizes.maxOfOrNull { it.height } ?: 0f
        val width = (contentWidth + padding * 2f).coerceAtMost(limit)
        val resolvedHeight = height ?: if (fillHeight && constraints.maxHeight.isFinite()) {
            constraints.maxHeight
        } else {
            maxOf(contentHeight + padding * 2f, minHeight)
        }
        return constraints.constrain(Size(width, resolvedHeight))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        val padding = paddingFor(context)
        val inner = Rect(
            bounds.x + padding,
            bounds.y + padding,
            (bounds.width - padding * 2f).coerceAtLeast(0f),
            (bounds.height - padding * 2f).coerceAtLeast(0f),
        )
        val nodes = children.map { child ->
            val size = child.measure(context, Constraints(0f, inner.width, 0f, inner.height))
            val childHeight = if (fillHeight || height != null) inner.height else minOf(size.height, inner.height)
            child.build(context, Rect(inner.x, inner.y, inner.width, childHeight))
        }
        return RenderNode(this, bounds, nodes)
    }
}

class Divider(
    val color: ((Theme) -> Color)? = { it.colors.outlineVariant },
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size =
        constraints.constrain(Size(if (constraints.maxWidth.isFinite()) constraints.maxWidth else 0f, 1f))

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class Progress(
    val value: () -> Float,
    val color: ((Theme) -> Color)? = { it.colors.primary },
    val height: Float = 8f,
) : Widget() {
    constructor(
        value: Float,
        color: ((Theme) -> Color)? = { it.colors.primary },
        height: Float = 8f,
    ) : this({ value }, color, height)

    override fun measure(context: BuildContext, constraints: Constraints): Size =
        constraints.constrain(Size(if (constraints.maxWidth.isFinite()) constraints.maxWidth else 120f, height))

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())

    fun currentValue(): Float = value().coerceIn(0f, 1f)
}

class FormProgress(
    val form: FormModel,
    val showLabel: Boolean = true,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size =
        constraints.constrain(Size(if (constraints.maxWidth.isFinite()) constraints.maxWidth else 220f, 36f))

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())

    fun percent(): Int = (form.completion * 100f).roundToInt().coerceIn(0, 100)
}

enum class FieldType {
    Text,
    Email,
    Password,
    Number,
}

interface TextInputTarget : HitTarget {
    override val cursor: dev.ivlev.silent.ui.layout.UiCursor
        get() = dev.ivlev.silent.ui.layout.UiCursor.Text
    val binding: FieldBinding<String>
    val fieldType: FieldType
    val enabled: Boolean
}

open class TextField(
    override val binding: FieldBinding<String>,
    val label: String? = null,
    val hint: String? = null,
    val type: FieldType = FieldType.Text,
    override val enabled: Boolean = true,
    val size: ControlSize = ControlSize.LG,
    open val externalError: String? = null,
    val focused: Boolean = false,
    val readOnly: Boolean = false,
) : Widget(), TextInputTarget {
    constructor(
        property: KMutableProperty0<String>,
        label: String? = null,
        hint: String? = null,
        type: FieldType = FieldType.Text,
        enabled: Boolean = true,
        size: ControlSize = ControlSize.LG,
    ) : this(bind(property), label, hint, type, enabled, size)

    override val fieldType: FieldType
        get() = type

    override val acceptsInput: Boolean
        get() = enabled

    override fun activate() {
        binding.touch()
    }

    val controlError: String?
        get() = externalError ?: binding.error

    val controlHeight: Float
        get() = size.height

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 320f
        val labelHeight = if (label != null) LABEL_HEIGHT else 0f
        val errorHeight = if (controlError != null) ERROR_HEIGHT else 0f
        return constraints.constrain(Size(width, labelHeight + controlHeight + errorHeight))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())

    companion object {
        const val LABEL_HEIGHT: Float = 22f
        const val ERROR_HEIGHT: Float = 18f
    }
}

class Table(
    val headers: List<String>,
    val rows: List<List<String>>,
    val columnWeights: List<Float> = List(headers.size) { 1f },
    val columnAligns: List<TextAlign> = List(headers.size) { TextAlign.Start },
    val statusColumn: Int? = null,
    val tagsColumn: Int? = null,
    val rowHeight: Float = 48f,
    val headerHeight: Float = 44f,
) : Widget(), HitTarget {
    override val acceptsInput: Boolean
        get() = true

    override fun activate() = Unit

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 640f
        val height = headerHeight + rows.size * rowHeight + 8f
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}


enum class TagTone {
    Neutral,
    Primary,
    Success,
    Warning,
    Error,
    Info,
}

class Tag(
    val text: String,
    val tone: TagTone = TagTone.Neutral,
    val compact: Boolean = false,
    val onClick: (() -> Unit)? = null,
) : Widget(), ClickTarget {
    override val acceptsInput: Boolean
        get() = true

    override fun activate() = click()

    override fun click() {
        onClick?.invoke()
    }

    fun textStyle(): dev.ivlev.silent.ui.tokens.TextStyle =
        if (compact) Typography.labelSmall else Typography.labelMedium

    fun height(): Float = if (compact) 20f else 24f

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = context.textMeasurer.width(text, textStyle()) + Spacing.x2 * 2f
        return constraints.constrain(Size(width, height()))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}
