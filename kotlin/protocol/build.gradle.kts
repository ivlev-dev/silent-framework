plugins {
    kotlin("jvm")
    id("com.google.devtools.ksp")
    `maven-publish`
    signing
}

group = "dev.ivlev.silent"
version = providers.gradleProperty("protocolVersion").getOrElse("0.14.0")

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
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

java {
    withSourcesJar()
}

val javadocJar by tasks.registering(Jar::class) {
    archiveClassifier.set("javadoc")
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            artifactId = "silent-protocol"
            from(components["java"])
            artifact(javadocJar)
            pom {
                name.set("silent-protocol")
                description.set("Silent Protocol runtime, wire primitives and codec API for Kotlin/JVM")
                url.set("https://github.com/ivlev-dev/silent-framework")
                licenses {
                    license {
                        name.set("MIT")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }
                developers {
                    developer {
                        id.set("ivlev-dev")
                        name.set("Alex Ivlev")
                        email.set("ai@itegroup.ru")
                    }
                }
                scm {
                    connection.set("scm:git:https://github.com/ivlev-dev/silent-framework.git")
                    developerConnection.set("scm:git:ssh://git@github.com/ivlev-dev/silent-framework.git")
                    url.set("https://github.com/ivlev-dev/silent-framework")
                }
            }
        }
    }
    repositories {
        maven {
            name = "staging"
            url = uri(rootProject.layout.buildDirectory.dir("staging-repo"))
        }
    }
}

signing {
    val key = providers.environmentVariable("GPG_PRIVATE_KEY").orNull
    if (key != null) {
        useInMemoryPgpKeys(key, providers.environmentVariable("GPG_PASSPHRASE").orElse("").get())
        sign(publishing.publications["maven"])
    }
}
