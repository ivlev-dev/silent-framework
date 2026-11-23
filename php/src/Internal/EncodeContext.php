<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Internal;

use Ivlev\Silent\Protocol\Errors\ProtocolException;

/**
 * Контекст кодирования: глубина вложенности, лимит размера и обнаружение
 * циклов по идентичности объектов.
 */
final class EncodeContext
{
    private int $depth = -1;

    /** @var \SplObjectStorage<object, null> */
    private \SplObjectStorage $ancestors;

    public function __construct(
        public readonly int $maxDepth,
        public readonly int $maxSize,
    ) {
        /** @var \SplObjectStorage<object, null> $storage */
        $storage = new \SplObjectStorage();
        $this->ancestors = $storage;
    }

    public function enterObject(object $value, string $path): void
    {
        if ($this->ancestors->contains($value)) {
            throw ProtocolException::cycle('обнаружен цикл объектов', $path);
        }
        $this->checkDepth($path);
        $this->depth += 1;
        $this->ancestors->attach($value);
    }

    public function leaveObject(object $value): void
    {
        $this->ancestors->detach($value);
        $this->depth -= 1;
    }

    public function enterValue(string $path): void
    {
        $this->checkDepth($path);
        $this->depth += 1;
    }

    public function leaveValue(): void
    {
        $this->depth -= 1;
    }

    private function checkDepth(string $path): void
    {
        if ($this->depth >= $this->maxDepth) {
            throw ProtocolException::depth('превышен лимит глубины ' . $this->maxDepth, $path);
        }
    }
}
