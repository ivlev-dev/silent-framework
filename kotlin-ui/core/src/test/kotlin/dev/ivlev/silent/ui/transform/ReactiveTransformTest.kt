package dev.ivlev.silent.ui.transform

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReactiveTransformTest {
    private val transformer = ReactiveSourceTransformer()

    @Test
    fun transformsReactiveProperty() {
        val source = """
            class LoginVM {
                @Reactive var email = ""
                @Reactive var attempt = 0
            }
        """.trimIndent()
        val result = transformer.transform(source)
        assertTrue(result.source.contains("var email by reactive(\"email\", \"\")"))
        assertTrue(result.source.contains("var attempt by reactive(\"attempt\", 0)"))
        assertEquals(2, result.reactiveProperties)
        assertTrue(result.changed)
    }

    @Test
    fun transformsExplicitNullableType() {
        val source = """
            class Vm {
                @Reactive var user: String? = null
            }
        """.trimIndent()
        val result = transformer.transform(source)
        assertTrue(result.source.contains("var user: String? by reactive<String?>(\"user\", null)"))
    }

    @Test
    fun transformsComputedProperty() {
        val source = """
            class LoginVM {
                @Computed val canSubmit get() = form.isValid && !form.isSubmitting.value
            }
        """.trimIndent()
        val result = transformer.transform(source)
        assertTrue(result.source.contains("val canSubmit get() = __computed_canSubmit.value"))
        assertTrue(
            result.source.contains(
                "private val __computed_canSubmit = computedProperty(\"canSubmit\") " +
                    "{ form.isValid && !form.isSubmitting.value }",
            ),
        )
        assertEquals(1, result.computedProperties)
    }

    @Test
    fun transformsMultilineComputedProperty() {
        val source = """
            class Vm {
                @Computed val heading get() = when (selected) {
                    "a" -> "A"
                    else -> "B"
                }
            }
        """.trimIndent()
        val result = transformer.transform(source)
        assertTrue(result.source.contains("__computed_heading.value"))
        assertTrue(result.source.contains("computedProperty(\"heading\")"))
        assertTrue(result.source.contains("\"a\" -> \"A\""))
    }

    @Test
    fun transformsWatchMethod() {
        val source = """
            class Vm {
                @Watch("email", immediate = true)
                fun onEmail(next: String, prev: String) {
                    println(next + prev)
                }
            }
        """.trimIndent()
        val result = transformer.transform(source)
        assertTrue(result.source.contains("fun onEmail(next: String, prev: String)"))
        assertTrue(result.source.contains("__watch_onEmail"))
        assertTrue(result.source.contains("watchOf(\"email\", true) { next, prev ->"))
        assertTrue(result.source.contains("onEmail(next as String, prev as String)"))
        assertEquals(1, result.watchers)
    }

    @Test
    fun leavesUnannotatedSourceUntouched() {
        val source = "class Plain { val value = 1 }"
        val result = transformer.transform(source)
        assertEquals(source, result.source)
        assertEquals(0, result.reactiveProperties)
        assertTrue(!result.changed)
    }

    @Test
    fun demoViewModelsAreTransformable() {
        val text = """
            class Vm {
                @Reactive var route = Route.LOGIN
                @Reactive var dark = false
                @Computed val theme get() = if (dark) Themes.dark else Themes.light
            }
        """.trimIndent()
        val result = transformer.transform(text)
        assertTrue(result.source.contains("var route by reactive(\"route\", Route.LOGIN)"))
        assertTrue(result.source.contains("var dark by reactive(\"dark\", false)"))
        assertEquals(2, result.reactiveProperties)
        assertEquals(1, result.computedProperties)
    }
}
