<?php
declare(strict_types=1);

/*
 * Meta de receita de vendas (deals ganhos) por mês, mercado, linha de serviço e vendedor.
 * Tabela sales_targets, ver sql/005_sales_targets.sql e sql/008_sales_targets_owner.sql.
 * Mesma lógica de targets.php: a visão Global/All soma as entradas por mercado e serviço
 * quando não há uma exata. ownerId 'all' é a meta da empresa; um id é a meta de um vendedor
 * (o id do owner no HubSpot, o mesmo dos deals).
 */

require __DIR__ . '/auth.php';
$currentUser = auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const SCOPES = ['all', 'br', 'mx', 'pa', 'int'];
const CATEGORIES = ['all', 'seo', 'ppc', 'others'];

/**
 * Banco ainda sem a coluna owner_id (sql/008 não rodou): todas as metas valem para a empresa,
 * como antes, e só não dá para gravar meta de um vendedor.
 */
function hasOwnerColumn(PDO $pdo): bool
{
    static $has = null;
    if ($has === null) {
        $check = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_targets' AND COLUMN_NAME = 'owner_id'"
        );
        $has = (int) $check->fetchColumn() > 0;
    }
    return $has;
}

function selectEntry(PDO $pdo): string
{
    return "SELECT DATE_FORMAT(period_month, '%Y-%m') AS month, scope, category, "
        . (hasOwnerColumn($pdo) ? 'owner_id' : "'all' AS owner_id")
        . ", revenue_target, updated_by, DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS entered_at
    FROM sales_targets";
}

try {
    $pdo = auth_db();
    $pdo->exec("SET time_zone = '+00:00'");

    switch ($_SERVER['REQUEST_METHOD'] ?? 'GET') {
        case 'GET':
            $rows = $pdo->query(selectEntry($pdo) . ' ORDER BY period_month, scope, category')->fetchAll();
            respond(200, ['entries' => array_map('toEntry', $rows)]);

        case 'POST':

            auth_require_permission($currentUser, 'sales_targets');
            if (!auth_check_csrf($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) {
                respond(403, ['error' => 'This page expired. Reload it and try again.']);
            }
            $input = json_decode((string) file_get_contents('php://input'), true);
            if (!is_array($input)) {
                respond(400, ['error' => 'Request body must be a JSON object.']);
            }
            respond(200, ['entry' => save($pdo, validate($input, $pdo), (string) ($currentUser['email'] ?? ''))]);

        default:
            header('Allow: GET, POST');
            respond(405, ['error' => 'Method not allowed.']);
    }
} catch (InvalidArgumentException $error) {
    respond(422, ['error' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('[sales-targets] ' . $error->getMessage());
    $missingTable = $error instanceof PDOException && str_contains($error->getMessage(), 'sales_targets');
    respond(500, ['error' => $missingTable
        ? 'The sales_targets table is missing. Run sql/005_sales_targets.sql.'
        : 'Could not reach the database. Try again in a moment.']);
}

function validate(array $input, PDO $pdo): array
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
    // Vendedor: 'all' (meta da empresa) ou o id numérico do owner no HubSpot.
    $owner = trim((string) ($input['ownerId'] ?? 'all'));
    if ($owner === '') {
        $owner = 'all';
    }
    if ($owner !== 'all' && preg_match('/^\d{1,20}$/', $owner) !== 1) {
        throw new InvalidArgumentException('Unknown salesperson.');
    }
    if ($owner !== 'all' && !hasOwnerColumn($pdo)) {
        throw new InvalidArgumentException('Targets by salesperson need the database update: run sql/008_sales_targets_owner.sql.');
    }
    $value = $input['revenueTarget'] ?? null;
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new InvalidArgumentException('Enter the revenue target.');
    }
    if ((float) $value < 0) {
        throw new InvalidArgumentException('The revenue target cannot be negative.');
    }
    return ['period_month' => $month . '-01', 'scope' => $scope, 'category' => $category, 'owner_id' => $owner, 'revenue_target' => round((float) $value, 2)];
}

function save(PDO $pdo, array $row, string $email): array
{
    $withOwner = hasOwnerColumn($pdo);
    $values = $row + ['updated_by' => $email !== '' ? $email : null];
    if (!$withOwner) {
        unset($values['owner_id']); // banco sem a coluna: só a meta da empresa (validate() já barrou as de vendedor)
    }
    $pdo->prepare(
        'INSERT INTO sales_targets (period_month, scope, category, ' . ($withOwner ? 'owner_id, ' : '') . 'revenue_target, updated_by)
         VALUES (:period_month, :scope, :category, ' . ($withOwner ? ':owner_id, ' : '') . ':revenue_target, :updated_by)
         ON DUPLICATE KEY UPDATE
            revenue_target = VALUES(revenue_target),
            updated_by = VALUES(updated_by),
            updated_at = CURRENT_TIMESTAMP'
    )->execute($values);

    $select = $pdo->prepare(selectEntry($pdo) . ' WHERE period_month = ? AND scope = ? AND category = ?' . ($withOwner ? ' AND owner_id = ?' : ''));
    $select->execute($withOwner
        ? [$row['period_month'], $row['scope'], $row['category'], $row['owner_id']]
        : [$row['period_month'], $row['scope'], $row['category']]);
    return toEntry($select->fetch());
}

function toEntry(array $row): array
{
    return [
        'month' => $row['month'],
        'scope' => $row['scope'],
        'category' => $row['category'],
        'ownerId' => (string) ($row['owner_id'] ?? 'all'),
        'revenueTarget' => $row['revenue_target'] === null ? null : (float) $row['revenue_target'],
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