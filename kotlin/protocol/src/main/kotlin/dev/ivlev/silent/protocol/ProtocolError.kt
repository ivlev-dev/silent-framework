package dev.ivlev.silent.protocol

public class ProtocolError(message: String, cause: Throwable? = null) : RuntimeException(message, cause)
