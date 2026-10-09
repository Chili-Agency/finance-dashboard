<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
require __DIR__ . '/seo-pagespeed.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const PAGESPEED_MAX_BYTES = 2 * 1024 * 1024;
const PAGESPEED_MAX_RESULTS = 500;
const PAGESPEED_STRATEGIES = ['mobile', 'desktop'];

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Allow: POST');
    respond(405, ['ok' => false, 'error' => 'Method not allowed.']);
}

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[seo-pagespeed-push] ' . $error->getMessage());
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

$body = (string) file_get_contents('php://input');
if ($body === '') {
    respond(400, ['ok' => false, 'error' => 'Empty body.']);
}
if (strlen($body) > PAGESPEED_MAX_BYTES) {
    respond(413, ['ok' => false, 'error' => 'Body larger than 2 MB.']);
}

$input = json_decode($body, true);
if (!is_array($input) || !isset($input['results']) || !is_array($input['results'])) {
    respond(422, ['ok' => false, 'error' => 'Expected a JSON object with a results list.']);
}

$strategy = (string) ($input['strategy'] ?? 'mobile');
if (!in_array($strategy, PAGESPEED_STRATEGIES, true)) {
    respond(422, ['ok' => false, 'error' => 'Unknown strategy. Accepted: ' . implode(', ', PAGESPEED_STRATEGIES) . '.']);
}

$measuredAt = isset($input['measuredAt']) ? strtotime((string) $input['measuredAt']) : false;
$measured = gmdate('Y-m-d H:i:s', $measuredAt !== false ? $measuredAt : time());

$rows = [];
foreach (array_slice($input['results'], 0, PAGESPEED_MAX_RESULTS) as $result) {
    if (!is_array($result)) {
        continue;
    }
    $domain = seo_domain_key((string) ($result['domain'] ?? ($result['url'] ?? '')));
    if ($domain === '') {
        continue;
    }
    $score = $result['score'] ?? null;
    $score = is_numeric($score) ? max(0, min(100, (int) round((float) $score))) : null;
    $error = isset($result['error']) && $result['error'] !== '' ? substr((string) $result['error'], 0, 500) : null;
    $rows[] = [
        $domain,
        substr((string) ($result['url'] ?? ''), 0, 500),
        $strategy,
        $score,
        $score === null ? ($error ?? 'No score returned.') : null,
        $measured,
    ];
}

if ($rows === []) {
    respond(422, ['ok' => false, 'error' => 'No valid results to save.']);
}

try {
    $pdo = auth_db();
    $pdo->beginTransaction();
    $insert = $pdo->prepare('INSERT INTO seo_pagespeed (domain, url, strategy, score, error, measured_at) VALUES (?, ?, ?, ?, ?, ?)');
    foreach ($rows as $row) {
        $insert->execute($row);
    }
    $pdo->commit();
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('[seo-pagespeed-push] ' . $error->getMessage());
    respond(500, ['ok' => false, 'error' => 'Could not save to the database: ' . $error->getMessage()]);
}

$scored = count(array_filter($rows, static fn (array $row): bool => $row[3] !== null));
respond(200, [
    'ok' => true,
    'saved' => count($rows),
    'scored' => $scored,
    'failed' => count($rows) - $scored,
    'at' => gmdate('Y-m-d\TH:i:s\Z'),
]);

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
