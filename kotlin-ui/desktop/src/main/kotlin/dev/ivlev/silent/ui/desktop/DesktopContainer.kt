package dev.ivlev.silent.ui.desktop

import dev.ivlev.silent.ui.data.HttpTransport
import dev.ivlev.silent.ui.di.DependencyContainer
import dev.ivlev.silent.ui.di.container

fun desktopContainer(): DependencyContainer = container {
    bind<HttpTransport> { JavaHttpTransport() }
}
