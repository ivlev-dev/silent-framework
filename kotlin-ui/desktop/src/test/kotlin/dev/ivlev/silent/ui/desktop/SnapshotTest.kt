package dev.ivlev.silent.ui.desktop

import dev.ivlev.silent.ui.demo.Route
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertTrue

class SnapshotTest {
    @Test
    fun rendersLoginAndDashboardOffscreen() {
        val login = Files.createTempFile("silent-ui-login", ".png")
        val dashboard = Files.createTempFile("silent-ui-dashboard", ".png")
        val ultra = Files.createTempFile("silent-ui-4k", ".png")
        renderSnapshot(login, Route.LOGIN, dark = false, width = 960, height = 720)
        renderSnapshot(dashboard, Route.DASHBOARD, dark = true, width = 1280, height = 800)
        renderSnapshot(ultra, Route.DASHBOARD, dark = false, width = 3840, height = 2160)
        assertTrue(Files.size(login) > 2_000)
        assertTrue(Files.size(dashboard) > 2_000)
        assertTrue(Files.size(ultra) > 2_000)
        Files.deleteIfExists(login)
        Files.deleteIfExists(dashboard)
        Files.deleteIfExists(ultra)
    }

    @Test
    fun textMeasurerReturnsPositiveMetrics() {
        val measurer = SkikoTextMeasurer()
        assertTrue(measurer.width("Silent UI", dev.ivlev.silent.ui.tokens.Typography.bodyMedium) > 0f)
        assertTrue(measurer.ascent(dev.ivlev.silent.ui.tokens.Typography.bodyMedium) > 0f)
    }
}
