package dev.ivlev.silent.ui.android

import android.app.Activity
import android.content.res.Configuration
import android.os.Bundle
import dev.ivlev.silent.ui.demo.AppVM
import dev.ivlev.silent.ui.demo.AppView
import dev.ivlev.silent.ui.di.DependencyContainer
import dev.ivlev.silent.ui.di.container
import dev.ivlev.silent.ui.lifecycle.ViewComponent
import dev.ivlev.silent.ui.lifecycle.component

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
        rootComponent = component(vm, AppView(vm))
        canvasView = SilentCanvasView(this, vm, rootComponent)
        setContentView(canvasView)
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
