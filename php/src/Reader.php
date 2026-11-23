<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol;

use Ivlev\Silent\Protocol\Errors\ProtocolException;
use Ivlev\Silent\Protocol\Internal\Utf8;

/**
 * Буфер декодирования Silent Protocol.
 *
 * Проверяет обрезку буфера, переполнение varint и лимиты размера.
 */
final class Reader
{
    private int $offset = 0;

    private readonly int $length;

    public function __construct(
        private readonly string $bytes,
        private readonly int $maxSize,
    ) {
        $this->length = strlen($bytes);
        if ($this->length > $maxSize) {
            throw ProtocolException::size('сообщение превышает лимит ' . $maxSize . ' байт');
        }
    }

    public function offset(): int
    {
        return $this->offset;
    }

    public function remaining(): int
    {
        return $this->length - $this->offset;
    }

    public function byte(string $path = ''): int
    {
        $this->require(1, $path);
        return ord($this->bytes[$this->offset++]);
    }

    public function bool(string $path = ''): bool
    {
        $value = $this->byte($path);
        if ($value > 1) {
            throw ProtocolException::invalidBool('bool должен быть 0 или 1, получено ' . $value, $path);
        }
        return $value === 1;
    }

    /**
     * Читает беззнаковый varint как 64-битный шаблон PHP int.
     *
     * Значения ≥ 2^63 возвращаются как отрицательный int (старший бит).
     */
    public function varint(string $path = ''): int
    {
        $result = 0;
        $shift = 0;

        for ($index = 0; $index < 10; $index += 1) {
            $this->require(1, $path);
            $byte = ord($this->bytes[$this->offset]);
            $this->offset += 1;

            if ($index === 9 && $byte > 1) {
                throw ProtocolException::invalidVarint('varint выходит за 64 бита', $path);
            }

            $result |= ($byte & 0x7F) << $shift;
            if (($byte & 0x80) === 0) {
                return $result;
            }
            $shift += 7;
        }

        throw ProtocolException::invalidVarint('слишком длинный varint', $path);
    }

    /** Читает uint32; больше 2^32-1 — ошибка диапазона. */
    public function uint32(string $path = ''): int
    {
        $value = $this->varint($path);
        if ($value < 0 || $value > 0xFFFFFFFF) {
            throw ProtocolException::range('varint вне допустимого диапазона uint32', $path);
        }
        return $value;
    }

    /** Читает uint64; значения > PHP_INT_MAX не представимы и отвергаются. */
    public function uint64(string $path = ''): int
    {
        $value = $this->varint($path);
        if ($value < 0) {
            throw ProtocolException::range('uint64 вне диапазона PHP int', $path);
        }
        return $value;
    }

    public function zigzag32(string $path = ''): int
    {
        $value = $this->uint32($path);
        return ($value >> 1) ^ -($value & 1);
    }

    public function zigzag64(string $path = ''): int
    {
        $value = $this->varint($path);
        return (($value >> 1) & PHP_INT_MAX) ^ -($value & 1);
    }

    public function fixed32(string $path = ''): int
    {
        $this->require(4, $path);
        /** @var array{1: int} $unpacked */
        $unpacked = unpack('V', substr($this->bytes, $this->offset, 4));
        $this->offset += 4;
        return $unpacked[1];
    }

    public function fixed64(string $path = ''): int
    {
        $this->require(8, $path);
        /** @var array{1: int} $unpacked */
        $unpacked = unpack('P', substr($this->bytes, $this->offset, 8));
        $this->offset += 8;
        $value = $unpacked[1];
        if ($value < 0) {
            throw ProtocolException::range('fixed64 вне диапазона PHP int', $path);
        }
        return $value;
    }

    public function float32(string $path = ''): float
    {
        $this->require(4, $path);
        /** @var array{1: float} $unpacked */
        $unpacked = unpack('g', substr($this->bytes, $this->offset, 4));
        $this->offset += 4;
        return $unpacked[1];
    }

    public function float64(string $path = ''): float
    {
        $this->require(8, $path);
        /** @var array{1: float} $unpacked */
        $unpacked = unpack('e', substr($this->bytes, $this->offset, 8));
        $this->offset += 8;
        return $unpacked[1];
    }

    public function readLength(string $path = ''): int
    {
        $value = $this->varint($path);
        if ($value < 0 || $value > $this->maxSize) {
            throw ProtocolException::size('длина превышает лимит ' . $this->maxSize, $path);
        }
        return $value;
    }

    public function bytes(string $path = ''): string
    {
        $length = $this->readLength($path);
        $this->require($length, $path);
        $value = substr($this->bytes, $this->offset, $length);
        $this->offset += $length;
        return $value;
    }

    public function string(string $path = ''): string
    {
        $value = $this->bytes($path);
        if (!Utf8::isValid($value)) {
            throw ProtocolException::utf8('строка не является корректным UTF-8', $path);
        }
        return $value;
    }

    /**
     * Читает bitmap для $count optional-элементов.
     *
     * @return list<bool>
     */
    public function bitmap(int $count, string $path = ''): array
    {
        $length = intdiv($count + 7, 8);
        $this->require($length, $path);
        $bits = [];
        for ($index = 0; $index < $count; $index += 1) {
            $byte = ord($this->bytes[$this->offset + ($index >> 3)]);
            $bits[] = ($byte & (1 << ($index & 7))) !== 0;
        }
        $this->offset += $length;
        return $bits;
    }

    /** Bitmap из маски (до 32 бит). */
    public function bitmapMask(int $count, string $path = ''): int
    {
        if ($count < 0 || $count > 32) {
            throw ProtocolException::value('bitmapMask поддерживает от 0 до 32 бит', $path);
        }
        $length = intdiv($count + 7, 8);
        if ($length === 0) {
            return 0;
        }
        $this->require($length, $path);
        $mask = 0;
        for ($index = 0; $index < $length; $index += 1) {
            $mask |= ord($this->bytes[$this->offset + $index]) << ($index * 8);
        }
        $this->offset += $length;
        return $mask;
    }

    private function require(int $count, string $path): void
    {
        $available = $this->length - $this->offset;
        if ($count > $available) {
            throw ProtocolException::truncated(
                'ожидалось ' . $count . ' байт, доступно ' . $available,
                $path,
            );
        }
    }
}
