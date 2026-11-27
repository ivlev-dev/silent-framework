package dev.ivlev.silent.ui.desktop

internal object DesktopScale {
    fun resolve(screenHeightUser: Float, osScale: Float, override: Float?): Float {
        if (override != null && override > 0f) return override
        if (osScale > 1.01f) return 1f
        if (screenHeightUser <= 0f) return 1f
        return (screenHeightUser / 1080f).coerceIn(1f, 2f)
    }
}
