<?php
declare(strict_types=1);

function seo_domain_key(string $value): string
{
    $host = strtolower(trim($value));
    $host = (string) preg_replace('#^[a-z][a-z0-9+.-]*://#', '', $host);
    $host = (string) preg_replace('#[/?\#].*$#', '', $host);
    $host = (string) preg_replace('#:\d+$#', '', $host);
    return (string) preg_replace('#^www\.#', '', $host);
}

function seo_pagespeed_latest(PDO $pdo, string $strategy = 'mobile'): array
{
    $select = $pdo->prepare(
        "SELECT p.domain, p.score, DATE_FORMAT(p.measured_at, '%Y-%m-%dT%H:%i:%sZ') AS measured_at
           FROM seo_pagespeed p
           JOIN (
                SELECT domain, MAX(measured_at) AS latest
                  FROM seo_pagespeed
                 WHERE strategy = ? AND score IS NOT NULL
                 GROUP BY domain
           ) newest ON newest.domain = p.domain AND newest.latest = p.measured_at
          WHERE p.strategy = ? AND p.score IS NOT NULL"
    );
    $select->execute([$strategy, $strategy]);
    $latest = [];
    foreach ($select->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $latest[(string) $row['domain']] = ['score' => (int) $row['score'], 'measuredAt' => (string) $row['measured_at']];
    }
    return $latest;
}
