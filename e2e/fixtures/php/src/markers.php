<?php
declare(strict_types=1);

namespace GenesysPhp;

function record(string $event): void
{
    $path = getenv('GENESYS_PHP_MARKERS');
    if ($path !== false) {
        file_put_contents($path, $event . "\n", FILE_APPEND | LOCK_EX);
    }
}

record('autoload');
