<?php
declare(strict_types=1);

/*
 * Scorecards de KPI por usuário do ClickUp (tabela kpi_scorecards, ver sql/kpi_scorecards.sql).
 * GET    -> lista os scorecards salvos (mais recentes primeiro).
 * POST   -> salva (cria ou atualiza pelo nome). O nome é montado aqui: KPI-YYYYMM-Sobrenome-Nome-SEO|PPC.
 *           Score de cada KPI, score geral e zona são recalculados aqui (a página só mostra o mesmo cálculo).
 * DELETE -> remove pelo nome (?name=...).
 * Só admin (permissão kpi_scorecard). O envio ao ClickUp virá depois, por um workflow do n8n que lê estes registros.
 *
 * Regras (iguais às da descrição do scorecard no ClickUp):
 *   Score % = MIN(Actual / Target, 1.2) x 100            (Higher is better)
 *   Score % = MIN(Target / Actual, 1.2) x 100            (Lower is better)
 *   Overall = média ponderada dos KPIs que têm Actual.
 *   Zona: RED < 50 · ORANGE 50-69.99 · YELLOW 70-79.99 · GREEN >= 80. Em scorecard provisório a zona fica em branco.
 */

require __DIR__ . '/auth.php';
$currentUser = auth_require_api();
auth_require_permission($currentUser, 'kpi_scorecard');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const KPI_SERVICES = ['SEO', 'PPC'];
const KPI_MAX_SLOTS = 7;
const KPI_SCORE_CAP = 1.2;
const KPI_LIST_LIMIT = 200;

try {
    $pdo = kpi_connect();

    switch ($_SERVER['REQUEST_METHOD'] ?? 'GET') {
        case 'GET':
            kpi_respond(200, ['ready' => true, 'scorecards' => kpi_read_all($pdo)]);

        case 'POST':
            kpi_check_csrf();
            $input = json_decode((string) file_get_contents('php://input'), true);
            if (!is_array($input)) {
                kpi_respond(400, ['error' => 'Send the scorecard as JSON.']);
            }
            $card = kpi_validate($input);
            kpi_save($pdo, $card, (string) ($currentUser['email'] ?? ''));
            kpi_respond(200, ['ready' => true, 'savedName' => $card['name'], 'scorecards' => kpi_read_all($pdo)]);

        case 'DELETE':
            kpi_check_csrf();
            $name = trim((string) ($_GET['name'] ?? ''));
            if ($name === '') {
                kpi_respond(400, ['error' => 'Send the scorecard name.']);
            }
            $pdo->prepare('DELETE FROM kpi_scorecards WHERE name = ?')->execute([$name]);
            kpi_respond(200, ['ready' => true, 'scorecards' => kpi_read_all($pdo)]);

        default:
            header('Allow: GET, POST, DELETE');
            kpi_respond(405, ['error' => 'Method not allowed.']);
    }
} catch (InvalidArgumentException $error) {
    kpi_respond(422, ['error' => $error->getMessage()]);
} catch (PDOException $error) {
    if (($error->errorInfo[1] ?? null) === 1146) {
        kpi_respond(200, ['ready' => false, 'scorecards' => [], 'error' => 'The scorecard table does not exist yet. Run sql/kpi_scorecards.sql on the database.']);
    }
    error_log('[kpi-scorecards] ' . $error->getMessage());
    kpi_respond(500, ['error' => 'Could not reach the database. Try again in a moment.']);
} catch (Throwable $error) {
    error_log('[kpi-scorecards] ' . $error->getMessage());
    kpi_respond(500, ['error' => 'Could not reach the database. Try again in a moment.']);
}

function kpi_connect(): PDO
{
    $pdo = auth_db();
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

function kpi_check_csrf(): void
{
    if (!auth_check_csrf($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) {
        kpi_respond(403, ['error' => 'This page expired. Reload it and try again.']);
    }
}

/** Parte do nome do scorecard: uma linha, sem hífen (o hífen separa as partes) nem caracteres de controle. */
function kpi_clean(mixed $value, string $label, int $max, bool $required = true): string
{
    if ($value !== null && !is_string($value) && !is_numeric($value)) {
        throw new InvalidArgumentException("{$label} must be text.");
    }
    $text = (string) preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string) $value);
    $text = trim((string) preg_replace('/\s+/u', ' ', str_replace('-', ' ', $text)));
    if ($required && $text === '') {
        throw new InvalidArgumentException("{$label} is required.");
    }
    if (mb_strlen($text) > $max) {
        throw new InvalidArgumentException("{$label} must have at most {$max} characters.");
    }
    return $text;
}

/** Texto livre (permite hífen e quebra de linha se $multiline). */
function kpi_text(mixed $value, int $max, bool $multiline = false): string
{
    $pattern = $multiline ? '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/u' : '/[\x00-\x1F\x7F]+/u';
    $text = trim((string) preg_replace($pattern, ' ', is_scalar($value) ? str_replace("\r\n", "\n", (string) $value) : ''));
    return mb_substr($text, 0, $max);
}

function kpi_number(mixed $value, string $label, bool $required, float $min = -1e9, float $max = 1e9): ?float
{
    if ($value === null || (is_string($value) && trim($value) === '')) {
        if ($required) {
            throw new InvalidArgumentException("{$label} is required.");
        }
        return null;
    }
    $text = is_string($value) ? str_replace(',', '.', trim($value)) : $value;
    if (!is_numeric($text)) {
        throw new InvalidArgumentException("{$label} must be a number.");
    }
    $number = (float) $text;
    if ($number < $min || $number > $max) {
        throw new InvalidArgumentException("{$label} is out of range.");
    }
    return $number;
}

function kpi_score(float $target, ?float $actual, string $direction): ?float
{
    if ($actual === null) {
        return null;
    }
    if ($direction === 'lower') {
        $ratio = $actual <= 0 ? KPI_SCORE_CAP : ($target > 0 ? $target / $actual : 0.0);
    } else {
        $ratio = $target > 0 ? $actual / $target : 0.0;
    }
    return round(min($ratio, KPI_SCORE_CAP) * 100, 1);
}

function kpi_zone(float $overall): string
{
    return $overall >= 80 ? 'GREEN' : ($overall >= 70 ? 'YELLOW' : ($overall >= 50 ? 'ORANGE' : 'RED'));
}

function kpi_validate(array $input): array
{
    $period = (string) ($input['period'] ?? '');
    if (preg_match('/^20\d{2}(0[1-9]|1[0-2])$/', $period) !== 1) {
        throw new InvalidArgumentException('Choose a valid month (YYYYMM).');
    }
    $service = strtoupper(trim((string) ($input['service'] ?? '')));
    if (!in_array($service, KPI_SERVICES, true)) {
        throw new InvalidArgumentException('Choose the department: SEO or PPC.');
    }
    $level = strtoupper(trim((string) ($input['level'] ?? '')));
    if (preg_match('/^L[1-9]$/', $level) !== 1) {
        throw new InvalidArgumentException('Choose the level (for example L1).');
    }
    $first = kpi_clean($input['firstName'] ?? '', 'First name', 60);
    $last = kpi_clean($input['lastName'] ?? '', 'Last name', 60);
    $userName = kpi_clean($input['userName'] ?? trim("{$first} {$last}"), 'User', 120);

    $slots = $input['kpis'] ?? null;
    if (!is_array($slots) || $slots === []) {
        throw new InvalidArgumentException('Add at least one KPI.');
    }
    if (count($slots) > KPI_MAX_SLOTS) {
        throw new InvalidArgumentException('A scorecard has at most ' . KPI_MAX_SLOTS . ' KPIs.');
    }
    $kpis = [];
    $weightTotal = 0.0;
    $scoredWeight = 0.0;
    $scoredSum = 0.0;
    foreach (array_values($slots) as $index => $slot) {
        if (!is_array($slot)) {
            throw new InvalidArgumentException('Each KPI must be an object.');
        }
        $n = $index + 1;
        $name = kpi_text($slot['name'] ?? '', 120);
        if ($name === '') {
            throw new InvalidArgumentException("KPI {$n} needs a name (or remove it).");
        }
        $direction = ($slot['direction'] ?? 'higher') === 'lower' ? 'lower' : 'higher';
        $weight = kpi_number($slot['weight'] ?? null, "KPI {$n} weight", true, 0, 100);
        $target = kpi_number($slot['target'] ?? null, "KPI {$n} target", true, 0, 1e9);
        $actual = kpi_number($slot['actual'] ?? null, "KPI {$n} actual", false, 0, 1e9);
        $score = kpi_score($target, $actual, $direction);
        $weightTotal += $weight;
        if ($score !== null) {
            $scoredWeight += $weight;
            $scoredSum += $weight * $score;
        }
        $kpis[] = [
            'n' => $n,
            'name' => $name,
            'weight' => $weight,
            'target' => $target,
            'actual' => $actual,
            'score' => $score,
            'source' => kpi_text($slot['source'] ?? '', 80),
            'direction' => $direction,
            'dashboardActual' => kpi_number($slot['dashboardActual'] ?? null, "KPI {$n} dashboard value", false, 0, 1e9),
        ];
    }
    if (abs($weightTotal - 100.0) > 0.01) {
        throw new InvalidArgumentException('The KPI weights must add up to 100 (now ' . rtrim(rtrim(number_format($weightTotal, 2, '.', ''), '0'), '.') . ').');
    }

    $overall = $scoredWeight > 0 ? round($scoredSum / $scoredWeight, 1) : null;
    $provisional = ($input['provisional'] ?? false) === true;
    $billable = kpi_number($input['billable'] ?? null, 'Billable %', false, 0, 1000);

    return [
        'name' => "KPI-{$period}-{$last}-{$first}-{$service}",
        'period' => $period,
        'service' => $service,
        'clickup_id' => kpi_text($input['userId'] ?? '', 40) ?: null,
        'user_name' => $userName,
        'payload' => json_encode([
            'parentTaskName' => "KPI Scorecard · {$first} {$last}",
            'level' => $level,
            'department' => $service,
            'roleTitle' => kpi_text($input['roleTitle'] ?? '', 80),
            'reviewPeriod' => substr($period, 0, 4) . '-' . substr($period, 4, 2) . '-01',
            'firstName' => $first,
            'lastName' => $last,
            'employeeId' => kpi_text($input['userId'] ?? '', 40),
            'employeeName' => $userName,
            'managerId' => kpi_text($input['managerId'] ?? '', 40),
            'managerName' => kpi_text($input['managerName'] ?? '', 120),
            'provisional' => $provisional,
            'overallScore' => $overall,
            'billable' => $billable,
            'performanceZone' => $provisional || $overall === null ? '' : kpi_zone($overall),
            'notes' => kpi_text($input['notes'] ?? '', 1500, true),
            'description' => kpi_text($input['description'] ?? '', 8000, true),
            'dashboardPeriod' => kpi_text($input['dashboardPeriod'] ?? '', 40),
            'kpis' => $kpis,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
    ];
}

function kpi_save(PDO $pdo, array $card, string $email): void
{
    $pdo->prepare(
        'INSERT INTO kpi_scorecards (name, period, service, clickup_id, user_name, payload, created_by, updated_by)
         VALUES (:name, :period, :service, :clickup_id, :user_name, :payload, :by, :by2)
         ON DUPLICATE KEY UPDATE
            clickup_id = VALUES(clickup_id),
            user_name = VALUES(user_name),
            payload = VALUES(payload),
            updated_by = VALUES(updated_by),
            updated_at = CURRENT_TIMESTAMP'
    )->execute($card + ['by' => $email !== '' ? $email : null, 'by2' => $email !== '' ? $email : null]);
}

function kpi_read_all(PDO $pdo): array
{
    $rows = $pdo->query(
        "SELECT name, period, service, clickup_id, user_name, payload, updated_by,
                DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at,
                DATE_FORMAT(sent_at, '%Y-%m-%dT%H:%i:%sZ') AS sent_at
           FROM kpi_scorecards ORDER BY updated_at DESC LIMIT " . KPI_LIST_LIMIT
    )->fetchAll();
    return array_map(static function (array $row): array {
        $payload = json_decode((string) $row['payload'], true);
        return [
            'name' => $row['name'],
            'period' => $row['period'],
            'service' => $row['service'],
            'userId' => $row['clickup_id'],
            'userName' => $row['user_name'],
            'updatedBy' => $row['updated_by'],
            'updatedAt' => $row['updated_at'],
            'sentAt' => $row['sent_at'],
            'payload' => is_array($payload) ? $payload : (object) [],
        ];
    }, $rows);
}

function kpi_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
