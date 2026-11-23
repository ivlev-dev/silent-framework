<?php

declare(strict_types=1);

use Ivlev\Silent\Protocol\Attributes\BigInt;
use Ivlev\Silent\Protocol\Attributes\Bytes;
use Ivlev\Silent\Protocol\Attributes\Date;
use Ivlev\Silent\Protocol\Attributes\Fixed32;
use Ivlev\Silent\Protocol\Attributes\Fixed64;
use Ivlev\Silent\Protocol\Attributes\Float32;
use Ivlev\Silent\Protocol\Attributes\Int64;
use Ivlev\Silent\Protocol\Attributes\Literal;
use Ivlev\Silent\Protocol\Attributes\Proto;
use Ivlev\Silent\Protocol\Attributes\Uint32;
use Ivlev\Silent\Protocol\Attributes\Uint64;
use Ivlev\Silent\Protocol\Errors\ProtocolException;
use Ivlev\Silent\Protocol\Protocol;

#[Proto]
final class PrimBool
{
    public bool $value = false;
}

#[Proto]
final class PrimInt32
{
    public int $value = 0;
}

#[Proto]
final class PrimUint32
{
    #[Uint32]
    public int $value = 0;
}

#[Proto]
final class PrimInt64
{
    #[Int64]
    public int $value = 0;
}

#[Proto]
final class PrimBigInt
{
    #[BigInt]
    public int $value = 0;
}

#[Proto]
final class PrimUint64
{
    #[Uint64]
    public int $value = 0;
}

#[Proto]
final class PrimFixed32
{
    #[Fixed32]
    public int $value = 0;
}

#[Proto]
final class PrimFixed64
{
    #[Fixed64]
    public int $value = 0;
}

#[Proto]
final class PrimFloat32
{
    #[Float32]
    public float $value = 0.0;
}

#[Proto]
final class PrimFloat64
{
    public float $value = 0.0;
}

#[Proto]
final class PrimString
{
    public string $value = '';
}

#[Proto]
final class PrimBytes
{
    #[Bytes]
    public string $value = '';
}

#[Proto]
final class PrimDate
{
    public \DateTimeImmutable $value;
}

#[Proto]
final class PrimDateInt
{
    #[Date]
    public int $value = 0;
}

enum PrimKind: int
{
    case A = 1;
    case B = 2;
}

#[Proto]
final class PrimEnum
{
    public PrimKind $kind = PrimKind::A;
}

#[Proto]
final class PrimLiteral
{
    #[Literal(7)]
    public int $version = 7;
}

#[Proto]
final class PrimReadonly
{
    public function __construct(public readonly int $value = 0)
    {
    }
}

#[Proto]
final class PrimReadonlyOptional
{
    public function __construct(public readonly ?string $email = null)
    {
    }
}

#[Proto]
final class PrimLiteralString
{
    #[Literal('v1')]
    public string $version = 'v1';
}

#[Proto]
final class PrimPrivate
{
    public function __construct(
        private int $secret = 0,
        protected string $label = '',
    ) {
    }

    public function secret(): int
    {
        return $this->secret;
    }

    public function label(): string
    {
        return $this->label;
    }
}

#[Proto]
final class PrimOrder
{
    public int $b = 0;

    public int $c = 0;

    public int $a = 0;
}

test('bool: 0/1 и обратно', static function (): void {
    $value = new PrimBool();
    $value->value = true;
    assertSame("\x01", Protocol::encode($value));
    assertSame(true, Protocol::decode(PrimBool::class, "\x01")->value);

    $value->value = false;
    assertSame("\x00", Protocol::encode($value));
    assertSame(false, Protocol::decode(PrimBool::class, "\x00")->value);
});

test('int32: zigzag, min/max', static function (): void {
    $cases = [
        [0, "\x00"],
        [-1, "\x01"],
        [1, "\x02"],
        [150, "\xac\x02"],
        [-64, "\x7f"],
        [-2147483648, "\xff\xff\xff\xff\x0f"],
        [2147483647, "\xfe\xff\xff\xff\x0f"],
    ];
    $value = new PrimInt32();
    foreach ($cases as [$number, $bytes]) {
        $value->value = $number;
        assertSame($bytes, Protocol::encode($value), 'encode ' . $number);
        assertSame($number, Protocol::decode(PrimInt32::class, $bytes)->value, 'decode ' . $number);
    }
});

test('uint32: varint, max', static function (): void {
    $cases = [
        [0, "\x00"],
        [1, "\x01"],
        [300, "\xac\x02"],
        [4294967295, "\xff\xff\xff\xff\x0f"],
    ];
    $value = new PrimUint32();
    foreach ($cases as [$number, $bytes]) {
        $value->value = $number;
        assertSame($bytes, Protocol::encode($value));
        assertSame($number, Protocol::decode(PrimUint32::class, $bytes)->value);
    }
});

test('int64: крайние значения', static function (): void {
    $cases = [
        [0, "\x00"],
        [-1, "\x01"],
        [1, "\x02"],
        [PHP_INT_MIN, "\xff\xff\xff\xff\xff\xff\xff\xff\xff\x01"],
        [PHP_INT_MAX, "\xfe\xff\xff\xff\xff\xff\xff\xff\xff\x01"],
        [1234567890123, "\x96\x93\xd8\x9f\xee\x47"],
    ];
    $value = new PrimInt64();
    foreach ($cases as [$number, $bytes]) {
        $value->value = $number;
        assertSame($bytes, Protocol::encode($value), 'encode ' . $number);
        assertSame($number, Protocol::decode(PrimInt64::class, $bytes)->value, 'decode ' . $number);
    }

    $big = new PrimBigInt();
    $big->value = PHP_INT_MAX;
    assertSame(PHP_INT_MAX, Protocol::decode(PrimBigInt::class, Protocol::encode($big))->value);
});

test('uint64: до PHP_INT_MAX, отрицательные отвергаются', static function (): void {
    $value = new PrimUint64();
    $value->value = PHP_INT_MAX;
    $bytes = Protocol::encode($value);
    assertSame("\xff\xff\xff\xff\xff\xff\xff\xff\x7f", $bytes);
    assertSame(PHP_INT_MAX, Protocol::decode(PrimUint64::class, $bytes)->value);

    $value->value = -1;
    assertThrows(ProtocolException::class, static fn () => Protocol::encode($value), 'вне диапазона');

    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(PrimUint64::class, "\xff\xff\xff\xff\xff\xff\xff\xff\xff\x01"),
        'uint64',
    );
});

test('fixed32/fixed64: little-endian', static function (): void {
    $fixed32 = new PrimFixed32();
    $fixed32->value = 0x01020304;
    assertSame("\x04\x03\x02\x01", Protocol::encode($fixed32));
    assertSame(0x01020304, Protocol::decode(PrimFixed32::class, "\x04\x03\x02\x01")->value);

    $fixed64 = new PrimFixed64();
    $fixed64->value = 0x0102030405060708;
    assertSame("\x08\x07\x06\x05\x04\x03\x02\x01", Protocol::encode($fixed64));
    assertSame(
        0x0102030405060708,
        Protocol::decode(PrimFixed64::class, "\x08\x07\x06\x05\x04\x03\x02\x01")->value,
    );

    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(PrimFixed32::class, "\x01\x02"),
        'доступно',
    );
});

test('float32/float64: IEEE 754 little-endian', static function (): void {
    $float32 = new PrimFloat32();
    $float32->value = 1.0;
    assertSame("\x00\x00\x80\x3f", Protocol::encode($float32));
    assertSame(1.0, Protocol::decode(PrimFloat32::class, "\x00\x00\x80\x3f")->value);

    $float64 = new PrimFloat64();
    $float64->value = 1.0;
    assertSame("\x00\x00\x00\x00\x00\x00\xf0\x3f", Protocol::encode($float64));
    $float64->value = 12.5;
    assertSame("\x00\x00\x00\x00\x00\x00\x29\x40", Protocol::encode($float64));
    assertSame(12.5, Protocol::decode(PrimFloat64::class, "\x00\x00\x00\x00\x00\x00\x29\x40")->value);

    $float64->value = -0.0;
    $restored = Protocol::decode(PrimFloat64::class, Protocol::encode($float64));
    assertSame(1.0, 1.0 / ($restored->value === 0.0 ? 1.0 : $restored->value), 'минус ноль');
});

test('string: UTF-8 с длиной', static function (): void {
    $value = new PrimString();
    assertSame("\x00", Protocol::encode($value));

    $value->value = 'hello';
    assertSame("\x05hello", Protocol::encode($value));
    assertSame('hello', Protocol::decode(PrimString::class, "\x05hello")->value);

    $value->value = '😀';
    assertSame("\x04\xf0\x9f\x98\x80", Protocol::encode($value));
    assertSame('😀', Protocol::decode(PrimString::class, "\x04\xf0\x9f\x98\x80")->value);

    $value->value = "\xff";
    assertThrows(ProtocolException::class, static fn () => Protocol::encode($value), 'UTF-8');
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(PrimString::class, "\x01\xff"),
        'UTF-8',
    );
});

test('bytes: сырые байты без UTF-8 валидации', static function (): void {
    $value = new PrimBytes();
    $value->value = "\x00\xff";
    assertSame("\x02\x00\xff", Protocol::encode($value));
    assertSame("\x00\xff", Protocol::decode(PrimBytes::class, "\x02\x00\xff")->value);
});

test('date: epoch ms и DateTimeImmutable', static function (): void {
    $value = new PrimDate();
    $value->value = new DateTimeImmutable('@1700000000');
    assertSame("\x80\xa0\xab\xfe\xf9\x62", Protocol::encode($value));

    $restored = Protocol::decode(PrimDate::class, "\x80\xa0\xab\xfe\xf9\x62");
    assertSame('1700000000000', $restored->value->format('Uv'));

    $int = new PrimDateInt();
    $int->value = 1700000000000;
    assertSame("\x80\xa0\xab\xfe\xf9\x62", Protocol::encode($int));
    assertSame(1700000000000, Protocol::decode(PrimDateInt::class, "\x80\xa0\xab\xfe\xf9\x62")->value);

    $int->value = -1;
    $restored = Protocol::decode(PrimDateInt::class, Protocol::encode($int));
    assertSame(-1, $restored->value);
});

test('date: отрицательные миллисекунды сохраняют точность', static function (): void {
    $value = new PrimDate();
    $value->value = new DateTimeImmutable('1969-12-31 23:59:59.999000', new DateTimeZone('UTC'));
    $restored = Protocol::decode(PrimDate::class, Protocol::encode($value));
    assertSame('1969-12-31 23:59:59.999', $restored->value->format('Y-m-d H:i:s.v'));
});

test('enum: varint backing value', static function (): void {
    $value = new PrimEnum();
    $value->kind = PrimKind::B;
    assertSame("\x02", Protocol::encode($value));
    assertSame(PrimKind::B, Protocol::decode(PrimEnum::class, "\x02")->kind);
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(PrimEnum::class, "\x09"),
        'enum',
    );
});

test('literal: 0 байт, проверка значения', static function (): void {
    $value = new PrimLiteral();
    assertSame('', Protocol::encode($value));
    assertSame(7, Protocol::decode(PrimLiteral::class, '')->version);

    $value->version = 8;
    assertThrows(ProtocolException::class, static fn () => Protocol::encode($value), 'литерал');
});

test('readonly-свойство инициализируется при decode', static function (): void {
    $value = new PrimReadonly(5);
    assertSame("\x0a", Protocol::encode($value));
    assertSame(5, Protocol::decode(PrimReadonly::class, "\x0a")->value);

    $optional = new PrimReadonlyOptional();
    assertSame("\x00", Protocol::encode($optional));
    assertSame(null, Protocol::decode(PrimReadonlyOptional::class, "\x00")->email);

    $optional = new PrimReadonlyOptional('a@b');
    assertSame("\x01\x03a@b", Protocol::encode($optional));
    assertSame('a@b', Protocol::decode(PrimReadonlyOptional::class, "\x01\x03a@b")->email);
});

test('литерал-строка: 0 байт и проверка', static function (): void {
    $value = new PrimLiteralString();
    assertSame('', Protocol::encode($value));
    assertSame('v1', Protocol::decode(PrimLiteralString::class, '')->version);

    $value->version = 'v2';
    assertThrows(ProtocolException::class, static fn () => Protocol::encode($value), 'литерал');
});

test('private/protected свойства кодируются и декодируются', static function (): void {
    $value = new PrimPrivate(5, 'x');
    $bytes = Protocol::encode($value);
    assertSame("\x01x\x0a", $bytes);

    $restored = Protocol::decode(PrimPrivate::class, $bytes);
    assertSame(5, $restored->secret());
    assertSame('x', $restored->label());
});

test('поля кодируются в порядке UTF-8 имён', static function (): void {
    $value = new PrimOrder();
    $value->a = 1;
    $value->b = 2;
    $value->c = 3;
    assertSame("\x02\x04\x06", Protocol::encode($value));
});
