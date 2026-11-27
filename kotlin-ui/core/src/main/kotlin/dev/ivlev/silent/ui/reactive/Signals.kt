package dev.ivlev.silent.ui.reactive

import java.util.IdentityHashMap

interface Disposable {
    fun dispose()
}

interface Signal<T> {
    val value: T
    fun subscribe(listener: (T) -> Unit): Disposable
}

interface AnySignal {
    fun subscribeAny(listener: () -> Unit): Disposable
}

internal object Tracking {
    class Frame {
        val signals: MutableSet<AnySignal> = LinkedHashSet()
    }

    private val frames: ThreadLocal<ArrayDeque<Frame>> = ThreadLocal.withInitial { ArrayDeque() }

    fun track(signal: AnySignal) {
        frames.get().lastOrNull()?.signals?.add(signal)
    }

    fun collect(block: () -> Unit): Set<AnySignal> {
        val frame = Frame()
        frames.get().addLast(frame)
        return try {
            block()
            frame.signals
        } finally {
            frames.get().removeLast()
        }
    }
}

internal object Batch {
    private class State {
        var depth: Int = 0
        val pending: ArrayDeque<() -> Unit> = ArrayDeque()
        val scheduled: IdentityHashMap<Any, Boolean> = IdentityHashMap()
    }

    private val state: ThreadLocal<State> = ThreadLocal.withInitial { State() }

    val isActive: Boolean
        get() = state.get().depth > 0

    fun <T> run(block: () -> T): T {
        val current = state.get()
        current.depth += 1
        try {
            return block()
        } finally {
            current.depth -= 1
            if (current.depth == 0) flush(current)
        }
    }

    fun once(key: Any, action: () -> Unit) {
        val current = state.get()
        if (current.depth == 0) {
            action()
            return
        }
        if (current.scheduled.put(key, true) == null) {
            current.pending.addLast(action)
        }
    }

    private fun flush(current: State) {
        while (current.pending.isNotEmpty()) {
            val tasks = current.pending.toList()
            current.pending.clear()
            current.scheduled.clear()
            tasks.forEach { it() }
        }
    }
}

fun <T> batch(block: () -> T): T = Batch.run(block)

class MutableSignal<T>(initial: T) : Signal<T>, AnySignal, Disposable {
    private var current: T = initial
    private val listeners: MutableList<(T) -> Unit> = mutableListOf()
    private var disposed: Boolean = false

    override val value: T
        get() {
            Tracking.track(this)
            return current
        }

    fun set(value: T) {
        if (current == value) return
        current = value
        notifyListeners(value)
    }

    fun update(transform: (T) -> T): T {
        val next = transform(current)
        set(next)
        return next
    }

    override fun subscribe(listener: (T) -> Unit): Disposable {
        if (disposed) return EmptyDisposable
        listeners.add(listener)
        return object : Disposable {
            override fun dispose() {
                listeners.remove(listener)
            }
        }
    }

    override fun subscribeAny(listener: () -> Unit): Disposable = subscribe { listener() }

    private fun notifyListeners(value: T) {
        val snapshot = listeners.toList()
        snapshot.forEach { listener ->
            Batch.once(listener) { listener(value) }
        }
    }

    override fun dispose() {
        disposed = true
        listeners.clear()
    }
}

class Computed<T>(private val compute: () -> T) : Signal<T>, AnySignal, Disposable {
    private var cached: T? = null
    private var hasValue: Boolean = false
    private var dirty: Boolean = true
    private var disposed: Boolean = false
    private val listeners: MutableList<(T) -> Unit> = mutableListOf()
    private var subscriptions: List<Disposable> = emptyList()

    override val value: T
        get() {
            if (dirty) recompute()
            Tracking.track(this)
            return cached as T
        }

    override fun subscribe(listener: (T) -> Unit): Disposable {
        if (disposed) return EmptyDisposable
        if (!hasValue) recompute()
        listeners.add(listener)
        return object : Disposable {
            override fun dispose() {
                listeners.remove(listener)
            }
        }
    }

    override fun subscribeAny(listener: () -> Unit): Disposable = subscribe { listener() }

    private fun recompute() {
        subscriptions.forEach { it.dispose() }
        val dependencies = Tracking.collect { cached = compute() }
        hasValue = true
        dirty = false
        subscriptions = dependencies.map { dependency ->
            dependency.subscribeAny { onDependencyChanged() }
        }
    }

    private fun onDependencyChanged() {
        if (disposed || dirty) return
        dirty = true
        if (listeners.isEmpty()) return
        val newValue = value
        val snapshot = listeners.toList()
        snapshot.forEach { listener -> Batch.once(listener) { listener(newValue) } }
    }

    override fun dispose() {
        disposed = true
        listeners.clear()
        subscriptions.forEach { it.dispose() }
        subscriptions = emptyList()
    }
}

class Effect(private val block: () -> Unit) : Disposable {
    private var subscriptions: List<Disposable> = emptyList()
    private var disposed: Boolean = false
    private var running: Boolean = false
    private var rerunRequested: Boolean = false

    init {
        rerun()
    }

    private fun requestRerun() {
        if (disposed) return
        if (Batch.isActive) {
            Batch.once(this) { rerun() }
        } else {
            rerun()
        }
    }

    private fun rerun() {
        if (disposed) return
        if (running) {
            rerunRequested = true
            return
        }
        running = true
        subscriptions.forEach { it.dispose() }
        val dependencies = Tracking.collect { block() }
        if (!disposed) {
            subscriptions = dependencies.map { dependency ->
                dependency.subscribeAny { requestRerun() }
            }
        }
        running = false
        if (rerunRequested) {
            rerunRequested = false
            rerun()
        }
    }

    override fun dispose() {
        disposed = true
        subscriptions.forEach { it.dispose() }
        subscriptions = emptyList()
    }
}

class Scope : Disposable {
    private val disposables: MutableList<Disposable> = mutableListOf()
    private var disposed: Boolean = false

    fun <T : Disposable> add(disposable: T): T {
        if (disposed) {
            disposable.dispose()
        } else {
            disposables.add(disposable)
        }
        return disposable
    }

    fun effect(block: () -> Unit): Effect = add(Effect(block))

    fun <T> computed(block: () -> T): Computed<T> = add(Computed(block))

    val isDisposed: Boolean
        get() = disposed

    override fun dispose() {
        if (disposed) return
        disposed = true
        disposables.asReversed().forEach { it.dispose() }
        disposables.clear()
    }
}

fun effect(scope: Scope, block: () -> Unit): Effect = scope.effect(block)

fun <T> computed(scope: Scope, block: () -> T): Computed<T> = scope.computed(block)

class DependencyTracker(private val onChange: () -> Unit) : Disposable {
    private var subscriptions: List<Disposable> = emptyList()
    private var disposed: Boolean = false

    fun track(block: () -> Unit) {
        if (disposed) return
        subscriptions.forEach { it.dispose() }
        val dependencies = Tracking.collect(block)
        subscriptions = dependencies.map { dependency ->
            dependency.subscribeAny {
                if (!disposed) onChange()
            }
        }
    }

    override fun dispose() {
        disposed = true
        subscriptions.forEach { it.dispose() }
        subscriptions = emptyList()
    }
}

internal object EmptyDisposable : Disposable {
    override fun dispose() = Unit
}
