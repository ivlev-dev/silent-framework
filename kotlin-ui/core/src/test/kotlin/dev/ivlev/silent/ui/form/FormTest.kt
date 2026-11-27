package dev.ivlev.silent.ui.form

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FormTest {
    private class LoginTestForm : FormModel() {
        var email by field("").required().email()
        var password by field("").required().minLength(8)
        var remember by field(false)
    }

    private class ProfileForm : FormModel() {
        var name by field("").minLength(3)
        var age by field(18).min(18)
    }

    @Test
    fun requiredFieldShowsErrorOnlyWhenTouched() {
        val form = LoginTestForm()
        assertNull(form.emailField.error)
        assertFalse(form.emailField.valid)
        form.emailField.touch()
        assertEquals("Обязательное поле", form.emailField.error)
        form.email = "user@example.com"
        assertNull(form.emailField.error)
        assertTrue(form.emailField.valid)
    }

    @Test
    fun emailAndMinLengthValidation() {
        val form = LoginTestForm()
        form.email = "broken"
        assertFalse(form.emailField.valid)
        assertEquals("Некорректный email", form.emailField.rawError)
        form.email = "user@example.com"
        form.password = "short"
        assertEquals("Минимум 8 символов", form.passwordField.rawError)
        form.password = "long-enough"
        assertTrue(form.emailField.valid)
        assertTrue(form.passwordField.valid)
    }

    @Test
    fun completionCountsRequiredFields() {
        val form = LoginTestForm()
        assertEquals(0f, form.completion)
        form.email = "user@example.com"
        assertEquals(0.5f, form.completion)
        form.password = "long-enough"
        assertEquals(1f, form.completion)
        form.email = ""
        assertEquals(0.5f, form.completion)
    }

    @Test
    fun submitMarksTouchedAndCallsHandlerOnlyForValidForm() {
        val form = LoginTestForm()
        var submitted = 0
        form.onSubmit = { submitted += 1 }
        form.submit()
        assertEquals(0, submitted)
        assertTrue(form.submitted.value)
        assertTrue(form.emailField.touched)
        assertEquals("Обязательное поле", form.emailField.error)
        form.email = "user@example.com"
        form.password = "long-enough"
        form.submit()
        assertEquals(1, submitted)
        assertTrue(form.isSubmitting.value)
        form.completeSubmit()
        assertFalse(form.isSubmitting.value)
    }

    @Test
    fun serverErrorsOverrideAndClearOnEdit() {
        val form = LoginTestForm()
        form.email = "user@example.com"
        form.password = "long-enough"
        form.setFieldErrors(mapOf("email" to "Пользователь не найден"))
        assertEquals("Пользователь не найден", form.emailField.error)
        assertFalse(form.isValid)
        form.email = "other@example.com"
        assertNull(form.emailField.error)
        assertTrue(form.isValid)
    }

    @Test
    fun resetRestoresInitialState() {
        val form = LoginTestForm()
        form.email = "user@example.com"
        form.password = "long-enough"
        form.remember = true
        form.submit()
        form.reset()
        assertEquals("", form.email)
        assertEquals("", form.password)
        assertFalse(form.remember)
        assertFalse(form.emailField.touched)
        assertFalse(form.submitted.value)
        assertFalse(form.isDirty)
    }

    @Test
    fun optionalFieldsAndCustomValidation() {
        val form = ProfileForm()
        assertTrue(form.isValid)
        form.name = "ab"
        assertEquals("Минимум 3 символа", form.nameField.rawError)
        form.name = "Иван"
        assertTrue(form.isValid)
        form.age = 12
        assertEquals("Минимум 18", form.ageField.rawError)
        form.age = 21
        assertTrue(form.isValid)
        assertTrue(form.isDirty)
    }

    private val LoginTestForm.emailField: FieldDelegate<String>
        get() = fieldByName<String>("email") ?: error("email")

    private val LoginTestForm.passwordField: FieldDelegate<String>
        get() = fieldByName<String>("password") ?: error("password")

    private val LoginTestForm.rememberField: FieldDelegate<Boolean>
        get() = fieldByName<Boolean>("remember") ?: error("remember")

    private val ProfileForm.nameField: FieldDelegate<String>
        get() = fieldByName<String>("name") ?: error("name")

    private val ProfileForm.ageField: FieldDelegate<Int>
        get() = fieldByName<Int>("age") ?: error("age")
}
