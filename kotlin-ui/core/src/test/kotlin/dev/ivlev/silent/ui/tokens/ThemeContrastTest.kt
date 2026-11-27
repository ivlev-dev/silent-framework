package dev.ivlev.silent.ui.tokens

import kotlin.math.max
import kotlin.math.min
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ThemeContrastTest {
    private fun luminance(color: Color): Double {
        fun channel(value: Int): Double {
            val c = value / 255.0
            return if (c <= 0.03928) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)
    }

    private fun ratio(first: Color, second: Color): Double {
        val a = luminance(first)
        val b = luminance(second)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    @Test
    fun darkThemeUsesSoftCharcoal() {
        val colors = Themes.dark.colors
        assertEquals(Color.hex("#17181B"), colors.surface)
        assertEquals(Color.hex("#101114"), colors.surfaceDim)
        assertEquals(Color.hex("#3A3B41"), colors.surfaceBright)
        assertEquals(Color.hex("#131417"), colors.surfaceContainerLowest)
        assertEquals(Color.hex("#1D1E22"), colors.surfaceContainerLow)
        assertEquals(Color.hex("#232428"), colors.surfaceContainer)
        assertEquals(Color.hex("#2A2B30"), colors.surfaceContainerHigh)
        assertEquals(Color.hex("#333439"), colors.surfaceContainerHighest)
        assertEquals(Color.hex("#ECECEF"), colors.onSurface)
        assertEquals(Color.hex("#C9C9D0"), colors.onSurfaceVariant)
        assertEquals(Color.hex("#9C9CA5"), colors.onSurfaceMuted)
        assertEquals(Color.hex("#D9D5CB"), colors.primary)
        assertEquals(Color.hex("#141416"), colors.onPrimary)
        assertEquals(Color.hex("#EDEAE2"), colors.onPrimaryContainer)
        assertEquals(Color.hex("#000000"), colors.scrim)
    }

    @Test
    fun darkTextContrastMeetsAa() {
        val colors = Themes.dark.colors
        assertTrue(ratio(colors.onSurface, colors.surface) >= 7.0)
        assertTrue(ratio(colors.onSurfaceVariant, colors.surface) >= 4.5)
        assertTrue(ratio(colors.onSurfaceMuted, colors.surface) >= 4.5)
        assertTrue(ratio(colors.onPrimary, colors.primary) >= 4.5)
        assertTrue(ratio(colors.onPrimaryContainer, colors.primaryContainer) >= 4.5)
    }

    @Test
    fun lightThemeIsUnchanged() {
        assertEquals(Color.hex("#F2F5F7"), Themes.light.colors.surface)
        assertEquals(Color.hex("#0E2A47"), Themes.light.colors.primary)
    }
}
