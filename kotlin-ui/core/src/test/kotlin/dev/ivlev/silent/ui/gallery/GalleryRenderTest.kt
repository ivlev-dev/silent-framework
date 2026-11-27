package dev.ivlev.silent.ui.gallery

import dev.ivlev.silent.ui.demo.GalleryVM
import dev.ivlev.silent.ui.demo.GalleryView
import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.Constraints
import dev.ivlev.silent.ui.layout.layoutRoot
import dev.ivlev.silent.ui.paint.RecordingPainter
import dev.ivlev.silent.ui.paint.TextMeasurer
import dev.ivlev.silent.ui.paint.UiRenderer
import dev.ivlev.silent.ui.tokens.TextStyle
import dev.ivlev.silent.ui.tokens.Themes
import kotlin.test.Test
import kotlin.test.assertTrue

class GalleryRenderTest {
    private val measurer = object : TextMeasurer {
        override fun width(text: String, style: TextStyle): Float = text.length * 7.5f
        override fun ascent(style: TextStyle): Float = 12f
        override fun descent(style: TextStyle): Float = 4f
    }

    @Test
    fun allSectionsRenderAtBreakpointsWithoutHorizontalOverflow() {
        val widths = listOf(360f, 390f, 840f, 1440f, 3840f)
        val sections = listOf("foundations", "forms", "navigation", "data", "extras")
        widths.forEach { width ->
            sections.forEach { section ->
                val vm = GalleryVM()
                vm.section.set(section)
                val view = GalleryView(vm, onBack = {}, onToggleTheme = {})
                val painter = RecordingPainter()
                val theme = if (section == "extras") Themes.dark else Themes.light
                val context = BuildContext(theme, measurer, width, 900f, 1f)
                val node = layoutRoot(view.content(), context, width, 900f)
                UiRenderer(painter, theme, measurer).render(node)
                assertTrue(node.bounds.width <= width + 0.5f)
                val widest = widestNode(node)
                assertTrue(
                    widest.bounds.right <= width + 1f,
                    "overflow width=$width section=$section right=${widest.bounds.right} widget=${widest.widget::class.simpleName}",
                )
                vm.dispose()
            }
        }
    }

    private fun widestNode(node: dev.ivlev.silent.ui.layout.RenderNode): dev.ivlev.silent.ui.layout.RenderNode {
        var result = node
        node.children.forEach { child ->
            val candidate = widestNode(child)
            if (candidate.bounds.right > result.bounds.right) result = candidate
        }
        return result
    }

    @Test
    fun everySectionProducesContent() {
        val vm = GalleryVM()
        val view = GalleryView(vm, onBack = {}, onToggleTheme = {})
        val context = BuildContext(Themes.light, measurer, 1200f, 900f, 1f)
        listOf("foundations", "forms", "navigation", "data", "extras").forEach { section ->
            vm.section.set(section)
            val node = layoutRoot(view.content(), context, 1200f, 900f)
            assertTrue(node.children.isNotEmpty())
        }
        vm.dispose()
    }
}
