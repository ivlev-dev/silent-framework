<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Internal;

/** Проверка корректности UTF-8 без зависимости от mbstring. */
final class Utf8
{
    public static function isValid(string $value): bool
    {
        // Быстрый путь для ASCII: подавляющее большинство коротких значений.
        if (!preg_match('/[\x80-\xFF]/', $value)) {
            return true;
        }
        return preg_match('//u', $value) === 1;
    }
}
