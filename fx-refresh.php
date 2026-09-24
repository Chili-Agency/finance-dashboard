<?php
declare(strict_types=1);

/*
 * Grava a cotação do mês corrente em fx_monthly_rates. Chamado pelo workflow do n8n
 * "Chili Finance - Cotacao mensal (FX)", num Schedule Trigger em poucos dias do mês.
 *
 * Não usa o login do dashboard: exige POST com o cabeçalho X-Refresh-Token igual ao
 * FX_REFRESH_TOKEN do .env. Sem FX_REFRESH_TOKEN configurado, o endpoint fica desligado.
 */

require __DIR__ . '/auth.php'; // só pelo auth_db(); nenhuma sessão é aberta aqui
require __DIR__ . '/fx-rates.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Allow: POST');
    respond(405, ['ok' => false, 'error' => 'Method not allowed.']);
}

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[fx-refresh] ' . $error->getMessage());
    respond(500, ['ok' => false, 'error' => 'Server configuration error. Check the .env file.']);
}

$expected = (string) ($config['fx']['refresh_token'] ?? '');
if ($expected === '') {
    respond(503, ['ok' => false, 'error' => 'FX_REFRESH_TOKEN is not set in .env, so this endpoint is disabled.']);
}
$token = (string) ($_SERVER['HTTP_X_REFRESH_TOKEN'] ?? '');
if ($token === '' || !hash_equals($expected, $token)) {
    respond(401, ['ok' => false, 'error' => 'Invalid refresh token.']);
}

try {
    $fx = new FxRates(auth_db(), (string) ($config['fx']['oer_app_id'] ?? ''));
    $result = $fx->refresh();
    $errors = $fx->errors();
    $body = [
        'ok' => $errors === [],
        'month' => $result['month'],
        'fetched' => $result['fetched'],
        'skipped' => $result['skipped'],
        'errors' => $errors,
        'rates' => $fx->currentRows(),
        'at' => gmdate('Y-m-d\TH:i:s\Z'),
    ];
} catch (Throwable $error) {
    error_log('[fx-refresh] ' . $error->getMessage());
    respond(500, ['ok' => false, 'error' => 'Could not reach the database. Try again in a moment.']);
}

respond($body['ok'] ? 200 : 502, $body);

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}