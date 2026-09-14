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
    <link rel="stylesheet" href="assets/styles.css">
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
                <button class="nav-item is-active" data-view="overview"><span class="nav-icon">◒</span>Overview</button>
                <button class="nav-item" data-view="mrr"><span class="nav-icon">↗</span>MRR tracking</button>
            </nav>
            <div class="sidebar-bottom">
                <div class="sync-card">
                    <span class="sync-dot"></span>
                    <div><strong id="sync-status">Connecting</strong><small id="sync-time">Waiting for data</small></div>
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
                    <div><p class="eyebrow">Invoice pulse</p><h2>What is happening now?</h2></div>
                    <div class="scope-tabs" role="tablist" aria-label="Company scope">
                        <button class="scope-tab is-active" data-scope="all" role="tab">Global</button>
                        <button class="scope-tab" data-scope="br" role="tab">Brazil</button>
                        <button class="scope-tab" data-scope="mx" role="tab">Mexico</button>
                        <button class="scope-tab" data-scope="pa" role="tab">Panama</button>
                        <button class="scope-tab" data-scope="int" role="tab">International</button>
                    </div>
                </div>

                <div class="metric-grid">
                    <article class="metric-card metric-paid"><div class="metric-heading"><span class="metric-label">Paid invoices</span><span class="metric-badge">01</span></div><strong id="paid-total">$0</strong><p><span id="paid-count">0 invoices</span> collected in period</p></article>
                    <article class="metric-card metric-late"><div class="metric-heading"><span class="metric-label">Late invoices</span><span class="metric-badge">02</span></div><strong id="late-total">$0</strong><p><span id="late-count">0 invoices</span> past their due date</p></article>
                    <article class="metric-card metric-open"><div class="metric-heading"><span class="metric-label">Open invoices</span><span class="metric-badge">03</span></div><strong id="open-total">$0</strong><p><span id="open-count">0 invoices</span> still outstanding</p></article>
                </div>

                <div class="dashboard-grid">
                    <article class="panel chart-panel"><div class="panel-header"><div><p class="eyebrow">Distribution</p><h3>Invoice status</h3></div><span class="panel-meta" id="invoice-count">0 invoices</span></div><div class="chart-wrap"><canvas id="status-chart"></canvas><div class="chart-empty" id="chart-empty">No invoices in this period</div></div><div class="legend" id="chart-legend"></div></article>
                    <article class="panel market-panel"><div class="panel-header"><div><p class="eyebrow">Portfolio</p><h3>By market</h3></div><span class="panel-meta">USD view</span></div><div class="market-list" id="market-list"></div><div class="rate-note">Rates pulled live from <strong>Open Exchange Rates</strong> at fetch time.</div></article>
                </div>

                <article class="panel table-panel"><div class="panel-header"><div><p class="eyebrow">Ledger</p><h3>Client invoices</h3></div><span class="panel-meta" id="table-summary">0 records</span></div><div class="table-scroll"><table><thead><tr><th>Client / invoice</th><th>Market</th><th>Issued</th><th>Due</th><th>Status</th><th class="align-right">Amount (USD)</th></tr></thead><tbody id="invoice-table"></tbody></table><div class="table-empty is-hidden" id="table-empty">No client invoices match this period.</div></div></article>
            </section>

            <section class="view" id="mrr-view" aria-labelledby="page-title"><div class="section-intro mrr-intro"><div><p class="eyebrow">Revenue intelligence</p><h2>Monthly recurring revenue</h2><p class="section-copy">Issued client invoices, normalized to USD. Use the period selector to compare months.</p></div><div class="mrr-callout"><span>Selected period</span><strong id="mrr-total">$0</strong><small id="mrr-label">Current month</small></div></div><article class="panel mrr-panel"><div class="panel-header"><div><p class="eyebrow">Trend</p><h3>Revenue by month</h3></div><span class="panel-meta">Issued invoices</span></div><div class="mrr-chart-wrap"><canvas id="mrr-chart"></canvas><div class="chart-empty" id="mrr-empty">No revenue data available</div></div></article><div class="mrr-breakdown" id="mrr-breakdown"></div></section>
        </main>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
    <script src="assets/app.js?v=6"></script>
</body>
</html>