<?php

declare(strict_types=1);

use Ivlev\Silent\Protocol\Attributes\ArrayOf;
use Ivlev\Silent\Protocol\Attributes\Literal;
use Ivlev\Silent\Protocol\Attributes\OneOf;
use Ivlev\Silent\Protocol\Attributes\Proto;
use Ivlev\Silent\Protocol\Errors\ProtocolException;
use Ivlev\Silent\Protocol\Protocol;

enum OneofKind: int
{
    case Created = 1;
    case Updated = 2;
    case Deleted = 3;
}

#[Proto]
final class OneofPayload
{
    public int $count = 0;

    public string $text = '';
}

#[Proto]
final class OneofEvent
{
    public OneofKind $kind = OneofKind::Created;

    #[OneOf(OneofKind::Created)]
    public ?OneofPayload $created = null;

    #[OneOf(OneofKind::Updated)]
    public ?int $updated = null;

    #[Literal(null)]
    #[OneOf(OneofKind::Deleted)]
    public ?string $deleted = null;
}

#[Proto]
final class OneofWithOptional
{
    public OneofKind $kind = OneofKind::Updated;

    #[OneOf(OneofKind::Created)]
    public ?OneofPayload $created = null;

    #[OneOf(OneofKind::Updated)]
    public ?int $value = null;

    public ?string $note = null;
}

#[Proto]
final class OneofCollection
{
    public OneofKind $kind = OneofKind::Updated;

    #[ArrayOf('uint32')]
    #[OneOf(OneofKind::Updated)]
    public ?array $values = null;

    #[Literal(null)]
    #[OneOf(OneofKind::Deleted)]
    public ?string $deleted = null;
}

enum OneofOther: int
{
    case X = 10;
}

#[Proto]
final class OneofMulti
{
    public OneofKind $kind = OneofKind::Updated;

    public OneofOther $other = OneofOther::X;

    #[OneOf(OneofKind::Updated)]
    public ?int $value = null;

    #[OneOf(OneofOther::X)]
    public ?int $count = null;
}

#[Proto]
final class OneofNoDiscriminator
{
    #[OneOf(OneofKind::Created)]
    public ?int $value = null;
}

test('oneof: payload совпадает с TS/Rust/Kotlin (010e026869)', static function (): void {
    $event = new OneofEvent();
    $event->kind = OneofKind::Created;
    $event->created = new OneofPayload();
    $event->created->count = 7;
    $event->created->text = 'hi';

    assertSame('010e026869', hexOf(Protocol::encode($event)));

    $restored = Protocol::decode(OneofEvent::class, bytesOf('010e026869'));
    assertSame(OneofKind::Created, $restored->kind);
    assertSame(7, $restored->created->count);
    assertSame('hi', $restored->created->text);
    assertSame(null, $restored->updated);
    assertSame(null, $restored->deleted);
});

test('oneof: скалярный вариант (0254)', static function (): void {
    $event = new OneofEvent();
    $event->kind = OneofKind::Updated;
    $event->updated = 42;

    assertSame('0254', hexOf(Protocol::encode($event)));

    $restored = Protocol::decode(OneofEvent::class, bytesOf('0254'));
    assertSame(OneofKind::Updated, $restored->kind);
    assertSame(42, $restored->updated);
    assertSame(null, $restored->created);
    assertSame(null, $restored->deleted);
});

test('oneof: unit-вариант (03)', static function (): void {
    $event = new OneofEvent();
    $event->kind = OneofKind::Deleted;
    $event->deleted = null;

    assertSame('03', hexOf(Protocol::encode($event)));

    $restored = Protocol::decode(OneofEvent::class, bytesOf('03'));
    assertSame(OneofKind::Deleted, $restored->kind);
    assertSame(null, $restored->created);
    assertSame(null, $restored->updated);
    assertSame(null, $restored->deleted);
});

test('oneof: ровно один вариант', static function (): void {
    $event = new OneofEvent();
    $event->kind = OneofKind::Created;
    assertThrows(ProtocolException::class, static fn () => Protocol::encode($event), 'не имеет значения');

    $event->created = new OneofPayload();
    $event->updated = 5;
    assertThrows(ProtocolException::class, static fn () => Protocol::encode($event), 'более одного');

    $event->created = null;
    $event->updated = 5;
    assertThrows(ProtocolException::class, static fn () => Protocol::encode($event), 'более одного');
});

test('oneof: неизвестный вариант при decode', static function (): void {
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(OneofEvent::class, bytesOf('04')),
        'oneof',
    );
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::decode(OneofEvent::class, bytesOf('00')),
        'oneof',
    );
});

test('oneof: коллекция как вариант', static function (): void {
    $event = new OneofCollection();
    $event->kind = OneofKind::Updated;
    $event->values = [1, 2];
    assertSame('02020102', hexOf(Protocol::encode($event)));

    $restored = Protocol::decode(OneofCollection::class, bytesOf('02020102'));
    assertSame(OneofKind::Updated, $restored->kind);
    assertSame([1, 2], $restored->values);
    assertSame(null, $restored->deleted);

    $event->values = null;
    $event->kind = OneofKind::Deleted;
    assertSame('03', hexOf(Protocol::encode($event)));
});

test('oneof: несколько групп по разным enum', static function (): void {
    $event = new OneofMulti();
    $event->kind = OneofKind::Updated;
    $event->other = OneofOther::X;
    $event->value = 42;
    $event->count = 5;

    assertSame('02540a0a', hexOf(Protocol::encode($event)));

    $restored = Protocol::decode(OneofMulti::class, bytesOf('02540a0a'));
    assertSame(OneofKind::Updated, $restored->kind);
    assertSame(42, $restored->value);
    assertSame(OneofOther::X, $restored->other);
    assertSame(5, $restored->count);
});

test('oneof: без дискриминатора — ошибка схемы', static function (): void {
    assertThrows(
        ProtocolException::class,
        static fn () => Protocol::encode(new OneofNoDiscriminator()),
        'дискриминатор',
    );
});

test('oneof: варианты не занимают bitmap, обычные optional — занимают', static function (): void {
    $event = new OneofWithOptional();
    $event->kind = OneofKind::Updated;
    $event->value = 42;
    $event->note = 'x';

    assertSame('0102540178', hexOf(Protocol::encode($event)));

    $restored = Protocol::decode(OneofWithOptional::class, bytesOf('0102540178'));
    assertSame(OneofKind::Updated, $restored->kind);
    assertSame(42, $restored->value);
    assertSame('x', $restored->note);
    assertSame(null, $restored->created);

    $event->note = null;
    assertSame('000254', hexOf(Protocol::encode($event)));
});

