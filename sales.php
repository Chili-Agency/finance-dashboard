<?php
declare(strict_types=1);

/*
 * Página Sales: deals, funil de contatos, chamadas e reuniões do HubSpot, vindos do workflow
 * "Chili Finance - Sales (HubSpot)" e lidos da última atualização gravada em data_snapshots
 * (ver snapshots.php). Aqui só se classifica: mercado, linha de serviço, canal e valor em USD.
 * As contas por período ficam no front (assets/sales.js), como no resto do dashboard.
 */

require __DIR__ . '/auth.php';
require __DIR__ . '/fx-rates.php';
require __DIR__ . '/snapshots.php';
auth_require_api();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

// Valor que conta como receita de um deal ganho: 'amount' (Amount) ou 'mrr' (Monthly recurring revenue).
const SALES_REVENUE_FIELD = 'amount';
// Estágios do Sales Pipeline. Tudo que não está aqui é deal aberto.
const SALES_WON_STAGES = ['closedwon'];
const SALES_LOST_STAGES = ['closedlost', '1500404']; // Lost Deal, Gone Cold
// Propriedade "country" do deal => mercado do dashboard.
const SALES_DEAL_MARKETS = ['Brazil' => 'br', 'Mexico' => 'mx', 'Panama' => 'pa', 'International' => 'int'];
// País do contato (código ISO) => mercado. Qualquer outro país conhecido vira International.
const SALES_COUNTRY_CODES = ['BR' => 'br', 'MX' => 'mx', 'PA' => 'pa'];
// "Type of the Services" do deal => linha de serviço do dashboard.
const SALES_SERVICES = [
    'SEO' => 'seo', 'seo_aio' => 'seo', 'AIO' => 'seo', 'Backlinks' => 'seo',
    'PPC' => 'ppc',
    'Website' => 'others', 'LP' => 'others', 'Wikipedia' => 'others', 'Outro' => 'others',
];
// Chamadas e reuniões que não contam como atividade.
const SALES_CALL_SKIP = ['CANCELED', 'FAILED'];
const SALES_MEETING_SKIP = ['CANCELED'];

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[sales] ' . $error->getMessage());
    respond(500, ['configured' => false, 'errors' => ['Server configuration error. Check the .env file.']]);
}

if ((string) ($config['n8n']['sales'] ?? '') === '') {
    respond(200, ['configured' => false, 'errors' => []]);
}

try {
    $snapshot = snapshot_read(auth_db(), ['sales'])['sales'] ?? null;
} catch (Throwable $error) {
    error_log('[sales] snapshots: ' . $error->getMessage());
    fail('Could not read the saved sales data (data_snapshots).');
}
if ($snapshot === null || $snapshot['body'] === null) {
    fail('No saved HubSpot data yet. Press Refresh to fetch it.' . ($snapshot !== null && $snapshot['error'] ? " The last attempt failed: {$snapshot['error']}" : ''));
}
$data = snapshot_decode_sales($snapshot['body']);
if ($data === null) {
    fail('The saved HubSpot data is not in the expected format. Press Refresh to fetch it again.');
}

$errors = array_values(array_map('strval', (array) ($data['warnings'] ?? [])));
if ($snapshot['error'] && $snapshot['errorAt'] && $snapshot['errorAt'] > (string) $snapshot['fetchedAt']) {
    $errors[] = "Last HubSpot refresh failed ({$snapshot['error']}), showing the previous data.";
}

$owners = [];
foreach ((array) ($data['owners'] ?? []) as $owner) {
    if (is_array($owner) && isset($owner['id'])) {
        $owners[(string) $owner['id']] = ['name' => (string) ($owner['name'] ?? ''), 'active' => !($owner['archived'] ?? false)];
    }
}

$deals = salesDeals((array) ($data['deals'] ?? []), $config, $errors);
$contacts = [];
foreach ((array) ($data['contacts'] ?? []) as $contact) {
    if (!is_array($contact)) {
        continue;
    }
    // Quem pulou direto para MQL ou SQL também passou a ser lead naquele dia.
    $stages = array_filter([day($contact['leadAt'] ?? null), day($contact['mqlAt'] ?? null), day($contact['sqlAt'] ?? null)]);
    if ($stages === []) {
        continue;
    }
    $contacts[] = [
        'lead' => min($stages),
        'mql' => day($contact['mqlAt'] ?? null),
        'sql' => day($contact['sqlAt'] ?? null),
        'market' => contactMarket($contact),
        'channel' => salesChannel($contact['source'] ?? null, $contact['sourceDetail'] ?? null),
    ];
}

$activities = static function (array $items, string $field, array $skip): array {
    $rows = [];
    foreach ($items as $item) {
        if (!is_array($item) || day($item['at'] ?? null) === null || in_array(strtoupper((string) ($item[$field] ?? '')), $skip, true)) {
            continue;
        }
        // O workflow manda as atividades já contadas por dia, vendedor e status (n).
        $rows[] = ['at' => day($item['at']), 'owner' => isset($item['owner']) && $item['owner'] !== '' ? (string) $item['owner'] : null, 'n' => max(1, (int) ($item['n'] ?? 1))];
    }
    return $rows;
};

respond(200, [
    'configured' => true,
    'fetchedAt' => (string) ($snapshot['fetchedAt'] ?? ''),
    'since' => day($data['since'] ?? null),
    'revenueField' => SALES_REVENUE_FIELD,
    'owners' => (object) $owners,
    'deals' => $deals,
    'contacts' => $contacts,
    'calls' => $activities((array) ($data['calls'] ?? []), 'status', SALES_CALL_SKIP),
    'meetings' => $activities((array) ($data['meetings'] ?? []), 'outcome', SALES_MEETING_SKIP),
    'errors' => $errors,
]);

/** Deals do pipeline com mercado, fatias por serviço e valor em USD pela cotação do mês de fechamento. */
function salesDeals(array $items, array $config, array &$errors): array
{
    $rows = [];
    foreach ($items as $deal) {
        if (!is_array($deal)) {
            continue;
        }
        $stage = (string) ($deal['stage'] ?? '');
        $outcome = in_array($stage, SALES_WON_STAGES, true) ? 'won' : (in_array($stage, SALES_LOST_STAGES, true) ? 'lost' : 'open');
        $closedAt = $outcome === 'open' ? null : day($deal['closedAt'] ?? null);
        $rows[] = [
            'id' => (string) ($deal['id'] ?? ''),
            'name' => trim((string) ($deal['name'] ?? '')) ?: null, // dealname; a lista de clientes ganhos usa
            'outcome' => $outcome,
            'createdAt' => day($deal['createdAt'] ?? null),
            'closedAt' => $closedAt,
            'owner' => isset($deal['owner']) && $deal['owner'] !== '' ? (string) $deal['owner'] : null,
            'market' => SALES_DEAL_MARKETS[(string) ($deal['country'] ?? '')] ?? 'unknown',
            'shares' => serviceShares((string) ($deal['service'] ?? '')),
            'type' => $deal['type'] ?? null,
            '_value' => number(SALES_REVENUE_FIELD === 'mrr' ? ($deal['mrr'] ?? null) : ($deal['amount'] ?? null)),
            '_mrr' => number($deal['mrr'] ?? null),
            '_home' => SALES_REVENUE_FIELD === 'amount' ? number($deal['amountHome'] ?? null) : null,
            '_currency' => strtoupper(trim((string) ($deal['currency'] ?? ''))) ?: 'USD',
        ];
    }

    $fx = new FxRates(auth_db(), (string) ($config['fx']['oer_app_id'] ?? ''));
    $ready = false;
    try {
        $fx->load(array_column($rows, '_currency'));
        $ready = true;
    } catch (Throwable $error) {
        error_log('[sales] fx: ' . $error->getMessage());
    }

    $missing = 0;
    foreach ($rows as &$row) {
        $month = substr((string) ($row['closedAt'] ?? $row['createdAt'] ?? gmdate('Y-m-d')), 0, 7);
        $rate = $ready || $row['_currency'] === 'USD' ? $fx->resolve($month, $row['_currency']) : null;
        if ($row['_value'] === null) {
            $row['valueUsd'] = null;
        } elseif ($rate !== null) {
            $row['valueUsd'] = round($row['_value'] / $rate['units'], 2);
        } elseif ($row['_home'] !== null) {
            $row['valueUsd'] = $row['_home']; // conversão do próprio HubSpot (moeda da empresa = USD)
        } else {
            $row['valueUsd'] = null;
            if ($row['outcome'] === 'won') {
                $missing++;
            }
        }
        // Receita mensal (Monthly recurring revenue do deal) em USD, para "new sales" e as metas por pessoa.
        $row['mrrUsd'] = $row['_mrr'] !== null && $rate !== null ? round($row['_mrr'] / $rate['units'], 2) : null;
        unset($row['_value'], $row['_home'], $row['_mrr'], $row['_currency']);
    }
    unset($row);

    if ($missing > 0) {
        $errors[] = "{$missing} won deal" . ($missing === 1 ? '' : 's') . ' left out of revenue: no exchange rate for their currency.';
    }
    return $rows;
}

/** Fatia de cada linha de serviço no deal. Deal com vários serviços divide o valor igualmente. */
function serviceShares(string $value): array
{
    $shares = ['seo' => 0.0, 'ppc' => 0.0, 'others' => 0.0, 'other' => 0.0];
    $lines = array_map(
        static fn (string $service): string => SALES_SERVICES[trim($service)] ?? 'other',
        array_filter(explode(';', $value), static fn (string $part): bool => trim($part) !== '')
    );
    if ($lines === []) {
        $shares['other'] = 1.0;
        return $shares;
    }
    foreach ($lines as $line) {
        $shares[$line] += round(1 / count($lines), 6);
    }
    return $shares;
}

function contactMarket(array $contact): string
{
    $code = strtoupper(trim((string) ($contact['countryCode'] ?? '')));
    if (preg_match('/^[A-Z]{2}$/', $code) === 1) {
        return SALES_COUNTRY_CODES[$code] ?? 'int';
    }
    foreach ([(string) ($contact['country'] ?? ''), (string) ($contact['ipCountry'] ?? '')] as $text) {
        $text = trim($text);
        if ($text === '') {
            continue;
        }
        if (preg_match('/^(br|bra[sz]il)$/i', $text) === 1) {
            return 'br';
        }
        if (preg_match('/^(mx|m[eé]xico)$/iu', $text) === 1) {
            return 'mx';
        }
        if (preg_match('/^(pa|panam[aá])$/iu', $text) === 1) {
            return 'pa';
        }
        return 'int';
    }
    return 'unknown';
}

/** Canal do lead pela origem original do HubSpot. Os códigos batem com a tabela da página. */
function salesChannel(mixed $source, mixed $detail): string
{
    $detail = (string) $detail;
    return match ((string) $source) {
        'PAID_SEARCH' => preg_match('/bing|microsoft/i', $detail) === 1 ? 'other' : 'google',
        'PAID_SOCIAL' => preg_match('/linkedin/i', $detail) === 1 ? 'linkedin' : 'meta',
        'ORGANIC_SEARCH' => 'organic',
        'SOCIAL_MEDIA' => 'social',
        'REFERRALS' => 'referral',
        'AI_REFERRALS' => 'ai',
        default => 'other',
    };
}

/** "YYYY-MM-DD", ou null. */
function day(mixed $value): ?string
{
    return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}/', $value) === 1 ? substr($value, 0, 10) : null;
}

function number(mixed $value): ?float
{
    return is_numeric($value) ? (float) $value : null;
}

function fail(string $message): void
{
    error_log('[sales] ' . $message);
    respond(502, ['configured' => true, 'deals' => [], 'contacts' => [], 'calls' => [], 'meetings' => [], 'owners' => new stdClass(), 'errors' => [$message]]);
}

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}