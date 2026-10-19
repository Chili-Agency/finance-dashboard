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
    error_log('[ppc] ' . $error->getMessage());
    ppc_respond(500, ['configured' => true, 'accounts' => [], 'errors' => ['Server configuration error. Check the .env file.']]);
}

if (trim((string) ($config['n8n']['ppc'] ?? '')) === '') {
    ppc_respond(200, [
        'configured' => false,
        'accounts' => [],
        'errors' => ['PPC is not connected: set N8N_WEBHOOK_PPC and PPC_API_KEY in the .env.'],
    ]);
}

try {
    $snapshots = snapshot_read(auth_db(), ['ppc_accounts', 'ppc_honeymoon', 'ppc_late']);
} catch (Throwable $error) {
    error_log('[ppc] snapshots: ' . $error->getMessage());
    ppc_respond(500, ['configured' => true, 'accounts' => [], 'errors' => ['Could not read the saved PPC data (data_snapshots).']]);
}

$accountsSnapshot = $snapshots['ppc_accounts'] ?? null;
if ($accountsSnapshot === null || $accountsSnapshot['body'] === null) {
    $reason = $accountsSnapshot !== null && $accountsSnapshot['error'] ? " The last attempt failed: {$accountsSnapshot['error']}" : '';
    ppc_respond(200, ['configured' => true, 'accounts' => [], 'errors' => ['No saved PPC data yet. Press Refresh to fetch it.' . $reason]]);
}

$warnings = [];
$fetchedTimes = [];
$sources = [];
foreach ($snapshots as $name => $snapshot) {
    $sources[$name] = $snapshot === null ? null : ['fetchedAt' => $snapshot['fetchedAt'], 'error' => $snapshot['error']];
    if ($snapshot !== null && $snapshot['fetchedAt']) {
        $fetchedTimes[] = (string) $snapshot['fetchedAt'];
    }
    if ($snapshot !== null && $snapshot['error'] && $snapshot['errorAt'] && $snapshot['errorAt'] > (string) $snapshot['fetchedAt']) {
        $warnings[] = ppc_label($name) . ': last refresh failed, showing the previous data';
    }
}

$accounts = [];
foreach (snapshot_decode_ppc((string) $accountsSnapshot['body']) ?? [] as $row) {
    $name = trim((string) ($row['account_name'] ?? ''));
    if ($name === '') {
        continue;
    }
    $accounts[] = [
        'id' => (string) ($row['external_id'] ?? ($row['id'] ?? $name)),
        'externalId' => (string) ($row['external_id'] ?? ''),
        'client' => $name,
        'channel' => (string) ($row['platform'] ?? ''),
        'month' => (string) ($row['date'] ?? ''),
        'region' => (string) ($row['region'] ?? ''),
        'currency' => (string) ($row['currency'] ?? ''),
        'goalStatus' => (string) ($row['goal_status'] ?? ''),
        'budget' => ppc_number($row['media_budget'] ?? null),
        'spend' => ppc_number($row['spend'] ?? null),
        'clicks' => ppc_number($row['clicks'] ?? null),
        'impressions' => ppc_number($row['impressions'] ?? null),
        'leadGoal' => ppc_number($row['lead_goal'] ?? null),
        'leadsGenerated' => ppc_number($row['leads_generated'] ?? null),
        'leadsConverted' => ppc_number($row['leads_converted'] ?? null),
        'cpl' => ppc_number($row['cpl'] ?? null),
        'gap' => ppc_number($row['gap'] ?? null),
        'conversions' => ppc_number($row['conversions'] ?? null),
        'ctr' => ppc_number($row['ctr'] ?? null),
        'cpc' => ppc_number($row['cpc'] ?? null),
        'pacing' => ppc_number($row['pacing'] ?? null),
        'attainment' => ppc_number($row['attainment'] ?? null),
        'elapsed' => ppc_number($row['elapsed'] ?? null),
        'maxCpl' => ppc_number($row['maximum_cpl'] ?? null),
        'typeOfGoal' => (string) ($row['type_of_goal'] ?? ''),
        // Aviso do workflow (ex.: acesso negado na API da plataforma); a coluna campaign so guarda isso.
        'note' => trim((string) ($row['campaign'] ?? '')) !== '' ? trim((string) $row['campaign']) : null,
        'campaigns' => ppc_number($row['campaigns'] ?? null),
        'activeCampaigns' => ppc_number($row['active_campaigns'] ?? null),
        'updatedAt' => isset($row['updatedAt']) ? (string) $row['updatedAt'] : null,
    ];
}

$honeymoon = [];
$honeymoonSnapshot = $snapshots['ppc_honeymoon'] ?? null;
foreach ($honeymoonSnapshot !== null && $honeymoonSnapshot['body'] !== null ? (snapshot_decode_ppc((string) $honeymoonSnapshot['body']) ?? []) : [] as $row) {
    if (trim((string) ($row['client'] ?? '')) === '') {
        continue;
    }
    $honeymoon[] = [
        'client' => (string) $row['client'],
        'region' => (string) ($row['region'] ?? ''),
        'wk1' => (string) ($row['wk1_status'] ?? ''),
        'wk2' => (string) ($row['wk2_status'] ?? ''),
        'wk3' => (string) ($row['wk3_status'] ?? ''),
        'wk4' => (string) ($row['wk4_status'] ?? ''),
        'weeksCompleted' => ppc_number($row['weeks_completed'] ?? null),
        'weeksTotal' => ppc_number($row['weeks_total'] ?? null),
        'status' => (string) ($row['honeymoon_status'] ?? ''),
        'signoffDone' => ($row['signoff_done'] ?? false) === true,
        'nextDueDate' => (string) ($row['next_due_date'] ?? ''),
        'startDate' => (string) ($row['start_date'] ?? ''),
        'endDate' => (string) ($row['honeymoon_end_date'] ?? ''),
        'daysSinceStart' => ppc_number($row['days_since_start'] ?? null),
        'behindWeeks' => ppc_number($row['behind_weeks'] ?? null),
        'projectListId' => (string) ($row['project_list_id'] ?? ''),
    ];
}

$lateTasks = [];
$lateSnapshot = $snapshots['ppc_late'] ?? null;
foreach ($lateSnapshot !== null && $lateSnapshot['body'] !== null ? (snapshot_decode_ppc((string) $lateSnapshot['body']) ?? []) : [] as $row) {
    if (trim((string) ($row['client'] ?? '')) === '') {
        continue;
    }
    $owners = [];
    $decoded = is_string($row['owners_json'] ?? null) ? json_decode($row['owners_json'], true) : ($row['owners_json'] ?? null);
    if (is_array($decoded) && !array_is_list($decoded)) {
        foreach ($decoded as $owner => $count) {
            if (is_numeric($count)) {
                $owners[(string) $owner] = (float) $count;
            }
        }
    }
    $lateTasks[] = [
        'client' => (string) $row['client'],
        'region' => (string) ($row['region'] ?? ''),
        'total' => ppc_number($row['late_total'] ?? null) ?? 0,
        'late1to7' => ppc_number($row['late_1_7'] ?? null) ?? 0,
        'late8to30' => ppc_number($row['late_8_30'] ?? null) ?? 0,
        'late30plus' => ppc_number($row['late_30_plus'] ?? null) ?? 0,
        'avgDelayDays' => ppc_number($row['avg_delay_days'] ?? null) ?? 0,
        'unassigned' => ppc_number($row['unassigned'] ?? null) ?? 0,
        'truncated' => ($row['truncated'] ?? false) === true,
        'owners' => (object) $owners,
    ];
}

$updated = array_filter(array_column($accounts, 'updatedAt'));
sort($fetchedTimes);

ppc_respond(200, [
    'configured' => true,
    'accounts' => $accounts,
    'honeymoon' => $honeymoon,
    'lateTasks' => $lateTasks,
    'errors' => [],
    'warnings' => $warnings,
    'sources' => $sources,
    'updatedAt' => $updated === [] ? null : max($updated),
    'fetchedAt' => $fetchedTimes === [] ? null : $fetchedTimes[0],
]);

function ppc_number(mixed $value): ?float
{
    return is_numeric($value) ? (float) $value : null;
}

function ppc_label(string $source): string
{
    return ['ppc_accounts' => 'Accounts', 'ppc_campaigns' => 'Campaigns', 'ppc_honeymoon' => 'Honeymoon', 'ppc_late' => 'Late tasks', 'ppc_creatives' => 'Creatives'][$source] ?? $source;
}

function ppc_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
