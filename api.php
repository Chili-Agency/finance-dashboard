<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$companies = [
    'br' => [
        'label' => 'Brazil',
        'url' => 'https://chilidigital.app.n8n.cloud/webhook/fetch-invoices-br',
        'currency' => 'BRL',
        'usdRate' => 0.18,
    ],
    'int' => [
        'label' => 'International',
        'url' => 'https://chilidigital.app.n8n.cloud/webhook/fetch-invoices-int',
        'currency' => 'USD',
        'usdRate' => 1,
    ],
    'pa' => [
        'label' => 'Panama',
        'url' => 'https://chilidigital.app.n8n.cloud/webhook/fetch-invoices-pa',
        'currency' => 'USD',
        'usdRate' => 1,
    ],
    'mx' => [
        'label' => 'Mexico',
        'url' => 'https://chilidigital.app.n8n.cloud/webhook/fetch-invoices-mx',
        'currency' => 'MXN',
        'usdRate' => 0.055,
    ],
];

$source = $_GET['source'] ?? 'all';
$requested = $source === 'all' ? array_keys($companies) : [$source];
$invoices = [];
$errors = [];
$sourceCounts = [];
$sourceTypeCounts = [];

foreach ($requested as $key) {
    if (!isset($companies[$key])) {
        $errors[] = "Unknown company source: {$key}";
        continue;
    }

    $company = $companies[$key];
    $response = fetchJson($company['url']);

    if (!$response['ok']) {
        $errors[] = $company['label'] . ': ' . $response['error'];
        $sourceCounts[$key] = 0;
        $sourceTypeCounts[$key] = [];
        continue;
    }

    $before = count($invoices);
    $sourceTypeCounts[$key] = [];
    foreach ($response['data'] as $invoice) {
        if (!is_array($invoice) || !empty($invoice['_empty'])) {
            continue;
        }

        $type = strtoupper((string) ($invoice['Type'] ?? 'UNKNOWN'));
        $sourceTypeCounts[$key][$type] = ($sourceTypeCounts[$key][$type] ?? 0) + 1;

        $invoice['companyKey'] = $key;
        $invoice['company'] = $company['label'];
        $invoice['companyCurrency'] = $company['currency'];
        $invoice['usdRate'] = $company['usdRate'];
        $invoice['rateSource'] = 'fallback';

        if (!empty($invoice['conversion']['ok']) && isset($invoice['conversion']['usdPerUnit'])) {
            $invoice['usdRate'] = (float) $invoice['conversion']['usdPerUnit'];
            $invoice['rateSource'] = 'live';
        }

        $invoices[] = $invoice;
    }

    $sourceCounts[$key] = count($invoices) - $before;
}

echo json_encode([
    'invoices' => $invoices,
    'errors' => $errors,
    'rates' => array_reduce($companies, static function (array $carry, array $company): array {
        $carry[$company['currency']] = $company['usdRate'];
        return $carry;
    }, []),
    'sourceCounts' => $sourceCounts,
    'sourceTypeCounts' => $sourceTypeCounts,
    'fetchedAt' => gmdate('c'),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

function fetchJson(string $url): array
{
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => 'GET',
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 120,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
        CURLOPT_USERAGENT => 'Chili Finance Dashboard/1.0',
    ]);

    $body = curl_exec($curl);
    $curlError = curl_error($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);

    if ($body === false || $curlError !== '') {
        return ['ok' => false, 'error' => 'Request failed: ' . ($curlError ?: 'unknown error')];
    }

    if ($status < 200 || $status >= 300) {
        return ['ok' => false, 'error' => "n8n returned HTTP {$status}"];
    }

    if (trim((string) $body) === '') {
        return ['ok' => false, 'error' => "empty response body (HTTP {$status})"];
    }

    $data = json_decode($body, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        $snippet = preg_replace('/\s+/', ' ', substr((string) $body, 0, 200));
        return ['ok' => false, 'error' => "response is not JSON (HTTP {$status}): {$snippet}"];
    }

    if (!is_array($data)) {
        return ['ok' => false, 'error' => 'unexpected JSON scalar: ' . var_export($data, true)];
    }

    $isList = $data === [] || array_keys($data) === range(0, count($data) - 1);

    if (!$isList) {
        if (isset($data['message']) || isset($data['error'])) {
            $detail = (string) ($data['message'] ?? $data['error']);
            return ['ok' => false, 'error' => "n8n error: {$detail}"];
        }
        $data = [$data];
    }

    return ['ok' => true, 'data' => $data];
}