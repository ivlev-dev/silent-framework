package dev.ivlev.silent.ui.lifecycle

import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.Constraints
import dev.ivlev.silent.ui.layout.Screen
import dev.ivlev.silent.ui.layout.layoutRoot
import dev.ivlev.silent.ui.paint.RecordingPainter
import dev.ivlev.silent.ui.paint.TextMeasurer
import dev.ivlev.silent.ui.paint.UiRenderer
import dev.ivlev.silent.ui.reactive.DependencyTracker
import dev.ivlev.silent.ui.tokens.TextStyle
import dev.ivlev.silent.ui.tokens.Themes
import dev.ivlev.silent.ui.widgets.Text
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ViewModelTest {
    private class LifecycleVM : ViewModel() {
        val events = mutableListOf<String>()
        val counter = signal(0)
        var destroyed = false

        override fun created() {
            events.add("created")
        }

        override fun beforeMount() {
            events.add("beforeMount")
        }

        override fun mounted() {
            events.add("mounted")
        }

        override fun beforeUnmount() {
            events.add("beforeUnmount")
        }

        override fun unmounted() {
            events.add("unmounted")
        }

        override fun onDispose() {
            events.add("dispose")
            destroyed = true
        }
    }

    private class WatchVM : ViewModel() {
        var title: String by reactive("title", "a")
        val changes: MutableList<Pair<Any?, Any?>> = mutableListOf()
        val watch = watchOf("title", immediate = true) { next, previous ->
            changes.add(next to previous)
        }
    }

    private class ComputedVM : ViewModel() {
        var first: Int by reactive("first", 1)
        var second: Int by reactive("second", 2)
        val sum = computedProperty("sum") { first + second }
    }

    @Test
    fun mountAndDisposeRunLifecycleInOrder() {
        val vm = LifecycleVM()
        assertFalse(vm.mounted)
        vm.mount()
        assertTrue(vm.mounted)
        assertEquals(listOf("created", "beforeMount", "mounted"), vm.events)
        vm.dispose()
        assertTrue(vm.disposed)
        assertFalse(vm.mounted)
        assertEquals(
            listOf("created", "beforeMount", "mounted", "beforeUnmount", "unmounted", "dispose"),
            vm.events,
        )
        assertTrue(vm.destroyed)
    }

    @Test
    fun reactivePropertyIsDisposedWithViewModel() {
        val vm = LifecycleVM()
        var runs = 0
        vm.scope.effect {
            runs += 1
            vm.counter.value
        }
        vm.mount()
        vm.counter.set(1)
        assertEquals(2, runs)
        vm.dispose()
        vm.counter.set(2)
        assertEquals(2, runs)
    }

    @Test
    fun watchReceivesNextAndPreviousAndDisposes() {
        val vm = WatchVM()
        vm.mount()
        assertEquals(listOf<Pair<Any?, Any?>>("a" to "a"), vm.changes)
        vm.title = "b"
        assertEquals(listOf<Pair<Any?, Any?>>("a" to "a", "b" to "a"), vm.changes)
        vm.dispose()
        vm.title = "c"
        assertEquals(2, vm.changes.size)
    }

    @Test
    fun computedPropertyMemoizesAndIsNamedForWatch() {
        val vm = ComputedVM()
        vm.mount()
        assertEquals(3, vm.sum.value)
        vm.first = 10
        assertEquals(12, vm.sum.value)
    }

    private class TitleVM : ViewModel() {
        var title: String by reactive("title", "A")
        var updated = 0

        override fun updated() {
            updated += 1
        }
    }

    private class TitleView(private val vm: TitleVM) : View {
        override fun content() = Screen {
            Text(vm.title)
        }
    }

    @Test
    fun viewContentRebuildsWhenReactiveSignalChanges() {
        val vm = TitleVM()
        val root = component(vm, TitleView(vm))
        val measurer = object : TextMeasurer {
            override fun width(text: String, style: TextStyle): Float = text.length * 8f
            override fun ascent(style: TextStyle): Float = 12f
            override fun descent(style: TextStyle): Float = 4f
        }
        val painter = RecordingPainter()
        val context = BuildContext(Themes.light, measurer, 300f, 200f, 1f)
        var invalidations = 0
        val tracker = DependencyTracker { invalidations += 1 }
        tracker.track {
            val node = layoutRoot(root, context, 300f, 200f)
            UiRenderer(painter, Themes.light, measurer).render(node)
        }
        assertTrue(vm.mounted)
        assertTrue(painter.commands.any { it is RecordingPainter.Command.Text && it.text == "A" })
        vm.title = "B"
        assertEquals(1, invalidations)
        assertEquals(1, vm.updated)
        tracker.track {
            val node = layoutRoot(root, context, 300f, 200f)
            UiRenderer(painter, Themes.light, measurer).render(node)
        }
        assertTrue(painter.commands.any { it is RecordingPainter.Command.Text && it.text == "B" })
        root.dispose()
        assertTrue(vm.disposed)
        tracker.dispose()
    }

    @Test
    fun viewComponentMountsOnMeasure() {
        val vm = LifecycleVM()
        val root = component(vm, object : View {
            override fun content() = Screen { Text("ok") }
        })
        root.measure(
            BuildContext(Themes.light, object : TextMeasurer {
                override fun width(text: String, style: TextStyle): Float = 1f
                override fun ascent(style: TextStyle): Float = 1f
                override fun descent(style: TextStyle): Float = 1f
            }, 100f, 100f, 1f),
            Constraints(0f, 100f, 0f, 100f),
        )
        assertTrue(vm.mounted)
        root.dispose()
        assertTrue(vm.disposed)
    }
}
