package dev.ivlev.silent.ui.responsive

enum class Breakpoint(val token: String, val minWidth: Float) {
    XS("xs", 0f),
    SM("sm", 360f),
    MD("md", 480f),
    LG("lg", 600f),
    XL("xl", 840f),
    XXL("2xl", 1200f),
    XXXL("3xl", 1600f),
    XXXXL("4xl", 1920f),
    XXXXXL("5xl", 2560f),
    XXXXXXL("6xl", 3840f),
    ;

    companion object {
        val ordered: List<Breakpoint> = entries.sortedBy { it.minWidth }

        fun forWidth(width: Float): Breakpoint = ordered.last { width >= it.minWidth }

        fun fromToken(token: String): Breakpoint =
            entries.firstOrNull { it.token == token }
                ?: throw IllegalArgumentException("Неизвестный брейкпоинт: $token")
    }
}

val Breakpoints: List<Breakpoint> = Breakpoint.ordered

class ResponsiveValue<T> internal constructor(
    private val values: List<Pair<Breakpoint, T>>,
    private val fallback: T,
) {
    fun resolve(width: Float): T {
        var result = fallback
        values.forEach { (breakpoint, value) ->
            if (width >= breakpoint.minWidth) result = value
        }
        return result
    }

    fun at(breakpoint: Breakpoint): T =
        values.lastOrNull { it.first.minWidth <= breakpoint.minWidth }?.second ?: fallback
}

fun <T> responsive(
    xs: T,
    sm: T = xs,
    md: T = sm,
    lg: T = md,
    xl: T = lg,
    `2xl`: T = xl,
    `3xl`: T = `2xl`,
    `4xl`: T = `3xl`,
    `5xl`: T = `4xl`,
    `6xl`: T = `5xl`,
): ResponsiveValue<T> = ResponsiveValue(
    values = listOf(
        Breakpoint.XS to xs,
        Breakpoint.SM to sm,
        Breakpoint.MD to md,
        Breakpoint.LG to lg,
        Breakpoint.XL to xl,
        Breakpoint.XXL to `2xl`,
        Breakpoint.XXXL to `3xl`,
        Breakpoint.XXXXL to `4xl`,
        Breakpoint.XXXXXL to `5xl`,
        Breakpoint.XXXXXXL to `6xl`,
    ),
    fallback = xs,
)
