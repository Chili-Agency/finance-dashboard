<?php
declare(strict_types=1);
require __DIR__ . '/auth.php';
auth_require_api();
require __DIR__ . '/xlsx-reader.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const IMPORT_MARKETS = ['BR' => 'br', 'MX' => 'mx', 'PA' => 'pa', 'INT' => 'int'];
const IMPORT_LINES = ['SEO' => 'seo', 'PPC' => 'ppc'];
const IMPORT_FIELDS = [
    'totalMrrTarget' => ['label' => 'Target MRR', 'rows' => ['target mrr'], 'kind' => 'money', 'actual' => false],
    'cogs' => ['label' => 'COGS', 'rows' => ['cogs'], 'kind' => 'money', 'actual' => true],
    'cogsTarget' => ['label' => 'Target COGS', 'rows' => ['target cogs'], 'kind' => 'money', 'actual' => false],
    'margin' => ['label' => 'Current margin', 'rows' => ['current margin', 'current contribution margin'], 'kind' => 'fraction', 'min' => -1, 'max' => 1, 'actual' => true],
    'marginTarget' => ['label' => 'Target margin', 'rows' => ['target margin', 'target contribution margin'], 'kind' => 'fraction', 'min' => 0, 'max' => 1, 'actual' => false],
];

try {
    switch ($_SERVER['REQUEST_METHOD'] ?? 'GET') {
        case 'POST':
            $missing = XlsxReader::missingExtensions();
            if ($missing !== []) {
                respond(500, ['error' => sprintf(
                    'The server is missing the PHP %s extension%s needed to read .xlsx files. Ask your host to enable %s and try again. Nothing was saved.',
                    implode(' and ', $missing),
                    count($missing) === 1 ? '' : 's',
                    count($missing) === 1 ? 'it' : 'them'
                )]);
            }
            if (empty($_POST) && empty($_FILES) && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
                respond(413, ['error' => 'The file is larger than the server accepts. Ask for post_max_size and upload_max_filesize to be raised.']);
            }
            if (!auth_check_csrf($_POST['csrf'] ?? null)) {
                respond(403, ['error' => 'This page expired. Reload it and try again.']);
            }
            session_write_close();

            $mode = (string) ($_POST['mode'] ?? 'preview');
            if (!in_array($mode, ['preview', 'commit'], true)) {
                respond(400, ['error' => 'Unknown import mode.']);
            }
            $file = uploadedFile();
            $parsed = parseWorkbook($file['path']);
            $summary = summarize($parsed, $file);

            if ($mode === 'preview') {
                respond(200, $summary);
            }
            if ($parsed['entries'] === []) {
                throw new InvalidArgumentException('Nothing to import: no figures were found in the target tabs.');
            }

            $pdo = connect();
            $saved = save($pdo, $parsed['entries']);
            respond(200, $summary + ['saved' => $saved]);

        default:
            header('Allow: POST');
            respond(405, ['error' => 'Method not allowed.']);
    }
} catch (InvalidArgumentException $error) {
    respond(422, ['error' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log(sprintf('[sheet-import] %s: %s in %s:%d', get_class($error), $error->getMessage(), $error->getFile(), $error->getLine()));
    // Ferramenta interna, só para usuários autenticados: mostrar a causa real poupa uma ida ao log.
    $message = $error instanceof PDOException
        ? 'Could not reach the database. Nothing was saved. Try again in a moment.'
        : sprintf('The spreadsheet could not be read (%s). Nothing was saved.', $error->getMessage() !== '' ? $error->getMessage() : get_class($error));
    respond(500, ['error' => $message]);
}

/** @return array{path:string,name:string,size:int,sha256:string} */
function uploadedFile(): array
{
    $upload = $_FILES['sheet'] ?? null;
    if (!is_array($upload) || is_array($upload['error'] ?? null)) {
        throw new InvalidArgumentException('Choose a spreadsheet to upload.');
    }
    switch ((int) $upload['error']) {
        case UPLOAD_ERR_OK:
            break;
        case UPLOAD_ERR_NO_FILE:
            throw new InvalidArgumentException('Choose a spreadsheet to upload.');
        case UPLOAD_ERR_INI_SIZE:
        case UPLOAD_ERR_FORM_SIZE:
            throw new InvalidArgumentException('The file is larger than the server accepts.');
        default:
            throw new InvalidArgumentException('The upload did not finish. Try again.');
    }

    $name = basename(str_replace('\\', '/', (string) $upload['name']));
    $name = function_exists('mb_substr') ? mb_substr($name, 0, 255) : substr($name, 0, 255);
    if (strtolower(pathinfo($name, PATHINFO_EXTENSION)) !== 'xlsx') {
        throw new InvalidArgumentException('Upload the workbook as .xlsx. In Google Sheets: File › Download › Microsoft Excel (.xlsx).');
    }
    $path = (string) $upload['tmp_name'];
    if (!is_uploaded_file($path)) {
        throw new InvalidArgumentException('The upload did not finish. Try again.');
    }
    $size = (int) filesize($path);
    if ($size === 0 || $size > IMPORT_MAX_BYTES) {
        throw new InvalidArgumentException($size === 0 ? 'The file is empty.' : 'The file is larger than 10 MB.');
    }
    $handle = fopen($path, 'rb');
    $magic = $handle ? fread($handle, 4) : '';
    if ($handle) {
        fclose($handle);
    }
    if ($magic !== "PK\x03\x04") {
        throw new InvalidArgumentException('This file is not a valid .xlsx workbook.');
    }
    return ['path' => $path, 'name' => $name, 'size' => $size, 'sha256' => hash_file('sha256', $path)];
}

/** Aba -> ['scope' => ..., 'category' => ...], ou o motivo para ignorá-la. */
function tabTarget(string $sheet): array
{
    $key = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', $sheet));
    if (preg_match('/^(SEO|PPC)(BR|MX|PA|INT)$/', $key, $match) === 1) {
        return ['scope' => IMPORT_MARKETS[$match[2]], 'category' => IMPORT_LINES[$match[1]]];
    }
    if (str_starts_with($key, 'CONSOLIDATED')) {
        return ['scope' => 'all', 'category' => 'all'];
    }
    if (str_starts_with($key, 'DONOTFILL')) {
        return ['reason' => 'Example tab'];
    }
    if ($key === 'OTHERS') {
        return ['reason' => 'No SEO or PPC line in the dashboard; it still counts in Consolidated'];
    }
    return ['reason' => 'Not a target tab'];
}

function normalizeLabel(mixed $value): string
{
    if (!is_string($value)) {
        return '';
    }
    $value = function_exists('mb_strtolower') ? mb_strtolower($value) : strtolower($value);
    return trim((string) preg_replace('/\s+/u', ' ', $value));
}

/**
 * Lê uma aba de metas. Colunas de mês vêm da linha "Month"; o ano vem da linha
 * "Year", que só é preenchida na primeira coluna de cada ano.
 *
 * @return array{months: array<int,string>, fields: array<string, array<int, mixed>>, missing: list<string>}
 */
function readTab(XlsxReader $reader, string $sheet): array
{
    $rows = $reader->rows($sheet, 60);
    ksort($rows);

    $yearRow = null;
    $monthRow = null;
    $fieldRows = [];
    foreach ($rows as $number => $cells) {
        $label = normalizeLabel($cells[1] ?? null);
        if ($label === '') {
            continue;
        }
        if ($yearRow === null) {
            if ($label === 'year') {
                $yearRow = $number;
            }
            continue;
        }
        if ($monthRow === null) {
            if ($label === 'month') {
                $monthRow = $number;
            }
            continue;
        }
        // Algumas abas repetem "Year"/"Month" mais abaixo, num segundo quadro: para ali.
        if ($label === 'year' || $label === 'month') {
            break;
        }
        foreach (IMPORT_FIELDS as $field => $spec) {
            if (!isset($fieldRows[$field]) && in_array($label, $spec['rows'], true)) {
                $fieldRows[$field] = $number;
            }
        }
    }
    if ($yearRow === null || $monthRow === null) {
        throw new InvalidArgumentException("Tab {$sheet} has no Year and Month rows.");
    }

    $months = [];
    $year = null;
    $yearCells = $rows[$yearRow];
    $monthCells = $rows[$monthRow];
    ksort($monthCells);
    foreach ($monthCells as $column => $value) {
        if ($column === 1) {
            continue;
        }
        if (is_string($value) && normalizeLabel($value) === 'total') {
            break;
        }
        for ($left = $column; $left > 1; $left--) {
            if (is_float($yearCells[$left] ?? null)) {
                $year = (int) $yearCells[$left];
                break;
            }
        }
        $month = is_float($value) ? (int) $value : 0;
        if ($year === null || $year < 2000 || $year > 2100 || $month < 1 || $month > 12 || (float) $month !== $value) {
            continue;
        }
        $months[$column] = sprintf('%04d-%02d', $year, $month);
    }

    $fields = [];
    foreach (IMPORT_FIELDS as $field => $spec) {
        $fields[$field] = isset($fieldRows[$field]) ? $rows[$fieldRows[$field]] : [];
    }
    $missing = array_values(array_map(
        static fn (string $field): string => IMPORT_FIELDS[$field]['label'],
        array_diff(array_keys(IMPORT_FIELDS), array_keys($fieldRows))
    ));
    return ['months' => $months, 'fields' => $fields, 'missing' => $missing];
}

/**
 * @return array{tabs: list<array>, ignored: list<array>, entries: list<array>, skipped: list<array>, leftOut: int}
 */
function parseWorkbook(string $path): array
{
    $reader = new XlsxReader($path);
    $tabs = [];
    $ignored = [];
    $seen = [];

    foreach ($reader->sheetNames() as $sheet) {
        $target = tabTarget($sheet);
        if (isset($target['reason'])) {
            $ignored[] = ['sheet' => $sheet, 'reason' => $target['reason']];
            continue;
        }
        $key = "{$target['scope']}|{$target['category']}";
        if (isset($seen[$key])) {
            $ignored[] = ['sheet' => $sheet, 'reason' => "Same market and service as {$seen[$key]}"];
            continue;
        }
        try {
            $data = readTab($reader, $sheet);
        } catch (InvalidArgumentException $error) {
            $ignored[] = ['sheet' => $sheet, 'reason' => 'No Year and Month rows'];
            continue;
        }
        $seen[$key] = $sheet;
        $tabs[] = $target + ['sheet' => $sheet, 'uncached' => $reader->uncachedFormulas($sheet)] + $data;
    }
    if ($tabs === []) {
        throw new InvalidArgumentException('No target tabs were found. Expected tabs such as SEOBR, PPCMX or Consolidated 2025-2026.');
    }

    // Meses com COGS lançado, por aba. A consolidada soma as abas, então usa a união delas:
    // a fórmula dela devolve 0 nos meses em que nenhuma aba tem COGS.
    $cogsMonths = [];
    foreach ($tabs as $index => $tab) {
        $cogsMonths[$index] = [];
        foreach ($tab['months'] as $column => $month) {
            if (is_float($tab['fields']['cogs'][$column] ?? null)) {
                $cogsMonths[$index][$month] = true;
            }
        }
    }
    $marketMonths = [];
    foreach ($tabs as $index => $tab) {
        if ($tab['scope'] !== 'all') {
            $marketMonths += $cogsMonths[$index];
        }
    }

    $entries = [];
    $skipped = [];
    $leftOut = 0;
    foreach ($tabs as $index => $tab) {
        $actualMonths = $tab['scope'] === 'all' ? $marketMonths : $cogsMonths[$index];
        foreach ($tab['months'] as $column => $month) {
            $entry = ['month' => $month, 'scope' => $tab['scope'], 'category' => $tab['category']];
            $filled = false;
            foreach (IMPORT_FIELDS as $field => $spec) {
                $entry[$field] = null;
                $raw = $tab['fields'][$field][$column] ?? null;
                if ($raw === null || $raw === '') {
                    continue;
                }
                if ($spec['actual'] && !isset($actualMonths[$month])) {
                    if ($field !== 'cogs') {
                        $leftOut++;
                    }
                    continue;
                }
                $problem = null;
                if (is_array($raw)) {
                    $problem = "Spreadsheet error {$raw['error']}";
                } elseif (!is_float($raw)) {
                    $problem = 'Not a number';
                } elseif ($spec['kind'] === 'money' && $raw < 0) {
                    $problem = 'Negative amount';
                } elseif ($spec['kind'] === 'fraction' && ($raw < $spec['min'] || $raw > $spec['max'])) {
                    $problem = sprintf('Outside %d%% to %d%%', $spec['min'] * 100, $spec['max'] * 100);
                }
                if ($problem !== null) {
                    $skipped[] = [
                        'sheet' => $tab['sheet'],
                        'month' => $month,
                        'field' => $spec['label'],
                        'value' => is_array($raw) ? $raw['error'] : (is_float($raw) ? $raw : (string) json_encode($raw)),
                        'kind' => $spec['kind'],
                        'reason' => $problem,
                    ];
                    continue;
                }
                $entry[$field] = $spec['kind'] === 'money' ? round($raw, 2) : round($raw, 6);
                $filled = true;
            }
            if ($filled) {
                $entries[] = $entry;
            }
        }
    }

    return ['tabs' => $tabs, 'ignored' => $ignored, 'entries' => $entries, 'skipped' => $skipped, 'leftOut' => $leftOut];
}

function summarize(array $parsed, array $file): array
{
    $tabs = [];
    $figures = 0;
    $allMonths = [];
    foreach ($parsed['tabs'] as $tab) {
        $counts = array_fill_keys(array_keys(IMPORT_FIELDS), 0);
        $months = [];
        foreach ($parsed['entries'] as $entry) {
            if ($entry['scope'] !== $tab['scope'] || $entry['category'] !== $tab['category']) {
                continue;
            }
            $months[] = $entry['month'];
            foreach (array_keys(IMPORT_FIELDS) as $field) {
                if ($entry[$field] !== null) {
                    $counts[$field]++;
                    $figures++;
                }
            }
        }
        sort($months);
        $allMonths = array_merge($allMonths, $months);
        $tabs[] = [
            'sheet' => $tab['sheet'],
            'scope' => $tab['scope'],
            'category' => $tab['category'],
            'from' => $months[0] ?? null,
            'to' => $months === [] ? null : end($months),
            'counts' => $counts,
            'missingRows' => $tab['missing'],
            'uncached' => $tab['uncached'],
        ];
    }
    sort($allMonths);

    return [
        'file' => ['name' => $file['name'], 'size' => $file['size']],
        'figures' => $figures,
        'entries' => count($parsed['entries']),
        'from' => $allMonths[0] ?? null,
        'to' => $allMonths === [] ? null : end($allMonths),
        'tabs' => $tabs,
        'ignored' => $parsed['ignored'],
        'skipped' => $parsed['skipped'],
        'leftOut' => $parsed['leftOut'],
        'uncached' => array_sum(array_column($tabs, 'uncached')),
    ];
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

/**
 * Grava tudo ou nada. Em margin_inputs, um campo que a planilha deixa vazio não
 * apaga o que já estava salvo (o bonus pool, por exemplo, não vem da planilha).
 *
 * @return array{targets:int, margin:int}
 */
function save(PDO $pdo, array $entries): array
{
    $target = $pdo->prepare(
        'INSERT INTO mrr_targets (period_month, scope, category, total_mrr_target)
         VALUES (:period_month, :scope, :category, :total_mrr_target)
         ON DUPLICATE KEY UPDATE
            total_mrr_target = VALUES(total_mrr_target),
            updated_at = CURRENT_TIMESTAMP'
    );
    $margin = $pdo->prepare(
        'INSERT INTO margin_inputs (period_month, scope, category, cogs, cogs_target, margin, margin_target)
         VALUES (:period_month, :scope, :category, :cogs, :cogs_target, :margin, :margin_target)
         ON DUPLICATE KEY UPDATE
            cogs = COALESCE(VALUES(cogs), cogs),
            cogs_target = COALESCE(VALUES(cogs_target), cogs_target),
            margin = COALESCE(VALUES(margin), margin),
            margin_target = COALESCE(VALUES(margin_target), margin_target),
            updated_at = CURRENT_TIMESTAMP'
    );

    $saved = ['targets' => 0, 'margin' => 0];
    $pdo->beginTransaction();
    try {
        foreach ($entries as $entry) {
            $key = ['period_month' => $entry['month'] . '-01', 'scope' => $entry['scope'], 'category' => $entry['category']];
            if ($entry['totalMrrTarget'] !== null) {
                $target->execute($key + ['total_mrr_target' => $entry['totalMrrTarget']]);
                $saved['targets']++;
            }
            $values = [
                'cogs' => $entry['cogs'],
                'cogs_target' => $entry['cogsTarget'],
                'margin' => $entry['margin'],
                'margin_target' => $entry['marginTarget'],
            ];
            if (array_filter($values, static fn ($value): bool => $value !== null) !== []) {
                $margin->execute($key + $values);
                $saved['margin']++;
            }
        }
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    return $saved;
}

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}