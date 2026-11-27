package dev.ivlev.silent.ui.responsive

import kotlin.test.Test
import kotlin.test.assertEquals

class BreakpointTest {
    @Test
    fun breakpointsMatchSourceTokens() {
        assertEquals(
            listOf(0f, 360f, 480f, 600f, 840f, 1200f, 1600f, 1920f, 2560f, 3840f),
            Breakpoint.ordered.map { it.minWidth },
        )
        assertEquals(
            listOf("xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"),
            Breakpoint.ordered.map { it.token },
        )
    }

    @Test
    fun resolvesBoundaryValues() {
        assertEquals(Breakpoint.XS, Breakpoint.forWidth(0f))
        assertEquals(Breakpoint.XS, Breakpoint.forWidth(359.9f))
        assertEquals(Breakpoint.SM, Breakpoint.forWidth(360f))
        assertEquals(Breakpoint.SM, Breakpoint.forWidth(479f))
        assertEquals(Breakpoint.MD, Breakpoint.forWidth(480f))
        assertEquals(Breakpoint.XL, Breakpoint.forWidth(840f))
        assertEquals(Breakpoint.XXL, Breakpoint.forWidth(1200f))
        assertEquals(Breakpoint.XXXXXXL, Breakpoint.forWidth(3840f))
        assertEquals(Breakpoint.XXXXXXL, Breakpoint.forWidth(5000f))
    }

    @Test
    fun responsiveUsesMobileFirstFallbacks() {
        val columns = responsive(xs = 1, md = 2, xl = 3)
        assertEquals(1, columns.resolve(0f))
        assertEquals(1, columns.resolve(479f))
        assertEquals(2, columns.resolve(480f))
        assertEquals(2, columns.resolve(839f))
        assertEquals(3, columns.resolve(840f))
        assertEquals(3, columns.resolve(3840f))
    }

    @Test
    fun explicitHigherBreakpointsOverride() {
        val value = responsive(xs = "a", sm = "b", lg = "c", `2xl` = "d")
        assertEquals("a", value.resolve(10f))
        assertEquals("b", value.resolve(360f))
        assertEquals("b", value.resolve(599f))
        assertEquals("c", value.resolve(600f))
        assertEquals("c", value.resolve(1199f))
        assertEquals("d", value.resolve(1200f))
    }

    @Test
    fun tokenLookup() {
        assertEquals(Breakpoint.MD, Breakpoint.fromToken("md"))
        assertEquals(Breakpoint.XXL, Breakpoint.fromToken("2xl"))
    }
}
