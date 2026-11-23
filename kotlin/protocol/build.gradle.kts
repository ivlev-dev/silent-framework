plugins {
    kotlin("jvm")
    id("com.google.devtools.ksp")
    `maven-publish`
}

group = "dev.ivlev.silent"
version = providers.gradleProperty("protocolVersion").getOrElse("0.13.1")

kotlin {
    jvmToolchain(21)
}

repositories {
    mavenCentral()
}

dependencies {
    api("org.jetbrains.kotlinx:kotlinx-datetime:0.6.2")
    ksp(project(":ksp-processor"))
    kspTest(project(":ksp-processor"))
    testImplementation(kotlin("test"))
    testImplementation("com.google.code.gson:gson:2.11.0")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}

tasks.register<JavaExec>("bench") {
    group = "verification"
    description = "Замер кодирования/декодирования протокола и JSON"
    classpath = sourceSets.test.get().runtimeClasspath
    mainClass.set("dev.ivlev.silent.protocol.BenchMainKt")
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            artifactId = "silent-protocol"
            from(components["java"])
            pom {
                name.set("silent-protocol")
                description.set("Silent Protocol runtime, wire primitives and codec API for Kotlin/JVM")
                licenses {
                    license {
                        name.set("MIT")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }
            }
        }
    }
}
