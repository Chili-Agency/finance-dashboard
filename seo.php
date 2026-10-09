<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
require __DIR__ . '/snapshots.php';
require __DIR__ . '/seo-pagespeed.php';
auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const SEO_DEFAULT_GOALS = ['kwPage1' => 400, 'pagespeed' => 80, 'drDelta' => 2];

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[seo] ' . $error->getMessage());
    seo_respond(500, ['configured' => true, 'clients' => [], 'errors' => ['Server configuration error. Check the .env file.']]);
}

if (trim((string) ($config['n8n']['seo'] ?? '')) === '') {
    seo_respond(200, [
        'configured' => false,
        'clients' => [],
        'errors' => ['SEO KPIs are not connected: set N8N_WEBHOOK_SEO in the .env with the webhook of the n8n workflow.'],
    ]);
}

try {
    $snapshot = snapshot_read(auth_db(), ['seo'])['seo'] ?? null;
} catch (Throwable $error) {
    error_log('[seo] snapshots: ' . $error->getMessage());
    seo_respond(500, ['configured' => true, 'clients' => [], 'errors' => ['Could not read the saved SEO data (data_snapshots).']]);
}

if ($snapshot === null || $snapshot['body'] === null) {
    $reason = $snapshot !== null && $snapshot['error'] ? " The last attempt failed: {$snapshot['error']}" : '';
    seo_respond(200, ['configured' => true, 'clients' => [], 'errors' => ['No saved SEO data yet. Press Refresh to fetch it.' . $reason]]);
}

$data = snapshot_decode_seo($snapshot['body']);
if ($data === null) {
    seo_respond(200, ['configured' => true, 'clients' => [], 'errors' => ['The saved SEO data is in an unexpected format. Press Refresh to fetch it again.']]);
}

$warnings = array_values(array_filter(array_map('strval', (array) ($data['warnings'] ?? []))));
if ($snapshot['error'] && $snapshot['errorAt'] && $snapshot['errorAt'] > (string) $snapshot['fetchedAt']) {
    $warnings[] = 'Last SEO refresh failed, showing the previous data';
}

$goals = [];
foreach (SEO_DEFAULT_GOALS as $key => $fallback) {
    $value = $data['goals'][$key] ?? null;
    $goals[$key] = is_numeric($value) ? (float) $value : (float) $fallback;
}

$month = isset($data['month']) && preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', (string) $data['month']) === 1 ? (string) $data['month'] : null;

$pagespeed = [];
try {
    $pagespeed = seo_pagespeed_latest(auth_db());
} catch (Throwable $error) {
    error_log('[seo] pagespeed: ' . $error->getMessage());
    $warnings[] = 'Could not read the saved PageSpeed scores (seo_pagespeed). Check that seo_pagespeed.sql was run.';
}

$clients = [];
foreach ($data['clients'] as $row) {
    if (!is_array($row)) {
        continue;
    }
    $name = trim((string) ($row['name'] ?? ''));
    if ($name === '') {
        continue;
    }
    $domain = isset($row['domain']) && $row['domain'] !== '' ? (string) $row['domain'] : null;
    $saved = $domain !== null ? ($pagespeed[seo_domain_key($domain)] ?? null) : null;
    $ownScore = seo_number($row['pagespeed'] ?? null);
    $clients[] = [
        'name' => $name,
        'domain' => $domain,
        'kwTotal' => seo_number($row['kwTotal'] ?? null),
        'kwPage1' => seo_number($row['kwPage1'] ?? null),
        'kwPrev' => seo_number($row['kwPrev'] ?? null),
        'pagespeed' => $ownScore ?? ($saved !== null ? (float) $saved['score'] : null),
        'pagespeedAt' => $ownScore === null && $saved !== null ? $saved['measuredAt'] : null,
        'drStart' => seo_number($row['drStart'] ?? null),
        'drEnd' => seo_number($row['drEnd'] ?? null),
    ];
}

seo_respond(200, [
    'configured' => true,
    'month' => $month,
    'goals' => $goals,
    'clients' => $clients,
    'errors' => [],
    'warnings' => $warnings,
    'fetchedAt' => $snapshot['fetchedAt'],
]);

function seo_number(mixed $value): ?float
{
    return is_numeric($value) ? (float) $value : null;
}

function seo_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
