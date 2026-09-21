<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
$currentUser = auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const RULE_SCOPES = ['mx', 'pa', 'int'];

const SELECT_RULES = "SELECT scope, late_fee, monthly_interest, grace_days, updated_by,
        DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS entered_at
    FROM late_charge_rules";

try {
    $pdo = connect();

    switch ($_SERVER['REQUEST_METHOD'] ?? 'GET') {
        case 'GET':
            respond(200, ['rules' => array_map('toRule', $pdo->query(SELECT_RULES . ' ORDER BY scope')->fetchAll())]);

        case 'POST':
            $input = json_decode((string) file_get_contents('php://input'), true);
            if (!is_array($input) || !isset($input['rules']) || !is_array($input['rules']) || $input['rules'] === []) {
                respond(400, ['error' => 'Send the rates as { "rules": [...] }.']);
            }
            $rows = array_map('validate', array_values($input['rules']));
            $scopes = array_column($rows, 'scope');
            if (count($scopes) !== count(array_unique($scopes))) {
                throw new InvalidArgumentException('Each market can appear only once.');
            }
            save($pdo, $rows, (string) ($currentUser['email'] ?? ''));
            respond(200, ['rules' => array_map('toRule', $pdo->query(SELECT_RULES . ' ORDER BY scope')->fetchAll())]);

        default:
            header('Allow: GET, POST');
            respond(405, ['error' => 'Method not allowed.']);
    }
} catch (InvalidArgumentException $error) {
    respond(422, ['error' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('[late-rules] ' . $error->getMessage());
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

function validate(mixed $rule): array
{
    if (!is_array($rule)) {
        throw new InvalidArgumentException('Each rate must be an object.');
    }
    $scope = (string) ($rule['scope'] ?? '');
    if (!in_array($scope, RULE_SCOPES, true)) {
        throw new InvalidArgumentException($scope === 'br'
            ? 'Brazil follows its own rule and cannot be edited here.'
            : 'Unknown market.');
    }
    $fraction = static function (string $key, string $label) use ($rule): float {
        $value = $rule[$key] ?? 0;
        if ($value === null || $value === '') {
            return 0.0;
        }
        if (!is_numeric($value)) {
            throw new InvalidArgumentException("{$label} must be a number.");
        }
        $value = (float) $value;
        if ($value < 0 || $value > 1) {
            throw new InvalidArgumentException("{$label} must be between 0% and 100%.");
        }
        return round($value, 6);
    };
    $grace = $rule['graceDays'] ?? 0;
    if ($grace === null || $grace === '') {
        $grace = 0;
    }
    if (!is_numeric($grace) || (float) $grace < 0 || (float) $grace > 365 || floor((float) $grace) != (float) $grace) {
        throw new InvalidArgumentException('Grace period must be a whole number of days, from 0 to 365.');
    }

    return [
        'scope' => $scope,
        'late_fee' => $fraction('lateFee', 'Late fee'),
        'monthly_interest' => $fraction('monthlyInterest', 'Monthly interest'),
        'grace_days' => (int) $grace,
    ];
}

function save(PDO $pdo, array $rows, string $email): void
{
    $statement = $pdo->prepare(
        'INSERT INTO late_charge_rules (scope, late_fee, monthly_interest, grace_days, updated_by)
         VALUES (:scope, :late_fee, :monthly_interest, :grace_days, :updated_by)
         ON DUPLICATE KEY UPDATE
            late_fee = VALUES(late_fee),
            monthly_interest = VALUES(monthly_interest),
            grace_days = VALUES(grace_days),
            updated_by = VALUES(updated_by),
            updated_at = CURRENT_TIMESTAMP'
    );
    $pdo->beginTransaction();
    try {
        foreach ($rows as $row) {
            $statement->execute($row + ['updated_by' => $email !== '' ? $email : null]);
        }
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}

function toRule(array $row): array
{
    return [
        'scope' => $row['scope'],
        'lateFee' => (float) $row['late_fee'],
        'monthlyInterest' => (float) $row['monthly_interest'],
        'graceDays' => (int) $row['grace_days'],
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