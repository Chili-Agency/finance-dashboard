<?php
declare(strict_types=1);
require __DIR__ . '/auth.php';
$currentUser = auth_require_page();
$csrfToken = (string) ($_SESSION['csrf_token'] ?? '');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

function asset(string $path): string
{
    $file = __DIR__ . '/' . $path;
    $version = is_file($file) ? (string) filemtime($file) : '1';
    return htmlspecialchars("{$path}?v={$version}", ENT_QUOTES, 'UTF-8');
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#f4f1eb">
    <title>Chili Finance</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="<?= asset('assets/styles.css') ?>">
</head>
<body>
    <div class="app-shell">
        <aside class="sidebar">
            <a class="brand" href="index.php" aria-label="Chili Finance home">
                <span class="brand-mark">C</span>
                <span>CHILI<small>FINANCE</small></span>
            </a>
            <div class="sidebar-rule"></div>
            <p class="eyebrow">Workspace</p>
            <nav class="main-nav" aria-label="Main navigation">
                <button class="nav-item is-active" data-view="overview" data-title="Overview"><span class="nav-icon">◍</span>Overview</button>
                <button class="nav-item" data-view="invoices" data-title="Invoices"><span class="nav-icon">◒</span>Invoices</button>
                <button class="nav-item" data-view="late" data-title="Late invoices"><span class="nav-icon">◔</span>Late invoices</button>
                <button class="nav-item" data-view="unit" data-title="Unit economics"><span class="nav-icon">◈</span>Unit economics</button>
                <button class="nav-item" data-view="mrr" data-title="MRR tracking"><span class="nav-icon">↗</span>MRR tracking</button>
                <button class="nav-item" data-view="retention" data-title="Retention"><span class="nav-icon">◐</span>Retention</button>
                <button class="nav-item" data-view="targets" data-title="Targets"><span class="nav-icon">◎</span>Targets</button>
                <button class="nav-item" data-view="margin" data-title="Margin &amp; COGS"><span class="nav-icon">◇</span>Margin &amp; COGS</button>
            </nav>
            <div class="sidebar-bottom">
                <div class="sync-card" id="sync-card" data-state="loading" role="status" aria-live="polite">
                    <div class="sync-head">
                        <span class="sync-dot" aria-hidden="true"></span>
                        <div><strong id="sync-status">Loading data…</strong><small id="sync-time">Contacting the n8n workflows</small></div>
                    </div>
                    <ul class="sync-sources" id="sync-sources"></ul>
                </div>
                <div class="user-card">
                    <div class="user-meta">
                        <strong><?= htmlspecialchars($currentUser['name'], ENT_QUOTES, 'UTF-8') ?></strong>
                        <small><?= htmlspecialchars($currentUser['email'], ENT_QUOTES, 'UTF-8') ?></small>
                    </div>
                    <form method="post" action="logout.php">
                        <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
                        <button type="submit" class="logout-button">Sign out</button>
                    </form>
                </div>
                <p class="sidebar-note">Four entities · three markets<br>USD reporting view</p>
            </div>
        </aside>

        <main class="content">
            <header class="topbar">
                <div>
                    <p class="eyebrow">Finance control room</p>
                    <h1 id="page-title">Overview</h1>
                </div>
                <div class="topbar-actions">
                    <label class="period-picker">
                        <span>Reporting period</span>
                        <select id="period-select" aria-label="Reporting period">
                            <option value="current">Current month</option>
                            <option value="previous">Previous month</option>
                            <option value="two-previous">Two months ago</option>
                            <option value="quarter">Last 3 months</option>
                            <option value="all">All available</option>
                            <option value="custom">Custom range</option>
                        </select>
                    </label>
                    <div class="date-range" id="date-range" hidden>
                        <label><span>From</span><input type="date" id="date-from"></label>
                        <label><span>To</span><input type="date" id="date-to"></label>
                        <button class="apply-button" id="apply-date-filter">Apply</button>
                    </div>
                    <button class="refresh-button" id="refresh-button" title="Refresh invoice data"><span>↻</span> Refresh</button>
                </div>
            </header>

            <div class="notice is-hidden" id="error-notice" role="status"></div>


            <section class="view is-visible" id="overview-view" aria-labelledby="page-title">
                <div class="section-intro">
                    <div>
                        <p class="eyebrow">Plan vs actual</p>
                        <h2>Where the year stands</h2>
                        <p class="section-copy" id="summary-scope-note">Plan versus actual for the selected year, in one screen.</p>
                        <div class="manual-input-bar">
                            <button type="button" class="input-button" id="open-import-modal" aria-haspopup="dialog" aria-controls="import-modal"><span aria-hidden="true">↑</span> Import targets sheet</button>
                            <p class="manual-input-status" id="import-status" data-tone="muted" aria-live="polite"></p>
                        </div>
                    </div>
                    <div class="filter-stack">
                        <div class="scope-tabs" role="tablist" aria-label="Company scope">
                            <button class="scope-tab is-active" data-scope="all" role="tab">Global</button>
                            <button class="scope-tab" data-scope="br" role="tab">Brazil</button>
                            <button class="scope-tab" data-scope="mx" role="tab">Mexico</button>
                            <button class="scope-tab" data-scope="pa" role="tab">Panama</button>
                            <button class="scope-tab" data-scope="int" role="tab">International</button>
                        </div>
                        <div class="category-filter">
                            <span>Service</span>
                            <div class="category-tabs" role="tablist" aria-label="Service line">
                                <button class="category-tab is-active" data-category="all" role="tab">All</button>
                                <button class="category-tab" data-category="seo" role="tab">SEO</button>
                                <button class="category-tab" data-category="ppc" role="tab">PPC</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="metric-grid">
                    <article class="metric-card summary-card" id="sum-revenue-card"><div class="metric-heading"><span class="metric-label">Revenue vs target</span><span class="metric-badge">01</span></div><strong id="sum-revenue-value">—</strong><div class="summary-bar"><span id="sum-revenue-bar"></span></div><p id="sum-revenue-note">—</p><p class="summary-foot" id="sum-revenue-foot">—</p></article><article class="metric-card summary-card" id="sum-retention-card"><div class="metric-heading"><span class="metric-label">Retention vs target</span><span class="metric-badge">02</span></div><strong id="sum-retention-value">—</strong><div class="summary-bar"><span id="sum-retention-bar"></span></div><p id="sum-retention-note">—</p><p class="summary-foot" id="sum-retention-foot">—</p></article><article class="metric-card summary-card" id="sum-margin-card"><div class="metric-heading"><span class="metric-label">Margin vs target</span><span class="metric-badge">03</span></div><strong id="sum-margin-value">—</strong><div class="summary-bar"><span id="sum-margin-bar"></span></div><p id="sum-margin-note">—</p><p class="summary-foot" id="sum-margin-foot">—</p></article><article class="metric-card summary-card" id="sum-cogs-card"><div class="metric-heading"><span class="metric-label">COGS vs budget</span><span class="metric-badge">04</span></div><strong id="sum-cogs-value">—</strong><div class="summary-bar"><span id="sum-cogs-bar"></span></div><p id="sum-cogs-note">—</p><p class="summary-foot" id="sum-cogs-foot">—</p></article>
                </div>

                <article class="panel table-panel summary-matrix-panel">
                    <div class="panel-header"><div><p class="eyebrow">Every indicator, month by month</p><h3 id="summary-matrix-title">Year to date</h3></div><span class="panel-meta">Green above target · red below</span></div>
                    <div class="table-scroll"><table class="summary-matrix"><thead><tr id="summary-matrix-head"></tr></thead><tbody id="summary-matrix"></tbody></table></div>
                    <p class="manual-input-status summary-foot-note" id="summary-matrix-note" data-tone="muted"></p>
                </article>

                <div class="dashboard-grid summary-grid">
                    <article class="panel chart-panel">
                        <div class="panel-header"><div><p class="eyebrow">Plan</p><h3>Actual against plan</h3></div><button type="button" class="link-button" data-goto-view="targets">Open Targets →</button></div>
                        <p class="section-copy summary-chart-copy">Monthly MRR in USD · bars are actual, the line is the target.</p>
                        <div class="summary-chart-wrap"><canvas id="summary-plan-chart"></canvas><div class="chart-empty is-hidden" id="summary-plan-empty">No data for this year</div></div>
                    </article>
                    <article class="panel">
                        <div class="panel-header"><div><p class="eyebrow">Portfolio</p><h3>Health</h3></div><button type="button" class="link-button" data-goto-view="retention">Open →</button></div>
                        <div class="health-list" id="summary-health"></div>
                        <p class="manual-input-status" id="summary-bonus-note" data-tone="muted"></p>
                    </article>
                </div>

                <article class="panel">
                    <div class="panel-header"><div><p class="eyebrow">Bridge</p><h3 id="summary-bridge-title">Portfolio bridge</h3></div><span class="panel-meta">USD</span></div>
                    <p class="section-copy summary-chart-copy">What came into and left the recurring base this year.</p>
                    <div class="summary-chart-wrap"><canvas id="summary-bridge-chart"></canvas><div class="chart-empty is-hidden" id="summary-bridge-empty">No data for this year</div></div>
                </article>
            </section>

            <section class="view" id="invoices-view" aria-labelledby="page-title">
                <div class="section-intro">
                    <div><p class="eyebrow">Invoice pulse</p><h2>What is happening now?</h2></div>
                    <div class="filter-stack">
                        <div class="scope-tabs" role="tablist" aria-label="Company scope">
                            <button class="scope-tab is-active" data-scope="all" role="tab">Global</button>
                            <button class="scope-tab" data-scope="br" role="tab">Brazil</button>
                            <button class="scope-tab" data-scope="mx" role="tab">Mexico</button>
                            <button class="scope-tab" data-scope="pa" role="tab">Panama</button>
                            <button class="scope-tab" data-scope="int" role="tab">International</button>
                        </div>
                        <div class="category-filter">
                            <span>Service</span>
                            <div class="category-tabs" role="tablist" aria-label="Service line">
                                <button class="category-tab is-active" data-category="all" role="tab">All</button>
                                <button class="category-tab" data-category="seo" role="tab">SEO</button>
                                <button class="category-tab" data-category="ppc" role="tab">PPC</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="metric-grid">
                    <article class="metric-card metric-paid"><div class="metric-heading"><span class="metric-label">Paid invoices</span><span class="metric-badge">01</span></div><strong id="paid-total">$0</strong><p><span id="paid-count">0 invoices</span> collected in period</p></article>
                    <article class="metric-card metric-late"><div class="metric-heading"><span class="metric-label">Late invoices</span><span class="metric-badge">02</span></div><strong id="late-total">$0</strong><p><span id="late-count">0 invoices</span> overdue today, any issue date</p></article>
                    <article class="metric-card metric-open"><div class="metric-heading"><span class="metric-label">Open invoices</span><span class="metric-badge">03</span></div><strong id="open-total">$0</strong><p><span id="open-count">0 invoices</span> still outstanding</p></article>
                    <article class="metric-card metric-total"><div class="metric-heading"><span class="metric-label">Total invoiced</span><span class="metric-badge">04</span></div><strong id="all-total">$0</strong><p><span id="all-count">0 invoices</span> <span class="metric-muted" id="all-note">issued in period</span></p></article>
                </div>

                <div class="dashboard-grid">
                    <article class="panel chart-panel"><div class="panel-header"><div><p class="eyebrow">Distribution</p><h3>Invoice status</h3></div><span class="panel-meta" id="invoice-count">0 invoices</span></div><div class="chart-wrap"><canvas id="status-chart"></canvas><div class="chart-empty" id="chart-empty">No invoices in this period</div></div><div class="legend" id="chart-legend"></div></article>
                    <article class="panel market-panel"><div class="panel-header"><div><p class="eyebrow">Portfolio</p><h3>By market</h3></div><span class="panel-meta">USD view</span></div><div class="market-list" id="market-list"></div><div class="rate-note">Rates pulled live from <strong>Open Exchange Rates</strong> at fetch time.</div></article>
                </div>

                <article class="panel table-panel"><div class="panel-header"><div><p class="eyebrow">Ledger</p><h3>Client invoices</h3></div><span class="panel-meta" id="table-summary">0 records</span></div><div class="table-scroll"><table><thead><tr><th>Client / invoice</th><th>Market</th><th>Issued</th><th>Due</th><th>Status</th><th class="align-right">Amount (USD)</th></tr></thead><tbody id="invoice-table"></tbody></table><div class="table-empty is-hidden" id="table-empty">No client invoices match this period.</div></div></article>
            </section>

            <section class="view" id="late-view" aria-labelledby="page-title">
                <div class="section-intro">
                    <div>
                        <p class="eyebrow">Collections</p>
                        <h2>What is overdue?</h2>
                        <p class="section-copy">Every unpaid client invoice past its due date, as of today. The reporting period does not apply here.</p>
                        <p class="manual-input-status late-index-note" id="late-index-note" data-tone="muted" aria-live="polite"></p>
                    </div>
                    <div class="filter-stack">
                        <div class="scope-tabs" role="tablist" aria-label="Company scope">
                            <button class="scope-tab is-active" data-scope="all" role="tab">Global</button>
                            <button class="scope-tab" data-scope="br" role="tab">Brazil</button>
                            <button class="scope-tab" data-scope="mx" role="tab">Mexico</button>
                            <button class="scope-tab" data-scope="pa" role="tab">Panama</button>
                            <button class="scope-tab" data-scope="int" role="tab">International</button>
                        </div>
                        <div class="category-filter">
                            <span>Service</span>
                            <div class="category-tabs" role="tablist" aria-label="Service line">
                                <button class="category-tab is-active" data-category="all" role="tab">All</button>
                                <button class="category-tab" data-category="seo" role="tab">SEO</button>
                                <button class="category-tab" data-category="ppc" role="tab">PPC</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="metric-grid">
                    <article class="metric-card metric-late"><div class="metric-heading"><span class="metric-label">Overdue balance</span><span class="metric-badge">01</span></div><strong id="late-principal">$0</strong><p><span id="late-invoice-count">0 invoices</span> <span class="metric-muted" id="late-client-count">from 0 clients</span></p></article>
                    <article class="metric-card metric-interest"><div class="metric-heading"><span class="metric-label">Late charges</span><span class="metric-badge">02</span></div><strong id="late-charges">$0</strong><p><span id="late-fees">$0 fees + $0 interest</span> <span class="metric-muted" id="late-correction">+ $0 correction</span></p></article>
                    <article class="metric-card metric-total"><div class="metric-heading"><span class="metric-label">Total to collect</span><span class="metric-badge">03</span></div><strong id="late-total-due">$0</strong><p><span id="late-rate-label">—</span> <span class="metric-muted">applied</span></p></article>
                    <article class="metric-card metric-open"><div class="metric-heading"><span class="metric-label">Average delay</span><span class="metric-badge">04</span></div><strong id="late-average-days">0 days</strong><p><span id="late-oldest">—</span> <span class="metric-muted">oldest · weighted by balance</span></p></article>
                </div>

                                <article class="panel manual-panel">
                    <div class="panel-header">
                        <div><p class="eyebrow">Manual input</p><h3>Late charge rates</h3></div>
                        <button type="button" class="button-secondary" id="open-rules-modal">Edit rates</button>
                    </div>
                    <div class="rules-summary" id="late-rules-summary"></div>
                    <p class="manual-input-status" id="late-rules-status" data-tone="muted" aria-live="polite"></p>
                </article>

                <div class="dashboard-grid">
                    <article class="panel"><div class="panel-header"><div><p class="eyebrow">Aging</p><h3>Days past due</h3></div><span class="panel-meta">Balance + charges</span></div><div class="market-list aging-list" id="late-aging"></div></article>
                    <article class="panel market-panel"><div class="panel-header"><div><p class="eyebrow">Portfolio</p><h3>By market</h3></div><span class="panel-meta">USD view</span></div><div class="market-list" id="late-markets"></div></article>
                </div>

                <article class="panel table-panel"><div class="panel-header"><div><p class="eyebrow">Ledger</p><h3>Overdue invoices</h3></div><span class="panel-meta" id="late-table-summary">0 records</span></div><div class="table-scroll"><table class="late-table"><thead><tr><th>Client / invoice</th><th>Market</th><th>Issued</th><th>Due</th><th class="align-right">Days late</th><th class="align-right">Balance (USD)</th><th class="align-right">Correction</th><th class="align-right">Late fee</th><th class="align-right">Interest</th><th class="align-right">Total due</th></tr></thead><tbody id="late-table"></tbody></table><div class="table-empty is-hidden" id="late-table-empty">No overdue invoices.</div></div></article>
            </section>


            <section class="view" id="unit-view" aria-labelledby="page-title">
                <div class="section-intro">
                    <div>
                        <p class="eyebrow">Unit economics</p>
                        <h2>What a client costs and returns</h2>
                        <p class="section-copy">ATV, LTV and ALT come from the Xero invoices. CAC and CPL use the costs and leads entered below.</p>
                    </div>
                    <div class="filter-stack">
                        <div class="scope-tabs" role="tablist" aria-label="Company scope">
                            <button class="scope-tab is-active" data-scope="all" role="tab">Global</button>
                            <button class="scope-tab" data-scope="br" role="tab">Brazil</button>
                            <button class="scope-tab" data-scope="mx" role="tab">Mexico</button>
                            <button class="scope-tab" data-scope="pa" role="tab">Panama</button>
                            <button class="scope-tab" data-scope="int" role="tab">International</button>
                        </div>
                        <div class="category-filter">
                            <span>Service</span>
                            <div class="category-tabs" role="tablist" aria-label="Service line">
                                <button class="category-tab is-active" data-category="all" role="tab">All</button>
                                <button class="category-tab" data-category="seo" role="tab">SEO</button>
                                <button class="category-tab" data-category="ppc" role="tab">PPC</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="metric-grid unit-grid">
                    <article class="metric-card unit-card" id="unit-atv-card"><div class="metric-heading"><span class="metric-label">ATV</span><span class="metric-badge">01</span></div><strong id="unit-atv-value">—</strong><p id="unit-atv-note">—</p><p class="summary-foot" id="unit-atv-foot">—</p></article><article class="metric-card unit-card" id="unit-arpa-card"><div class="metric-heading"><span class="metric-label">ARPA / month</span><span class="metric-badge">02</span></div><strong id="unit-arpa-value">—</strong><p id="unit-arpa-note">—</p><p class="summary-foot" id="unit-arpa-foot">—</p></article><article class="metric-card unit-card" id="unit-alt-card"><div class="metric-heading"><span class="metric-label">ALT</span><span class="metric-badge">03</span></div><strong id="unit-alt-value">—</strong><p id="unit-alt-note">—</p><p class="summary-foot" id="unit-alt-foot">—</p></article><article class="metric-card unit-card" id="unit-ltv-card"><div class="metric-heading"><span class="metric-label">LTV</span><span class="metric-badge">04</span></div><strong id="unit-ltv-value">—</strong><p id="unit-ltv-note">—</p><p class="summary-foot" id="unit-ltv-foot">—</p></article><article class="metric-card unit-card" id="unit-cac-card"><div class="metric-heading"><span class="metric-label">CAC</span><span class="metric-badge">05</span></div><strong id="unit-cac-value">—</strong><p id="unit-cac-note">—</p><p class="summary-foot" id="unit-cac-foot">—</p></article><article class="metric-card unit-card" id="unit-cpl-card"><div class="metric-heading"><span class="metric-label">CPL</span><span class="metric-badge">06</span></div><strong id="unit-cpl-value">—</strong><p id="unit-cpl-note">—</p><p class="summary-foot" id="unit-cpl-foot">—</p></article><article class="metric-card unit-card" id="unit-ratio-card"><div class="metric-heading"><span class="metric-label">LTV / CAC</span><span class="metric-badge">07</span></div><strong id="unit-ratio-value">—</strong><p id="unit-ratio-note">—</p><p class="summary-foot" id="unit-ratio-foot">—</p></article><article class="metric-card unit-card" id="unit-clients-card"><div class="metric-heading"><span class="metric-label">New clients</span><span class="metric-badge">08</span></div><strong id="unit-clients-value">—</strong><p id="unit-clients-note">—</p><p class="summary-foot" id="unit-clients-foot">—</p></article>
                </div>

                <article class="panel manual-panel">
                    <div class="panel-header">
                        <div><p class="eyebrow">Manual input</p><h3>Acquisition costs and leads</h3></div>
                        <button type="button" class="button-secondary" id="open-unit-modal">Enter figures</button>
                    </div>
                    <p class="manual-input-status" id="unit-input-status" data-tone="muted" aria-live="polite"></p>
                </article>

                <article class="panel table-panel entries-panel monthly-panel">
                    <div class="panel-header">
                        <div><p class="eyebrow">Month by month</p><h3>Metrics by month</h3></div>
                        <div class="entries-tools">
                            <span class="panel-meta" id="unit-entries-summary">0 entries</span>
                            <div class="category-tabs entries-tabs" role="tablist" aria-label="Entries shown">
                                <button class="entries-tab is-active" data-unit-table="unit" data-entries="all" role="tab">All entries</button>
                                <button class="entries-tab" data-unit-table="unit" data-entries="view" role="tab">Current view</button>
                            </div>
                        </div>
                    </div>
                    <div class="table-scroll monthly-scroll">
                        <table class="entries-table"><thead><tr><th>Month</th><th>Market</th><th>Service</th><th class="align-right">Revenue</th><th class="align-right">Invoices</th><th class="align-right">ATV</th><th class="align-right">Active clients</th><th class="align-right">ARPA</th><th class="align-right">New clients</th><th class="align-right">S&amp;M cost</th><th class="align-right">CAC</th><th class="align-right">Marketing cost</th><th class="align-right">Leads</th><th class="align-right">CPL</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody id="unit-entries-table"></tbody></table>
                        <div class="table-empty is-hidden" id="unit-entries-empty"></div>
                    </div>
                </article>

                <article class="panel table-panel entries-panel monthly-panel">
                    <div class="panel-header">
                        <div><p class="eyebrow">Client by client</p><h3>Lifetime by client</h3></div>
                        <div class="entries-tools">
                            <span class="panel-meta" id="client-entries-summary">0 entries</span>
                            <div class="category-tabs entries-tabs" role="tablist" aria-label="Entries shown">
                                <button class="entries-tab is-active" data-unit-table="client" data-entries="all" role="tab">All clients</button>
                                <button class="entries-tab" data-unit-table="client" data-entries="view" role="tab">Churned only</button>
                            </div>
                        </div>
                    </div>
                    <div class="table-scroll monthly-scroll">
                        <table class="entries-table"><thead><tr><th>Client</th><th>Market</th><th class="align-right">First invoice</th><th class="align-right">Last invoice</th><th class="align-right">Months</th><th class="align-right">Revenue</th><th class="align-right">ARPA</th><th class="align-right">Status</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody id="client-entries-table"></tbody></table>
                        <div class="table-empty is-hidden" id="client-entries-empty"></div>
                    </div>
                </article>
            </section>

            <section class="view" id="mrr-view" aria-labelledby="page-title"><div class="section-intro mrr-intro"><div><p class="eyebrow">Revenue intelligence</p><h2>Monthly recurring revenue</h2><p class="section-copy">Issued client invoices, normalized to USD. Use the period selector to compare months.</p></div><div class="mrr-side"><div class="filter-stack"><div class="scope-tabs" role="tablist" aria-label="Company scope"><button class="scope-tab is-active" data-scope="all" role="tab">Global</button><button class="scope-tab" data-scope="br" role="tab">Brazil</button><button class="scope-tab" data-scope="mx" role="tab">Mexico</button><button class="scope-tab" data-scope="pa" role="tab">Panama</button><button class="scope-tab" data-scope="int" role="tab">International</button></div><div class="category-filter"><span>Service</span><div class="category-tabs" role="tablist" aria-label="Service line"><button class="category-tab is-active" data-category="all" role="tab">All</button><button class="category-tab" data-category="seo" role="tab">SEO</button><button class="category-tab" data-category="ppc" role="tab">PPC</button></div></div></div><div class="mrr-callout"><span>Selected period</span><strong id="mrr-total">$0</strong><small id="mrr-label">Current month</small></div></div></div><article class="panel mrr-panel"><div class="panel-header"><div><p class="eyebrow">Trend</p><h3>Revenue by month</h3></div><span class="panel-meta">Issued invoices</span></div><div class="mrr-chart-wrap"><canvas id="mrr-chart"></canvas><div class="chart-empty" id="mrr-empty">No revenue data available</div></div></article><div class="mrr-breakdown" id="mrr-breakdown"></div>
                <article class="panel table-panel entries-panel monthly-panel">
                    <div class="panel-header">
                        <div><p class="eyebrow">Month by month</p><h3>MRR log</h3></div>
                        <div class="entries-tools">
                            <span class="panel-meta" id="mrr-entries-summary">0 entries</span>
                            <div class="category-tabs entries-tabs" role="tablist" aria-label="Entries shown">
                                <button class="entries-tab is-active" data-monthly="mrr" data-entries="all" role="tab">All entries</button>
                                <button class="entries-tab" data-monthly="mrr" data-entries="view" role="tab">Current view</button>
                            </div>
                        </div>
                    </div>
                    <div class="table-scroll monthly-scroll">
                        <table class="entries-table">
                            <thead><tr><th>Month</th><th>Market</th><th>Service</th><th class="align-right">MRR</th><th class="align-right">vs previous month</th><th class="align-right">Invoices</th><th class="align-right">Active clients</th><th class="align-right">Avg per client</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
                            <tbody id="mrr-entries-table"></tbody>
                        </table>
                        <div class="table-empty is-hidden" id="mrr-entries-empty"></div>
                    </div>
                </article>
            </section>

            <section class="view" id="retention-view" aria-labelledby="page-title">
                <div class="section-intro">
                    <div>
                        <p class="eyebrow">Portfolio health</p>
                        <h2>Retention of existing clients</h2>
                        <p class="section-copy">How much of the base we started the period with is still billing at the end of it.</p>
                    </div>
                    <div class="filter-stack">
                        <div class="scope-tabs" role="tablist" aria-label="Company scope">
                            <button class="scope-tab is-active" data-scope="all" role="tab">Global</button>
                            <button class="scope-tab" data-scope="br" role="tab">Brazil</button>
                            <button class="scope-tab" data-scope="mx" role="tab">Mexico</button>
                            <button class="scope-tab" data-scope="pa" role="tab">Panama</button>
                            <button class="scope-tab" data-scope="int" role="tab">International</button>
                        </div>
                        <div class="category-filter">
                            <span>Service</span>
                            <div class="category-tabs" role="tablist" aria-label="Service line">
                                <button class="category-tab is-active" data-category="all" role="tab">All</button>
                                <button class="category-tab" data-category="seo" role="tab">SEO</button>
                                <button class="category-tab" data-category="ppc" role="tab">PPC</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="scorecard-grid">
                    <article class="stat-card">
                        <span class="stat-label">Initial portfolio value</span>
                        <strong id="ret-initial">—</strong>
                        <p class="stat-note" id="ret-initial-note">Previous period</p>
                    </article>
                    <article class="stat-card is-negative">
                        <span class="stat-label">Churned value</span>
                        <strong id="ret-churned">—</strong>
                        <p class="stat-note"><span id="ret-churn-rate">—</span> of the initial base · <span id="ret-churn-note">—</span></p>
                    </article>
                    <article class="stat-card is-positive">
                        <span class="stat-label">Upsells &amp; cross-sells</span>
                        <strong id="ret-upsells">—</strong>
                        <p class="stat-note"><span id="ret-expansion-rate">—</span> expansion · <span id="ret-upsell-note">—</span></p>
                    </article>
                    <article class="stat-card is-neutral">
                        <span class="stat-label">Active clients</span>
                        <strong id="ret-clients">—</strong>
                        <p class="stat-note" id="ret-clients-note">Billing at least once in the period</p>
                    </article>
                </div>

                <div class="split-grid is-wide-left">
                    <article class="panel">
                        <div class="panel-header">
                            <div><p class="eyebrow">Movement</p><h3>How the base changed</h3></div>
                            <span class="panel-meta">USD view</span>
                        </div>
                        <div class="waterfall" id="retention-waterfall"></div>
                    </article>

                    <article class="panel target-panel">
                        <div class="panel-header">
                            <div><p class="eyebrow">Goal</p><h3>Retention vs target</h3></div>
                        </div>
                        <div class="target-block" id="retention-target"></div>
                    </article>
                </div>

                <article class="panel table-panel entries-panel monthly-panel">
                    <div class="panel-header">
                        <div><p class="eyebrow">Month by month</p><h3>Retention log</h3></div>
                        <div class="entries-tools">
                            <span class="panel-meta" id="retention-entries-summary">0 entries</span>
                            <div class="category-tabs entries-tabs" role="tablist" aria-label="Entries shown">
                                <button class="entries-tab is-active" data-monthly="retention" data-entries="all" role="tab">All entries</button>
                                <button class="entries-tab" data-monthly="retention" data-entries="view" role="tab">Current view</button>
                            </div>
                        </div>
                    </div>
                    <div class="table-scroll monthly-scroll">
                        <table class="entries-table">
                            <thead><tr><th>Month</th><th>Market</th><th>Service</th><th class="align-right">Initial base</th><th class="align-right">Churned</th><th class="align-right">Upsells</th><th class="align-right">Retained</th><th class="align-right">Retention</th><th class="align-right">Target</th><th class="align-right">Clients lost</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
                            <tbody id="retention-entries-table"></tbody>
                        </table>
                        <div class="table-empty is-hidden" id="retention-entries-empty"></div>
                    </div>
                </article>
            </section>

            <section class="view" id="targets-view" aria-labelledby="page-title">
                <div class="section-intro">
                    <div>
                        <p class="eyebrow">Growth</p>
                        <h2>New business and total MRR</h2>
                        <p class="section-copy">Actuals against plan for the selected period, plus the gap carried from earlier months.</p>
                        <div class="manual-input-bar">
                            <button type="button" class="input-button" id="open-targets-modal" aria-haspopup="dialog" aria-controls="targets-modal"><span aria-hidden="true">+</span> Set Target MRR</button>
                            <p class="manual-input-status" id="targets-input-status" aria-live="polite"></p>
                        </div>
                    </div>
                    <div class="filter-stack">
                        <div class="scope-tabs" role="tablist" aria-label="Company scope">
                            <button class="scope-tab is-active" data-scope="all" role="tab">Global</button>
                            <button class="scope-tab" data-scope="br" role="tab">Brazil</button>
                            <button class="scope-tab" data-scope="mx" role="tab">Mexico</button>
                            <button class="scope-tab" data-scope="pa" role="tab">Panama</button>
                            <button class="scope-tab" data-scope="int" role="tab">International</button>
                        </div>
                        <div class="category-filter">
                            <span>Service</span>
                            <div class="category-tabs" role="tablist" aria-label="Service line">
                                <button class="category-tab is-active" data-category="all" role="tab">All</button>
                                <button class="category-tab" data-category="seo" role="tab">SEO</button>
                                <button class="category-tab" data-category="ppc" role="tab">PPC</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="split-grid">
                    <article class="panel target-panel">
                        <div class="panel-header">
                            <div><p class="eyebrow">Acquisition</p><h3>New Business (MRR)</h3></div>
                        </div>
                        <div class="target-block" id="newbiz-target"></div>
                    </article>

                    <article class="panel target-panel">
                        <div class="panel-header">
                            <div><p class="eyebrow">Run rate</p><h3>Total MRR</h3></div>
                        </div>
                        <div class="target-block" id="totalmrr-target"></div>
                    </article>
                </div>

                <div class="scorecard-grid is-three">
                    <article class="stat-card">
                        <span class="stat-label">Total Difference</span>
                        <strong id="mrr-difference">—</strong>
                        <p class="stat-note">Total MRR minus target, this period</p>
                    </article>
                    <article class="stat-card">
                        <span class="stat-label">To Target</span>
                        <strong id="mrr-to-target">—</strong>
                        <p class="stat-note">Still missing to close the period</p>
                    </article>
                    <article class="stat-card">
                        <span class="stat-label">Accumulated Gap/Excess</span>
                        <strong id="mrr-accumulated">—</strong>
                        <p class="stat-note" id="mrr-accumulated-note">Carried from the start of the year</p>
                    </article>
                </div>

                <article class="panel">
                    <div class="panel-header">
                        <div><p class="eyebrow">Trend</p><h3>Actual against plan</h3></div>
                        <span class="panel-meta">Monthly, USD</span>
                    </div>
                    <div class="mrr-chart-wrap">
                        <canvas id="gap-chart"></canvas>
                        <div class="chart-empty is-hidden" id="gap-empty">Connect the targets source to plot this chart</div>
                    </div>
                </article>

                <article class="panel table-panel entries-panel monthly-panel">
                    <div class="panel-header">
                        <div><p class="eyebrow">Month by month</p><h3>Targets log</h3></div>
                        <div class="entries-tools">
                            <span class="panel-meta" id="targets-entries-summary">0 entries</span>
                            <div class="category-tabs entries-tabs" role="tablist" aria-label="Entries shown">
                                <button class="entries-tab is-active" data-monthly="targets" data-entries="all" role="tab">All entries</button>
                                <button class="entries-tab" data-monthly="targets" data-entries="view" role="tab">Current view</button>
                            </div>
                        </div>
                    </div>
                    <div class="table-scroll monthly-scroll">
                        <table class="entries-table">
                            <thead><tr><th>Month</th><th>Market</th><th>Service</th><th class="align-right">Total MRR</th><th class="align-right">Target MRR</th><th class="align-right">Difference</th><th class="align-right">New business</th><th class="align-right">Target new business</th><th class="align-right">Accumulated gap</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
                            <tbody id="targets-entries-table"></tbody>
                        </table>
                        <div class="table-empty is-hidden" id="targets-entries-empty"></div>
                    </div>
                </article>
            </section>

            <section class="view" id="margin-view" aria-labelledby="page-title">
                <div class="section-intro">
                    <div>
                        <p class="eyebrow">Profitability</p>
                        <h2>Cost of delivery and margin</h2>
                        <p class="section-copy">What delivery costs against plan, and what is left for the team.</p>
                        <div class="manual-input-bar">
                            <button type="button" class="input-button" id="open-margin-modal" aria-haspopup="dialog" aria-controls="margin-modal"><span aria-hidden="true">+</span> Enter COGS &amp; margin</button>
                            <p class="manual-input-status" id="margin-input-status" aria-live="polite"></p>
                        </div>
                    </div>
                    <div class="filter-stack">
                        <div class="scope-tabs" role="tablist" aria-label="Company scope">
                            <button class="scope-tab is-active" data-scope="all" role="tab">Global</button>
                            <button class="scope-tab" data-scope="br" role="tab">Brazil</button>
                            <button class="scope-tab" data-scope="mx" role="tab">Mexico</button>
                            <button class="scope-tab" data-scope="pa" role="tab">Panama</button>
                            <button class="scope-tab" data-scope="int" role="tab">International</button>
                        </div>
                        <div class="category-filter">
                            <span>Service</span>
                            <div class="category-tabs" role="tablist" aria-label="Service line">
                                <button class="category-tab is-active" data-category="all" role="tab">All</button>
                                <button class="category-tab" data-category="seo" role="tab">SEO</button>
                                <button class="category-tab" data-category="ppc" role="tab">PPC</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="scorecard-grid is-three">
                    <article class="stat-card">
                        <span class="stat-label">COGS</span>
                        <strong id="cogs-actual">—</strong>
                        <p class="stat-note"><span id="cogs-share">—</span> of total MRR</p>
                    </article>
                    <article class="stat-card">
                        <span class="stat-label">Target COGS</span>
                        <strong id="cogs-target">—</strong>
                        <p class="stat-note">Budgeted cost of delivery</p>
                    </article>
                    <article class="stat-card">
                        <span class="stat-label">Difference</span>
                        <strong id="cogs-difference">—</strong>
                        <p class="stat-note">Spending below budget is good here</p>
                    </article>
                </div>

                <div class="split-grid">
                    <article class="panel">
                        <div class="panel-header">
                            <div><p class="eyebrow">Margin</p><h3>Current against target</h3></div>
                            <span class="panel-meta" id="margin-gap-meta">—</span>
                        </div>
                        <div class="gauge-wrap" id="margin-gauge"></div>
                    </article>

                    <article class="panel bonus-panel">
                        <div class="panel-header">
                            <div><p class="eyebrow">Upside</p><h3>Potential bonus pool</h3></div>
                        </div>
                        <div class="bonus-body">
                            <strong id="bonus-pool">—</strong>
                            <p id="bonus-note">Released when margin clears the target for the period.</p>
                            <div class="bonus-meta">
                                <div><span>Margin gap</span><strong id="bonus-gap">—</strong></div>
                                <div><span>Status</span><strong id="bonus-status">—</strong></div>
                            </div>
                        </div>
                    </article>
                </div>

                <article class="panel table-panel entries-panel">
                    <div class="panel-header">
                        <div><p class="eyebrow">Manual input log</p><h3>Saved entries</h3></div>
                        <div class="entries-tools">
                            <span class="panel-meta" id="margin-entries-summary">0 entries</span>
                            <div class="category-tabs entries-tabs" role="tablist" aria-label="Entries shown">
                                <button class="entries-tab is-active" data-entries="all" role="tab">All entries</button>
                                <button class="entries-tab" data-entries="view" role="tab">Current view</button>
                            </div>
                        </div>
                    </div>
                    <div class="table-scroll">
                        <table class="entries-table">
                            <thead><tr><th>Month</th><th>Market</th><th>Service</th><th class="align-right">COGS</th><th class="align-right">Target COGS</th><th class="align-right">Margin</th><th class="align-right">Target margin</th><th class="align-right">Bonus pool</th><th>Last updated</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
                            <tbody id="margin-entries-table"></tbody>
                        </table>
                        <div class="table-empty is-hidden" id="margin-entries-empty"></div>
                    </div>
                </article>
            </section>
        </main>
    </div>

    <dialog class="modal" id="margin-modal" aria-labelledby="margin-modal-title">
        <form class="modal-form" id="margin-form" novalidate>
            <header class="modal-header">
                <div>
                    <p class="eyebrow">Manual input</p>
                    <h2 id="margin-modal-title">COGS and margin</h2>
                </div>
                <button type="button" class="modal-close" data-close-modal aria-label="Close">&times;</button>
            </header>
            <p class="modal-copy">Figures from the finance spreadsheet for one month, market and service line. Money in USD, margins in percent.</p>

            <fieldset class="form-group">
                <legend>Applies to</legend>
                <div class="form-grid is-three">
                    <label class="field"><span>Month</span><input type="month" name="month" id="margin-month" autofocus></label>
                    <label class="field"><span>Market</span>
                        <select name="scope">
                            <option value="all">Global</option>
                            <option value="br">Brazil</option>
                            <option value="mx">Mexico</option>
                            <option value="pa">Panama</option>
                            <option value="int">International</option>
                        </select>
                    </label>
                    <label class="field"><span>Service</span>
                        <select name="category">
                            <option value="all">All</option>
                            <option value="seo">SEO</option>
                            <option value="ppc">PPC</option>
                        </select>
                    </label>
                </div>
            </fieldset>

            <fieldset class="form-group">
                <legend>Cost of delivery</legend>
                <div class="form-grid">
                    <label class="field"><span>COGS</span><div class="input-affix"><i>$</i><input type="number" name="cogs" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div></label>
                    <label class="field"><span>Target COGS</span><div class="input-affix"><i>$</i><input type="number" name="cogsTarget" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div></label>
                </div>
            </fieldset>

            <fieldset class="form-group">
                <legend>Margin and bonus</legend>
                <div class="form-grid is-three">
                    <label class="field"><span>Current margin</span><div class="input-affix is-suffix"><input type="number" name="margin" min="-100" max="100" step="0.1" inputmode="decimal" placeholder="0.0"><i>%</i></div></label>
                    <label class="field"><span>Target margin</span><div class="input-affix is-suffix"><input type="number" name="marginTarget" min="0" max="100" step="0.1" inputmode="decimal" placeholder="0.0"><i>%</i></div></label>
                    <label class="field"><span>Bonus pool</span><div class="input-affix"><i>$</i><input type="number" name="bonusPool" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div></label>
                </div>
            </fieldset>

            <p class="form-error" id="margin-form-error" role="alert" hidden></p>

            <footer class="modal-footer">
                <div class="modal-actions">
                    <button type="button" class="button-secondary" data-close-modal>Cancel</button>
                    <button type="submit" class="button-primary" id="margin-form-submit">Save figures</button>
                </div>
            </footer>
        </form>
    </dialog>
    <dialog class="modal" id="rules-modal" aria-labelledby="rules-modal-title">
        <form class="modal-form" id="rules-form" novalidate>
            <header class="modal-header">
                <div>
                    <p class="eyebrow">Manual input</p>
                    <h2 id="rules-modal-title">Late charge rates</h2>
                </div>
                <button type="button" class="modal-close" data-close-modal aria-label="Close">&times;</button>
            </header>
            <p class="modal-copy">The late fee is charged once on the open balance. Interest is simple, per month, counted day by day from the due date. Nothing is charged during the grace period.</p>

            <fieldset class="form-group">
                <legend>Rates by market</legend>
                <div class="rules-row" data-rule="mx">
                    <span class="rules-market">Mexico</span>
                    <label class="field"><span>Late fee</span><div class="input-affix is-suffix"><input type="number" name="mx-lateFee" min="0" max="100" step="0.01" inputmode="decimal" placeholder="0"><i>%</i></div></label>
                    <label class="field"><span>Interest / month</span><div class="input-affix is-suffix"><input type="number" name="mx-monthlyInterest" min="0" max="100" step="0.01" inputmode="decimal" placeholder="0"><i>%</i></div></label>
                    <label class="field"><span>Grace period</span><div class="input-affix is-suffix"><input type="number" name="mx-graceDays" min="0" max="365" step="1" inputmode="numeric" placeholder="0"><i>days</i></div></label>
                </div>
                <div class="rules-row" data-rule="pa">
                    <span class="rules-market">Panama</span>
                    <label class="field"><span>Late fee</span><div class="input-affix is-suffix"><input type="number" name="pa-lateFee" min="0" max="100" step="0.01" inputmode="decimal" placeholder="0"><i>%</i></div></label>
                    <label class="field"><span>Interest / month</span><div class="input-affix is-suffix"><input type="number" name="pa-monthlyInterest" min="0" max="100" step="0.01" inputmode="decimal" placeholder="0"><i>%</i></div></label>
                    <label class="field"><span>Grace period</span><div class="input-affix is-suffix"><input type="number" name="pa-graceDays" min="0" max="365" step="1" inputmode="numeric" placeholder="0"><i>days</i></div></label>
                </div>
                <div class="rules-row" data-rule="int">
                    <span class="rules-market">International</span>
                    <label class="field"><span>Late fee</span><div class="input-affix is-suffix"><input type="number" name="int-lateFee" min="0" max="100" step="0.01" inputmode="decimal" placeholder="0"><i>%</i></div></label>
                    <label class="field"><span>Interest / month</span><div class="input-affix is-suffix"><input type="number" name="int-monthlyInterest" min="0" max="100" step="0.01" inputmode="decimal" placeholder="0"><i>%</i></div></label>
                    <label class="field"><span>Grace period</span><div class="input-affix is-suffix"><input type="number" name="int-graceDays" min="0" max="365" step="1" inputmode="numeric" placeholder="0"><i>days</i></div></label>
                </div>
                <div class="rules-row is-locked">
                    <span class="rules-market">Brazil</span>
                    <p class="rules-locked-copy">10% late fee + 1% interest a month, on the balance corrected by the higher of IGP-M and IPCA. Fixed by contract, not editable here.</p>
                </div>
            </fieldset>

            <p class="form-error" id="rules-form-error" role="alert" hidden></p>

            <footer class="modal-footer">
                <p class="modal-footnote" id="rules-form-meta"></p>
                <div class="modal-actions">
                    <button type="button" class="button-secondary" data-close-modal>Cancel</button>
                    <button type="submit" class="button-primary" id="rules-form-submit">Save rates</button>
                </div>
            </footer>
        </form>
    </dialog>
    <dialog class="modal" id="unit-modal" aria-labelledby="unit-modal-title">
        <form class="modal-form" id="unit-form" novalidate>
            <header class="modal-header">
                <div>
                    <p class="eyebrow">Manual input</p>
                    <h2 id="unit-modal-title">Acquisition costs and leads</h2>
                </div>
                <button type="button" class="modal-close" data-close-modal aria-label="Close">&times;</button>
            </header>
            <p class="modal-copy">Figures for one month, market and service line. Money in USD.</p>

            <fieldset class="form-group">
                <legend>Applies to</legend>
                <div class="form-grid is-three">
                    <label class="field"><span>Month</span><input type="month" name="month" id="unit-month" autofocus></label>
                    <label class="field"><span>Market</span>
                        <select name="scope">
                            <option value="all">Global</option>
                            <option value="br">Brazil</option>
                            <option value="mx">Mexico</option>
                            <option value="pa">Panama</option>
                            <option value="int">International</option>
                        </select>
                    </label>
                    <label class="field"><span>Service</span>
                        <select name="category">
                            <option value="all">All</option>
                            <option value="seo">SEO</option>
                            <option value="ppc">PPC</option>
                        </select>
                    </label>
                </div>
            </fieldset>

            <fieldset class="form-group">
                <legend>Acquisition (CAC)</legend>
                <div class="form-grid">
                    <label class="field"><span>Sales &amp; Marketing cost</span><div class="input-affix"><i>$</i><input type="number" name="salesMarketingCost" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div></label>
                    <label class="field"><span>New clients</span><input type="number" name="newClients" min="0" step="1" inputmode="numeric" placeholder="from invoices"></label>
                </div>
            </fieldset>

            <fieldset class="form-group">
                <legend>Demand generation (CPL)</legend>
                <div class="form-grid">
                    <label class="field"><span>Marketing cost</span><div class="input-affix"><i>$</i><input type="number" name="marketingCost" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div></label>
                    <label class="field"><span>Leads</span><input type="number" name="leads" min="0" step="1" inputmode="numeric" placeholder="0"></label>
                </div>
            </fieldset>

            <p class="form-error" id="unit-form-error" role="alert" hidden></p>

            <footer class="modal-footer">
                <div class="modal-actions">
                    <button type="button" class="button-secondary" data-close-modal>Cancel</button>
                    <button type="submit" class="button-primary" id="unit-form-submit">Save figures</button>
                </div>
            </footer>
        </form>
    </dialog>
    <dialog class="modal" id="targets-modal" aria-labelledby="targets-modal-title">
        <form class="modal-form" id="targets-form" novalidate>
            <header class="modal-header">
                <div>
                    <p class="eyebrow">Manual input</p>
                    <h2 id="targets-modal-title">Target MRR</h2>
                </div>
                <button type="button" class="modal-close" data-close-modal aria-label="Close">&times;</button>
            </header>
            <p class="modal-copy">Target MRR for one month, market and service line, in USD. Target New Business (MRR) is derived from it: Target MRR minus Total MRR.</p>

            <fieldset class="form-group">
                <legend>Applies to</legend>
                <div class="form-grid is-three">
                    <label class="field"><span>Month</span><input type="month" name="month" autofocus></label>
                    <label class="field"><span>Market</span>
                        <select name="scope">
                            <option value="all">Global</option>
                            <option value="br">Brazil</option>
                            <option value="mx">Mexico</option>
                            <option value="pa">Panama</option>
                            <option value="int">International</option>
                        </select>
                    </label>
                    <label class="field"><span>Service</span>
                        <select name="category">
                            <option value="all">All</option>
                            <option value="seo">SEO</option>
                            <option value="ppc">PPC</option>
                        </select>
                    </label>
                </div>
            </fieldset>

            <fieldset class="form-group">
                <legend>Target</legend>
                <div class="form-grid">
                    <label class="field"><span>Target MRR</span><div class="input-affix"><i>$</i><input type="number" name="totalMrrTarget" min="0" step="0.01" inputmode="decimal" required></div></label>
                </div>
            </fieldset>

            <p class="form-error" id="targets-form-error" role="alert" hidden></p>

            <footer class="modal-footer">
                <p class="modal-hint" id="targets-form-hint"></p>
                <div class="modal-actions">
                    <button type="button" class="button-secondary" data-close-modal>Cancel</button>
                    <button type="submit" class="button-primary" id="targets-form-submit">Save Target MRR</button>
                </div>
            </footer>
        </form>
    </dialog>
    <dialog class="modal" id="import-modal" aria-labelledby="import-modal-title">
        <form class="modal-form" id="import-form" novalidate>
            <header class="modal-header">
                <div>
                    <p class="eyebrow">Spreadsheet import</p>
                    <h2 id="import-modal-title">Import the targets sheet</h2>
                </div>
                <button type="button" class="modal-close" data-close-modal aria-label="Close">&times;</button>
            </header>
            <p class="modal-copy">Reads Target MRR, COGS, Target COGS, current margin and target margin from the country tabs (SEOBR, PPCMX…) and from Consolidated, which feeds the Global view. Nothing is saved until you confirm.</p>

            <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">

            <label class="import-drop" id="import-drop">
                <input type="file" name="sheet" id="import-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
                <strong id="import-drop-title">Choose the .xlsx file</strong>
                <span id="import-drop-note">or drop it here · Google Sheets: File › Download › Microsoft Excel</span>
            </label>

            <div class="import-preview" id="import-preview" hidden aria-live="polite"></div>

            <p class="form-error" id="import-form-error" role="alert" hidden></p>

            <footer class="modal-footer">
                <p class="modal-hint" id="import-form-hint">Saving replaces those months in Targets and Margin &amp; COGS. Bonus pool and anything the sheet leaves blank keep their saved values.</p>
                <div class="modal-actions">
                    <button type="button" class="button-secondary" data-close-modal>Cancel</button>
                    <button type="submit" class="button-primary" id="import-form-submit" disabled>Save to dashboard</button>
                </div>
            </footer>
        </form>
    </dialog>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
    <script src="<?= asset('assets/app.js') ?>"></script>
</body>
</html>