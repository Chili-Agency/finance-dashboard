<?php
declare(strict_types=1);

const XLSX_MAX_PART_BYTES = 40 * 1024 * 1024; // proteção contra zip bomb

final class XlsxReader
{
    private ZipArchiveSource|PureZipSource $zip;
    /** @var array<string, string> nome da aba => caminho do XML dentro do zip */
    private array $sheetPaths = [];
    /** @var list<string>|null */
    private ?array $sharedStrings = null;

    /** @var array<string, int> aba => células com fórmula mas sem valor calculado salvo */
    private array $uncached = [];

    public static function missingExtensions(): array
    {
        $missing = [];
        if (!class_exists(ZipArchive::class) && !function_exists('gzinflate')) {
            $missing[] = 'zlib';
        }
        if (!function_exists('simplexml_load_string')) {
            $missing[] = 'simplexml';
        }
        return $missing;
    }

    public function __construct(string $path)
    {
        $missing = self::missingExtensions();
        if ($missing !== []) {
            throw new RuntimeException('Missing PHP extension: ' . implode(', ', $missing));
        }
        $this->zip = class_exists(ZipArchive::class) ? new ZipArchiveSource($path) : new PureZipSource($path);
        $this->readWorkbook();
    }

    public function uncachedFormulas(string $sheet): int
    {
        return $this->uncached[$sheet] ?? 0;
    }

    /** @return list<string> */
    public function sheetNames(): array
    {
        return array_keys($this->sheetPaths);
    }

    /**
     * Linhas da aba como [número da linha => [número da coluna => valor]].
     * Valores: float para números, string para texto, bool, ou ['error' => '#DIV/0!'].
     *
     * @return array<int, array<int, mixed>>
     */
    public function rows(string $sheet, int $maxColumn = 64): array
    {
        if (!isset($this->sheetPaths[$sheet])) {
            throw new InvalidArgumentException("The workbook has no tab called {$sheet}.");
        }
        $xml = $this->xml($this->sheetPaths[$sheet]);
        $rows = [];
        $rowCursor = 0;
        foreach ($xml->sheetData->row ?? [] as $row) {
            $rowNumber = isset($row['r']) ? (int) $row['r'] : $rowCursor + 1;
            $rowCursor = $rowNumber;
            $columnCursor = 0;
            foreach ($row->c as $cell) {
                $column = isset($cell['r']) ? self::columnIndex((string) $cell['r']) : $columnCursor + 1;
                $columnCursor = $column;
                if ($column > $maxColumn) {
                    continue;
                }
                $value = $this->cellValue($cell);
                if ($value === null && isset($cell->f)) {
                    $this->uncached[$sheet] = ($this->uncached[$sheet] ?? 0) + 1;
                }
                if ($value !== null) {
                    $rows[$rowNumber][$column] = $value;
                }
            }
        }
        return $rows;
    }

    private function readWorkbook(): void
    {
        $workbook = $this->xml('xl/workbook.xml');
        $relations = $this->xml('xl/_rels/workbook.xml.rels');

        $targets = [];
        foreach ($relations->Relationship as $relation) {
            $target = (string) $relation['Target'];
            $target = str_starts_with($target, '/') ? ltrim($target, '/') : 'xl/' . $target;
            $targets[(string) $relation['Id']] = $target;
        }

        $namespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
        foreach ($workbook->sheets->sheet ?? [] as $sheet) {
            $id = (string) $sheet->attributes($namespace)['id'];
            if (isset($targets[$id])) {
                $this->sheetPaths[(string) $sheet['name']] = $targets[$id];
            }
        }
        if ($this->sheetPaths === []) {
            throw new InvalidArgumentException('The workbook has no readable tabs.');
        }
    }

    private function cellValue(SimpleXMLElement $cell): mixed
    {
        $type = (string) ($cell['t'] ?? 'n');
        if ($type === 'inlineStr') {
            return self::richText($cell->is);
        }
        if (!isset($cell->v)) {
            return null;
        }
        $raw = (string) $cell->v;
        if ($raw === '' && $type !== 'str') {
            return null; // <v></v>: fórmula gravada sem o valor calculado
        }
        return match ($type) {
            's' => $this->sharedString((int) $raw),
            'str' => $raw,
            'b' => $raw === '1',
            'e' => ['error' => $raw],
            default => is_numeric($raw) ? (float) $raw : $raw,
        };
    }

    private function sharedString(int $index): string
    {
        if ($this->sharedStrings === null) {
            $this->sharedStrings = [];
            if ($this->zip->has('xl/sharedStrings.xml')) {
                foreach ($this->xml('xl/sharedStrings.xml')->si as $item) {
                    $this->sharedStrings[] = self::richText($item);
                }
            }
        }
        return $this->sharedStrings[$index] ?? '';
    }

    private static function richText(?SimpleXMLElement $node): string
    {
        if ($node === null) {
            return '';
        }
        if (isset($node->t)) {
            return (string) $node->t;
        }
        $text = '';
        foreach ($node->r as $run) {
            $text .= (string) $run->t;
        }
        return $text;
    }

    private function xml(string $path): SimpleXMLElement
    {
        $size = $this->zip->size($path);
        if ($size === null) {
            throw new InvalidArgumentException('This file is not a valid .xlsx workbook.');
        }
        if ($size > XLSX_MAX_PART_BYTES) {
            throw new InvalidArgumentException('The workbook is too large to read.');
        }
        $content = $this->zip->read($path);
        $xml = $content === null ? false : simplexml_load_string($content, SimpleXMLElement::class, LIBXML_NONET | LIBXML_COMPACT);
        if ($xml === false) {
            throw new InvalidArgumentException('Part of the workbook could not be read.');
        }
        return $xml;
    }

    /** "AB12" => 28 */
    public static function columnIndex(string $reference): int
    {
        $letters = strtoupper((string) preg_replace('/[^A-Za-z]/', '', $reference));
        $index = 0;
        foreach (str_split($letters) as $letter) {
            $index = $index * 26 + (ord($letter) - 64);
        }
        return $index;
    }
}

/** Acesso ao zip pela extensão zip, quando ela está instalada. */
final class ZipArchiveSource
{
    private ZipArchive $zip;

    public function __construct(string $path)
    {
        $this->zip = new ZipArchive();
        // Sem flags: ZipArchive::RDONLY não existe em builds com libzip antiga.
        $opened = $this->zip->open($path);
        if ($opened !== true) {
            throw new InvalidArgumentException("This file is not a valid .xlsx workbook (zip error {$opened}).");
        }
    }

    public function __destruct()
    {
        $this->zip->close();
    }

    public function has(string $name): bool
    {
        return $this->zip->locateName($name) !== false;
    }

    public function size(string $name): ?int
    {
        $stat = $this->zip->statName($name);
        return $stat === false ? null : (int) $stat['size'];
    }

    public function read(string $name): ?string
    {
        $content = $this->zip->getFromName($name);
        return $content === false ? null : $content;
    }
}

/**
 * Leitor de zip em PHP puro, para servidores sem a extensão zip.
 * Lê o diretório central do arquivo e descompacta cada parte com gzinflate().
 * Cobre o que um .xlsx usa: partes "stored" (0) ou "deflate" (8), sem criptografia
 * e sem ZIP64 (só necessário acima de 4 GB).
 */
final class PureZipSource
{
    private string $data;
    /** @var array<string, array{method:int, flags:int, crc:int, compressed:int, size:int, offset:int}> */
    private array $entries = [];

    public function __construct(string $path)
    {
        $data = @file_get_contents($path);
        if (!is_string($data) || strlen($data) < 22) {
            throw new InvalidArgumentException('This file is not a valid .xlsx workbook.');
        }
        $this->data = $data;

        // Registro "end of central directory": nos últimos 22 bytes + até 64 KB de comentário.
        $tail = max(0, strlen($data) - 65557);
        $end = strrpos($data, "PK\x05\x06");
        if ($end === false || $end < $tail) {
            throw new InvalidArgumentException('This file is not a valid .xlsx workbook.');
        }
        $record = unpack('vdisk/vcdDisk/vdiskEntries/ventries/Vsize/Voffset', substr($data, $end + 4, 16));
        if ($record === false || $record['offset'] === 0xFFFFFFFF || $record['entries'] === 0xFFFF) {
            throw new InvalidArgumentException('This workbook uses a zip format that cannot be read without the PHP zip extension.');
        }

        $position = $record['offset'];
        for ($index = 0; $index < $record['entries']; $index++) {
            if (substr($data, $position, 4) !== "PK\x01\x02") {
                throw new InvalidArgumentException('This file is not a valid .xlsx workbook.');
            }
            $entry = unpack(
                'vmadeBy/vneeded/vflags/vmethod/vtime/vdate/Vcrc/Vcompressed/Vsize/vnameLength/vextraLength/vcommentLength/vdisk/vinternal/Vexternal/Voffset',
                substr($data, $position + 4, 42)
            );
            if ($entry === false) {
                throw new InvalidArgumentException('This file is not a valid .xlsx workbook.');
            }
            $name = substr($data, $position + 46, $entry['nameLength']);
            $this->entries[$name] = [
                'method' => $entry['method'],
                'flags' => $entry['flags'],
                'crc' => $entry['crc'],
                'compressed' => $entry['compressed'],
                'size' => $entry['size'],
                'offset' => $entry['offset'],
            ];
            $position += 46 + $entry['nameLength'] + $entry['extraLength'] + $entry['commentLength'];
        }
    }

    public function has(string $name): bool
    {
        return isset($this->entries[$name]);
    }

    public function size(string $name): ?int
    {
        return isset($this->entries[$name]) ? $this->entries[$name]['size'] : null;
    }

    public function read(string $name): ?string
    {
        $entry = $this->entries[$name] ?? null;
        if ($entry === null) {
            return null;
        }
        if (($entry['flags'] & 1) === 1) {
            throw new InvalidArgumentException('This workbook is password-protected. Save a copy without a password and try again.');
        }
        $offset = $entry['offset'];
        if (substr($this->data, $offset, 4) !== "PK\x03\x04") {
            throw new InvalidArgumentException('This file is not a valid .xlsx workbook.');
        }
        $local = unpack('vnameLength/vextraLength', substr($this->data, $offset + 26, 4));
        $raw = substr($this->data, $offset + 30 + $local['nameLength'] + $local['extraLength'], $entry['compressed']);

        $content = match ($entry['method']) {
            0 => $raw,
            8 => @gzinflate($raw),
            default => throw new InvalidArgumentException('This workbook uses a compression method that cannot be read without the PHP zip extension.'),
        };
        if (!is_string($content) || strlen($content) !== $entry['size'] || hexdec(hash('crc32b', $content)) !== $entry['crc']) {
            throw new InvalidArgumentException('Part of the workbook is damaged. Download it again and retry.');
        }
        return $content;
    }
}