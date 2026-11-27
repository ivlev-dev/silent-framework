package dev.ivlev.silent.ui.desktop

import dev.ivlev.silent.ui.demo.AppVM
import dev.ivlev.silent.ui.demo.AppView
import dev.ivlev.silent.ui.demo.Route
import dev.ivlev.silent.ui.di.DependencyContainer
import dev.ivlev.silent.ui.layout.BuildContext
import dev.ivlev.silent.ui.layout.ClickTarget
import dev.ivlev.silent.ui.layout.Offset
import dev.ivlev.silent.ui.layout.RenderNode
import dev.ivlev.silent.ui.layout.layoutRoot
import dev.ivlev.silent.ui.lifecycle.component
import dev.ivlev.silent.ui.paint.UiRenderer
import dev.ivlev.silent.ui.widgets.Button
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
    section: String = "foundations",
    hover: Boolean = false,
    di: DependencyContainer = desktopContainer(),
): Path {
    val vm: AppVM = di.resolve()
    vm.route = route
    vm.dark = dark
    vm.dashboard.selectedNav = nav
    vm.gallery.section.set(section)
    if (route == Route.DASHBOARD) {
        vm.dashboard.refreshDashboardBlocking()
        if (nav == "projects") vm.dashboard.refreshProjectsBlocking()
    }
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
    val hoverTarget = if (hover) findHoverTarget(node) else null
    canvas.save()
    canvas.scale(uiScale, uiScale)
    UiRenderer(
        painter,
        vm.theme,
        measurer,
        hoveredPath = hoverTarget?.first ?: emptyList(),
        hoverPoint = hoverTarget?.second,
    ).render(node)
    canvas.restore()
    val image = surface.makeImageSnapshot()
    val data = image.encodeToData(EncodedImageFormat.PNG) ?: error("Не удалось закодировать PNG")
    Files.createDirectories(path.parent)
    Files.write(path, data.bytes)
    rootComponent.dispose()
    di.dispose()
    return path
}

private fun findHoverTarget(node: RenderNode): Pair<List<Int>, Offset>? {
    var result: Pair<List<Int>, Offset>? = null
    fun walk(current: RenderNode, path: List<Int>) {
        if (result != null) return
        val widget = current.widget
        if (widget is Button && widget.text == "Filled") {
            result = path to Offset(
                current.bounds.x + current.bounds.width / 2f,
                current.bounds.y + current.bounds.height / 2f,
            )
            return
        }
        current.children.forEachIndexed { index, child ->
            walk(child, path + index)
        }
    }
    walk(node, emptyList())
    if (result != null) return result
    fun fallback(current: RenderNode, path: List<Int>) {
        if (result != null) return
        if (current.widget is ClickTarget && current.children.isEmpty()) {
            result = path to Offset(
                current.bounds.x + current.bounds.width / 2f,
                current.bounds.y + current.bounds.height / 2f,
            )
            return
        }
        current.children.forEachIndexed { index, child -> fallback(child, path + index) }
    }
    fallback(node, emptyList())
    return result
}

fun main(args: Array<String>) {
    dev.ivlev.silent.ui.tokens.MotionSettings.reducedMotion =
        System.getenv("SILENT_UI_REDUCED_MOTION") == "1"
    if (args.firstOrNull() == "--screenshot") {
        val path = Path.of(args.getOrElse(1) { "/tmp/silent-ui-login.png" })
        val route = when {
            args.contains("--gallery") -> Route.GALLERY
            args.contains("--dashboard") -> Route.DASHBOARD
            else -> Route.LOGIN
        }
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
        val section = args.firstOrNull { it.startsWith("--section=") }?.removePrefix("--section=") ?: "foundations"
        renderSnapshot(path, route, dark, width, height, uiScale, nav, section, args.contains("--hover"))
        println(path.toAbsolutePath())
        return
    }
    javax.swing.SwingUtilities.invokeLater {
        val gallery = args.contains("--gallery")
        val section = args.firstOrNull { it.startsWith("--section=") }?.removePrefix("--section=")
        val route = when {
            gallery -> Route.GALLERY
            args.contains("--dashboard") -> Route.DASHBOARD
            else -> null
        }
        val nav = args.firstOrNull { it.startsWith("--nav=") }?.removePrefix("--nav=")
        val app = DesktopApp(
            initialRoute = route,
            initialSection = if (gallery) section else null,
            initialNav = nav,
        )
        app.start()
        val hover = args.firstOrNull { it == "--hover" || it.startsWith("--hover=") }
        if (hover != null) {
            val kind = hover.substringAfter('=', "button")
            app.startHoverDemo(kind)
        }
    }
}
