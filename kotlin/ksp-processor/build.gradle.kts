plugins {
    kotlin("jvm")
    `maven-publish`
    signing
}

group = "dev.ivlev.silent"
version = providers.gradleProperty("protocolVersion").getOrElse("0.14.0")

kotlin {
    jvmToolchain(21)
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.google.devtools.ksp:symbol-processing-api:2.2.20-2.0.4")
    testImplementation(kotlin("test"))
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
            artifactId = "silent-protocol-ksp"
            from(components["java"])
            artifact(javadocJar)
            pom {
                name.set("silent-protocol-ksp")
                description.set("KSP symbol processor that generates Silent Protocol codecs")
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
