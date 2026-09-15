<?php
declare(strict_types=1);
return (static function (): array {
    $candidates = [dirname(__DIR__) . '/.env', __DIR__ . '/.env'];
    $path = null;
    foreach ($candidates as $candidate) {
        if (is_file($candidate) && is_readable($candidate)) {
            $path = $candidate;
            break;
        }
    }
    if ($path === null) {
        throw new RuntimeException('.env not found. Looked in: ' . implode(', ', $candidates));
    }

    // Minimal .env parser: KEY=VALUE, # comments, optional quotes, optional "export ".
    $values = [];
    foreach (file($path, FILE_IGNORE_NEW_LINES) as $index => $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        if (strncmp($line, 'export ', 7) === 0) {
            $line = ltrim(substr($line, 7));
        }
        $separator = strpos($line, '=');
        if ($separator === false) {
            throw new RuntimeException(sprintf('.env line %d is not in KEY=VALUE format.', $index + 1));
        }
        $key = trim(substr($line, 0, $separator));
        $value = trim(substr($line, $separator + 1));

        if ($value !== '' && ($value[0] === '"' || $value[0] === "'")) {
            $quote = $value[0];
            $end = strrpos($value, $quote);
            if ($end === 0) {
                throw new RuntimeException(sprintf('.env line %d has an unclosed quote.', $index + 1));
            }
            $value = substr($value, 1, $end - 1);
            if ($quote === '"') {
                $value = strtr($value, ['\\n' => "\n", '\\"' => '"', '\\\\' => '\\']);
            }
        } else {
            // Unquoted values may carry a trailing " # comment".
            $value = (string) preg_replace('/\s+#.*$/', '', $value);
        }
        $values[$key] = $value;
    }

    $missing = [];
    $env = static function (string $key, ?string $default = null) use ($values, &$missing): string {
        $server = getenv($key);
        if ($server !== false && $server !== '') {
            return $server;
        }
        if (isset($values[$key]) && $values[$key] !== '') {
            return $values[$key];
        }
        if ($default === null) {
            $missing[] = $key;
            return '';
        }
        return $default;
    };

    $config = [
        'db' => [
            'host' => $env('DB_HOST', 'localhost'),
            'port' => (int) $env('DB_PORT', '3306'),
            'name' => $env('DB_NAME'),
            'user' => $env('DB_USER'),
            'pass' => $env('DB_PASS'),
        ],
        'n8n' => [
            'br' => $env('N8N_WEBHOOK_BR'),
            'int' => $env('N8N_WEBHOOK_INT'),
            'pa' => $env('N8N_WEBHOOK_PA'),
            'mx' => $env('N8N_WEBHOOK_MX'),
        ],
    ];

    if ($missing !== []) {
        throw new RuntimeException('Missing values in .env: ' . implode(', ', $missing));
    }
    return $config;
})();