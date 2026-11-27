package build

import dev.ivlev.silent.ui.transform.ReactiveSourceTransformer
import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

abstract class SilentReactiveTransform : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val inputDirectory: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty

    @TaskAction
    fun transform() {
        val input = inputDirectory.get().asFile
        val output = outputDirectory.get().asFile
        output.deleteRecursively()
        output.mkdirs()
        val transformer = ReactiveSourceTransformer()
        input.walkTopDown().filter { it.isFile && it.extension == "kt" }.forEach { file ->
            val relative = file.relativeTo(input)
            val target = output.resolve(relative)
            target.parentFile.mkdirs()
            val result = transformer.transform(file.readText())
            target.writeText(result.source)
        }
    }
}
