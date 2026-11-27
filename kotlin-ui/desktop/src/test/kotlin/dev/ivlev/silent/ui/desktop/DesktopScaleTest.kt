package dev.ivlev.silent.ui.desktop

import kotlin.test.Test
import kotlin.test.assertEquals

class DesktopScaleTest {
    @Test
    fun scaleFollowsScreenHeightInUserSpace() {
        assertEquals(1f, DesktopScale.resolve(1080f, 1f, null))
        assertEquals(1.3333334f, DesktopScale.resolve(1440f, 1f, null), 0.0001f)
        assertEquals(2f, DesktopScale.resolve(2160f, 1f, null))
        assertEquals(1f, DesktopScale.resolve(720f, 1f, null))
    }

    @Test
    fun osScaleKeepsLogicalScaleAtOne() {
        assertEquals(1f, DesktopScale.resolve(1080f, 2f, null))
        assertEquals(1f, DesktopScale.resolve(1440f, 1.5f, null))
    }

    @Test
    fun overrideWins() {
        assertEquals(1.5f, DesktopScale.resolve(1080f, 1f, 1.5f))
        assertEquals(2f, DesktopScale.resolve(2160f, 2f, 2f))
    }
}
