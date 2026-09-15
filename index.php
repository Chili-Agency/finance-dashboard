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
    <link rel="stylesheet" href="assets/styles.css?v=5">
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
                <button class="nav-item is-active" data-view="overview" data-title="Overview"><span class="nav-icon">◒</span>Overview</button>
                <button class="nav-item" data-view="mrr" data-title="MRR tracking"><span class="nav-icon">↗</span>MRR tracking</button>
                <button class="nav-item" data-view="retention" data-title="Retention"><span class="nav-icon">◐</span>Retention</button>
                <button class="nav-item" data-view="targets" data-title="Targets"><span class="nav-icon">◎</span>Targets</button>
                <button class="nav-item" data-view="margin" data-title="Margin &amp; COGS"><span class="nav-icon">◇</span>Margin &amp; COGS</button>
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

            <!-- ============================ RETENTION ============================ -->
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
                        <span class="stat-label">Upsells, cross-sells &amp; referrals</span>
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
            </section>

            <!-- ============================= TARGETS ============================= -->
            <section class="view" id="targets-view" aria-labelledby="page-title">
                <div class="section-intro">
                    <div>
                        <p class="eyebrow">Growth</p>
                        <h2>New business and total MRR</h2>
                        <p class="section-copy">Actuals against plan for the selected period, plus the gap carried from earlier months.</p>
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
                            <div><p class="eyebrow">Acquisition</p><h3>New business (MRR)</h3></div>
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
                        <span class="stat-label">Total difference</span>
                        <strong id="mrr-difference">—</strong>
                        <p class="stat-note">Total MRR minus target, this period</p>
                    </article>
                    <article class="stat-card">
                        <span class="stat-label">To target</span>
                        <strong id="mrr-to-target">—</strong>
                        <p class="stat-note">Still missing to close the period</p>
                    </article>
                    <article class="stat-card">
                        <span class="stat-label">Accumulated gap / excess</span>
                        <strong id="mrr-accumulated">—</strong>
                        <p class="stat-note">Carried from the start of the year</p>
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
            </section>

            <!-- ========================== MARGIN & COGS ========================== -->
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
            </section>
        </main>
    </div>

    <!-- ===================== MANUAL INPUT: COGS & MARGIN ===================== -->
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
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
    <script src="assets/app.js?v=12"></script>
</body>
</html>