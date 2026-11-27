package dev.ivlev.silent.ui.android

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.os.Build
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import dev.ivlev.silent.ui.demo.AppVM
import dev.ivlev.silent.ui.demo.Route
import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.HitTester
import dev.ivlev.silent.ui.layout.Rect
import dev.ivlev.silent.ui.layout.RenderNode
import dev.ivlev.silent.ui.layout.findVisibleTextFields
import dev.ivlev.silent.ui.layout.layoutRoot
import dev.ivlev.silent.ui.lifecycle.ViewComponent
import dev.ivlev.silent.ui.paint.UiRenderer
import dev.ivlev.silent.ui.reactive.DependencyTracker
import dev.ivlev.silent.ui.tokens.Theme
import dev.ivlev.silent.ui.tokens.Typography
import dev.ivlev.silent.ui.widgets.FieldType
import dev.ivlev.silent.ui.widgets.TextField
import kotlin.math.abs

class SilentCanvasView(
    context: Context,
    private val vm: AppVM,
    private val rootComponent: ViewComponent,
) : FrameLayout(context) {
    private val density: Float = resources.displayMetrics.density
    private val measurer = AndroidTextMeasurer()
    private val hitTester = HitTester()
    private val tracker = DependencyTracker {
        postInvalidateOnAnimation()
    }
    private val editors = LinkedHashMap<String, EditText>()
    private val fieldsByKey = LinkedHashMap<String, TextField>()
    private val editorBounds = LinkedHashMap<String, Rect>()
    private val editorConfigs = LinkedHashMap<String, EditorConfig>()
    private var root: RenderNode? = null
    private var appliedTheme: Theme? = null
    private var pointerDownX = 0f
    private var pointerDownY = 0f
    private var lastPointerY = 0f
    private var dragging = false
    private val touchSlop = 8f * resources.displayMetrics.density
    private var insetLeft = 0
    private var insetTop = 0
    private var insetRight = 0
    private var insetBottom = 0

    init {
        setWillNotDraw(false)
        isClickable = true
        isFocusable = true
        setOnApplyWindowInsetsListener { _, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                val ime = insets.getInsets(WindowInsets.Type.ime())
                insetLeft = bars.left
                insetTop = bars.top
                insetRight = bars.right
                insetBottom = maxOf(bars.bottom, ime.bottom)
            } else {
                @Suppress("DEPRECATION")
                insetLeft = insets.systemWindowInsetLeft
                @Suppress("DEPRECATION")
                insetTop = insets.systemWindowInsetTop
                @Suppress("DEPRECATION")
                insetRight = insets.systemWindowInsetRight
                @Suppress("DEPRECATION")
                insetBottom = insets.systemWindowInsetBottom
            }
            requestLayout()
            invalidate()
            insets
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val theme = vm.theme
        canvas.drawColor(theme.colors.surface.argb.toInt())
        val widthDp = (width - insetLeft - insetRight).toFloat() / density
        val heightDp = (height - insetTop - insetBottom).toFloat() / density
        if (widthDp <= 0f || heightDp <= 0f) return
        val context = BuildContext(theme, measurer, widthDp, heightDp, density)
        tracker.track {
            val node = layoutRoot(rootComponent, context, widthDp, heightDp)
            root = node
            canvas.save()
            canvas.translate(insetLeft.toFloat(), insetTop.toFloat())
            canvas.scale(density, density)
            val painter = AndroidPainter(canvas)
            UiRenderer(
                painter = painter,
                theme = theme,
                measurer = measurer,
                hideFieldText = { true },
            ).render(node)
            canvas.restore()
        }
        updateSystemBars(theme)
        post { syncOverlays() }
    }

    private fun syncOverlays() {
        val node = root ?: return
        val theme = vm.theme
        val fields = node.findVisibleTextFields()
        val activeKeys = fields.mapTo(LinkedHashSet()) { (field, _) -> keyOf(field) }
        val stale = editors.keys.filter { it !in activeKeys }
        stale.forEach { key ->
            editors.remove(key)?.let { removeView(it) }
            fieldsByKey.remove(key)
            editorBounds.remove(key)
            editorConfigs.remove(key)
        }
        var needsLayout = false
        fields.forEach { (field, bounds) ->
            val key = keyOf(field)
            fieldsByKey[key] = field
            val editor = editors.getOrPut(key) { createEditor(field) }
            val config = EditorConfig(theme.name, field.hint ?: "", field.fieldType, field.enabled)
            if (editorConfigs[key] != config) {
                configureEditor(editor, field, theme)
                editorConfigs[key] = config
            }
            val labelHeight = if (field.label != null) TextField.LABEL_HEIGHT else 0f
            val rect = Rect(
                bounds.x + 12f,
                bounds.y + labelHeight + 4f,
                (bounds.width - 24f).coerceAtLeast(1f),
                40f,
            )
            if (editorBounds[key] != rect) {
                editorBounds[key] = rect
                val params = LayoutParams(
                    (rect.width * density).toInt(),
                    (rect.height * density).toInt(),
                )
                params.leftMargin = insetLeft + (rect.x * density).toInt()
                params.topMargin = insetTop + (rect.y * density).toInt()
                editor.layoutParams = params
                needsLayout = true
            }
            if (!editor.hasFocus() && editor.text.toString() != field.binding.value) {
                setEditorText(editor, field.binding.value)
            }
            if (!editor.isAttachedToWindow) addView(editor)
        }
        if (needsLayout) requestLayout()
    }

    private fun keyOf(field: TextField): String =
        field.binding.key.ifEmpty { "binding-" + System.identityHashCode(field.binding) }

    private fun createEditor(field: TextField): EditText = EditText(context).apply {
        background = null
        setPadding(0, 0, 0, 0)
        isSingleLine = true
        includeFontPadding = false
        gravity = Gravity.CENTER_VERTICAL
        setTextSize(TypedValue.COMPLEX_UNIT_PX, Typography.bodyMedium.size * density)
        imeOptions = EditorInfo.IME_ACTION_DONE
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                if (tag == "updating") return
                val current = fieldsByKey.values.firstOrNull { keyOf(it) == field.binding.key } ?: return
                val next = s?.toString().orEmpty()
                if (current.binding.value != next) current.binding.value = next
            }
        })
    }

    private data class EditorConfig(
        val theme: String,
        val hint: String,
        val fieldType: FieldType,
        val enabled: Boolean,
    )

    private fun configureEditor(editor: EditText, field: TextField, theme: Theme) {
        editor.hint = field.hint ?: ""
        editor.setTextColor(theme.colors.onSurface.argb.toInt())
        editor.setHintTextColor(theme.colors.onSurfaceMuted.argb.toInt())
        val inputType = when (field.fieldType) {
            FieldType.Email -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            FieldType.Password -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            FieldType.Number -> InputType.TYPE_CLASS_NUMBER
            FieldType.Text -> InputType.TYPE_CLASS_TEXT
        }
        if (editor.inputType != inputType) editor.inputType = inputType
        editor.isEnabled = field.enabled
        editor.typeface = if (Typography.bodyMedium.weight >= 600) {
            android.graphics.Typeface.DEFAULT_BOLD
        } else {
            android.graphics.Typeface.DEFAULT
        }
    }

    private fun setEditorText(editor: EditText, value: String) {
        editor.tag = "updating"
        editor.setText(value)
        editor.setSelection(editor.text.length)
        editor.tag = null
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                pointerDownX = event.x
                pointerDownY = event.y
                lastPointerY = event.y
                dragging = false
                return true
            }

            MotionEvent.ACTION_MOVE -> {
                if (abs(event.y - pointerDownY) > touchSlop || abs(event.x - pointerDownX) > touchSlop) {
                    dragging = true
                }
                if (dragging && vm.route == Route.DASHBOARD) {
                    val delta = (event.y - lastPointerY) / density
                    vm.dashboard.scroll.scrollBy(-delta)
                }
                lastPointerY = event.y
                return true
            }

            MotionEvent.ACTION_UP -> {
                if (!dragging) {
                    handleTap(
                        (event.x - insetLeft) / density,
                        (event.y - insetTop) / density,
                    )
                }
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    private fun handleTap(x: Float, y: Float) {
        val node = root ?: return
        val target = hitTester.hit(node, x, y)
        if (target is TextField) {
            val editor = editors[keyOf(target)]
            if (editor != null) {
                editor.requestFocus()
                val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.showSoftInput(editor, InputMethodManager.SHOW_IMPLICIT)
            }
            return
        }
        if (target is dev.ivlev.silent.ui.layout.ClickTarget) {
            target.activate()
            requestRedraw()
        }
    }

    private fun requestRedraw() {
        postInvalidateOnAnimation()
    }

    private fun updateSystemBars(theme: Theme) {
        if (appliedTheme === theme) return
        appliedTheme = theme
        val window = (context as? android.app.Activity)?.window ?: return
        window.statusBarColor = theme.colors.surface.argb.toInt()
        window.navigationBarColor = theme.colors.surface.argb.toInt()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val controller = window.insetsController ?: return
            val appearance = if (theme.isDark) {
                0
            } else {
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            }
            controller.setSystemBarsAppearance(
                appearance,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
            )
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (theme.isDark) {
                0
            } else {
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            }
        }
    }
}
