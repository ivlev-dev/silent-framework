package dev.ivlev.silent.ui.form

class ValueBinding<T>(
    initial: T,
    override val key: String = "",
    private val validator: (T) -> String? = { null },
) : FieldBinding<T> {
    override var value: T = initial
    override val touched: Boolean = false
    override val valid: Boolean
        get() = error == null
    override val error: String?
        get() = validator(value)

    override fun touch() = Unit
}

fun <T> bindingOf(initial: T, key: String = ""): ValueBinding<T> = ValueBinding(initial, key)

class SignalFieldBinding<T>(
    private val signal: dev.ivlev.silent.ui.reactive.MutableSignal<T>,
    override val key: String = "",
    private val validator: (T) -> String? = { null },
) : FieldBinding<T> {
    override var value: T
        get() = signal.value
        set(next) = signal.set(next)

    override val touched: Boolean = false
    override val valid: Boolean
        get() = error == null
    override val error: String?
        get() = validator(value)

    override fun touch() = Unit
}

fun <T> signalBinding(
    signal: dev.ivlev.silent.ui.reactive.MutableSignal<T>,
    key: String = "",
): SignalFieldBinding<T> = SignalFieldBinding(signal, key)
