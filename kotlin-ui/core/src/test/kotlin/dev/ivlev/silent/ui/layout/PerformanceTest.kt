package dev.ivlev.silent.ui.layout

import dev.ivlev.silent.ui.paint.RecordingPainter
import dev.ivlev.silent.ui.paint.TextLayoutCache
import dev.ivlev.silent.ui.paint.TextMeasurer
import dev.ivlev.silent.ui.paint.UiRenderer
import dev.ivlev.silent.ui.reactive.DependencyTracker
import dev.ivlev.silent.ui.reactive.MutableSignal
import dev.ivlev.silent.ui.tokens.TextStyle
import dev.ivlev.silent.ui.tokens.Themes
import dev.ivlev.silent.ui.tokens.Typography
import dev.ivlev.silent.ui.widgets.DataColumn
import dev.ivlev.silent.ui.widgets.DataState
import dev.ivlev.silent.ui.widgets.DataTable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PerformanceTest {
    private val measurer = object : TextMeasurer {
        override fun width(text: String, style: TextStyle): Float = text.length * 7f
        override fun ascent(style: TextStyle): Float = 12f
        override fun descent(style: TextStyle): Float = 4f
    }

    @Test
    fun damageAccumulatorMergesRegions() {
        val damage = DamageAccumulator()
        damage.add(Rect(10f, 10f, 20f, 20f))
        damage.add(Rect(80f, 40f, 30f, 10f))
        damage.add(Rect(0f, 0f, 0f, 10f))
        val merged = damage.take()
        assertEquals(Rect(10f, 10f, 100f, 40f), merged)
        assertTrue(damage.isEmpty)
    }

    @Test
    fun textLayoutCacheHitsAndInvalidates() {
        TextLayoutCache.clear()
        val first = dev.ivlev.silent.ui.paint.wrapText("Silent UI components", Typography.bodyMedium, 80f, measurer)
        val second = dev.ivlev.silent.ui.paint.wrapText("Silent UI components", Typography.bodyMedium, 80f, measurer)
        assertEquals(first, second)
        assertTrue(TextLayoutCache.hits >= 1)
        TextLayoutCache.clear()
        assertEquals(0, TextLayoutCache.hits)
    }

    @Test
    fun dependencyTrackerDoesNotFireWithoutChanges() {
        val signal = MutableSignal(1)
        var changes = 0
        val tracker = DependencyTracker { changes += 1 }
        tracker.track { signal.value }
        assertEquals(0, changes)
        signal.set(2)
        assertEquals(1, changes)
        tracker.dispose()
    }

    @Test
    fun dataTableBuildIsConstantAndRenderIsVirtualized() {
        val rows = (1..10_000).map { listOf("Row $it", "Active", "Owner", "now") }
        val table = DataTable(
            columns = listOf(
                DataColumn("name", "Name", weight = 2f),
                DataColumn("state", "State"),
                DataColumn("owner", "Owner"),
                DataColumn("updated", "Updated"),
            ),
            rows = rows,
            state = DataState.Ready,
            selectable = false,
            pageCount = 5,
        )
        val page = Scroll {
            table
        }
        val context = BuildContext(Themes.light, measurer, 800f, 600f, 1f)
        val node = layoutRoot(page, context, 800f, 600f)
        val children = node.findAllNodes()
        assertTrue(children.size < 20)
        val painter = RecordingPainter()
        UiRenderer(painter, Themes.light, measurer).render(node)
        val textCommands = painter.commands.filterIsInstance<RecordingPainter.Command.Text>()
        println("virtualization-benchmark: nodes=${children.size} renderedTextCommands=${textCommands.size} rows=${rows.size}")
        assertTrue(textCommands.size < 200)
    }

    private fun RenderNode.findAllNodes(): List<RenderNode> {
        val result = mutableListOf<RenderNode>()
        fun walk(node: RenderNode) {
            result.add(node)
            node.children.forEach(::walk)
        }
        walk(this)
        return result
    }
}
