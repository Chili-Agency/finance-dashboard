<?php
declare(strict_types=1);

/*
 * Usuários do ClickUp para o dropdown "Account manager" do Edit account map (aba Account health).
 * Chama o webhook do workflow "Chili Finance - Account Health (ClickUp users)" no n8n
 * (N8N_WEBHOOK_AH_CLICKUP_USERS) com o mesmo X-API-Key (PPC_API_KEY) dos outros webhooks de Account Health.
 * Só quem pode editar o account map consulta.
 */

require __DIR__ . '/auth.php';
$currentUser = auth_require_api();
auth_require_permission($currentUser, 'account_map');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const CLICKUP_USERS_MAX = 500;

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[clickup-users] ' . $error->getMessage());
    users_respond(500, ['ok' => false, 'users' => [], 'errors' => ['Server configuration error. Check the .env file.']]);
}

$url = trim((string) ($config['n8n']['ah_users'] ?? ''));
$apiKey = (string) ($config['ppc']['api_key'] ?? '');
if ($url === '' || $apiKey === '') {
    users_respond(200, [
        'ok' => false,
        'configured' => false,
        'users' => [],
        'errors' => ['ClickUp users are not connected: set N8N_WEBHOOK_AH_CLICKUP_USERS and PPC_API_KEY in the .env.'],
    ]);
}

$curl = curl_init($url);
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => '{}',
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 30,
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
    error_log('[clickup-users] curl: ' . $curlError);
    users_respond(502, ['ok' => false, 'users' => [], 'errors' => ['Could not reach n8n.']]);
}
if ($code < 200 || $code >= 300) {
    error_log("[clickup-users] n8n answered HTTP {$code}");
    users_respond(502, ['ok' => false, 'users' => [], 'errors' => ["n8n answered HTTP {$code}."]]);
}

$data = json_decode($body, true);
if (!is_array($data) || !isset($data['users']) || !is_array($data['users'])) {
    users_respond(502, ['ok' => false, 'users' => [], 'errors' => ['n8n returned an unexpected response for the ClickUp users.']]);
}
if (($data['ok'] ?? true) === false) {
    $errors = array_values(array_filter(array_map('strval', (array) ($data['errors'] ?? []))));
    users_respond(502, ['ok' => false, 'users' => [], 'errors' => $errors !== [] ? $errors : ['The ClickUp users workflow reported a failure.']]);
}

$users = [];
foreach ($data['users'] as $user) {
    if (!is_array($user)) {
        continue;
    }
    $username = trim((string) ($user['username'] ?? ''));
    if ($username === '' || mb_strlen($username) > 80) {
        continue;
    }
    $users[] = [
        'id' => (string) ($user['id'] ?? ''),
        'username' => $username,
        'email' => trim((string) ($user['email'] ?? '')),
    ];
    if (count($users) >= CLICKUP_USERS_MAX) {
        break;
    }
}

users_respond(200, [
    'ok' => $users !== [],
    'configured' => true,
    'users' => $users,
    'errors' => $users !== [] ? [] : ['ClickUp returned no users.'],
    'fetchedAt' => isset($data['fetchedAt']) ? (string) $data['fetchedAt'] : gmdate('Y-m-d\TH:i:s\Z'),
]);

function users_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
