<?php

declare(strict_types=1);

use Ivlev\Silent\Protocol\Attributes\ArrayOf;
use Ivlev\Silent\Protocol\Attributes\Date;
use Ivlev\Silent\Protocol\Attributes\Int64;
use Ivlev\Silent\Protocol\Attributes\MapOf;
use Ivlev\Silent\Protocol\Attributes\Proto;
use Ivlev\Silent\Protocol\Attributes\RecordOf;
use Ivlev\Silent\Protocol\Attributes\SetOf;
use Ivlev\Silent\Protocol\Attributes\Tuple;
use Ivlev\Silent\Protocol\Protocol;

enum RegKind: int
{
    case A = 1;
    case B = 2;
}

#[Proto]
final class RegInner
{
    public string $name = '';

    public ?int $n = null;
}

#[Proto]
final class RegModel
{
    public bool $flag = false;

    #[Int64]
    public int $id = 0;

    public float $score = 0.0;

    public string $text = '';

    public ?string $note = null;

    #[ArrayOf('int32')]
    public array $nums = [];

    #[ArrayOf('?string')]
    public array $maybe = [];

    #[SetOf('string')]
    public array $tags = [];

    #[MapOf('string', 'uint32')]
    public array $counts = [];

    #[Tuple('int32', '?string')]
    public array $pair = [0, null];

    #[RecordOf('string')]
    public array $record = [];

    public RegInner $inner;

    public ?RegInner $maybeInner = null;

    #[Date]
    public int $at = 0;

    public RegKind $kind = RegKind::A;
}

function regressionSample(): RegModel
{
    $model = new RegModel();
    $model->flag = true;
    $model->id = PHP_INT_MIN;
    $model->score = -1234.5;
    $model->text = 'Привет, мир! 🚀';
    $model->note = null;
    $model->nums = [3, -1, 0, 2147483647, -2147483648];
    $model->maybe = ['a', null, 'б'];
    $model->tags = ['user', 'admin', 'админ'];
    $model->counts = ['b' => 2, 'a' => 1];
    $model->pair = [7, 'x'];
    $model->record = ['z' => 'последний', 'a' => 'первый'];
    $model->inner = new RegInner();
    $model->inner->name = 'inner';
    $model->inner->n = -5;
    $model->maybeInner = null;
    $model->at = 1700000000123;
    $model->kind = RegKind::B;
    return $model;
}

test('регрессия: encode(decode(x)) == encode(x)', static function (): void {
    $model = regressionSample();
    $bytes = Protocol::encode($model);
    $restored = Protocol::decode(RegModel::class, $bytes);
    assertSame($bytes, Protocol::encode($restored));
});

test('регрессия: значения сохраняются', static function (): void {
    $model = regressionSample();
    $restored = Protocol::decode(RegModel::class, Protocol::encode($model));

    assertSame(true, $restored->flag);
    assertSame(PHP_INT_MIN, $restored->id);
    assertSame(-1234.5, $restored->score);
    assertSame('Привет, мир! 🚀', $restored->text);
    assertSame(null, $restored->note);
    assertSame([3, -1, 0, 2147483647, -2147483648], $restored->nums);
    assertSame(['a', null, 'б'], $restored->maybe);
    assertSame(['admin', 'user', 'админ'], $restored->tags, 'set канонизирован');
    assertSame(['a' => 1, 'b' => 2], $restored->counts);
    assertSame([7, 'x'], $restored->pair);
    assertSame(['a' => 'первый', 'z' => 'последний'], $restored->record);
    assertSame('inner', $restored->inner->name);
    assertSame(-5, $restored->inner->n);
    assertSame(null, $restored->maybeInner);
    assertSame(1700000000123, $restored->at);
    assertSame(RegKind::B, $restored->kind);
});

test('регрессия: пустые коллекции и отсутствующие optional', static function (): void {
    $model = new RegModel();
    $model->inner = new RegInner();
    $bytes = Protocol::encode($model);
    $restored = Protocol::decode(RegModel::class, $bytes);

    assertSame([], $restored->nums);
    assertSame([], $restored->maybe);
    assertSame([], $restored->tags);
    assertSame([], $restored->counts);
    assertSame([0, null], $restored->pair);
    assertSame([], $restored->record);
    assertSame(null, $restored->note);
    assertSame(null, $restored->maybeInner);
    assertSame($bytes, Protocol::encode($restored));
});
