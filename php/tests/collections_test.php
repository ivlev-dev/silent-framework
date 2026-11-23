<?php

declare(strict_types=1);

use Ivlev\Silent\Protocol\Attributes\ArrayOf;
use Ivlev\Silent\Protocol\Attributes\MapOf;
use Ivlev\Silent\Protocol\Attributes\Proto;
use Ivlev\Silent\Protocol\Attributes\RecordOf;
use Ivlev\Silent\Protocol\Attributes\SetOf;
use Ivlev\Silent\Protocol\Attributes\Tuple;
use Ivlev\Silent\Protocol\Protocol;

#[Proto]
final class CollIntArray
{
    /** @var list<int> */
    #[ArrayOf('int32')]
    public array $value = [];
}

#[Proto]
final class CollOptArray
{
    /** @var list<int|null> */
    #[ArrayOf('?int32')]
    public array $value = [];
}

#[Proto]
final class CollTuple
{
    #[Tuple('int32', 'string')]
    public array $value = [];
}

#[Proto]
final class CollOptTuple
{
    #[Tuple('int32', '?string')]
    public array $value = [];
}

#[Proto]
final class CollStringMap
{
    #[MapOf('string', 'uint32')]
    public array $value = [];
}

#[Proto]
final class CollIntMap
{
    #[MapOf('int32', 'string')]
    public array $value = [];
}

#[Proto]
final class CollBoolMap
{
    #[MapOf('bool', 'uint32')]
    public array $value = [];
}

#[Proto]
final class CollOptMap
{
    #[MapOf('string', '?uint32')]
    public array $value = [];
}

#[Proto]
final class CollRecord
{
    #[RecordOf('uint32')]
    public array $value = [];
}

#[Proto]
final class CollIntSet
{
    #[SetOf('uint32')]
    public array $value = [];
}

#[Proto]
final class CollStringSet
{
    #[SetOf('string')]
    public array $value = [];
}

enum CollKind: int
{
    case A = 1;
    case B = 2;
}

#[Proto]
final class CollEnumSet
{
    #[SetOf(CollKind::class)]
    public array $value = [];
}

#[Proto]
final class CollItem
{
    public int $x = 0;
}

#[Proto]
final class CollItemSet
{
    #[SetOf(CollItem::class)]
    public array $value = [];
}

#[Proto]
final class CollItemMap
{
    #[MapOf('string', CollItem::class)]
    public array $value = [];
}

#[Proto]
final class CollEnumMap
{
    #[MapOf(CollKind::class, 'string')]
    public array $value = [];
}

#[Proto]
final class CollEnumArray
{
    #[ArrayOf(CollKind::class)]
    public array $value = [];
}

test('array: count + элементы', static function (): void {
    $value = new CollIntArray();
    assertSame("\x00", Protocol::encode($value));

    $value->value = [1, 2];
    assertSame("\x02\x02\x04", Protocol::encode($value));
    assertSame([1, 2], Protocol::decode(CollIntArray::class, "\x02\x02\x04")->value);
});

test('array: optional-элементы через bitmap после count', static function (): void {
    $value = new CollOptArray();
    $value->value = [1, null, 3];
    assertSame("\x03\x05\x02\x06", Protocol::encode($value));
    assertSame([1, null, 3], Protocol::decode(CollOptArray::class, "\x03\x05\x02\x06")->value);
});

test('tuple: значения подряд и optional-слоты', static function (): void {
    $value = new CollTuple();
    $value->value = [1, 'x'];
    assertSame("\x02\x01x", Protocol::encode($value));
    assertSame([1, 'x'], Protocol::decode(CollTuple::class, "\x02\x01x")->value);
    assertThrows(
        RuntimeException::class,
        static function () use ($value): void {
            $value->value = [1];
            Protocol::encode($value);
        },
        'кортеж',
    );

    $optional = new CollOptTuple();
    $optional->value = [1, 'x'];
    assertSame("\x01\x02\x01x", Protocol::encode($optional));
    assertSame([1, 'x'], Protocol::decode(CollOptTuple::class, "\x01\x02\x01x")->value);

    $optional->value = [1, null];
    assertSame("\x00\x02", Protocol::encode($optional));
    assertSame([1, null], Protocol::decode(CollOptTuple::class, "\x00\x02")->value);
});

test('map: канонический порядок ключей', static function (): void {
    $strings = new CollStringMap();
    $strings->value = ['b' => 2, 'a' => 1];
    assertSame("\x02\x01a\x01\x01b\x02", Protocol::encode($strings));
    assertSame(['a' => 1, 'b' => 2], Protocol::decode(CollStringMap::class, "\x02\x01a\x01\x01b\x02")->value);

    $ints = new CollIntMap();
    $ints->value = [2 => 'b', 1 => 'a'];
    assertSame("\x02\x02\x01a\x04\x01b", Protocol::encode($ints));
    assertSame([1 => 'a', 2 => 'b'], Protocol::decode(CollIntMap::class, "\x02\x02\x01a\x04\x01b")->value);

    $bools = new CollBoolMap();
    $bools->value = [true => 2, false => 1];
    assertSame("\x02\x00\x01\x01\x02", Protocol::encode($bools));
    assertSame([0 => 1, 1 => 2], Protocol::decode(CollBoolMap::class, "\x02\x00\x01\x01\x02")->value);
});

test('map: optional-значения и классы', static function (): void {
    $value = new CollOptMap();
    $value->value = ['a' => 1, 'b' => null, 'c' => 3];
    assertSame("\x03\x05\x01a\x01\x01b\x01c\x03", Protocol::encode($value));
    assertSame(
        ['a' => 1, 'b' => null, 'c' => 3],
        Protocol::decode(CollOptMap::class, "\x03\x05\x01a\x01\x01b\x01c\x03")->value,
    );

    $items = new CollItemMap();
    $item = new CollItem();
    $item->x = 5;
    $items->value = ['k' => $item];
    assertSame("\x01\x01k\x0a", Protocol::encode($items));
    $restored = Protocol::decode(CollItemMap::class, "\x01\x01k\x0a")->value;
    assertSame(5, $restored['k']->x);
});

test('record: map(string, T)', static function (): void {
    $value = new CollRecord();
    $value->value = ['b' => 2, 'a' => 1];
    assertSame("\x02\x01a\x01\x01b\x02", Protocol::encode($value));
    assertSame(['a' => 1, 'b' => 2], Protocol::decode(CollRecord::class, "\x02\x01a\x01\x01b\x02")->value);
});

test('map/set: enum-ключи и массивы enum', static function (): void {
    $map = new CollEnumMap();
    $map->value = [2 => 'b', 1 => 'a'];
    assertSame("\x02\x01\x01a\x02\x01b", Protocol::encode($map));
    assertSame([1 => 'a', 2 => 'b'], Protocol::decode(CollEnumMap::class, "\x02\x01\x01a\x02\x01b")->value);

    $array = new CollEnumArray();
    $array->value = [CollKind::B, CollKind::A];
    assertSame("\x02\x02\x01", Protocol::encode($array));
    assertSame([CollKind::B, CollKind::A], Protocol::decode(CollEnumArray::class, "\x02\x02\x01")->value);
});

test('set: числовой и строковый канонический порядок', static function (): void {
    $ints = new CollIntSet();
    $ints->value = [3, 1, 2];
    assertSame("\x03\x01\x02\x03", Protocol::encode($ints));
    assertSame([1, 2, 3], Protocol::decode(CollIntSet::class, "\x03\x01\x02\x03")->value);

    $strings = new CollStringSet();
    $strings->value = ['b', 'a', 'ä'];
    $bytes = Protocol::encode($strings);
    assertSame("\x03\x01a\x01b\x02\xc3\xa4", $bytes);
    assertSame(['a', 'b', 'ä'], Protocol::decode(CollStringSet::class, $bytes)->value);

    $ints->value = [1, 1, 2];
    assertSame("\x02\x01\x02", Protocol::encode($ints), 'дубликаты схлопываются');
});

test('set: enum и классы (сортировка по байтам)', static function (): void {
    $enums = new CollEnumSet();
    $enums->value = [CollKind::B, CollKind::A];
    assertSame("\x02\x01\x02", Protocol::encode($enums));
    assertSame([CollKind::A, CollKind::B], Protocol::decode(CollEnumSet::class, "\x02\x01\x02")->value);

    $items = new CollItemSet();
    $first = new CollItem();
    $first->x = 2;
    $second = new CollItem();
    $second->x = 1;
    $items->value = [$first, $second];
    assertSame("\x02\x02\x04", Protocol::encode($items));
    $restored = Protocol::decode(CollItemSet::class, "\x02\x02\x04")->value;
    assertSame(1, $restored[0]->x);
    assertSame(2, $restored[1]->x);
});
