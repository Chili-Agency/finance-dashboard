<?php
declare(strict_types=1);

/*
 * Metas por tier da página Sales (tabela sales_goals, ver sql/007_sales_goals.sql).
 *
 * Cada meta tem nome/tier livre, valor (USD, por mês), vendedor, mercado e serviço.
 * Não há lista fixa de tiers nem limite de linhas: criar outro tier é gravar outra meta.
 * 'all' em vendedor, mercado ou serviço significa "vale para qualquer um".
 *
 *   GET  -> { goals: [{id, name, amount, ownerId, ownerName, scope, category, updatedBy, enteredAt}] }
 *   POST -> { goal: {...} }            grava (sem id cria; com id edita)
 *   POST {action:'delete', id}         -> { deleted: id }
 *
 * Quem grava: perfis com a permissão sales_targets (a mesma da meta de vendas).
 * Não confundir com sales-goals.php, que lê as metas (Goals) do HubSpot.
 */

require __DIR__ . '/auth.php';
$currentUser = auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const GOAL_SCOPES = ['all', 'br', 'mx', 'pa', 'int'];
const GOAL_CATEGORIES = ['all', 'seo', 'ppc', 'others'];
const GOAL_MAX_AMOUNT = 999999999999.99;

const GOAL_SELECT = "SELECT id, name, amount, owner_id, owner_name, scope, category, updated_by,
        DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS entered_at
    FROM sales_goals";

try {
    $pdo = auth_db();
    $pdo->exec("SET time_zone = '+00:00'");

    switch ($_SERVER['REQUEST_METHOD'] ?? 'GET') {
        case 'GET':
            $rows = $pdo->query(GOAL_SELECT . ' ORDER BY amount, name, id')->fetchAll();
            respond(200, ['goals' => array_map('goalEntry', $rows)]);

        case 'POST':
            auth_require_permission($currentUser, 'sales_targets');
            if (!auth_check_csrf($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) {
                respond(403, ['error' => 'This page expired. Reload it and try again.']);
            }
            $input = json_decode((string) file_get_contents('php://input'), true);
            if (!is_array($input)) {
                respond(400, ['error' => 'Request body must be a JSON object.']);
            }
            $email = (string) ($currentUser['email'] ?? '');
            if (($input['action'] ?? '') === 'delete') {
                respond(200, ['deleted' => removeGoal($pdo, $input['id'] ?? null)]);
            }
            respond(200, ['goal' => saveGoal($pdo, validateGoal($input), $email)]);

        default:
            header('Allow: GET, POST');
            respond(405, ['error' => 'Method not allowed.']);
    }
} catch (InvalidArgumentException $error) {
    respond(422, ['error' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('[goals] ' . $error->getMessage());
    $missingTable = $error instanceof PDOException && str_contains($error->getMessage(), 'sales_goals');
    respond(500, ['error' => $missingTable
        ? 'The sales_goals table is missing. Run sql/007_sales_goals.sql.'
        : 'Could not reach the database. Try again in a moment.']);
}

function validateGoal(array $input): array
{
    $id = $input['id'] ?? null;
    if ($id !== null && $id !== '' && (!is_numeric($id) || (int) $id < 1)) {
        throw new InvalidArgumentException('Unknown goal.');
    }

    $name = trim((string) preg_replace('/\s+/u', ' ', (string) ($input['name'] ?? '')));
    if ($name === '') {
        throw new InvalidArgumentException('Give the goal a name, for example Tier 1.');
    }
    if (goalLength($name) > 80) {
        throw new InvalidArgumentException('The goal name can have at most 80 characters.');
    }

    $amount = $input['amount'] ?? null;
    if ($amount === null || $amount === '' || !is_numeric($amount)) {
        throw new InvalidArgumentException('Enter the goal amount in USD.');
    }
    if ((float) $amount <= 0) {
        throw new InvalidArgumentException('The goal amount must be greater than zero.');
    }
    if ((float) $amount > GOAL_MAX_AMOUNT) {
        throw new InvalidArgumentException('The goal amount is too large.');
    }

    // Vendedor: 'all' ou o id numérico do owner no HubSpot.
    $owner = trim((string) ($input['ownerId'] ?? 'all'));
    if ($owner === '') {
        $owner = 'all';
    }
    if ($owner !== 'all' && preg_match('/^\d{1,20}$/', $owner) !== 1) {
        throw new InvalidArgumentException('Unknown salesperson.');
    }
    $ownerName = trim((string) ($input['ownerName'] ?? ''));
    $ownerName = $owner === 'all' || $ownerName === '' ? null : goalCut($ownerName, 120);

    $scope = (string) ($input['scope'] ?? 'all');
    if (!in_array($scope, GOAL_SCOPES, true)) {
        throw new InvalidArgumentException('Unknown market.');
    }
    $category = (string) ($input['category'] ?? 'all');
    if (!in_array($category, GOAL_CATEGORIES, true)) {
        throw new InvalidArgumentException('Unknown service line.');
    }

    return [
        'id' => $id === null || $id === '' ? null : (int) $id,
        'name' => $name,
        'amount' => round((float) $amount, 2),
        'owner_id' => $owner,
        'owner_name' => $ownerName,
        'scope' => $scope,
        'category' => $category,
    ];
}

// A hospedagem pode não ter mbstring (o snapshots.php também protege essas chamadas).
function goalLength(string $text): int
{
    return function_exists('mb_strlen') ? mb_strlen($text) : strlen($text);
}

function goalCut(string $text, int $size): string
{
    return function_exists('mb_substr') ? mb_substr($text, 0, $size) : substr($text, 0, $size);
}

function saveGoal(PDO $pdo, array $row, string $email): array
{
    $values = [
        'name' => $row['name'],
        'amount' => $row['amount'],
        'owner_id' => $row['owner_id'],
        'owner_name' => $row['owner_name'],
        'scope' => $row['scope'],
        'category' => $row['category'],
        'updated_by' => $email !== '' ? $email : null,
    ];

    if ($row['id'] !== null) {
        $exists = $pdo->prepare('SELECT COUNT(*) FROM sales_goals WHERE id = ?');
        $exists->execute([$row['id']]);
        if ((int) $exists->fetchColumn() === 0) {
            throw new InvalidArgumentException('This goal no longer exists. Reload the page.');
        }
        try {
            $pdo->prepare(
                'UPDATE sales_goals
                    SET name = :name, amount = :amount, owner_id = :owner_id, owner_name = :owner_name,
                        scope = :scope, category = :category, updated_by = :updated_by
                  WHERE id = :id'
            )->execute($values + ['id' => $row['id']]);
        } catch (PDOException $error) {
            if (($error->errorInfo[1] ?? null) === 1062) {
                throw new InvalidArgumentException('There is already a goal with this name for the same salesperson, market and service.');
            }
            throw $error;
        }
        $id = $row['id'];
    } else {
        // Mesmo nome + vendedor + mercado + serviço: atualiza o valor em vez de duplicar.
        $pdo->prepare(
            'INSERT INTO sales_goals (name, amount, owner_id, owner_name, scope, category, updated_by)
             VALUES (:name, :amount, :owner_id, :owner_name, :scope, :category, :updated_by)
             ON DUPLICATE KEY UPDATE
                amount = VALUES(amount),
                owner_name = VALUES(owner_name),
                updated_by = VALUES(updated_by),
                updated_at = CURRENT_TIMESTAMP'
        )->execute($values);

        $find = $pdo->prepare('SELECT id FROM sales_goals WHERE name = ? AND owner_id = ? AND scope = ? AND category = ?');
        $find->execute([$row['name'], $row['owner_id'], $row['scope'], $row['category']]);
        $id = (int) $find->fetchColumn();
    }

    $select = $pdo->prepare(GOAL_SELECT . ' WHERE id = ?');
    $select->execute([$id]);
    $saved = $select->fetch();
    if (!is_array($saved)) {
        throw new RuntimeException('Saved goal could not be read back.');
    }
    return goalEntry($saved);
}

function removeGoal(PDO $pdo, mixed $id): int
{
    if (!is_numeric($id) || (int) $id < 1) {
        throw new InvalidArgumentException('Unknown goal.');
    }
    $pdo->prepare('DELETE FROM sales_goals WHERE id = ?')->execute([(int) $id]);
    return (int) $id;
}

function goalEntry(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'name' => (string) $row['name'],
        'amount' => (float) $row['amount'],
        'ownerId' => (string) $row['owner_id'],
        'ownerName' => $row['owner_name'] === null ? null : (string) $row['owner_name'],
        'scope' => (string) $row['scope'],
        'category' => (string) $row['category'],
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