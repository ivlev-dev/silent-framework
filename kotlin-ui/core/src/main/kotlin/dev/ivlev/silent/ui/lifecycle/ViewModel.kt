package dev.ivlev.silent.ui.lifecycle

import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.Constraints
import dev.ivlev.silent.ui.layout.RenderNode
import dev.ivlev.silent.ui.layout.Rect
import dev.ivlev.silent.ui.layout.Size
import dev.ivlev.silent.ui.layout.Widget
import dev.ivlev.silent.ui.layout.isolateWidgets
import dev.ivlev.silent.ui.reactive.AnySignal
import dev.ivlev.silent.ui.reactive.Computed
import dev.ivlev.silent.ui.reactive.Disposable
import dev.ivlev.silent.ui.reactive.Effect
import dev.ivlev.silent.ui.reactive.MutableSignal
import dev.ivlev.silent.ui.reactive.Scope
import dev.ivlev.silent.ui.reactive.Signal
import kotlin.properties.ReadWriteProperty
import kotlin.reflect.KProperty

class ReactiveProperty<T>(
    private val owner: ViewModel,
    val name: String,
    initial: T,
) : ReadWriteProperty<Any?, T>, Disposable {
    private val state: MutableSignal<T> = MutableSignal(initial)

    val signal: Signal<T>
        get() = state

    var value: T
        get() = state.value
        set(next) {
            state.set(next)
            owner.notifyUpdated()
        }

    override fun getValue(thisRef: Any?, property: KProperty<*>): T = value

    override fun setValue(thisRef: Any?, property: KProperty<*>, value: T) {
        this.value = value
    }

    internal fun readAny(): Any? = state.value

    internal fun signalAny(): AnySignal = state

    override fun dispose() {
        state.dispose()
    }
}

class WatchRegistration internal constructor(
    val selector: String,
    val immediate: Boolean,
    val block: (Any?, Any?) -> Unit,
)

abstract class ViewModel : Disposable {
    val scope: Scope = Scope()
    private val mountedState: MutableSignal<Boolean> = MutableSignal(false)
    private val disposedState: MutableSignal<Boolean> = MutableSignal(false)
    private val reactiveSignals: MutableMap<String, ReactiveProperty<*>> = LinkedHashMap()
    private val watches: MutableList<WatchRegistration> = mutableListOf()
    private var createdCalled: Boolean = false
    private var updating: Boolean = false

    open var props: Map<String, Any?> = emptyMap()

    val mounted: Boolean
        get() = mountedState.value

    val disposed: Boolean
        get() = disposedState.value

    open fun created() = Unit

    open fun beforeMount() = Unit

    open fun mounted() = Unit

    open fun updated() = Unit

    open fun beforeUnmount() = Unit

    open fun unmounted() = Unit

    open fun onDispose() = Unit

    fun mount() {
        if (disposedState.value || mountedState.value) return
        if (!createdCalled) {
            createdCalled = true
            created()
        }
        beforeMount()
        subscribeWatches()
        mountedState.set(true)
        mounted()
    }

    protected fun <T> reactive(name: String, initial: T): ReactiveProperty<T> {
        val property = ReactiveProperty(this, name, initial)
        reactiveSignals[name] = property
        scope.add(property)
        return property
    }

    protected fun <T> computedProperty(name: String, block: () -> T): Computed<T> {
        val computed = Computed(block)
        scope.add(computed)
        registerNamedSignal(name, { computed.value }, computed)
        return computed
    }

    protected fun <T> signal(initial: T): MutableSignal<T> {
        val signal = MutableSignal(initial)
        scope.add(signal)
        return signal
    }

    protected fun effect(block: () -> Unit): Effect = scope.effect(block)

    protected fun watchOf(
        selector: String,
        immediate: Boolean = false,
        block: (Any?, Any?) -> Unit,
    ): WatchRegistration {
        require(selector.isNotBlank()) { "Watch selector не может быть пустым" }
        val registration = WatchRegistration(selector, immediate, block)
        watches.add(registration)
        return registration
    }

    private class NamedSignal(val read: () -> Any?, val signal: AnySignal)

    private val namedSignals: MutableMap<String, NamedSignal> = LinkedHashMap()

    private fun registerNamedSignal(name: String, read: () -> Any?, signal: AnySignal) {
        namedSignals[name] = NamedSignal(read, signal)
    }

    private fun subscribeWatches() {
        val signals = namedSignals.toMutableMap()
        reactiveSignals.forEach { (name, property) ->
            signals[name] = NamedSignal({ property.readAny() }, property.signalAny())
        }
        watches.forEach { watch ->
            val named = signals[watch.selector]
                ?: throw IllegalStateException("Watch selector '${watch.selector}' не найден")
            var previous = named.read()
            if (watch.immediate) watch.block(previous, previous)
            scope.add(
                named.signal.subscribeAny {
                    val next = named.read()
                    val old = previous
                    previous = next
                    watch.block(next, old)
                },
            )
        }
    }

    internal fun notifyUpdated() {
        if (!mounted || disposed || updating) return
        updating = true
        try {
            updated()
        } finally {
            updating = false
        }
    }

    open override fun dispose() {
        if (disposedState.value) return
        val wasMounted = mountedState.value
        if (wasMounted) beforeUnmount()
        mountedState.set(false)
        if (wasMounted) unmounted()
        onDispose()
        disposedState.set(true)
        scope.dispose()
    }
}

interface View {
    fun content(): Widget
}

class ViewComponent(
    val viewModel: ViewModel,
    val view: View,
    private val fill: Boolean = true,
) : Widget(), Disposable {
    private var bound: Boolean = false

    private fun ensureMounted() {
        if (!bound) {
            bound = true
            viewModel.mount()
        }
    }

    override fun measure(context: BuildContext, constraints: Constraints): Size {
        ensureMounted()
        val width = if (fill && constraints.maxWidth.isFinite()) constraints.maxWidth else 0f
        val height = if (fill && constraints.maxHeight.isFinite()) constraints.maxHeight else 0f
        return constraints.constrain(Size(width, height))
    }

    override fun build(context: BuildContext, bounds: Rect): RenderNode {
        ensureMounted()
        val content = isolateWidgets { view.content() }
        val node = content.build(context, bounds)
        return RenderNode(this, bounds, listOf(node))
    }

    override fun dispose() {
        viewModel.dispose()
    }
}

fun component(viewModel: ViewModel, view: View): ViewComponent = ViewComponent(viewModel, view)

fun screen(viewModel: ViewModel, view: View): ViewComponent = ViewComponent(viewModel, view)

fun <T> screen(viewModel: T): ViewComponent where T : ViewModel, T : View =
    ViewComponent(viewModel, viewModel)
