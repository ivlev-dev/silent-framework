package dev.ivlev.silent.protocol.ksp

internal class CodecGenerator(private val model: MessageModel) {
    private val output = StringBuilder()
    private var counter = 0

    fun generate(): String {
        writeHeader()
        writeFingerprint()
        writeEncode()
        writeDecode()
        output.append("}\n")
        return output.toString()
    }

    private fun writeHeader() {
        val visibility = if (model.internalVisibility) "internal" else "public"
        if (model.packageName.isNotEmpty()) {
            output.append("package ").append(model.packageName).append('\n').append('\n')
        }
        line(0, "@Suppress(\"UNCHECKED_CAST\", \"UNUSED_VARIABLE\", \"unused\")")
        line(0, "${visibility} object ${model.codecName} : $PROTO_CODEC<${model.qname}> {")
    }

    private fun writeFingerprint() {
        val escaped = model.fingerprint
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("$", "\\$")
        line(1, "private const val FINGERPRINT: String = \"$escaped\"")
        line(0, "")
    }

    private fun writeEncode() {
        line(1, "override fun encode(value: ${model.qname}): ByteArray {")
        line(2, "val writer = $PROTO_WRITER()")
        line(2, "encode(value, writer)")
        line(2, "return writer.toByteArray()")
        line(1, "}")
        line(0, "")
        line(1, "fun encode(value: ${model.qname}, options: $PROTOCOL_OPTIONS): ByteArray {")
        line(2, "val writer = $PROTO_WRITER(options)")
        line(2, "encode(value, writer)")
        line(2, "return writer.toByteArray()")
        line(1, "}")
        line(0, "")
        line(1, "fun encode(value: ${model.qname}, writer: $PROTO_WRITER) {")
        line(2, "writer.enter(value)")
        val optionalLocals = LinkedHashMap<String, String>()
        for (field in model.bitmapFields) {
            val local = nextName("fieldValue")
            optionalLocals[field.name] = local
            line(2, "val $local = value.${field.name}")
        }
        if (model.bitmapFields.isNotEmpty()) {
            line(2, "val bitmap = writer.reserveBitmap(${model.bitmapFields.size})")
            model.bitmapFields.forEachIndexed { index, field ->
                line(2, "if (${optionalLocals.getValue(field.name)} != null) writer.setBit(bitmap, $index)")
            }
        }
        for (field in model.sortedFields) {
            if (field.name == model.discriminator?.name) {
                emitEncodeOneOf(2)
            } else if (field.type.nullable) {
                val local = optionalLocals.getValue(field.name)
                line(2, "if ($local != null) {")
                emitEncode(field.type.nonNull(), local, 3)
                line(2, "}")
            } else {
                emitEncode(field.type, "value.${field.name}", 2)
            }
        }
        line(2, "writer.leave(value)")
        line(1, "}")
        line(0, "")
    }

    private fun emitEncodeOneOf(indent: Int) {
        val discriminator = model.discriminator ?: return
        val enumShape = discriminator.type.shape as EnumShape
        val codeVar = nextName("code")
        line(indent, "val $codeVar = ${enumCode(enumShape, "value.${discriminator.name}")}")
        line(indent, "if ($codeVar < 0) throw $PROTOCOL_ERROR(\"negative oneof discriminator: $$codeVar\")")
        line(indent, "writer.writeUInt($codeVar)")
        line(indent, "when ($codeVar) {")
        for (variant in model.oneOfVariants) {
            line(indent + 1, "${variant.oneOf} -> {")
            val valueVar = nextName("oneOfValue")
            line(indent + 2, "val $valueVar = value.${variant.name}")
            line(
                indent + 2,
                "if ($valueVar == null) throw $PROTOCOL_ERROR(\"oneof ${discriminator.name}=$$codeVar requires '${variant.name}'\")",
            )
            for (other in model.oneOfVariants) {
                if (other.name == variant.name) continue
                line(
                    indent + 2,
                    "if (value.${other.name} != null) throw $PROTOCOL_ERROR(\"oneof ${discriminator.name} has multiple variants\")",
                )
            }
            val payload = variant.type.nonNull()
            if (payload.shape !is UnitShape) {
                emitEncode(payload, valueVar, indent + 2)
            }
            line(indent + 1, "}")
        }
        line(
            indent + 1,
            "else -> throw $PROTOCOL_ERROR(\"unknown oneof discriminator for ${model.simpleName}: $$codeVar\")",
        )
        line(indent, "}")
    }

    private fun emitEncode(type: PType, expression: String, indent: Int) {
        when (val shape = type.shape) {
            is ScalarShape -> emitEncodeScalar(shape, expression, indent)
            is PackedArrayShape -> emitEncodePackedArray(shape, expression, indent)
            is EnumShape -> {
                val code = enumCode(shape, expression)
                line(indent, "if ($code < 0) throw $PROTOCOL_ERROR(\"negative enum value: $$code\")")
                line(indent, "writer.writeUInt($code)")
            }
            is MessageShape -> line(indent, "${shape.codecQName}.encode($expression, writer)")
            is ListShape -> emitEncodeSequence(shape.element, expression, indent)
            is ArrayShape -> emitEncodeSequence(shape.element, expression, indent)
            is SetShape -> {
                val sorted = nextName("sorted")
                val left = nextName("left")
                val right = nextName("right")
                line(
                    indent,
                    "val $sorted = $expression.sortedWith(kotlin.Comparator { $left, $right -> ${comparator(shape.element, left, right)} })",
                )
                emitEncodeSequence(shape.element, sorted, indent, alreadySorted = true)
            }
            is MapShape -> emitEncodeMap(shape, expression, indent)
            UnitShape -> Unit
        }
    }

    private fun emitEncodeScalar(shape: ScalarShape, expression: String, indent: Int) {
        when (shape.scalar) {
            Scalar.BOOL -> line(indent, "writer.writeBoolean($expression)")
            Scalar.INT32 -> when (shape.kotlin) {
                KotlinScalar.BYTE, KotlinScalar.SHORT, KotlinScalar.INT ->
                    line(indent, "writer.writeInt32($expression.toInt())")
                KotlinScalar.LONG ->
                    line(indent, "writer.writeInt32($PROTO_NUMBERS.requireInt32($expression))")
                else -> unsupported(shape)
            }
            Scalar.INT64 -> line(indent, "writer.writeInt64($expression)")
            Scalar.UINT32 -> when (shape.kotlin) {
                KotlinScalar.UBYTE, KotlinScalar.USHORT, KotlinScalar.INT, KotlinScalar.UINT ->
                    line(indent, "writer.writeUInt($expression.toInt())")
                KotlinScalar.LONG ->
                    line(indent, "writer.writeUInt($PROTO_NUMBERS.requireUInt32($expression))")
                KotlinScalar.ULONG ->
                    line(indent, "writer.writeUInt($PROTO_NUMBERS.requireUInt32($expression.toLong()))")
                else -> unsupported(shape)
            }
            Scalar.UINT64 -> when (shape.kotlin) {
                KotlinScalar.LONG -> line(indent, "writer.writeUInt64($expression)")
                KotlinScalar.ULONG -> line(indent, "writer.writeUInt64($expression.toLong())")
                else -> unsupported(shape)
            }
            Scalar.FIXED32 -> when (shape.kotlin) {
                KotlinScalar.INT, KotlinScalar.UINT ->
                    line(indent, "writer.writeFixed32($expression.toInt())")
                KotlinScalar.LONG ->
                    line(indent, "writer.writeFixed32($PROTO_NUMBERS.requireUInt32($expression))")
                KotlinScalar.ULONG ->
                    line(indent, "writer.writeFixed32($PROTO_NUMBERS.requireUInt32($expression.toLong()))")
                else -> unsupported(shape)
            }
            Scalar.FIXED64 -> when (shape.kotlin) {
                KotlinScalar.LONG -> line(indent, "writer.writeFixed64($expression)")
                KotlinScalar.ULONG -> line(indent, "writer.writeFixed64($expression.toLong())")
                else -> unsupported(shape)
            }
            Scalar.FLOAT32 -> when (shape.kotlin) {
                KotlinScalar.FLOAT -> line(indent, "writer.writeFloat32($expression)")
                KotlinScalar.DOUBLE -> line(indent, "writer.writeFloat32($expression.toFloat())")
                else -> unsupported(shape)
            }
            Scalar.FLOAT64 -> line(indent, "writer.writeFloat64($expression)")
            Scalar.STRING -> line(indent, "writer.writeString($expression)")
            Scalar.BYTES -> line(indent, "writer.writeBytes($expression)")
            Scalar.DATE -> when (shape.kotlin) {
                KotlinScalar.INSTANT -> line(indent, "writer.writeInt64($expression.toEpochMilliseconds())")
                KotlinScalar.LONG -> line(indent, "writer.writeInt64($expression)")
                else -> unsupported(shape)
            }
        }
    }

    private fun emitEncodePackedArray(shape: PackedArrayShape, expression: String, indent: Int) {
        val arrayVar = nextName("array")
        line(indent, "val $arrayVar = $expression")
        line(indent, "writer.writeVarint($arrayVar.size.toLong() * ${shape.elementSize}L)")
        line(indent, "for (element in $arrayVar) {")
        when (shape.element) {
            KotlinScalar.SHORT -> {
                line(indent + 1, "writer.writeRawByte(element.toInt())")
                line(indent + 1, "writer.writeRawByte(element.toInt() ushr 8)")
            }
            KotlinScalar.INT -> line(indent + 1, "writer.writeFixed32(element)")
            KotlinScalar.LONG -> line(indent + 1, "writer.writeFixed64(element)")
            KotlinScalar.FLOAT -> line(indent + 1, "writer.writeFloat32(element)")
            KotlinScalar.DOUBLE -> line(indent + 1, "writer.writeFloat64(element)")
            else -> unsupported(shape)
        }
        line(indent, "}")
    }

    private fun emitEncodeSequence(
        element: PType,
        expression: String,
        indent: Int,
        alreadySorted: Boolean = false,
    ) {
        val sequence = if (alreadySorted) expression else nextName("sequence")
        if (!alreadySorted) line(indent, "val $sequence = $expression")
        line(indent, "writer.writeVarint($sequence.size.toLong())")
        if (element.nullable) {
            val bitmap = nextName("bitmap")
            val index = nextName("index")
            line(indent, "val $bitmap = writer.reserveBitmap($sequence.size)")
            line(indent, "for ($index in 0 until $sequence.size) {")
            line(indent + 1, "if ($sequence[$index] != null) writer.setBit($bitmap, $index)")
            line(indent, "}")
            val item = nextName("item")
            line(indent, "for ($item in $sequence) {")
            line(indent + 1, "if ($item != null) {")
            emitEncode(element.nonNull(), item, indent + 2)
            line(indent + 1, "}")
            line(indent, "}")
        } else {
            val item = nextName("item")
            line(indent, "for ($item in $sequence) {")
            emitEncode(element, item, indent + 1)
            line(indent, "}")
        }
    }

    private fun emitEncodeMap(shape: MapShape, expression: String, indent: Int) {
        val entries = nextName("entries")
        val left = nextName("left")
        val right = nextName("right")
        line(
            indent,
            "val $entries = $expression.entries.sortedWith(kotlin.Comparator { $left, $right -> " +
                "${comparator(shape.key, "$left.key", "$right.key")} })",
        )
        line(indent, "writer.writeVarint($entries.size.toLong())")
        val value = shape.value
        if (value.nullable) {
            val bitmap = nextName("bitmap")
            val index = nextName("index")
            line(indent, "val $bitmap = writer.reserveBitmap($entries.size)")
            line(indent, "for ($index in 0 until $entries.size) {")
            line(indent + 1, "if ($entries[$index].value != null) writer.setBit($bitmap, $index)")
            line(indent, "}")
            val entry = nextName("entry")
            line(indent, "for ($entry in $entries) {")
            val entryValue = nextName("entryValue")
            line(indent + 1, "val $entryValue = $entry.value")
            emitEncode(shape.key, "$entry.key", indent + 1)
            line(indent + 1, "if ($entryValue != null) {")
            emitEncode(value.nonNull(), entryValue, indent + 2)
            line(indent + 1, "}")
            line(indent, "}")
        } else {
            val entry = nextName("entry")
            line(indent, "for ($entry in $entries) {")
            emitEncode(shape.key, "$entry.key", indent + 1)
            emitEncode(value, "$entry.value", indent + 1)
            line(indent, "}")
        }
    }

    private fun writeDecode() {
        line(1, "override fun decode(bytes: ByteArray): ${model.qname} {")
        line(2, "val reader = $PROTO_READER(bytes)")
        line(2, "val value = decode(reader)")
        line(2, "reader.requireEnd()")
        line(2, "return value")
        line(1, "}")
        line(0, "")
        line(1, "fun decode(bytes: ByteArray, options: $PROTOCOL_OPTIONS): ${model.qname} {")
        line(2, "val reader = $PROTO_READER(bytes, options = options)")
        line(2, "val value = decode(reader)")
        line(2, "reader.requireEnd()")
        line(2, "return value")
        line(1, "}")
        line(0, "")
        line(1, "fun decode(reader: $PROTO_READER): ${model.qname} {")
        line(2, "reader.enter()")
        val names = HashMap<String, String>()
        for (variant in model.oneOfVariants) {
            val name = nextName("field")
            names[variant.name] = name
            line(2, "var $name: ${kotlinType(variant.type)} = null")
        }
        var bitmapVariable: String? = null
        if (model.bitmapFields.isNotEmpty()) {
            bitmapVariable = nextName("bitmap")
            line(2, "val $bitmapVariable = reader.readBitmapOffset(${model.bitmapFields.size})")
        }
        var bitmapIndex = 0
        for (field in model.sortedFields) {
            if (field.name == model.discriminator?.name) {
                emitDecodeOneOf(2, names)
            } else {
                val name = nextName("field")
                names[field.name] = name
                if (field.type.nullable) {
                    val bit = bitmapIndex
                    bitmapIndex += 1
                    line(2, "val $name: ${kotlinType(field.type)} = if (reader.isSet($bitmapVariable, $bit)) {")
                    val decoded = emitDecode(field.type.nonNull(), 3)
                    line(3, decoded)
                    line(2, "} else {")
                    line(3, "null")
                    line(2, "}")
                } else {
                    val decoded = emitDecode(field.type, 2)
                    line(2, "val $name: ${kotlinType(field.type)} = $decoded")
                }
            }
        }
        line(2, "reader.leave()")
        line(2, "return ${model.qname}(")
        for (parameter in model.constructorParameters) {
            val parameterName = parameter.name?.asString() ?: continue
            val local = names[parameterName]
            if (local != null) {
                line(3, "$parameterName = $local,")
            }
        }
        line(2, ")")
        line(1, "}")
        line(0, "")
        line(1, "override fun schemaFingerprint(): String = FINGERPRINT")
    }

    private fun emitDecodeOneOf(indent: Int, names: MutableMap<String, String>) {
        val discriminator = model.discriminator ?: return
        val enumShape = discriminator.type.shape as EnumShape
        val code = nextName("oneOfCode")
        val discriminatorName = nextName("field")
        names[discriminator.name] = discriminatorName
        line(indent, "val $code = reader.readEnumCode()")
        val value = enumValueFromCode(enumShape, code, indent)
        line(indent, "val $discriminatorName: ${kotlinType(discriminator.type)} = $value")
        line(indent, "when ($code) {")
        for (variant in model.oneOfVariants) {
            line(indent + 1, "${variant.oneOf} -> {")
            val target = names[variant.name] ?: nextName("field")
            val payload = variant.type.nonNull()
            if (payload.shape is UnitShape) {
                line(indent + 2, "$target = kotlin.Unit")
            } else {
                val decoded = emitDecode(payload, indent + 2)
                line(indent + 2, "$target = $decoded")
            }
            line(indent + 1, "}")
        }
        line(
            indent + 1,
            "else -> throw $PROTOCOL_ERROR(\"unknown oneof discriminator for ${model.simpleName}: $$code\")",
        )
        line(indent, "}")
    }

    private fun emitDecode(type: PType, indent: Int): String = when (val shape = type.shape) {
        is ScalarShape -> decodeScalar(shape)
        is PackedArrayShape -> emitDecodePackedArray(shape, indent)
        is EnumShape -> enumValueFromCode(shape, "reader.readEnumCode()", indent)
        is MessageShape -> {
            val value = nextName("field")
            line(indent, "val $value = ${shape.codecQName}.decode(reader)")
            value
        }
        is ListShape -> emitDecodeList(shape, indent)
        is ArrayShape -> emitDecodeArray(shape, indent)
        is SetShape -> emitDecodeSet(shape, indent)
        is MapShape -> emitDecodeMap(shape, indent)
        UnitShape -> "kotlin.Unit"
    }

    private fun decodeScalar(shape: ScalarShape): String = when (shape.scalar) {
        Scalar.BOOL -> "reader.readBoolean()"
        Scalar.INT32 -> when (shape.kotlin) {
            KotlinScalar.BYTE -> "$PROTO_NUMBERS.toByte(reader.readInt32())"
            KotlinScalar.SHORT -> "$PROTO_NUMBERS.toShort(reader.readInt32())"
            KotlinScalar.INT -> "reader.readInt32()"
            KotlinScalar.LONG -> "reader.readInt32().toLong()"
            else -> unsupported(shape)
        }
        Scalar.INT64 -> "reader.readInt64()"
        Scalar.UINT32 -> when (shape.kotlin) {
            KotlinScalar.UBYTE -> "$PROTO_NUMBERS.toUByte(reader.readUInt32())"
            KotlinScalar.USHORT -> "$PROTO_NUMBERS.toUShort(reader.readUInt32())"
            KotlinScalar.INT -> "reader.readUInt32()"
            KotlinScalar.UINT -> "reader.readUInt32().toUInt()"
            KotlinScalar.LONG -> "$PROTO_NUMBERS.uint32ToLong(reader.readUInt32())"
            KotlinScalar.ULONG -> "reader.readUInt32().toUInt().toULong()"
            else -> unsupported(shape)
        }
        Scalar.UINT64 -> when (shape.kotlin) {
            KotlinScalar.LONG -> "reader.readUInt64()"
            KotlinScalar.ULONG -> "reader.readUInt64().toULong()"
            else -> unsupported(shape)
        }
        Scalar.FIXED32 -> when (shape.kotlin) {
            KotlinScalar.INT -> "reader.readFixed32()"
            KotlinScalar.UINT -> "reader.readFixed32().toUInt()"
            KotlinScalar.LONG -> "$PROTO_NUMBERS.uint32ToLong(reader.readFixed32())"
            KotlinScalar.ULONG -> "reader.readFixed32().toUInt().toULong()"
            else -> unsupported(shape)
        }
        Scalar.FIXED64 -> when (shape.kotlin) {
            KotlinScalar.LONG -> "reader.readFixed64()"
            KotlinScalar.ULONG -> "reader.readFixed64().toULong()"
            else -> unsupported(shape)
        }
        Scalar.FLOAT32 -> when (shape.kotlin) {
            KotlinScalar.FLOAT -> "reader.readFloat32()"
            KotlinScalar.DOUBLE -> "reader.readFloat32().toDouble()"
            else -> unsupported(shape)
        }
        Scalar.FLOAT64 -> "reader.readFloat64()"
        Scalar.STRING -> "reader.readString()"
        Scalar.BYTES -> "reader.readBytes()"
        Scalar.DATE -> when (shape.kotlin) {
            KotlinScalar.INSTANT -> "kotlinx.datetime.Instant.fromEpochMilliseconds(reader.readInt64())"
            KotlinScalar.LONG -> "reader.readInt64()"
            else -> unsupported(shape)
        }
    }

    private fun emitDecodePackedArray(shape: PackedArrayShape, indent: Int): String {
        val length = nextName("length")
        val count = nextName("count")
        val array = nextName("array")
        val index = nextName("index")
        line(indent, "val $length = reader.readLength()")
        line(
            indent,
            "if ($length % ${shape.elementSize} != 0) throw $PROTOCOL_ERROR(\"packed array length is not a multiple of ${shape.elementSize}\")",
        )
        line(indent, "val $count = $length / ${shape.elementSize}")
        line(indent, "val $array = ${packedArrayType(shape)}($count)")
        line(indent, "for ($index in 0 until $count) {")
        when (shape.element) {
            KotlinScalar.SHORT -> line(
                indent + 1,
                "$array[$index] = (reader.readRawByte() or (reader.readRawByte() shl 8)).toShort()",
            )
            KotlinScalar.INT -> line(indent + 1, "$array[$index] = reader.readFixed32()")
            KotlinScalar.LONG -> line(indent + 1, "$array[$index] = reader.readFixed64()")
            KotlinScalar.FLOAT -> line(indent + 1, "$array[$index] = reader.readFloat32()")
            KotlinScalar.DOUBLE -> line(indent + 1, "$array[$index] = reader.readFloat64()")
            else -> unsupported(shape)
        }
        line(indent, "}")
        return array
    }

    private fun emitDecodeList(shape: ListShape, indent: Int): String {
        val count = nextName("count")
        val list = nextName("list")
        val index = nextName("index")
        val element = shape.element
        line(indent, "val $count = reader.readCount(${minSize(element)})")
        val bitmap = if (element.nullable) nextName("bitmap") else null
        if (bitmap != null) {
            line(indent, "val $bitmap = reader.readBitmapOffset($count)")
        }
        line(
            indent,
            "val $list = kotlin.collections.ArrayList<${kotlinType(element)}>(if ($count < 4096) $count else 4096)",
        )
        line(indent, "for ($index in 0 until $count) {")
        if (element.nullable && bitmap != null) {
            line(indent + 1, "if (reader.isSet($bitmap, $index)) {")
            val decoded = emitDecode(element.nonNull(), indent + 2)
            line(indent + 2, "$list.add($decoded)")
            line(indent + 1, "} else {")
            line(indent + 2, "$list.add(null)")
            line(indent + 1, "}")
        } else {
            val decoded = emitDecode(element, indent + 1)
            line(indent + 1, "$list.add($decoded)")
        }
        line(indent, "}")
        return list
    }

    private fun emitDecodeArray(shape: ArrayShape, indent: Int): String {
        val count = nextName("count")
        val array = nextName("array")
        val index = nextName("index")
        val element = shape.element
        line(indent, "val $count = reader.readCount(${minSize(element)})")
        val bitmap = if (element.nullable) nextName("bitmap") else null
        if (bitmap != null) {
            line(indent, "val $bitmap = reader.readBitmapOffset($count)")
        }
        line(indent, "val $array = kotlin.arrayOfNulls<${kotlinType(element.nonNull())}>($count)")
        line(indent, "for ($index in 0 until $count) {")
        if (element.nullable && bitmap != null) {
            line(indent + 1, "if (reader.isSet($bitmap, $index)) {")
            val decoded = emitDecode(element.nonNull(), indent + 2)
            line(indent + 2, "$array[$index] = $decoded")
            line(indent + 1, "}")
        } else {
            val decoded = emitDecode(element, indent + 1)
            line(indent + 1, "$array[$index] = $decoded")
        }
        line(indent, "}")
        val typed = nextName("typedArray")
        line(indent, "val $typed = $array as ${kotlinType(shape.asType())}")
        return typed
    }

    private fun emitDecodeSet(shape: SetShape, indent: Int): String {
        val count = nextName("count")
        val set = nextName("set")
        val index = nextName("index")
        val element = shape.element
        line(indent, "val $count = reader.readCount(${minSize(element)})")
        line(indent, "val $set = kotlin.collections.LinkedHashSet<${kotlinType(element)}>()")
        line(indent, "for ($index in 0 until $count) {")
        val decoded = emitDecode(element, indent + 1)
        line(indent + 1, "$set.add($decoded)")
        line(indent, "}")
        return set
    }

    private fun emitDecodeMap(shape: MapShape, indent: Int): String {
        val count = nextName("count")
        val map = nextName("map")
        val index = nextName("index")
        val key = shape.key
        val value = shape.value
        line(indent, "val $count = reader.readCount(${minSize(key)})")
        val bitmap = if (value.nullable) nextName("bitmap") else null
        if (bitmap != null) {
            line(indent, "val $bitmap = reader.readBitmapOffset($count)")
        }
        line(
            indent,
            "val $map = kotlin.collections.LinkedHashMap<${kotlinType(key)}, ${kotlinType(value)}>(if ($count < 4096) $count else 4096)",
        )
        line(indent, "for ($index in 0 until $count) {")
        val keyValue = nextName("mapKey")
        val decodedKey = emitDecode(key, indent + 1)
        line(indent + 1, "val $keyValue = $decodedKey")
        if (value.nullable && bitmap != null) {
            line(indent + 1, "if (reader.isSet($bitmap, $index)) {")
            val decoded = emitDecode(value.nonNull(), indent + 2)
            line(indent + 2, "$map[$keyValue] = $decoded")
            line(indent + 1, "} else {")
            line(indent + 2, "$map[$keyValue] = null")
            line(indent + 1, "}")
        } else {
            val decoded = emitDecode(value, indent + 1)
            line(indent + 1, "$map[$keyValue] = $decoded")
        }
        line(indent, "}")
        return map
    }

    private fun enumValueFromCode(shape: EnumShape, codeExpression: String, indent: Int): String {
        val code = nextName("enumCode")
        val value = nextName("enumValue")
        line(indent, "val $code = $codeExpression")
        if (shape.explicitValues) {
            line(
                indent,
                "val $value = ${shape.qname}.entries.firstOrNull { it.protocolValue == $code }",
            )
            line(
                indent,
                "    ?: throw $PROTOCOL_ERROR(\"unknown enum value for ${shape.simpleName}: $$code\")",
            )
        } else {
            line(indent, "val $value = ${shape.qname}.entries.getOrNull($code)")
            line(
                indent,
                "    ?: throw $PROTOCOL_ERROR(\"unknown enum value for ${shape.simpleName}: $$code\")",
            )
        }
        return value
    }

    private fun comparator(type: PType, left: String, right: String): String {
        return when (val shape = type.shape) {
            is ScalarShape -> when (shape.kotlin) {
                KotlinScalar.STRING -> "$PROTO_SORT.compareUtf8($left, $right)"
                KotlinScalar.BOOLEAN,
                KotlinScalar.BYTE,
                KotlinScalar.SHORT,
                KotlinScalar.INT,
                KotlinScalar.LONG,
                KotlinScalar.UBYTE,
                KotlinScalar.USHORT,
                KotlinScalar.UINT,
                KotlinScalar.ULONG,
                -> "$left.compareTo($right)"
                else -> throw UnsupportedOperationException("type has no canonical order: $type")
            }
            is EnumShape -> if (shape.explicitValues) {
                "$left.protocolValue.compareTo($right.protocolValue)"
            } else {
                "$left.ordinal.compareTo($right.ordinal)"
            }
            else -> throw UnsupportedOperationException("type has no canonical order: $type")
        }
    }

    private fun enumCode(shape: EnumShape, expression: String): String =
        if (shape.explicitValues) "$expression.protocolValue" else "$expression.ordinal"

    private fun kotlinType(type: PType): String {
        val base = when (val shape = type.shape) {
            is ScalarShape -> when (shape.kotlin) {
                KotlinScalar.BOOLEAN -> "kotlin.Boolean"
                KotlinScalar.BYTE -> "kotlin.Byte"
                KotlinScalar.SHORT -> "kotlin.Short"
                KotlinScalar.INT -> "kotlin.Int"
                KotlinScalar.LONG -> "kotlin.Long"
                KotlinScalar.UBYTE -> "kotlin.UByte"
                KotlinScalar.USHORT -> "kotlin.UShort"
                KotlinScalar.UINT -> "kotlin.UInt"
                KotlinScalar.ULONG -> "kotlin.ULong"
                KotlinScalar.FLOAT -> "kotlin.Float"
                KotlinScalar.DOUBLE -> "kotlin.Double"
                KotlinScalar.STRING -> "kotlin.String"
                KotlinScalar.BYTE_ARRAY -> "kotlin.ByteArray"
                KotlinScalar.INSTANT -> "kotlinx.datetime.Instant"
            }
            is PackedArrayShape -> packedArrayType(shape)
            is EnumShape -> shape.qname
            is MessageShape -> shape.qname
            is ListShape -> "kotlin.collections.List<${kotlinType(shape.element)}>"
            is ArrayShape -> "kotlin.Array<${kotlinType(shape.element)}>"
            is SetShape -> "kotlin.collections.Set<${kotlinType(shape.element)}>"
            is MapShape -> "kotlin.collections.Map<${kotlinType(shape.key)}, ${kotlinType(shape.value)}>"
            UnitShape -> "kotlin.Unit"
        }
        return if (type.nullable) "$base?" else base
    }

    private fun packedArrayType(shape: PackedArrayShape): String = when (shape.element) {
        KotlinScalar.SHORT -> "kotlin.ShortArray"
        KotlinScalar.INT -> "kotlin.IntArray"
        KotlinScalar.LONG -> "kotlin.LongArray"
        KotlinScalar.FLOAT -> "kotlin.FloatArray"
        KotlinScalar.DOUBLE -> "kotlin.DoubleArray"
        else -> throw UnsupportedOperationException("unsupported packed array: $shape")
    }

    private fun ArrayShape.asType(): PType = PType(this, nullable = false)

    private fun unsupported(shape: Any): Nothing =
        throw UnsupportedOperationException("unsupported wire shape: $shape")

    private fun minSize(type: PType): Int {
        if (type.nullable) return 0
        return when (val shape = type.shape) {
            is ScalarShape -> when (shape.scalar) {
                Scalar.BOOL, Scalar.STRING, Scalar.BYTES, Scalar.DATE -> 1
                Scalar.INT32, Scalar.INT64, Scalar.UINT32, Scalar.UINT64 -> 1
                Scalar.FIXED32, Scalar.FLOAT32 -> 4
                Scalar.FIXED64, Scalar.FLOAT64 -> 8
            }
            is PackedArrayShape, is EnumShape, is ListShape, is ArrayShape, is SetShape, is MapShape -> 1
            is MessageShape -> 0
            UnitShape -> 0
        }
    }

    private fun nextName(prefix: String): String {
        counter += 1
        return "$prefix$counter"
    }

    private fun line(indent: Int, text: String) {
        repeat(indent) { output.append("    ") }
        output.append(text).append('\n')
    }

    private companion object {
        const val PROTOCOL_PACKAGE = "dev.ivlev.silent.protocol"
        const val PROTO_CODEC = "$PROTOCOL_PACKAGE.ProtoCodec"
        const val PROTOCOL_OPTIONS = "$PROTOCOL_PACKAGE.ProtocolOptions"
        const val PROTOCOL_ERROR = "$PROTOCOL_PACKAGE.ProtocolError"
        const val PROTO_WRITER = "$PROTOCOL_PACKAGE.ProtoWriter"
        const val PROTO_READER = "$PROTOCOL_PACKAGE.ProtoReader"
        const val PROTO_NUMBERS = "$PROTOCOL_PACKAGE.ProtoNumbers"
        const val PROTO_SORT = "$PROTOCOL_PACKAGE.ProtoSort"
    }
}
