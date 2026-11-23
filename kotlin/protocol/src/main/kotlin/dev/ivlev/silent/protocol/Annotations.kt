package dev.ivlev.silent.protocol

@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.BINARY)
public annotation class Proto

@Target(AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.BINARY)
public annotation class OneOf(val value: Int)

@Target(AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.BINARY)
public annotation class Int32

@Target(AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.BINARY)
public annotation class Uint32

@Target(AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.BINARY)
public annotation class Float32

@Target(AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.BINARY)
public annotation class Fixed32

@Target(AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.BINARY)
public annotation class Fixed64

@Target(AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.BINARY)
public annotation class Uint64

@Target(AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.BINARY)
public annotation class EpochMillis

public interface ProtocolEnum {
    public val protocolValue: Int
}

public interface ProtoCodec<T> {
    public fun encode(value: T): ByteArray

    public fun decode(bytes: ByteArray): T

    public fun schemaFingerprint(): String
}
