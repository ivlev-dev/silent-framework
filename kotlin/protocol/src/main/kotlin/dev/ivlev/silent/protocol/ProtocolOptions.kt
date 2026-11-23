package dev.ivlev.silent.protocol

public data class ProtocolOptions(
    public val maxSize: Int = DEFAULT_MAX_SIZE,
    public val maxDepth: Int = DEFAULT_MAX_DEPTH,
    public val maxCollectionSize: Int = DEFAULT_MAX_COLLECTION_SIZE,
) {
    init {
        require(maxSize > 0) { "maxSize must be positive" }
        require(maxDepth > 0) { "maxDepth must be positive" }
        require(maxCollectionSize > 0) { "maxCollectionSize must be positive" }
    }

    public companion object {
        public const val DEFAULT_MAX_SIZE: Int = 64 * 1024 * 1024
        public const val DEFAULT_MAX_DEPTH: Int = 256
        public const val DEFAULT_MAX_COLLECTION_SIZE: Int = 1_048_576

        public val Default: ProtocolOptions = ProtocolOptions()
    }
}
