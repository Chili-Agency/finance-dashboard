<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[api] ' . $error->getMessage());
    http_response_code(500);
    echo json_encode(['invoices' => [], 'errors' => ['Server configuration error. Check the .env file.']]);
    exit;
}

$companies = [
    'br' => [
        'label' => 'Brazil',
        'url' => $config['n8n']['br'],
        'currency' => 'BRL',
        'usdRate' => 0.18,
    ],
    'int' => [
        'label' => 'International',
        'url' => $config['n8n']['int'],
        'currency' => 'USD',
        'usdRate' => 1,
    ],
    'pa' => [
        'label' => 'Panama',
        'url' => $config['n8n']['pa'],
        'currency' => 'USD',
        'usdRate' => 1,
    ],
    'mx' => [
        'label' => 'Mexico',
        'url' => $config['n8n']['mx'],
        'currency' => 'MXN',
        'usdRate' => 0.055,
    ],
];

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
        '/expans[aã]o/i',
        '/amplia[cç][aã]o/i',
    ],
    'referral' => [
        '/referral/i',
        '/indica[cç][aã]o/i',
    ],
];

$lineMarkers = ['upsell'];

$categoryRules = [
    'seo' => [
        'accountName' => ['/\bSEO\b/i'],
        'accountCodes' => ['201'],
        'text' => ['/\bSEO\b/i'],
    ],
    'ppc' => [
        'accountName' => ['/\bPPC\b/i'],
        'accountCodes' => [],
        'text' => ['/\bPPC\b/i'],
    ],
];

$source = $_GET['source'] ?? 'all';
$requested = $source === 'all' ? array_keys($companies) : [$source];
$invoices = [];
$errors = [];
$sourceCounts = [];
$sourceTypeCounts = [];
$diagnostics = [];
$categoryCounts = ['seo' => 0, 'ppc' => 0, 'other' => 0];
$sourceErrors = [];
$sourceWarnings = [];
$sourceSeconds = [];

foreach ($requested as $key) {
    if (!isset($companies[$key])) {
        $errors[] = "Unknown company source: {$key}";
        continue;
    }

    $company = $companies[$key];
    $startedAt = microtime(true);
    $response = fetchJson($company['url']);
    $sourceSeconds[$key] = round(microtime(true) - $startedAt, 1);
    $warnings = [];
    $unconverted = 0;

    if (!$response['ok']) {
        $sourceErrors[$key] = $response['error'];
        $sourceWarnings[$key] = [];
        $errors[] = $company['label'] . ': ' . $response['error'];
        $sourceCounts[$key] = 0;
        $sourceTypeCounts[$key] = [];
        continue;
    }

    $before = count($invoices);
    $sourceTypeCounts[$key] = [];
    $diagnostics[$key] = ['withLineItems' => 0, 'withReference' => 0, 'firstMonthMarked' => 0, 'upsellMarked' => 0, 'referralMarked' => 0, 'withAccountName' => 0, 'seo' => 0, 'ppc' => 0, 'unclassified' => 0];

    foreach ($response['data'] as $invoice) {
        if (!is_array($invoice)) {
            continue;
        }
        if (!empty($invoice['_empty'])) {
            if (!empty($invoice['_error'])) {
                $sourceErrors[$key] = 'Xero request failed inside n8n: ' . (string) $invoice['_error'];
                $errors[] = $company['label'] . ': ' . $sourceErrors[$key];
            }
            if (($invoice['fxOk'] ?? true) === false) {
                $warnings['fx'] = 'Live exchange rates unavailable';
            }
            if (!empty($invoice['accountsError'])) {
                $warnings['accounts'] = 'Chart of accounts unavailable, SEO/PPC split may be incomplete';
            }
            continue;
        }
        if (!empty($invoice['accountsError'])) {
            $warnings['accounts'] = 'Chart of accounts unavailable, SEO/PPC split may be incomplete';
        }
        if (isset($invoice['conversion']['ok']) && $invoice['conversion']['ok'] === false) {
            $unconverted++;
        }

        $type = strtoupper((string) ($invoice['Type'] ?? 'UNKNOWN'));
        $sourceTypeCounts[$key][$type] = ($sourceTypeCounts[$key][$type] ?? 0) + 1;

        if (!empty($invoice['LineItems']) && is_array($invoice['LineItems'])) {
            $diagnostics[$key]['withLineItems']++;
        }
        if (trim((string) ($invoice['Reference'] ?? '')) !== '') {
            $diagnostics[$key]['withReference']++;
        }

        $slim = slimInvoice($invoice, $markerPatterns, $categoryRules, $lineMarkers);

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
        if (!empty($slim['flags']['referral'])) {
            $diagnostics[$key]['referralMarked']++;
        }
        if (!empty($slim['hasAccountNames'])) {
            $diagnostics[$key]['withAccountName']++;
        }
        foreach (['seo', 'ppc'] as $category) {
            if (in_array($category, $slim['categories'], true)) {
                $diagnostics[$key][$category]++;
                $categoryCounts[$category]++;
            }
        }
        if ($slim['categories'] === []) {
            $diagnostics[$key]['unclassified']++;
            $categoryCounts['other']++;
        }

        $invoices[] = $slim;
    }

    $sourceCounts[$key] = count($invoices) - $before;
    if ($unconverted > 0) {
        $warnings['fx'] = $unconverted . ' invoice' . ($unconverted === 1 ? '' : 's') . ' converted with the fallback rate';
    }
    $sourceWarnings[$key] = array_values($warnings);
}

echo json_encode([
    'invoices' => $invoices,
    'errors' => $errors,
    'rates' => array_reduce($companies, static function (array $carry, array $company): array {
        $carry[$company['currency']] = $company['usdRate'];
        return $carry;
    }, []),
    'sourceCounts' => $sourceCounts,
    'sourceErrors' => (object) $sourceErrors,
    'sourceWarnings' => (object) $sourceWarnings,
    'sourceSeconds' => (object) $sourceSeconds,
    'sourceTypeCounts' => $sourceTypeCounts,
    'diagnostics' => $diagnostics,
    'categoryCounts' => $categoryCounts,
    'fetchedAt' => gmdate('c'),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

function slimInvoice(array $invoice, array $markerPatterns, array $categoryRules, array $lineMarkers): array
{
    $reference = (string) ($invoice['Reference'] ?? '');
    $descriptions = [];
    $categoryKeys = array_merge(array_keys($categoryRules), ['other']);
    $lineWeights = [];
    $hasAccountNames = false;
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
        if (trim((string) ($line['AccountName'] ?? '')) !== '') {
            $hasAccountNames = true;
        }
        $lineText = [(string) ($line['Description'] ?? ''), (string) ($line['ItemCode'] ?? ''), (string) ($line['AccountName'] ?? '')];
        foreach ((array) ($line['Tracking'] ?? []) as $tracking) {
            if (is_array($tracking) && !empty($tracking['Option'])) {
                $descriptions[] = (string) $tracking['Option'];
                $lineText[] = (string) $tracking['Option'];
            }
        }
        $lineFlags = [];
        foreach ($lineMarkers as $marker) {
            $lineFlags[$marker] = matchesAny(implode(' | ', $lineText), $markerPatterns[$marker] ?? [])
                || matchesAny($reference, $markerPatterns[$marker] ?? []);
        }
        $lineWeights[] = [
            'category' => classifyLine($line, $categoryRules) ?? 'other',
            'amount' => (float) ($line['LineAmount'] ?? 0),
            'flags' => $lineFlags,
        ];
    }

    $haystack = trim(implode(' | ', array_filter(array_merge(
        [$reference],
        $descriptions,
        $itemCodes
    ))));

    $flags = [];
    foreach ($markerPatterns as $flag => $patterns) {
        $flags[$flag] = matchesAny($haystack, $patterns);
    }

    $categoryShares = categoryShares($lineWeights, $categoryKeys);
    $markerShares = [];
    foreach ($lineMarkers as $marker) {
        $markerShares[$marker] = $lineWeights === [] && $flags[$marker]
            ? $categoryShares
            : categoryShares($lineWeights, $categoryKeys, static fn (array $line): bool => !empty($line['flags'][$marker]));
    }
    $categories = [];
    foreach (array_keys($categoryRules) as $category) {
        if (($categoryShares[$category] ?? 0) > 0) {
            $categories[] = $category;
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
        'categories' => $categories,
        'categoryShares' => $categoryShares,
        'upsellShares' => $markerShares['upsell'] ?? null,
        'hasAccountNames' => $hasAccountNames,
    ];
}

function matchesAny(string $text, array $patterns): bool
{
    if (trim($text) === '') {
        return false;
    }
    foreach ($patterns as $pattern) {
        if (preg_match($pattern, $text) === 1) {
            return true;
        }
    }
    return false;
}

function classifyLine(array $line, array $categoryRules): ?string
{
    $name = trim((string) ($line['AccountName'] ?? ''));
    $code = trim((string) ($line['AccountCode'] ?? ''));

    if ($name !== '') {
        foreach ($categoryRules as $category => $rule) {
            foreach ($rule['accountName'] ?? [] as $pattern) {
                if (preg_match($pattern, $name) === 1) {
                    return $category;
                }
            }
        }
    }

    if ($code !== '') {
        foreach ($categoryRules as $category => $rule) {
            if (in_array($code, $rule['accountCodes'] ?? [], true)) {
                return $category;
            }
        }
    }

    if ($name === '') {
        $text = (string) ($line['Description'] ?? '');
        foreach ($categoryRules as $category => $rule) {
            foreach ($rule['text'] ?? [] as $pattern) {
                if ($text !== '' && preg_match($pattern, $text) === 1) {
                    return $category;
                }
            }
        }
    }

    return null;
}

function categoryShares(array $lineWeights, array $categoryKeys, ?callable $filter = null): array
{
    $shares = array_fill_keys($categoryKeys, 0.0);

    if ($lineWeights === []) {
        if ($filter === null) {
            $shares['other'] = 1.0;
        }
        return $shares;
    }

    $strategies = [
        static fn (array $line): float => $line['amount'],
        static fn (array $line): float => abs($line['amount']),
        static fn (array $line): float => 1.0,
    ];

    foreach ($strategies as $weight) {
        $sums = array_fill_keys($categoryKeys, 0.0);
        $total = 0.0;
        foreach ($lineWeights as $line) {
            $total += $weight($line);
            if ($filter === null || $filter($line)) {
                $sums[$line['category']] += $weight($line);
            }
        }
        if (abs($total) >= 0.00001) {
            foreach ($sums as $category => $sum) {
                $shares[$category] = round($sum / $total, 6);
            }
            return $shares;
        }
    }

    return $shares;
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