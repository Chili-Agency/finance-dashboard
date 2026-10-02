<?php
declare(strict_types=1);

/*
 * Dados do n8n guardados no banco (tabela data_snapshots, ver sql/004_data_snapshots.sql).
 *
 * O dashboard não chama mais os webhooks ao abrir a página: api.php, ads.php e costs.php leem a última
 * resposta gravada aqui. Quem busca de novo é o snapshot-refresh.php, chamado:
 *   - pelo workflow agendado do n8n (4x por mês, junto com a cotação do FX);
 *   - pelo botão Refresh do dashboard.
 *
 * Guarda a resposta crua do n8n (comprimida). O processamento (classificação por conta,
 * onboarding fee, conversão para USD) continua em api.php/ads.php na leitura, então uma
 * mudança de regra vale na hora, sem precisar buscar os dados de novo.
 * Se uma busca falha, a última resposta boa continua valendo e o erro fica registrado.
 */

const SNAPSHOT_LOCK = 'chili_finance_snapshots';
const SNAPSHOT_LOCK_WAIT = 300;        // outra atualização em andamento: espera ela terminar
const SNAPSHOT_FRESH_SECONDS = 60;     // fonte gravada há menos que isso não é buscada de novo
const SNAPSHOT_TIMEOUT = 270;          // tempo máximo de cada webhook (o HubSpot, paginado, é o mais lento)
const SNAPSHOT_SESSION_TIMEOUT = 900;  // wait_timeout da conexão durante a busca (s)
// Fontes que rodam em segundo plano: o webhook só responde "comecei" e o n8n envia o resultado
// depois para snapshot-push.php (a busca do HubSpot passa dos 100 s que o n8n cloud aceita).
const SNAPSHOT_ASYNC = ['sales'];
// Enquanto uma busca em segundo plano não devolve o resultado, não dispara outra (cliques repetidos
// no Refresh somavam execuções simultâneas e estouravam o limite de requisições do HubSpot).
const SNAPSHOT_ASYNC_GUARD = 600; // s

/** @return array<string, string> fonte => URL do webhook */
function snapshot_sources(array $config): array
{
    $sources = [];
    foreach (['br', 'int', 'pa', 'mx'] as $market) {
        $sources["invoices_{$market}"] = (string) ($config['n8n'][$market] ?? '');
    }
    $sources['ads'] = (string) ($config['n8n']['ads'] ?? '');
    $sources['costs'] = (string) ($config['n8n']['costs'] ?? '');
    $sources['sales'] = (string) ($config['n8n']['sales'] ?? '');
    return array_filter($sources, static fn (string $url): bool => $url !== '');
}

/**
 * Busca as fontes no n8n em paralelo e grava as que responderam bem.
 *
 * A busca pode levar minutos (o HubSpot pagina contatos e atividades), e o MySQL derruba conexões
 * ociosas por mais que o wait_timeout ("2006 MySQL server has gone away"). Por isso a sessão pede
 * um wait_timeout maior, a conexão é conferida (e refeita, se preciso) antes de gravar, e cada
 * fonte é gravada à parte: uma falha não impede as outras.
 * @return array{ok:bool, sources:list<array<string, mixed>>, skipped:bool}
 */
function snapshot_refresh(PDO $pdo, array $config, string $updatedBy, ?array $only = null): array
{
    $sources = snapshot_sources($config);
    if ($only !== null) {
        $sources = array_intersect_key($sources, array_flip($only)); // ex.: só 'sales', no agendamento diário
    }
    try {
        $pdo->exec('SET SESSION wait_timeout = ' . SNAPSHOT_SESSION_TIMEOUT);
    } catch (Throwable $error) {
        error_log('[snapshots] wait_timeout: ' . $error->getMessage());
    }

    $lock = $pdo->prepare('SELECT GET_LOCK(?, ?)');
    $lock->execute([SNAPSHOT_LOCK, SNAPSHOT_LOCK_WAIT]);
    if ((int) $lock->fetchColumn() !== 1) {
        throw new RuntimeException('Another refresh is still running. Try again in a few minutes.');
    }

    try {
        // Se outra requisição acabou de gravar (ex.: dois cliques, ou botão logo após o agendamento), não busca de novo.
        $fresh = snapshot_fresh_sources($pdo, array_keys($sources));
        $running = array_values(array_filter(array_keys($sources), static fn (string $name): bool => snapshot_async_running($pdo, $name)));
        $pending = array_diff_key($sources, array_flip($fresh), array_flip($running));
        $fetched = $pending === [] ? [] : snapshot_fetch_all($pending);

        // Se a conexão caiu durante a busca, a trava caiu junto; segue com uma conexão nova.
        $pdo = snapshot_alive($pdo, $config);

        $report = [];
        foreach ($sources as $name => $url) {
            if (in_array($name, $fresh, true)) {
                $report[] = ['source' => $name, 'ok' => true, 'skipped' => true];
                continue;
            }
            if (in_array($name, $running, true)) {
                $report[] = ['source' => $name, 'ok' => true, 'pending' => true, 'skipped' => true];
                continue;
            }
            $result = $fetched[$name];
            if (snapshot_started_in_background($name, $result)) {
                // O resultado chega depois, por snapshot-push.php. A última resposta boa continua valendo.
                snapshot_mark_requested($pdo, $name);
                $report[] = ['source' => $name, 'ok' => true, 'pending' => true, 'seconds' => $result['seconds']];
                continue;
            }
            $error = $result['error'] ?? snapshot_validate($name, (string) $result['body']);
            try {
                if ($error === null) {
                    snapshot_save($pdo, $name, (string) $result['body'], $result['seconds'], $updatedBy);
                } else {
                    snapshot_save_error($pdo, $name, $error, $updatedBy);
                }
            } catch (Throwable $saveError) {
                $error = 'Could not save to the database: ' . $saveError->getMessage();
                $pdo = snapshot_alive($pdo, $config);
                try {
                    snapshot_save_error($pdo, $name, $error, $updatedBy);
                } catch (Throwable $ignored) {
                }
            }
            if ($error !== null) {
                error_log("[snapshots] {$name}: {$error}");
            }
            $report[] = ['source' => $name, 'ok' => $error === null, 'seconds' => $result['seconds'], 'error' => $error];
        }
    } finally {
        try {
            $pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([SNAPSHOT_LOCK]);
        } catch (Throwable $ignored) {
            // conexão perdida: o MySQL já soltou a trava
        }
    }

    return [
        'ok' => !in_array(false, array_column($report, 'ok'), true),
        'skipped' => $pending === [],
        'sources' => $report,
    ];
}

/**
 * Fonte em segundo plano que o n8n aceitou: respondeu 2xx sem o resultado completo ("Workflow was
 * started"), ou estourou os 100 s do n8n cloud (HTTP 524), caso em que o workflow continua rodando.
 * Se o webhook ainda devolver o resultado completo (workflow antigo), ele é gravado normalmente.
 */
function snapshot_started_in_background(string $name, array $result): bool
{
    if (!in_array($name, SNAPSHOT_ASYNC, true)) {
        return false;
    }
    if ($result['error'] === null) {
        return $name === 'sales' && snapshot_decode_sales((string) $result['body']) === null;
    }
    return str_contains((string) $result['error'], 'HTTP 524');
}

/** Linha de controle em data_snapshots (sem payload) que guarda quando a busca foi disparada. */
function snapshot_request_key(string $name): string
{
    return "{$name}_requested";
}

function snapshot_mark_requested(PDO $pdo, string $name): void
{
    try {
        $pdo->prepare(
            'INSERT INTO data_snapshots (source, fetched_at, updated_by) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE fetched_at = VALUES(fetched_at), updated_by = VALUES(updated_by)'
        )->execute([snapshot_request_key($name), gmdate('Y-m-d H:i:s'), 'refresh']);
    } catch (Throwable $error) {
        error_log('[snapshots] mark requested: ' . $error->getMessage());
    }
}

/** Busca em segundo plano disparada há menos de SNAPSHOT_ASYNC_GUARD e ainda sem resultado (bom ou com erro). */
function snapshot_async_running(PDO $pdo, string $name): bool
{
    if (!in_array($name, SNAPSHOT_ASYNC, true)) {
        return false;
    }
    try {
        $select = $pdo->prepare(
            "SELECT source, DATE_FORMAT(fetched_at, '%Y-%m-%d %H:%i:%s') AS fetched_at,
                    DATE_FORMAT(last_error_at, '%Y-%m-%d %H:%i:%s') AS last_error_at
               FROM data_snapshots WHERE source IN (?, ?)"
        );
        $select->execute([$name, snapshot_request_key($name)]);
        $rows = array_column($select->fetchAll(PDO::FETCH_ASSOC), null, 'source');
    } catch (Throwable $error) {
        return false;
    }
    $requested = $rows[snapshot_request_key($name)]['fetched_at'] ?? null;
    if ($requested === null || strtotime($requested . ' UTC') < time() - SNAPSHOT_ASYNC_GUARD) {
        return false;
    }
    $answered = max((string) ($rows[$name]['fetched_at'] ?? ''), (string) ($rows[$name]['last_error_at'] ?? ''));
    return $answered < $requested;
}

/** Devolve a conexão se ela ainda responde; senão abre outra com os dados do .env. */
function snapshot_alive(PDO $pdo, array $config): PDO
{
    try {
        $pdo->query('SELECT 1')->fetchColumn();
        return $pdo;
    } catch (Throwable $error) {
        error_log('[snapshots] reconnecting: ' . $error->getMessage());
    }
    $db = $config['db'];
    $fresh = new PDO(
        sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $db['host'], $db['port'] ?? 3306, $db['name']),
        $db['user'],
        $db['pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
    );
    try {
        $fresh->exec('SET SESSION wait_timeout = ' . SNAPSHOT_SESSION_TIMEOUT);
    } catch (Throwable $ignored) {
    }
    return $fresh;
}

/** Maior pacote que o MySQL aceita, em bytes (null se não der para ler). */
function snapshot_packet_limit(PDO $pdo): ?int
{
    try {
        $value = $pdo->query('SELECT @@max_allowed_packet')->fetchColumn();
        return is_numeric($value) ? (int) $value : null;
    } catch (Throwable $error) {
        return null;
    }
}

/** @return list<string> */
function snapshot_fresh_sources(PDO $pdo, array $names): array
{
    if ($names === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($names), '?'));
    $select = $pdo->prepare(
        "SELECT source FROM data_snapshots
          WHERE source IN ({$placeholders}) AND payload IS NOT NULL
            AND fetched_at >= ?"
    );
    $select->execute([...$names, gmdate('Y-m-d H:i:s', time() - SNAPSHOT_FRESH_SECONDS)]);
    return $select->fetchAll(PDO::FETCH_COLUMN);
}

/**
 * Chama todos os webhooks ao mesmo tempo (o tempo total é o do mais lento, não a soma).
 * @param array<string, string> $sources
 * @return array<string, array{body:?string, seconds:float, error:?string}>
 */
function snapshot_fetch_all(array $sources): array
{
    $multi = curl_multi_init();
    $handles = [];
    foreach ($sources as $name => $url) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => SNAPSHOT_TIMEOUT,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_USERAGENT => 'Chili Finance Dashboard/1.0',
        ]);
        curl_multi_add_handle($multi, $curl);
        $handles[$name] = $curl;
    }

    do {
        $status = curl_multi_exec($multi, $running);
        if ($running) {
            curl_multi_select($multi, 1.0);
        }
    } while ($running && $status === CURLM_OK);

    $results = [];
    foreach ($handles as $name => $curl) {
        $body = curl_multi_getcontent($curl);
        $code = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $curlError = curl_error($curl);
        $seconds = round((float) curl_getinfo($curl, CURLINFO_TOTAL_TIME), 1);
        $error = null;
        if ($curlError !== '' || $body === null || $body === false) {
            $error = 'Could not reach n8n (' . ($curlError ?: 'no response') . ').';
        } elseif ($code < 200 || $code >= 300) {
            $error = "n8n answered HTTP {$code}.";
        } elseif (trim((string) $body) === '') {
            $error = "n8n sent an empty response (HTTP {$code}).";
        }
        $results[$name] = ['body' => $error === null ? (string) $body : null, 'seconds' => $seconds, 'error' => $error];
        curl_multi_remove_handle($multi, $curl);
        curl_close($curl);
    }
    curl_multi_close($multi);
    return $results;
}

/** Confere se a resposta é utilizável antes de substituir a anterior. null = ok. */
function snapshot_validate(string $name, string $body): ?string
{
    if ($name === 'ads') {
        return snapshot_decode_ads($body) === null ? 'n8n returned an unexpected response for ads.' : null;
    }
    if ($name === 'costs') {
        $data = snapshot_decode_costs($body);
        if ($data === null) {
            return 'n8n returned an unexpected response for the subscription costs.';
        }
        // O workflow marca ok=false quando alguma entidade do Xero falhou: não apaga a última resposta boa
        // (o total de custos ficaria subestimado sem aviso).
        if (($data['ok'] ?? true) === false) {
            $errors = array_filter(array_map('strval', (array) ($data['errors'] ?? [])));
            return 'Xero bank transactions: ' . ($errors !== [] ? implode(' · ', $errors) : 'the workflow reported a failure.');
        }
        return null;
    }
    if ($name === 'sales') {
        $data = snapshot_decode_sales($body);
        if ($data === null) {
            return 'n8n returned an unexpected response for sales.';
        }
        // O workflow marca ok=false quando deals ou contatos falharam: não apaga a última resposta boa.
        if (($data['ok'] ?? true) === false) {
            $errors = array_filter(array_map('strval', (array) ($data['errors'] ?? [])));
            return 'HubSpot: ' . ($errors !== [] ? implode(' · ', $errors) : 'the workflow reported a failure.');
        }
        return null;
    }
    $decoded = snapshot_decode_invoices($body);
    if (!$decoded['ok']) {
        return $decoded['error'];
    }
    // O n8n responde 200 mesmo quando o Xero falhou lá dentro (item _empty com _error).
    // Não deixa essa resposta apagar a última boa.
    foreach ($decoded['data'] as $item) {
        if (is_array($item) && !empty($item['_empty']) && !empty($item['_error'])) {
            return 'Xero request failed inside n8n: ' . (string) $item['_error'];
        }
    }
    return null;
}

/**
 * Resposta dos webhooks de invoices: lista de invoices (ou um objeto só).
 * @return array{ok:true, data:list<mixed>}|array{ok:false, error:string}
 */
function snapshot_decode_invoices(string $body): array
{
    $data = json_decode($body, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        $snippet = preg_replace('/\s+/', ' ', substr($body, 0, 200));
        return ['ok' => false, 'error' => "response is not JSON: {$snippet}"];
    }
    if (!is_array($data)) {
        return ['ok' => false, 'error' => 'unexpected JSON scalar: ' . var_export($data, true)];
    }
    $isList = $data === [] || array_keys($data) === range(0, count($data) - 1);
    if (!$isList) {
        if (isset($data['message']) || isset($data['error'])) {
            return ['ok' => false, 'error' => 'n8n error: ' . (string) ($data['message'] ?? $data['error'])];
        }
        $data = [$data];
    }
    return ['ok' => true, 'data' => $data];
}

/** Resposta do webhook de vendas (HubSpot): objeto com deals (o "Respond to Webhook" às vezes embrulha numa lista). */
function snapshot_decode_sales(string $body): ?array
{
    $data = json_decode($body, true);
    if (is_array($data) && isset($data[0]) && is_array($data[0]) && !isset($data['deals'])) {
        $data = $data[0];
    }
    return is_array($data) && isset($data['deals']) && is_array($data['deals']) ? $data : null;
}

/** Resposta do webhook de ads: objeto com rows (o "Respond to Webhook" às vezes embrulha numa lista). */
function snapshot_decode_ads(string $body): ?array
{
    $data = json_decode($body, true);
    if (is_array($data) && isset($data[0]) && is_array($data[0]) && !isset($data['rows'])) {
        $data = $data[0];
    }
    return is_array($data) && isset($data['rows']) && is_array($data['rows']) ? $data : null;
}

/** Resposta do webhook de custos (Xero banco): objeto com rows, no mesmo formato do de ads. */
function snapshot_decode_costs(string $body): ?array
{
    $data = json_decode($body, true);
    if (is_array($data) && isset($data[0]) && is_array($data[0]) && !isset($data['rows'])) {
        $data = $data[0];
    }
    return is_array($data) && isset($data['rows']) && is_array($data['rows']) ? $data : null;
}

function snapshot_save(PDO $pdo, string $name, string $body, ?float $seconds, string $updatedBy): void
{
    $payload = gzcompress($body, 9);
    // Pacote maior que max_allowed_packet derruba a conexão (erro 2006) em vez de dar um erro claro.
    $limit = snapshot_packet_limit($pdo);
    if ($limit !== null && strlen($payload) + 1024 > $limit) {
        throw new RuntimeException(sprintf(
            'the data is %.1f MB compressed, above the MySQL max_allowed_packet of %.1f MB. Ask the host to raise it, or fetch a shorter period.',
            strlen($payload) / 1048576,
            $limit / 1048576
        ));
    }
    $now = gmdate('Y-m-d H:i:s');
    $statement = $pdo->prepare(
        'INSERT INTO data_snapshots (source, payload, payload_bytes, fetched_at, fetch_seconds, last_error, last_error_at, updated_by)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
         ON DUPLICATE KEY UPDATE
            payload = VALUES(payload),
            payload_bytes = VALUES(payload_bytes),
            fetched_at = VALUES(fetched_at),
            fetch_seconds = VALUES(fetch_seconds),
            last_error = NULL,
            last_error_at = NULL,
            updated_by = VALUES(updated_by)'
    );
    $statement->bindValue(1, $name);
    $statement->bindValue(2, $payload, PDO::PARAM_LOB);
    $statement->bindValue(3, strlen($body), PDO::PARAM_INT);
    $statement->bindValue(4, $now);
    $statement->bindValue(5, $seconds, $seconds === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
    $statement->bindValue(6, $updatedBy);
    $statement->execute();
}

function snapshot_save_error(PDO $pdo, string $name, string $error, string $updatedBy): void
{
    $pdo->prepare(
        'INSERT INTO data_snapshots (source, last_error, last_error_at, updated_by)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            last_error = VALUES(last_error),
            last_error_at = VALUES(last_error_at),
            updated_by = VALUES(updated_by)'
    )->execute([$name, (function_exists('mb_substr') ? mb_substr($error, 0, 1000) : substr($error, 0, 1000)), gmdate('Y-m-d H:i:s'), $updatedBy]);
}

/**
 * Última resposta gravada de cada fonte pedida.
 * @param list<string> $names
 * @return array<string, array{body:?string, fetchedAt:?string, seconds:?float, error:?string, errorAt:?string}>
 */
function snapshot_read(PDO $pdo, array $names): array
{
    $result = array_fill_keys($names, null);
    if ($names === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($names), '?'));
    $select = $pdo->prepare(
        "SELECT source, payload, fetch_seconds, last_error,
                DATE_FORMAT(fetched_at, '%Y-%m-%dT%H:%i:%sZ') AS fetched_at,
                DATE_FORMAT(last_error_at, '%Y-%m-%dT%H:%i:%sZ') AS last_error_at
           FROM data_snapshots WHERE source IN ({$placeholders})"
    );
    $select->execute($names);
    foreach ($select->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $payload = is_resource($row['payload']) ? stream_get_contents($row['payload']) : $row['payload'];
        $body = is_string($payload) && $payload !== '' ? @gzuncompress($payload) : false;
        $result[$row['source']] = [
            'body' => is_string($body) ? $body : null,
            'fetchedAt' => $row['fetched_at'],
            'seconds' => $row['fetch_seconds'] === null ? null : (float) $row['fetch_seconds'],
            'error' => $row['last_error'],
            'errorAt' => $row['last_error_at'],
        ];
    }
    return $result;
}