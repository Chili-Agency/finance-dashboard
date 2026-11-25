<?php
declare(strict_types=1);

/*
 * Servidor MCP (somente leitura) do dashboard, no protocolo Streamable HTTP (JSON-RPC por POST).
 * Serve para conectar o dashboard ao Claude (claude.ai > Connectors, Claude Code, Claude Desktop) sem hospedar nada à parte.
 *
 * Autenticação: token de leitura de MCP_READ_TOKENS (ver config.php), em "Authorization: Bearer ..." ou em ?key=...
 * Os dados vêm dos próprios endpoints (api.php, sales.php...), chamados por HTTP neste mesmo servidor com o mesmo token,
 * então valem as mesmas regras de COGS, câmbio e retenção. Nada aqui grava.
 */

require __DIR__ . '/auth.php';

const MCP_SERVER_NAME = 'chili-finance';
const MCP_SERVER_VERSION = '0.2.0';
const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MCP_MAX_CHARS = 40000;
const MCP_MAX_BODY = 1048576;
const MCP_PAGES = [
    'sales' => ['sales.php', 'Deals, funil, chamadas e reunioes do HubSpot (pagina Sales).'],
    'clients' => ['clients.php', 'Empresas e respostas de NPS do HubSpot (Client view).'],
    'costs' => ['costs.php', 'Custos de assinaturas lidos do banco no Xero, em USD.'],
    'seo' => ['seo.php', 'KPIs de SEO por cliente.'],
    'ppc' => ['ppc.php', 'Contas e metricas de PPC.'],
    'ads' => ['ads.php', 'Gasto em Google/Meta Ads (CAC/CPL).'],
];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Referrer-Policy: no-referrer');

$httpMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($httpMethod !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    echo json_encode(['error' => 'Use POST (MCP Streamable HTTP).']);
    exit;
}

$identity = auth_token_identity(true);
if ($identity === null) {
    http_response_code(401);
    echo json_encode(['jsonrpc' => '2.0', 'id' => null, 'error' => ['code' => -32001, 'message' => 'Token inválido ou ausente.']]);
    exit;
}

$raw = file_get_contents('php://input', false, null, 0, MCP_MAX_BODY + 1);
if ($raw === false || strlen($raw) > MCP_MAX_BODY) {
    http_response_code(413);
    echo json_encode(['jsonrpc' => '2.0', 'id' => null, 'error' => ['code' => -32600, 'message' => 'Corpo grande demais.']]);
    exit;
}
$body = json_decode($raw, true);
if (!is_array($body) || $body === []) {
    http_response_code(400);
    echo json_encode(['jsonrpc' => '2.0', 'id' => null, 'error' => ['code' => -32700, 'message' => 'JSON inválido.']]);
    exit;
}

$isBatch = array_is_list($body);
$messages = $isBatch ? $body : [$body];
$responses = [];
foreach ($messages as $message) {
    if (!is_array($message)) {
        $responses[] = mcp_error(null, -32600, 'Mensagem inválida.');
        continue;
    }
    $reply = mcp_handle($message, $identity);
    if ($reply !== null) {
        $responses[] = $reply;
    }
}

if ($responses === []) {
    http_response_code(202); // só notificações
    exit;
}
echo json_encode($isBatch ? $responses : $responses[0], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);

// ---------------------------------------------------------------------------------------------

function mcp_error($id, int $code, string $message): array
{
    return ['jsonrpc' => '2.0', 'id' => $id, 'error' => ['code' => $code, 'message' => $message]];
}

function mcp_handle(array $message, array $identity): ?array
{
    $hasId = array_key_exists('id', $message);
    $id = $hasId ? $message['id'] : null;
    $method = (string) ($message['method'] ?? '');
    $params = is_array($message['params'] ?? null) ? $message['params'] : [];

    if (!$hasId) {
        return null; // notificação (ex.: notifications/initialized)
    }
    if ($method === '') {
        return mcp_error($id, -32600, 'Falta o method.');
    }

    switch ($method) {
        case 'initialize':
            $asked = (string) ($params['protocolVersion'] ?? '');
            return ['jsonrpc' => '2.0', 'id' => $id, 'result' => [
                'protocolVersion' => in_array($asked, MCP_PROTOCOLS, true) ? $asked : MCP_PROTOCOLS[0],
                'capabilities' => ['tools' => ['listChanged' => false]],
                'serverInfo' => ['name' => MCP_SERVER_NAME, 'version' => MCP_SERVER_VERSION],
                'instructions' => 'Dados financeiros do dashboard Chili (somente leitura). Valores nas moedas originais, salvo onde indicado.',
            ]];
        case 'ping':
            return ['jsonrpc' => '2.0', 'id' => $id, 'result' => (object) []];
        case 'tools/list':
            return ['jsonrpc' => '2.0', 'id' => $id, 'result' => ['tools' => mcp_tools()]];
        case 'tools/call':
            $name = (string) ($params['name'] ?? '');
            $args = is_array($params['arguments'] ?? null) ? $params['arguments'] : [];
            try {
                $result = mcp_call($name, $args, $identity);
            } catch (InvalidArgumentException $error) {
                return mcp_error($id, -32602, $error->getMessage());
            } catch (Throwable $error) {
                error_log('[mcp] ' . $name . ': ' . $error->getMessage());
                $result = mcp_text($error->getMessage(), true);
            }
            return ['jsonrpc' => '2.0', 'id' => $id, 'result' => $result];
        default:
            return mcp_error($id, -32601, 'Método desconhecido: ' . $method);
    }
}

function mcp_tools(): array
{
    $source = ['type' => 'string', 'enum' => ['all', 'br', 'int', 'pa', 'mx'], 'description' => 'Empresa: br (Brasil), int (internacional), pa (Panama), mx (Mexico) ou all. Padrao: all.'];
    $month = ['type' => 'string', 'pattern' => '^\d{4}-\d{2}$', 'description' => 'Mes no formato AAAA-MM.'];
    $category = ['type' => 'string', 'enum' => ['seo', 'ppc', 'others']];
    return [
        [
            'name' => 'list_invoices',
            'description' => 'Lista invoices do Xero ja classificadas pelo dashboard, com filtros opcionais por mes, status, cliente e categoria.',
            'inputSchema' => ['type' => 'object', 'properties' => [
                'source' => $source,
                'month' => $month,
                'status' => ['type' => 'string', 'description' => 'Ex.: PAID, AUTHORISED, DRAFT.'],
                'contact' => ['type' => 'string', 'description' => 'Trecho do nome do cliente.'],
                'category' => $category,
                'limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 200, 'description' => 'Padrao 50.'],
            ]],
        ],
        [
            'name' => 'invoice_summary',
            'description' => 'Totais de invoices agrupados por mes, status e moeda (na moeda original). Bom para perguntas de faturamento sem listar tudo.',
            'inputSchema' => ['type' => 'object', 'properties' => [
                'source' => $source,
                'category' => $category,
                'from' => $month,
                'to' => $month,
            ]],
        ],
        [
            'name' => 'get_dashboard_data',
            'description' => 'Le os dados de uma pagina do dashboard. Paginas: '
                . implode(' ', array_map(static fn (string $key): string => $key . ' (' . MCP_PAGES[$key][1] . ')', array_keys(MCP_PAGES)))
                . ' A resposta pode ser cortada se for grande; use "path" para pegar so um trecho.',
            'inputSchema' => ['type' => 'object', 'required' => ['page'], 'properties' => [
                'page' => ['type' => 'string', 'enum' => array_keys(MCP_PAGES)],
                'path' => ['type' => 'string', 'description' => 'Caminho dentro do JSON, ex.: "accounts" ou "rows.0". Vazio = resposta inteira.'],
            ]],
        ],
    ];
}

function mcp_text($data, bool $isError = false): array
{
    $text = is_string($data) ? $data : (string) json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    if (mb_strlen($text) > MCP_MAX_CHARS) {
        $text = mb_substr($text, 0, MCP_MAX_CHARS) . "\n... [cortado em " . MCP_MAX_CHARS . ' caracteres; use filtros mais estreitos]';
    }
    $result = ['content' => [['type' => 'text', 'text' => $text]]];
    if ($isError) {
        $result['isError'] = true;
    }
    return $result;
}

function mcp_call(string $name, array $args, array $identity): array
{
    switch ($name) {
        case 'list_invoices':
            $source = mcp_source($args);
            $limit = max(1, min(200, (int) ($args['limit'] ?? 50)));
            $data = mcp_fetch('api.php', ['source' => $source], $identity['token']);
            $matched = mcp_filter_invoices((array) ($data['invoices'] ?? []), $args);
            return mcp_text([
                'total' => count($matched),
                'shown' => min(count($matched), $limit),
                'errors' => $data['errors'] ?? [],
                'fetchedAt' => $data['fetchedAt'] ?? null,
                'invoices' => array_map(static fn (array $invoice): array => [
                    'number' => $invoice['InvoiceNumber'] ?? null,
                    'contact' => $invoice['Contact']['Name'] ?? null,
                    'date' => $invoice['DateString'] ?? null,
                    'due' => $invoice['DueDateString'] ?? null,
                    'status' => $invoice['Status'] ?? null,
                    'currency' => $invoice['CurrencyCode'] ?? null,
                    'total' => $invoice['Total'] ?? null,
                    'amountDue' => $invoice['AmountDue'] ?? null,
                    'amountPaid' => $invoice['AmountPaid'] ?? null,
                    'paidAt' => $invoice['paidAt'] ?? null,
                    'categories' => $invoice['categories'] ?? [],
                    'conversion' => $invoice['conversion'] ?? null,
                ], array_slice($matched, 0, $limit)),
            ]);

        case 'invoice_summary':
            $source = mcp_source($args);
            $from = mcp_month($args, 'from');
            $to = mcp_month($args, 'to');
            $data = mcp_fetch('api.php', ['source' => $source], $identity['token']);
            $groups = [];
            foreach (mcp_filter_invoices((array) ($data['invoices'] ?? []), ['category' => $args['category'] ?? null]) as $invoice) {
                $month = mcp_month_of($invoice);
                if (($from !== null && $month < $from) || ($to !== null && $month > $to)) {
                    continue;
                }
                $key = $month . '|' . ($invoice['Status'] ?? '') . '|' . ($invoice['CurrencyCode'] ?? '');
                $groups[$key] ??= ['month' => $month, 'status' => $invoice['Status'] ?? null, 'currency' => $invoice['CurrencyCode'] ?? null, 'count' => 0, 'total' => 0.0, 'amountDue' => 0.0, 'amountPaid' => 0.0];
                $groups[$key]['count']++;
                $groups[$key]['total'] += (float) ($invoice['Total'] ?? 0);
                $groups[$key]['amountDue'] += (float) ($invoice['AmountDue'] ?? 0);
                $groups[$key]['amountPaid'] += (float) ($invoice['AmountPaid'] ?? 0);
            }
            $rows = array_values(array_map(static fn (array $row): array => [
                'total' => round($row['total'], 2), 'amountDue' => round($row['amountDue'], 2), 'amountPaid' => round($row['amountPaid'], 2),
            ] + $row, $groups));
            usort($rows, static fn (array $a, array $b): int => [$a['month'], (string) $a['status']] <=> [$b['month'], (string) $b['status']]);
            return mcp_text(['rows' => $rows, 'rates' => $data['rates'] ?? null, 'fetchedAt' => $data['fetchedAt'] ?? null, 'errors' => $data['errors'] ?? []]);

        case 'get_dashboard_data':
            $page = (string) ($args['page'] ?? '');
            if (!isset(MCP_PAGES[$page])) {
                throw new InvalidArgumentException('page deve ser um de: ' . implode(', ', array_keys(MCP_PAGES)));
            }
            $data = mcp_fetch(MCP_PAGES[$page][0], [], $identity['token']);
            $path = trim((string) ($args['path'] ?? ''));
            if ($path !== '') {
                foreach (array_filter(explode('.', $path), static fn (string $part): bool => $part !== '') as $part) {
                    if (!is_array($data) || !array_key_exists($part, $data)) {
                        $keys = is_array($data) ? implode(', ', array_slice(array_map('strval', array_keys($data)), 0, 30)) : '(nenhuma)';
                        return mcp_text('Caminho "' . $path . '" não existe. Chaves disponíveis: ' . $keys, true);
                    }
                    $data = $data[$part];
                }
            }
            return mcp_text($data);

        default:
            throw new InvalidArgumentException('Ferramenta desconhecida: ' . $name);
    }
}

function mcp_source(array $args): string
{
    $source = (string) ($args['source'] ?? 'all');
    if (!in_array($source, ['all', 'br', 'int', 'pa', 'mx'], true)) {
        throw new InvalidArgumentException('source deve ser all, br, int, pa ou mx.');
    }
    return $source;
}

function mcp_month(array $args, string $key): ?string
{
    $value = $args[$key] ?? null;
    if ($value === null || $value === '') {
        return null;
    }
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}$/', $value)) {
        throw new InvalidArgumentException($key . ' deve estar no formato AAAA-MM.');
    }
    return $value;
}

function mcp_month_of(array $invoice): string
{
    return substr((string) ($invoice['DateString'] ?? $invoice['Date'] ?? ''), 0, 7);
}

function mcp_filter_invoices(array $invoices, array $args): array
{
    $month = mcp_month($args, 'month');
    $status = strtoupper((string) ($args['status'] ?? ''));
    $contact = mb_strtolower((string) ($args['contact'] ?? ''));
    $category = (string) ($args['category'] ?? '');
    return array_values(array_filter($invoices, static function ($invoice) use ($month, $status, $contact, $category): bool {
        if (!is_array($invoice)) {
            return false;
        }
        if ($month !== null && mcp_month_of($invoice) !== $month) {
            return false;
        }
        if ($status !== '' && strtoupper((string) ($invoice['Status'] ?? '')) !== $status) {
            return false;
        }
        if ($contact !== '' && !str_contains(mb_strtolower((string) ($invoice['Contact']['Name'] ?? '')), $contact)) {
            return false;
        }
        if ($category !== '' && !in_array($category, (array) ($invoice['categories'] ?? []), true)) {
            return false;
        }
        return true;
    }));
}

function mcp_base_url(): string
{
    $config = require __DIR__ . '/config.php';
    $self = (string) ($config['mcp']['self_url'] ?? '');
    if ($self !== '') {
        return $self;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $host = (string) ($_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? 'localhost');
    $dir = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/'))), '/');
    return ($https ? 'https' : 'http') . '://' . $host . $dir;
}

function mcp_fetch(string $file, array $params, string $token): array
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('A extensão curl do PHP não está ativa neste servidor.');
    }
    $url = mcp_base_url() . '/' . $file . ($params === [] ? '' : '?' . http_build_query($params));
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPGET => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Authorization: Bearer ' . $token],
    ]);
    $text = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($curl);
    curl_close($curl);
    if ($text === false) {
        throw new RuntimeException('Não consegui ler ' . $file . ': ' . $curlError . ' (se o dashboard não alcança a própria URL, defina MCP_SELF_URL no .env).');
    }
    if ($status === 401) {
        throw new RuntimeException($file . ' recusou o token (401). Confira o .htaccess que repassa o header Authorization.');
    }
    if ($status >= 400) {
        throw new RuntimeException($file . ' respondeu HTTP ' . $status . '.');
    }
    $data = json_decode((string) $text, true);
    if (!is_array($data)) {
        throw new RuntimeException($file . ' não devolveu JSON.');
    }
    return $data;
}
