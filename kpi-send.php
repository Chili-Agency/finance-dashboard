<?php
declare(strict_types=1);

/*
 * Envia um scorecard SALVO ao ClickUp, pelo workflow do n8n "KPI Scorecard Creation Workflow"
 * (webhook POST /kpi-scorecard-send, N8N_WEBHOOK_KPI_SEND). Só admin (permissão kpi_scorecard).
 * POST { "name": "KPI-202609-Cunha-Giovanna-PPC" }
 *
 * O registro é lido do banco aqui (a página não manda o conteúdo), então o que vai ao ClickUp é sempre o que está salvo.
 * Se o n8n confirmar (ok = true), grava sent_at e os links do ClickUp no próprio registro (payload.clickup).
 * Se o n8n devolver ok = false (algum campo não gravou), NÃO marca como enviado; reenviar atualiza a mesma subtask.
 */

require __DIR__ . '/auth.php';
$currentUser = auth_require_api();
auth_require_permission($currentUser, 'kpi_scorecard');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const KPI_SEND_TIMEOUT = 240; // o n8n grava um campo por vez (mais de 60 chamadas ao ClickUp)
const KPI_CLICKUP_URL_PREFIX = 'https://app.clickup.com/';

// O n8n grava um campo por vez e pode passar de 30 s (limite padrão do PHP; no XAMPP/Windows ele conta tempo de relógio).
@set_time_limit(KPI_SEND_TIMEOUT + 30);
// Se a aba fechar no meio do envio, ainda registra o resultado quando o n8n responder.
ignore_user_abort(true);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Allow: POST');
    kpi_send_respond(405, ['ok' => false, 'error' => 'Method not allowed.']);
}
if (!auth_check_csrf($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) {
    kpi_send_respond(403, ['ok' => false, 'error' => 'This page expired. Reload it and try again.']);
}

$input = json_decode((string) file_get_contents('php://input'), true);
$name = is_array($input) ? trim((string) ($input['name'] ?? '')) : '';
if ($name === '') {
    kpi_send_respond(400, ['ok' => false, 'error' => 'Send the scorecard name.']);
}

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[kpi-send] ' . $error->getMessage());
    kpi_send_respond(500, ['ok' => false, 'error' => 'Server configuration error. Check the .env file.']);
}

$url = trim((string) ($config['n8n']['kpi_send'] ?? ''));
$apiKey = (string) ($config['ppc']['api_key'] ?? '');
if ($url === '' || $apiKey === '') {
    kpi_send_respond(200, ['ok' => false, 'configured' => false, 'error' => 'Sending to ClickUp is not connected: set N8N_WEBHOOK_KPI_SEND and PPC_API_KEY in the .env.']);
}

try {
    $pdo = auth_db();
    $pdo->exec("SET time_zone = '+00:00'");
    $select = $pdo->prepare('SELECT name, period, service, clickup_id, user_name, payload FROM kpi_scorecards WHERE name = ?');
    $select->execute([$name]);
    $row = $select->fetch();
} catch (PDOException $error) {
    error_log('[kpi-send] ' . $error->getMessage());
    kpi_send_respond(500, ['ok' => false, 'error' => 'Could not reach the database. Try again in a moment.']);
}
if (!is_array($row)) {
    kpi_send_respond(404, ['ok' => false, 'error' => 'That scorecard is not saved. Save it first.']);
}
$payload = json_decode((string) $row['payload'], true);
if (!is_array($payload)) {
    kpi_send_respond(500, ['ok' => false, 'error' => 'The saved scorecard is unreadable. Save it again.']);
}
unset($payload['clickup']); // links de um envio anterior não vão ao n8n

$request = json_encode([
    'name' => $row['name'],
    'period' => $row['period'],
    'service' => $row['service'],
    'userId' => $row['clickup_id'],
    'userName' => $row['user_name'],
    'payload' => $payload,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

$curl = curl_init($url);
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $request,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => KPI_SEND_TIMEOUT,
    CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json', 'X-API-Key: ' . $apiKey],
    CURLOPT_USERAGENT => 'Chili Finance Dashboard/1.0',
]);
$body = curl_exec($curl);
$code = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
$curlError = curl_error($curl);
curl_close($curl);

if ($curlError !== '' || !is_string($body)) {
    error_log('[kpi-send] curl: ' . $curlError);
    kpi_send_respond(502, ['ok' => false, 'error' => 'Could not reach n8n, or it took too long. Check ClickUp before sending again: the subtask may already exist.']);
}
if ($code < 200 || $code >= 300) {
    error_log("[kpi-send] n8n answered HTTP {$code}");
    kpi_send_respond(502, ['ok' => false, 'error' => "n8n answered HTTP {$code}. Is the workflow published?"]);
}

$data = json_decode($body, true);
if (!is_array($data) || !array_key_exists('ok', $data)) {
    kpi_send_respond(502, ['ok' => false, 'error' => 'n8n returned an unexpected response.']);
}
if (isset($data['errors']) && is_array($data['errors']) && $data['ok'] === false && empty($data['subtaskId'])) {
    $messages = array_values(array_filter(array_map(static fn ($e) => mb_substr(trim((string) $e), 0, 200), $data['errors'])));
    kpi_send_respond(422, ['ok' => false, 'error' => $messages !== [] ? implode(' · ', $messages) : 'n8n rejected the scorecard.']);
}

$safeUrl = static function (mixed $value): ?string {
    $text = is_string($value) ? trim($value) : '';
    return $text !== '' && strncmp($text, KPI_CLICKUP_URL_PREFIX, strlen(KPI_CLICKUP_URL_PREFIX)) === 0 ? mb_substr($text, 0, 300) : null;
};
$failures = [];
foreach (array_slice((array) ($data['failures'] ?? []), 0, 20) as $failure) {
    if (is_array($failure)) {
        $failures[] = [
            'field' => mb_substr(trim((string) ($failure['field'] ?? '')), 0, 80),
            'status' => $failure['status'] ?? null,
            'reason' => mb_substr(trim((string) ($failure['reason'] ?? '')), 0, 200),
        ];
    }
}
$warnings = array_slice(array_values(array_filter(array_map(static fn ($w) => mb_substr(trim((string) $w), 0, 200), (array) ($data['warnings'] ?? [])))), 0, 10);
$result = [
    'action' => in_array($data['action'] ?? '', ['created', 'updated'], true) ? $data['action'] : null,
    'parentCreated' => ($data['parentCreated'] ?? false) === true,
    'parentTaskUrl' => $safeUrl($data['parentTaskUrl'] ?? null),
    'subtaskUrl' => $safeUrl($data['subtaskUrl'] ?? null),
    'fieldsSet' => is_numeric($data['fieldsSet'] ?? null) ? (int) $data['fieldsSet'] : null,
    'failures' => $failures,
    'warnings' => $warnings,
];
$ok = $data['ok'] === true && $failures === [];

if ($ok) {
    try {
        $payload['clickup'] = [
            'action' => $result['action'],
            'parentTaskUrl' => $result['parentTaskUrl'],
            'subtaskUrl' => $result['subtaskUrl'],
            'sentAt' => gmdate('Y-m-d\TH:i:s\Z'),
            'sentBy' => (string) ($currentUser['email'] ?? ''),
        ];
        // updated_at = updated_at: enviar não conta como edição (a página compara updated_at com sent_at).
        $pdo->prepare('UPDATE kpi_scorecards SET payload = ?, sent_at = UTC_TIMESTAMP(), updated_at = updated_at WHERE name = ?')
            ->execute([json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), $row['name']]);
    } catch (Throwable $error) {
        error_log('[kpi-send] mark sent: ' . $error->getMessage());
        kpi_send_respond(200, ['ok' => true, 'result' => $result, 'warning' => 'Sent to ClickUp, but the dashboard could not record it. Do not send again; reload the page.']);
    }
}

kpi_send_respond(200, ['ok' => $ok, 'result' => $result]);

function kpi_send_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
