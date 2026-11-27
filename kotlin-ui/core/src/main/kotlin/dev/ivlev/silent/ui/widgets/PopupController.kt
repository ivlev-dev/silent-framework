package dev.ivlev.silent.ui.widgets

import dev.ivlev.silent.ui.reactive.MutableSignal

enum class PopupKey {
    Up,
    Down,
    Home,
    End,
    Enter,
    Escape,
}

object PopupController {
    private val openIdSignal = MutableSignal<String?>(null)
    val highlighted = MutableSignal(0)
    private var keyHandler: ((PopupKey) -> Boolean)? = null

    val openId: String?
        get() = openIdSignal.value

    fun isOpen(id: String): Boolean = openIdSignal.value == id

    fun toggle(id: String, selectedIndex: Int = 0) {
        if (openIdSignal.value == id) {
            close()
        } else {
            openIdSignal.set(id)
            highlighted.set(selectedIndex.coerceAtLeast(0))
            keyHandler = null
        }
    }

    fun close() {
        if (openIdSignal.value != null) openIdSignal.set(null)
        highlighted.set(0)
        keyHandler = null
    }

    fun installHandler(handler: (PopupKey) -> Boolean) {
        keyHandler = handler
    }

    fun handleKey(key: PopupKey): Boolean = keyHandler?.invoke(key) ?: false
}
