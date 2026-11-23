<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol\Internal;

use Ivlev\Silent\Protocol\Errors\ProtocolException;

/**
 * Кеш замыканий доступа к свойствам.
 *
 * Для public-свойств чтение/проверка идут напрямую, для readonly и
 * не-public — через замыкание, привязанное к scope объявляющего класса.
 * Reflection выполняется один раз при компиляции сообщения.
 */
final class PropertyAccess
{
    /**
     * @var array<string, array{
     *     get: \Closure(object): mixed,
     *     has: \Closure(object): bool,
     *     set: \Closure(object, mixed): void,
     * }>
     */
    private static array $cache = [];

    /**
     * @return array{
     *     get: \Closure(object): mixed,
     *     has: \Closure(object): bool,
     *     set: \Closure(object, mixed): void,
     * }
     */
    public static function accessors(\ReflectionProperty $property): array
    {
        $key = $property->getDeclaringClass()->getName() . '::' . $property->getName();
        return self::$cache[$key] ??= self::make($property);
    }

    /**
     * @return array{
     *     get: \Closure(object): mixed,
     *     has: \Closure(object): bool,
     *     set: \Closure(object, mixed): void,
     * }
     */
    private static function make(\ReflectionProperty $property): array
    {
        $name = $property->getName();
        $scope = $property->getDeclaringClass()->getName();

        if ($property->isPublic()) {
            $get = static fn (object $object): mixed => $object->{$name};
            $has = static fn (object $object): bool => isset($object->{$name});
            $set = $property->isReadOnly()
                ? self::boundSetter($name, $scope)
                : static function (object $object, mixed $value) use ($name): void {
                    $object->{$name} = $value;
                };
            return ['get' => $get, 'has' => $has, 'set' => $set];
        }

        $get = \Closure::bind(
            static fn (object $object): mixed => $object->{$name},
            null,
            $scope,
        );
        $has = \Closure::bind(
            static fn (object $object): bool => isset($object->{$name}),
            null,
            $scope,
        );

        if ($get === null || $has === null) {
            throw ProtocolException::schema(
                'не удалось получить доступ к свойству ' . $scope . '::' . $name,
            );
        }

        return ['get' => $get, 'has' => $has, 'set' => self::boundSetter($name, $scope)];
    }

    /** @return \Closure(object, mixed): void */
    private static function boundSetter(string $name, string $scope): \Closure
    {
        $setter = \Closure::bind(
            static function (object $object, mixed $value) use ($name): void {
                $object->{$name} = $value;
            },
            null,
            $scope,
        );

        if ($setter === null) {
            throw ProtocolException::schema(
                'не удалось записать свойство ' . $scope . '::' . $name,
            );
        }

        return $setter;
    }
}
