<?php
declare(strict_types=1);
require __DIR__ . '/auth.php';
$currentUser = auth_require_api();
if (!auth_can($currentUser, 'cogs_sheet')) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['error' => 'Your account cannot use this page.']);
    exit;
}
require __DIR__ . '/xlsx-reader.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const COGS_SHEET_MAX_BYTES = 10 * 1024 * 1024;
const COGS_SHEET_MAX_ROWS = 2000;
const COGS_SHEET_MAX_COLUMNS = 100;

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        header('Allow: POST');
        cogs_sheet_respond(405, ['error' => 'Method not allowed.']);
    }

    $missing = XlsxReader::missingExtensions();
    if ($missing !== []) {
        cogs_sheet_respond(500, ['error' => sprintf(
            'The server is missing the PHP %s extension%s needed to read .xlsx files. Ask your host to enable %s and try again.',
            implode(' and ', $missing),
            count($missing) === 1 ? '' : 's',
            count($missing) === 1 ? 'it' : 'them'
        )]);
    }
    if (empty($_POST) && empty($_FILES) && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
        cogs_sheet_respond(413, ['error' => 'The file is larger than the server accepts. Ask for post_max_size and upload_max_filesize to be raised.']);
    }
    if (!auth_check_csrf($_POST['csrf'] ?? null)) {
        cogs_sheet_respond(403, ['error' => 'This page expired. Reload it and try again.']);
    }
    session_write_close();

    $file = cogs_sheet_upload();
    $reader = new XlsxReader($file['path']);

    $sheets = [];
    foreach ($reader->sheetNames() as $name) {
        $sheets[] = cogs_sheet_grid($reader, $name);
    }

    cogs_sheet_respond(200, [
        'fileName' => $file['name'],
        'size' => $file['size'],
        'sheets' => $sheets,
        'uncached' => array_sum(array_column($sheets, 'uncached')),
    ]);
} catch (InvalidArgumentException $error) {
    cogs_sheet_respond(422, ['error' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log(sprintf('[cogs-sheet] %s: %s in %s:%d', get_class($error), $error->getMessage(), $error->getFile(), $error->getLine()));
    cogs_sheet_respond(500, ['error' => sprintf('The spreadsheet could not be read (%s).', $error->getMessage() !== '' ? $error->getMessage() : get_class($error))]);
}

/** @return array{path:string,name:string,size:int} */
function cogs_sheet_upload(): array
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
    if ($size === 0 || $size > COGS_SHEET_MAX_BYTES) {
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
    return ['path' => $path, 'name' => $name, 'size' => $size];
}

/** @return array{name:string,rows:list<list<mixed>>,rowCount:int,columnCount:int,truncated:bool,uncached:int} */
function cogs_sheet_grid(XlsxReader $reader, string $name): array
{
    $cells = $reader->rows($name, COGS_SHEET_MAX_COLUMNS);
    ksort($cells);

    $lastRow = $cells === [] ? 0 : (int) array_key_last($cells);
    $truncated = $lastRow > COGS_SHEET_MAX_ROWS;
    $lastRow = min($lastRow, COGS_SHEET_MAX_ROWS);

    $lastColumn = 0;
    foreach ($cells as $rowNumber => $row) {
        if ($rowNumber <= $lastRow && $row !== []) {
            $lastColumn = max($lastColumn, max(array_keys($row)));
        }
    }

    $rows = [];
    for ($rowNumber = 1; $rowNumber <= $lastRow; $rowNumber++) {
        $line = [];
        for ($column = 1; $column <= $lastColumn; $column++) {
            $line[] = cogs_sheet_value($cells[$rowNumber][$column] ?? null);
        }
        $rows[] = $line;
    }

    return [
        'name' => $name,
        'rows' => $rows,
        'rowCount' => $lastRow,
        'columnCount' => $lastColumn,
        'truncated' => $truncated,
        'uncached' => $reader->uncachedFormulas($name),
    ];
}

function cogs_sheet_value(mixed $value): mixed
{
    if (is_array($value)) {
        return (string) ($value['error'] ?? '#ERROR');
    }
    if (is_float($value) && is_finite($value) && $value == floor($value) && abs($value) < 1e15) {
        return (int) $value;
    }
    return $value;
}

function cogs_sheet_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
