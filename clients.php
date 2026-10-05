<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
require __DIR__ . '/snapshots.php';
auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

/*
 * Empresas e respostas de NPS do HubSpot, lidas da última atualização gravada em data_snapshots (fonte "clients",
 * vinda do workflow "Chili Finance - Clientes (HubSpot)"). A página Client view liga cada empresa ao cliente do Xero
 * pelo nome normalizado (assets/client-view.js); aqui só se limpa e se entrega o que o front usa.
 *
 * Resposta: { configured, companies[{id, name, domain}], nps[{id, companyId, score, at, type, survey, comment}],
 *             counts, errors, warnings, fetchedAt }
 */

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[clients] ' . $error->getMessage());
    clients_respond(500, ['configured' => true, 'companies' => [], 'nps' => [], 'errors' => ['Server configuration error. Check the .env file.']]);
}

if (trim((string) ($config['n8n']['clients'] ?? '')) === '') {
    clients_respond(200, [
        'configured' => false,
        'companies' => [],
        'nps' => [],
        'errors' => ['NPS is not connected: set N8N_WEBHOOK_CLIENTS in the .env with the webhook of the n8n workflow.'],
    ]);
}

try {
    $snapshot = snapshot_read(auth_db(), ['clients'])['clients'] ?? null;
} catch (Throwable $error) {
    error_log('[clients] snapshots: ' . $error->getMessage());
    clients_respond(500, ['configured' => true, 'companies' => [], 'nps' => [], 'errors' => ['Could not read the saved client data (data_snapshots).']]);
}

if ($snapshot === null || $snapshot['body'] === null) {
    $reason = $snapshot !== null && $snapshot['error'] ? " The last attempt failed: {$snapshot['error']}" : '';
    clients_respond(200, ['configured' => true, 'companies' => [], 'nps' => [], 'errors' => ['No saved HubSpot data yet. Press Refresh to fetch it.' . $reason]]);
}

$data = snapshot_decode_clients($snapshot['body']);
if ($data === null) {
    clients_respond(200, ['configured' => true, 'companies' => [], 'nps' => [], 'errors' => ['The saved client data is in an unexpected format. Press Refresh to fetch it again.']]);
}

$warnings = array_values(array_map('strval', (array) ($data['warnings'] ?? [])));
if ($snapshot['error'] && $snapshot['errorAt'] && $snapshot['errorAt'] > (string) $snapshot['fetchedAt']) {
    $warnings[] = 'Last HubSpot refresh failed, showing the previous data';
}

$companies = [];
foreach ($data['companies'] as $company) {
    if (!is_array($company) || !isset($company['id'])) {
        continue;
    }
    $companies[] = [
        'id' => (string) $company['id'],
        'name' => isset($company['name']) ? trim((string) $company['name']) : '',
        'domain' => isset($company['domain']) && $company['domain'] !== '' ? (string) $company['domain'] : null,
    ];
}

$nps = [];
foreach ($data['nps'] as $row) {
    if (!is_array($row) || !isset($row['companyId'])) {
        continue;
    }
    $at = isset($row['at']) && preg_match('/^\d{4}-\d{2}-\d{2}/', (string) $row['at']) === 1 ? substr((string) $row['at'], 0, 10) : null;
    $nps[] = [
        'id' => (string) ($row['id'] ?? ''),
        'companyId' => (string) $row['companyId'],
        'score' => isset($row['score']) && is_numeric($row['score']) ? (float) $row['score'] : null,
        'at' => $at,
        'type' => isset($row['type']) ? (string) $row['type'] : null,
        'survey' => isset($row['survey']) ? (string) $row['survey'] : null,
        'comment' => isset($row['comment']) && $row['comment'] !== '' ? (string) $row['comment'] : null,
    ];
}

clients_respond(200, [
    'configured' => true,
    'companies' => $companies,
    'nps' => $nps,
    'counts' => (object) (is_array($data['counts'] ?? null) ? $data['counts'] : []),
    'errors' => [],
    'warnings' => $warnings,
    'fetchedAt' => $snapshot['fetchedAt'],
]);

function clients_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}