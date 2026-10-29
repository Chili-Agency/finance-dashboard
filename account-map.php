<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
$currentUser = auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const MAP_SERVICES = ['seo', 'ppc', 'seo_ppc', 'smm'];
const MAP_MAX_ROWS = 500;

const SELECT_ACCOUNTS = "SELECT client_key, client_name, am, service, priority, next_action, updated_by,
        DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS entered_at
    FROM account_map";

try {
    $pdo = connect();

    switch ($_SERVER['REQUEST_METHOD'] ?? 'GET') {
        case 'GET':
            respond(200, ['ready' => true, 'accounts' => readAll($pdo)]);

        case 'POST':
            auth_require_permission($currentUser, 'account_map');
            if (!auth_check_csrf($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) {
                respond(403, ['error' => 'This page expired. Reload it and try again.']);
            }
            $input = json_decode((string) file_get_contents('php://input'), true);
            if (!is_array($input) || !isset($input['accounts']) || !is_array($input['accounts']) || $input['accounts'] === []) {
                respond(400, ['error' => 'Send the accounts as { "accounts": [...] }.']);
            }
            if (count($input['accounts']) > MAP_MAX_ROWS) {
                throw new InvalidArgumentException('Too many accounts in one save.');
            }
            $rows = array_map('validate', array_values($input['accounts']));
            $keys = array_column($rows, 'client_key');
            if (count($keys) !== count(array_unique($keys))) {
                throw new InvalidArgumentException('Each client can appear only once.');
            }
            save($pdo, $rows, (string) ($currentUser['email'] ?? ''));
            respond(200, ['ready' => true, 'accounts' => readAll($pdo)]);

        default:
            header('Allow: GET, POST');
            respond(405, ['error' => 'Method not allowed.']);
    }
} catch (InvalidArgumentException $error) {
    respond(422, ['error' => $error->getMessage()]);
} catch (PDOException $error) {
    if (($error->errorInfo[1] ?? null) === 1146) {
        respond(200, ['ready' => false, 'accounts' => [], 'error' => 'The account map table does not exist yet. Run sql/007_account_map.sql on the database.']);
    }
    error_log('[account-map] ' . $error->getMessage());
    respond(500, ['error' => 'Could not reach the database. Try again in a moment.']);
} catch (Throwable $error) {
    error_log('[account-map] ' . $error->getMessage());
    respond(500, ['error' => 'Could not reach the database. Try again in a moment.']);
}

function connect(): PDO
{
    $config = require __DIR__ . '/config.php';
    $db = $config['db'];
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $db['host'], $db['port'] ?? 3306, $db['name']);

    $pdo = new PDO($dsn, $db['user'], $db['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

function readAll(PDO $pdo): array
{
    return array_map('toAccount', $pdo->query(SELECT_ACCOUNTS . ' ORDER BY am, client_name')->fetchAll());
}

function text(array $account, string $key, string $label, int $max, bool $required = false): string
{
    $value = $account[$key] ?? '';
    if ($value !== null && !is_string($value)) {
        throw new InvalidArgumentException("{$label} must be text.");
    }
    $value = trim((string) preg_replace('/\s+/u', ' ', (string) $value));
    if ($required && $value === '') {
        throw new InvalidArgumentException("{$label} is required.");
    }
    if (mb_strlen($value) > $max) {
        throw new InvalidArgumentException("{$label} must have at most {$max} characters.");
    }
    return $value;
}

function validate(mixed $account): array
{
    if (!is_array($account)) {
        throw new InvalidArgumentException('Each account must be an object.');
    }
    $name = text($account, 'clientName', 'Client name', 190, true);
    $am = text($account, 'am', 'Account manager', 80);
    $service = text($account, 'service', 'Service', 20);
    if ($am !== '' && !in_array($service, MAP_SERVICES, true)) {
        throw new InvalidArgumentException("Choose a service for {$name}.");
    }
    $priority = text($account, 'priority', 'Priority', 40);
    $nextAction = text($account, 'nextAction', 'Next action', 255);

    return [
        'client_key' => text($account, 'clientKey', 'Client key', 190, true),
        'client_name' => $name,
        'am' => $am,
        'service' => $service,
        'priority' => $priority !== '' ? $priority : null,
        'next_action' => $nextAction !== '' ? $nextAction : null,
    ];
}

function save(PDO $pdo, array $rows, string $email): void
{
    $upsert = $pdo->prepare(
        'INSERT INTO account_map (client_key, client_name, am, service, priority, next_action, updated_by)
         VALUES (:client_key, :client_name, :am, :service, :priority, :next_action, :updated_by)
         ON DUPLICATE KEY UPDATE
            client_name = VALUES(client_name),
            am = VALUES(am),
            service = VALUES(service),
            priority = VALUES(priority),
            next_action = VALUES(next_action),
            updated_by = VALUES(updated_by),
            updated_at = CURRENT_TIMESTAMP'
    );
    $delete = $pdo->prepare('DELETE FROM account_map WHERE client_key = ?');
    $pdo->beginTransaction();
    try {
        foreach ($rows as $row) {
            if ($row['am'] === '') {
                $delete->execute([$row['client_key']]);
                continue;
            }
            $upsert->execute($row + ['updated_by' => $email !== '' ? $email : null]);
        }
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}

function toAccount(array $row): array
{
    return [
        'clientKey' => $row['client_key'],
        'clientName' => $row['client_name'],
        'am' => $row['am'],
        'service' => $row['service'],
        'priority' => $row['priority'],
        'nextAction' => $row['next_action'],
        'updatedBy' => $row['updated_by'],
        'enteredAt' => $row['entered_at'],
    ];
}

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
