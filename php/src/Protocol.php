<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol;

/**
 * Публичная точка входа Silent Protocol для PHP.
 *
 * ```php
 * $bytes = Protocol::encode($user);
 * $user = Protocol::decode(User::class, $bytes);
 * ```
 */
final class Protocol
{
    public const VERSION = '0.14.0';

    public const DEFAULT_MAX_SIZE = Options::DEFAULT_MAX_SIZE;

    public const DEFAULT_MAX_DEPTH = Options::DEFAULT_MAX_DEPTH;

    public static function encode(object $value, ?Options $options = null): string
    {
        return Codec::encode($value, $options ?? new Options());
    }

    public static function decode(string $class, string $bytes, ?Options $options = null): object
    {
        return Codec::decode($class, $bytes, $options ?? new Options());
    }

    /** Нормализованная схема класса (кешируется). */
    public static function schema(string $class): Schema
    {
        return SchemaBuilder::build($class);
    }
}
