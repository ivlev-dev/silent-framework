<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Attributes;

/** Record (map со строковыми ключами) с типом значения. */
#[\Attribute(\Attribute::TARGET_PROPERTY)]
final class RecordOf
{
    public function __construct(public readonly string $value)
    {
    }
}
