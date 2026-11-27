import build.SilentReactiveTransform

plugins {
    kotlin("jvm")
    id("com.google.devtools.ksp")
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

val generatedReactive = layout.buildDirectory.dir("generated/reactive/kotlin")

val transformReactive = tasks.register<SilentReactiveTransform>("transformReactive") {
    inputDirectory.set(layout.projectDirectory.dir("src/main/kotlin"))
    outputDirectory.set(generatedReactive)
}

kotlin.sourceSets.named("main") {
    kotlin.setSrcDirs(listOf(generatedReactive))
}

sourceSets {
    test {
        kotlin.srcDir(rootProject.file("tools"))
    }
}

tasks.named("compileKotlin") {
    dependsOn(transformReactive)
}

tasks.matching { it.name.startsWith("ksp") }.configureEach {
    dependsOn(transformReactive)
}

dependencies {
    api("dev.ivlev.silent:silent-protocol:0.14.0")
    ksp("dev.ivlev.silent:silent-protocol-ksp:0.14.0")
    ksp(project(":ksp"))
    testImplementation(kotlin("test-junit5"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

tasks.matching { it.name == "kspTestKotlin" }.configureEach { enabled = false }
