<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol;

use Ivlev\Silent\Protocol\Errors\ProtocolException;
use Ivlev\Silent\Protocol\Internal\Utf8;

/**
 * Буфер кодирования Silent Protocol.
 *
 * Все целые пишутся в little-endian/LEB128, строки и bytes — с varint-длиной.
 * Лимит размера проверяется на каждой записи.
 */
final class Writer
{
    private const MAX_UNSIGNED_SHIFT_MASK = 0x01FFFFFFFFFFFFFF;

    private string $buffer = '';

    private int $length = 0;

    public function __construct(private readonly int $maxSize)
    {
    }

    public function size(): int
    {
        return $this->length;
    }

    public function raw(string $bytes): void
    {
        $length = strlen($bytes);
        $this->ensure($length);
        $this->buffer .= $bytes;
        $this->length += $length;
    }

    public function byte(int $value): void
    {
        $this->ensure(1);
        $this->buffer .= chr($value & 0xFF);
        $this->length += 1;
    }

    public function bool(bool $value): void
    {
        $this->byte($value ? 1 : 0);
    }

    /** Беззнаковый varint для неотрицательного PHP int. */
    public function varint(int $value): void
    {
        if ($value < 0) {
            throw ProtocolException::range('varint требует неотрицательное целое');
        }
        $this->varintUnsigned($value);
    }

    /**
     * Беззнаковый varint по 64-битному шаблону.
     *
     * Отрицательный PHP int трактуется как старшие 64 бита (two's complement):
     * так кодируются zigzag-значения int64 и uint64 > PHP_INT_MAX.
     */
    public function varintUnsigned(int $value): void
    {
        $out = '';
        while (true) {
            $byte = $value & 0x7F;
            $value = ($value >> 7) & self::MAX_UNSIGNED_SHIFT_MASK;
            if ($value === 0) {
                $this->raw($out . chr($byte));
                return;
            }
            $out .= chr($byte | 0x80);
        }
    }

    /** Zigzag varint для int64 (весь диапазон PHP int). */
    public function zigzag(int $value): void
    {
        $this->varintUnsigned(($value << 1) ^ ($value >> 63));
    }

    /** Zigzag varint для int32. */
    public function zigzag32(int $value): void
    {
        $this->varint((($value << 1) ^ ($value >> 31)) & 0xFFFFFFFF);
    }

    public function fixed32(int $value): void
    {
        $this->raw(pack('V', $value & 0xFFFFFFFF));
    }

    public function fixed64(int $value): void
    {
        if ($value < 0) {
            throw ProtocolException::range('fixed64 требует неотрицательное целое');
        }
        $this->raw(pack('P', $value));
    }

    public function float32(float $value): void
    {
        $this->raw(pack('g', $value));
    }

    public function float64(float $value): void
    {
        $this->raw(pack('e', $value));
    }

    public function writeLength(int $length): void
    {
        if ($length > $this->maxSize) {
            throw ProtocolException::size('длина ' . $length . ' превышает лимит ' . $this->maxSize);
        }
        $this->varint($length);
    }

    public function bytes(string $value): void
    {
        $this->writeLength(strlen($value));
        $this->raw($value);
    }

    public function string(string $value): void
    {
        if (!Utf8::isValid($value)) {
            throw ProtocolException::utf8('строка не является корректным UTF-8');
        }
        $this->writeLength(strlen($value));
        $this->raw($value);
    }

    /**
     * Bitmap: бит i (LSB-first) соответствует i-му optional-элементу.
     *
     * @param list<bool> $bits
     */
    public function bitmap(array $bits): void
    {
        $count = count($bits);
        $length = intdiv($count + 7, 8);
        if ($length === 0) {
            return;
        }
        $bytes = array_fill(0, $length, 0);
        foreach ($bits as $index => $present) {
            if ($present) {
                $bytes[$index >> 3] |= 1 << ($index & 7);
            }
        }
        $this->raw(pack('C*', ...$bytes));
    }

    /** Bitmap из маски (до 32 бит). */
    public function bitmapMask(int $mask, int $count): void
    {
        if ($count < 0 || $count > 32) {
            throw ProtocolException::value('bitmapMask поддерживает от 0 до 32 бит');
        }
        $length = intdiv($count + 7, 8);
        if ($length === 0) {
            return;
        }
        $bytes = '';
        for ($index = 0; $index < $length; $index += 1) {
            $bytes .= chr(($mask >> ($index * 8)) & 0xFF);
        }
        $this->raw($bytes);
    }

    public function finish(): string
    {
        return $this->buffer;
    }

    private function ensure(int $extra): void
    {
        $needed = $this->length + $extra;
        if ($needed > $this->maxSize) {
            throw ProtocolException::size('сообщение превышает лимит ' . $this->maxSize . ' байт');
        }
    }
}
