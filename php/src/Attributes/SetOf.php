<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Attributes;

/** Множество с типом элемента (кодируется в каноническом порядке). */
#[\Attribute(\Attribute::TARGET_PROPERTY)]
final class SetOf
{
    public function __construct(public readonly string $type)
    {
    }
}
