<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Attributes;

/**
 * Вариант oneof. Дискриминатор — не-nullable свойство с int-backed enum,
 * содержащим переданный case.
 */
#[\Attribute(\Attribute::TARGET_PROPERTY)]
final class OneOf
{
    public function __construct(public readonly \BackedEnum $case)
    {
    }
}
