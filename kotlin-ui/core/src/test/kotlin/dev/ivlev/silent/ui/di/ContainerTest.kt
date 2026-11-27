package dev.ivlev.silent.ui.di

import dev.ivlev.silent.ui.demo.AppVM
import dev.ivlev.silent.ui.demo.AuthApi
import dev.ivlev.silent.ui.demo.FakeAuthApi
import dev.ivlev.silent.ui.demo.LoginVM
import dev.ivlev.silent.ui.demo.ProjectsRepository
import dev.ivlev.silent.ui.reactive.Disposable
import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotSame
import kotlin.test.assertSame
import kotlin.test.assertTrue

class ContainerTest {
    private interface Api
    private class ApiImpl : Api
    private class Service(val api: Api)
    private class ScopedThing
    private class DisposableThing : Disposable {
        var disposed = false
        override fun dispose() {
            disposed = true
        }
    }

    private interface MissingApi

    private class NodeA(val b: NodeB)
    private class NodeB(val a: NodeA)

    @Test
    fun resolvesSingletonWithConstructorInjection() {
        val container = container(autoLoad = false) {
            singleton<Api> { ApiImpl() }
            singleton<Service> { Service(resolve()) }
        }
        val service = container.resolve<Service>()
        assertTrue(service.api is ApiImpl)
        assertSame(container.resolve<Api>(), service.api)
        assertSame(container.resolve<Service>(), service)
    }

    @Test
    fun transientCreatesNewInstances() {
        val container = container(autoLoad = false) {
            transient<Api> { ApiImpl() }
        }
        assertNotSame(container.resolve<Api>(), container.resolve<Api>())
    }

    @Test
    fun scopedCachesPerScope() {
        val container = container(autoLoad = false) {
            scoped<ScopedThing> { ScopedThing() }
        }
        val child = container.createScope()
        val rootInstance = container.resolve<ScopedThing>()
        val childInstance = child.resolve<ScopedThing>()
        assertNotSame(rootInstance, childInstance)
        assertSame(childInstance, child.resolve<ScopedThing>())
    }

    @Test
    fun missingDependencyReportsType() {
        val container = container(autoLoad = false)
        val error = assertFailsWith<MissingDependencyException> {
            container.resolve<MissingApi>()
        }
        assertEquals(MissingApi::class, error.type)
    }

    @Test
    fun detectsCircularDependency() {
        val container = container(autoLoad = false) {
            singleton<NodeA> { NodeA(resolve()) }
            singleton<NodeB> { NodeB(resolve()) }
        }
        val error = assertFailsWith<CircularDependencyException> {
            container.resolve<NodeA>()
        }
        assertEquals(NodeA::class, error.chain.first())
        assertEquals(NodeA::class, error.chain.last())
    }

    @Test
    fun ambiguousDependencyListsCandidates() {
        val container = container(autoLoad = false) {
            registerAmbiguous<Api>(Api::class, listOf(ApiImpl::class, OtherApi::class))
        }
        val error = assertFailsWith<AmbiguousDependencyException> {
            container.resolve<Api>()
        }
        assertEquals(Api::class, error.type)
        assertEquals(2, error.candidates.size)
    }

    private class OtherApi : Api

    @Test
    fun disposeCallsDisposableSingletons() {
        val container = container(autoLoad = false) {
            singleton<DisposableThing> { DisposableThing() }
        }
        val thing = container.resolve<DisposableThing>()
        container.dispose()
        assertTrue(thing.disposed)
        assertFailsWith<ContainerDisposedException> { container.resolve<DisposableThing>() }
    }

    @Test
    fun resolveAsyncCompletes() {
        val container = container(autoLoad = false) {
            singleton<Api> { ApiImpl() }
        }
        var result: Api? = null
        var failure: Throwable? = null
        val block: suspend () -> Unit = {
            result = container.resolveAsync<Api>()
        }
        block.startCoroutine(object : Continuation<Unit> {
            override val context = EmptyCoroutineContext
            override fun resumeWith(resumeResult: Result<Unit>) {
                failure = resumeResult.exceptionOrNull()
            }
        })
        val deadline = System.currentTimeMillis() + 2000
        while (result == null && failure == null && System.currentTimeMillis() < deadline) {
            Thread.sleep(10)
        }
        assertTrue(result is ApiImpl)
        container.dispose()
    }

    @Test
    fun autoContainerResolvesGraphWithoutBindings() {
        val container = container()
        val api = container.resolve<AuthApi>()
        assertTrue(api is FakeAuthApi)
        val login = container.resolve<LoginVM>()
        assertSame(login, container.resolve<LoginVM>())
        assertTrue(login.form.email.isEmpty())
        val repository = container.resolve<ProjectsRepository>()
        assertTrue(repository.projects().isNotEmpty())
        val app = container.resolve<AppVM>()
        assertSame(login, app.login)
        assertTrue(app.dashboard.stats.isNotEmpty())
        container.dispose()
    }

    @Test
    fun autoContainerCanBeScoped() {
        val root = container()
        val scope = root.createScope()
        val first = scope.resolve<LoginVM>()
        val second = scope.resolve<LoginVM>()
        assertSame(first, second)
        root.dispose()
    }
}
