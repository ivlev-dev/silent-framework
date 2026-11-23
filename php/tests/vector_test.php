<?php

declare(strict_types=1);

use Ivlev\Silent\Protocol\Attributes\ArrayOf;
use Ivlev\Silent\Protocol\Attributes\Int64;
use Ivlev\Silent\Protocol\Attributes\Proto;
use Ivlev\Silent\Protocol\Attributes\SetOf;
use Ivlev\Silent\Protocol\Protocol;

/**
 * Единый кросс-языковой вектор: тот же файл читают TS/Rust/Kotlin-тесты.
 *
 * @return array{name: string, description: string, hex: string, fields: array<string, mixed>}
 */
function vector(): array
{
    static $vector = null;
    if ($vector === null) {
        $path = __DIR__ . '/../../protocol/vectors/user.json';
        $json = @file_get_contents($path);
        if ($json === false) {
            throw new RuntimeException('не удалось прочитать вектор: ' . $path);
        }
        $decoded = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($decoded) || !isset($decoded['hex'], $decoded['fields'])) {
            throw new RuntimeException('в векторе нет полей hex/fields: ' . $path);
        }
        $vector = $decoded;
    }
    return $vector;
}

#[Proto]
final class VectorAddress
{
    public string $city = '';

    public int $zip = 0;
}

#[Proto]
final class VectorUser
{
    public bool $active = false;

    public VectorAddress $address;

    public int $age = 0;

    public \DateTimeImmutable $createdAt;

    public ?string $email = null;

    #[Int64]
    public int $id = 0;

    public string $name = '';

    #[SetOf('string')]
    public array $roles = [];

    public float $score = 0.0;

    #[ArrayOf('string')]
    public array $tags = [];
}

/** Собирает sample из полей вектора — без дублирования значений в тесте. */
function vectorSample(): VectorUser
{
    $fields = vector()['fields'];
    $createdAtMs = (int) $fields['createdAt'];

    $user = new VectorUser();
    $user->active = (bool) $fields['active'];
    $user->address = new VectorAddress();
    $user->address->city = (string) $fields['address']['city'];
    $user->address->zip = (int) $fields['address']['zip'];
    $user->age = (int) $fields['age'];
    $user->createdAt = new DateTimeImmutable('@' . intdiv($createdAtMs, 1000));
    if ($createdAtMs % 1000 !== 0) {
        $user->createdAt = $user->createdAt->modify(sprintf('%+d milliseconds', $createdAtMs % 1000));
    }
    $user->email = (string) $fields['email'];
    $user->id = (int) $fields['id'];
    $user->name = (string) $fields['name'];
    $user->roles = array_values($fields['roles']);
    $user->score = (float) $fields['score'];
    $user->tags = array_values($fields['tags']);
    return $user;
}

test('кросс-вектор: user.json содержит hex и fields', static function (): void {
    $vector = vector();
    assertTrue($vector['hex'] !== '', 'hex пустой');
    assertTrue(is_array($vector['fields']), 'fields не массив');
});

test('кросс-вектор: encode sample даёт hex из user.json', static function (): void {
    assertSame(vector()['hex'], hexOf(Protocol::encode(vectorSample())));
});

test('кросс-вектор: decode hex даёт значения из user.json', static function (): void {
    $fields = vector()['fields'];
    $user = Protocol::decode(VectorUser::class, bytesOf(vector()['hex']));

    assertSame((bool) $fields['active'], $user->active);
    assertSame((string) $fields['address']['city'], $user->address->city);
    assertSame((int) $fields['address']['zip'], $user->address->zip);
    assertSame((int) $fields['age'], $user->age);
    assertSame((string) $fields['createdAt'], $user->createdAt->format('Uv'));
    assertSame((string) $fields['email'], $user->email);
    assertSame((int) $fields['id'], $user->id);
    assertSame((string) $fields['name'], $user->name);
    assertSame($fields['roles'], $user->roles);
    assertSame((float) $fields['score'], $user->score);
    assertSame($fields['tags'], $user->tags);
});

test('кросс-вектор: encode(decode(hex)) == hex', static function (): void {
    $user = Protocol::decode(VectorUser::class, bytesOf(vector()['hex']));
    assertSame(vector()['hex'], hexOf(Protocol::encode($user)));
});

test('кросс-вектор: схема и optionalCount', static function (): void {
    $schema = Protocol::schema(VectorUser::class);
    $names = array_map(static fn (array $entry): string => $entry['name'], $schema->entries);
    assertSame(
        ['active', 'address', 'age', 'createdAt', 'email', 'id', 'name', 'roles', 'score', 'tags'],
        $names,
    );
    assertSame(1, $schema->optionalCount);
});
