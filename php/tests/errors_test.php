<?php

declare(strict_types=1);

use Ivlev\Silent\Protocol\Attributes\ArrayOf;
use Ivlev\Silent\Protocol\Attributes\MapOf;
use Ivlev\Silent\Protocol\Attributes\Proto;
use Ivlev\Silent\Protocol\Attributes\SetOf;
use Ivlev\Silent\Protocol\Attributes\Uint32;
use Ivlev\Silent\Protocol\Errors\ProtocolException;
use Ivlev\Silent\Protocol\Options;
use Ivlev\Silent\Protocol\Protocol;

#[Proto]
final class ErrInt32
{
    public int $value = 0;
}

#[Proto]
final class ErrBool
{
    public bool $value = false;
}

enum ErrKind: int
{
    case A = 1;
    case B = 2;
}

#[Proto]
final class ErrEnum
{
    public ErrKind $kind = ErrKind::A;
}

#[Proto]
final class ErrRequired
{
    public int $a;

    public string $b;
}

#[Proto]
final class ErrString
{
    public string $value = '';
}

#[Proto]
final class ErrNode
{
    public ?ErrNode $next = null;
}

final class ErrNoProto
{
    public int $value = 0;
}

enum ErrStringEnum: string
{
    case A = 'a';
}

#[Proto]
final class ErrStringEnumMessage
{
    public ErrStringEnum $kind = ErrStringEnum::A;
}

#[Proto]
final class ErrBadMap
{
    #[MapOf('float64', 'int32')]
    public array $value = [];
}

#[Proto]
final class ErrOptionalSet
{
    #[SetOf('?int32')]
    public array $value = [];
}

#[Proto]
final class ErrWireCollection
{
    #[ArrayOf('int32')]
    #[Uint32]
    public array $value = [];
}

test('ошибки: обрезка буфера', static function (): void {
    $error = assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(ErrInt32::class, ''),
        'доступно',
    );
    assertSame('truncated', $error->errorCode);

    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(ErrInt32::class, "\x80"),
        'доступно',
    );
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(ErrString::class, "\x05ab"),
        'доступно',
    );
});

test('ошибки: лишние байты и allowTrailing', static function (): void {
    $error = assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(ErrInt32::class, "\x02\x00"),
        'осталось',
    );
    assertSame('trailing', $error->errorCode);

    $value = Protocol::decode(ErrInt32::class, "\x02\x00", new Options(allowTrailing: true));
    assertSame(1, $value->value);
});

test('ошибки: неверный varint', static function (): void {
    $error = assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(ErrInt32::class, str_repeat("\xff", 10)),
        '64 бита',
    );
    assertSame('invalid_varint', $error->errorCode);

    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(ErrInt32::class, "\xff\xff\xff\xff\x1f"),
        'диапазона',
    );
});

test('ошибки: bool, enum, литерал, обязательное поле', static function (): void {
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(ErrBool::class, "\x02"),
        'bool',
    );
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(ErrEnum::class, "\x09"),
        'enum',
    );
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(ErrRequired::class, "\x00"),
        'доступно',
    );
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::encode(new ErrRequired()),
        'не инициализировано',
    );
});

test('ошибки: лимит размера', static function (): void {
    $error = assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(ErrInt32::class, "\x02\x00", new Options(maxSize: 1)),
        'лимит',
    );
    assertSame('size', $error->errorCode);

    $string = new ErrString();
    $string->value = 'abcdef';
    $sizeError = assertThrows(
        ProtocolException::class,
        static fn () => Protocol::encode($string, new Options(maxSize: 4)),
        'лимит',
    );
    assertSame('size', $sizeError->errorCode);

    $bytes = Protocol::encode($string);
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(ErrString::class, $bytes, new Options(maxSize: 2)),
        'лимит',
    );
});

test('ошибки: цикл объектов', static function (): void {
    $node = new ErrNode();
    $node->next = $node;
    $error = assertThrows(
        ProtocolException::class,
        static fn () => Protocol::encode($node),
        'цикл',
    );
    assertSame('cycle', $error->errorCode);
});

test('ошибки: лимит глубины при encode и decode', static function (): void {
    $first = new ErrNode();
    $second = new ErrNode();
    $third = new ErrNode();
    $first->next = $second;
    $second->next = $third;

    $error = assertThrows(
        ProtocolException::class,
        static fn () => Protocol::encode($first, new Options(maxDepth: 1)),
        'глубины',
    );
    assertSame('depth', $error->errorCode);

    $bytes = Protocol::encode($first);
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(ErrNode::class, $bytes, new Options(maxDepth: 1)),
        'глубины',
    );

    $restored = Protocol::decode(ErrNode::class, $bytes);
    assertSame(ErrNode::class, $restored->next->next::class);
});

test('ошибки схемы', static function (): void {
    $error = assertThrows(
        ProtocolException::class,
        static fn () => Protocol::encode(new ErrNoProto()),
        '#[Proto]',
    );
    assertSame('schema', $error->errorCode);

    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::encode(new ErrStringEnumMessage()),
        'int-backed',
    );
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::schema(ErrBadMap::class),
        'ключ map',
    );
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::encode(new ErrOptionalSet()),
        'optional',
    );
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::schema(ErrWireCollection::class),
        'коллекцией',
    );
});

test('Options: невалидные значения', static function (): void {
    assertThrows(InvalidArgumentException::class, static fn () => new Options(maxSize: 0));
    assertThrows(InvalidArgumentException::class, static fn () => new Options(maxDepth: -1));
});
