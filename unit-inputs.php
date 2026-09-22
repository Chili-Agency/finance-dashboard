<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const SCOPES = ['all', 'br', 'mx', 'pa', 'int'];
const CATEGORIES = ['all', 'seo', 'ppc', 'others'];

const FIELDS = [
    'salesMarketingCost' => ['sales_marketing_cost', 'money', 0, null],
    'newClients' => ['new_clients', 'count', 0, null],
    'marketingCost' => ['marketing_cost', 'money', 0, null],
    'leads' => ['leads', 'count', 0, null],
];

const SELECT_ENTRY = "SELECT DATE_FORMAT(period_month, '%Y-%m') AS month, scope, category,
        sales_marketing_cost, new_clients, marketing_cost, leads,
        DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS entered_at
    FROM unit_inputs";

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
    error_log('[unit-inputs] ' . $error->getMessage());
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
        $row[$column] = match ($kind) {
            'money' => round($value, 2),
            'count' => (int) round($value),
            default => round($value, 6),
        };
        $filled++;
    }

    if ($filled === 0) {
        throw new InvalidArgumentException('Fill in at least one figure.');
    }
    return $row;
}

function save(PDO $pdo, array $row): array
{
    $pdo->prepare(
        'INSERT INTO unit_inputs
            (period_month, scope, category, sales_marketing_cost, new_clients, marketing_cost, leads)
         VALUES
            (:period_month, :scope, :category, :sales_marketing_cost, :new_clients, :marketing_cost, :leads)
         ON DUPLICATE KEY UPDATE
            sales_marketing_cost = VALUES(sales_marketing_cost),
            new_clients = VALUES(new_clients),
            marketing_cost = VALUES(marketing_cost),
            leads = VALUES(leads),
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
        'salesMarketingCost' => $number($row['sales_marketing_cost']),
        'newClients' => $row['new_clients'] === null ? null : (int) $row['new_clients'],
        'marketingCost' => $number($row['marketing_cost']),
        'leads' => $row['leads'] === null ? null : (int) $row['leads'],
        'enteredAt' => $row['entered_at'],
    ];
}

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}