package dev.ivlev.silent.ui.android

import android.app.Activity
import android.content.res.Configuration
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import dev.ivlev.silent.ui.data.UiThread
import dev.ivlev.silent.ui.demo.AppVM
import dev.ivlev.silent.ui.demo.AppView
import dev.ivlev.silent.ui.di.DependencyContainer
import dev.ivlev.silent.ui.di.container
import dev.ivlev.silent.ui.lifecycle.ViewComponent
import dev.ivlev.silent.ui.lifecycle.component
import dev.ivlev.silent.ui.tokens.MotionSettings

class MainActivity : Activity() {
    private lateinit var dependencies: DependencyContainer
    private lateinit var vm: AppVM
    private lateinit var rootComponent: ViewComponent
    private lateinit var canvasView: SilentCanvasView

    override fun onCreate(savedInstanceState: Bundle?) {
        val dark = isSystemDark()
        setTheme(
            if (dark) {
                android.R.style.Theme_Material_NoActionBar
            } else {
                android.R.style.Theme_Material_Light_NoActionBar
            },
        )
        super.onCreate(savedInstanceState)
        val mainHandler = Handler(Looper.getMainLooper())
        UiThread.install { action -> mainHandler.post(action) }
        MotionSettings.reducedMotion = android.provider.Settings.Global.getFloat(
            contentResolver,
            android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                    android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
        dependencies = container()
        vm = dependencies.resolve()
        vm.dark = dark
        if (intent.getStringExtra("screen") == "gallery") {
            vm.route = dev.ivlev.silent.ui.demo.Route.GALLERY
        }
        intent.getStringExtra("section")?.let { vm.gallery.section.set(it) }
        rootComponent = component(vm, AppView(vm))
        canvasView = SilentCanvasView(this, vm, rootComponent)
        setContentView(canvasView)
        if (intent.getStringExtra("hover") != null) {
            canvasView.postDelayed({ canvasView.showHoverDemo() }, 900)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::vm.isInitialized && vm.route == dev.ivlev.silent.ui.demo.Route.GALLERY) {
            if (vm.gallery.dialogOpen.value || vm.gallery.drawerOpen.value || vm.gallery.sheetOpen.value) {
                vm.gallery.closeOverlays()
                return
            }
        }
        super.onBackPressed()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (::vm.isInitialized) {
            vm.dark = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
                Configuration.UI_MODE_NIGHT_YES
        }
    }

    override fun onDestroy() {
        if (::rootComponent.isInitialized) rootComponent.dispose()
        if (::dependencies.isInitialized) dependencies.dispose()
        super.onDestroy()
    }

    private fun isSystemDark(): Boolean =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
}
