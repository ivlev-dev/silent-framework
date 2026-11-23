<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol;

/**
 * Настройки кодирования/декодирования.
 *
 * Лимиты совпадают с TS/Rust/Kotlin: 64 MiB и глубина 256.
 */
final class Options
{
    public const DEFAULT_MAX_SIZE = 64 * 1024 * 1024;

    public const DEFAULT_MAX_DEPTH = 256;

    public function __construct(
        public readonly int $maxSize = self::DEFAULT_MAX_SIZE,
        public readonly int $maxDepth = self::DEFAULT_MAX_DEPTH,
        public readonly bool $allowTrailing = false,
    ) {
        if ($maxSize <= 0) {
            throw new \InvalidArgumentException('maxSize должен быть положительным');
        }
        if ($maxDepth < 0) {
            throw new \InvalidArgumentException('maxDepth не может быть отрицательным');
        }
    }
}
