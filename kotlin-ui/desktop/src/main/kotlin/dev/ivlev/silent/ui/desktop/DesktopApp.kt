package dev.ivlev.silent.ui.desktop

import dev.ivlev.silent.ui.demo.AppVM
import dev.ivlev.silent.ui.demo.AppView
import dev.ivlev.silent.ui.demo.Route
import dev.ivlev.silent.ui.di.DependencyContainer
import dev.ivlev.silent.ui.di.container
import dev.ivlev.silent.ui.form.FieldBinding
import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.ClickTarget
import dev.ivlev.silent.ui.layout.HitTester
import dev.ivlev.silent.ui.layout.Rect
import dev.ivlev.silent.ui.layout.RenderNode
import dev.ivlev.silent.ui.layout.findAllTextFields
import dev.ivlev.silent.ui.layout.findVisibleTextFields
import dev.ivlev.silent.ui.layout.layoutRoot
import dev.ivlev.silent.ui.lifecycle.ViewComponent
import dev.ivlev.silent.ui.lifecycle.component
import dev.ivlev.silent.ui.paint.UiRenderer
import dev.ivlev.silent.ui.reactive.DependencyTracker
import dev.ivlev.silent.ui.reactive.Scope
import dev.ivlev.silent.ui.tokens.Typography
import dev.ivlev.silent.ui.widgets.FieldType
import dev.ivlev.silent.ui.widgets.TextField
import org.jetbrains.skia.Canvas
import org.jetbrains.skiko.GraphicsApi
import org.jetbrains.skiko.SkiaLayer
import org.jetbrains.skiko.SkikoRenderDelegate
import java.awt.Font
import java.awt.Point
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import java.awt.event.InputEvent
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseWheelEvent
import java.awt.event.WindowAdapter
import java.awt.event.WindowEvent
import javax.swing.AbstractAction
import javax.swing.Action
import javax.swing.JFrame
import javax.swing.JPanel
import javax.swing.JPasswordField
import javax.swing.JTextField
import javax.swing.JWindow
import javax.swing.KeyStroke
import javax.swing.SwingUtilities
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener
import kotlin.math.roundToInt

class DesktopApp(
    private val di: DependencyContainer = container(),
) {
    private val vm: AppVM = di.resolve()
    private val rootComponent: ViewComponent = component(vm, AppView(vm))
    private val measurer = SkikoTextMeasurer()
    private val tracker = DependencyTracker { requestRedraw() }
    private val scope = Scope()
    private val hitTester = HitTester()
    private val frame = JFrame("Silent UI · Kotlin")
    private val overlayWindow = JWindow(frame)
    private val overlayPanel = JPanel(null)
    private val textEditor = JTextField()
    private val passwordEditor = JPasswordField()
    private val layer = SkiaLayer()

    private var root: RenderNode? = null
    private var focusedBinding: FieldBinding<String>? = null
    private var activeEditor: JTextField? = null
    private var updatingEditor = false
    private var uiScale = 1f
    private var editorConfigKey = ""

    init {
        frame.defaultCloseOperation = JFrame.DO_NOTHING_ON_CLOSE
        frame.minimumSize = java.awt.Dimension(360, 640)
        val workArea = java.awt.GraphicsEnvironment.getLocalGraphicsEnvironment().maximumWindowBounds
        val initialScale = resolveUiScale()
        val initialWidth = (1440f * initialScale).roundToInt().coerceAtLeast(1280).coerceAtMost(workArea.width)
        val initialHeight = (900f * initialScale).roundToInt().coerceAtLeast(850).coerceAtMost(workArea.height)
        frame.setSize(initialWidth, initialHeight)
        frame.setLocation(
            workArea.x + (workArea.width - initialWidth) / 2,
            workArea.y + (workArea.height - initialHeight) / 2,
        )
        overlayWindow.contentPane = overlayPanel
        overlayWindow.isVisible = false
        overlayWindow.addWindowFocusListener(object : WindowAdapter() {
            override fun windowLostFocus(event: WindowEvent) {
                if (!overlayWindow.isActive && !frame.isActive) hideEditor(restoreFocus = false)
            }
        })
        overlayPanel.isOpaque = true
        setupEditor(textEditor, password = false)
        setupEditor(passwordEditor, password = true)
        overlayPanel.add(textEditor)
        overlayPanel.add(passwordEditor)
        if (System.getenv("SILENT_UI_RENDER_API")?.lowercase() == "software") {
            layer.renderApi = GraphicsApi.SOFTWARE_COMPAT
        }
        layer.isFocusable = true
        layer.renderDelegate = object : SkikoRenderDelegate {
            override fun onRender(canvas: Canvas, width: Int, height: Int, nanoTime: Long) {
                renderFrame(canvas, width, height)
            }
        }
        layer.addMouseListener(object : MouseAdapter() {
            override fun mousePressed(event: MouseEvent) {
                handleClick(event.x.toFloat() / uiScale, event.y.toFloat() / uiScale)
            }
        })
        layer.addMouseWheelListener { event: MouseWheelEvent -> handleWheel(event) }
        layer.addComponentListener(object : ComponentAdapter() {
            override fun componentResized(event: ComponentEvent) {
                requestRedraw()
            }

            override fun componentMoved(event: ComponentEvent) {
                requestRedraw()
            }
        })
        frame.contentPane.add(layer)
        frame.rootPane.inputMap.put(
            KeyStroke.getKeyStroke(KeyEvent.VK_TAB, 0),
            "silent-focus-first",
        )
        frame.rootPane.actionMap.put("silent-focus-first", action { focusFirstField(backwards = false) })
        frame.rootPane.inputMap.put(
            KeyStroke.getKeyStroke(KeyEvent.VK_TAB, InputEvent.SHIFT_DOWN_MASK),
            "silent-focus-last",
        )
        frame.rootPane.actionMap.put("silent-focus-last", action { focusFirstField(backwards = true) })
        scope.effect {
            val route = vm.route
            frame.title = if (route == Route.LOGIN) "Silent UI · Login" else "Silent UI · Dashboard"
        }
        frame.addWindowListener(object : WindowAdapter() {
            override fun windowClosing(event: WindowEvent) {
                dispose()
            }

            override fun windowIconified(event: WindowEvent) {
                hideEditor(restoreFocus = false)
            }
        })
    }

    fun start() {
        frame.isVisible = true
        requestRedraw()
    }

    fun dispose() {
        overlayWindow.isVisible = false
        overlayWindow.dispose()
        tracker.dispose()
        scope.dispose()
        rootComponent.dispose()
        di.dispose()
        frame.dispose()
    }

    private fun setupEditor(editor: JTextField, password: Boolean) {
        editor.isVisible = false
        editor.border = null
        editor.isOpaque = true
        editor.margin = java.awt.Insets(0, 8, 0, 8)
        if (editor is JPasswordField) editor.echoChar = '•'
        editor.addActionListener {
            hideEditor()
            if (vm.route == Route.LOGIN) vm.login.form.submit()
        }
        editor.document.addDocumentListener(object : DocumentListener {
            override fun insertUpdate(event: DocumentEvent) = updateBinding(editor)
            override fun removeUpdate(event: DocumentEvent) = updateBinding(editor)
            override fun changedUpdate(event: DocumentEvent) = updateBinding(editor)
        })
        editor.inputMap.put(KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0), "silent-hide-editor")
        editor.actionMap.put("silent-hide-editor", action { hideEditor() })
        editor.inputMap.put(KeyStroke.getKeyStroke(KeyEvent.VK_TAB, 0), "silent-focus-next")
        editor.actionMap.put("silent-focus-next", action { focusNextField(backwards = false) })
        editor.inputMap.put(
            KeyStroke.getKeyStroke(KeyEvent.VK_TAB, InputEvent.SHIFT_DOWN_MASK),
            "silent-focus-previous",
        )
        editor.actionMap.put("silent-focus-previous", action { focusNextField(backwards = true) })
        editor.putClientProperty("silentPassword", password)
    }

    private fun action(block: () -> Unit): Action = object : AbstractAction() {
        override fun actionPerformed(event: java.awt.event.ActionEvent) = block()
    }

    private fun requestRedraw() {
        SwingUtilities.invokeLater {
            if (frame.isDisplayable) layer.needRedraw()
        }
    }

    private fun renderFrame(canvas: Canvas, width: Int, height: Int) {
        val theme = vm.theme
        val surfaceScale = if (layer.width > 0) width.toFloat() / layer.width.toFloat() else 1f
        uiScale = computeUiScale()
        val totalScale = surfaceScale * uiScale
        val viewWidth = width.toFloat() / totalScale
        val viewHeight = height.toFloat() / totalScale
        val context = BuildContext(
            theme = theme,
            textMeasurer = measurer,
            viewportWidth = viewWidth,
            viewportHeight = viewHeight,
            density = totalScale,
        )
        tracker.track {
            val node = layoutRoot(rootComponent, context, viewWidth, viewHeight)
            root = node
            canvas.save()
            canvas.scale(totalScale, totalScale)
            val painter = SkikoPainter(canvas)
            UiRenderer(
                painter = painter,
                theme = theme,
                measurer = measurer,
                hideFieldText = { field ->
                    val binding = focusedBinding
                    binding != null && sameBinding(field.binding, binding)
                },
                focusedField = { null },
            ).render(node)
            canvas.restore()
        }
        syncEditor()
    }

    private fun resolveUiScale(): Float {
        val configured = System.getenv("SILENT_UI_SCALE")?.toFloatOrNull()
        val screenHeight = runCatching {
            frame.graphicsConfiguration.bounds.height.toFloat()
        }.getOrElse {
            java.awt.GraphicsEnvironment.getLocalGraphicsEnvironment().maximumWindowBounds.height.toFloat()
        }
        val osScale = runCatching {
            frame.graphicsConfiguration.defaultTransform.scaleX.toFloat()
        }.getOrDefault(1f)
        return DesktopScale.resolve(screenHeight, osScale, configured)
    }

    private fun computeUiScale(): Float = resolveUiScale()

    private fun handleClick(x: Float, y: Float) {
        val node = root ?: return
        val target = hitTester.hit(node, x, y)
        if (target is TextField) {
            showEditor(target, x)
            return
        }
        hideEditor()
        if (target is ClickTarget) target.activate()
        requestRedraw()
    }

    private fun handleWheel(event: MouseWheelEvent) {
        if (vm.route != Route.DASHBOARD) return
        vm.dashboard.scroll.scrollBy(event.preciseWheelRotation.toFloat() * 56f)
        requestRedraw()
    }

    private fun showEditor(field: TextField, clickX: Float?) {
        val binding = field.binding
        val editor = editorFor(field.fieldType)
        val same = focusedBinding != null && sameBinding(focusedBinding!!, binding)
        focusedBinding = binding
        activeEditor = editor
        val other = if (editor === textEditor) passwordEditor else textEditor
        other.isVisible = false
        ensureEditorConfig(editor, field)
        updatingEditor = true
        if (editor.text != binding.value) editor.text = binding.value
        updatingEditor = false
        editor.isVisible = true
        overlayPanel.background = java.awt.Color(vm.theme.colors.surfaceContainerLowest.argb.toInt())
        overlayWindow.background = overlayPanel.background
        syncEditor(clickX)
        overlayWindow.isVisible = true
        editor.requestFocusInWindow()
        if (same && clickX != null) {
            positionCaret(editor, clickX)
        } else if (!same) {
            editor.selectAll()
        }
        overlayWindow.toFront()
        requestRedraw()
    }

    private fun hideEditor(restoreFocus: Boolean = true) {
        if (focusedBinding == null) return
        activeEditor?.isVisible = false
        activeEditor = null
        focusedBinding = null
        overlayWindow.isVisible = false
        if (restoreFocus) frame.requestFocus()
        requestRedraw()
    }

    private fun focusFirstField(backwards: Boolean) {
        val fields = root?.findVisibleTextFields()?.map { it.first } ?: return
        if (fields.isEmpty()) return
        showEditor(if (backwards) fields.last() else fields.first(), null)
    }

    private fun focusNextField(backwards: Boolean) {
        val fields = root?.findVisibleTextFields()?.map { it.first } ?: return
        if (fields.isEmpty()) {
            hideEditor()
            return
        }
        val current = focusedBinding
        val currentIndex = if (current == null) {
            if (backwards) fields.lastIndex else -1
        } else {
            fields.indexOfFirst { sameBinding(it.binding, current) }
        }
        val nextIndex = if (backwards) {
            if (currentIndex <= 0) fields.lastIndex else currentIndex - 1
        } else {
            if (currentIndex >= fields.lastIndex) 0 else currentIndex + 1
        }
        showEditor(fields[nextIndex], null)
    }

    private fun syncEditor(clickX: Float? = null) {
        val binding = focusedBinding
        val node = root
        if (binding == null || node == null) {
            activeEditor?.isVisible = false
            overlayWindow.isVisible = false
            return
        }
        val entry = node.findVisibleTextFields().firstOrNull { sameBinding(it.first.binding, binding) }
        if (entry == null) {
            activeEditor?.isVisible = false
            overlayWindow.isVisible = false
            return
        }
        val field = entry.first
        val editor = editorFor(field.fieldType)
        if (activeEditor !== editor) {
            activeEditor?.isVisible = false
            activeEditor = editor
        }
        val bounds = entry.second
        val labelHeight = if (field.label != null) TextField.LABEL_HEIGHT else 0f
        val fieldRect = Rect(
            bounds.x + 12f,
            bounds.y + labelHeight + 4f,
            (bounds.width - 24f).coerceAtLeast(0f),
            40f,
        )
        val widthPx = (fieldRect.width * uiScale).roundToInt().coerceAtLeast(1)
        val heightPx = (fieldRect.height * uiScale).roundToInt().coerceAtLeast(1)
        val origin = if (layer.isShowing) layer.locationOnScreen else Point(0, 0)
        val screenX = origin.x + (fieldRect.x * uiScale).roundToInt()
        val screenY = origin.y + (fieldRect.y * uiScale).roundToInt()
        if (overlayWindow.x != screenX || overlayWindow.y != screenY ||
            overlayWindow.width != widthPx || overlayWindow.height != heightPx
        ) {
            overlayWindow.setBounds(screenX, screenY, widthPx, heightPx)
        }
        if (editor.bounds.width != widthPx || editor.bounds.height != heightPx) {
            editor.setBounds(0, 0, widthPx, heightPx)
        }
        ensureEditorConfig(editor, field)
        editor.isVisible = true
        if (!updatingEditor && editor.text != binding.value) {
            updatingEditor = true
            editor.text = binding.value
            editor.selectAll()
            updatingEditor = false
        }
        overlayWindow.isVisible = true
        if (clickX != null) positionCaret(editor, clickX)
    }

    private fun ensureEditorConfig(editor: JTextField, field: TextField) {
        val key = "${System.identityHashCode(editor)}-${field.fieldType}-${field.label}-${vm.theme.name}-$uiScale"
        if (key == editorConfigKey) return
        editorConfigKey = key
        editor.font = Font("SansSerif", Font.PLAIN, (Typography.bodyMedium.size * uiScale).roundToInt())
        editor.background = java.awt.Color(vm.theme.colors.surfaceContainerLowest.argb.toInt())
        editor.foreground = java.awt.Color(vm.theme.colors.onSurface.argb.toInt())
        editor.caretColor = java.awt.Color(vm.theme.colors.primary.argb.toInt())
        editor.toolTipText = field.label
        if (editor is JPasswordField) {
            editor.echoChar = '•'
        }
    }

    private fun positionCaret(editor: JTextField, clickX: Float) {
        val entry = root?.findAllTextFields()?.firstOrNull {
            focusedBinding != null && sameBinding(it.first.binding, focusedBinding!!)
        } ?: return
        val nodeX = entry.second.x + 12f
        val localPx = ((clickX - nodeX) * uiScale).roundToInt().coerceIn(0, editor.width)
        val model = editor.viewToModel(Point(localPx, editor.height / 2))
        editor.caretPosition = model.coerceIn(0, editor.document.length)
    }

    private fun editorFor(type: FieldType): JTextField =
        if (type == FieldType.Password) passwordEditor else textEditor

    private fun sameBinding(first: FieldBinding<*>, second: FieldBinding<*>): Boolean =
        if (first.key.isNotEmpty() && second.key.isNotEmpty()) {
            first.key == second.key
        } else {
            first === second
        }

    private fun updateBinding(editor: JTextField) {
        if (updatingEditor) return
        val binding = focusedBinding ?: return
        if (editor !== activeEditor) return
        val next = editor.text
        if (binding.value != next) {
            binding.value = next
            requestRedraw()
        }
    }

    internal fun debugLayout(width: Float, height: Float): RenderNode? {
        val context = BuildContext(vm.theme, measurer, width, height, uiScale)
        val node = layoutRoot(rootComponent, context, width, height)
        root = node
        return node
    }

    internal fun debugClick(x: Float, y: Float) {
        handleClick(x, y)
    }

    internal fun debugActiveEditor(): JTextField? = activeEditor

    internal fun debugOverlayVisible(): Boolean = overlayWindow.isVisible

    internal fun debugFocusNext(backwards: Boolean) {
        focusNextField(backwards)
    }

    internal fun debugFocusedBinding(): FieldBinding<String>? = focusedBinding

    internal fun debugType(text: String) {
        val editor = activeEditor ?: return
        editor.text = text
    }

    internal fun debugPressEscape() {
        hideEditor()
    }

    internal fun debugPressEnter() {
        hideEditor()
        if (vm.route == Route.LOGIN) vm.login.form.submit()
    }

    internal fun debugRoot(): RenderNode? = root

    internal fun debugVm(): AppVM = vm
}
