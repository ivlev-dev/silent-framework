package dev.ivlev.silent.ui.transform

data class TransformResult(
    val source: String,
    val changed: Boolean,
    val reactiveProperties: Int = 0,
    val computedProperties: Int = 0,
    val watchers: Int = 0,
)

class ReactiveSourceTransformer {
    fun transform(source: String): TransformResult {
        val lines = source.lines()
        val output = mutableListOf<String>()
        var reactive = 0
        var computed = 0
        var watchers = 0
        var index = 0
        while (index < lines.size) {
            val line = lines[index]
            val trimmed = line.trimStart()
            when {
                trimmed.startsWith("@Reactive") -> {
                    val result = transformReactive(line, lines, index)
                    output.addAll(result.lines)
                    reactive += 1
                    index = result.nextIndex
                }

                trimmed.startsWith("@Computed") -> {
                    val result = transformComputed(line, lines, index)
                    output.addAll(result.lines)
                    computed += 1
                    index = result.nextIndex
                }

                trimmed.startsWith("@Watch") -> {
                    val result = transformWatch(line, lines, index)
                    output.addAll(result.lines)
                    watchers += 1
                    index = result.nextIndex
                }

                else -> {
                    output.add(line)
                    index += 1
                }
            }
        }
        return TransformResult(
            source = output.joinToString("\n"),
            changed = reactive + computed + watchers > 0,
            reactiveProperties = reactive,
            computedProperties = computed,
            watchers = watchers,
        )
    }

    private class Step(val lines: List<String>, val nextIndex: Int)

    private fun transformReactive(annotationLine: String, lines: List<String>, index: Int): Step {
        val indent = annotationLine.takeWhile { it.isWhitespace() }
        val rest = annotationLine.trimStart().removePrefix("@Reactive").trimStart()
        val declaration = if (rest.isNotEmpty()) rest else {
            require(index + 1 < lines.size) { "После @Reactive ожидается объявление свойства" }
            lines[index + 1].trimStart()
        }
        val consumed = if (rest.isNotEmpty()) 1 else 2
        val match = REACTIVE_PROPERTY.find(declaration)
            ?: throw IllegalArgumentException("Не удалось разобрать @Reactive: $declaration")
        val modifiers = match.groupValues[1].trim()
        val name = match.groupValues[2].trim()
        val type = match.groupValues[3].trim().ifEmpty { null }
        val initializer = match.groupValues[4].trim()
        val prefix = buildString {
            append(indent)
            if (modifiers.isNotEmpty()) append(modifiers).append(' ')
            append("var ").append(name)
            if (type != null) append(": ").append(type)
            append(" by reactive")
            if (type != null) append('<').append(type).append('>')
            append("(\"").append(name).append("\", ").append(initializer).append(')')
        }
        return Step(listOf(prefix), index + consumed)
    }

    private fun transformComputed(annotationLine: String, lines: List<String>, index: Int): Step {
        val indent = annotationLine.takeWhile { it.isWhitespace() }
        val rest = annotationLine.trimStart().removePrefix("@Computed").trimStart()
        val declaration = if (rest.isNotEmpty()) rest else {
            require(index + 1 < lines.size) { "После @Computed ожидается объявление свойства" }
            lines[index + 1].trimStart()
        }
        var consumed = if (rest.isNotEmpty()) 1 else 2
        val match = COMPUTED_PROPERTY.find(declaration)
            ?: throw IllegalArgumentException("Не удалось разобрать @Computed: $declaration")
        val modifiers = match.groupValues[1].trim()
        val name = match.groupValues[2].trim()
        val type = match.groupValues[3].trim()
        val expressionStart = match.groupValues[4]
        val expression = StringBuilder(expressionStart)
        var balance = balanceOf(expression.toString())
        while (balance > 0 && index + consumed < lines.size) {
            val next = lines[index + consumed]
            expression.append('\n').append(next)
            balance = balanceOf(expression.toString())
            consumed += 1
        }
        val declarationLine = buildString {
            append(indent)
            if (modifiers.isNotEmpty()) append(modifiers).append(' ')
            append("val ").append(name)
            if (type.isNotEmpty()) append(": ").append(type.removePrefix(":").trim())
            append(" get() = __computed_").append(name).append(".value")
        }
        val generated = buildString {
            append(indent).append("private val __computed_").append(name)
            append(" = computedProperty(\"").append(name).append("\") {")
            if (expression.contains('\n')) {
                append('\n').append(expression.toString().trimEnd()).append('\n').append(indent)
            } else {
                append(' ').append(expression.toString().trim()).append(' ')
            }
            append('}')
        }
        return Step(listOf(declarationLine, generated), index + consumed)
    }

    private fun transformWatch(annotationLine: String, lines: List<String>, index: Int): Step {
        val indent = annotationLine.takeWhile { it.isWhitespace() }
        val annotation = annotationLine.trimStart().removePrefix("@Watch")
        val annotationMatch = WATCH_ANNOTATION.find(annotation)
            ?: throw IllegalArgumentException("Не удалось разобрать @Watch: $annotationLine")
        val arguments = annotationMatch.groupValues[1]
        val selector = SELECTOR_NAMED.find(arguments)?.groupValues?.get(1)
            ?: SELECTOR_POSITIONAL.find(arguments)?.groupValues?.get(1)
            ?: throw IllegalArgumentException("@Watch требует selector")
        val immediate = IMMEDIATE.containsMatchIn(arguments)
        var methodStart = index + 1
        while (methodStart < lines.size && lines[methodStart].trimStart().isEmpty()) methodStart += 1
        require(methodStart < lines.size) { "После @Watch ожидается метод" }
        val methodLine = lines[methodStart]
        require(methodLine.contains("fun ")) { "После @Watch ожидается метод: $methodLine" }
        var methodEnd = methodStart
        var balance = 0
        var seenBrace = false
        while (methodEnd < lines.size) {
            val current = lines[methodEnd]
            current.forEach { char ->
                if (char == '{') {
                    balance += 1
                    seenBrace = true
                }
                if (char == '}') balance -= 1
            }
            if (seenBrace && balance <= 0) break
            if (!seenBrace && methodEnd > methodStart && current.trimEnd().endsWith(";")) break
            methodEnd += 1
        }
        val methodLines = lines.subList(methodStart, methodEnd + 1)
        val methodName = METHOD_NAME.find(methodLine)?.groupValues?.get(1)
            ?: throw IllegalArgumentException("Не найдено имя метода: $methodLine")
        val parameterText = METHOD_PARAMS.find(methodLine)?.groupValues?.get(1) ?: ""
        val parameters = parseParameters(parameterText)
        val callArguments = parameters.take(2).mapIndexed { position, parameter ->
            val variable = if (position == 0) "next" else "prev"
            "$variable as ${parameter.type}"
        }
        val generated = buildString {
            append(indent).append("private val __watch_").append(methodName)
            append(" = watchOf(\"").append(selector).append("\", ").append(immediate).append(") { next, prev ->")
            append('\n').append(indent).append("    ").append(methodName).append('(')
            append(callArguments.joinToString(", ")).append(')')
            append('\n').append(indent).append('}')
        }
        val result = mutableListOf<String>()
        result.addAll(methodLines)
        result.add(generated)
        return Step(result, methodEnd + 1)
    }

    private data class Parameter(val name: String, val type: String)

    private fun parseParameters(text: String): List<Parameter> {
        if (text.isBlank()) return emptyList()
        return splitTopLevel(text).mapNotNull { raw ->
            val withoutDefault = raw.substringBefore('=')
            val separator = withoutDefault.indexOf(':')
            if (separator < 0) return@mapNotNull null
            Parameter(
                name = withoutDefault.substring(0, separator).trim(),
                type = withoutDefault.substring(separator + 1).trim(),
            )
        }
    }

    private fun splitTopLevel(text: String): List<String> {
        val parts = mutableListOf<String>()
        var depth = 0
        var start = 0
        text.forEachIndexed { position, char ->
            when (char) {
                '<', '(', '[' -> depth += 1
                '>', ')', ']' -> depth -= 1
                ',' -> if (depth == 0) {
                    parts.add(text.substring(start, position))
                    start = position + 1
                }
            }
        }
        parts.add(text.substring(start))
        return parts.filter { it.isNotBlank() }
    }

    private fun balanceOf(expression: String): Int {
        var balance = 0
        expression.forEach { char ->
            when (char) {
                '(', '{', '[' -> balance += 1
                ')', '}', ']' -> balance -= 1
            }
        }
        return balance
    }

    private companion object {
        val REACTIVE_PROPERTY = Regex(
            "^(?:(public|private|protected|internal|open|override|final|lateinit)\\s+)*" +
                "var\\s+(\\w+)\\s*(?::\\s*([^=]+?))?\\s*=\\s*(.+)$",
        )
        val COMPUTED_PROPERTY = Regex(
            "^(?:(public|private|protected|internal|open|override)\\s+)*" +
                "val\\s+(\\w+)\\s*(?:(:\\s*[^=]+?))?\\s*get\\(\\)\\s*=\\s*(.+)$",
        )
        val WATCH_ANNOTATION = Regex("^\\s*\\((.*)\\)\\s*$")
        val SELECTOR_NAMED = Regex("selector\\s*=\\s*\"([^\"]+)\"")
        val SELECTOR_POSITIONAL = Regex("\"([^\"]+)\"")
        val IMMEDIATE = Regex("immediate\\s*=\\s*true")
        val METHOD_NAME = Regex("fun\\s+(\\w+)\\s*\\(")
        val METHOD_PARAMS = Regex("fun\\s+\\w+\\s*\\((.*?)\\)")
    }
}
