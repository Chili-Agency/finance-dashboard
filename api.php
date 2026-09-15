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

/*
 * Markers written by the team inside Xero. The invoice text we look at is
 * Reference + line item descriptions + item/account codes.
 * Add or adjust patterns here — this is the single place that classifies invoices.
 */
$markerPatterns = [
    'firstMonth' => [
        '/first\s*month/i',
        '/1st\s*month/i',
        '/primeiro\s*m[eê]s/i',
        '/m[eê]s\s*1\b/i',
        '/primer\s*mes/i',
        '/new\s*(client|customer)/i',
    ],
    'upsell' => [
        '/up[-\s]?sell/i',
        '/cross[-\s]?sell/i',
        '/referral/i',
        '/indica[cç][aã]o/i',
    ],
];

$source = $_GET['source'] ?? 'all';
$requested = $source === 'all' ? array_keys($companies) : [$source];
$invoices = [];
$errors = [];
$sourceCounts = [];
$sourceTypeCounts = [];
$diagnostics = [];

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
    $diagnostics[$key] = ['withLineItems' => 0, 'withReference' => 0, 'firstMonthMarked' => 0, 'upsellMarked' => 0];

    foreach ($response['data'] as $invoice) {
        if (!is_array($invoice) || !empty($invoice['_empty'])) {
            continue;
        }

        $type = strtoupper((string) ($invoice['Type'] ?? 'UNKNOWN'));
        $sourceTypeCounts[$key][$type] = ($sourceTypeCounts[$key][$type] ?? 0) + 1;

        if (!empty($invoice['LineItems']) && is_array($invoice['LineItems'])) {
            $diagnostics[$key]['withLineItems']++;
        }
        if (trim((string) ($invoice['Reference'] ?? '')) !== '') {
            $diagnostics[$key]['withReference']++;
        }

        $slim = slimInvoice($invoice, $markerPatterns);

        $slim['companyKey'] = $key;
        $slim['company'] = $company['label'];
        $slim['companyCurrency'] = $company['currency'];
        $slim['usdRate'] = $company['usdRate'];
        $slim['rateSource'] = 'fallback';

        if (!empty($invoice['conversion']['ok']) && isset($invoice['conversion']['usdPerUnit'])) {
            $slim['usdRate'] = (float) $invoice['conversion']['usdPerUnit'];
            $slim['rateSource'] = 'live';
        }

        if (!empty($slim['flags']['firstMonth'])) {
            $diagnostics[$key]['firstMonthMarked']++;
        }
        if (!empty($slim['flags']['upsell'])) {
            $diagnostics[$key]['upsellMarked']++;
        }

        $invoices[] = $slim;
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
    'diagnostics' => $diagnostics,
    'fetchedAt' => gmdate('c'),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

/**
 * Keeps only the fields the dashboard reads, plus the classification flags.
 * Xero payloads with line items are heavy; this keeps the browser payload small.
 */
function slimInvoice(array $invoice, array $markerPatterns): array
{
    $descriptions = [];
    $itemCodes = [];
    $accountCodes = [];

    foreach ((array) ($invoice['LineItems'] ?? []) as $line) {
        if (!is_array($line)) {
            continue;
        }
        if (isset($line['Description'])) {
            $descriptions[] = (string) $line['Description'];
        }
        if (!empty($line['ItemCode'])) {
            $itemCodes[] = (string) $line['ItemCode'];
        }
        if (!empty($line['AccountCode'])) {
            $accountCodes[] = (string) $line['AccountCode'];
        }
        foreach ((array) ($line['Tracking'] ?? []) as $tracking) {
            if (is_array($tracking) && !empty($tracking['Option'])) {
                $descriptions[] = (string) $tracking['Option'];
            }
        }
    }

    $haystack = trim(implode(' | ', array_filter(array_merge(
        [(string) ($invoice['Reference'] ?? '')],
        $descriptions,
        $itemCodes
    ))));

    $flags = [];
    foreach ($markerPatterns as $flag => $patterns) {
        $flags[$flag] = false;
        foreach ($patterns as $pattern) {
            if ($haystack !== '' && preg_match($pattern, $haystack) === 1) {
                $flags[$flag] = true;
                break;
            }
        }
    }

    return [
        'InvoiceID' => $invoice['InvoiceID'] ?? null,
        'InvoiceNumber' => $invoice['InvoiceNumber'] ?? null,
        'Reference' => $invoice['Reference'] ?? null,
        'Type' => $invoice['Type'] ?? null,
        'Status' => $invoice['Status'] ?? null,
        'Date' => $invoice['Date'] ?? null,
        'DateString' => $invoice['DateString'] ?? null,
        'DueDate' => $invoice['DueDate'] ?? null,
        'DueDateString' => $invoice['DueDateString'] ?? null,
        'CurrencyCode' => $invoice['CurrencyCode'] ?? null,
        'SubTotal' => $invoice['SubTotal'] ?? null,
        'TotalTax' => $invoice['TotalTax'] ?? null,
        'Total' => $invoice['Total'] ?? null,
        'AmountDue' => $invoice['AmountDue'] ?? null,
        'AmountPaid' => $invoice['AmountPaid'] ?? null,
        'Contact' => [
            'ContactID' => $invoice['Contact']['ContactID'] ?? null,
            'Name' => $invoice['Contact']['Name'] ?? null,
        ],
        'amounts_usd' => $invoice['amounts_usd'] ?? null,
        'conversion' => $invoice['conversion'] ?? null,
        'flags' => $flags,
        'itemCodes' => array_values(array_unique($itemCodes)),
        'accountCodes' => array_values(array_unique($accountCodes)),
        'markerText' => mb_substr($haystack, 0, 240),
    ];
}

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