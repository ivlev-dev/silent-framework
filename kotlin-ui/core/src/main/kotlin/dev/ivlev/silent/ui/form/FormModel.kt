package dev.ivlev.silent.ui.form

import dev.ivlev.silent.ui.reactive.Computed
import dev.ivlev.silent.ui.reactive.MutableSignal
import dev.ivlev.silent.ui.reactive.Signal
import kotlin.properties.ReadWriteProperty
import kotlin.reflect.KMutableProperty0
import kotlin.reflect.KProperty

interface FieldBinding<T> {
    var value: T
    val error: String?
    val touched: Boolean
    val valid: Boolean
    val key: String
        get() = ""
    fun touch()
}

internal fun isEmptyValue(value: Any?): Boolean = when (value) {
    null -> true
    is CharSequence -> value.isBlank()
    is Collection<*> -> value.isEmpty()
    is Map<*, *> -> value.isEmpty()
    is Boolean -> !value
    else -> false
}

class FieldDelegate<T> internal constructor(
    private val initialValue: T,
) : FieldBinding<T>, ReadWriteProperty<Any?, T> {
    private val state = MutableSignal(initialValue)
    private val touchedState = MutableSignal(false)
    private val serverErrorState = MutableSignal<String?>(null)
    private val validators: MutableList<(T) -> String?> = mutableListOf()
    private var requiredFlag: Boolean = false
    private var form: FormModel? = null

    var name: String = ""
        private set

    override var value: T
        get() = state.value
        set(next) {
            if (state.value == next) return
            state.set(next)
            serverErrorState.set(null)
            touchedState.set(true)
            form?.notifyChanged()
        }

    override val touched: Boolean
        get() = touchedState.value

    override val key: String
        get() = name

    override val valid: Boolean
        get() = rawError == null

    val rawError: String?
        get() {
            serverErrorState.value?.let { return it }
            if (requiredFlag && isEmptyValue(value)) return "Обязательное поле"
            val current = value
            return validators.firstNotNullOfOrNull { validator -> validator(current) }
        }

    override val error: String?
        get() {
            val message = rawError ?: return null
            val submitted = form?.submitted?.value == true
            return if (touchedState.value || submitted || serverErrorState.value != null) message else null
        }

    val isRequired: Boolean
        get() = requiredFlag

    val isDirty: Boolean
        get() = state.value != initialValue

    val isServerError: Boolean
        get() = serverErrorState.value != null

    fun required(): FieldDelegate<T> = apply {
        requiredFlag = true
    }

    fun minLength(length: Int): FieldDelegate<T> = apply {
        require(length >= 0) { "minLength должен быть >= 0" }
        validators.add { value ->
            if (value is CharSequence && value.isNotEmpty() && value.length < length) {
                "Минимум $length ${symbolWord(length)}"
            } else {
                null
            }
        }
    }

    fun maxLength(length: Int): FieldDelegate<T> = apply {
        require(length >= 0) { "maxLength должен быть >= 0" }
        validators.add { value ->
            if (value is CharSequence && value.length > length) "Максимум $length ${symbolWord(length)}" else null
        }
    }

    fun email(): FieldDelegate<T> = apply {
        validators.add { value ->
            if (value is CharSequence && value.isNotBlank() && !EMAIL.matches(value)) {
                "Некорректный email"
            } else {
                null
            }
        }
    }

    fun url(): FieldDelegate<T> = apply {
        validators.add { value ->
            if (value is CharSequence && value.isNotBlank() && !URL.matches(value)) {
                "Некорректный URL"
            } else {
                null
            }
        }
    }

    fun pattern(regex: Regex, message: String): FieldDelegate<T> = apply {
        validators.add { value ->
            if (value is CharSequence && value.isNotEmpty() && !regex.matches(value)) message else null
        }
    }

    fun min(minimum: Number): FieldDelegate<T> = apply {
        validators.add { value ->
            val number = (value as? Number)?.toDouble()
            if (number != null && number < minimum.toDouble()) "Минимум $minimum" else null
        }
    }

    fun max(maximum: Number): FieldDelegate<T> = apply {
        validators.add { value ->
            val number = (value as? Number)?.toDouble()
            if (number != null && number > maximum.toDouble()) "Максимум $maximum" else null
        }
    }

    fun custom(message: String, predicate: (T) -> Boolean): FieldDelegate<T> = apply {
        validators.add { value -> if (!isEmptyValue(value) && !predicate(value)) message else null }
    }

    fun validate(validator: (T) -> String?): FieldDelegate<T> = apply {
        validators.add { value -> if (isEmptyValue(value)) null else validator(value) }
    }

    override fun touch() {
        if (!touchedState.value) {
            touchedState.set(true)
            form?.notifyChanged()
        }
    }

    internal fun setServerError(message: String?) {
        serverErrorState.set(message)
        form?.notifyChanged()
    }

    internal fun bind(owner: FormModel, propertyName: String) {
        if (form != null) return
        name = propertyName
        form = owner
    }

    internal fun reset() {
        state.set(initialValue)
        touchedState.set(false)
        serverErrorState.set(null)
    }

    override fun getValue(thisRef: Any?, property: KProperty<*>): T = value

    override fun setValue(thisRef: Any?, property: KProperty<*>, value: T) {
        this.value = value
    }

    operator fun provideDelegate(thisRef: FormModel, property: KProperty<*>): FieldDelegate<T> {
        bind(thisRef, property.name)
        thisRef.register(this)
        return this
    }

    private companion object {
        val EMAIL = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")
        val URL = Regex("^(https?://)?[^\\s.]+(\\.[^\\s.]+)+(/\\S*)?$")

        fun symbolWord(count: Int): String {
            val mod100 = count % 100
            val mod10 = count % 10
            return when {
                mod100 in 11..14 -> "символов"
                mod10 == 1 -> "символ"
                mod10 in 2..4 -> "символа"
                else -> "символов"
            }
        }
    }
}

class PropertyFieldBinding<T>(
    private val property: KMutableProperty0<T>,
) : FieldBinding<T> {
    override var value: T
        get() = property.get()
        set(value) = property.set(value)

    override val error: String? = null
    override val touched: Boolean = false
    override val valid: Boolean = true
    override val key: String
        get() = property.name

    override fun touch() = Unit
}

fun <T> bind(property: KMutableProperty0<T>): FieldBinding<T> = PropertyFieldBinding(property)

abstract class FormModel {
    private val registeredFields: MutableList<FieldDelegate<*>> = mutableListOf()
    private val submittedState = MutableSignal(false)
    private val submittingState = MutableSignal(false)
    private val revisionState = MutableSignal(0L)
    private val validComputed: Computed<Boolean> = Computed { registeredFields.all { it.valid } }
    private val dirtyComputed: Computed<Boolean> = Computed { registeredFields.any { it.isDirty } }
    private val completionComputed: Computed<Float> = Computed {
        val required = registeredFields.filter { it.isRequired }
        if (required.isEmpty()) {
            1f
        } else {
            required.count { !isEmptyValue(it.value) }.toFloat() / required.size.toFloat()
        }
    }

    var onSubmit: (() -> Unit)? = null
    var onReset: (() -> Unit)? = null

    val submitted: Signal<Boolean>
        get() = submittedState

    val isSubmitting: Signal<Boolean>
        get() = submittingState

    val revision: Signal<Long>
        get() = revisionState

    val isValid: Boolean
        get() = validComputed.value

    val isDirty: Boolean
        get() = dirtyComputed.value

    val completion: Float
        get() = completionComputed.value

    val fields: List<FieldDelegate<*>>
        get() = registeredFields.toList()

    protected fun <T> field(initialValue: T): FieldDelegate<T> = FieldDelegate(initialValue)

    internal fun register(field: FieldDelegate<*>) {
        registeredFields.add(field)
    }

    internal fun notifyChanged() {
        revisionState.update { it + 1 }
    }

    @Suppress("UNCHECKED_CAST")
    fun <T> fieldByName(name: String): FieldDelegate<T>? =
        registeredFields.firstOrNull { it.name == name } as? FieldDelegate<T>

    fun fieldError(name: String): String? = registeredFields.firstOrNull { it.name == name }?.error

    fun fieldTouched(name: String): Boolean =
        registeredFields.firstOrNull { it.name == name }?.touched == true

    fun fieldValid(name: String): Boolean =
        registeredFields.firstOrNull { it.name == name }?.valid != false

    fun touchField(name: String) {
        registeredFields.firstOrNull { it.name == name }?.touch()
    }

    fun setFieldErrors(errors: Map<String, String>) {
        errors.forEach { (name, message) ->
            registeredFields.firstOrNull { it.name == name }?.setServerError(message)
        }
        submittedState.set(true)
        submittingState.set(false)
        notifyChanged()
    }

    fun submit() {
        submittedState.set(true)
        registeredFields.forEach { it.touch() }
        notifyChanged()
        if (!validComputed.value) return
        submittingState.set(true)
        onSubmit?.invoke()
    }

    fun completeSubmit() {
        submittingState.set(false)
        notifyChanged()
    }

    fun failSubmit(errors: Map<String, String> = emptyMap()) {
        errors.forEach { (name, message) ->
            registeredFields.firstOrNull { it.name == name }?.setServerError(message)
        }
        submittedState.set(true)
        submittingState.set(false)
        notifyChanged()
    }

    fun reset() {
        registeredFields.forEach { it.reset() }
        submittedState.set(false)
        submittingState.set(false)
        notifyChanged()
        onReset?.invoke()
    }
}
