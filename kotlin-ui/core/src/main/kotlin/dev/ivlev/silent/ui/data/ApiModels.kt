package dev.ivlev.silent.ui.data

import dev.ivlev.silent.protocol.Proto
import dev.ivlev.silent.protocol.Uint32
import kotlinx.datetime.Instant

@Proto
data class ApiProject(
    val budget: Double,
    val createdAt: Instant,
    @Uint32 val id: UInt,
    val name: String,
    val owner: String,
    val status: ProjectStatus,
    val tags: List<String>,
)

@Proto
data class ApiProjectPage(
    val items: List<ApiProject>,
    @Uint32 val page: UInt,
    @Uint32 val pageSize: UInt,
    @Uint32 val total: UInt,
)

@Proto
data class ApiProjectMeta(
    val owners: List<String>,
    val statuses: List<ProjectStatus>,
    val tags: List<String>,
)

enum class ProjectStatus {
    Active,
    Review,
    Done,
    Paused,
}
