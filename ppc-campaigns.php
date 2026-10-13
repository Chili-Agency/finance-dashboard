<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
require __DIR__ . '/snapshots.php';
auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$parent = trim((string) ($_GET['parent_id'] ?? ''));
if ($parent === '') {
    ppc_campaigns_respond(400, ['items' => [], 'error' => 'Missing parent_id.']);
}

try {
    $snapshot = snapshot_read(auth_db(), ['ppc_campaigns'])['ppc_campaigns'] ?? null;
} catch (Throwable $error) {
    error_log('[ppc-campaigns] ' . $error->getMessage());
    ppc_campaigns_respond(500, ['items' => [], 'error' => 'Could not read the saved campaigns (data_snapshots).']);
}

if ($snapshot === null || $snapshot['body'] === null) {
    ppc_campaigns_respond(200, ['items' => [], 'error' => 'No saved campaigns yet. Press Refresh to fetch them.']);
}

$items = [];
foreach (snapshot_decode_ppc((string) $snapshot['body']) ?? [] as $row) {
    if ((string) ($row['parent_id'] ?? '') !== $parent) {
        continue;
    }
    $items[] = [
        'id' => (string) ($row['campaign_id'] ?? ''),
        'name' => (string) ($row['campaign_name'] ?? ''),
        'status' => (string) ($row['status'] ?? ''),
        'currency' => (string) ($row['currency'] ?? ''),
        'spend' => is_numeric($row['spend'] ?? null) ? (float) $row['spend'] : null,
        'clicks' => is_numeric($row['clicks'] ?? null) ? (float) $row['clicks'] : null,
        'impressions' => is_numeric($row['impressions'] ?? null) ? (float) $row['impressions'] : null,
        'ctr' => is_numeric($row['ctr'] ?? null) ? (float) $row['ctr'] : null,
        'cpc' => is_numeric($row['cpc'] ?? null) ? (float) $row['cpc'] : null,
    ];
}

ppc_campaigns_respond(200, ['items' => $items, 'error' => null, 'fetchedAt' => $snapshot['fetchedAt']]);

function ppc_campaigns_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
