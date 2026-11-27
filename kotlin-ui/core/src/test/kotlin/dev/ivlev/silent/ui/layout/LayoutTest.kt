package dev.ivlev.silent.ui.layout

import dev.ivlev.silent.ui.paint.TextMeasurer
import dev.ivlev.silent.ui.responsive.responsive
import dev.ivlev.silent.ui.tokens.Theme
import dev.ivlev.silent.ui.tokens.Themes
import dev.ivlev.silent.ui.tokens.TextStyle
import dev.ivlev.silent.ui.tokens.Typography
import dev.ivlev.silent.ui.widgets.Text
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class LayoutTest {
    private val measurer = object : TextMeasurer {
        override fun width(text: String, style: TextStyle): Float = text.length * 8f
        override fun ascent(style: TextStyle): Float = 12f
        override fun descent(style: TextStyle): Float = 4f
    }

    private fun context(width: Float, height: Float = 600f, theme: Theme = Themes.light): BuildContext =
        BuildContext(theme, measurer, width, height, 1f)

    @Test
    fun columnAppliesPaddingGapAndStretch() {
        val column = Column(gap = 8f, padding = 16f) {
            Spacer(height = 20f)
            Spacer(height = 20f)
        }
        val ctx = context(200f)
        val size = column.measure(ctx, Constraints(0f, 200f, 0f, 1000f))
        assertEquals(200f, size.width)
        assertEquals(80f, size.height)
        val node = column.build(ctx, Rect(0f, 0f, 200f, 80f))
        assertEquals(2, node.children.size)
        assertEquals(16f, node.children[0].bounds.y)
        assertEquals(168f, node.children[0].bounds.width)
        assertEquals(44f, node.children[1].bounds.y)
    }

    @Test
    fun rowSizesToContentWhenNotFilling() {
        val row = Row(gap = 8f, padding = 10f, fillWidth = false) {
            Spacer(width = 30f, height = 20f)
            Spacer(width = 40f, height = 20f)
        }
        val ctx = context(400f)
        val size = row.measure(ctx, Constraints(0f, 400f, 0f, 1000f))
        assertEquals(98f, size.width)
        assertEquals(40f, size.height)
        val node = row.build(ctx, Rect(0f, 0f, 98f, 40f))
        assertEquals(10f, node.children[0].bounds.x)
        assertEquals(48f, node.children[1].bounds.x)
    }

    @Test
    fun rowWrapFlowsChildrenToNextLine() {
        val row = Row(gap = 8f, padding = 10f, fillWidth = false, wrap = true) {
            Spacer(width = 100f, height = 20f)
            Spacer(width = 100f, height = 20f)
            Spacer(width = 100f, height = 20f)
        }
        val ctx = context(250f)
        val size = row.measure(ctx, Constraints(0f, 250f, 0f, 1000f))
        assertEquals(228f, size.width)
        assertEquals(68f, size.height)
        val node = row.build(ctx, Rect(0f, 0f, 228f, 68f))
        assertEquals(10f, node.children[0].bounds.x)
        assertEquals(118f, node.children[1].bounds.x)
        assertEquals(10f, node.children[2].bounds.x)
        assertEquals(38f, node.children[2].bounds.y)
    }

    @Test
    fun gridDistributesCellsAndRows() {
        val grid = Grid(columns = 2, gap = 10f, padding = 10f) {
            Spacer(height = 30f)
            Spacer(height = 30f)
            Spacer(height = 30f)
        }
        val ctx = context(300f)
        val size = grid.measure(ctx, Constraints(0f, 300f, 0f, 1000f))
        assertEquals(300f, size.width)
        assertEquals(90f, size.height)
        val node = grid.build(ctx, Rect(0f, 0f, 300f, 90f))
        assertEquals(3, node.children.size)
        assertEquals(135f, node.children[0].bounds.width)
        assertEquals(155f, node.children[1].bounds.x)
        assertEquals(50f, node.children[2].bounds.y)
    }

    @Test
    fun gridUsesResponsiveColumnCount() {
        val grid = Grid(columns = responsive(xs = 1, md = 2, xl = 3), gap = 0f) {
            Spacer(height = 10f)
            Spacer(height = 10f)
            Spacer(height = 10f)
        }
        val narrow = grid.build(context(400f), Rect(0f, 0f, 300f, 30f))
        assertEquals(3, narrow.children.size)
        assertEquals(300f, narrow.children[0].bounds.width)
        val wide = grid.build(context(900f), Rect(0f, 0f, 300f, 10f))
        assertEquals(100f, wide.children[0].bounds.width)
    }

    @Test
    fun textWrapsToConstraintWidth() {
        val text = Text("hello world", style = Typography.bodySmall)
        val ctx = context(64f)
        val size = text.measure(ctx, Constraints(0f, 64f, 0f, 1000f))
        assertEquals(42f, size.height)
        assertTrue(size.width <= 64f)
    }

    @Test
    fun adaptiveScaffoldSwitchesAtXl() {
        val scaffold = adaptiveScaffold(
            items = listOf(NavItem("a", "A", "A")),
            selectedId = { "a" },
            onSelect = {},
        ) {
            Spacer(height = 10f)
        }
        val wide = layoutRoot(scaffold, context(1000f), 1000f, 600f)
        assertTrue(wide.children[0].widget is NavigationRail)
        val narrow = layoutRoot(scaffold, context(839f), 839f, 600f)
        assertTrue(narrow.children.last().widget is NavigationBar)
    }

    @Test
    fun scrollClampsAndOffsetsContent() {
        val state = ScrollState()
        val scroll = Scroll(state = state) {
            Spacer(height = 800f)
        }
        val ctx = context(400f, 300f)
        val size = scroll.measure(ctx, Constraints(0f, 400f, 0f, 300f))
        assertEquals(300f, size.height)
        assertEquals(500f, state.maxOffset)
        state.scrollBy(120f)
        val node = scroll.build(ctx, Rect(0f, 0f, 400f, 300f))
        assertEquals(-120f, node.children[0].bounds.y)
        state.scrollBy(1000f)
        assertEquals(500f, state.offset.value)
    }

    @Test
    fun expandedConsumesRemainingSpace() {
        val row = Row(gap = 0f, fillWidth = true) {
            Spacer(width = 100f, height = 10f)
            expanded { Spacer() }
        }
        val ctx = context(400f)
        val node = row.build(ctx, Rect(0f, 0f, 400f, 40f))
        assertEquals(300f, node.children[1].bounds.width)
    }

    @Test
    fun contentPageUsesResponsiveGuttersAndMaxWidth() {
        val page = ContentPage(verticalPadding = 24f) {
            Spacer(height = 100f)
        }
        val narrow = page.build(context(360f), Rect(0f, 0f, 360f, 148f))
        assertEquals(16f, narrow.children[0].bounds.x)
        assertEquals(328f, narrow.children[0].bounds.width)
        val wide = page.build(context(2000f), Rect(0f, 0f, 2000f, 148f))
        assertEquals(312f, wide.children[0].bounds.x)
        assertEquals(1376f, wide.children[0].bounds.width)
        val compact = page.build(context(800f), Rect(0f, 0f, 800f, 148f))
        assertEquals(16f, compact.children[0].bounds.x)
        val expanded = page.build(context(1000f), Rect(0f, 0f, 1000f, 148f))
        assertEquals(32f, expanded.children[0].bounds.x)
    }

    private class SimpleBinding(override val key: String) : dev.ivlev.silent.ui.form.FieldBinding<String> {
        override var value: String = ""
        override val error: String? = null
        override val touched: Boolean = false
        override val valid: Boolean = true

        override fun touch() = Unit
    }

    @Test
    fun visibleTextFieldsRespectScrollClip() {
        val state = ScrollState()
        val scroll = Scroll(state = state) {
            Column {
                dev.ivlev.silent.ui.widgets.TextField(SimpleBinding("first"), label = "First")
                Spacer(height = 300f)
                dev.ivlev.silent.ui.widgets.TextField(SimpleBinding("second"), label = "Second")
            }
        }
        val ctx = context(300f, 200f)
        val first = scroll.build(ctx, Rect(0f, 0f, 300f, 200f))
        assertEquals(1, first.findVisibleTextFields().size)
        state.scrollTo(300f)
        val scrolled = scroll.build(ctx, Rect(0f, 0f, 300f, 200f))
        val visible = scrolled.findVisibleTextFields()
        assertEquals(1, visible.size)
        assertEquals("second", visible.first().first.binding.key)
    }

    @Test
    fun hitTestFindsInteractiveWidget() {
        val clicked = mutableListOf<String>()
        val screen = Screen {
            Column(padding = 10f, gap = 10f) {
                dev.ivlev.silent.ui.widgets.Button("Кнопка", onClick = { clicked.add("button") })
            }
        }
        val node = layoutRoot(screen, context(300f), 300f, 200f)
        val hit = HitTester().hit(node, 20f, 30f)
        assertTrue(hit is dev.ivlev.silent.ui.widgets.Button)
        hit.activate()
        assertEquals(listOf("button"), clicked)
    }
}
