<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
require __DIR__ . '/snapshots.php';
auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

/*
 * Metas de vendas por pessoa (Goals do HubSpot), lidas da última atualização gravada em data_snapshots
 * (fonte "goals", vinda do workflow "Chili Finance - Metas de vendas (HubSpot)"). Cada meta já vem ligada ao
 * owner do vendedor, o mesmo id que o deal e as atividades usam em sales.php. A conta por período fica no front
 * (assets/sales.js). Os valores são os da meta no HubSpot (moeda da conta, em USD).
 *
 * Resposta: { configured, goals[{id, groupId, ownerId, name, type, start, end, amount}], kinds, errors, warnings, fetchedAt }
 */

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[sales-goals] ' . $error->getMessage());
    goals_respond(500, ['configured' => true, 'goals' => [], 'errors' => ['Server configuration error. Check the .env file.']]);
}

if (trim((string) ($config['n8n']['goals'] ?? '')) === '') {
    goals_respond(200, ['configured' => false, 'goals' => [], 'errors' => ['Sales goals are not connected: set N8N_WEBHOOK_GOALS in the .env with the webhook of the n8n workflow.']]);
}

try {
    $snapshot = snapshot_read(auth_db(), ['goals'])['goals'] ?? null;
} catch (Throwable $error) {
    error_log('[sales-goals] snapshots: ' . $error->getMessage());
    goals_respond(500, ['configured' => true, 'goals' => [], 'errors' => ['Could not read the saved sales goals (data_snapshots).']]);
}

if ($snapshot === null || $snapshot['body'] === null) {
    $reason = $snapshot !== null && $snapshot['error'] ? " The last attempt failed: {$snapshot['error']}" : '';
    goals_respond(200, ['configured' => true, 'goals' => [], 'errors' => ['No saved goals yet. Press Refresh to fetch them from HubSpot.' . $reason]]);
}

$data = snapshot_decode_goals($snapshot['body']);
if ($data === null) {
    goals_respond(200, ['configured' => true, 'goals' => [], 'errors' => ['The saved goals are in an unexpected format. Press Refresh to fetch them again.']]);
}

$warnings = array_values(array_map('strval', (array) ($data['warnings'] ?? [])));
if ($snapshot['error'] && $snapshot['errorAt'] && $snapshot['errorAt'] > (string) $snapshot['fetchedAt']) {
    $warnings[] = 'Last HubSpot goals refresh failed, showing the previous data';
}

$day = static fn (mixed $value): ?string => is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}/', $value) === 1 ? substr($value, 0, 10) : null;

$goals = [];
foreach ($data['goals'] as $goal) {
    if (!is_array($goal) || !isset($goal['ownerId']) || !is_numeric($goal['amount'] ?? null)) {
        continue;
    }
    $start = $day($goal['start'] ?? null);
    $end = $day($goal['end'] ?? null);
    if ($start === null || $end === null) {
        continue;
    }
    $goals[] = [
        'id' => (string) ($goal['id'] ?? ''),
        'groupId' => isset($goal['groupId']) ? (string) $goal['groupId'] : null,
        'ownerId' => (string) $goal['ownerId'],
        'name' => (string) ($goal['name'] ?? ''),
        'type' => (string) ($goal['type'] ?? ''),
        'start' => $start,
        'end' => $end,
        'amount' => (float) $goal['amount'],
    ];
}

$kinds = [];
foreach ((array) ($data['kinds'] ?? []) as $kind) {
    if (is_array($kind)) {
        $kinds[] = ['type' => (string) ($kind['type'] ?? ''), 'name' => (string) ($kind['name'] ?? ''), 'count' => (int) ($kind['count'] ?? 0)];
    }
}

goals_respond(200, [
    'configured' => true,
    'goals' => $goals,
    'kinds' => $kinds,
    'errors' => [],
    'warnings' => $warnings,
    'fetchedAt' => $snapshot['fetchedAt'],
]);

function goals_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}