package dev.ivlev.silent.ui.data

import dev.ivlev.silent.ui.demo.DashboardVM
import dev.ivlev.silent.ui.demo.FakeProjectsRepository
import kotlinx.datetime.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RemoteProjectsTest {
    private val sample = ApiProject(
        budget = 5000.0,
        createdAt = Instant.fromEpochMilliseconds(1_700_000_000_000),
        id = 1u,
        name = "Северный Атлас",
        owner = "Ада Ловлейс",
        status = ProjectStatus.Active,
        tags = listOf("frontend"),
    )

    private val meta = ApiProjectMeta(
        owners = listOf("Ада Ловлейс", "Алан Тьюринг"),
        statuses = ProjectStatus.entries,
        tags = listOf("frontend", "performance"),
    )

    @Test
    fun loadsDashboardAndProjectsFromTransport() {
        val transport = FakeTransport()
        val vm = DashboardVM(FakeProjectsRepository(), RemoteProjectsApi(transport, "http://test"))
        vm.refreshDashboardBlocking()
        assertEquals("", vm.dashboardError)
        assertEquals(1, vm.dashboardRows.size)
        assertEquals("240", vm.stats.first().value)
        assertEquals("60", vm.stats[1].value)
        assertEquals(listOf("Ада Ловлейс", "Алан Тьюринг"), vm.owners)

        vm.refreshProjectsBlocking()
        assertEquals(1, vm.projectRows.size)
        assertEquals(240, vm.projectTotal)
        assertEquals(DataStateName.READY, DataStateName.of(vm.projectsState))
    }

    @Test
    fun sendsSortAndStatusFilters() {
        val transport = FakeTransport()
        val vm = DashboardVM(FakeProjectsRepository(), RemoteProjectsApi(transport, "http://test"))
        vm.statusFilter.set("active")
        vm.projectSort = "name"
        vm.projectOrder = "asc"
        vm.refreshProjectsBlocking()
        val url = transport.lastUrl
        assertTrue(url.contains("status=active"))
        assertTrue(url.contains("sort=name"))
        assertTrue(url.contains("order=asc"))
    }

    @Test
    fun keepsLocalFallbackWhenServerFails() {
        val vm = DashboardVM(FakeProjectsRepository(), RemoteProjectsApi(FailingTransport, "http://test"))
        vm.refreshDashboardBlocking()
        assertTrue(vm.dashboardError.isNotEmpty())
        assertEquals(6, vm.projects.size)
        vm.refreshProjectsBlocking()
        assertTrue(vm.projectsError.isNotEmpty())
        assertEquals(6, vm.projectRows.size)
    }

    private inner class FakeTransport : HttpTransport {
        var lastUrl: String = ""

        override fun get(url: String, accept: String): HttpResponse {
            lastUrl = url
            return when {
                url.contains("/api/meta") -> HttpResponse(200, PROTOCOL_CONTENT_TYPE, ApiProjectMetaCodec.encode(meta))
                else -> {
                    val status = url.substringAfter("status=", "").substringBefore("&").takeIf { it.isNotEmpty() }
                    val total = when (status) {
                        "active" -> 60u
                        "review" -> 60u
                        "done" -> 60u
                        "paused" -> 60u
                        else -> 240u
                    }
                    val page = ApiProjectPage(
                        items = listOf(sample),
                        page = 1u,
                        pageSize = 10u,
                        total = total,
                    )
                    HttpResponse(200, PROTOCOL_CONTENT_TYPE, ApiProjectPageCodec.encode(page))
                }
            }
        }
    }

    private object FailingTransport : HttpTransport {
        override fun get(url: String, accept: String): HttpResponse = error("offline")
    }

    private enum class DataStateName {
        READY,
        LOADING,
        EMPTY,
        ERROR,
        ;

        companion object {
            fun of(state: dev.ivlev.silent.ui.widgets.DataState): DataStateName = when (state) {
                dev.ivlev.silent.ui.widgets.DataState.Ready -> READY
                dev.ivlev.silent.ui.widgets.DataState.Loading -> LOADING
                dev.ivlev.silent.ui.widgets.DataState.Empty -> EMPTY
                dev.ivlev.silent.ui.widgets.DataState.Error -> ERROR
            }
        }
    }
}
