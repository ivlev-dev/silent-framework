package dev.ivlev.silent.ui.widgets

import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.Constraints
import dev.ivlev.silent.ui.layout.Rect
import dev.ivlev.silent.ui.paint.RecordingPainter
import dev.ivlev.silent.ui.paint.TextMeasurer
import dev.ivlev.silent.ui.paint.UiRenderer
import dev.ivlev.silent.ui.tokens.TextStyle
import dev.ivlev.silent.ui.tokens.Themes
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class IconTest {
    private val measurer = object : TextMeasurer {
        override fun width(text: String, style: TextStyle): Float = text.length * 7f
        override fun ascent(style: TextStyle): Float = 12f
        override fun descent(style: TextStyle): Float = 4f
    }

    private val context = BuildContext(Themes.light, measurer, 400f, 300f, 1f)

    @Test
    fun vectorIconUsesRequestedSize() {
        val icon = VectorIcon("folder", 20f)
        val size = icon.measure(context, Constraints(0f, 100f, 0f, 100f))
        assertEquals(20f, size.width)
        assertEquals(20f, size.height)
    }

    @Test
    fun vectorIconPaintsShapesWithoutText() {
        val painter = RecordingPainter()
        val node = VectorIcon("folder", 20f).build(context, Rect(0f, 0f, 20f, 20f))
        UiRenderer(painter, Themes.light, measurer).render(node)
        assertTrue(painter.commands.isNotEmpty())
        assertFalse(painter.commands.any { it is RecordingPainter.Command.Text })
    }

    @Test
    fun avatarClickRunsOnlyWithHandler() {
        var clicks = 0
        val clickable = Avatar("Алексей Лебедев", onClick = { clicks += 1 })
        assertTrue(clickable.acceptsInput)
        assertEquals("АЛ", clickable.initials)
        clickable.click()
        assertEquals(1, clicks)
        val plain = Avatar("Алексей Лебедев")
        assertFalse(plain.acceptsInput)
        plain.click()
        assertEquals(1, clicks)
    }
}
