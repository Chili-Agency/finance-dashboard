<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
require __DIR__ . '/snapshots.php';
auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[attention-data] ' . $error->getMessage());
    attention_respond(500, ['meetings' => attention_empty(true, 'Server configuration error. Check the .env file.'), 'logins' => attention_empty(true, 'Server configuration error. Check the .env file.')]);
}

try {
    $snapshots = snapshot_read(auth_db(), ['ah_meetings', 'ah_aa']);
} catch (Throwable $error) {
    error_log('[attention-data] snapshots: ' . $error->getMessage());
    $message = 'Could not read the saved data (data_snapshots).';
    attention_respond(500, ['meetings' => attention_empty(true, $message), 'logins' => attention_empty(true, $message)]);
}

attention_respond(200, [
    'meetings' => attention_section($config, $snapshots, 'ah_meetings', 'N8N_WEBHOOK_AH_MEETINGS', static function (array $row): ?array {
        $client = trim((string) ($row['client'] ?? ''));
        if ($client === '') {
            return null;
        }
        return [
            'client' => $client,
            'service' => strtolower(trim((string) ($row['service'] ?? ''))),
            'region' => (string) ($row['region'] ?? ''),
            'listId' => (string) ($row['list_id'] ?? ''),
            'lastBiweekly' => attention_date($row['last_biweekly'] ?? null),
            'lastResults' => attention_date($row['last_results'] ?? null),
            'truncated' => ($row['truncated'] ?? false) === true,
            'computedAt' => isset($row['computed_at']) ? (string) $row['computed_at'] : null,
        ];
    }),
    'logins' => attention_section($config, $snapshots, 'ah_aa', 'N8N_WEBHOOK_AH_AA', static function (array $row): ?array {
        $client = trim((string) ($row['client'] ?? ''));
        if ($client === '') {
            return null;
        }
        return [
            'client' => $client,
            'url' => (string) ($row['url'] ?? ''),
            'campaignId' => (string) ($row['campaign_id'] ?? ''),
            'status' => strtolower(trim((string) ($row['status'] ?? ''))),
            'clientUsers' => is_numeric($row['client_users'] ?? null) ? (int) $row['client_users'] : 0,
            'activeUsers' => is_numeric($row['active_users'] ?? null) ? (int) $row['active_users'] : 0,
            'pendingUsers' => is_numeric($row['pending_users'] ?? null) ? (int) $row['pending_users'] : 0,
            'lastLogin' => attention_date($row['last_login'] ?? null),
            'computedAt' => isset($row['computed_at']) ? (string) $row['computed_at'] : null,
        ];
    }),
]);

function attention_date(mixed $value): ?string
{
    $text = trim((string) $value);
    return preg_match('/^\d{4}-\d{2}-\d{2}/', $text) === 1 ? substr($text, 0, 10) : null;
}

function attention_empty(bool $configured, ?string $error = null): array
{
    return ['configured' => $configured, 'rows' => [], 'errors' => $error === null ? [] : [$error], 'warnings' => [], 'fetchedAt' => null];
}

function attention_section(array $config, array $snapshots, string $source, string $envName, callable $map): array
{
    if (trim((string) ($config['n8n'][$source] ?? '')) === '') {
        return attention_empty(false, "Not connected: set {$envName} and PPC_API_KEY in the .env.");
    }
    $snapshot = $snapshots[$source] ?? null;
    if ($snapshot === null || $snapshot['body'] === null) {
        $reason = $snapshot !== null && $snapshot['error'] ? " The last attempt failed: {$snapshot['error']}" : '';
        return attention_empty(true, 'No saved data yet. Press Refresh to fetch it.' . $reason);
    }
    $warnings = [];
    if ($snapshot['error'] && $snapshot['errorAt'] && $snapshot['errorAt'] > (string) $snapshot['fetchedAt']) {
        $warnings[] = 'Last refresh failed, showing the previous data';
    }
    $rows = [];
    foreach (snapshot_decode_ppc((string) $snapshot['body']) ?? [] as $row) {
        if (!is_array($row)) {
            continue;
        }
        $mapped = $map($row);
        if ($mapped !== null) {
            $rows[] = $mapped;
        }
    }
    return ['configured' => true, 'rows' => $rows, 'errors' => [], 'warnings' => $warnings, 'fetchedAt' => $snapshot['fetchedAt']];
}

function attention_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
