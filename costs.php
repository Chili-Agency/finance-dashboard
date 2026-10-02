<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
require __DIR__ . '/fx-rates.php';
require __DIR__ . '/snapshots.php';
auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

/*
 * Custos de assinaturas (backlinks, HubSpot, Linked Helper, Sender.net) lidos das transações de banco
 * do Xero pelo workflow "Chili Finance - Custos (Xero banco)" do n8n e gravados em data_snapshots
 * (fonte "costs", ver snapshots.php). Aqui só convertemos para USD com a cotação do mês da transação
 * (fx_monthly_rates), do mesmo jeito que o api.php faz com as invoices.
 *
 * Resposta: { configured, rows[{market, month, key, label, amount, currency, costUsd, ...}], rules,
 *             markets, since, errors, warnings, fx, fetchedAt }
 */

const COSTS_SOURCE = 'costs';
const COSTS_MARKETS = ['br', 'int', 'pa', 'mx'];
const COSTS_DEFAULT_CURRENCY = ['br' => 'BRL', 'int' => 'USD', 'pa' => 'USD', 'mx' => 'MXN'];

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[costs] ' . $error->getMessage());
    costs_respond(500, ['configured' => true, 'rows' => [], 'errors' => ['Server configuration error. Check the .env file.']]);
}

if (trim((string) ($config['n8n']['costs'] ?? '')) === '') {
    costs_respond(200, [
        'configured' => false,
        'rows' => [],
        'errors' => ['Subscription costs are not connected: set N8N_WEBHOOK_COSTS in the .env with the webhook of the n8n workflow.'],
    ]);
}

try {
    $snapshot = snapshot_read(auth_db(), [COSTS_SOURCE])[COSTS_SOURCE] ?? null;
} catch (Throwable $error) {
    error_log('[costs] snapshots: ' . $error->getMessage());
    costs_respond(500, ['configured' => true, 'rows' => [], 'errors' => ['Could not read the saved costs (data_snapshots). Check that sql/004_data_snapshots.sql was run.']]);
}

if ($snapshot === null || $snapshot['body'] === null) {
    $reason = $snapshot !== null && $snapshot['error'] ? " The last attempt failed: {$snapshot['error']}" : '';
    costs_respond(200, ['configured' => true, 'rows' => [], 'errors' => ['No saved data yet. Press Refresh to fetch it from n8n.' . $reason]]);
}

$data = snapshot_decode_costs($snapshot['body']);
if ($data === null) {
    costs_respond(200, ['configured' => true, 'rows' => [], 'errors' => ['The saved costs are in an unexpected format. Press Refresh to fetch them again.']]);
}

$warnings = [];
if ($snapshot['error'] && $snapshot['errorAt'] && $snapshot['errorAt'] > (string) $snapshot['fetchedAt']) {
    $warnings[] = 'Last refresh failed, showing the previous data';
}

$rows = [];
foreach ($data['rows'] as $raw) {
    if (!is_array($raw)) {
        continue;
    }
    $market = strtolower(trim((string) ($raw['market'] ?? '')));
    $month = (string) ($raw['month'] ?? '');
    if (!in_array($market, COSTS_MARKETS, true) || preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month) !== 1 || !is_numeric($raw['amount'] ?? null)) {
        continue;
    }
    $currency = strtoupper(trim((string) ($raw['currency'] ?? '')));
    if ($currency === '') {
        $currency = COSTS_DEFAULT_CURRENCY[$market];
    }
    $key = (string) ($raw['key'] ?? 'other');
    $rows[] = [
        'id' => (string) ($raw['id'] ?? ''),
        'market' => $market,
        'key' => $key,
        'label' => (string) ($raw['label'] ?? $key),
        'month' => $month,
        'date' => (string) ($raw['date'] ?? ''),
        'amount' => (float) $raw['amount'],
        'currency' => $currency,
        'description' => (string) ($raw['description'] ?? ''),
        'reconciled' => ($raw['reconciled'] ?? false) === true,
        'costUsd' => null,
    ];
}

$fx = ['source' => 'fx_monthly_rates', 'missing' => 0, 'errors' => []];
if ($rows !== []) {
    $rates = new FxRates(auth_db(), (string) ($config['fx']['oer_app_id'] ?? ''));
    $ready = false;
    try {
        $rates->load(array_values(array_unique(array_column($rows, 'currency'))));
        $fx['errors'] = $rates->errors();
        $ready = true;
    } catch (Throwable $error) {
        error_log('[costs] fx: ' . $error->getMessage());
        $fx['errors'][] = 'Could not read fx_monthly_rates: ' . $error->getMessage();
    }

    foreach ($rows as &$row) {
        $rate = $ready || $row['currency'] === 'USD'
            ? $rates->resolve(FxRates::clampMonth($row['month']), $row['currency'])
            : null;
        if ($rate === null || !($rate['units'] > 0)) {
            $fx['missing']++;
            continue;
        }
        $row['costUsd'] = round($row['amount'] / $rate['units'], 2);
    }
    unset($row);
}

$errors = [];
if ($fx['missing'] > 0) {
    $errors[] = $fx['missing'] . ' subscription cost' . ($fx['missing'] === 1 ? '' : 's') . ' without an exchange rate, left out of the totals';
}

$rules = [];
foreach ((array) ($data['rules'] ?? []) as $rule) {
    if (is_array($rule) && isset($rule['key'])) {
        $rules[] = ['key' => (string) $rule['key'], 'label' => (string) ($rule['label'] ?? $rule['key'])];
    }
}

costs_respond(200, [
    'configured' => true,
    'rows' => $rows,
    'rules' => $rules,
    'markets' => (object) (is_array($data['markets'] ?? null) ? $data['markets'] : []),
    'since' => $data['since'] ?? null,
    'errors' => $errors,
    'warnings' => $warnings,
    'fx' => $fx,
    'fetchedAt' => $snapshot['fetchedAt'],
]);

function costs_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}