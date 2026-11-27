package dev.ivlev.silent.ui.tokens

object Motion {
    const val fastMs: Int = 120
    const val baseMs: Int = 180
    const val slowMs: Int = 200
    fun ease(t: Float): Float {
        val x = t.coerceIn(0f, 1f)
        return x * x * (3f - 2f * x)
    }
}

object MotionSettings {
    var reducedMotion: Boolean = false
}
