package dev.ivlev.silent.ui.demo

import dev.ivlev.silent.ui.form.FieldDelegate
import dev.ivlev.silent.ui.form.FormModel

class LoginForm : FormModel() {
    var email by field("").required().email()
    var password by field("").required().minLength(8)
    var remember by field(false)

    val emailField: FieldDelegate<String>
        get() = fieldByName<String>("email") ?: error("email не зарегистрирован")

    val passwordField: FieldDelegate<String>
        get() = fieldByName<String>("password") ?: error("password не зарегистрирован")

    val rememberField: FieldDelegate<Boolean>
        get() = fieldByName<Boolean>("remember") ?: error("remember не зарегистрирован")
}
