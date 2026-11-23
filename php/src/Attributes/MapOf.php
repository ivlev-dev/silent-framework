<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Attributes;

/**
 * Map с типами ключа и значения. Значение может быть `?<тип>`.
 */
#[\Attribute(\Attribute::TARGET_PROPERTY)]
final class MapOf
{
    public function __construct(
        public readonly string $key,
        public readonly string $value,
    ) {
    }
}
