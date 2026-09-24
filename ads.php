<?php
declare(strict_types=1);

/*
 * Custos e leads de mídia paga (Google Ads + Meta Ads), consultados na hora no webhook do n8n
 * (workflow "Chili Finance - Ads (Google + Meta) (CAC/CPL)"), como o api.php faz com as invoices.
 * Resposta: linhas por plataforma × mercado × mês × linha de serviço, com o custo já em USD.
 * O dashboard soma as plataformas: CAC e CPL não são separados por origem.
 */

require __DIR__ . '/auth.php';
require __DIR__ . '/fx-rates.php';
auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const ADS_MARKETS = ['br', 'mx', 'pa', 'int'];
const ADS_CATEGORIES = ['seo', 'ppc', 'others', 'unassigned'];
const ADS_SOURCES = ['google', 'meta'];
const ADS_MARKET_LABELS = ['br' => 'Brazil', 'mx' => 'Mexico', 'pa' => 'Panama', 'int' => 'International'];
const ADS_SOURCE_LABELS = ['google' => 'Google Ads', 'meta' => 'Meta Ads'];

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[ads] ' . $error->getMessage());
    respond(500, ['configured' => false, 'rows' => [], 'accounts' => [], 'errors' => ['Server configuration error. Check the .env file.']]);
}

$url = (string) ($config['n8n']['ads'] ?? '');
if ($url === '') {
    respond(200, ['configured' => false, 'rows' => [], 'accounts' => [], 'errors' => []]);
}

$startedAt = microtime(true);
$curl = curl_init($url);
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 120,
    CURLOPT_HTTPHEADER => ['Accept: application/json'],
    CURLOPT_USERAGENT => 'Chili Finance Dashboard/1.0',
]);
$raw = curl_exec($curl);
$status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
$curlError = curl_error($curl);
curl_close($curl);

if ($raw === false || $curlError !== '') {
    fail('Could not reach n8n (' . ($curlError ?: 'unknown error') . ').');
}
if ($status < 200 || $status >= 300) {
    fail("n8n answered HTTP {$status}.");
}
$data = json_decode((string) $raw, true);
if (is_array($data) && isset($data[0]) && is_array($data[0]) && !isset($data['rows'])) {
    $data = $data[0]; // "Respond to Webhook" com allIncomingItems devolve uma lista
}
if (!is_array($data) || !isset($data['rows']) || !is_array($data['rows'])) {
    fail('n8n returned an unexpected response.');
}

$rows = [];
foreach ($data['rows'] as $row) {
    if (!is_array($row)) {
        continue;
    }
    $market = (string) ($row['market'] ?? '');
    $month = (string) ($row['month'] ?? '');
    $category = (string) ($row['category'] ?? 'unassigned');
    $source = (string) ($row['source'] ?? 'google'); // versões antigas do workflow só tinham Google
    if (!in_array($market, ADS_MARKETS, true) || preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month) !== 1) {
        continue;
    }
    $rows[] = [
        'source' => in_array($source, ADS_SOURCES, true) ? $source : 'google',
        'market' => $market,
        'month' => $month,
        'category' => in_array($category, ADS_CATEGORIES, true) ? $category : 'unassigned',
        'currency' => strtoupper((string) ($row['currency'] ?? 'USD')),
        'cost' => number($row['cost'] ?? null) ?? 0.0,
        'costUsd' => number($row['costUsd'] ?? null),
        'conversions' => number($row['conversions'] ?? null) ?? 0.0,
        'campaigns' => array_values(array_filter(array_map('strval', (array) ($row['campaigns'] ?? [])))),
    ];
}

// Custo em USD pela cotação do mês de cada linha (fx_monthly_rates; mês não gravado usa o
// mais próximo). Se não houver cotação, fica o costUsd que o n8n mandou (workflow antigo) ou null.
$fxErrors = [];
$fxReady = false;
$fx = new FxRates(auth_db(), (string) ($config['fx']['oer_app_id'] ?? ''));
try {
    $fx->load(array_column($rows, 'currency'));
    $fxErrors = $fx->errors();
    $fxReady = true;
} catch (Throwable $error) {
    error_log('[ads] fx: ' . $error->getMessage());
    $fxErrors[] = 'Could not read fx_monthly_rates: ' . $error->getMessage();
}
$missingFx = 0;
foreach ($rows as &$row) {
    $rate = $fxReady || $row['currency'] === 'USD' ? $fx->resolve($row['month'], $row['currency']) : null;
    if ($rate !== null) {
        $row['costUsd'] = round($row['cost'] / $rate['units'], 2);
    } elseif ($row['costUsd'] === null) {
        $missingFx++;
    }
}
unset($row);

$accounts = [];
$errors = [];
foreach ((array) ($data['accounts'] ?? []) as $account) {
    if (!is_array($account)) {
        continue;
    }
    $market = (string) ($account['market'] ?? '');
    $platform = (string) ($account['platform'] ?? 'google');
    $platform = in_array($platform, ADS_SOURCES, true) ? $platform : 'google';
    $item = [
        'platform' => $platform,
        'market' => $market,
        'customerId' => (string) ($account['customerId'] ?? ''),
        'name' => isset($account['name']) ? (string) $account['name'] : null,
        'currency' => isset($account['currency']) ? (string) $account['currency'] : null,
        'ok' => (bool) ($account['ok'] ?? false),
        'configured' => ($account['customerId'] ?? '') !== '',
        'error' => isset($account['error']) ? (string) $account['error'] : null,
    ];
    $accounts[] = $item;
    if ($item['configured'] && $item['error'] !== null) {
        $label = ADS_SOURCE_LABELS[$platform] . (isset(ADS_MARKET_LABELS[$market]) ? ' (' . ADS_MARKET_LABELS[$market] . ')' : '');
        $errors[] = $label . ': ' . $item['error'];
    }
}
if ($missingFx > 0) {
    $errors[] = 'Exchange rates: ' . ($fxErrors !== [] ? implode(' ', $fxErrors) : "{$missingFx} row(s) without a rate for their month.");
}

respond(200, [
    'configured' => true,
    'rows' => $rows,
    'accounts' => $accounts,
    'errors' => $errors,
    'fetchedAt' => (string) ($data['fetchedAt'] ?? gmdate('Y-m-d\TH:i:s\Z')),
    'seconds' => round(microtime(true) - $startedAt, 1),
]);

function number(mixed $value): ?float
{
    return is_numeric($value) ? (float) $value : null;
}

function fail(string $message): void
{
    error_log('[ads] ' . $message);
    respond(502, ['configured' => true, 'rows' => [], 'accounts' => [], 'errors' => [$message]]);
}

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}