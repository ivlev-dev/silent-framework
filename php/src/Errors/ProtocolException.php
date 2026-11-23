<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Errors;

/**
 * Единая ошибка протокола.
 *
 * `$errorCode` — стабильный машинный код (`schema`, `value`, `range`,
 * `truncated`, `invalid_varint`, `utf8`, `bool`, `unknown_enum`, `oneof`,
 * `cycle`, `depth`, `size`, `trailing`), `$path` — путь поля внутри
 * сообщения (например, `User.address.zip`).
 */
final class ProtocolException extends \RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly string $path = '',
    ) {
        parent::__construct($path === '' ? $message : $message . ' (' . $path . ')');
    }

    public static function schema(string $message, string $path = ''): self
    {
        return new self('schema', $message, $path);
    }

    public static function value(string $message, string $path = ''): self
    {
        return new self('value', $message, $path);
    }

    public static function range(string $message, string $path = ''): self
    {
        return new self('range', $message, $path);
    }

    public static function truncated(string $message, string $path = ''): self
    {
        return new self('truncated', $message, $path);
    }

    public static function invalidVarint(string $message, string $path = ''): self
    {
        return new self('invalid_varint', $message, $path);
    }

    public static function utf8(string $message, string $path = ''): self
    {
        return new self('utf8', $message, $path);
    }

    public static function invalidBool(string $message, string $path = ''): self
    {
        return new self('bool', $message, $path);
    }

    public static function unknownEnum(string $message, string $path = ''): self
    {
        return new self('unknown_enum', $message, $path);
    }

    public static function oneof(string $message, string $path = ''): self
    {
        return new self('oneof', $message, $path);
    }

    public static function cycle(string $message, string $path = ''): self
    {
        return new self('cycle', $message, $path);
    }

    public static function depth(string $message, string $path = ''): self
    {
        return new self('depth', $message, $path);
    }

    public static function size(string $message, string $path = ''): self
    {
        return new self('size', $message, $path);
    }

    public static function trailing(string $message, string $path = ''): self
    {
        return new self('trailing', $message, $path);
    }
}
