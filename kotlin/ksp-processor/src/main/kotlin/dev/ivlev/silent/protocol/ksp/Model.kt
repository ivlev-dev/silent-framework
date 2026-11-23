package dev.ivlev.silent.protocol.ksp

import com.google.devtools.ksp.processing.KSPLogger
import com.google.devtools.ksp.symbol.KSAnnotated
import com.google.devtools.ksp.symbol.KSAnnotation
import com.google.devtools.ksp.symbol.KSClassDeclaration
import com.google.devtools.ksp.symbol.KSPropertyDeclaration
import com.google.devtools.ksp.symbol.KSType
import com.google.devtools.ksp.symbol.KSTypeAlias
import com.google.devtools.ksp.symbol.KSValueParameter
import com.google.devtools.ksp.symbol.Modifier

internal const val PROTOCOL_PACKAGE = "dev.ivlev.silent.protocol."
internal const val PROTO_ANNOTATION = "dev.ivlev.silent.protocol.Proto"
internal const val PROTOCOL_ENUM_INTERFACE = "dev.ivlev.silent.protocol.ProtocolEnum"

internal enum class Scalar(val fingerprint: String) {
    BOOL("bool"),
    INT32("int32"),
    INT64("int64"),
    UINT32("uint32"),
    UINT64("uint64"),
    FIXED32("fixed32"),
    FIXED64("fixed64"),
    FLOAT32("float32"),
    FLOAT64("float64"),
    STRING("string"),
    BYTES("bytes"),
    DATE("date"),
}

internal enum class KotlinScalar {
    BOOLEAN,
    BYTE,
    SHORT,
    INT,
    LONG,
    UBYTE,
    USHORT,
    UINT,
    ULONG,
    FLOAT,
    DOUBLE,
    STRING,
    BYTE_ARRAY,
    INSTANT,
}

internal sealed interface Shape

internal data object UnitShape : Shape

internal data class ScalarShape(
    val scalar: Scalar,
    val kotlin: KotlinScalar,
) : Shape

internal data class PackedArrayShape(
    val element: KotlinScalar,
    val elementSize: Int,
    val fingerprintElement: String,
) : Shape

internal data class EnumShape(
    val qname: String,
    val simpleName: String,
    val explicitValues: Boolean,
) : Shape

internal data class MessageShape(
    val qname: String,
    val simpleName: String,
    val codecQName: String,
) : Shape

internal data class ListShape(val element: PType) : Shape

internal data class SetShape(val element: PType) : Shape

internal data class ArrayShape(val element: PType) : Shape

internal data class MapShape(val key: PType, val value: PType) : Shape

internal data class PType(
    val shape: Shape,
    val nullable: Boolean,
) {
    fun nonNull(): PType = if (nullable) copy(nullable = false) else this
}

internal class FieldModel(
    val name: String,
    val type: PType,
    val oneOf: Int?,
    val annotations: Map<String, KSAnnotation>,
    val node: KSPropertyDeclaration,
)

internal class MessageModel(
    val qname: String,
    val simpleName: String,
    val packageName: String,
    val codecName: String,
    val codecQName: String,
    val internalVisibility: Boolean,
    val fields: List<FieldModel>,
    val sortedFields: List<FieldModel>,
    val bitmapFields: List<FieldModel>,
    val oneOfVariants: List<FieldModel>,
    val discriminator: FieldModel?,
    val constructorParameters: List<KSValueParameter>,
) {
    val fingerprint: String = buildString {
        append(simpleName)
        append('{')
        val ordered = (sortedFields + oneOfVariants).sortedWith(FIELD_NAME_COMPARATOR)
        ordered.forEachIndexed { index, field ->
            if (index > 0) append(';')
            val oneOf = field.oneOf
            append(field.name)
            append(':')
            if (oneOf != null) {
                append("oneof(")
                append(oneOf)
                append(',')
                append(fingerprintType(field.type.nonNull()))
                append(')')
            } else {
                append(fingerprintType(field.type))
            }
        }
        append('}')
    }
}

internal val FIELD_NAME_COMPARATOR: Comparator<FieldModel> =
    Comparator { left, right -> compareUtf8(left.name, right.name) }

internal fun compareUtf8(left: String, right: String): Int {
    var leftIndex = 0
    var rightIndex = 0
    while (leftIndex < left.length && rightIndex < right.length) {
        val leftCodePoint = codePointAt(left, leftIndex)
        val rightCodePoint = codePointAt(right, rightIndex)
        if (leftCodePoint != rightCodePoint) return leftCodePoint.compareTo(rightCodePoint)
        leftIndex += if (leftCodePoint > 0xFFFF) 2 else 1
        rightIndex += if (rightCodePoint > 0xFFFF) 2 else 1
    }
    return (left.length - leftIndex).compareTo(right.length - rightIndex)
}

private fun codePointAt(value: String, index: Int): Int {
    val high = value[index]
    if (high.isHighSurrogate() && index + 1 < value.length) {
        val low = value[index + 1]
        if (low.isLowSurrogate()) {
            return 0x10000 + ((high.code - 0xD800) shl 10) + (low.code - 0xDC00)
        }
    }
    return high.code
}

internal fun fingerprintType(type: PType): String {
    val base = when (val shape = type.shape) {
        is ScalarShape -> shape.scalar.fingerprint
        is PackedArrayShape -> "array(${shape.fingerprintElement})"
        is EnumShape -> "enum(${shape.simpleName})"
        is MessageShape -> "class(${shape.simpleName})"
        is ListShape -> "array(${fingerprintType(shape.element)})"
        is ArrayShape -> "array(${fingerprintType(shape.element)})"
        is SetShape -> "set(${fingerprintType(shape.element)})"
        is MapShape -> "map(${fingerprintType(shape.key)},${fingerprintType(shape.value)})"
        UnitShape -> "unit"
    }
    return if (type.nullable) "$base?" else base
}

internal fun KSAnnotation.wireArgument(name: String = "value"): Int? {
    val argument = arguments.firstOrNull { it.name?.asString() == name }
        ?: arguments.firstOrNull { it.name == null }
    return argument?.value as? Int
}

internal fun collectProtocolAnnotations(symbol: KSAnnotated): Map<String, KSAnnotation> {
    val result = LinkedHashMap<String, KSAnnotation>()
    for (annotation in symbol.annotations) {
        val declaration = annotation.annotationType.resolve().declaration
        val qname = declaration.qualifiedName?.asString() ?: continue
        if (!qname.startsWith(PROTOCOL_PACKAGE)) continue
        result[qname.removePrefix(PROTOCOL_PACKAGE)] = annotation
    }
    return result
}

internal fun isProtoClass(declaration: KSClassDeclaration): Boolean =
    declaration.annotations.any {
        it.annotationType.resolve().declaration.qualifiedName?.asString() == PROTO_ANNOTATION
    }

internal fun isInternal(declaration: KSClassDeclaration): Boolean =
    declaration.modifiers.contains(Modifier.INTERNAL)

internal fun codecNameFor(qname: String, packageName: String): String {
    val relative = if (packageName.isEmpty()) qname else qname.removePrefix("$packageName.")
    return relative.replace('.', '_') + "Codec"
}

internal class TypeResolver(private val logger: KSPLogger) {
    fun resolveProperty(
        property: KSPropertyDeclaration,
        annotations: Map<String, KSAnnotation>,
    ): PType? {
        val wireAnnotations = annotations.keys.filter { it in WIRE_ANNOTATIONS }
        if (wireAnnotations.size > 1) {
            logger.error(
                "property '${property.simpleName.asString()}' has conflicting wire annotations: " +
                    wireAnnotations.joinToString(),
                property,
            )
            return null
        }
        val base = resolve(property.type.resolve(), property) ?: return null
        val override = wireAnnotations.firstOrNull() ?: return base
        if (base.shape !is ScalarShape) {
            logger.error(
                "wire annotation @$override can only be applied to scalar properties",
                property,
            )
            return null
        }
        val scalar = applyOverride(base.shape, override, property) ?: return null
        return base.copy(shape = scalar)
    }

    fun resolve(type: KSType, node: KSPropertyDeclaration? = null): PType? {
        val normalized = unwrapAliases(type)
        val declaration = normalized.declaration as? KSClassDeclaration
        if (declaration == null) {
            logger.error("unsupported type '${normalized}'", node)
            return null
        }
        val qname = declaration.qualifiedName?.asString()
        if (qname == null) {
            logger.error("unsupported local or anonymous type '${normalized}'", node)
            return null
        }
        val nullable = normalized.isMarkedNullable
        val shape = when (qname) {
            "kotlin.Boolean" -> ScalarShape(Scalar.BOOL, KotlinScalar.BOOLEAN)
            "kotlin.Byte" -> ScalarShape(Scalar.INT32, KotlinScalar.BYTE)
            "kotlin.Short" -> ScalarShape(Scalar.INT32, KotlinScalar.SHORT)
            "kotlin.Int" -> ScalarShape(Scalar.INT32, KotlinScalar.INT)
            "kotlin.Long" -> ScalarShape(Scalar.INT64, KotlinScalar.LONG)
            "kotlin.UByte" -> ScalarShape(Scalar.UINT32, KotlinScalar.UBYTE)
            "kotlin.UShort" -> ScalarShape(Scalar.UINT32, KotlinScalar.USHORT)
            "kotlin.UInt" -> ScalarShape(Scalar.UINT32, KotlinScalar.UINT)
            "kotlin.ULong" -> ScalarShape(Scalar.UINT64, KotlinScalar.ULONG)
            "kotlin.Float" -> ScalarShape(Scalar.FLOAT32, KotlinScalar.FLOAT)
            "kotlin.Double" -> ScalarShape(Scalar.FLOAT64, KotlinScalar.DOUBLE)
            "kotlin.String" -> ScalarShape(Scalar.STRING, KotlinScalar.STRING)
            "kotlin.ByteArray" -> ScalarShape(Scalar.BYTES, KotlinScalar.BYTE_ARRAY)
            "kotlin.ShortArray" -> PackedArrayShape(KotlinScalar.SHORT, 2, "int16")
            "kotlin.IntArray" -> PackedArrayShape(KotlinScalar.INT, 4, "int32")
            "kotlin.LongArray" -> PackedArrayShape(KotlinScalar.LONG, 8, "int64")
            "kotlin.FloatArray" -> PackedArrayShape(KotlinScalar.FLOAT, 4, "float32")
            "kotlin.DoubleArray" -> PackedArrayShape(KotlinScalar.DOUBLE, 8, "float64")
            "kotlin.Unit" -> UnitShape
            "kotlinx.datetime.Instant" -> ScalarShape(Scalar.DATE, KotlinScalar.INSTANT)
            "kotlin.Array" -> {
                val element = singleTypeArgument(normalized, declaration, node) ?: return null
                ArrayShape(element)
            }
            "kotlin.collections.List",
            "kotlin.collections.MutableList",
            "kotlin.collections.Collection",
            "kotlin.collections.MutableCollection",
            -> {
                val element = singleTypeArgument(normalized, declaration, node) ?: return null
                ListShape(element)
            }
            "kotlin.collections.Set",
            "kotlin.collections.MutableSet",
            -> {
                val element = singleTypeArgument(normalized, declaration, node) ?: return null
                SetShape(element)
            }
            "kotlin.collections.Map",
            "kotlin.collections.MutableMap",
            -> {
                val arguments = normalized.arguments
                if (arguments.size != 2) {
                    logger.error("map type must have exactly two type arguments", node)
                    return null
                }
                val keyType = arguments[0].type?.resolve() ?: run {
                    logger.error("map key type is missing", node)
                    return null
                }
                val valueType = arguments[1].type?.resolve() ?: run {
                    logger.error("map value type is missing", node)
                    return null
                }
                val key = resolve(keyType, node) ?: return null
                val value = resolve(valueType, node) ?: return null
                MapShape(key, value)
            }
            else -> {
                if (declaration.classKind == com.google.devtools.ksp.symbol.ClassKind.ENUM_CLASS) {
                    if (declaration.typeParameters.isNotEmpty()) {
                        logger.error("generic enums are not supported", node)
                        return null
                    }
                    EnumShape(qname, declaration.simpleName.asString(), implementsProtocolEnum(declaration))
                } else {
                    if (!isProtoClass(declaration)) {
                        logger.error(
                            "type '$qname' is not annotated with @Proto and has no supported wire mapping",
                            node,
                        )
                        return null
                    }
                    if (declaration.typeParameters.isNotEmpty()) {
                        logger.error("generic @Proto classes are not supported", node)
                        return null
                    }
                    val packageName = declaration.packageName.asString()
                    val codecName = codecNameFor(qname, packageName)
                    val codecQName = if (packageName.isEmpty()) codecName else "$packageName.$codecName"
                    MessageShape(qname, declaration.simpleName.asString(), codecQName)
                }
            }
        }
        return PType(shape, nullable)
    }

    private fun applyOverride(
        shape: ScalarShape,
        annotation: String,
        property: KSPropertyDeclaration,
    ): ScalarShape? {
        val kotlin = shape.kotlin
        val isSignedInteger = kotlin in SIGNED_INTEGERS
        val isWideInteger = kotlin == KotlinScalar.INT ||
            kotlin == KotlinScalar.LONG ||
            kotlin == KotlinScalar.UINT ||
            kotlin == KotlinScalar.ULONG
        val result = when (annotation) {
            "Int32" -> if (isSignedInteger) ScalarShape(Scalar.INT32, kotlin) else null
            "Uint32" -> if (isWideInteger) ScalarShape(Scalar.UINT32, kotlin) else null
            "Float32" -> if (kotlin == KotlinScalar.FLOAT || kotlin == KotlinScalar.DOUBLE) {
                ScalarShape(Scalar.FLOAT32, kotlin)
            } else {
                null
            }
            "Fixed32" -> if (isWideInteger) ScalarShape(Scalar.FIXED32, kotlin) else null
            "Fixed64" -> if (kotlin == KotlinScalar.LONG || kotlin == KotlinScalar.ULONG) {
                ScalarShape(Scalar.FIXED64, kotlin)
            } else {
                null
            }
            "Uint64" -> if (kotlin == KotlinScalar.LONG || kotlin == KotlinScalar.ULONG) {
                ScalarShape(Scalar.UINT64, kotlin)
            } else {
                null
            }
            "EpochMillis" -> if (kotlin == KotlinScalar.LONG) {
                ScalarShape(Scalar.DATE, kotlin)
            } else {
                null
            }
            else -> shape
        }
        if (result == null) {
            logger.error(
                "wire annotation @$annotation is not applicable to ${property.type}",
                property,
            )
        }
        return result
    }

    private fun singleTypeArgument(
        type: KSType,
        declaration: KSClassDeclaration,
        node: KSPropertyDeclaration?,
    ): PType? {
        val argument = type.arguments.singleOrNull()?.type?.resolve()
        if (argument == null) {
            logger.error(
                "type '${declaration.qualifiedName?.asString()}' must have exactly one type argument",
                node,
            )
            return null
        }
        return resolve(argument, node)
    }

    private fun implementsProtocolEnum(declaration: KSClassDeclaration): Boolean {
        val visited = HashSet<String>()
        fun visit(current: KSClassDeclaration): Boolean {
            val qname = current.qualifiedName?.asString() ?: return false
            if (!visited.add(qname)) return false
            if (qname == PROTOCOL_ENUM_INTERFACE) return true
            return current.superTypes.any { superType ->
                val superDeclaration = superType.resolve().declaration as? KSClassDeclaration
                superDeclaration != null && visit(superDeclaration)
            }
        }
        return visit(declaration)
    }

    private fun unwrapAliases(type: KSType): KSType {
        var current = type
        var guard = 0
        while (guard < 16) {
            guard += 1
            val declaration = current.declaration
            if (declaration !is KSTypeAlias) return current
            val resolved = declaration.type.resolve()
            current = if (current.isMarkedNullable) resolved.makeNullable() else resolved
        }
        return current
    }

    private companion object {
        val SIGNED_INTEGERS = setOf(
            KotlinScalar.BYTE,
            KotlinScalar.SHORT,
            KotlinScalar.INT,
            KotlinScalar.LONG,
        )
        val WIRE_ANNOTATIONS = setOf(
            "Int32",
            "Uint32",
            "Float32",
            "Fixed32",
            "Fixed64",
            "Uint64",
            "EpochMillis",
        )
    }
}
