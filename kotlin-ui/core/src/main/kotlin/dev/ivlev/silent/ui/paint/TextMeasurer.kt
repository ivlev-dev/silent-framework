package dev.ivlev.silent.ui.paint

import dev.ivlev.silent.ui.tokens.TextStyle

interface TextMeasurer {
    fun width(text: String, style: TextStyle): Float
    fun ascent(style: TextStyle): Float
    fun descent(style: TextStyle): Float
}

object TextLayoutCache {
    private data class Key(
        val text: String,
        val style: TextStyle,
        val maxWidth: Int,
        val maxLines: Int,
        val measurerId: Int,
    )

    private val entries = object : LinkedHashMap<Key, List<String>>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Key, List<String>>): Boolean =
            size > 512
    }

    var hits: Long = 0
        private set
    var misses: Long = 0
        private set

    fun wrap(
        text: String,
        style: TextStyle,
        maxWidth: Float,
        maxLines: Int,
        measurer: TextMeasurer,
    ): List<String> {
        val key = Key(text, style, maxWidth.toInt(), maxLines, System.identityHashCode(measurer))
        synchronized(entries) {
            entries[key]?.let {
                hits += 1
                return it
            }
            misses += 1
        }
        val result = wrapTextUncached(text, style, maxWidth, measurer, maxLines)
        synchronized(entries) {
            entries[key] = result
        }
        return result
    }

    fun clear() {
        synchronized(entries) {
            entries.clear()
            hits = 0
            misses = 0
        }
    }
}

fun wrapText(
    text: String,
    style: TextStyle,
    maxWidth: Float,
    measurer: TextMeasurer,
    maxLines: Int = Int.MAX_VALUE,
): List<String> = TextLayoutCache.wrap(text, style, maxWidth, maxLines, measurer)

private fun wrapTextUncached(
    text: String,
    style: TextStyle,
    maxWidth: Float,
    measurer: TextMeasurer,
    maxLines: Int = Int.MAX_VALUE,
): List<String> {
    val hardLines = text.split('\n')
    val result = mutableListOf<String>()
    hardLines.forEach { hardLine ->
        if (result.size >= maxLines) return@forEach
        if (hardLine.isEmpty()) {
            result.add("")
            return@forEach
        }
        if (!maxWidth.isFinite() || maxWidth <= 0f) {
            result.add(hardLine)
            return@forEach
        }
        val words = hardLine.split(' ')
        var current = ""
        words.forEach { word ->
            if (result.size >= maxLines) return@forEach
            val candidate = if (current.isEmpty()) word else "$current $word"
            if (measurer.width(candidate, style) <= maxWidth) {
                current = candidate
            } else {
                if (current.isNotEmpty()) result.add(current)
                current = ""
                if (measurer.width(word, style) <= maxWidth) {
                    current = word
                } else {
                    var chunk = ""
                    word.forEach { char ->
                        val next = chunk + char
                        if (measurer.width(next, style) <= maxWidth) {
                            chunk = next
                        } else {
                            if (chunk.isNotEmpty()) result.add(chunk)
                            chunk = char.toString()
                        }
                    }
                    current = chunk
                }
            }
        }
        if (result.size < maxLines && current.isNotEmpty()) result.add(current)
    }
    return result.ifEmpty { listOf("") }.take(maxLines)
}

fun textBlockHeight(lines: Int, style: TextStyle): Float = lines.toFloat() * style.lineHeight
