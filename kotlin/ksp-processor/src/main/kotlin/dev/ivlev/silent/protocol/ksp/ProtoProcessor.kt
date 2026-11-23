package dev.ivlev.silent.protocol.ksp

import com.google.devtools.ksp.getDeclaredProperties
import com.google.devtools.ksp.processing.CodeGenerator
import com.google.devtools.ksp.processing.Dependencies
import com.google.devtools.ksp.processing.KSPLogger
import com.google.devtools.ksp.processing.Resolver
import com.google.devtools.ksp.processing.SymbolProcessor
import com.google.devtools.ksp.processing.SymbolProcessorEnvironment
import com.google.devtools.ksp.processing.SymbolProcessorProvider
import com.google.devtools.ksp.symbol.ClassKind
import com.google.devtools.ksp.symbol.KSAnnotated
import com.google.devtools.ksp.symbol.KSAnnotation
import com.google.devtools.ksp.symbol.KSClassDeclaration
import com.google.devtools.ksp.symbol.KSFile
import com.google.devtools.ksp.symbol.KSPropertyDeclaration
import com.google.devtools.ksp.symbol.KSValueParameter
import com.google.devtools.ksp.symbol.Modifier
import com.google.devtools.ksp.validate

public class ProtoProcessorProvider : SymbolProcessorProvider {
    override fun create(environment: SymbolProcessorEnvironment): SymbolProcessor =
        ProtoProcessor(environment.codeGenerator, environment.logger)
}

public class ProtoProcessor(
    private val codeGenerator: CodeGenerator,
    private val logger: KSPLogger,
) : SymbolProcessor {
    private val resolver = TypeResolver(logger)

    override fun process(resolver: Resolver): List<com.google.devtools.ksp.symbol.KSAnnotated> {
        val symbols = resolver.getSymbolsWithAnnotation(PROTO_ANNOTATION)
            .filterIsInstance<KSClassDeclaration>()
            .filter { it.classKind == ClassKind.CLASS }
            .sortedBy { it.qualifiedName?.asString() }
        val deferred = mutableListOf<KSAnnotated>()
        for (symbol in symbols) {
            if (!symbol.isValid()) {
                deferred += symbol
                continue
            }
            val model = buildModel(symbol)
            if (model != null) {
                generate(model, symbol)
            }
        }
        return deferred
    }

    private fun KSClassDeclaration.isValid(): Boolean =
        validate() && !modifiers.contains(Modifier.PRIVATE) && !modifiers.contains(Modifier.PROTECTED)

    private fun buildModel(declaration: KSClassDeclaration): MessageModel? {
        val qname = declaration.qualifiedName?.asString() ?: run {
            logger.error("@Proto class has no qualified name", declaration)
            return null
        }
        val packageName = declaration.packageName.asString()
        val constructor = declaration.primaryConstructor ?: run {
            logger.error("@Proto class '$qname' must have a primary constructor", declaration)
            return null
        }
        if (declaration.typeParameters.isNotEmpty()) {
            logger.error("@Proto class '$qname' must not declare type parameters", declaration)
            return null
        }
        val parameters = constructor.parameters
        val parametersByName = parameters.mapNotNull { parameter ->
            val name = parameter.name?.asString() ?: return@mapNotNull null
            name to parameter
        }.toMap()
        if (parametersByName.size != parameters.size) {
            logger.error("@Proto class '$qname' has unnamed constructor parameters", declaration)
            return null
        }
        val collected = LinkedHashMap<String, KSPropertyDeclaration>()
        collectProperties(declaration, collected)
        val fields = ArrayList<FieldModel>()
        for ((name, property) in collected) {
            if (property.modifiers.contains(Modifier.PRIVATE) || property.modifiers.contains(Modifier.PROTECTED)) {
                logger.error("property '$name' of '$qname' must be public or internal", property)
                return null
            }
            val parameter = parametersByName[name]
            if (parameter == null) {
                logger.error(
                    "property '$name' of '$qname' must be a primary constructor parameter",
                    property,
                )
                return null
            }
            val annotations = mergeAnnotations(property, parameter)
            val type = resolver.resolveProperty(property, annotations) ?: return null
            val oneOf = annotations["OneOf"]?.wireArgument()
            fields += FieldModel(name, type, oneOf, annotations, property)
        }
        for ((name, parameter) in parametersByName) {
            if (collected.containsKey(name)) continue
            if (!parameter.hasDefault) {
                logger.error(
                    "constructor parameter '$name' of '$qname' is not a @Proto property",
                    parameter,
                )
                return null
            }
        }
        val variants = fields.filter { it.oneOf != null }
        val regular = fields.filter { it.oneOf == null }
        for (field in fields) {
            if (!validateFieldType(field, qname)) return null
        }
        val discriminators = regular.filter {
            it.type.shape is EnumShape && !it.type.nullable
        }
        val discriminator = when {
            variants.isEmpty() -> null
            discriminators.size == 1 -> discriminators.single()
            discriminators.isEmpty() -> {
                logger.error(
                    "@Proto class '$qname' declares @OneOf fields but no non-nullable enum discriminator",
                    declaration,
                )
                return null
            }
            else -> {
                logger.error(
                    "@Proto class '$qname' has multiple enum fields; the oneof discriminator is ambiguous",
                    declaration,
                )
                return null
            }
        }
        if (variants.isNotEmpty()) {
            val values = HashSet<Int>()
            for (variant in variants) {
                if (!variant.type.nullable) {
                    logger.error("@OneOf property '${variant.name}' must be nullable", variant.node)
                    return null
                }
                val value = variant.oneOf!!
                if (value < 0) {
                    logger.error("@OneOf value must be non-negative in '$qname'", variant.node)
                    return null
                }
                if (!values.add(value)) {
                    logger.error("duplicate @OneOf value $value in '$qname'", variant.node)
                    return null
                }
            }
        }
        val sortedFields = regular.sortedWith(FIELD_NAME_COMPARATOR)
        val bitmapFields = sortedFields.filter { it.type.nullable }
        val codecName = codecNameFor(qname, packageName)
        return MessageModel(
            qname = qname,
            simpleName = declaration.simpleName.asString(),
            packageName = packageName,
            codecName = codecName,
            codecQName = if (packageName.isEmpty()) codecName else "$packageName.$codecName",
            internalVisibility = isInternal(declaration),
            fields = fields,
            sortedFields = sortedFields,
            bitmapFields = bitmapFields,
            oneOfVariants = variants.sortedWith(FIELD_NAME_COMPARATOR),
            discriminator = discriminator,
            constructorParameters = parameters,
        )
    }

    private fun collectProperties(
        declaration: KSClassDeclaration,
        target: LinkedHashMap<String, KSPropertyDeclaration>,
    ) {
        val superClass = declaration.superTypes
            .mapNotNull { it.resolve().declaration as? KSClassDeclaration }
            .firstOrNull {
                it.classKind == ClassKind.CLASS && it.qualifiedName?.asString() != "kotlin.Any"
            }
        if (superClass != null) collectProperties(superClass, target)
        for (property in declaration.getDeclaredProperties()) {
            if (property.extensionReceiver != null) continue
            target[property.simpleName.asString()] = property
        }
    }

    private fun mergeAnnotations(
        property: KSPropertyDeclaration,
        parameter: KSValueParameter,
    ): Map<String, KSAnnotation> {
        val result = LinkedHashMap<String, KSAnnotation>()
        result.putAll(collectProtocolAnnotations(property))
        for ((name, annotation) in collectProtocolAnnotations(parameter)) {
            result.putIfAbsent(name, annotation)
        }
        return result
    }

    private fun validateFieldType(field: FieldModel, owner: String): Boolean {
        fun visit(type: PType, insideOneOf: Boolean): Boolean {
            return when (val shape = type.shape) {
                UnitShape -> {
                    if (!insideOneOf) {
                        logger.error(
                            "kotlin.Unit is only supported as an empty @OneOf variant in '$owner'",
                            field.node,
                        )
                        false
                    } else {
                        true
                    }
                }
                is ScalarShape, is PackedArrayShape, is EnumShape, is MessageShape -> true
                is ListShape -> visit(shape.element, false)
                is ArrayShape -> visit(shape.element, false)
                is SetShape -> {
                    if (!isCanonicalOrder(shape.element)) {
                        logger.error(
                            "set element type has no canonical order in '$owner': ${shape.element}",
                            field.node,
                        )
                        false
                    } else {
                        true
                    }
                }
                is MapShape -> {
                    if (!isCanonicalOrder(shape.key)) {
                        logger.error(
                            "map key type has no canonical order in '$owner': ${shape.key}",
                            field.node,
                        )
                        false
                    } else {
                        visit(shape.value, false)
                    }
                }
            }
        }
        return visit(field.type, field.oneOf != null)
    }

    private fun isCanonicalOrder(type: PType): Boolean {
        if (type.nullable) return false
        return when (val shape = type.shape) {
            is EnumShape -> true
            is ScalarShape -> shape.kotlin in CANONICAL_SCALARS
            else -> false
        }
    }

    private fun generate(model: MessageModel, declaration: KSClassDeclaration) {
        val containingFile = declaration.containingFile
        val dependencies = if (containingFile == null) {
            Dependencies(aggregating = true)
        } else {
            Dependencies(aggregating = true, *arrayOf<KSFile>(containingFile))
        }
        val file = codeGenerator.createNewFile(
            dependencies,
            model.packageName,
            model.codecName,
            "kt",
        )
        file.bufferedWriter(Charsets.UTF_8).use { writer ->
            writer.write(CodecGenerator(model).generate())
        }
    }

    private companion object {
        val CANONICAL_SCALARS = setOf(
            KotlinScalar.STRING,
            KotlinScalar.BOOLEAN,
            KotlinScalar.BYTE,
            KotlinScalar.SHORT,
            KotlinScalar.INT,
            KotlinScalar.LONG,
            KotlinScalar.UBYTE,
            KotlinScalar.USHORT,
            KotlinScalar.UINT,
            KotlinScalar.ULONG,
        )
    }
}
