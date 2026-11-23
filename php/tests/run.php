<?php

declare(strict_types=1);

/**
 * Минимальный assert-раннер без внешних зависимостей.
 *
 * Запуск: php php/tests/run.php
 */

$root = dirname(__DIR__);

spl_autoload_register(static function (string $class) use ($root): void {
    $prefix = 'Ivlev\\Silent\\Protocol\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $file = $root . '/src/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

$GLOBALS['__silent_tests'] = 0;
$GLOBALS['__silent_failures'] = 0;

function test(string $name, Closure $body): void
{
    $GLOBALS['__silent_tests'] += 1;
    try {
        $body();
        echo "ok   " . $name . "\n";
    } catch (Throwable $error) {
        $GLOBALS['__silent_failures'] += 1;
        echo "FAIL " . $name . "\n";
        echo '     ' . $error->getMessage() . "\n";
        $file = $error->getFile();
        if ($file !== '') {
            echo '     в ' . $file . ':' . $error->getLine() . "\n";
        }
    }
}

function assertSame(mixed $expected, mixed $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        throw new RuntimeException(
            ($message === '' ? 'значения не совпадают' : $message)
            . "\nожидалось: " . var_export($expected, true)
            . "\nполучено:  " . var_export($actual, true),
        );
    }
}

function assertTrue(bool $value, string $message = ''): void
{
    assertSame(true, $value, $message === '' ? 'ожидалось true' : $message);
}

function assertFalse(bool $value, string $message = ''): void
{
    assertSame(false, $value, $message === '' ? 'ожидалось false' : $message);
}

/** @param class-string<Throwable> $class */
function assertThrows(string $class, Closure $body, ?string $messagePart = null): Throwable
{
    try {
        $body();
    } catch (Throwable $error) {
        if (!$error instanceof $class) {
            throw new RuntimeException(
                'ожидалось исключение ' . $class . ', получено ' . $error::class
                . ': ' . $error->getMessage(),
            );
        }
        if ($messagePart !== null && !str_contains($error->getMessage(), $messagePart)) {
            throw new RuntimeException(
                'в сообщении нет "' . $messagePart . '": ' . $error->getMessage(),
            );
        }
        return $error;
    }
    throw new RuntimeException('ожидалось исключение ' . $class . ', но его нет');
}

function hexOf(string $bytes): string
{
    return bin2hex($bytes);
}

function bytesOf(string $hex): string
{
    $bytes = hex2bin($hex);
    if ($bytes === false) {
        throw new RuntimeException('некорректный hex: ' . $hex);
    }
    return $bytes;
}

$files = glob(__DIR__ . '/*_test.php') ?: [];
sort($files);
foreach ($files as $file) {
    require $file;
}

$tests = (int) $GLOBALS['__silent_tests'];
$failures = (int) $GLOBALS['__silent_failures'];

echo "\n" . ($failures === 0 ? 'OK' : 'FAIL') . ': ' . ($tests - $failures) . '/' . $tests . " тестов\n";
exit($failures === 0 ? 0 : 1);
