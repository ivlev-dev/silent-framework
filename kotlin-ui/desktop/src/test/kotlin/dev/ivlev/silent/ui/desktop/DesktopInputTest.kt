package dev.ivlev.silent.ui.desktop

import dev.ivlev.silent.ui.demo.AuthApi
import dev.ivlev.silent.ui.demo.FakeAuthApi
import dev.ivlev.silent.ui.demo.Route
import dev.ivlev.silent.ui.di.container
import dev.ivlev.silent.ui.layout.RenderNode
import dev.ivlev.silent.ui.layout.findAllTextFields
import dev.ivlev.silent.ui.widgets.Button
import dev.ivlev.silent.ui.widgets.Checkbox
import dev.ivlev.silent.ui.widgets.TextField
import dev.ivlev.silent.ui.layout.Rect
import java.awt.GraphicsEnvironment
import javax.swing.SwingUtilities
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DesktopInputTest {
    @Test
    fun clickFocusTypeTabAndSubmit() {
        if (GraphicsEnvironment.isHeadless()) return
        val di = container {
            bind<AuthApi> { FakeAuthApi(delayMs = 0) }
        }
        var app: DesktopApp? = null
        SwingUtilities.invokeAndWait {
            app = DesktopApp(di)
            app!!.debugLayout(1280f, 850f)
        }
        val instance = app ?: return
        val root = instance.debugRoot() ?: return
        val emailNode = root.findAllTextFields().first { it.first.binding.key == "email" }
        clickNode(instance, emailNode)
        assertEquals("email", instance.debugFocusedBinding()?.key)
        assertNotNull(instance.debugActiveEditor())
        assertTrue(instance.debugOverlayVisible())
        SwingUtilities.invokeAndWait { instance.debugType("anna@silent.dev") }
        assertEquals("anna@silent.dev", instance.debugVm().login.form.email)

        SwingUtilities.invokeAndWait { instance.debugFocusNext(false) }
        assertEquals("password", instance.debugFocusedBinding()?.key)
        SwingUtilities.invokeAndWait { instance.debugType("silent-pass") }
        assertEquals("silent-pass", instance.debugVm().login.form.password)

        SwingUtilities.invokeAndWait { instance.debugFocusNext(true) }
        assertEquals("email", instance.debugFocusedBinding()?.key)

        SwingUtilities.invokeAndWait { instance.debugPressEscape() }
        assertNull(instance.debugFocusedBinding())
        assertNull(instance.debugActiveEditor())
        assertTrue(!instance.debugOverlayVisible())

        clickNode(instance, emailNode)
        SwingUtilities.invokeAndWait { instance.debugPressEnter() }
        assertEquals(Route.DASHBOARD, instance.debugVm().route)

        SwingUtilities.invokeAndWait { instance.dispose() }
    }

    @Test
    fun hoverTracksTargetAndDamage() {
        if (GraphicsEnvironment.isHeadless()) return
        val di = container {
            bind<AuthApi> { FakeAuthApi(delayMs = 0) }
        }
        var app: DesktopApp? = null
        SwingUtilities.invokeAndWait {
            app = DesktopApp(di)
            app!!.debugLayout(1280f, 850f)
        }
        val instance = app ?: return
        val root = instance.debugRoot() ?: return
        val target = findWidget(root, dev.ivlev.silent.ui.widgets.Checkbox::class.java) ?: return
        val node = findNode(root, target) ?: return
        SwingUtilities.invokeAndWait {
            instance.debugHover(node.bounds.x + 10f, node.bounds.y + 10f)
        }
        assertTrue(instance.debugHoverPath().isNotEmpty())
        assertTrue(instance.debugDamageArea() > 0f)
        val previous = instance.debugDamageArea()
        SwingUtilities.invokeAndWait { instance.debugHover(1f, 1f) }
        assertTrue(instance.debugHoverPath().isEmpty())
        assertTrue(instance.debugDamageArea() >= previous)
        SwingUtilities.invokeAndWait { instance.dispose() }
    }

    @Test
    fun checkboxAndButtonClicksWork() {
        if (GraphicsEnvironment.isHeadless()) return
        val di = container {
            bind<AuthApi> { FakeAuthApi(delayMs = 0) }
        }
        var app: DesktopApp? = null
        SwingUtilities.invokeAndWait {
            app = DesktopApp(di)
            app!!.debugLayout(1280f, 850f)
        }
        val instance = app ?: return
        val root = instance.debugRoot() ?: return
        val checkbox = findWidget(root, Checkbox::class.java)
        assertNotNull(checkbox)
        val emailNode = root.findAllTextFields().first { it.first.binding.key == "email" }
        clickNode(instance, emailNode)
        assertTrue(instance.debugOverlayVisible())
        clickNode(instance, checkbox)
        assertTrue(!instance.debugOverlayVisible())
        assertTrue(instance.debugVm().login.form.remember)
        clickNode(instance, checkbox)
        assertTrue(!instance.debugVm().login.form.remember)

        clickNode(instance, emailNode)
        SwingUtilities.invokeAndWait { instance.debugType("anna@silent.dev") }
        SwingUtilities.invokeAndWait { instance.debugFocusNext(false) }
        SwingUtilities.invokeAndWait { instance.debugType("silent-pass") }
        SwingUtilities.invokeAndWait { instance.debugPressEscape() }
        SwingUtilities.invokeAndWait { instance.debugLayout(1280f, 850f) }
        val refreshedRoot = instance.debugRoot() ?: return
        val button = findWidget(refreshedRoot, Button::class.java)
        assertNotNull(button)
        clickNode(instance, button)
        assertEquals(Route.DASHBOARD, instance.debugVm().route)
        SwingUtilities.invokeAndWait { instance.dispose() }
    }

    private fun clickNode(app: DesktopApp, node: Pair<TextField, dev.ivlev.silent.ui.layout.Rect>) {
        val bounds = node.second
        val x = bounds.x + bounds.width / 2f
        val y = bounds.y + (if (node.first.label != null) TextField.LABEL_HEIGHT else 0f) + 20f
        SwingUtilities.invokeAndWait { app.debugClick(x, y) }
    }

    private fun clickNode(app: DesktopApp, widget: Checkbox) {
        clickWidget(app, widget)
    }

    private fun clickNode(app: DesktopApp, button: Button) {
        clickWidget(app, button)
    }

    private fun clickWidget(app: DesktopApp, widget: Any) {
        val node = findNode(app.debugRoot()!!, widget) ?: return
        val x = node.bounds.x + node.bounds.width / 2f
        val y = node.bounds.y + node.bounds.height / 2f
        SwingUtilities.invokeAndWait { app.debugClick(x, y) }
    }

    private fun <T> findWidget(node: RenderNode, type: Class<T>): T? {
        if (type.isInstance(node.widget)) return type.cast(node.widget)
        node.children.forEach { child ->
            val found = findWidget(child, type)
            if (found != null) return found
        }
        return null
    }

    private fun findNode(node: RenderNode, widget: Any): RenderNode? {
        if (node.widget === widget) return node
        node.children.forEach { child ->
            val found = findNode(child, widget)
            if (found != null) return found
        }
        return null
    }
}
