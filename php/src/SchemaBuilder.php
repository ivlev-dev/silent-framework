<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol;

use Ivlev\Silent\Protocol\Attributes\ArrayOf;
use Ivlev\Silent\Protocol\Attributes\BigInt;
use Ivlev\Silent\Protocol\Attributes\Bytes;
use Ivlev\Silent\Protocol\Attributes\Date;
use Ivlev\Silent\Protocol\Attributes\Fixed32;
use Ivlev\Silent\Protocol\Attributes\Fixed64;
use Ivlev\Silent\Protocol\Attributes\Float32;
use Ivlev\Silent\Protocol\Attributes\Int32;
use Ivlev\Silent\Protocol\Attributes\Int64;
use Ivlev\Silent\Protocol\Attributes\Literal;
use Ivlev\Silent\Protocol\Attributes\MapOf;
use Ivlev\Silent\Protocol\Attributes\OneOf;
use Ivlev\Silent\Protocol\Attributes\Proto;
use Ivlev\Silent\Protocol\Attributes\RecordOf;
use Ivlev\Silent\Protocol\Attributes\SetOf;
use Ivlev\Silent\Protocol\Attributes\Tuple;
use Ivlev\Silent\Protocol\Attributes\Uint32;
use Ivlev\Silent\Protocol\Attributes\Uint64;
use Ivlev\Silent\Protocol\Errors\ProtocolException;

/**
 * Построение схемы по атрибутам класса.
 *
 * Результат кешируется по имени класса: атрибуты статичны, повторная
 * рефлексия в горячем пути не выполняется.
 */
final class SchemaBuilder
{
    private const WIRE_ATTRIBUTES = [
        Int32::class => 'int32',
        Uint32::class => 'uint32',
        Int64::class => 'int64',
        BigInt::class => 'int64',
        Uint64::class => 'uint64',
        Float32::class => 'float32',
        Fixed32::class => 'fixed32',
        Fixed64::class => 'fixed64',
    ];

    private const INTEGER_TYPES = [
        'int32' => true,
        'int64' => true,
        'uint32' => true,
        'uint64' => true,
        'fixed32' => true,
        'fixed64' => true,
    ];

    /** @var array<class-string, Schema> */
    private static array $cache = [];

    /** @return Schema */
    public static function build(string $class): Schema
    {
        $class = ltrim($class, '\\');
        if (isset(self::$cache[$class])) {
            return self::$cache[$class];
        }

        if (!class_exists($class)) {
            throw ProtocolException::schema('класс ' . $class . ' не найден', $class);
        }

        $reflection = new \ReflectionClass($class);
        if ($reflection->getAttributes(Proto::class) === []) {
            throw ProtocolException::schema(
                'для класса ' . $class . ' не задан атрибут #[Proto]',
                $class,
            );
        }

        return self::$cache[$class] = self::buildSchema($reflection);
    }

    public static function clearCache(): void
    {
        self::$cache = [];
    }

    private static function buildSchema(\ReflectionClass $reflection): Schema
    {
        $properties = self::properties($reflection);
        $fields = [];
        $variantGroups = [];

        foreach ($properties as $name => $property) {
            $parsed = self::parseProperty($property);
            if ($parsed['oneof'] !== null) {
                $variantGroups[$parsed['oneof']['enum']][] = $parsed;
                continue;
            }
            $fields[$name] = $parsed;
        }

        $oneofs = [];
        foreach ($variantGroups as $enum => $variants) {
            $discriminators = [];
            foreach ($fields as $name => $field) {
                if (!$field['optional'] && $field['type'] === ['enum', $enum]) {
                    $discriminators[] = $name;
                }
            }
            if (count($discriminators) !== 1) {
                throw ProtocolException::schema(
                    'для oneof с enum ' . $enum . ' нужно ровно одно не-nullable enum-свойство-дискриминатор'
                    . ' (найдено ' . count($discriminators) . ')',
                    $reflection->getShortName(),
                );
            }
            $discriminator = $discriminators[0];
            $discriminatorProperty = $fields[$discriminator]['property'];
            unset($fields[$discriminator]);

            $resolved = [];
            $values = [];
            foreach ($variants as $variant) {
                if (!$variant['optional']) {
                    throw ProtocolException::schema(
                        'вариант oneof ' . $variant['name'] . ' должен быть nullable',
                        $reflection->getShortName() . '.' . $variant['name'],
                    );
                }
                $value = $variant['oneof']['value'];
                if (isset($values[$value])) {
                    throw ProtocolException::schema(
                        'дубликат значения ' . $value . ' в oneof ' . $discriminator,
                        $reflection->getShortName(),
                    );
                }
                $values[$value] = true;
                $resolved[] = [
                    'field' => $variant['name'],
                    'value' => $value,
                    'type' => $variant['type'],
                    'property' => $variant['property'],
                    'unit' => self::isUnitType($variant['type']),
                ];
            }
            usort($resolved, static fn (array $a, array $b): int => $a['value'] <=> $b['value']);

            $oneofs[$discriminator] = [
                'kind' => 'oneof',
                'name' => $discriminator,
                'enum' => $enum,
                'property' => $discriminatorProperty,
                'variants' => $resolved,
            ];
        }

        $optionalCount = 0;
        foreach ($fields as $field) {
            if ($field['optional']) {
                $optionalCount += 1;
            }
        }

        $entries = [];
        foreach ($fields as $field) {
            $entries[] = [
                'kind' => 'field',
                'name' => $field['name'],
                'type' => $field['type'],
                'optional' => $field['optional'],
                'property' => $field['property'],
            ];
        }
        foreach ($oneofs as $oneof) {
            $entries[] = $oneof;
        }
        usort($entries, static fn (array $a, array $b): int => strcmp($a['name'], $b['name']));

        return new Schema($reflection->getName(), $entries, $optionalCount);
    }

    /**
     * Все объявленные (не static) свойства иерархии: родитель → потомок,
     * одноимённое свойство потомка переопределяет базовое.
     *
     * @return array<string, \ReflectionProperty>
     */
    private static function properties(\ReflectionClass $reflection): array
    {
        $chain = [];
        for ($node = $reflection; $node !== false; $node = $node->getParentClass()) {
            $chain[] = $node;
        }
        $chain = array_reverse($chain);

        $properties = [];
        foreach ($chain as $node) {
            foreach ($node->getProperties() as $property) {
                if ($property->isStatic()) {
                    continue;
                }
                if ($property->getDeclaringClass()->getName() !== $node->getName()) {
                    continue;
                }
                $properties[$property->getName()] = $property;
            }
        }
        return $properties;
    }

    /**
     * @return array{
     *     name: string,
     *     type: string|array<mixed>,
     *     optional: bool,
     *     property: \ReflectionProperty,
     *     oneof: array{enum: class-string, value: int}|null,
     * }
     */
    private static function parseProperty(\ReflectionProperty $property): array
    {
        $name = $property->getName();
        $path = $property->getDeclaringClass()->getShortName() . '.' . $name;

        $wire = null;
        $literalSet = false;
        $literal = null;
        $oneofCase = null;
        $collection = null;

        foreach ($property->getAttributes() as $attribute) {
            $attributeName = $attribute->getName();

            if (isset(self::WIRE_ATTRIBUTES[$attributeName])) {
                if ($wire !== null) {
                    throw ProtocolException::schema('несколько wire-атрибутов на поле ' . $name, $path);
                }
                $wire = self::WIRE_ATTRIBUTES[$attributeName];
                continue;
            }

            switch ($attributeName) {
                case Bytes::class:
                    if ($wire !== null && $wire !== 'bytes') {
                        throw ProtocolException::schema('несколько wire-атрибутов на поле ' . $name, $path);
                    }
                    $wire = 'bytes';
                    break;
                case Date::class:
                    if ($wire !== null && $wire !== 'date') {
                        throw ProtocolException::schema('несколько wire-атрибутов на поле ' . $name, $path);
                    }
                    $wire = 'date';
                    break;
                case Literal::class:
                    if ($literalSet) {
                        throw ProtocolException::schema('несколько литералов на поле ' . $name, $path);
                    }
                    /** @var Literal $instance */
                    $instance = self::attributeInstance($attribute, $path);
                    $literalSet = true;
                    $literal = $instance->value;
                    break;
                case OneOf::class:
                    if ($oneofCase !== null) {
                        throw ProtocolException::schema('несколько OneOf на поле ' . $name, $path);
                    }
                    /** @var OneOf $instance */
                    $instance = self::attributeInstance($attribute, $path);
                    $oneofCase = $instance->case;
                    break;
                case ArrayOf::class:
                    self::assertNoCollection($collection, $name, $path);
                    /** @var ArrayOf $instance */
                    $instance = self::attributeInstance($attribute, $path);
                    $collection = ['array', self::parseToken($instance->type, $path)];
                    break;
                case SetOf::class:
                    self::assertNoCollection($collection, $name, $path);
                    /** @var SetOf $instance */
                    $instance = self::attributeInstance($attribute, $path);
                    $collection = ['set', self::parseToken($instance->type, $path)];
                    break;
                case RecordOf::class:
                    self::assertNoCollection($collection, $name, $path);
                    /** @var RecordOf $instance */
                    $instance = self::attributeInstance($attribute, $path);
                    $collection = ['record', self::parseToken($instance->value, $path)];
                    break;
                case MapOf::class:
                    self::assertNoCollection($collection, $name, $path);
                    /** @var MapOf $instance */
                    $instance = self::attributeInstance($attribute, $path);
                    $collection = [
                        'map',
                        self::parseKeyToken($instance->key, $path),
                        self::parseToken($instance->value, $path),
                    ];
                    break;
                case Tuple::class:
                    self::assertNoCollection($collection, $name, $path);
                    /** @var Tuple $instance */
                    $instance = self::attributeInstance($attribute, $path);
                    $types = [];
                    foreach ($instance->types as $index => $token) {
                        $types[] = self::parseToken($token, $path . '[' . $index . ']');
                    }
                    $collection = ['tuple', $types];
                    break;
                default:
                    // Чужие атрибуты не трогаем: они не часть протокола.
                    break;
            }
        }

        [$base, $optional] = self::declaredType($property, $path);

        if ($oneofCase !== null) {
            if (!is_int($oneofCase->value)) {
                throw ProtocolException::schema(
                    'enum-дискриминатор должен иметь целочисленный backing-тип',
                    $path,
                );
            }
            if ($oneofCase->value < 0 || $oneofCase->value > 0x7FFFFFFF) {
                throw ProtocolException::schema('значение варианта oneof вне uint32', $path);
            }
        }

        if ($collection !== null) {
            if ($base !== 'array') {
                throw ProtocolException::schema('коллекция требует свойства типа array', $path);
            }
            if ($literalSet) {
                throw ProtocolException::schema('литерал не может быть коллекцией', $path);
            }
            if ($wire !== null) {
                throw ProtocolException::schema('wire-атрибут несовместим с коллекцией', $path);
            }
            $type = $collection;
        } elseif ($literalSet) {
            if ($wire !== null) {
                throw ProtocolException::schema('литерал не может иметь wire-атрибут', $path);
            }
            self::assertLiteralCompatible($literal, $base, $optional, $path);
            $type = ['literal', $literal];
        } else {
            if ($base === 'array') {
                throw ProtocolException::schema(
                    'для array-свойства нужен #[ArrayOf], #[SetOf], #[MapOf], #[RecordOf] или #[Tuple]',
                    $path,
                );
            }
            $type = $wire !== null ? self::applyWire($wire, $base, $path) : $base;
        }

        return [
            'name' => $name,
            'type' => $type,
            'optional' => $optional,
            'property' => $property,
            'oneof' => $oneofCase === null
                ? null
                : ['enum' => $oneofCase::class, 'value' => $oneofCase->value],
        ];
    }

    /**
     * @return array{0: string, 1: bool}
     */
    private static function declaredType(\ReflectionProperty $property, string $path): array
    {
        $type = $property->getType();

        if ($type === null) {
            throw ProtocolException::schema('свойство ' . $path . ' должно иметь тип', $path);
        }

        if ($type instanceof \ReflectionUnionType) {
            $named = [];
            foreach ($type->getTypes() as $candidate) {
                if ($candidate instanceof \ReflectionNamedType && $candidate->getName() === 'null') {
                    continue;
                }
                $named[] = $candidate;
            }
            if (count($named) !== 1 || !$named[0] instanceof \ReflectionNamedType) {
                throw ProtocolException::schema(
                    'поддерживается только ?T (null и один тип), а не union',
                    $path,
                );
            }
            $type = $named[0];
            $optional = true;
        } elseif ($type instanceof \ReflectionIntersectionType) {
            throw ProtocolException::schema('intersection-типы не поддерживаются', $path);
        } else {
            $optional = $type->allowsNull() && $type->getName() !== 'mixed';
        }

        $name = $type->getName();

        $base = match ($name) {
            'bool' => 'bool',
            'int' => 'int32',
            'float' => 'float64',
            'string' => 'string',
            'array' => 'array',
            'mixed', 'object', 'iterable', 'callable', 'void', 'null', 'never' => throw ProtocolException::schema(
                'неподдерживаемый тип свойства ' . $name,
                $path,
            ),
            default => self::objectType($name, $path),
        };

        return [$base, $optional];
    }

    /** @return string|array<mixed> */
    private static function objectType(string $name, string $path): string|array
    {
        $name = ltrim($name, '\\');

        if ($name === \DateTimeInterface::class || is_subclass_of($name, \DateTimeInterface::class)) {
            return 'date';
        }
        if (enum_exists($name)) {
            return self::enumType($name, $path);
        }
        if (class_exists($name)) {
            return ['class', $name];
        }
        throw ProtocolException::schema('неизвестный тип ' . $name, $path);
    }

    /** @return array{0: 'enum', 1: class-string} */
    private static function enumType(string $class, string $path): array
    {
        $reflection = new \ReflectionEnum($class);
        if (!$reflection->isBacked()) {
            throw ProtocolException::schema('enum ' . $class . ' должен иметь backing-тип', $path);
        }
        $backing = $reflection->getBackingType();
        if ($backing === null || $backing->getName() !== 'int') {
            throw ProtocolException::schema('поддерживаются только int-backed enum', $path);
        }
        return ['enum', ltrim($class, '\\')];
    }

    /** @return string|array<mixed> */
    private static function parseToken(string $token, string $path): string|array
    {
        $token = trim($token);
        if ($token === '') {
            throw ProtocolException::schema('пустой тип элемента', $path);
        }
        if ($token[0] === '?') {
            $inner = substr($token, 1);
            if ($inner === '') {
                throw ProtocolException::schema('пустой optional-тип', $path);
            }
            return ['optional', self::parseToken($inner, $path)];
        }

        return match ($token) {
            'bool' => 'bool',
            'int', 'int32' => 'int32',
            'uint32' => 'uint32',
            'int64', 'bigint' => 'int64',
            'uint64' => 'uint64',
            'float', 'float64' => 'float64',
            'float32' => 'float32',
            'fixed32' => 'fixed32',
            'fixed64' => 'fixed64',
            'string' => 'string',
            'bytes' => 'bytes',
            'date' => 'date',
            'null' => 'null',
            default => self::objectType($token, $path),
        };
    }

    /** Ключи map: string, целые, bool или int-backed enum. */
    private static function parseKeyToken(string $token, string $path): string|array
    {
        $type = self::parseToken($token, $path . '.key');
        if (is_array($type) && $type[0] === 'optional') {
            throw ProtocolException::schema('ключ map не может быть optional', $path);
        }
        if (is_array($type) && $type[0] === 'enum') {
            return $type;
        }
        if (is_string($type) && (
            $type === 'string'
            || $type === 'bool'
            || $type === 'int32'
            || $type === 'uint32'
            || $type === 'int64'
            || $type === 'uint64'
            || $type === 'fixed32'
            || $type === 'fixed64'
        )) {
            return $type;
        }
        throw ProtocolException::schema(
            'ключ map должен быть string, целым, bool или enum',
            $path,
        );
    }

    private static function applyWire(string $wire, string $base, string $path): string
    {
        if ($wire === 'bytes') {
            if ($base !== 'string') {
                throw ProtocolException::schema('#[Bytes] применим только к string', $path);
            }
            return 'bytes';
        }

        if ($wire === 'date') {
            if ($base !== 'date' && !isset(self::INTEGER_TYPES[$base])) {
                throw ProtocolException::schema('#[Date] применим к DateTimeInterface или int', $path);
            }
            return 'date';
        }

        if ($wire === 'float32') {
            if ($base !== 'float64') {
                throw ProtocolException::schema('#[Float32] применим только к float', $path);
            }
            return 'float32';
        }

        if (!isset(self::INTEGER_TYPES[$wire])) {
            throw ProtocolException::schema('неизвестный wire-тип ' . $wire, $path);
        }
        if (!isset(self::INTEGER_TYPES[$base])) {
            throw ProtocolException::schema('#' . $wire . ' применим только к int', $path);
        }
        return $wire;
    }

    private static function assertLiteralCompatible(
        mixed $literal,
        string $base,
        bool $optional,
        string $path,
    ): void {
        $ok = match (true) {
            $literal === null => $optional,
            is_bool($literal) => $base === 'bool',
            is_int($literal) => isset(self::INTEGER_TYPES[$base]),
            is_string($literal) => $base === 'string',
            is_float($literal) => $base === 'float64',
            default => false,
        };
        if (!$ok) {
            throw ProtocolException::schema('литерал несовместим с объявленным типом', $path);
        }
    }

    private static function assertNoCollection(mixed $collection, string $name, string $path): void
    {
        if ($collection !== null) {
            throw ProtocolException::schema('несколько коллекционных атрибутов на поле ' . $name, $path);
        }
    }

    private static function attributeInstance(\ReflectionAttribute $attribute, string $path): object
    {
        try {
            return $attribute->newInstance();
        } catch (\Throwable $error) {
            throw ProtocolException::schema(
                'некорректные аргументы атрибута ' . $attribute->getName() . ': ' . $error->getMessage(),
                $path,
            );
        }
    }

    /** @param string|array<mixed> $type */
    private static function isUnitType(string|array $type): bool
    {
        return $type === 'null' || (is_array($type) && $type[0] === 'literal');
    }
}
