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
    Secondary,
    Ghost,
}

class Button(
    val text: String,
    val enabled: Boolean = true,
    val loading: Boolean = false,
    val variant: ButtonVariant = ButtonVariant.Primary,
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
        val width = when {
            fullWidth && constraints.maxWidth.isFinite() -> constraints.maxWidth
            else -> context.textMeasurer.width(label, Typography.labelLarge) + Spacing.x6 * 2f
        }
        return constraints.constrain(Size(width, Control.heightLg))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}

class IconButton(
    val glyph: String,
    val label: String? = null,
    val enabled: Boolean = true,
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
        constraints.constrain(Size(Control.touchTarget, Control.touchTarget))

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
) : Widget(), ClickTarget {
    override val acceptsInput: Boolean
        get() = enabled && options.isNotEmpty()

    override fun activate() {
        click()
    }

    override fun click() {
        if (!acceptsInput) return
        val currentIndex = options.indexOfFirst { it.value == binding.value }
        val next = options[(currentIndex + 1).mod(options.size)]
        binding.value = next.value
        binding.touch()
    }

    val selectedLabel: String
        get() = options.firstOrNull { it.value == binding.value }?.label ?: placeholder

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 300f
        val labelHeight = if (label != null) 24f else 0f
        return constraints.constrain(Size(width, labelHeight + Control.heightLg))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
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
    content: CardScope.() -> Unit,
) : Widget() {
    val children: List<Widget> = collectWidgets { CardScope().content() }

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
        val height = if (fillHeight && constraints.maxHeight.isFinite()) {
            constraints.maxHeight
        } else {
            contentHeight + padding * 2f
        }
        return constraints.constrain(Size(width, height))
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
            val height = if (fillHeight) inner.height else minOf(size.height, inner.height)
            child.build(context, Rect(inner.x, inner.y, inner.width, height))
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
    val binding: FieldBinding<String>
    val fieldType: FieldType
    val enabled: Boolean
}

class TextField(
    override val binding: FieldBinding<String>,
    val label: String? = null,
    val hint: String? = null,
    val type: FieldType = FieldType.Text,
    override val enabled: Boolean = true,
) : Widget(), TextInputTarget {
    constructor(
        property: KMutableProperty0<String>,
        label: String? = null,
        hint: String? = null,
        type: FieldType = FieldType.Text,
        enabled: Boolean = true,
    ) : this(bind(property), label, hint, type, enabled)

    override val fieldType: FieldType
        get() = type

    override val acceptsInput: Boolean
        get() = enabled

    override fun activate() {
        binding.touch()
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = if (constraints.maxWidth.isFinite()) constraints.maxWidth else 320f
        val labelHeight = if (label != null) 22f else 0f
        val errorHeight = if (binding.error != null) 18f else 0f
        return constraints.constrain(Size(width, labelHeight + Control.heightLg + errorHeight))
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
    val rowHeight: Float = 44f,
    val headerHeight: Float = 40f,
) : Widget() {
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
    Success,
    Warning,
    Error,
}

class Tag(
    val text: String,
    val tone: TagTone = TagTone.Neutral,
) : Widget() {
    override fun measure(context: BuildContext, constraints: Constraints): Size {
        val width = context.textMeasurer.width(text, Typography.labelSmall) + Spacing.x2 * 2f
        return constraints.constrain(Size(width, 24f))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode =
        RenderNode(this, bounds, emptyList())
}
