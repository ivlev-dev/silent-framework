package dev.ivlev.silent.ui.data

import kotlin.test.Test
import kotlin.test.assertEquals

class ApiModelsTest {
    private val projectHex =
        "000000008092b04080a0abfef962f10112d09fd0bbd0b0d182d184d0bed180d0bcd0b015d090d0b4d0b020d09bd0bed0b2d0bbd0b5d0b9d18101020361706904646f6373"

    @Test
    fun decodesRustProjectVector() {
        val project = ApiProjectCodec.decode(bytes(projectHex))
        assertEquals(241u, project.id)
        assertEquals("Платформа", project.name)
        assertEquals("Ада Ловлейс", project.owner)
        assertEquals(ProjectStatus.Review, project.status)
        assertEquals(listOf("api", "docs"), project.tags)
        assertEquals(4242.5, project.budget)
        assertEquals(1_700_000_000_000L, project.createdAt.toEpochMilliseconds())
    }

    @Test
    fun encodesQueryWithFilters() {
        val query = ProjectQuery(
            page = 2,
            pageSize = 20,
            sort = "name",
            order = "asc",
            q = "северный атлас",
            status = ProjectStatus.Active,
            owner = "Ада Ловлейс",
            tag = "front end",
        )
        val value = query.toQueryString()
        assertEquals(
            "page=2&pageSize=20&sort=name&order=asc&q=%D1%81%D0%B5%D0%B2%D0%B5%D1%80%D0%BD%D1%8B%D0%B9+%D0%B0%D1%82%D0%BB%D0%B0%D1%81&status=active&owner=%D0%90%D0%B4%D0%B0+%D0%9B%D0%BE%D0%B2%D0%BB%D0%B5%D0%B9%D1%81&tag=front+end",
            value,
        )
    }

    private fun bytes(hex: String): ByteArray {
        val result = ByteArray(hex.length / 2)
        for (index in result.indices) {
            result[index] = hex.substring(index * 2, index * 2 + 2).toInt(16).toByte()
        }
        return result
    }
}
