<?php

declare(strict_types=1);

use Ivlev\Silent\Protocol\Attributes\Proto;
use Ivlev\Silent\Protocol\Attributes\Uint32;
use Ivlev\Silent\Protocol\Protocol;

#[Proto]
final class BitmapOne
{
    #[Uint32]
    public ?int $a = null;
}

#[Proto]
final class BitmapEight
{
    #[Uint32]
    public ?int $a = null;

    #[Uint32]
    public ?int $b = null;

    #[Uint32]
    public ?int $c = null;

    #[Uint32]
    public ?int $d = null;

    #[Uint32]
    public ?int $e = null;

    #[Uint32]
    public ?int $f = null;

    #[Uint32]
    public ?int $g = null;

    #[Uint32]
    public ?int $h = null;
}

#[Proto]
final class BitmapNine
{
    #[Uint32]
    public ?int $a = null;

    #[Uint32]
    public ?int $b = null;

    #[Uint32]
    public ?int $c = null;

    #[Uint32]
    public ?int $d = null;

    #[Uint32]
    public ?int $e = null;

    #[Uint32]
    public ?int $f = null;

    #[Uint32]
    public ?int $g = null;

    #[Uint32]
    public ?int $h = null;

    #[Uint32]
    public ?int $i = null;
}

#[Proto]
final class BitmapUnsorted
{
    #[Uint32]
    public ?int $z = null;

    #[Uint32]
    public ?int $a = null;
}

$bitmapWideFields = '';
for ($index = 0; $index < 33; $index += 1) {
    $bitmapWideFields .= ' public ?int $f' . sprintf('%02d', $index) . ' = null;';
}
eval('#[\Ivlev\Silent\Protocol\Attributes\Proto] final class BitmapWide {' . $bitmapWideFields . '}');

test('bitmap: одно optional-поле', static function (): void {
    $value = new BitmapOne();
    assertSame("\x00", Protocol::encode($value));

    $value->a = 5;
    assertSame("\x01\x05", Protocol::encode($value));

    $restored = Protocol::decode(BitmapOne::class, "\x01\x05");
    assertSame(5, $restored->a);
    assertSame(null, Protocol::decode(BitmapOne::class, "\x00")->a);
});

test('bitmap: восемь полей, биты LSB-first', static function (): void {
    $value = new BitmapEight();
    assertSame("\x00", Protocol::encode($value));

    $value->h = 9;
    assertSame("\x80\x09", Protocol::encode($value));

    $value->a = 1;
    assertSame("\x81\x01\x09", Protocol::encode($value));

    $restored = Protocol::decode(BitmapEight::class, "\x81\x01\x09");
    assertSame(1, $restored->a);
    assertSame(null, $restored->b);
    assertSame(9, $restored->h);
});

test('bitmap: девять полей — два байта', static function (): void {
    $value = new BitmapNine();
    assertSame("\x00\x00", Protocol::encode($value));

    $value->i = 7;
    assertSame("\x00\x01\x07", Protocol::encode($value));

    $value->i = null;
    foreach (['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as $name) {
        $value->{$name} = 0;
    }
    assertSame("\xff\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00", Protocol::encode($value));

    $restored = Protocol::decode(BitmapNine::class, "\xff\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00");
    assertSame(0, $restored->i);
    assertSame(null, Protocol::decode(BitmapNine::class, "\x00\x01\x07")->a);
});

test('bitmap: порядок по имени, а не по объявлению', static function (): void {
    $value = new BitmapUnsorted();
    $value->z = 1;
    assertSame("\x02\x01", Protocol::encode($value));

    $value->z = null;
    $value->a = 1;
    assertSame("\x01\x01", Protocol::encode($value));

    $value->a = 2;
    $value->z = 1;
    assertSame("\x03\x02\x01", Protocol::encode($value));

    $restored = Protocol::decode(BitmapUnsorted::class, "\x03\x02\x01");
    assertSame(2, $restored->a);
    assertSame(1, $restored->z);
    assertSame(null, Protocol::decode(BitmapUnsorted::class, "\x02\x01")->a);
});

test('bitmap: больше 32 optional-полей', static function (): void {
    $class = 'BitmapWide';
    $value = new $class();
    assertSame(str_repeat("\x00", 5), Protocol::encode($value));

    $value->f32 = 7;
    assertSame("\x00\x00\x00\x00\x01\x0e", Protocol::encode($value));

    $value->f00 = 1;
    $value->f31 = 3;
    $value->f32 = null;
    assertSame(
        "\x01\x00\x00\x80\x00\x02\x06",
        Protocol::encode($value),
    );

    $restored = Protocol::decode($class, "\x01\x00\x00\x80\x00\x02\x06");
    assertSame(1, $restored->f00);
    assertSame(3, $restored->f31);
    assertSame(null, $restored->f32);
    assertSame(null, $restored->f01);
});
