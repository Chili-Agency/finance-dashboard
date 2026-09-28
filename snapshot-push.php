<?php
declare(strict_types=1);

/*
 * Recebe do n8n o resultado de uma fonte que roda em segundo plano (hoje só "sales", o HubSpot)
 * e grava em data_snapshots.
 *
 * Por quê: a busca do HubSpot leva minutos, e o n8n cloud corta com HTTP 524 qualquer webhook que
 * demore mais de 100 s para responder. Então o webhook responde na hora ("comecei") e, no fim,
 * o workflow faz POST do resultado aqui:
 *
 *   POST snapshot-push.php?source=sales
 *   X-Refresh-Token: <FX_REFRESH_TOKEN do .env>
 *   corpo: o JSON do nó "Montar resposta"
 *
 * Se o resultado vier com ok:false ou num formato inesperado, a última resposta boa continua
 * valendo e o erro fica registrado, como no snapshot-refresh.php.
 */

require __DIR__ . '/auth.php'; // só pelo auth_db(); nenhuma sessão é aberta aqui
require __DIR__ . '/snapshots.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const PUSH_MAX_BYTES = 32 * 1024 * 1024;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Allow: POST');
    respond(405, ['ok' => false, 'error' => 'Method not allowed.']);
}

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[snapshot-push] ' . $error->getMessage());
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

$source = (string) ($_GET['source'] ?? '');
if (!in_array($source, SNAPSHOT_ASYNC, true)) {
    respond(400, ['ok' => false, 'error' => 'Unknown source. Accepted: ' . implode(', ', SNAPSHOT_ASYNC) . '.']);
}

$body = (string) file_get_contents('php://input');
if ($body === '') {
    respond(400, ['ok' => false, 'error' => 'Empty body.']);
}
if (strlen($body) > PUSH_MAX_BYTES) {
    respond(413, ['ok' => false, 'error' => 'Body larger than 32 MB.']);
}

set_time_limit(120);
ignore_user_abort(true);
$seconds = isset($_GET['seconds']) && is_numeric($_GET['seconds']) ? (float) $_GET['seconds'] : null;

try {
    $pdo = auth_db();
    $error = snapshot_validate($source, $body);
    if ($error === null) {
        snapshot_save($pdo, $source, $body, $seconds, 'n8n');
    } else {
        snapshot_save_error($pdo, $source, $error, 'n8n');
        error_log("[snapshot-push] {$source}: {$error}");
    }
} catch (Throwable $saveError) {
    error_log('[snapshot-push] ' . $saveError->getMessage());
    respond(500, ['ok' => false, 'error' => 'Could not save to the database: ' . $saveError->getMessage()]);
}

respond($error === null ? 200 : 422, [
    'ok' => $error === null,
    'source' => $source,
    'bytes' => strlen($body),
    'error' => $error,
    'at' => gmdate('Y-m-d\TH:i:s\Z'),
]);

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}