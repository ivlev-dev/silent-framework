<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Attributes;

/**
 * Массив с типом элемента. Тип — wire-имя (`int32`, `string`, ...),
 * FQCN класса/enum, или `?<тип>` для optional-элемента.
 */
#[\Attribute(\Attribute::TARGET_PROPERTY)]
final class ArrayOf
{
    public function __construct(public readonly string $type)
    {
    }
}
