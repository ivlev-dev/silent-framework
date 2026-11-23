<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Internal;

use Ivlev\Silent\Protocol\Errors\ProtocolException;

/** Контекст декодирования: контроль глубины вложенности. */
final class DecodeContext
{
    private int $depth = -1;

    public function __construct(public readonly int $maxDepth)
    {
    }

    public function enter(string $path): void
    {
        if ($this->depth >= $this->maxDepth) {
            throw ProtocolException::depth('превышен лимит глубины ' . $this->maxDepth, $path);
        }
        $this->depth += 1;
    }

    public function leave(): void
    {
        $this->depth -= 1;
    }
}
