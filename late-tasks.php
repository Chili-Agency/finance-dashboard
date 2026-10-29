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
    error_log('[late-tasks] ' . $error->getMessage());
    late_respond(500, ['configured' => true, 'lists' => [], 'errors' => ['Server configuration error. Check the .env file.']]);
}

if (trim((string) ($config['n8n']['ah_late'] ?? '')) === '') {
    late_respond(200, [
        'configured' => false,
        'lists' => [],
        'errors' => ['Late tasks are not connected: set N8N_WEBHOOK_AH_LATE_TASKS and PPC_API_KEY in the .env.'],
    ]);
}

try {
    $snapshot = snapshot_read(auth_db(), ['ah_late'])['ah_late'] ?? null;
} catch (Throwable $error) {
    error_log('[late-tasks] snapshots: ' . $error->getMessage());
    late_respond(500, ['configured' => true, 'lists' => [], 'errors' => ['Could not read the saved late-task data (data_snapshots).']]);
}

if ($snapshot === null || $snapshot['body'] === null) {
    $reason = $snapshot !== null && $snapshot['error'] ? " The last attempt failed: {$snapshot['error']}" : '';
    late_respond(200, ['configured' => true, 'lists' => [], 'errors' => ['No saved late-task data yet. Press Refresh to fetch it.' . $reason]]);
}

$warnings = [];
if ($snapshot['error'] && $snapshot['errorAt'] && $snapshot['errorAt'] > (string) $snapshot['fetchedAt']) {
    $warnings[] = 'Last late-task refresh failed, showing the previous data';
}

$lists = [];
foreach (snapshot_decode_ppc((string) $snapshot['body']) ?? [] as $row) {
    $client = trim((string) ($row['client'] ?? ''));
    if ($client === '') {
        continue;
    }
    $owners = [];
    $decoded = is_string($row['owners_json'] ?? null) ? json_decode($row['owners_json'], true) : ($row['owners_json'] ?? null);
    if (is_array($decoded) && !array_is_list($decoded)) {
        foreach ($decoded as $name => $counts) {
            if (is_array($counts) && is_numeric($counts['due'] ?? null) && is_numeric($counts['late'] ?? null)) {
                $owners[(string) $name] = ['due' => (float) $counts['due'], 'late' => (float) $counts['late']];
            }
        }
    }
    $lists[] = [
        'client' => $client,
        'service' => strtolower(trim((string) ($row['service'] ?? ''))),
        'region' => (string) ($row['region'] ?? ''),
        'listId' => (string) ($row['list_id'] ?? ''),
        'dueTotal' => is_numeric($row['due_total'] ?? null) ? (float) $row['due_total'] : 0.0,
        'lateTotal' => is_numeric($row['late_total'] ?? null) ? (float) $row['late_total'] : 0.0,
        'truncated' => ($row['truncated'] ?? false) === true,
        'computedAt' => isset($row['computed_at']) ? (string) $row['computed_at'] : null,
        'owners' => (object) $owners,
    ];
}

late_respond(200, [
    'configured' => true,
    'lists' => $lists,
    'errors' => [],
    'warnings' => $warnings,
    'fetchedAt' => $snapshot['fetchedAt'],
]);

function late_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
