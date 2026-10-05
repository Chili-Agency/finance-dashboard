<?php
declare(strict_types=1);

/*
 * Busca invoices (4 Xero), ads, custos de assinaturas (Xero banco), clientes e NPS (HubSpot) e vendas (HubSpot) no n8n e grava em data_snapshots (ver snapshots.php).
 *
 * Duas formas de chamar, sempre por POST:
 *   - agendamento do n8n: cabeçalho X-Refresh-Token igual ao FX_REFRESH_TOKEN do .env
 *     (o mesmo token do fx-refresh.php, então a credencial do n8n é a mesma);
 *   - botão Refresh do dashboard: sessão logada + cabeçalho X-CSRF-Token.
 * Abrir a página ou dar F5 não chama este endpoint.
 *
 * ?sources=sales (ou uma lista separada por vírgula: invoices, ads, costs, clients, sales) atualiza só essas fontes.
 * Sem o parâmetro, atualiza todas. "invoices" vale pelas quatro entidades do Xero.
 */

require __DIR__ . '/auth.php';
require __DIR__ . '/snapshots.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Allow: POST');
    respond(405, ['ok' => false, 'error' => 'Method not allowed.']);
}

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[snapshot-refresh] ' . $error->getMessage());
    respond(500, ['ok' => false, 'error' => 'Server configuration error. Check the .env file.']);
}

$token = (string) ($_SERVER['HTTP_X_REFRESH_TOKEN'] ?? '');
if ($token !== '') {
    $expected = (string) ($config['fx']['refresh_token'] ?? '');
    if ($expected === '') {
        respond(503, ['ok' => false, 'error' => 'FX_REFRESH_TOKEN is not set in .env, so scheduled refreshes are disabled.']);
    }
    if (!hash_equals($expected, $token)) {
        respond(401, ['ok' => false, 'error' => 'Invalid refresh token.']);
    }
    $updatedBy = 'schedule';
} else {
    $user = auth_user();
    if ($user === null) {
        respond(401, ['ok' => false, 'error' => 'Your session has ended. Sign in again.', 'auth' => false]);
    }
    if (!auth_check_csrf($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) {
        respond(403, ['ok' => false, 'error' => 'This page expired. Reload it and try again.']);
    }
    session_write_close(); // não segura a sessão durante a busca (as outras abas continuam funcionando)
    $updatedBy = (string) ($user['email'] ?? 'dashboard');
}

$only = null;
$requested = trim((string) ($_GET['sources'] ?? ''));
if ($requested !== '') {
    $aliases = ['invoices' => ['invoices_br', 'invoices_int', 'invoices_pa', 'invoices_mx']];
    $known = ['invoices_br', 'invoices_int', 'invoices_pa', 'invoices_mx', 'ads', 'costs', 'clients', 'sales'];
    $only = [];
    foreach (array_filter(array_map('trim', explode(',', strtolower($requested)))) as $name) {
        if (!isset($aliases[$name]) && !in_array($name, $known, true)) {
            respond(400, ['ok' => false, 'error' => "Unknown source: {$name}. Use invoices, ads, costs, clients or sales."]);
        }
        array_push($only, ...($aliases[$name] ?? [$name]));
    }
}

// A busca leva alguns segundos por fonte; não deixa o limite padrão do PHP (30 s) cortar no meio,
// nem o fechamento da aba interromper a gravação.
set_time_limit(420);
ignore_user_abort(true);

try {
    $result = snapshot_refresh(auth_db(), $config, $updatedBy, $only);
} catch (Throwable $error) {
    error_log('[snapshot-refresh] ' . $error->getMessage());
    respond(503, ['ok' => false, 'error' => $error->getMessage()]);
}

$labels = ['invoices_br' => 'Brazil', 'invoices_int' => 'International', 'invoices_pa' => 'Panama', 'invoices_mx' => 'Mexico', 'ads' => 'Ads', 'costs' => 'Subscription costs (Xero)', 'clients' => 'Clients and NPS (HubSpot)', 'sales' => 'Sales (HubSpot)'];
$errors = [];
foreach ($result['sources'] as $source) {
    if (!$source['ok']) {
        $errors[] = ($labels[$source['source']] ?? $source['source']) . ': ' . $source['error'];
    }
}
respond($result['ok'] ? 200 : 502, [
    'ok' => $result['ok'],
    'skipped' => $result['skipped'],
    'sources' => $result['sources'],
    'errors' => $errors,
    'at' => gmdate('Y-m-d\TH:i:s\Z'),
]);

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}