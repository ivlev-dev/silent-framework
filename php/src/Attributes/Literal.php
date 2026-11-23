<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Attributes;

/** Литерал: 0 байт на wire, значение проверяется при кодировании. */
#[\Attribute(\Attribute::TARGET_PROPERTY)]
final class Literal
{
    public function __construct(public readonly mixed $value)
    {
    }
}
