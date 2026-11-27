package dev.ivlev.silent.ui.desktop

import dev.ivlev.silent.ui.demo.AppVM
import dev.ivlev.silent.ui.demo.AppView
import dev.ivlev.silent.ui.demo.Route
import dev.ivlev.silent.ui.di.DependencyContainer
import dev.ivlev.silent.ui.di.container
import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.layoutRoot
import dev.ivlev.silent.ui.lifecycle.component
import dev.ivlev.silent.ui.paint.UiRenderer
import org.jetbrains.skia.EncodedImageFormat
import org.jetbrains.skia.Surface
import java.nio.file.Files
import java.nio.file.Path

fun renderSnapshot(
    path: Path,
    route: Route,
    dark: Boolean,
    width: Int,
    height: Int,
    uiScale: Float = (height / 1080f).coerceIn(1f, 2f),
    nav: String = "overview",
    di: DependencyContainer = container(),
): Path {
    val vm: AppVM = di.resolve()
    vm.route = route
    vm.dark = dark
    vm.dashboard.selectedNav = nav
    if (route == Route.LOGIN) {
        vm.login.form.email = "anna@silent.dev"
        vm.login.form.password = "silent-pass"
        vm.login.form.remember = true
    }
    val rootComponent = component(vm, AppView(vm))
    val measurer = SkikoTextMeasurer()
    val viewWidth = width.toFloat() / uiScale
    val viewHeight = height.toFloat() / uiScale
    val context = BuildContext(
        theme = vm.theme,
        textMeasurer = measurer,
        viewportWidth = viewWidth,
        viewportHeight = viewHeight,
        density = uiScale,
    )
    val node = layoutRoot(rootComponent, context, viewWidth, viewHeight)
    val surface = Surface.makeRasterN32Premul(width, height)
    val canvas = surface.canvas
    val painter = SkikoPainter(canvas)
    painter.rect(0f, 0f, width.toFloat(), height.toFloat(), vm.theme.colors.background)
    canvas.save()
    canvas.scale(uiScale, uiScale)
    UiRenderer(painter, vm.theme, measurer).render(node)
    canvas.restore()
    val image = surface.makeImageSnapshot()
    val data = image.encodeToData(EncodedImageFormat.PNG) ?: error("Не удалось закодировать PNG")
    Files.createDirectories(path.parent)
    Files.write(path, data.bytes)
    rootComponent.dispose()
    di.dispose()
    return path
}

fun main(args: Array<String>) {
    if (args.firstOrNull() == "--screenshot") {
        val path = Path.of(args.getOrElse(1) { "/tmp/silent-ui-login.png" })
        val route = if (args.contains("--dashboard")) Route.DASHBOARD else Route.LOGIN
        val dark = args.contains("--dark")
        val sizeArg = args.firstOrNull { it.startsWith("--size=") }?.removePrefix("--size=")
        val parts = sizeArg?.split("x")
        val width = parts?.getOrNull(0)?.toIntOrNull() ?: 1440
        val height = parts?.getOrNull(1)?.toIntOrNull() ?: 900
        val scaleArg = args.firstOrNull { it.startsWith("--ui-scale=") }?.removePrefix("--ui-scale=")
        val envScale = System.getenv("SILENT_UI_SCALE")?.toFloatOrNull()?.takeIf { it > 0f }
        val uiScale = envScale
            ?: scaleArg?.toFloatOrNull()?.takeIf { it > 0f }
            ?: (height / 1080f).coerceIn(1f, 2f)
        val nav = args.firstOrNull { it.startsWith("--nav=") }?.removePrefix("--nav=") ?: "overview"
        renderSnapshot(path, route, dark, width, height, uiScale, nav)
        println(path.toAbsolutePath())
        return
    }
    javax.swing.SwingUtilities.invokeLater {
        DesktopApp().start()
    }
}
