package dev.ivlev.silent.ui.demo

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DemoReactiveTest {
    @Test
    fun loginViewModelUsesTransformedReactivePropertiesAndForm() {
        val api = FakeAuthApi(delayMs = 0)
        val vm = LoginVM(api)
        var authenticated = 0
        vm.onAuthenticated = { authenticated += 1 }
        vm.mount()
        assertEquals("", vm.serverMessage)
        assertFalse(vm.canSubmit)
        vm.form.email = "anna@silent.dev"
        vm.form.password = "silent-pass"
        assertTrue(vm.canSubmit)
        vm.form.submit()
        assertEquals(1, authenticated)
        assertFalse(vm.form.isSubmitting.value)
    }

    @Test
    fun failedLoginShowsServerMessageAndFieldError() {
        val api = FakeAuthApi(delayMs = 0)
        val vm = LoginVM(api)
        vm.mount()
        vm.form.email = "error@silent.dev"
        vm.form.password = "silent-pass"
        vm.form.submit()
        assertEquals("Пользователь не найден", vm.serverMessage)
        assertEquals("Пользователь не найден", vm.form.emailField.error)
        assertTrue(vm.form.submitted.value)
    }

    @Test
    fun appRouteAndThemeAreReactive() {
        val container = dev.ivlev.silent.ui.di.container()
        val app = container.resolve<AppVM>()
        assertFalse(app.dark)
        assertFalse(app.theme.isDark)
        app.toggleTheme()
        assertTrue(app.dark)
        assertTrue(app.theme.isDark)
        app.route = Route.DASHBOARD
        assertEquals(Route.DASHBOARD, app.route)
        container.dispose()
    }

    @Test
    fun dashboardComputedFiltersProjects() {
        val vm = DashboardVM(FakeProjectsRepository())
        vm.mount()
        assertEquals(6, vm.filteredProjects.size)
        vm.query = "silent"
        assertEquals(2, vm.filteredProjects.size)
        vm.selectedNav = "projects"
        assertEquals("Проекты", vm.heading)
    }
}
