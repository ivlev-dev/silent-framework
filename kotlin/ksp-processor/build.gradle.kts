plugins {
    kotlin("jvm")
}

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
