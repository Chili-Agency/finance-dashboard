<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const SCOPES = ['all', 'br', 'mx', 'pa', 'int'];
const CATEGORIES = ['all', 'seo', 'ppc'];

const FIELDS = [
    'totalMrrTarget' => ['total_mrr_target', 'money', 0, null],
];

const SELECT_ENTRY = "SELECT DATE_FORMAT(period_month, '%Y-%m') AS month, scope, category,
        total_mrr_target,
        DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS entered_at
    FROM mrr_targets";

try {
    $pdo = connect();

    switch ($_SERVER['REQUEST_METHOD'] ?? 'GET') {
        case 'GET':
            $rows = $pdo->query(SELECT_ENTRY . ' ORDER BY period_month, scope, category')->fetchAll();
            respond(200, ['entries' => array_map('toEntry', $rows)]);

        case 'POST':
            $input = json_decode((string) file_get_contents('php://input'), true);
            if (!is_array($input)) {
                respond(400, ['error' => 'Request body must be a JSON object.']);
            }
            $row = validate($input);
            respond(200, ['entry' => save($pdo, $row)]);

        default:
            header('Allow: GET, POST');
            respond(405, ['error' => 'Method not allowed.']);
    }
} catch (InvalidArgumentException $error) {
    respond(422, ['error' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('[targets] ' . $error->getMessage());
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

function validate(array $input): array
{
    $month = (string) ($input['month'] ?? '');
    if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month) !== 1) {
        throw new InvalidArgumentException('Month must look like 2026-06.');
    }
    $scope = (string) ($input['scope'] ?? '');
    if (!in_array($scope, SCOPES, true)) {
        throw new InvalidArgumentException('Unknown market.');
    }
    $category = (string) ($input['category'] ?? '');
    if (!in_array($category, CATEGORIES, true)) {
        throw new InvalidArgumentException('Unknown service line.');
    }

    $row = ['period_month' => $month . '-01', 'scope' => $scope, 'category' => $category];
    $filled = 0;

    foreach (FIELDS as $key => [$column, $kind, $min, $max]) {
        $value = $input[$key] ?? null;
        if ($value === null || $value === '') {
            $row[$column] = null;
            continue;
        }
        if (!is_numeric($value)) {
            throw new InvalidArgumentException("{$key} must be a number.");
        }
        $value = (float) $value;
        if (($min !== null && $value < $min) || ($max !== null && $value > $max)) {
            throw new InvalidArgumentException("{$key} is out of range.");
        }
        $row[$column] = $kind === 'money' ? round($value, 2) : round($value, 6);
        $filled++;
    }

    if ($filled === 0) {
        throw new InvalidArgumentException('Enter the Target MRR.');
    }
    return $row;
}

function save(PDO $pdo, array $row): array
{
    $pdo->prepare(
        'INSERT INTO mrr_targets
            (period_month, scope, category, total_mrr_target)
         VALUES
            (:period_month, :scope, :category, :total_mrr_target)
         ON DUPLICATE KEY UPDATE
            total_mrr_target = VALUES(total_mrr_target),
            updated_at = CURRENT_TIMESTAMP'
    )->execute($row);

    $select = $pdo->prepare(SELECT_ENTRY . ' WHERE period_month = ? AND scope = ? AND category = ?');
    $select->execute([$row['period_month'], $row['scope'], $row['category']]);
    return toEntry($select->fetch());
}

function toEntry(array $row): array
{
    $number = static fn ($value): ?float => $value === null ? null : (float) $value;
    return [
        'month' => $row['month'],
        'scope' => $row['scope'],
        'category' => $row['category'],
        'totalMrrTarget' => $number($row['total_mrr_target']),
        'enteredAt' => $row['entered_at'],
    ];
}

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}