package dev.ivlev.silent.ui.di

import dev.ivlev.silent.ui.reactive.Disposable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine
import kotlin.reflect.KClass

enum class Lifetime {
    SINGLETON,
    SCOPED,
    TRANSIENT,
}

class MissingDependencyException(val type: KClass<*>) :
    IllegalStateException("Не зарегистрирована зависимость: ${type.qualifiedName}")

class AmbiguousDependencyException(
    val type: KClass<*>,
    val candidates: List<KClass<*>>,
) : IllegalStateException(
    "Неоднозначная зависимость ${type.qualifiedName}: " +
        candidates.joinToString(", ") { it.qualifiedName ?: it.toString() },
)

class CircularDependencyException(val chain: List<KClass<*>>) : IllegalStateException(
    "Цикл зависимостей: " + chain.joinToString(" -> ") { it.qualifiedName ?: it.toString() },
)

class ContainerDisposedException : IllegalStateException("Контейнер уже освобождён")

class DependencyContainer internal constructor(
    private val parent: DependencyContainer? = null,
) : Disposable {
    private sealed interface Definition {
        class Factory(
            val lifetime: Lifetime,
            val factory: (DependencyContainer) -> Any,
        ) : Definition

        class Alias(val target: KClass<*>) : Definition

        class Ambiguous(val candidates: List<KClass<*>>) : Definition
    }

    private val definitions: MutableMap<KClass<*>, Definition> = LinkedHashMap()
    private val singletons: MutableMap<KClass<*>, Any> = LinkedHashMap()
    private val scoped: MutableMap<KClass<*>, Any> = LinkedHashMap()
    private val children: MutableList<DependencyContainer> = mutableListOf()
    private val root: DependencyContainer = parent?.root ?: this
    private val resolving: ArrayDeque<KClass<*>> = ArrayDeque()
    private val lock: Any = Any()
    private var disposed: Boolean = false
    private var executorRef: ExecutorService? = null

    val isDisposed: Boolean
        get() = disposed

    fun <T : Any> registerFactory(
        type: KClass<T>,
        lifetime: Lifetime = Lifetime.SINGLETON,
        factory: (DependencyContainer) -> T,
    ) {
        definitions[type] = Definition.Factory(lifetime, factory)
    }

    fun <T : Any> registerAlias(type: KClass<T>, target: KClass<out T>) {
        definitions[type] = Definition.Alias(target)
    }

    fun <T : Any> registerAmbiguous(type: KClass<T>, candidates: List<KClass<out T>>) {
        definitions[type] = Definition.Ambiguous(candidates)
    }

    inline fun <reified T : Any> bind(
        lifetime: Lifetime = Lifetime.SINGLETON,
        noinline factory: DependencyContainer.() -> T,
    ) {
        registerFactory(T::class, lifetime) { container -> container.factory() }
    }

    inline fun <reified T : Any> singleton(noinline factory: DependencyContainer.() -> T) {
        bind(Lifetime.SINGLETON, factory)
    }

    inline fun <reified T : Any> scoped(noinline factory: DependencyContainer.() -> T) {
        bind(Lifetime.SCOPED, factory)
    }

    inline fun <reified T : Any> transient(noinline factory: DependencyContainer.() -> T) {
        bind(Lifetime.TRANSIENT, factory)
    }

    fun <T : Any> resolve(type: KClass<T>): T {
        synchronized(root.lock) {
            @Suppress("UNCHECKED_CAST")
            return resolveInternal(type, this) as T
        }
    }

    inline fun <reified T : Any> resolve(): T = resolve(T::class)

    fun <T : Any> resolveOrNull(type: KClass<T>): T? =
        try {
            resolve(type)
        } catch (_: MissingDependencyException) {
            null
        }

    inline fun <reified T : Any> resolveOrNull(): T? = resolveOrNull(T::class)

    suspend fun <T : Any> resolveAsync(type: KClass<T>): T = suspendCoroutine { continuation ->
        executor().execute {
            runCatching { resolve(type) }
                .onSuccess(continuation::resume)
                .onFailure(continuation::resumeWithException)
        }
    }

    suspend inline fun <reified T : Any> resolveAsync(): T = resolveAsync(T::class)

    fun createScope(): DependencyContainer {
        checkNotDisposed()
        val child = DependencyContainer(this)
        children.add(child)
        return child
    }

    fun autoLoad(): DependencyContainer {
        checkNotDisposed()
        try {
            val generated = Class.forName("dev.ivlev.silent.ui.di.generated.GeneratedDi")
            val method = generated.getMethod("register", DependencyContainer::class.java)
            method.invoke(null, this)
        } catch (_: ClassNotFoundException) {
        } catch (_: NoSuchMethodException) {
        }
        return this
    }

    private fun resolveInternal(type: KClass<*>, requester: DependencyContainer): Any {
        checkNotDisposed()
        val definition = findDefinition(type) ?: throw MissingDependencyException(type)
        return when (definition) {
            is Definition.Alias -> resolveInternal(definition.target, requester)
            is Definition.Ambiguous -> throw AmbiguousDependencyException(type, definition.candidates)
            is Definition.Factory -> resolveFactory(type, definition, requester)
        }
    }

    private fun resolveFactory(
        type: KClass<*>,
        definition: Definition.Factory,
        requester: DependencyContainer,
    ): Any {
        val cache: MutableMap<KClass<*>, Any>? = when (definition.lifetime) {
            Lifetime.SINGLETON -> root.singletons
            Lifetime.SCOPED -> requester.scoped
            Lifetime.TRANSIENT -> null
        }
        cache?.get(type)?.let { return it }
        if (resolving.contains(type)) {
            val chain = resolving.toList() + type
            throw CircularDependencyException(chain)
        }
        resolving.addLast(type)
        try {
            val resolver = if (definition.lifetime == Lifetime.SINGLETON) root else requester
            val instance = definition.factory(resolver)
            cache?.put(type, instance)
            return instance
        } finally {
            resolving.removeLast()
        }
    }

    private fun findDefinition(type: KClass<*>): Definition? {
        definitions[type]?.let { return it }
        return parent?.findDefinition(type)
    }

    private fun checkNotDisposed() {
        if (disposed) throw ContainerDisposedException()
    }

    override fun dispose() {
        synchronized(root.lock) {
            if (disposed) return
            disposed = true
            children.toList().forEach { it.dispose() }
            children.clear()
            scoped.values.forEach(::disposeInstance)
            scoped.clear()
            if (this === root) {
                singletons.values.forEach(::disposeInstance)
                singletons.clear()
                executorRef?.shutdownNow()
            }
        }
    }

    private fun executor(): ExecutorService =
        executorRef ?: Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "silent-di").apply { isDaemon = true }
        }.also { executorRef = it }

    private fun disposeInstance(instance: Any) {
        when (instance) {
            is Disposable -> instance.dispose()
            is AutoCloseable -> runCatching { instance.close() }
        }
    }

    companion object {
        fun auto(): DependencyContainer = DependencyContainer().autoLoad()

        fun empty(): DependencyContainer = DependencyContainer()
    }
}

fun container(
    autoLoad: Boolean = true,
    block: DependencyContainer.() -> Unit = {},
): DependencyContainer {
    val container = DependencyContainer.empty()
    if (autoLoad) container.autoLoad()
    container.block()
    return container
}
