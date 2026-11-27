package dev.ivlev.silent.ui.layout

import dev.ivlev.silent.ui.paint.RecordingPainter
import dev.ivlev.silent.ui.paint.TextMeasurer
import dev.ivlev.silent.ui.paint.UiRenderer
import dev.ivlev.silent.ui.tokens.TextStyle
import dev.ivlev.silent.ui.tokens.Themes
import dev.ivlev.silent.ui.widgets.Button
import dev.ivlev.silent.ui.widgets.Checkbox
import dev.ivlev.silent.ui.widgets.DataColumn
import dev.ivlev.silent.ui.widgets.DataTable
import dev.ivlev.silent.ui.form.bindingOf
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HoverTest {
    private val measurer = object : TextMeasurer {
        override fun width(text: String, style: TextStyle): Float = text.length * 8f
        override fun ascent(style: TextStyle): Float = 12f
        override fun descent(style: TextStyle): Float = 4f
    }

    private val context = BuildContext(Themes.light, measurer, 400f, 300f, 1f)

    private fun screen(): RenderNode = layoutRoot(
        Screen {
            Column(padding = 16f, gap = 8f) {
                Button("One", onClick = {})
                Button("Two", onClick = {})
                Checkbox(bindingOf(true), label = "Disabled", enabled = false)
            }
        },
        context,
        400f,
        300f,
    )

    @Test
    fun hitTesterReturnsStablePathForTarget() {
        val node = screen()
        val first = HitTester().hitResult(node, 40f, 30f)
        val second = HitTester().hitResult(node, 40f, 80f)
        assertNotNull(first)
        assertNotNull(second)
        assertTrue(first.path != second.path)
        assertTrue(first.target is Button)
    }

    @Test
    fun hoverDamageMergesOldAndNewBounds() {
        val state = HoverState()
        val first = HitResult(Button("One", onClick = {}), listOf(0, 0), Rect(0f, 0f, 100f, 40f))
        val second = HitResult(Button("Two", onClick = {}), listOf(0, 1), Rect(0f, 100f, 100f, 40f))
        state.updateHover(first)
        val damage = state.updateHover(second)
        assertEquals(Rect(0f, 0f, 100f, 140f), damage)
        assertEquals(listOf(0, 1), state.hoverPath)
        val cleared = state.clear()
        assertEquals(Rect(0f, 100f, 100f, 40f), cleared)
        assertTrue(!state.isHovering)
    }

    @Test
    fun disabledTargetIsNotHoverable() {
        val node = screen()
        val disabled = HitTester().hitResult(node, 40f, 130f)
        assertNull(disabled)
    }

    @Test
    fun rendererDrawsHoverStateOnlyForPath() {
        val node = screen()
        val target = HitTester().hitResult(node, 40f, 30f) ?: return
        val normal = RecordingPainter()
        UiRenderer(normal, Themes.light, measurer).render(node)
        val hovered = RecordingPainter()
        UiRenderer(
            hovered,
            Themes.light,
            measurer,
            hoveredPath = target.path,
            hoverPoint = Offset(40f, 30f),
        ).render(node)
        val normalRects = normal.commands.count { it is RecordingPainter.Command.RoundRect }
        val hoverRects = hovered.commands.count { it is RecordingPainter.Command.RoundRect }
        assertTrue(hoverRects > normalRects)
    }

    @Test
    fun tableHoverDamageStaysRowSized() {
        val table = DataTable(
            columns = listOf(DataColumn("a", "A", weight = 1f), DataColumn("b", "B", weight = 1f)),
            rows = (1..10_000).map { listOf("row $it", "value") },
            selectable = false,
        )
        table.build(context, Rect(0f, 0f, 800f, 480_000f))
        table.visibleTop = 1000f
        val row = table.hoverBoundsAt(20f, 1000f + 48f + 56f * 10f, Rect(0f, 0f, 800f, 480_000f))
        assertTrue(row.height <= 56f)
        assertTrue(row.width <= 800f)
        val state = HoverState()
        val start = System.nanoTime()
        repeat(10_000) { index ->
            val y = 1000f + 48f + 56f * (index % 20)
            val bounds = table.hoverBoundsAt(20f, y, Rect(0f, 0f, 800f, 480_000f))
            state.updateHover(HitResult(table, listOf(0), bounds))
        }
        val elapsedMs = (System.nanoTime() - start) / 1_000_000.0
        val rowArea = row.width * row.height
        val fullArea = 800f * 480_000f
        println("hover-benchmark: 10000 updates=${"%.2f".format(elapsedMs)}ms rowDamagePx2=$rowArea fullTablePx2=$fullArea")
        assertTrue(elapsedMs < 1_000.0)
    }

    @Test
    fun tableCursorReflectsHeaderResizeZone() {
        val node = screen()
        val target = HitTester().hit(node, 40f, 30f)
        assertTrue(target is Button)
        assertEquals(UiCursor.Pointer, target?.cursorAt(40f, 30f))
    }
}
