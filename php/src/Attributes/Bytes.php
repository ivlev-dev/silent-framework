<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Attributes;

/** Wire-тип bytes: сырые байты вместо UTF-8 строки. */
#[\Attribute(\Attribute::TARGET_PROPERTY)]
final class Bytes
{
}
