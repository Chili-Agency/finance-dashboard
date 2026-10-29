<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
$currentUser = auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const GROWTH_KINDS = ['referral', 'upsell', 'crosssell'];
const GROWTH_STATUSES = ['open', 'won', 'lost'];
const GROWTH_MAX_ROWS = 1000;

const SELECT_GROWTH = "SELECT id, DATE_FORMAT(logged_on, '%Y-%m-%d') AS logged_on, person, kind, client_name, mrr, status, note, updated_by,
        DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS entered_at
    FROM growth_log";

try {
    $pdo = connect();

    switch ($_SERVER['REQUEST_METHOD'] ?? 'GET') {
        case 'GET':
            respond(200, ['ready' => true, 'entries' => readAll($pdo)]);

        case 'POST':
            auth_require_permission($currentUser, 'account_map');
            if (!auth_check_csrf($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) {
                respond(403, ['error' => 'This page expired. Reload it and try again.']);
            }
            $input = json_decode((string) file_get_contents('php://input'), true);
            if (!is_array($input)) {
                respond(400, ['error' => 'Send { "entry": {...} } or { "delete": id }.']);
            }
            if (isset($input['delete'])) {
                $pdo->prepare('DELETE FROM growth_log WHERE id = ?')->execute([(int) $input['delete']]);
            } elseif (isset($input['entry']) && is_array($input['entry'])) {
                save($pdo, validate($input['entry']), (string) ($currentUser['email'] ?? ''));
            } else {
                respond(400, ['error' => 'Send { "entry": {...} } or { "delete": id }.']);
            }
            respond(200, ['ready' => true, 'entries' => readAll($pdo)]);

        default:
            header('Allow: GET, POST');
            respond(405, ['error' => 'Method not allowed.']);
    }
} catch (InvalidArgumentException $error) {
    respond(422, ['error' => $error->getMessage()]);
} catch (PDOException $error) {
    if (($error->errorInfo[1] ?? null) === 1146) {
        respond(200, ['ready' => false, 'entries' => [], 'error' => 'The growth log table does not exist yet. Run sql/008_growth_log.sql on the database.']);
    }
    error_log('[growth-log] ' . $error->getMessage());
    respond(500, ['error' => 'Could not reach the database. Try again in a moment.']);
} catch (Throwable $error) {
    error_log('[growth-log] ' . $error->getMessage());
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
    return array_map('toEntry', $pdo->query(SELECT_GROWTH . ' ORDER BY logged_on DESC, id DESC LIMIT ' . GROWTH_MAX_ROWS)->fetchAll());
}

function text(array $entry, string $key, string $label, int $max, bool $required = false): string
{
    $value = $entry[$key] ?? '';
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

function validate(array $entry): array
{
    $loggedOn = text($entry, 'loggedOn', 'Date', 10, true);
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $loggedOn);
    if ($date === false || $date->format('Y-m-d') !== $loggedOn) {
        throw new InvalidArgumentException('Date must look like 2026-10-29.');
    }
    $kind = text($entry, 'kind', 'Type', 20, true);
    if (!in_array($kind, GROWTH_KINDS, true)) {
        throw new InvalidArgumentException('Choose referral, upsell or cross-sell.');
    }
    $status = text($entry, 'status', 'Status', 10, true);
    if (!in_array($status, GROWTH_STATUSES, true)) {
        throw new InvalidArgumentException('Choose open, won or lost.');
    }
    $mrr = $entry['mrr'] ?? null;
    if ($mrr === '' || $mrr === null) {
        $mrr = null;
    } elseif (!is_numeric($mrr) || (float) $mrr < 0 || (float) $mrr > 10000000) {
        throw new InvalidArgumentException('MRR must be a positive number.');
    } else {
        $mrr = round((float) $mrr, 2);
    }
    if ($status === 'won' && $mrr === null) {
        throw new InvalidArgumentException('A won entry needs its monthly value (MRR).');
    }
    $note = text($entry, 'note', 'Note', 255);

    return [
        'id' => isset($entry['id']) && is_numeric($entry['id']) ? (int) $entry['id'] : null,
        'logged_on' => $loggedOn,
        'person' => text($entry, 'person', 'Person', 80, true),
        'kind' => $kind,
        'client_name' => text($entry, 'clientName', 'Client', 190, true),
        'mrr' => $mrr,
        'status' => $status,
        'note' => $note !== '' ? $note : null,
    ];
}

function save(PDO $pdo, array $row, string $email): void
{
    $values = [
        'logged_on' => $row['logged_on'],
        'person' => $row['person'],
        'kind' => $row['kind'],
        'client_name' => $row['client_name'],
        'mrr' => $row['mrr'],
        'status' => $row['status'],
        'note' => $row['note'],
        'updated_by' => $email !== '' ? $email : null,
    ];
    if ($row['id'] === null) {
        $count = (int) $pdo->query('SELECT COUNT(*) FROM growth_log')->fetchColumn();
        if ($count >= GROWTH_MAX_ROWS * 5) {
            throw new InvalidArgumentException('The growth log is full.');
        }
        $pdo->prepare(
            'INSERT INTO growth_log (logged_on, person, kind, client_name, mrr, status, note, updated_by)
             VALUES (:logged_on, :person, :kind, :client_name, :mrr, :status, :note, :updated_by)'
        )->execute($values);
        return;
    }
    $statement = $pdo->prepare(
        'UPDATE growth_log SET logged_on = :logged_on, person = :person, kind = :kind, client_name = :client_name,
            mrr = :mrr, status = :status, note = :note, updated_by = :updated_by
         WHERE id = :id'
    );
    $statement->execute($values + ['id' => $row['id']]);
}

function toEntry(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'loggedOn' => $row['logged_on'],
        'person' => $row['person'],
        'kind' => $row['kind'],
        'clientName' => $row['client_name'],
        'mrr' => $row['mrr'] !== null ? (float) $row['mrr'] : null,
        'status' => $row['status'],
        'note' => $row['note'],
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
