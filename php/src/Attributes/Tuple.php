<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Attributes;

/**
 * Кортеж фиксированной длины. Каждый элемент — тип; `?<тип>` помечает
 * optional-слот (bitmap в начале кортежа).
 */
#[\Attribute(\Attribute::TARGET_PROPERTY)]
final class Tuple
{
    /** @var list<string> */
    public readonly array $types;

    public function __construct(string ...$types)
    {
        $this->types = array_values($types);
    }
}
