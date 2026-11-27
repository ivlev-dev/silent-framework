package dev.ivlev.silent.ui.tokens

@JvmInline
value class Color(val argb: Long) {
    val alpha: Float
        get() = ((argb shr 24) and 0xFF).toFloat() / 255f

    val red: Int
        get() = ((argb shr 16) and 0xFF).toInt()

    val green: Int
        get() = ((argb shr 8) and 0xFF).toInt()

    val blue: Int
        get() = (argb and 0xFF).toInt()

    fun withAlpha(alpha: Float): Color {
        val a = (alpha.coerceIn(0f, 1f) * 255f).toLong()
        return Color((argb and 0x00FFFFFFL) or (a shl 24))
    }

    fun mix(other: Color, amount: Float): Color {
        val t = amount.coerceIn(0f, 1f)
        val a = lerp(alpha, other.alpha, t)
        val r = lerp(red.toFloat(), other.red.toFloat(), t)
        val g = lerp(green.toFloat(), other.green.toFloat(), t)
        val b = lerp(blue.toFloat(), other.blue.toFloat(), t)
        return Color((a * 255f).toLong().shl(24) or (r.toLong().shl(16)) or (g.toLong().shl(8)) or b.toLong())
    }

    companion object {
        val Transparent: Color = Color(0x00000000L)
        val Black: Color = Color(0xFF000000L)
        val White: Color = Color(0xFFFFFFFFL)

        fun hex(value: String): Color {
            val cleaned = value.removePrefix("#")
            val normalized = when (cleaned.length) {
                6 -> "FF$cleaned"
                8 -> cleaned
                else -> throw IllegalArgumentException("Некорректный цвет: $value")
            }
            return Color(normalized.toLong(16))
        }

        fun rgb(red: Int, green: Int, blue: Int): Color =
            Color(0xFF000000L or (red.toLong() shl 16) or (green.toLong() shl 8) or blue.toLong())

        private fun lerp(from: Float, to: Float, amount: Float): Float = from + (to - from) * amount
    }
}

enum class FontFamily {
    Sans,
    Mono,
}

data class TextStyle(
    val size: Float,
    val lineHeight: Float,
    val weight: Int = 400,
    val letterSpacing: Float = 0f,
    val family: FontFamily = FontFamily.Sans,
)

object Typography {
    val displayLarge = TextStyle(40f, 48f, 600)
    val displayMedium = TextStyle(34f, 41f, 600)
    val displaySmall = TextStyle(30f, 36f, 600)
    val headlineLarge = TextStyle(28f, 34f, 600)
    val headlineMedium = TextStyle(22f, 28f, 600)
    val headlineSmall = TextStyle(20f, 26f, 600)
    val titleLarge = TextStyle(19f, 26f, 600)
    val titleMedium = TextStyle(18f, 25f, 600)
    val titleSmall = TextStyle(16f, 23f, 600)
    val bodyLarge = TextStyle(17f, 26f, 400)
    val bodyMedium = TextStyle(16f, 25f, 400)
    val bodySmall = TextStyle(14f, 21f, 400)
    val labelLarge = TextStyle(13f, 18f, 600)
    val labelMedium = TextStyle(12f, 16f, 600)
    val labelSmall = TextStyle(12f, 16f, 600, 0.04f)
}

object Spacing {
    const val x0: Float = 0f
    const val x1: Float = 4f
    const val x2: Float = 8f
    const val x3: Float = 12f
    const val x4: Float = 16f
    const val x5: Float = 20f
    const val x6: Float = 24f
    const val x7: Float = 32f
    const val x8: Float = 40f
    const val x9: Float = 48f
    const val x10: Float = 64f
}

object Radii {
    const val none: Float = 0f
    const val xs: Float = 4f
    const val sm: Float = 6f
    const val md: Float = 10f
    const val lg: Float = 14f
    const val xl: Float = 20f
    const val full: Float = 999f
    const val card: Float = 16f
    const val control: Float = md
}

object Control {
    const val heightSm: Float = 32f
    const val heightMd: Float = 40f
    const val heightLg: Float = 48f
    const val touchTarget: Float = 44f
    const val iconSm: Float = 14f
    const val iconMd: Float = 18f
    const val iconLg: Float = 22f
}

enum class ControlSize(val height: Float, val horizontalPadding: Float, val iconSize: Float) {
    SM(Control.heightSm, 12f, Control.iconSm),
    MD(Control.heightMd, 16f, Control.iconMd),
    LG(Control.heightLg, 20f, Control.iconLg),
    ;

    val textStyle: TextStyle
        get() = when (this) {
            SM -> Typography.labelMedium
            MD -> Typography.labelLarge
            LG -> Typography.bodyMedium
        }
}

enum class Tone {
    Neutral,
    Primary,
    Success,
    Warning,
    Error,
    Info,
}
