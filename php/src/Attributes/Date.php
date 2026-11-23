<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Attributes;

/** Wire-тип date: epoch milliseconds (zigzag varint). */
#[\Attribute(\Attribute::TARGET_PROPERTY)]
final class Date
{
}
