plugins {
    kotlin("jvm")
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
    implementation("com.google.devtools.ksp:symbol-processing-api:2.2.20-2.0.4")
    testImplementation(kotlin("test"))
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            artifactId = "silent-protocol-ksp"
            from(components["java"])
            pom {
                name.set("silent-protocol-ksp")
                description.set("KSP symbol processor that generates Silent Protocol codecs")
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
