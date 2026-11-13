<?php
declare(strict_types=1);

/*
 * Dados do ClickUp para o scorecard de KPI de um usuário (página KPI scorecard, só admin).
 * GET ?userId=<id numérico do ClickUp>&month=YYYYMM
 * Chama o webhook do workflow "Data Fetching Workflow for KPIs" no n8n (N8N_WEBHOOK_KPI_DATA, POST /kpi-user-data)
 * com o mesmo X-API-Key (PPC_API_KEY) dos outros webhooks e devolve:
 *   { ok, kpis: { 1: {value, note}, 3: {value, note} }, delivery, time, errors, fetchedAt }
 * KPI 1 = Delivery / SLA Hit-Rate (tarefas fechadas até o vencimento); KPI 3 = Time Tracking + Billable %.
 */

require __DIR__ . '/auth.php';
$currentUser = auth_require_api();
auth_require_permission($currentUser, 'kpi_scorecard');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
@set_time_limit(150); // o n8n pagina as tarefas do mês e pode passar de 30 s

$userId = trim((string) ($_GET['userId'] ?? ''));
$month = trim((string) ($_GET['month'] ?? ''));
if (preg_match('/^\d{3,12}$/', $userId) !== 1) {
    kpi_data_respond(422, ['ok' => false, 'errors' => ['Choose a ClickUp user from the list (numeric id).']]);
}
if (preg_match('/^20\d{2}(0[1-9]|1[0-2])$/', $month) !== 1) {
    kpi_data_respond(422, ['ok' => false, 'errors' => ['Month must be YYYYMM.']]);
}

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[kpi-data] ' . $error->getMessage());
    kpi_data_respond(500, ['ok' => false, 'errors' => ['Server configuration error. Check the .env file.']]);
}

$url = trim((string) ($config['n8n']['kpi_data'] ?? ''));
$apiKey = (string) ($config['ppc']['api_key'] ?? '');
if ($url === '' || $apiKey === '') {
    kpi_data_respond(200, [
        'ok' => false,
        'configured' => false,
        'errors' => ['ClickUp KPI data is not connected: set N8N_WEBHOOK_KPI_DATA and PPC_API_KEY in the .env.'],
    ]);
}

$curl = curl_init($url);
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode(['userId' => $userId, 'month' => $month]),
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 120, // o n8n pagina as tarefas do mês
    CURLOPT_HTTPHEADER => [
        'Accept: application/json',
        'Content-Type: application/json',
        'X-API-Key: ' . $apiKey,
    ],
    CURLOPT_USERAGENT => 'Chili Finance Dashboard/1.0',
]);
$body = curl_exec($curl);
$code = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
$curlError = curl_error($curl);
curl_close($curl);

if ($curlError !== '' || !is_string($body)) {
    error_log('[kpi-data] curl: ' . $curlError);
    kpi_data_respond(502, ['ok' => false, 'errors' => ['Could not reach n8n.']]);
}
if ($code < 200 || $code >= 300) {
    error_log("[kpi-data] n8n answered HTTP {$code}");
    kpi_data_respond(502, ['ok' => false, 'errors' => ["n8n answered HTTP {$code}."]]);
}

$data = json_decode($body, true);
if (!is_array($data) || !isset($data['kpis']) || !is_array($data['kpis'])) {
    $errors = is_array($data) ? array_values(array_filter(array_map('strval', (array) ($data['errors'] ?? [])))) : [];
    kpi_data_respond(502, ['ok' => false, 'errors' => $errors !== [] ? $errors : ['n8n returned an unexpected response for the KPI data.']]);
}

$kpis = [];
foreach ([1, 3] as $n) {
    $item = is_array($data['kpis'][$n] ?? null) ? $data['kpis'][$n] : [];
    $kpis[$n] = [
        'value' => isset($item['value']) && is_numeric($item['value']) ? (float) $item['value'] : null,
        'note' => mb_substr(trim((string) ($item['note'] ?? '')), 0, 200),
    ];
}
$errors = array_values(array_filter(array_map(static fn ($e) => mb_substr(trim((string) $e), 0, 300), (array) ($data['errors'] ?? []))));

kpi_data_respond(200, [
    'ok' => ($data['ok'] ?? true) !== false && ($kpis[1]['value'] !== null || $kpis[3]['value'] !== null || $errors === []),
    'configured' => true,
    'userId' => $userId,
    'month' => $month,
    'kpis' => $kpis,
    'delivery' => is_array($data['delivery'] ?? null) ? $data['delivery'] : null,
    'time' => is_array($data['time'] ?? null) ? $data['time'] : null,
    'errors' => $errors,
    'fetchedAt' => isset($data['fetchedAt']) ? (string) $data['fetchedAt'] : gmdate('Y-m-d\TH:i:s\Z'),
]);

function kpi_data_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
