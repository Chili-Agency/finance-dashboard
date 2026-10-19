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
    error_log('[ppc-creatives] ' . $error->getMessage());
    ppc_creatives_respond(500, ['items' => [], 'error' => 'Server configuration error. Check the .env file.']);
}

if (trim((string) ($config['n8n']['ppc_creatives'] ?? '')) === '') {
    ppc_creatives_respond(200, ['configured' => false, 'items' => [], 'error' => 'Creatives are not connected: set N8N_WEBHOOK_PPC_CREATIVES in the .env.']);
}

try {
    $snapshot = snapshot_read(auth_db(), ['ppc_creatives'])['ppc_creatives'] ?? null;
} catch (Throwable $error) {
    error_log('[ppc-creatives] ' . $error->getMessage());
    ppc_creatives_respond(500, ['items' => [], 'error' => 'Could not read the saved creatives (data_snapshots).']);
}

if ($snapshot === null || $snapshot['body'] === null) {
    ppc_creatives_respond(200, ['configured' => true, 'items' => [], 'error' => 'No saved creatives yet. Press Refresh to fetch them.']);
}

$rows = snapshot_decode_ppc((string) $snapshot['body']) ?? [];
$latest = '';
foreach ($rows as $row) {
    $latest = max($latest, (string) ($row['date'] ?? ''));
}

$number = static fn (mixed $value): ?float => is_numeric($value) ? (float) $value : null;
$items = [];
foreach ($rows as $row) {
    if ((string) ($row['date'] ?? '') !== $latest || trim((string) ($row['ad_id'] ?? '')) === '') {
        continue;
    }
    $items[] = [
        'id' => (string) $row['ad_id'],
        'parentId' => (string) ($row['parent_id'] ?? ''),
        'name' => (string) ($row['ad_name'] ?? ''),
        'campaign' => (string) ($row['campaign_name'] ?? ''),
        'group' => (string) ($row['group_name'] ?? ''),
        'client' => (string) ($row['account_name'] ?? ''),
        'channel' => (string) ($row['platform'] ?? ''),
        'status' => (string) ($row['status'] ?? ''),
        'format' => (string) ($row['format'] ?? ''),
        'headline' => trim((string) ($row['headline'] ?? '')) !== '' ? (string) $row['headline'] : null,
        'currency' => (string) ($row['currency'] ?? ''),
        'spend' => $number($row['spend'] ?? null),
        'impressions' => $number($row['impressions'] ?? null),
        'clicks' => $number($row['clicks'] ?? null),
        'ctr' => $number($row['ctr'] ?? null),
        'cpc' => $number($row['cpc'] ?? null),
        'conversions' => $number($row['conversions'] ?? null),
        'costPerConversion' => $number($row['cost_per_conversion'] ?? null),
    ];
}

ppc_creatives_respond(200, ['configured' => true, 'items' => $items, 'month' => $latest !== '' ? $latest : null, 'error' => null, 'fetchedAt' => $snapshot['fetchedAt']]);

function ppc_creatives_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
