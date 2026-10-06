<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';
require __DIR__ . '/fx-rates.php';
require __DIR__ . '/snapshots.php';
auth_require_api();

// true: cada invoice é convertida pela cotação do mês dela (fx_monthly_rates).
// false: todas pela cotação do mês corrente (o comportamento antigo, "cotação de hoje").
const FX_BY_INVOICE_MONTH = true;
const FX_MONEY_FIELDS = ['SubTotal', 'TotalTax', 'Total', 'AmountDue', 'AmountPaid'];

// Contas do Xero que contam como COGS (compara o nome da conta, sem diferenciar maiúscula, espaços ou "&" / "and").
// Para incluir outra conta, acrescente o nome aqui e no nó Config do workflow de custos no n8n.
const COGS_ACCOUNTS = [
    'Client Domain & Hosting',
    'Client Referral Commission',
    'Contractor - Content',
    'Contractor - Design',
    'Contractor - Landing Page',
    'Contractor - PPC (Social)',
    'Contractor - SEO Tech',
    'Link Building Cost',
    'Tax retention',
    'Subscriptions & Software',
];
// Bills que entram no COGS: já aprovadas (AUTHORISED) ou pagas (PAID). Rascunho, anulada e excluída ficam de fora.
const COGS_BILL_STATUSES = ['AUTHORISED', 'PAID'];
// Marcadores lidos só no texto da própria linha (descrição, código do item, conta, tracking).
// A onboarding fee não pode vir do Reference: "Onboarding 1/3" no Reference marcaria a
// fatura inteira como fee, e a mensalidade que vem junto sumiria da retenção.
// O mesmo vale para a break fee: o Reference só diz que a fatura tem uma multa, não qual linha.
const LINE_ONLY_MARKERS = ['onboarding', 'breakFee'];

// Linhas de cliente novo: no Xero a conta é "<serviço> - Sales" (ex.: "SEO - Sales"); cliente que já existe usa
// "<serviço> - Recurring". Só o nome da conta decide (o Reference, em geral "First month campaign", não entra aqui).
const SALES_ACCOUNT_PATTERNS = ['/(?<!\\p{L})sales(?!\\p{L})/iu', '/(?<!\\p{L})vendas?(?!\\p{L})/iu'];
const RECURRING_ACCOUNT_PATTERNS = ['/recurring/iu', '/recorrente/iu', '/recurrente/iu'];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

try {
    $config = require __DIR__ . '/config.php';
} catch (Throwable $error) {
    error_log('[api] ' . $error->getMessage());
    http_response_code(500);
    echo json_encode(['invoices' => [], 'errors' => ['Server configuration error. Check the .env file.']]);
    exit;
}

$companies = [
    'br' => [
        'label' => 'Brazil',
        'url' => $config['n8n']['br'],
        'currency' => 'BRL',
        'usdRate' => 0.18,
    ],
    'int' => [
        'label' => 'International',
        'url' => $config['n8n']['int'],
        'currency' => 'USD',
        'usdRate' => 1,
    ],
    'pa' => [
        'label' => 'Panama',
        'url' => $config['n8n']['pa'],
        'currency' => 'USD',
        'usdRate' => 1,
    ],
    'mx' => [
        'label' => 'Mexico',
        'url' => $config['n8n']['mx'],
        'currency' => 'MXN',
        'usdRate' => 0.055,
    ],
];

$markerPatterns = [
    'firstMonth' => [
        '/first\s*month/i',
        '/1st\s*month/i',
        '/primeiro\s*m[eê]s/i',
        '/m[eê]s\s*1\b/i',
        '/primer\s*mes/i',
        '/new\s*(client|customer)/i',
    ],
    'upsell' => [
        '/up[-\s]?sell/i',
        '/cross[-\s]?sell/i',
        '/expans[aã]o/i',
        '/amplia[cç][aã]o/i',
    ],
    'referral' => [
        '/referral/i',
        '/indica[cç][aã]o/i',
    ],
    'onboarding' => [
        '/\bon[-\s]?board(ing)?\b/i',
        '/\bset[-\s]?up\s*fee\b/i',
        '/taxa\s*de\s*(setup|implanta[cç][aã]o|ades[aã]o)/i',
        '/(tarifa|cuota|cargo)\s*de\s*(configuraci[oó]n|implementaci[oó]n|alta|inscripci[oó]n)/i',
    ],
    // Multa de rescisão (break fee): receita não recorrente, fica fora de todo o MRR.
    // Flag u de propósito: sem ela o PHP lê o texto byte a byte e [oó], [aã] não casam acentos.
    // Os lookarounds tratam "_" como separador (BREAK_FEE) sem casar dentro de outra palavra.
    'breakFee' => [
        '/(?<!\p{L})break[-_\s]?fees?(?!\p{L})/iu',
        '/(?<!\p{L})(early\s*)?(termination|cancell?ation)\s*fees?(?!\p{L})/iu',
        '/(?<!\p{L})exit\s*fees?(?!\p{L})/iu',
        '/multa\s*(contratual|rescis[oó]ria|de\s*rescis[aã]o|por\s*cancelamento)/iu',
        '/taxa\s*de\s*(rescis[aã]o|cancelamento)/iu',
        '/(multa|cargo|penalizaci[oó]n)\s*por\s*(rescisi[oó]n|cancelaci[oó]n|terminaci[oó]n)/iu',
    ],
];

$lineMarkers = ['upsell', 'onboarding', 'breakFee'];

// Ordem = prioridade. "Others" agrupa serviços fora de SEO/PPC; cada linha recebe
// também o serviço específico. SMM vem primeiro: "Social Media Marketing" é SMM, não
// Marketing. Os padrões valem para o nome da conta no Xero e, se ele não disser nada,
// para descrição, código do item e tracking da linha.
$otherServiceRules = [
    'smm' => [
        '/\bSMM\b/i',
        '/social[\s-]*media/i',
        '/redes\s*sociai?s/i',
        '/redes\s*sociales/i',
    ],
    'marketing' => [
        '/\bmarketing\b/i',
        '/\bmercadeo\b/i',
        '/\bEDM\b/i',
        '/e-?mail\s*marketing/i',
    ],
    'webdev' => [
        '/\bweb[\s-]*dev/i',
        '/\bweb\s*design/i',
        '/\bwebsite\b/i',
        '/\blanding\s*pages?\b/i',
        '/desenvolvimento\s*(de\s*)?(web|sites?)/i',
        '/desarrollo\s*(de\s*)?(web|sitios?)/i',
        '/\bsitio\s*web\b/i',
        '/\bweb\b/i',
    ],
];

$categoryRules = [
    'seo' => [
        'accountName' => ['/\bSEO\b/i'],
        'accountCodes' => ['201'],
        'text' => ['/\bSEO\b/i'],
    ],
    'ppc' => [
        'accountName' => ['/\bPPC\b/i'],
        'accountCodes' => [],
        'text' => ['/\bPPC\b/i'],
    ],
];

$source = $_GET['source'] ?? 'all';
$requested = $source === 'all' ? array_keys($companies) : [$source];
$invoices = [];
$cogsLines = [];
$errors = [];
$sourceCounts = [];
$sourceTypeCounts = [];
$diagnostics = [];
$categoryCounts = ['seo' => 0, 'ppc' => 0, 'others' => 0, 'other' => 0];
$sourceErrors = [];
$sourceWarnings = [];
$sourceSeconds = [];
$sourceFetchedAt = [];
$seenInvoiceIds = [];

// Invoices gravadas pela última atualização (snapshot-refresh.php), não mais o webhook ao vivo.
try {
    $snapshots = snapshot_read(auth_db(), array_map(static fn (string $key): string => "invoices_{$key}", array_values(array_filter($requested, static fn ($key) => isset($companies[$key])))));
} catch (Throwable $error) {
    error_log('[api] snapshots: ' . $error->getMessage());
    http_response_code(500);
    echo json_encode(['invoices' => [], 'errors' => ['Could not read the saved invoices (data_snapshots). Check that sql/004_data_snapshots.sql was run.']]);
    exit;
}

foreach ($requested as $key) {
    if (!isset($companies[$key])) {
        $errors[] = "Unknown company source: {$key}";
        continue;
    }

    $company = $companies[$key];
    $snapshot = $snapshots["invoices_{$key}"] ?? null;
    $warnings = [];
    if ($snapshot === null || $snapshot['body'] === null) {
        $reason = $snapshot !== null && $snapshot['error'] ? " The last attempt failed: {$snapshot['error']}" : '';
        $response = ['ok' => false, 'error' => 'No saved data yet. Press Refresh to fetch it from n8n.' . $reason];
    } else {
        $response = snapshot_decode_invoices($snapshot['body']);
        $sourceSeconds[$key] = $snapshot['seconds'];
        $sourceFetchedAt[$key] = $snapshot['fetchedAt'];
        if ($snapshot['error'] && $snapshot['errorAt'] && $snapshot['errorAt'] > (string) $snapshot['fetchedAt']) {
            $warnings['refresh'] = 'Last refresh failed, showing the previous data';
        }
    }

    if (!$response['ok']) {
        $sourceErrors[$key] = $response['error'];
        $sourceWarnings[$key] = [];
        $errors[] = $company['label'] . ': ' . $response['error'];
        $sourceCounts[$key] = 0;
        $sourceTypeCounts[$key] = [];
        continue;
    }

    $before = count($invoices);
    $sourceTypeCounts[$key] = [];
    $diagnostics[$key] = ['withLineItems' => 0, 'withReference' => 0, 'firstMonthMarked' => 0, 'upsellMarked' => 0, 'referralMarked' => 0, 'onboardingLines' => 0, 'breakFeeLines' => 0, 'breakFeeReferenceOnly' => 0, 'withAccountName' => 0, 'seo' => 0, 'ppc' => 0, 'others' => 0, 'smm' => 0, 'marketing' => 0, 'webdev' => 0, 'unclassified' => 0];

    foreach ($response['data'] as $invoice) {
        if (!is_array($invoice)) {
            continue;
        }
        if (!empty($invoice['_empty'])) {
            if (!empty($invoice['_error'])) {
                $sourceErrors[$key] = 'Xero request failed inside n8n: ' . (string) $invoice['_error'];
                $errors[] = $company['label'] . ': ' . $sourceErrors[$key];
            }
            if (!empty($invoice['accountsError'])) {
                $warnings['accounts'] = 'Chart of accounts unavailable, SEO/PPC split may be incomplete';
            }
            continue;
        }
        if (!empty($invoice['accountsError'])) {
            $warnings['accounts'] = 'Chart of accounts unavailable, SEO/PPC split may be incomplete';
        }
        $type = strtoupper((string) ($invoice['Type'] ?? 'UNKNOWN'));
        $sourceTypeCounts[$key][$type] = ($sourceTypeCounts[$key][$type] ?? 0) + 1;

        if (!empty($invoice['LineItems']) && is_array($invoice['LineItems'])) {
            $diagnostics[$key]['withLineItems']++;
        }
        if (trim((string) ($invoice['Reference'] ?? '')) !== '') {
            $diagnostics[$key]['withReference']++;
        }

        // A mesma invoice pode vir duas vezes do n8n (páginas do Xero que se sobrepõem): conta uma vez só.
        $invoiceId = (string) ($invoice['InvoiceID'] ?? '');
        if ($invoiceId !== '') {
            if (isset($seenInvoiceIds[$invoiceId])) {
                $warnings['duplicates'] = 'Duplicate invoices from n8n were ignored';
                continue;
            }
            $seenInvoiceIds[$invoiceId] = true;
        }

        // Contas a pagar (bills) não entram no MRR, mas as linhas das contas de COGS somam no COGS do dashboard.
        if ($type === 'ACCPAY') {
            foreach (cogsLinesFromBill($invoice, $key, (string) $company['currency'], $categoryRules, $otherServiceRules) as $costLine) {
                $cogsLines[] = $costLine;
            }
        }

        $slim = slimInvoice($invoice, $markerPatterns, $categoryRules, $lineMarkers, $otherServiceRules);

        $slim['companyKey'] = $key;
        $slim['company'] = $company['label'];
        $slim['companyCurrency'] = $company['currency'];
        $slim['usdRate'] = $company['usdRate'];
        $slim['rateSource'] = 'fallback';

        if (!empty($invoice['conversion']['ok']) && isset($invoice['conversion']['usdPerUnit'])) {
            $slim['usdRate'] = (float) $invoice['conversion']['usdPerUnit'];
            $slim['rateSource'] = 'live';
        }

        if (!empty($slim['flags']['firstMonth'])) {
            $diagnostics[$key]['firstMonthMarked']++;
        }
        if (!empty($slim['flags']['upsell'])) {
            $diagnostics[$key]['upsellMarked']++;
        }
        if (!empty($slim['flags']['referral'])) {
            $diagnostics[$key]['referralMarked']++;
        }
        if (array_sum((array) ($slim['onboardingShares'] ?? [])) > 0) {
            $diagnostics[$key]['onboardingLines']++;
        }
        if (array_sum((array) ($slim['breakFeeShares'] ?? [])) > 0) {
            $diagnostics[$key]['breakFeeLines']++;
        } elseif (matchesAny((string) ($slim['Reference'] ?? ''), $markerPatterns['breakFee'])) {
            // Reference diz break fee, mas nenhuma linha diz: não entra no desconto do MRR.
            $diagnostics[$key]['breakFeeReferenceOnly']++;
        }
        if (!empty($slim['hasAccountNames'])) {
            $diagnostics[$key]['withAccountName']++;
        }
        foreach (['seo', 'ppc', 'others'] as $category) {
            if (in_array($category, $slim['categories'], true)) {
                $diagnostics[$key][$category]++;
                $categoryCounts[$category]++;
            }
        }
        foreach ($slim['otherServices'] as $service) {
            $diagnostics[$key][$service]++;
        }
        if ($slim['categories'] === []) {
            $diagnostics[$key]['unclassified']++;
            $categoryCounts['other']++;
        }

        $invoices[] = $slim;
    }

    $sourceCounts[$key] = count($invoices) - $before;
    $sourceWarnings[$key] = array_values($warnings);
}

$fx = applyMonthlyRates($invoices, $sourceWarnings, (string) ($config['fx']['oer_app_id'] ?? ''), $cogsLines);

echo json_encode([
    'invoices' => $invoices,
    'errors' => $errors,
    'rates' => array_reduce($companies, static function (array $carry, array $company): array {
        $carry[$company['currency']] = $company['usdRate'];
        return $carry;
    }, []),
    'sourceCounts' => $sourceCounts,
    'sourceErrors' => (object) $sourceErrors,
    'sourceWarnings' => (object) $sourceWarnings,
    'sourceSeconds' => (object) $sourceSeconds,
    'sourceFetchedAt' => (object) $sourceFetchedAt,
    'sourceTypeCounts' => $sourceTypeCounts,
    'diagnostics' => $diagnostics,
    'categoryCounts' => $categoryCounts,
    'cogsLines' => $cogsLines,
    'fx' => $fx,
    'fetchedAt' => gmdate('c'),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

/**
 * Converte as invoices para USD com a tabela fx_monthly_rates.
 * Ordem: cotação mensal do banco → conversão que ainda vier do n8n → taxa fixa de $companies.
 * Meses anteriores ao início da gravação usam o primeiro mês gravado (ver FxRates::resolve).
 */
function applyMonthlyRates(array &$invoices, array &$sourceWarnings, string $appId, array &$cogsLines = []): array
{
    $current = FxRates::currentMonth();
    $monthOf = static fn (array $invoice): string => FX_BY_INVOICE_MONTH ? (invoiceMonth($invoice) ?? $current) : $current;
    $currencyOf = static function (array $invoice): string {
        $code = strtoupper(trim((string) ($invoice['CurrencyCode'] ?? '')));
        return $code !== '' ? $code : strtoupper((string) ($invoice['companyCurrency'] ?? 'USD'));
    };

    $rates = new FxRates(auth_db(), $appId);
    $ready = false;
    $errors = [];
    try {
        $rates->load(array_merge(array_map($currencyOf, $invoices), array_column($cogsLines, 'currency')));
        $errors = $rates->errors();
        $ready = true;
    } catch (Throwable $error) {
        error_log('[api] fx: ' . $error->getMessage());
        $errors[] = 'Could not read fx_monthly_rates: ' . $error->getMessage();
    }

    $fallbackBySource = [];
    $approximate = 0;
    foreach ($invoices as &$invoice) {
        $currency = $currencyOf($invoice);
        $month = FxRates::clampMonth($monthOf($invoice));
        $rate = $ready || $currency === 'USD' ? $rates->resolve($month, $currency) : null;

        if ($rate !== null) {
            $units = $rate['units'];
            $invoice['amounts_usd'] = convertAmounts($invoice, $units);
            $invoice['usdRate'] = 1 / $units;
            $invoice['rateSource'] = $currency === 'USD' ? 'usd' : 'monthly';
            $invoice['conversion'] = [
                'ok' => true,
                'from' => $currency,
                'to' => 'USD',
                'rate' => $units,
                'usdPerUnit' => 1 / $units,
                'source' => $currency === 'USD' ? 'no-op' : 'fx_monthly_rates',
                'month' => $month,
                'rateMonth' => $rate['month'], // pode ser outro mês se o da invoice não foi gravado
                'rateDate' => $rate['rateDate'] ?: null,
                'final' => $rate['final'],
            ];
            if ($currency !== 'USD' && !$rate['exact']) {
                $approximate++;
            }
            continue;
        }
        if (($invoice['rateSource'] ?? '') === 'live') {
            continue; // o n8n ainda converteu esta (workflow antigo, com o nó de FX)
        }
        $invoice['amounts_usd'] = null;
        $invoice['conversion'] = ['ok' => false, 'from' => $currency, 'to' => 'USD', 'month' => $month, 'reason' => "No {$currency} rate in fx_monthly_rates."];
        $source = (string) ($invoice['companyKey'] ?? '');
        $fallbackBySource[$source] = ($fallbackBySource[$source] ?? 0) + 1;
    }
    unset($invoice);

    // Linhas de COGS das bills: mesma cotação mensal (mês da bill) das invoices.
    $cogsWithoutRate = 0;
    foreach ($cogsLines as &$costLine) {
        $currency = $costLine['currency'];
        $rate = $ready || $currency === 'USD' ? $rates->resolve(FxRates::clampMonth($costLine['month']), $currency) : null;
        if ($rate === null || !($rate['units'] > 0)) {
            $costLine['costUsd'] = null;
            $cogsWithoutRate++;
            continue;
        }
        $costLine['costUsd'] = round($costLine['amount'] / $rate['units'], 2);
    }
    unset($costLine);

    foreach ($fallbackBySource as $source => $count) {
        $sourceWarnings[$source][] = $count . ' invoice' . ($count === 1 ? '' : 's') . ' converted with the fallback rate';
    }

    return [
        'source' => 'fx_monthly_rates',
        'byInvoiceMonth' => FX_BY_INVOICE_MONTH,
        'firstStoredMonth' => $ready ? $rates->firstMonth() : null,
        'apiCalls' => $rates->fetches(),
        'invoicesWithNearestMonthRate' => $approximate,
        'fallbackInvoices' => array_sum($fallbackBySource),
        'cogsLinesWithoutRate' => $cogsWithoutRate,
        'errors' => $errors,
    ];
}

/** "YYYY-MM-DD" de uma data do Xero (ISO ou /Date(ms)/), ou null. */
function xeroDay(mixed $value): ?string
{
    $text = (string) $value;
    if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $text, $match) === 1) {
        return $match[1];
    }
    if (preg_match('#^/Date\((-?\d+)#', $text, $match) === 1) {
        return gmdate('Y-m-d', intdiv((int) $match[1], 1000));
    }
    return null;
}

/** Pagamentos já feitos na invoice (data e valor na moeda dela), do mais antigo ao mais recente. */
function slimPayments(mixed $payments): array
{
    $rows = [];
    foreach ((array) $payments as $payment) {
        if (!is_array($payment)) {
            continue;
        }
        $date = xeroDay($payment['DateString'] ?? $payment['Date'] ?? null);
        if ($date === null) {
            continue;
        }
        $rows[] = ['date' => $date, 'amount' => round((float) ($payment['Amount'] ?? 0), 2)];
    }
    usort($rows, static fn (array $a, array $b): int => strcmp($a['date'], $b['date']));
    return array_slice($rows, 0, 20);
}

function normalizeAccountName(string $name): string
{
    $name = strtolower(str_replace(['&', '–', '—'], [' and ', '-', '-'], $name));
    return trim((string) preg_replace('/\s+/', ' ', $name));
}

/**
 * Linhas de custo (COGS) de uma conta a pagar (bill) do Xero: só as contas de COGS_ACCOUNTS, em bills
 * autorizadas ou pagas, no mês da bill e sem imposto. O serviço vem do centro de custo (tracking) da linha.
 *
 * @return array<int, array<string, mixed>>
 */
function cogsLinesFromBill(array $bill, string $market, string $fallbackCurrency, array $categoryRules, array $otherServiceRules): array
{
    if (!in_array(strtoupper((string) ($bill['Status'] ?? '')), COGS_BILL_STATUSES, true)) {
        return [];
    }
    $month = invoiceMonth($bill);
    if ($month === null) {
        return [];
    }
    $currency = strtoupper(trim((string) ($bill['CurrencyCode'] ?? '')));
    if ($currency === '') {
        $currency = $fallbackCurrency;
    }
    $accounts = array_flip(array_map('normalizeAccountName', COGS_ACCOUNTS));
    $inclusive = strtoupper((string) ($bill['LineAmountTypes'] ?? '')) === 'INCLUSIVE';

    $lines = [];
    foreach (array_values((array) ($bill['LineItems'] ?? [])) as $index => $line) {
        if (!is_array($line)) {
            continue;
        }
        $account = trim((string) ($line['AccountName'] ?? ''));
        if ($account === '' || !isset($accounts[normalizeAccountName($account)])) {
            continue;
        }
        $gross = (float) ($line['LineAmount'] ?? 0);
        $tax = (float) ($line['TaxAmount'] ?? 0);
        [$service, $costCenter] = costService($line, $categoryRules, $otherServiceRules);
        $lines[] = [
            'id' => (string) ($bill['InvoiceID'] ?? '') . ':' . $index,
            'source' => 'bill',
            'market' => $market,
            'month' => $month,
            'account' => $account,
            'service' => $service,
            'costCenter' => $costCenter,
            'amount' => round($inclusive ? $gross - $tax : $gross, 2),
            'currency' => $currency,
            'contact' => (string) ($bill['Contact']['Name'] ?? ''),
            'costUsd' => null,
        ];
    }
    return $lines;
}

/**
 * [serviço, centro de custo] de uma linha de custo. O serviço (seo, ppc, others) vem do centro de custo
 * (tracking) da linha; sem tracking, do nome da conta; sem nenhum dos dois, "unallocated" (entra só no total).
 *
 * @return array{0: string, 1: ?string}
 */
function costService(array $line, array $categoryRules, array $otherServiceRules): array
{
    $options = [];
    foreach ((array) ($line['Tracking'] ?? []) as $tracking) {
        if (is_array($tracking) && trim((string) ($tracking['Option'] ?? '')) !== '') {
            $options[] = trim((string) $tracking['Option']);
        }
    }
    $costCenter = $options === [] ? null : implode(' / ', $options);

    $fromText = static function (string $text) use ($categoryRules, $otherServiceRules): ?string {
        foreach ($categoryRules as $category => $rule) {
            if (matchesAny($text, $rule['text'] ?? [])) {
                return $category;
            }
        }
        return matchService($text, $otherServiceRules) !== null ? 'others' : null;
    };

    $service = $costCenter !== null ? $fromText($costCenter) : null;
    $service ??= $fromText((string) ($line['AccountName'] ?? ''));
    return [$service ?? 'unallocated', $costCenter];
}

/** "YYYY-MM" da data da invoice (DateString ISO ou /Date(ms)/ do Xero). */
function invoiceMonth(array $invoice): ?string
{
    $text = (string) ($invoice['DateString'] ?? '');
    if (preg_match('/^(\d{4})-(\d{2})/', $text, $match) === 1) {
        return "{$match[1]}-{$match[2]}";
    }
    if (preg_match('#^/Date\((-?\d+)#', (string) ($invoice['Date'] ?? ''), $match) === 1) {
        return gmdate('Y-m', intdiv((int) $match[1], 1000));
    }
    return null;
}

function convertAmounts(array $invoice, float $unitsPerUsd): array
{
    $converted = [];
    foreach (FX_MONEY_FIELDS as $field) {
        $value = $invoice[$field] ?? null;
        if ($value !== null && $value !== '' && is_numeric($value)) {
            $converted[$field] = round((float) $value / $unitsPerUsd, 2);
        }
    }
    return $converted;
}

function slimInvoice(array $invoice, array $markerPatterns, array $categoryRules, array $lineMarkers, array $otherServiceRules): array
{
    $reference = (string) ($invoice['Reference'] ?? '');
    $descriptions = [];
    // 'others' = SMM, Marketing e Web dev; 'other' = linha que não se encaixou em nada.
    $categoryKeys = array_merge(array_keys($categoryRules), ['others', 'other']);
    $lineWeights = [];
    $hasAccountNames = false;
    $itemCodes = [];
    $accountCodes = [];

    foreach ((array) ($invoice['LineItems'] ?? []) as $line) {
        if (!is_array($line)) {
            continue;
        }
        if (isset($line['Description'])) {
            $descriptions[] = (string) $line['Description'];
        }
        if (!empty($line['ItemCode'])) {
            $itemCodes[] = (string) $line['ItemCode'];
        }
        if (!empty($line['AccountCode'])) {
            $accountCodes[] = (string) $line['AccountCode'];
        }
        if (trim((string) ($line['AccountName'] ?? '')) !== '') {
            $hasAccountNames = true;
        }
        $lineText = [(string) ($line['Description'] ?? ''), (string) ($line['ItemCode'] ?? ''), (string) ($line['AccountName'] ?? '')];
        foreach ((array) ($line['Tracking'] ?? []) as $tracking) {
            if (is_array($tracking) && !empty($tracking['Option'])) {
                $descriptions[] = (string) $tracking['Option'];
                $lineText[] = (string) $tracking['Option'];
            }
        }
        $lineFlags = [];
        foreach ($lineMarkers as $marker) {
            $inLine = matchesAny(implode(' | ', $lineText), $markerPatterns[$marker] ?? []);
            $lineFlags[$marker] = in_array($marker, LINE_ONLY_MARKERS, true)
                ? $inLine
                : $inLine || matchesAny($reference, $markerPatterns[$marker] ?? []);
        }
        $accountName = (string) ($line['AccountName'] ?? '');
        $lineFlags['sales'] = matchesAny($accountName, SALES_ACCOUNT_PATTERNS) && !matchesAny($accountName, RECURRING_ACCOUNT_PATTERNS);
        $class = classifyLine($line, $categoryRules, $otherServiceRules);
        $lineWeights[] = [
            'category' => $class['category'] ?? 'other',
            'service' => $class['service'] ?? null,
            'amount' => (float) ($line['LineAmount'] ?? 0),
            'flags' => $lineFlags,
        ];
    }

    $haystack = trim(implode(' | ', array_filter(array_merge(
        [$reference],
        $descriptions,
        $itemCodes
    ))));

    $flags = [];
    foreach ($markerPatterns as $flag => $patterns) {
        $flags[$flag] = matchesAny($haystack, $patterns);
    }

    $categoryShares = categoryShares($lineWeights, $categoryKeys);
    $markerShares = [];
    foreach ($lineMarkers as $marker) {
        $markerShares[$marker] = $lineWeights === [] && $flags[$marker] && !in_array($marker, LINE_ONLY_MARKERS, true)
            ? $categoryShares
            : categoryShares($lineWeights, $categoryKeys, static fn (array $line): bool => !empty($line['flags'][$marker]));
    }
    // Venda nova: linhas na conta "- Sales", sem onboarding fee nem break fee.
    $newSalesShares = categoryShares(
        $lineWeights,
        $categoryKeys,
        static fn (array $line): bool => !empty($line['flags']['sales']) && empty($line['flags']['onboarding']) && empty($line['flags']['breakFee'])
    );
    $categories = [];
    foreach (array_merge(array_keys($categoryRules), ['others']) as $category) {
        if (($categoryShares[$category] ?? 0) > 0) {
            $categories[] = $category;
        }
    }

    // Serviço específico dentro de Others, com a fatia de cada um no total da fatura.
    $serviceKeys = array_keys($otherServiceRules);
    $serviceWeights = array_map(
        static fn (array $line): array => ['category' => $line['service'] ?? '_rest'] + $line,
        $lineWeights
    );
    $otherServiceShares = array_intersect_key(
        categoryShares($serviceWeights, array_merge($serviceKeys, ['_rest'])),
        array_flip($serviceKeys)
    );
    if ($lineWeights === []) {
        $otherServiceShares = array_fill_keys($serviceKeys, 0.0);
    }
    $otherServices = array_keys(array_filter($otherServiceShares, static fn (float $share): bool => $share > 0));

    return [
        'InvoiceID' => $invoice['InvoiceID'] ?? null,
        'InvoiceNumber' => $invoice['InvoiceNumber'] ?? null,
        'Reference' => $invoice['Reference'] ?? null,
        'Type' => $invoice['Type'] ?? null,
        'Status' => $invoice['Status'] ?? null,
        'Date' => $invoice['Date'] ?? null,
        'DateString' => $invoice['DateString'] ?? null,
        'DueDate' => $invoice['DueDate'] ?? null,
        'DueDateString' => $invoice['DueDateString'] ?? null,
        'CurrencyCode' => $invoice['CurrencyCode'] ?? null,
        'SubTotal' => $invoice['SubTotal'] ?? null,
        'TotalTax' => $invoice['TotalTax'] ?? null,
        'Total' => $invoice['Total'] ?? null,
        'AmountDue' => $invoice['AmountDue'] ?? null,
        'AmountPaid' => $invoice['AmountPaid'] ?? null,
        'paidAt' => xeroDay($invoice['FullyPaidOnDate'] ?? null),
        'payments' => slimPayments($invoice['Payments'] ?? []),
        'Contact' => [
            'ContactID' => $invoice['Contact']['ContactID'] ?? null,
            'Name' => $invoice['Contact']['Name'] ?? null,
        ],
        'amounts_usd' => $invoice['amounts_usd'] ?? null,
        'conversion' => $invoice['conversion'] ?? null,
        'flags' => $flags,
        'itemCodes' => array_values(array_unique($itemCodes)),
        'accountCodes' => array_values(array_unique($accountCodes)),
        'markerText' => mb_substr($haystack, 0, 240),
        'categories' => $categories,
        'categoryShares' => $categoryShares,
        'upsellShares' => $markerShares['upsell'] ?? null,
        // Fatia de cada linha de serviço que é onboarding fee (mesma base de categoryShares).
        'onboardingShares' => $markerShares['onboarding'] ?? null,
        'breakFeeShares' => $markerShares['breakFee'] ?? null,
        // Fatia de cada linha de serviço que é venda nova (conta "- Sales"), sem onboarding fee (mesma base de categoryShares).
        'newSalesShares' => $newSalesShares,
        'otherServices' => $otherServices,
        'otherServiceShares' => $otherServiceShares,
        'hasAccountNames' => $hasAccountNames,
    ];
}

function matchesAny(string $text, array $patterns): bool
{
    if (trim($text) === '') {
        return false;
    }
    foreach ($patterns as $pattern) {
        if (preg_match($pattern, $text) === 1) {
            return true;
        }
    }
    return false;
}

/** @return array{category:string, service:?string}|null */
function classifyLine(array $line, array $categoryRules, array $otherServiceRules): ?array
{
    $name = trim((string) ($line['AccountName'] ?? ''));
    $code = trim((string) ($line['AccountCode'] ?? ''));
    $found = static fn (string $category, ?string $service = null): array => ['category' => $category, 'service' => $service];

    if ($name !== '') {
        foreach ($categoryRules as $category => $rule) {
            foreach ($rule['accountName'] ?? [] as $pattern) {
                if (preg_match($pattern, $name) === 1) {
                    return $found($category);
                }
            }
        }
    }

    if ($code !== '') {
        foreach ($categoryRules as $category => $rule) {
            if (in_array($code, $rule['accountCodes'] ?? [], true)) {
                return $found($category);
            }
        }
    }

    $text = (string) ($line['Description'] ?? '');
    $textMatchesCore = false;
    foreach ($categoryRules as $category => $rule) {
        foreach ($rule['text'] ?? [] as $pattern) {
            if ($text !== '' && preg_match($pattern, $text) === 1) {
                if ($name === '') {
                    return $found($category);
                }
                $textMatchesCore = true;
            }
        }
    }

    // Others: primeiro pelo nome da conta; depois pelo texto da linha, mas nunca quando
    // o texto fala de SEO ou PPC (esse caso continua como não classificado, como antes).
    if ($name !== '' && ($service = matchService($name, $otherServiceRules)) !== null) {
        return $found('others', $service);
    }
    if (!$textMatchesCore) {
        $parts = [$text, (string) ($line['ItemCode'] ?? '')];
        foreach ((array) ($line['Tracking'] ?? []) as $tracking) {
            if (is_array($tracking) && !empty($tracking['Option'])) {
                $parts[] = (string) $tracking['Option'];
            }
        }
        if (($service = matchService(implode(' | ', $parts), $otherServiceRules)) !== null) {
            return $found('others', $service);
        }
    }

    return null;
}

function matchService(string $text, array $otherServiceRules): ?string
{
    foreach ($otherServiceRules as $service => $patterns) {
        if (matchesAny($text, $patterns)) {
            return $service;
        }
    }
    return null;
}

function categoryShares(array $lineWeights, array $categoryKeys, ?callable $filter = null): array
{
    $shares = array_fill_keys($categoryKeys, 0.0);

    if ($lineWeights === []) {
        if ($filter === null) {
            $shares['other'] = 1.0;
        }
        return $shares;
    }

    $strategies = [
        static fn (array $line): float => $line['amount'],
        static fn (array $line): float => abs($line['amount']),
        static fn (array $line): float => 1.0,
    ];

    foreach ($strategies as $weight) {
        $sums = array_fill_keys($categoryKeys, 0.0);
        $total = 0.0;
        foreach ($lineWeights as $line) {
            $total += $weight($line);
            if ($filter === null || $filter($line)) {
                $sums[$line['category']] += $weight($line);
            }
        }
        if (abs($total) >= 0.00001) {
            foreach ($sums as $category => $sum) {
                $shares[$category] = round($sum / $total, 6);
            }
            return $shares;
        }
    }

    return $shares;
}