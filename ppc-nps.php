<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const PPC_NPS_TIMEOUT = 30;

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[ppc-nps] ' . $error->getMessage());
    ppc_nps_respond(500, ['configured' => true, 'rows' => [], 'responses' => [], 'error' => 'Server configuration error. Check the .env file.']);
}

$seo = ($_GET['service'] ?? '') === 'seo';
$summaryUrl = trim((string) ($config['n8n'][$seo ? 'seo_nps' : 'ppc_nps'] ?? ''));
$responsesUrl = trim((string) ($config['n8n'][$seo ? 'seo_nps_responses' : 'ppc_nps_responses'] ?? ''));
if ($summaryUrl === '') {
    $names = $seo ? 'N8N_WEBHOOK_SEO_NPS and PPC_API_KEY' : 'N8N_WEBHOOK_PPC_NPS and PPC_API_KEY';
    ppc_nps_respond(200, ['configured' => false, 'rows' => [], 'responses' => [], 'error' => "NPS is not connected: set {$names} in the .env."]);
}

$requests = ['rows' => $summaryUrl];
if ($responsesUrl !== '') {
    $requests['responses'] = $responsesUrl;
}
$results = ppc_nps_fetch($requests, (string) ($config['ppc']['api_key'] ?? ''));

$rows = $results['rows'] ?? null;
if (!is_array($rows)) {
    ppc_nps_respond(502, ['configured' => true, 'rows' => [], 'responses' => [], 'error' => 'Could not load the NPS data from n8n.']);
}

ppc_nps_respond(200, [
    'configured' => true,
    'rows' => $rows,
    'responses' => is_array($results['responses'] ?? null) ? $results['responses'] : [],
    'error' => null,
    'fetchedAt' => gmdate('Y-m-d\TH:i:s\Z'),
]);

function ppc_nps_fetch(array $urls, string $apiKey): array
{
    $multi = curl_multi_init();
    $handles = [];
    foreach ($urls as $name => $url) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => PPC_NPS_TIMEOUT,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => '{}',
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json', 'X-API-Key: ' . $apiKey],
            CURLOPT_USERAGENT => 'Chili Finance Dashboard/1.0',
        ]);
        curl_multi_add_handle($multi, $curl);
        $handles[$name] = $curl;
    }
    do {
        $status = curl_multi_exec($multi, $running);
        if ($running) {
            curl_multi_select($multi, 1.0);
        }
    } while ($running && $status === CURLM_OK);

    $results = [];
    foreach ($handles as $name => $curl) {
        $body = curl_multi_getcontent($curl);
        $code = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $decoded = $code >= 200 && $code < 300 && is_string($body) ? json_decode($body, true) : null;
        $results[$name] = is_array($decoded) && ($decoded === [] || array_keys($decoded) === range(0, count($decoded) - 1)) ? $decoded : null;
        curl_multi_remove_handle($multi, $curl);
        curl_close($curl);
    }
    curl_multi_close($multi);
    return $results;
}

function ppc_nps_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
