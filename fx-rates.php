<?php
declare(strict_types=1);

/*
 * Câmbio mensal do dólar guardado na tabela fx_monthly_rates (ver sql/002_fx_monthly_rates.sql).
 *
 * Usa só o latest.json da Open Exchange Rates (plano gratuito, sem histórico):
 *   - mês corrente: quem grava e renova é o fx-refresh.php, chamado por um Schedule Trigger do
 *     n8n em poucos dias do mês (inclusive o último). A última gravada no mês vira a cotação dele.
 *     O dashboard só busca por conta própria se o mês corrente ainda não tiver nenhuma cotação.
 *   - mês que já virou: fica congelado (is_final = 1) e nunca mais é buscado.
 *   - mês sem cotação (antes de começar a gravar): usa o mês gravado mais próximo,
 *     de preferência o anterior; se não houver anterior, o primeiro gravado.
 * Só as moedas de CURRENCIES são pedidas e gravadas. Para incluir outra, acrescente o código
 * ali; ela passa a ser gravada a partir da próxima busca.
 * Sem OER_APP_ID no .env, usa só o que já está no banco (dá para preencher à mão no DBeaver).
 */

final class FxRates
{
    /** Moedas guardadas na tabela. USD entra como referência (sempre 1). */
    public const CURRENCIES = ['USD', 'BRL', 'MXN', 'PAB', 'EUR'];
    /** Intervalo mínimo entre duas buscas forçadas (execuções manuais repetidas no n8n, por exemplo). */
    private const MIN_REFRESH_SECONDS = 30 * 60;
    private const LOCK_NAME = 'chili_finance_fx_rates';
    private const LOCK_WAIT_SECONDS = 20;
    private const API = 'https://openexchangerates.org/api/latest.json';

    /** @var array<string, array<string, float>> moeda => ["YYYY-MM" => unidades por USD], meses em ordem */
    private array $rates = [];
    /** @var array<string, array{rateDate:string, final:bool, fetchedAt:int}> */
    private array $meta = [];
    /** @var list<string> */
    private array $errors = [];
    private int $fetches = 0;

    public function __construct(private PDO $pdo, private string $appId)
    {
    }

    /** Mês corrente em UTC, "YYYY-MM". */
    public static function currentMonth(): string
    {
        return gmdate('Y-m');
    }

    /** Meses futuros usam a cotação do mês corrente (não existe cotação do futuro). */
    public static function clampMonth(string $month): string
    {
        $current = self::currentMonth();
        return strcmp($month, $current) > 0 ? $current : $month;
    }

    /**
     * Usado pelo dashboard: busca a cotação só se o mês corrente ainda não tem nenhuma,
     * e carrega as moedas pedidas.
     * @param list<string> $currencies
     */
    public function load(array $currencies): void
    {
        $currencies = array_values(array_unique(array_filter(
            array_map(static fn ($code): string => strtoupper((string) $code), $currencies),
            static fn (string $code): bool => preg_match('/^[A-Z]{3}$/', $code) === 1 && $code !== 'USD'
        )));

        $this->finalizeClosedMonths();
        $this->updateCurrentMonth(false);
        if ($currencies !== []) {
            $this->read($currencies);
        }
    }

    /**
     * Cotação para o mês pedido: a do próprio mês ou, se ele não foi gravado, a do mais próximo.
     * @return array{units:float, month:string, rateDate:string, final:bool, exact:bool}|null
     */
    public function resolve(string $month, string $currency): ?array
    {
        $currency = strtoupper($currency);
        $month = self::clampMonth($month);
        if ($currency === 'USD') {
            return ['units' => 1.0, 'month' => $month, 'rateDate' => '', 'final' => true, 'exact' => true];
        }
        $series = $this->rates[$currency] ?? [];
        if ($series === []) {
            return null;
        }
        $used = null;
        if (isset($series[$month])) {
            $used = $month;
        } else {
            foreach (array_keys($series) as $stored) { // em ordem crescente
                if (strcmp($stored, $month) < 0) {
                    $used = $stored; // o anterior mais próximo
                } elseif ($used === null) {
                    $used = $stored; // antes do primeiro gravado: usa o primeiro
                    break;
                } else {
                    break;
                }
            }
        }
        $meta = $this->meta[$used] ?? ['rateDate' => '', 'final' => false];
        return [
            'units' => $series[$used],
            'month' => $used,
            'rateDate' => $meta['rateDate'],
            'final' => $meta['final'],
            'exact' => $used === $month,
        ];
    }

    /** @return list<string> */
    public function errors(): array
    {
        return $this->errors;
    }

    public function fetches(): int
    {
        return $this->fetches;
    }

    /** Primeiro mês gravado, ou null se a tabela está vazia. */
    public function firstMonth(): ?string
    {
        return $this->meta === [] ? null : min(array_keys($this->meta));
    }

    /**
     * Usado pelo fx-refresh.php (agendamento): grava a cotação de agora para o mês corrente,
     * a menos que ela tenha sido gravada há menos de MIN_REFRESH_SECONDS.
     * @return array{month:string, fetched:bool, skipped:?string}
     */
    public function refresh(): array
    {
        $this->finalizeClosedMonths();
        $fetchesBefore = $this->fetches;
        $skipped = $this->updateCurrentMonth(true);
        return ['month' => self::currentMonth(), 'fetched' => $this->fetches > $fetchesBefore && $this->errors === [], 'skipped' => $skipped];
    }

    /** Cotações gravadas no mês corrente, para conferência. @return list<array<string, mixed>> */
    public function currentRows(): array
    {
        $select = $this->pdo->prepare(
            "SELECT currency, units_per_usd, DATE_FORMAT(rate_date, '%Y-%m-%d') AS rate_date,
                    DATE_FORMAT(fetched_at, '%Y-%m-%dT%H:%i:%sZ') AS fetched_at
               FROM fx_monthly_rates WHERE period_month = ? ORDER BY currency"
        );
        $select->execute([self::currentMonth() . '-01']);
        return array_map(static fn (array $row): array => array_merge($row, ['units_per_usd' => (float) $row['units_per_usd']]), $select->fetchAll(PDO::FETCH_ASSOC));
    }

    private function finalizeClosedMonths(): void
    {
        $this->pdo->prepare('UPDATE fx_monthly_rates SET is_final = 1 WHERE is_final = 0 AND period_month < ?')
            ->execute([self::currentMonth() . '-01']);
    }

    /**
     * $force = false (dashboard): só busca se o mês corrente não tem cotação.
     * $force = true (agendamento): busca, salvo se a última foi há menos de MIN_REFRESH_SECONDS.
     * @return string|null motivo de não ter buscado
     */
    private function updateCurrentMonth(bool $force): ?string
    {
        $month = self::currentMonth();
        $reason = $this->skipReason($month, $force);
        if ($reason !== null) {
            return $reason;
        }
        if ($this->appId === '') {
            $this->errors[] = "OER_APP_ID is not set, so the {$month} rate cannot be fetched.";
            return 'no app id';
        }

        // Evita duas buscas ao mesmo tempo (agendamento + dashboard, ou duas abas).
        $lock = $this->pdo->prepare('SELECT GET_LOCK(?, ?)');
        $lock->execute([self::LOCK_NAME, self::LOCK_WAIT_SECONDS]);
        $locked = (int) $lock->fetchColumn() === 1;
        try {
            $reason = $this->skipReason($month, $force); // outra requisição pode ter gravado enquanto esperávamos
            if ($reason === null) {
                $this->fetchAndStore($month);
            }
        } catch (Throwable $error) {
            error_log("[fx-rates] {$month}: " . $error->getMessage());
            $this->errors[] = 'Open Exchange Rates: ' . $error->getMessage();
        } finally {
            if ($locked) {
                $this->pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([self::LOCK_NAME]);
            }
        }
        return $reason;
    }

    private function skipReason(string $month, bool $force): ?string
    {
        $select = $this->pdo->prepare(
            "SELECT DATE_FORMAT(MIN(fetched_at), '%Y-%m-%d %H:%i:%s') FROM fx_monthly_rates WHERE period_month = ?"
        );
        $select->execute([$month . '-01']);
        $fetchedAt = $select->fetchColumn();
        if (!is_string($fetchedAt)) {
            return null; // mês ainda sem cotação: busca sempre
        }
        if (!$force) {
            return 'already stored';
        }
        $age = time() - (int) strtotime($fetchedAt . ' UTC');
        return $age < self::MIN_REFRESH_SECONDS ? 'fetched ' . intdiv($age, 60) . ' min ago' : null;
    }

    /** @param list<string> $currencies */
    private function read(array $currencies): void
    {
        $placeholders = implode(',', array_fill(0, count($currencies), '?'));
        $select = $this->pdo->prepare(
            "SELECT DATE_FORMAT(period_month, '%Y-%m') AS month, currency, units_per_usd,
                    DATE_FORMAT(rate_date, '%Y-%m-%d') AS rate_date, is_final
               FROM fx_monthly_rates
              WHERE currency IN ({$placeholders}) AND units_per_usd > 0
              ORDER BY period_month"
        );
        $select->execute($currencies);
        $this->rates = [];
        $this->meta = [];
        foreach ($select->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $this->rates[$row['currency']][$row['month']] = (float) $row['units_per_usd'];
            $this->meta[$row['month']] = [
                'rateDate' => $row['rate_date'],
                'final' => (int) $row['is_final'] === 1 || $row['month'] < self::currentMonth(),
            ];
        }
    }

    private function fetchAndStore(string $month): void
    {
        $this->fetches++;
        $data = $this->request();

        $rateDate = gmdate('Y-m-d', (int) $data['timestamp']);
        $fetchedAt = gmdate('Y-m-d H:i:s');
        $rows = [];
        $params = [];
        foreach ($data['rates'] as $currency => $rate) {
            if (!in_array($currency, self::CURRENCIES, true) || !is_numeric($rate) || (float) $rate <= 0) {
                continue;
            }
            $rows[] = '(?, ?, ?, ?, 0, ?, ?)';
            array_push($params, $month . '-01', $currency, round((float) $rate, 10), $rateDate, 'openexchangerates', $fetchedAt);
        }
        if ($rows === []) {
            throw new RuntimeException('no rates in the response.');
        }

        $this->pdo->prepare(
            'INSERT INTO fx_monthly_rates
                (period_month, currency, units_per_usd, rate_date, is_final, source, fetched_at)
             VALUES ' . implode(',', $rows) . '
             ON DUPLICATE KEY UPDATE
                units_per_usd = VALUES(units_per_usd),
                rate_date = VALUES(rate_date),
                source = VALUES(source),
                fetched_at = VALUES(fetched_at)'
        )->execute($params);
    }

    /** @return array{timestamp:int, rates:array<string, mixed>} */
    private function request(): array
    {
        $curl = curl_init(self::API . '?' . http_build_query(['symbols' => implode(',', self::CURRENCIES)]));
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'Authorization: Token ' . $this->appId],
            CURLOPT_USERAGENT => 'Chili Finance Dashboard/1.0',
        ]);
        $raw = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $curlError = curl_error($curl);
        curl_close($curl);

        if ($raw === false || $curlError !== '') {
            throw new RuntimeException('could not connect (' . ($curlError ?: 'unknown error') . ').');
        }
        $data = json_decode((string) $raw, true);
        if (!is_array($data)) {
            throw new RuntimeException("HTTP {$status} with an unexpected body.");
        }
        if ($status !== 200 || !empty($data['error'])) {
            $detail = trim((string) ($data['message'] ?? '') . ': ' . (string) ($data['description'] ?? ''), ': ');
            throw new RuntimeException("HTTP {$status}" . ($detail !== '' ? " ({$detail})" : '') . '.');
        }
        if (($data['base'] ?? 'USD') !== 'USD' || !isset($data['rates']) || !is_array($data['rates']) || !isset($data['timestamp'])) {
            throw new RuntimeException('unexpected response.');
        }
        return ['timestamp' => (int) $data['timestamp'], 'rates' => $data['rates']];
    }
}