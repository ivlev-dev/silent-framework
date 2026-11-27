package dev.ivlev.silent.ui.widgets

import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.Rect
import dev.ivlev.silent.ui.paint.TextMeasurer
import dev.ivlev.silent.ui.tokens.TextStyle
import dev.ivlev.silent.ui.tokens.Themes
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TableInteractionTest {
    private val measurer = object : TextMeasurer {
        override fun width(text: String, style: TextStyle): Float = text.length * 7f
        override fun ascent(style: TextStyle): Float = 12f
        override fun descent(style: TextStyle): Float = 4f
    }

    private fun table(state: TableState = TableState()): DataTable = DataTable(
        columns = listOf(
            DataColumn("a", "Alpha", weight = 1f, sortable = true),
            DataColumn("b", "Beta", weight = 1f, sortable = true),
            DataColumn("c", "Gamma", weight = 1f),
        ),
        rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6")),
        selectedRows = setOf(0),
        tableState = state,
    )

    @Test
    fun reordersColumnByHeaderDrag() {
        val state = TableState()
        val table = table(state)
        val context = BuildContext(Themes.light, measurer, 600f, 400f, 1f)
        table.build(context, Rect(0f, 0f, 600f, 260f))
        table.dragStartAt(30f, 20f)
        table.dragMoveTo(520f, 20f)
        assertEquals(listOf("a", "b", "c"), state.order)
        table.dragEndAt(520f, 20f)
        assertEquals(listOf("b", "c", "a"), state.order)
        assertTrue(!state.dragActive)
    }

    @Test
    fun resizeKeepsWidthAndResetsOnDoubleClick() {
        val state = TableState()
        val table = table(state)
        val context = BuildContext(Themes.light, measurer, 600f, 400f, 1f)
        table.build(context, Rect(0f, 0f, 600f, 260f))
        val initial = table.columnWidth(Rect(0f, 0f, 600f, 260f), 0)
        table.dragStartAt(initial - 4f, 20f)
        table.dragMoveTo(initial + 46f, 20f)
        table.dragEndAt(initial + 46f, 20f)
        val resized = table.columnWidth(Rect(0f, 0f, 600f, 260f), 0)
        assertTrue(resized > initial)
        table.doubleClickAt(10f, 20f)
        assertEquals(initial, table.columnWidth(Rect(0f, 0f, 600f, 260f), 0), 1f)
    }

    @Test
    fun densityChangesRowHeight() {
        val state = TableState()
        val table = table(state)
        assertEquals(56f, table.rowHeight)
        state.density = TableDensity.Compact
        assertEquals(48f, table.rowHeight)
        state.density = TableDensity.Comfortable
        assertEquals(64f, table.rowHeight)
    }

    @Test
    fun clickSelectsRowAndHeaderSorts() {
        val state = TableState()
        var selectedRow = -1
        var sorted = ""
        val table = DataTable(
            columns = listOf(DataColumn("a", "Alpha", weight = 1f, sortable = true)),
            rows = listOf(listOf("1"), listOf("2")),
            onSelectRow = { index, _ -> selectedRow = index },
            onSort = { sorted = it },
            tableState = state,
            selectable = true,
        )
        val context = BuildContext(Themes.light, measurer, 600f, 400f, 1f)
        table.build(context, Rect(0f, 0f, 600f, 260f))
        table.activateAt(20f, 80f)
        assertEquals(0, selectedRow)
        table.activateAt(20f, 20f)
        assertEquals("a", sorted)
    }

    @Test
    fun compactTagUsesSmallHeight() {
        val context = BuildContext(Themes.light, measurer, 300f, 200f, 1f)
        val normal = Tag("Готово", TagTone.Primary)
        val compact = Tag("Готово", TagTone.Primary, compact = true)
        assertEquals(24f, normal.measure(context, dev.ivlev.silent.ui.layout.Constraints(0f, 300f, 0f, 100f)).height)
        assertEquals(20f, compact.measure(context, dev.ivlev.silent.ui.layout.Constraints(0f, 300f, 0f, 100f)).height)
    }

    @Test
    fun footerSlotsContainCompactPagesAndPageSize() {
        val table = DataTable(
            columns = listOf(DataColumn("a", "Alpha", weight = 1f)),
            rows = (1..10).map { listOf(it.toString()) },
            page = 5,
            pageCount = 24,
            pageSize = 10,
            totalRows = 240,
        )
        val slots = table.footerSlots(Rect(0f, 0f, 1080f, 600f))
        val labels = slots.map { it.label }
        assertTrue("1" in labels)
        assertTrue("5" in labels)
        assertTrue("24" in labels)
        assertTrue("…" in labels)
        assertTrue("Строк: 10" in labels)
        assertTrue(slots.any { it.kind == DataTable.FooterKind.First })
        assertTrue(slots.any { it.kind == DataTable.FooterKind.Last })
        assertEquals(DataTable.FooterKind.PageSize, slots.last().kind)
    }
}
