plugins {
    `kotlin-dsl`
}

repositories {
    mavenCentral()
}

sourceSets {
    main {
        kotlin.srcDir("../tools")
    }
}
