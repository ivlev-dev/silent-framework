<?php

declare(strict_types=1);

namespace Ivlev\Silent\Protocol;

/**
 * Нормализованная схема сообщения.
 *
 * Записи отсортированы по имени поля/oneof по возрастанию UTF-8 байт.
 * Тип — wire-имя (`bool`, `int32`, `string`, ...) либо кортеж одного из
 * видов: `['literal', value]`, `['enum', FQCN]`, `['class', FQCN]`,
 * `['array', type]`, `['tuple', list<type>]`, `['map', key, value]`,
 * `['set', type]`, `['record', type]`, `['optional', type]`.
 */
final class Schema
{
    /**
     * @param list<array{
     *     kind: 'field'|'oneof',
     *     name: string,
     *     ...
     * }> $entries
     */
    public function __construct(
        public readonly string $class,
        public readonly array $entries,
        public readonly int $optionalCount,
    ) {
    }

    /** Каноническое текстовое представление (для отладки и отпечатков). */
    public function canonical(): string
    {
        $out = '';
        foreach ($this->entries as $entry) {
            if ($entry['kind'] === 'oneof') {
                $out .= 'oneof|' . $entry['name'] . '|' . $entry['enum'];
                foreach ($entry['variants'] as $variant) {
                    $out .= '|' . $variant['value'] . ':' . $variant['field'] . ':'
                        . self::renderType($variant['type']);
                }
            } else {
                $out .= 'field|' . $entry['name'] . '|' . self::renderType($entry['type']) . '|'
                    . ($entry['optional'] ? '1' : '0');
            }
            $out .= "\n";
        }
        return $out;
    }

    /** @param string|array<mixed> $type */
    public static function renderType(string|array $type): string
    {
        if (is_string($type)) {
            return $type;
        }
        return match ($type[0]) {
            'literal' => 'literal(' . self::renderLiteral($type[1]) . ')',
            'enum' => 'enum(' . $type[1] . ')',
            'class' => 'class(' . $type[1] . ')',
            'array' => 'array(' . self::renderType($type[1]) . ')',
            'tuple' => 'tuple(' . implode(',', array_map(self::renderType(...), $type[1])) . ')',
            'map' => 'map(' . self::renderType($type[1]) . ',' . self::renderType($type[2]) . ')',
            'set' => 'set(' . self::renderType($type[1]) . ')',
            'record' => 'record(' . self::renderType($type[1]) . ')',
            'optional' => 'optional(' . self::renderType($type[1]) . ')',
            default => 'unknown',
        };
    }

    private static function renderLiteral(mixed $value): string
    {
        return match (true) {
            $value === null => 'null',
            is_bool($value) => $value ? 'true' : 'false',
            is_string($value) => '"' . $value . '"',
            default => (string) $value,
        };
    }
}
