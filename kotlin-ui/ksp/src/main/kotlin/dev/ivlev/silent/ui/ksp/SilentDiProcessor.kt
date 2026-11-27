package dev.ivlev.silent.ui.ksp

import com.google.devtools.ksp.processing.CodeGenerator
import com.google.devtools.ksp.processing.Dependencies
import com.google.devtools.ksp.processing.KSPLogger
import com.google.devtools.ksp.processing.Resolver
import com.google.devtools.ksp.processing.SymbolProcessor
import com.google.devtools.ksp.processing.SymbolProcessorEnvironment
import com.google.devtools.ksp.processing.SymbolProcessorProvider
import com.google.devtools.ksp.symbol.ClassKind
import com.google.devtools.ksp.symbol.KSAnnotated
import com.google.devtools.ksp.symbol.KSClassDeclaration
import com.google.devtools.ksp.symbol.KSFile
import com.google.devtools.ksp.symbol.KSType
import com.google.devtools.ksp.symbol.Modifier

class SilentDiProcessorProvider : SymbolProcessorProvider {
    override fun create(environment: SymbolProcessorEnvironment): SymbolProcessor =
        SilentDiProcessor(environment.codeGenerator, environment.logger)
}

private class SilentDiProcessor(
    private val codeGenerator: CodeGenerator,
    private val logger: KSPLogger,
) : SymbolProcessor {
    private var generated: Boolean = false

    override fun process(resolver: Resolver): List<KSAnnotated> {
        if (generated) return emptyList()
        generated = true
        val files: List<KSFile> = resolver.getAllFiles().toList()
        val classes: List<KSClassDeclaration> = files.flatMap { collectClasses(it.declarations) }
            .filter { it.qualifiedName?.asString()?.startsWith("dev.ivlev.silent.ui") == true }
        val concrete = classes.filter { isConcrete(it) && hasUsableConstructor(it) }
        val implementations = buildImplementations(classes)
        val generated = StringBuilder()
        generated.appendLine("package dev.ivlev.silent.ui.di.generated")
        generated.appendLine()
        generated.appendLine("import dev.ivlev.silent.ui.di.DependencyContainer")
        generated.appendLine("import dev.ivlev.silent.ui.di.Lifetime")
        generated.appendLine()
        generated.appendLine("object GeneratedDi {")
        generated.appendLine("    @JvmStatic")
        generated.appendLine("    fun register(container: DependencyContainer) {")
        concrete.sortedBy { it.qualifiedName?.asString() }.forEach { declaration ->
            val name = declaration.qualifiedName?.asString() ?: return@forEach
            val expression = constructionExpression(declaration)
            if (expression == null) return@forEach
            generated.appendLine(
                "        container.registerFactory($name::class, Lifetime.SINGLETON) { container -> $expression }",
            )
        }
        implementations.entries
            .sortedBy { it.key }
            .forEach { (superType, candidates) ->
                val filtered = candidates.mapNotNull { it.qualifiedName?.asString() }.distinct()
                when {
                    filtered.size == 1 && superType != filtered.first() ->
                        generated.appendLine(
                            "        container.registerAlias($superType::class, ${filtered.first()}::class)",
                        )

                    filtered.size > 1 ->
                        generated.appendLine(
                            "        container.registerAmbiguous(" +
                                "$superType::class, listOf(" +
                                filtered.joinToString(", ") { "$it::class" } +
                                "))",
                        )
                }
            }
        generated.appendLine("    }")
        generated.appendLine("}")
        val file = codeGenerator.createNewFile(
            Dependencies(false, *files.toTypedArray()),
            "dev.ivlev.silent.ui.di.generated",
            "GeneratedDi",
            "kt",
        )
        file.write(generated.toString().toByteArray())
        file.close()
        return emptyList()
    }

    private fun collectClasses(declarations: Sequence<KSAnnotated>): List<KSClassDeclaration> {
        val result = mutableListOf<KSClassDeclaration>()
        declarations.forEach { declaration ->
            if (declaration is KSClassDeclaration) {
                result.add(declaration)
                result.addAll(collectClasses(declaration.declarations))
            }
        }
        return result
    }

    private fun isConcrete(declaration: KSClassDeclaration): Boolean {
        if (declaration.classKind == ClassKind.INTERFACE) return false
        if (declaration.classKind == ClassKind.ANNOTATION_CLASS) return false
        if (declaration.classKind == ClassKind.ENUM_CLASS) return false
        val modifiers = declaration.modifiers
        if (Modifier.ABSTRACT in modifiers || Modifier.SEALED in modifiers) return false
        if (Modifier.PRIVATE in modifiers || Modifier.PROTECTED in modifiers) return false
        if (declaration.typeParameters.isNotEmpty()) return false
        return isAccessible(declaration)
    }

    private fun isAccessible(declaration: KSClassDeclaration): Boolean {
        var current: com.google.devtools.ksp.symbol.KSDeclaration? = declaration
        while (current != null) {
            if (Modifier.PRIVATE in current.modifiers || Modifier.PROTECTED in current.modifiers) return false
            current = current.parentDeclaration
        }
        return true
    }

    private fun hasUsableConstructor(declaration: KSClassDeclaration): Boolean {
        if (declaration.classKind == ClassKind.OBJECT) return true
        val constructor = declaration.primaryConstructor ?: return false
        if (Modifier.PRIVATE in constructor.modifiers || Modifier.PROTECTED in constructor.modifiers) return false
        return true
    }

    private fun constructionExpression(declaration: KSClassDeclaration): String? {
        val name = declaration.qualifiedName?.asString() ?: return null
        if (declaration.classKind == ClassKind.OBJECT) return name
        val constructor = declaration.primaryConstructor ?: return null
        val arguments = mutableListOf<String>()
        constructor.parameters.forEach { parameter ->
            if (parameter.hasDefault) return@forEach
            val type = parameter.type.resolve()
            val argument = resolvableReference(type)
            if (argument == null) return null
            arguments.add("${parameter.name?.asString()} = container.resolve($argument::class)")
        }
        return "$name(" + arguments.joinToString(", ") + ")"
    }

    private fun resolvableReference(type: KSType): String? {
        if (type.arguments.isNotEmpty()) return null
        val declaration = type.declaration as? KSClassDeclaration ?: return null
        val qualified = declaration.qualifiedName?.asString() ?: return null
        if (qualified.startsWith("kotlin.")) return null
        if (declaration.classKind == ClassKind.ENUM_CLASS) return null
        return qualified
    }

    private fun buildImplementations(
        classes: List<KSClassDeclaration>,
    ): Map<String, List<KSClassDeclaration>> {
        val result = LinkedHashMap<String, MutableList<KSClassDeclaration>>()
        classes.filter { isConcrete(it) }.forEach { implementation ->
            collectSupertypes(implementation).forEach { supertype ->
                val qualified = supertype.qualifiedName?.asString() ?: return@forEach
                if (qualified == "kotlin.Any") return@forEach
                if (qualified.startsWith("kotlin.")) return@forEach
                if (!isAccessible(supertype)) return@forEach
                if (supertype.classKind != ClassKind.INTERFACE &&
                    Modifier.ABSTRACT !in supertype.modifiers
                ) {
                    return@forEach
                }
                result.getOrPut(qualified) { mutableListOf() }.add(implementation)
            }
        }
        return result
    }

    private fun collectSupertypes(declaration: KSClassDeclaration): List<KSClassDeclaration> {
        val result = mutableListOf<KSClassDeclaration>()
        val visited = mutableSetOf<String>()
        fun visit(current: KSClassDeclaration) {
            current.superTypes.forEach { reference ->
                val resolved = reference.resolve().declaration as? KSClassDeclaration ?: return@forEach
                val qualified = resolved.qualifiedName?.asString() ?: return@forEach
                if (visited.add(qualified)) {
                    result.add(resolved)
                    visit(resolved)
                }
            }
        }
        visit(declaration)
        return result
    }
}
