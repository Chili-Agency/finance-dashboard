<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const INDEX_SERIES = [
    'ipca' => 433,
    'igpm' => 189,
];
const INDEX_START = '2024-01-01';
const INDEX_CACHE_SECONDS = 6 * 60 * 60;
const INDEX_CACHE_FILE = 'chili_finance_br_indices.json';

$cacheFile = sys_get_temp_dir() . '/' . INDEX_CACHE_FILE;
$cached = is_file($cacheFile) ? json_decode((string) file_get_contents($cacheFile), true) : null;
if (is_array($cached) && ($cached['cachedAt'] ?? 0) > time() - INDEX_CACHE_SECONDS) {
    respond(200, $cached['body']);
}

$body = [
    'series' => [],
    'latest' => [],
    'errors' => [],
    'stale' => [],
    'source' => 'Banco Central do Brasil (SGS)',
    'fetchedAt' => gmdate('Y-m-d\TH:i:s\Z'),
];

foreach (INDEX_SERIES as $name => $code) {
    try {
        $values = fetchSeries($code);
        $body['series'][$name] = $values;
    } catch (Throwable $error) {
        error_log("[br-indices] {$name}: " . $error->getMessage());
        $previous = $cached['body']['series'][$name] ?? null;
        if (is_array($previous) && $previous !== []) {
            $body['series'][$name] = $previous;
            $body['stale'][] = $name;
        } else {
            $body['series'][$name] = new stdClass();
            $body['errors'][] = strtoupper($name) . ': ' . $error->getMessage();
        }
    }
    $months = array_keys((array) $body['series'][$name]);
    $body['latest'][$name] = $months === [] ? null : max($months);
}

if ($body['errors'] === [] && $body['stale'] === []) {
    file_put_contents($cacheFile, json_encode(['cachedAt' => time(), 'body' => $body]), LOCK_EX);
}
respond($body['errors'] === [] ? 200 : 502, $body);

/** @return array<string, float> "YYYY-MM" => variação em fração (0.0016 = 0,16%) */
function fetchSeries(int $code): array
{
    $url = sprintf(
        'https://api.bcb.gov.br/dados/serie/bcdata.sgs.%d/dados?%s',
        $code,
        http_build_query([
            'formato' => 'json',
            'dataInicial' => date('d/m/Y', strtotime(INDEX_START)),
            'dataFinal' => date('d/m/Y'),
        ])
    );

    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
        CURLOPT_USERAGENT => 'ChiliFinanceDashboard/1.0',
    ]);
    $raw = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $curlError = curl_error($curl);
    curl_close($curl);

    if ($raw === false) {
        throw new RuntimeException("Could not reach the Central Bank ({$curlError}).");
    }
    if ($status !== 200) {
        throw new RuntimeException("The Central Bank answered HTTP {$status}.");
    }
    $rows = json_decode((string) $raw, true);
    if (!is_array($rows)) {
        throw new RuntimeException('The Central Bank returned an unexpected response.');
    }

    $values = [];
    foreach ($rows as $row) {
        if (!is_array($row) || preg_match('#^\d{2}/(\d{2})/(\d{4})$#', (string) ($row['data'] ?? ''), $match) !== 1) {
            continue;
        }
        $value = str_replace(',', '.', (string) ($row['valor'] ?? ''));
        if (!is_numeric($value)) {
            continue;
        }
        $values["{$match[2]}-{$match[1]}"] = round((float) $value / 100, 8);
    }
    if ($values === []) {
        throw new RuntimeException('The Central Bank returned no values.');
    }
    ksort($values);
    return $values;
}

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
