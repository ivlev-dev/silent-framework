<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol;

use Ivlev\Silent\Protocol\Errors\ProtocolException;
use Ivlev\Silent\Protocol\Internal\DecodeContext;
use Ivlev\Silent\Protocol\Internal\EncodeContext;
use Ivlev\Silent\Protocol\Internal\PropertyAccess;

/**
 * Generic-кодек по нормализованной схеме.
 *
 * Скомпилированные сообщения кешируются по классу: в горячем пути нет ни
 * рефлексии атрибутов, ни повторного построения схемы. Кодек поддерживает
 * ленивое разрешение вложенных классов (рекурсивные схемы).
 */
final class Codec
{
    private const INT32_MIN = -2147483648;

    private const INT32_MAX = 2147483647;

    private const UINT32_MAX = 4294967295;

    /** @var array<class-string, array<string, mixed>> */
    private static array $messages = [];

    public static function encode(object $value, Options $options): string
    {
        $class = $value::class;
        $message = self::message($class);
        $writer = new Writer($options->maxSize);
        $context = new EncodeContext($options->maxDepth, $options->maxSize);
        self::writeMessage($message, $writer, $value, $context, $message['label']);
        return $writer->finish();
    }

    public static function decode(string $class, string $bytes, Options $options): object
    {
        $class = ltrim($class, '\\');
        if (!class_exists($class)) {
            throw ProtocolException::schema('класс ' . $class . ' не найден', $class);
        }
        $message = self::message($class);
        $reader = new Reader($bytes, $options->maxSize);
        $context = new DecodeContext($options->maxDepth);
        $value = self::readMessage($message, $reader, $context, $message['label']);
        if (!$options->allowTrailing && $reader->remaining() > 0) {
            throw ProtocolException::trailing(
                'после сообщения осталось ' . $reader->remaining() . ' байт',
                $message['label'],
            );
        }
        return $value;
    }

    /** @return array<string, mixed> */
    public static function message(string $class): array
    {
        $class = ltrim($class, '\\');
        return self::$messages[$class] ??= self::compile(SchemaBuilder::build($class));
    }

    public static function clearCache(): void
    {
        self::$messages = [];
    }

    /** @return array<string, mixed> */
    private static function compile(Schema $schema): array
    {
        $entries = [];
        foreach ($schema->entries as $entry) {
            if ($entry['kind'] === 'oneof') {
                $entries[] = self::compileOneof($entry, $schema->class);
                continue;
            }

            $dateTarget = self::dateTarget($entry['property']);
            $accessors = PropertyAccess::accessors($entry['property']);
            $entries[] = [
                'kind' => 'field',
                'name' => $entry['name'],
                'optional' => $entry['optional'],
                'get' => $accessors['get'],
                'has' => $accessors['has'],
                'set' => $accessors['set'],
                'codec' => self::compileValue(
                    $entry['type'],
                    $schema->class . '.' . $entry['name'],
                    $dateTarget,
                ),
            ];
        }

        $reflection = new \ReflectionClass($schema->class);
        return [
            'class' => $schema->class,
            'label' => $reflection->getShortName(),
            'entries' => $entries,
            'optionalCount' => $schema->optionalCount,
            'new' => static fn (): object => $reflection->newInstanceWithoutConstructor(),
        ];
    }

    /**
     * @param array<string, mixed> $entry
     * @return array<string, mixed>
     */
    private static function compileOneof(array $entry, string $messageClass): array
    {
        $cases = self::enumCases($entry['enum'], $messageClass . '.' . $entry['name']);
        $variants = [];
        $byValue = [];

        foreach ($entry['variants'] as $variant) {
            $index = count($variants);
            $accessors = PropertyAccess::accessors($variant['property']);
            $variants[] = [
                'field' => $variant['field'],
                'value' => $variant['value'],
                'unit' => $variant['unit'],
                'get' => $accessors['get'],
                'has' => $accessors['has'],
                'set' => $accessors['set'],
                'codec' => self::compileValue(
                    $variant['type'],
                    $messageClass . '.' . $variant['field'],
                    self::dateTarget($variant['property']),
                ),
            ];
            $byValue[$variant['value']] = $index;
        }

        $discriminatorAccessors = PropertyAccess::accessors($entry['property']);

        return [
            'kind' => 'oneof',
            'name' => $entry['name'],
            'enum' => $entry['enum'],
            'get' => $discriminatorAccessors['get'],
            'has' => $discriminatorAccessors['has'],
            'set' => $discriminatorAccessors['set'],
            'variants' => $variants,
            'byValue' => $byValue,
            'cases' => $cases,
        ];
    }

    private static function readMessage(
        array $message,
        Reader $reader,
        DecodeContext $context,
        string $path,
    ): object {
        $context->enter($path);
        try {
            /** @var object $object */
            $object = ($message['new'])();
            $bits = $message['optionalCount'] > 0
                ? $reader->bitmap($message['optionalCount'], $path)
                : [];
            $optionalIndex = 0;

            foreach ($message['entries'] as $entry) {
                if ($entry['kind'] === 'oneof') {
                    self::readOneof($entry, $reader, $object, $context, $path);
                    continue;
                }

                $fieldPath = $path . '.' . $entry['name'];
                if ($entry['optional']) {
                    $present = $bits[$optionalIndex] ?? false;
                    $optionalIndex += 1;
                    if (!$present) {
                        ($entry['set'])($object, null);
                        continue;
                    }
                }

                $value = ($entry['codec']['decode'])($reader, $context, $fieldPath);
                ($entry['set'])($object, $value);
            }

            return $object;
        } finally {
            $context->leave();
        }
    }

    private static function writeMessage(
        array $message,
        Writer $writer,
        object $value,
        EncodeContext $context,
        string $path,
    ): void {
        $context->enterObject($value, $path);
        try {
            if ($message['optionalCount'] > 0) {
                $bits = [];
                foreach ($message['entries'] as $entry) {
                    if ($entry['kind'] !== 'field' || !$entry['optional']) {
                        continue;
                    }
                    $bits[] = ($entry['has'])($value);
                }
                $writer->bitmap($bits);
            }

            foreach ($message['entries'] as $entry) {
                if ($entry['kind'] === 'oneof') {
                    self::writeOneof($entry, $writer, $value, $context, $path);
                    continue;
                }

                $fieldPath = $path . '.' . $entry['name'];
                $present = ($entry['has'])($value);
                $current = $present ? ($entry['get'])($value) : null;
                if ($entry['optional']) {
                    if (!$present) {
                        continue;
                    }
                } elseif (!$present) {
                    throw ProtocolException::value(
                        'обязательное поле ' . $entry['name'] . ' не инициализировано',
                        $fieldPath,
                    );
                }

                ($entry['codec']['encode'])($writer, $current, $context, $fieldPath);
            }
        } finally {
            $context->leaveObject($value);
        }
    }

    private static function writeOneof(
        array $entry,
        Writer $writer,
        object $value,
        EncodeContext $context,
        string $path,
    ): void {
        $discriminatorPath = $path . '.' . $entry['name'];
        if (!($entry['has'])($value)) {
            throw ProtocolException::value(
                'дискриминатор ' . $entry['name'] . ' не инициализирован',
                $discriminatorPath,
            );
        }
        $discriminator = ($entry['get'])($value);
        $enum = $entry['enum'];

        if (!$discriminator instanceof $enum) {
            throw ProtocolException::oneof(
                'дискриминатор ' . $entry['name'] . ' должен быть ' . $enum,
                $discriminatorPath,
            );
        }

        $raw = $discriminator->value;
        $index = $entry['byValue'][$raw] ?? null;
        if ($index === null) {
            throw ProtocolException::unknownEnum(
                'неизвестное значение oneof ' . $raw,
                $discriminatorPath,
            );
        }

        foreach ($entry['variants'] as $candidateIndex => $candidate) {
            if ($candidateIndex === $index) {
                continue;
            }
            if (($candidate['has'])($value)) {
                throw ProtocolException::oneof(
                    'установлено более одного варианта oneof ' . $entry['name'],
                    $path . '.' . $candidate['field'],
                );
            }
        }

        $variant = $entry['variants'][$index];
        if ($variant['unit']) {
            $payload = ($variant['has'])($value) ? ($variant['get'])($value) : null;
            // Литерал пишет 0 байт, но проверяет значение.
            ($variant['codec']['encode'])($writer, $payload, $context, $path . '.' . $variant['field']);
            $writer->varint($raw);
            return;
        }

        $payload = ($variant['has'])($value) ? ($variant['get'])($value) : null;
        if ($payload === null) {
            throw ProtocolException::oneof(
                'вариант ' . $variant['field'] . ' не имеет значения',
                $path . '.' . $variant['field'],
            );
        }

        $writer->varint($raw);
        ($variant['codec']['encode'])($writer, $payload, $context, $path . '.' . $variant['field']);
    }

    private static function readOneof(
        array $entry,
        Reader $reader,
        object $object,
        DecodeContext $context,
        string $path,
    ): void {
        $raw = $reader->uint32($path . '.' . $entry['name']);
        $index = $entry['byValue'][$raw] ?? null;
        if ($index === null) {
            throw ProtocolException::unknownEnum(
                'неизвестное значение oneof ' . $raw,
                $path . '.' . $entry['name'],
            );
        }

        foreach ($entry['variants'] as $candidateIndex => $candidate) {
            if ($candidateIndex !== $index) {
                ($candidate['set'])($object, null);
                continue;
            }

            $payload = ($candidate['codec']['decode'])(
                $reader,
                $context,
                $path . '.' . $candidate['field'],
            );
            ($candidate['set'])($object, $payload);
        }

        ($entry['set'])($object, $entry['cases'][$raw]);
    }

    // ------------------------------------------------------------------
    // Значения
    // ------------------------------------------------------------------

    /**
     * @param string|array<mixed> $type
     * @return array{encode: \Closure, decode: \Closure}
     */
    private static function compileValue(
        string|array $type,
        string $path,
        ?string $dateTarget = null,
    ): array {
        if (is_string($type)) {
            return match ($type) {
                'bool' => self::boolCodec(),
                'int32' => self::int32Codec(),
                'uint32' => self::uint32Codec(),
                'int64' => self::int64Codec(),
                'uint64' => self::uint64Codec(),
                'float32' => self::float32Codec(),
                'float64' => self::float64Codec(),
                'fixed32' => self::fixed32Codec(),
                'fixed64' => self::fixed64Codec(),
                'string' => self::stringCodec(),
                'bytes' => self::bytesCodec(),
                'date' => self::dateCodec($dateTarget),
                'null' => self::literalCodec(null),
                default => throw ProtocolException::schema('неизвестный тип ' . $type, $path),
            };
        }

        return match ($type[0]) {
            'literal' => self::literalCodec($type[1]),
            'enum' => self::enumCodec($type[1], $path),
            'class' => self::classCodec($type[1], $path),
            'array' => self::arrayCodec($type[1], $path),
            'tuple' => self::tupleCodec($type[1], $path),
            'map' => self::mapCodec($type[1], $type[2], $path),
            'set' => self::setCodec($type[1], $path),
            'record' => self::mapCodec('string', $type[1], $path),
            'optional' => self::compileValue($type[1], $path, $dateTarget),
            default => throw ProtocolException::schema('неизвестное описание типа', $path),
        };
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function boolCodec(): array
    {
        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path): void {
                if (!is_bool($value)) {
                    throw ProtocolException::value('ожидался bool', $path);
                }
                $writer->bool($value);
            },
            'decode' => static fn (Reader $reader, DecodeContext $context, string $path): bool => $reader->bool($path),
        ];
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function int32Codec(): array
    {
        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path): void {
                self::requireInt($value, self::INT32_MIN, self::INT32_MAX, $path);
                $writer->zigzag32($value);
            },
            'decode' => static fn (Reader $reader, DecodeContext $context, string $path): int => $reader->zigzag32($path),
        ];
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function uint32Codec(): array
    {
        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path): void {
                self::requireInt($value, 0, self::UINT32_MAX, $path);
                $writer->varint($value);
            },
            'decode' => static fn (Reader $reader, DecodeContext $context, string $path): int => $reader->uint32($path),
        ];
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function int64Codec(): array
    {
        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path): void {
                self::requireInt($value, PHP_INT_MIN, PHP_INT_MAX, $path);
                $writer->zigzag($value);
            },
            'decode' => static fn (Reader $reader, DecodeContext $context, string $path): int => $reader->zigzag64($path),
        ];
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function uint64Codec(): array
    {
        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path): void {
                self::requireInt($value, 0, PHP_INT_MAX, $path);
                $writer->varint($value);
            },
            'decode' => static fn (Reader $reader, DecodeContext $context, string $path): int => $reader->uint64($path),
        ];
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function float32Codec(): array
    {
        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path): void {
                $writer->float32(self::requireFloat($value, $path));
            },
            'decode' => static fn (Reader $reader, DecodeContext $context, string $path): float => $reader->float32($path),
        ];
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function float64Codec(): array
    {
        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path): void {
                $writer->float64(self::requireFloat($value, $path));
            },
            'decode' => static fn (Reader $reader, DecodeContext $context, string $path): float => $reader->float64($path),
        ];
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function fixed32Codec(): array
    {
        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path): void {
                self::requireInt($value, 0, self::UINT32_MAX, $path);
                $writer->fixed32($value);
            },
            'decode' => static fn (Reader $reader, DecodeContext $context, string $path): int => $reader->fixed32($path),
        ];
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function fixed64Codec(): array
    {
        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path): void {
                self::requireInt($value, 0, PHP_INT_MAX, $path);
                $writer->fixed64($value);
            },
            'decode' => static fn (Reader $reader, DecodeContext $context, string $path): int => $reader->fixed64($path),
        ];
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function stringCodec(): array
    {
        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path): void {
                if (!is_string($value)) {
                    throw ProtocolException::value('ожидалась строка', $path);
                }
                $writer->string($value);
            },
            'decode' => static fn (Reader $reader, DecodeContext $context, string $path): string => $reader->string($path),
        ];
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function bytesCodec(): array
    {
        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path): void {
                if (!is_string($value)) {
                    throw ProtocolException::value('ожидались bytes (string)', $path);
                }
                $writer->bytes($value);
            },
            'decode' => static fn (Reader $reader, DecodeContext $context, string $path): string => $reader->bytes($path),
        ];
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function literalCodec(mixed $literal): array
    {
        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path) use ($literal): void {
                if ($value !== $literal) {
                    throw ProtocolException::value(
                        'ожидался литерал ' . self::dumpLiteral($literal),
                        $path,
                    );
                }
            },
            'decode' => static fn (Reader $reader, DecodeContext $context, string $path): mixed => $literal,
        ];
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function enumCodec(string $enum, string $path): array
    {
        $cases = self::enumCases($enum, $path);

        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path) use ($enum, $cases): void {
                if (!$value instanceof $enum) {
                    throw ProtocolException::value('ожидалось значение enum ' . $enum, $path);
                }
                $raw = $value->value;
                if (!isset($cases[$raw])) {
                    throw ProtocolException::unknownEnum('неизвестное значение enum ' . $raw, $path);
                }
                $writer->varint($raw);
            },
            'decode' => static function (Reader $reader, DecodeContext $context, string $path) use ($cases): \BackedEnum {
                $raw = $reader->uint32($path);
                if (!isset($cases[$raw])) {
                    throw ProtocolException::unknownEnum('неизвестное значение enum ' . $raw, $path);
                }
                return $cases[$raw];
            },
        ];
    }

    /**
     * @return array<int, \BackedEnum>
     */
    private static function enumCases(string $enum, string $path): array
    {
        if (!enum_exists($enum)) {
            throw ProtocolException::schema('enum ' . $enum . ' не найден', $path);
        }

        $reflection = new \ReflectionEnum($enum);
        if (!$reflection->isBacked()) {
            throw ProtocolException::schema('enum ' . $enum . ' должен быть backed', $path);
        }
        $backing = $reflection->getBackingType();
        if ($backing === null || $backing->getName() !== 'int') {
            throw ProtocolException::schema('поддерживаются только int-backed enum', $path);
        }

        $cases = [];
        foreach ($enum::cases() as $case) {
            $raw = $case->value;
            if (!is_int($raw) || $raw < 0 || $raw > 0x7FFFFFFF) {
                throw ProtocolException::schema('значение enum вне uint32', $path);
            }
            if (isset($cases[$raw])) {
                throw ProtocolException::schema('дубликат значения enum ' . $raw, $path);
            }
            $cases[$raw] = $case;
        }
        if ($cases === []) {
            throw ProtocolException::schema('enum ' . $enum . ' не содержит значений', $path);
        }

        return $cases;
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function classCodec(string $class, string $path): array
    {
        if (!class_exists($class)) {
            throw ProtocolException::schema('класс ' . $class . ' не найден', $path);
        }

        /** @var array<string, mixed>|null $message */
        $message = null;
        $resolve = static function () use (&$message, $class): array {
            return $message ??= self::message($class);
        };

        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path) use ($resolve, $class): void {
                if (!$value instanceof $class) {
                    throw ProtocolException::value('ожидался объект класса ' . $class, $path);
                }
                self::writeMessage($resolve(), $writer, $value, $context, $path);
            },
            'decode' => static function (Reader $reader, DecodeContext $context, string $path) use ($resolve): object {
                return self::readMessage($resolve(), $reader, $context, $path);
            },
        ];
    }

    /** @return array{encode: \Closure, decode: \Closure} */
    private static function dateCodec(?string $targetClass): array
    {
        $asInt = $targetClass !== null && !self::isDateClass($targetClass);

        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path) use ($asInt): void {
                if ($asInt) {
                    if (!is_int($value)) {
                        throw ProtocolException::value('ожидалось целое число epoch ms', $path);
                    }
                    $writer->zigzag($value);
                    return;
                }
                if (!$value instanceof \DateTimeInterface) {
                    throw ProtocolException::value('ожидался DateTimeInterface', $path);
                }
                $writer->zigzag(self::epochMillis($value, $path));
            },
            'decode' => static function (Reader $reader, DecodeContext $context, string $path) use ($asInt, $targetClass): mixed {
                $millis = $reader->zigzag64($path);
                if ($asInt) {
                    return $millis;
                }
                return self::dateFromEpochMillis($millis, $targetClass, $path);
            },
        ];
    }

    // ------------------------------------------------------------------
    // Коллекции
    // ------------------------------------------------------------------

    /**
     * @param string|array<mixed> $element
     * @return array{encode: \Closure, decode: \Closure}
     */
    private static function arrayCodec(string|array $element, string $path): array
    {
        $optional = is_array($element) && $element[0] === 'optional';
        $inner = $optional ? $element[1] : $element;
        $codec = self::compileValue($inner, $path . '[]');

        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path) use ($codec, $optional): void {
                if (!is_array($value)) {
                    throw ProtocolException::value('ожидался массив', $path);
                }
                $items = array_values($value);
                $context->enterValue($path);
                try {
                    $writer->varint(count($items));
                    if ($optional) {
                        $bits = [];
                        foreach ($items as $item) {
                            $bits[] = $item !== null;
                        }
                        $writer->bitmap($bits);
                    }
                    foreach ($items as $index => $item) {
                        if ($optional && $item === null) {
                            continue;
                        }
                        ($codec['encode'])($writer, $item, $context, $path . '[' . $index . ']');
                    }
                } finally {
                    $context->leaveValue();
                }
            },
            'decode' => static function (Reader $reader, DecodeContext $context, string $path) use ($codec, $optional): array {
                $context->enter($path);
                try {
                    $count = $reader->readLength($path);
                    $bits = $optional ? $reader->bitmap($count, $path) : [];
                    $items = [];
                    for ($index = 0; $index < $count; $index += 1) {
                        if ($optional && !($bits[$index] ?? false)) {
                            $items[] = null;
                            continue;
                        }
                        $items[] = ($codec['decode'])($reader, $context, $path . '[' . $index . ']');
                    }
                    return $items;
                } finally {
                    $context->leave();
                }
            },
        ];
    }

    /**
     * @param list<string|array<mixed>> $types
     * @return array{encode: \Closure, decode: \Closure}
     */
    private static function tupleCodec(array $types, string $path): array
    {
        $slots = [];
        $optionalCount = 0;
        foreach ($types as $index => $type) {
            $optional = is_array($type) && $type[0] === 'optional';
            $inner = $optional ? $type[1] : $type;
            if ($optional) {
                $optionalCount += 1;
            }
            $slots[] = [
                'optional' => $optional,
                'codec' => self::compileValue($inner, $path . '[' . $index . ']'),
            ];
        }

        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path) use ($slots, $optionalCount): void {
                if (!is_array($value)) {
                    throw ProtocolException::value('ожидался кортеж (array)', $path);
                }
                $items = array_values($value);
                if (count($items) !== count($slots)) {
                    throw ProtocolException::value(
                        'кортеж должен содержать ' . count($slots) . ' элементов',
                        $path,
                    );
                }
                $context->enterValue($path);
                try {
                    if ($optionalCount > 0) {
                        $bits = [];
                        foreach ($slots as $index => $slot) {
                            if ($slot['optional']) {
                                $bits[] = ($items[$index] ?? null) !== null;
                            }
                        }
                        $writer->bitmap($bits);
                    }
                    foreach ($slots as $index => $slot) {
                        $item = $items[$index] ?? null;
                        if ($slot['optional'] && $item === null) {
                            continue;
                        }
                        if ($item === null) {
                            throw ProtocolException::value('элемент кортежа не задан', $path . '[' . $index . ']');
                        }
                        ($slot['codec']['encode'])($writer, $item, $context, $path . '[' . $index . ']');
                    }
                } finally {
                    $context->leaveValue();
                }
            },
            'decode' => static function (Reader $reader, DecodeContext $context, string $path) use ($slots, $optionalCount): array {
                $context->enter($path);
                try {
                    $bits = $optionalCount > 0 ? $reader->bitmap($optionalCount, $path) : [];
                    $bitIndex = 0;
                    $items = [];
                    foreach ($slots as $index => $slot) {
                        if ($slot['optional']) {
                            $present = $bits[$bitIndex] ?? false;
                            $bitIndex += 1;
                            if (!$present) {
                                $items[] = null;
                                continue;
                            }
                        }
                        $items[] = ($slot['codec']['decode'])($reader, $context, $path . '[' . $index . ']');
                    }
                    return $items;
                } finally {
                    $context->leave();
                }
            },
        ];
    }

    /**
     * @param string|array<mixed> $keyType
     * @param string|array<mixed> $valueType
     * @return array{encode: \Closure, decode: \Closure}
     */
    private static function mapCodec(string|array $keyType, string|array $valueType, string $path): array
    {
        $key = self::compileKey($keyType, $path . '.key');
        $optional = is_array($valueType) && $valueType[0] === 'optional';
        $inner = $optional ? $valueType[1] : $valueType;
        $value = self::compileValue($inner, $path . '.value');

        return [
            'encode' => static function (Writer $writer, mixed $current, EncodeContext $context, string $path) use ($key, $value, $optional): void {
                if (!is_array($current)) {
                    throw ProtocolException::value('ожидалась map (array)', $path);
                }
                $entries = [];
                foreach ($current as $rawKey => $entryValue) {
                    $entries[] = [
                        'key' => ($key['fromArrayKey'])($rawKey),
                        'value' => $entryValue,
                    ];
                }
                $context->enterValue($path);
                try {
                    usort(
                        $entries,
                        static fn (array $a, array $b): int => ($key['compare'])($a['key'], $b['key']),
                    );
                    $writer->varint(count($entries));
                    if ($optional) {
                        $bits = [];
                        foreach ($entries as $entry) {
                            $bits[] = $entry['value'] !== null;
                        }
                        $writer->bitmap($bits);
                    }
                    foreach ($entries as $index => $entry) {
                        ($key['codec']['encode'])(
                            $writer,
                            $entry['key'],
                            $context,
                            $path . '.keys[' . $index . ']',
                        );
                        if ($optional && $entry['value'] === null) {
                            continue;
                        }
                        ($value['encode'])(
                            $writer,
                            $entry['value'],
                            $context,
                            $path . '.values[' . $index . ']',
                        );
                    }
                } finally {
                    $context->leaveValue();
                }
            },
            'decode' => static function (Reader $reader, DecodeContext $context, string $path) use ($key, $value, $optional): array {
                $context->enter($path);
                try {
                    $count = $reader->readLength($path);
                    $bits = $optional ? $reader->bitmap($count, $path) : [];
                    $result = [];
                    for ($index = 0; $index < $count; $index += 1) {
                        $decodedKey = ($key['codec']['decode'])(
                            $reader,
                            $context,
                            $path . '.keys[' . $index . ']',
                        );
                        $decodedValue = $optional && !($bits[$index] ?? false)
                            ? null
                            : ($value['decode'])($reader, $context, $path . '.values[' . $index . ']');
                        $result[($key['toArrayKey'])($decodedKey)] = $decodedValue;
                    }
                    return $result;
                } finally {
                    $context->leave();
                }
            },
        ];
    }

    /**
     * @param string|array<mixed> $element
     * @return array{encode: \Closure, decode: \Closure}
     */
    private static function setCodec(string|array $element, string $path): array
    {
        if (is_array($element) && $element[0] === 'optional') {
            throw ProtocolException::schema('optional-элементы set не поддерживаются', $path);
        }

        $codec = self::compileValue($element, $path . '[]');
        $compare = self::setComparator($element);

        return [
            'encode' => static function (Writer $writer, mixed $value, EncodeContext $context, string $path) use ($codec, $compare): void {
                if (!is_array($value)) {
                    throw ProtocolException::value('ожидался массив для set', $path);
                }
                $items = array_values($value);
                $context->enterValue($path);
                try {
                    if ($compare !== null) {
                        usort($items, $compare);
                        $unique = [];
                        foreach ($items as $item) {
                            $last = $unique === [] ? null : $unique[count($unique) - 1];
                            if ($unique !== [] && $compare($last, $item) === 0) {
                                continue;
                            }
                            $unique[] = $item;
                        }
                        $writer->varint(count($unique));
                        foreach ($unique as $index => $item) {
                            ($codec['encode'])($writer, $item, $context, $path . '[' . $index . ']');
                        }
                        return;
                    }

                    $encoded = [];
                    foreach ($items as $item) {
                        $buffer = new Writer($context->maxSize);
                        ($codec['encode'])($buffer, $item, $context, $path);
                        $encoded[] = $buffer->finish();
                    }
                    usort($encoded, static fn (string $a, string $b): int => strcmp($a, $b));
                    $unique = [];
                    foreach ($encoded as $bytes) {
                        if ($unique !== [] && $unique[count($unique) - 1] === $bytes) {
                            continue;
                        }
                        $unique[] = $bytes;
                    }
                    $writer->varint(count($unique));
                    foreach ($unique as $bytes) {
                        $writer->raw($bytes);
                    }
                } finally {
                    $context->leaveValue();
                }
            },
            'decode' => static function (Reader $reader, DecodeContext $context, string $path) use ($codec): array {
                $context->enter($path);
                try {
                    $count = $reader->readLength($path);
                    $items = [];
                    for ($index = 0; $index < $count; $index += 1) {
                        $items[] = ($codec['decode'])($reader, $context, $path . '[' . $index . ']');
                    }
                    return $items;
                } finally {
                    $context->leave();
                }
            },
        ];
    }

    /**
     * @param string|array<mixed> $type
     * @return array{
     *     codec: array{encode: \Closure, decode: \Closure},
     *     compare: \Closure,
     *     fromArrayKey: \Closure,
     *     toArrayKey: \Closure,
     * }
     */
    private static function compileKey(string|array $type, string $path): array
    {
        if (is_string($type)) {
            return match ($type) {
                'string' => [
                    'codec' => self::stringCodec(),
                    'compare' => static fn (mixed $a, mixed $b): int => strcmp((string) $a, (string) $b),
                    'fromArrayKey' => static fn (int|string $key): string => (string) $key,
                    'toArrayKey' => static fn (mixed $key): string => (string) $key,
                ],
                'bool' => [
                    'codec' => self::boolCodec(),
                    'compare' => static fn (mixed $a, mixed $b): int => (int) (bool) $a <=> (int) (bool) $b,
                    'fromArrayKey' => static fn (int|string $key): bool => (bool) $key,
                    'toArrayKey' => static fn (mixed $key): int => $key ? 1 : 0,
                ],
                'int32' => self::integerKey(self::int32Codec()),
                'uint32' => self::integerKey(self::uint32Codec()),
                'int64' => self::integerKey(self::int64Codec()),
                'uint64' => self::integerKey(self::uint64Codec()),
                'fixed32' => self::integerKey(self::fixed32Codec()),
                'fixed64' => self::integerKey(self::fixed64Codec()),
                default => throw ProtocolException::schema('недопустимый тип ключа map: ' . $type, $path),
            };
        }

        if ($type[0] === 'enum') {
            $cases = self::enumCases($type[1], $path);
            return [
                'codec' => self::enumCodec($type[1], $path),
                'compare' => static fn (mixed $a, mixed $b): int => $a->value <=> $b->value,
                'fromArrayKey' => static function (int|string $key) use ($cases, $path): \BackedEnum {
                    $raw = is_int($key) ? $key : (preg_match('/^-?\d+$/', $key) === 1 ? (int) $key : null);
                    if ($raw === null || !isset($cases[$raw])) {
                        throw ProtocolException::value('неизвестный ключ enum ' . (string) $key, $path);
                    }
                    return $cases[$raw];
                },
                'toArrayKey' => static fn (mixed $key): int => $key->value,
            ];
        }

        throw ProtocolException::schema('ключ map должен быть string, целым, bool или enum', $path);
    }

    /**
     * @param array{encode: \Closure, decode: \Closure} $codec
     * @return array{
     *     codec: array{encode: \Closure, decode: \Closure},
     *     compare: \Closure,
     *     fromArrayKey: \Closure,
     *     toArrayKey: \Closure,
     * }
     */
    private static function integerKey(array $codec): array
    {
        return [
            'codec' => $codec,
            'compare' => static fn (mixed $a, mixed $b): int => $a <=> $b,
            'fromArrayKey' => static fn (int|string $key): int => (int) $key,
            'toArrayKey' => static fn (mixed $key): int => (int) $key,
        ];
    }

    /**
     * @param string|array<mixed> $type
     * @return \Closure|null
     */
    private static function setComparator(string|array $type): ?\Closure
    {
        if (is_string($type)) {
            return match ($type) {
                'string' => static fn (mixed $a, mixed $b): int => strcmp((string) $a, (string) $b),
                'bool' => static fn (mixed $a, mixed $b): int => (int) (bool) $a <=> (int) (bool) $b,
                'int32', 'uint32', 'int64', 'uint64', 'fixed32', 'fixed64',
                'float32', 'float64' => static fn (mixed $a, mixed $b): int => $a <=> $b,
                'date' => static function (mixed $a, mixed $b): int {
                    $left = $a instanceof \DateTimeInterface ? self::epochMillis($a, '') : 0;
                    $right = $b instanceof \DateTimeInterface ? self::epochMillis($b, '') : 0;
                    return $left <=> $right;
                },
                default => null,
            };
        }

        if ($type[0] === 'enum') {
            return static fn (mixed $a, mixed $b): int => $a->value <=> $b->value;
        }

        return null;
    }

    // ------------------------------------------------------------------
    // Хелперы
    // ------------------------------------------------------------------

    private static function requireInt(mixed $value, int $min, int $max, string $path): int
    {
        if (!is_int($value)) {
            throw ProtocolException::value('ожидалось целое число', $path);
        }
        if ($value < $min || $value > $max) {
            throw ProtocolException::range('значение ' . $value . ' вне диапазона', $path);
        }
        return $value;
    }

    private static function requireFloat(mixed $value, string $path): float
    {
        if (!is_float($value) && !is_int($value)) {
            throw ProtocolException::value('ожидалось число', $path);
        }
        return (float) $value;
    }

    private static function dumpLiteral(mixed $value): string
    {
        return match (true) {
            $value === null => 'null',
            is_bool($value) => $value ? 'true' : 'false',
            is_string($value) => '"' . $value . '"',
            default => (string) $value,
        };
    }

    private static function isDateClass(string $class): bool
    {
        return $class === \DateTimeInterface::class
            || is_subclass_of($class, \DateTimeInterface::class);
    }

    private static function epochMillis(\DateTimeInterface $value, string $path): int
    {
        $seconds = (int) $value->format('U');
        $millis = (int) $value->format('v');
        $result = $seconds * 1000 + $millis;
        if (!is_int($result)) {
            throw ProtocolException::range('дата не представима целыми миллисекундами', $path);
        }
        return $result;
    }

    private static function dateFromEpochMillis(
        int $millis,
        ?string $targetClass,
        string $path,
    ): \DateTimeImmutable|\DateTime {
        $seconds = intdiv($millis, 1000);
        $remainder = $millis % 1000;
        if ($remainder < 0) {
            $seconds -= 1;
            $remainder += 1000;
        }

        $date = \DateTimeImmutable::createFromFormat(
            'U.u',
            sprintf('%d.%06d', $seconds, $remainder * 1000),
            new \DateTimeZone('UTC'),
        );
        if ($date === false) {
            throw ProtocolException::range('epoch ms вне диапазона DateTime', $path);
        }

        if ($targetClass !== null
            && is_a($targetClass, \DateTime::class, true)
            && !is_a($targetClass, \DateTimeImmutable::class, true)
        ) {
            return \DateTime::createFromImmutable($date);
        }

        return $date;
    }

    private static function dateTarget(\ReflectionProperty $property): ?string
    {
        $type = $property->getType();
        if ($type instanceof \ReflectionNamedType) {
            return $type->getName();
        }
        return null;
    }
}
