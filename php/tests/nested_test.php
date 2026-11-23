<?php

declare(strict_types=1);

use Ivlev\Silent\Protocol\Attributes\Proto;
use Ivlev\Silent\Protocol\Errors\ProtocolException;
use Ivlev\Silent\Protocol\Options;
use Ivlev\Silent\Protocol\Protocol;

#[Proto]
final class NestedAddress
{
    public string $city = '';

    public int $zip = 0;
}

#[Proto]
final class NestedUser
{
    public NestedAddress $address;

    public ?NestedAddress $extra = null;
}

#[Proto]
class NestedBase
{
    public int $a = 1;

    public string $b = 'x';
}

#[Proto]
final class NestedChild extends NestedBase
{
    public bool $c = true;

    public string $b = 'y';
}

#[Proto]
final class NestedEmpty
{
}

test('nested: вложенный класс без префикса длины', static function (): void {
    $user = new NestedUser();
    $user->address = new NestedAddress();
    $user->address->city = 'ab';
    $user->address->zip = 1;

    assertSame("\x00\x02ab\x02", Protocol::encode($user));

    $restored = Protocol::decode(NestedUser::class, "\x00\x02ab\x02");
    assertSame(NestedAddress::class, $restored->address::class);
    assertSame('ab', $restored->address->city);
    assertSame(1, $restored->address->zip);
    assertSame(null, $restored->extra);
});

test('nested: optional вложенный объект', static function (): void {
    $user = new NestedUser();
    $user->address = new NestedAddress();
    $user->address->city = 'ab';
    $user->address->zip = 1;
    $user->extra = new NestedAddress();
    $user->extra->city = 'c';
    $user->extra->zip = 2;

    assertSame("\x01\x02ab\x02\x01c\x04", Protocol::encode($user));

    $restored = Protocol::decode(NestedUser::class, "\x01\x02ab\x02\x01c\x04");
    assertSame('c', $restored->extra->city);
    assertSame(2, $restored->extra->zip);
});

test('nested: глубина вложенности контролируется', static function (): void {
    $user = new NestedUser();
    $user->address = new NestedAddress();
    $bytes = Protocol::encode($user);

    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::encode($user, new Options(maxDepth: 0)),
        'глубины',
    );
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(NestedUser::class, $bytes, new Options(maxDepth: 0)),
        'глубины',
    );
    assertSame('', Protocol::decode(NestedUser::class, $bytes, new Options(maxDepth: 1))->address->city);
});

test('наследование: поля родителя и переопределение', static function (): void {
    $child = new NestedChild();
    $child->a = 1;
    $child->b = 'y';
    $child->c = true;

    assertSame("\x02\x01y\x01", Protocol::encode($child));

    $restored = Protocol::decode(NestedChild::class, "\x02\x01y\x01");
    assertSame(1, $restored->a);
    assertSame('y', $restored->b);
    assertSame(true, $restored->c);

    $schema = Protocol::schema(NestedChild::class);
    $names = array_map(static fn (array $entry): string => $entry['name'], $schema->entries);
    assertSame(['a', 'b', 'c'], $names);
    assertSame(0, $schema->optionalCount);
});

test('пустое сообщение — пустой буфер', static function (): void {
    assertSame('', Protocol::encode(new NestedEmpty()));
    assertSame(NestedEmpty::class, Protocol::decode(NestedEmpty::class, '')::class);
});
