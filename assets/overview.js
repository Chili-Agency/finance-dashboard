state.summaryPlanChart = null;
state.summaryBridgeChart = null;

const SUMMARY_ROWS = [
    { key: 'actual', label: 'MRR actual', format: moneyOr },
    { key: 'target', label: 'MRR target', format: moneyOr },
    { key: 'attainment', label: 'Attainment', format: (value) => percentOr(value, 0), tone: 'ratio' },
    { key: 'newSales', label: 'New sales', format: moneyOr, hint: 'Won deals of new business by monthly recurring revenue (HubSpot), in USD' },
    { key: 'newSalesTarget', label: 'New sales target', format: moneyOr, hint: 'Sales target set in Sales > Set sales target (company target, or the sum of the salespeople)' },
    { key: 'newSalesMissing', label: 'Missing from target', format: (value) => percentOr(value, 0), tone: 'missing', hint: 'Share of the new sales target still to close (0% once reached)' },
    { key: 'retention', label: 'Retention', format: percentOr, tone: 'retention' },
    { key: 'retentionTarget', label: 'Retention target', format: percentOr },
    { key: 'clients', label: 'Active clients', format: (value) => (hasValue(value) ? number(value) : DASH) },
    { key: 'cogs', label: 'COGS', format: moneyOr, tone: 'cogs' },
    { key: 'cogsTarget', label: 'COGS budget', format: moneyOr },
    { key: 'margin', label: 'Margin', format: percentOr, tone: 'margin' },
    { key: 'marginTarget', label: 'Margin target', format: percentOr },
    { key: 'bonusPool', label: 'Bonus provisioned', format: moneyOr },
];

function summaryYear() {
    const { end } = periodBounds();
    if (end) return end.getFullYear();
    const years = state.invoices.filter(isBillable).map((invoice) => invoiceDate(invoice)).filter(Boolean).map((date) => date.getFullYear());
    return years.length ? Math.max(...years) : new Date().getFullYear();
}

function summaryData() {
    if (!state.monthlyRows) state.monthlyRows = buildMonthlyRows();
    const year = summaryYear();
    const invoices = scopedInvoices();
    const manual = USE_DEMO_TARGETS ? DEMO_MANUAL_INPUTS : MANUAL_INPUTS;
    const pick = (name, month) => (state.monthlyRows[name] || [])
        .find((row) => row.month === month && row.scope === state.scope && row.category === state.category) || null;

    const monthKeys = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
    // Vendas novas do HubSpot (Sales page); null enquanto os dados não chegam ou fora do período que o HubSpot cobre.
    const newSalesByMonth = typeof overviewNewSales === 'function' ? overviewNewSales(monthKeys) : null;
    const months = monthKeys.map((month, monthIndex) => {
        const targets = pick('targets', month);
        const newSales = newSalesByMonth ? newSalesByMonth[monthIndex] : null;
        const newSalesTarget = typeof overviewSalesTarget === 'function' ? overviewSalesTarget(month) : null;
        const retention = pick('retention', month);
        const mrr = pick('mrr', month);
        const margin = marginEntryFor(month, invoices);
        return {
            month,
            label: new Intl.DateTimeFormat('en-US', { month: 'short' }).format(monthFromKey(month)),
            actual: targets ? targets.actual : null,
            target: targets ? targets.target : null,
            attainment: targets ? share(targets.actual, targets.target) : null,
            newBusiness: targets ? targets.newBusiness : null,
            newSales,
            newSalesTarget,
            newSalesMissing: hasValue(newSales) && hasValue(newSalesTarget) && Number(newSalesTarget) > 0 ? Math.max(0, 1 - Number(newSales) / Number(newSalesTarget)) : null,
            retention: retention ? retention.rate : null,
            retentionTarget: retention ? retention.target : manual.retentionTarget,
            churned: retention ? retention.churned : null,
            upsells: retention ? retention.upsells : null,
            initial: retention ? retention.initial : null,
            clients: mrr ? mrr.clients : null,
            cogs: margin ? margin.cogs : null,
            cogsTarget: margin ? margin.cogsTarget : null,
            margin: margin ? margin.margin : null,
            marginTarget: margin ? margin.marginTarget : null,
            bonusPool: margin ? margin.bonusPool : null,
        };
    });

    let lastIndex = -1;
    months.forEach((entry, index) => { if (hasValue(entry.actual) && entry.actual > 0) lastIndex = index; });
    const elapsed = lastIndex >= 0 ? months.slice(0, lastIndex + 1) : [];
    const totalOf = (field) => {
        const rows = elapsed.filter((entry) => hasValue(entry[field]));
        return rows.length ? rows.reduce((total, entry) => total + Number(entry[field]), 0) : null;
    };

    const latest = lastIndex >= 0 ? months[lastIndex] : null;
    const firstWithClients = elapsed.find((entry) => hasValue(entry.clients)) || null;
    const revenue = totalOf('actual');
    const cogs = totalOf('cogs');

    const costed = elapsed.filter((entry) => hasValue(entry.cogs));
    const sumOver = (rows, field) => {
        const filled = rows.filter((entry) => hasValue(entry[field]));
        return filled.length ? filled.reduce((total, entry) => total + Number(entry[field]), 0) : null;
    };
    const costedRevenue = sumOver(costed, 'actual');
    const latestMargin = [...elapsed].reverse().find((entry) => hasValue(entry.margin)) || null;
    const lastCosted = costed.length ? costed[costed.length - 1] : null;

    return {
        year,
        months,
        elapsed,
        latest,
        latestMargin,
        lastCosted,
        firstWithClients,
        totals: {
            revenue,
            target: totalOf('target'),
            newBusiness: totalOf('newBusiness'),
            churned: totalOf('churned'),
            upsells: totalOf('upsells'),
            cogs,
            cogsTarget: sumOver(costed, 'cogsTarget'),
            bonusPool: totalOf('bonusPool'),
            margin: hasValue(costedRevenue) && hasValue(cogs) && costedRevenue !== 0 ? (costedRevenue - cogs) / costedRevenue : null,
        },
    };
}

function summaryCard(key, { value, ratio, note, foot, invert = false }) {
    setText(`#sum-${key}-value`, value);
    setText(`#sum-${key}-note`, note);
    setText(`#sum-${key}-foot`, foot);
    const bar = $(`#sum-${key}-bar`);
    const card = $(`#sum-${key}-card`);
    if (!bar || !card) return;
    bar.style.width = `${hasValue(ratio) ? clampPercent(Number(ratio) * 100) : 0}%`;
    const good = hasValue(ratio) ? (invert ? Number(ratio) <= 1 : Number(ratio) >= 1) : null;
    card.dataset.state = good === null ? 'empty' : good ? 'good' : 'behind';
}

function renderOverview() {
    if (!$('#overview-view')) return;
    const data = summaryData();
    const { totals, latest } = data;
    const monthOf = (entry) => (entry ? monthLabel(monthFromKey(entry.month)) : DASH);

    setText('#summary-scope-note', `${companyLabels[state.scope] || 'All markets'} · ${state.category === 'all' ? 'all services' : categoryLabels[state.category]} · ${data.year}`);
    setText('#summary-matrix-title', `${data.year}${latest ? `, through ${monthOf(latest)}` : ''}`);

    summaryCard('revenue', {
        value: percentOr(share(totals.revenue, totals.target), 0),
        ratio: share(totals.revenue, totals.target),
        note: `${moneyOr(totals.revenue)} of ${moneyOr(totals.target)} in the year`,
        foot: latest ? `${percentOr(latest.attainment, 0)} in ${monthOf(latest)} · accumulated gap ${signedMoney(hasValue(totals.revenue) && hasValue(totals.target) ? totals.revenue - totals.target : null)}` : 'No revenue yet',
    });
    summaryCard('retention', {
        value: percentOr(latest ? latest.retention : null, 0),
        ratio: latest ? share(latest.retention, latest.retentionTarget) : null,
        note: latest ? `${percentOr(latest.retention)} in ${monthOf(latest)} against a ${percentOr(latest.retentionTarget, 0)} target` : 'No retention data yet',
        foot: latest && hasValue(latest.clients)
            ? `${plural(latest.clients, 'client')} active${data.firstWithClients && data.firstWithClients !== latest ? `, from ${number(data.firstWithClients.clients)} in ${monthOf(data.firstWithClients)}` : ''}`
            : DASH,
    });
    const marginMonth = data.latestMargin;
    const pending = marginMonth && latest && marginMonth !== latest ? ` · ${monthOf(latest)} has no COGS yet` : '';
    summaryCard('margin', {
        value: percentOr(marginMonth ? marginMonth.margin : null, 0),
        ratio: marginMonth ? share(marginMonth.margin, marginMonth.marginTarget) : null,
        note: marginMonth ? `${percentOr(marginMonth.margin)} in ${monthOf(marginMonth)} against a ${percentOr(marginMonth.marginTarget)} target` : 'No margin entered yet',
        foot: hasValue(totals.margin) ? `${percentOr(totals.margin)} accumulated through ${monthOf(data.lastCosted)}${pending}` : 'Enter COGS in Margin & COGS',
    });
    const cogsRatio = share(totals.cogs, totals.cogsTarget);
    summaryCard('cogs', {
        value: hasValue(cogsRatio) ? percentOr(1 - cogsRatio, 0) : DASH,
        ratio: cogsRatio,
        invert: true,
        note: `${moneyOr(totals.cogs)} spent of ${moneyOr(totals.cogsTarget)} budgeted`,
        foot: hasValue(totals.cogs) && hasValue(totals.cogsTarget)
            ? `${signedMoney(totals.cogsTarget - totals.cogs)} against budget through ${monthOf(data.lastCosted)}`
            : 'No COGS budget entered yet',
    });

    renderImportStatus();
    renderSummaryMatrix(data);
    const period = summaryPeriod();
    renderSummaryHealth(period);
    renderSummaryPlanChart(data);
    renderSummaryBridgeChart(period);
}

function renderSummaryMatrix(data) {
    $('#summary-matrix-head').innerHTML = `<th>Indicator</th>${data.months.map((entry) => `<th class="align-right">${escapeHtml(entry.label)}</th>`).join('')}`;
    $('#summary-matrix').innerHTML = SUMMARY_ROWS.map((row) => {
        const cells = data.months.map((entry) => {
            const value = entry[row.key];
            return `<td class="align-right mono ${summaryTone(row, entry)}">${row.format(value)}</td>`;
        }).join('');
        return `<tr><th scope="row"${row.hint ? ` title="${escapeHtml(row.hint)}"` : ''}>${escapeHtml(row.label)}</th>${cells}</tr>`;
    }).join('');

    const note = $('#summary-matrix-note');
    if (!note) return;
    const missing = [];
    if (!data.elapsed.some((entry) => hasValue(entry.target))) missing.push('Target MRR');
    if (!data.elapsed.some((entry) => hasValue(entry.cogs))) missing.push('COGS');
    note.textContent = data.elapsed.length === 0
        ? `No billable invoices in ${data.year} for this market and service.`
        : missing.length
            ? `${missing.join(' and ')} not entered for this view yet — import the targets sheet above, or enter them in Targets and Margin & COGS.`
            : `Manual figures come from Targets and Margin & COGS; the rest is calculated from invoices.`;
    note.dataset.tone = missing.length ? 'sample' : 'muted';

    // As linhas de vendas novas vêm da página Sales (HubSpot + metas de vendas).
    if (typeof overviewNewSales === 'function' && data.elapsed.length > 0) {
        const hubspot = state.sales && state.sales.status;
        if (hubspot === 'off') note.textContent += ' New sales needs the HubSpot connection (see Sales).';
        else if (hubspot === 'error' && !state.sales.data) note.textContent += ' New sales could not be loaded from HubSpot.';
        else if (hubspot === 'loading' && !state.sales.data) note.textContent += ' New sales is loading from HubSpot…';
        else if (!data.months.some((entry) => hasValue(entry.newSalesTarget))) note.textContent += ' New sales target: set it in Sales > Set sales target.';
    }
}

// Refaz só a matriz, quando os dados de vendas chegam depois da primeira renderização do Overview.
function refreshSummaryMatrix() {
    if (!$('#summary-matrix') || !state.monthlyRows) return;
    renderSummaryMatrix(summaryData());
}

function summaryTone(row, entry) {
    if (!row.tone) return '';
    if (row.tone === 'missing') {
        // Nada faltando (0%) é verde; qualquer fatia faltando é vermelho.
        return hasValue(entry.newSalesMissing) ? (Number(entry.newSalesMissing) === 0 ? 'cell-up' : 'cell-down') : '';
    }
    const pairs = { ratio: [entry.attainment, 1], retention: [entry.retention, entry.retentionTarget], margin: [entry.margin, entry.marginTarget], cogs: [entry.cogsTarget, entry.cogs] };
    const [value, reference] = pairs[row.tone] || [];
    if (!hasValue(value) || !hasValue(reference)) return '';
    return Number(value) >= Number(reference) ? 'cell-up' : 'cell-down';
}

function summaryRow(name, month) {
    if (!month) return null;
    if (!state.monthlyRows) state.monthlyRows = buildMonthlyRows();
    return (state.monthlyRows[name] || [])
        .find((row) => row.month === month && row.scope === state.scope && row.category === state.category) || null;
}

function summaryPeriodMonths() {
    if (!state.monthlyRows) state.monthlyRows = buildMonthlyRows();
    const available = [...new Set((state.monthlyRows.mrr || [])
        .filter((row) => row.scope === state.scope && row.category === state.category)
        .map((row) => row.month))].sort();
    if (!available.length) return [];
    const { start, end } = periodBounds();
    const last = available[available.length - 1];
    const from = start ? monthKey(start) : available[0];
    let to = end ? monthKey(end) : last;
    if (to > last) to = last;
    if (from > to) return [];
    return monthKeysBetween(monthFromKey(from), monthFromKey(to));
}

function summaryPeriodLabel(months) {
    if (!months.length) return periodBounds().label;
    const first = monthFromKey(months[0]);
    const last = monthFromKey(months[months.length - 1]);
    if (months.length === 1) return monthLabel(first);
    const firstText = first.getFullYear() === last.getFullYear()
        ? new Intl.DateTimeFormat('en-US', { month: 'short' }).format(first)
        : monthLabel(first);
    return `${firstText} – ${monthLabel(last)}`;
}

function summaryPeriod() {
    const months = summaryPeriodMonths();
    const label = summaryPeriodLabel(months);
    if (!months.length) return { months, label, hasData: false };

    const first = monthFromKey(months[0]);
    const baseMonth = monthKey(new Date(first.getFullYear(), first.getMonth() - 1, 1));
    const endMonth = months[months.length - 1];
    const baseRow = summaryRow('mrr', baseMonth);
    const endRow = summaryRow('mrr', endMonth);

    const sumOf = (name, field) => {
        const values = months.map((month) => summaryRow(name, month)).filter((row) => row && hasValue(row[field]));
        return values.length ? values.reduce((total, row) => total + Number(row[field]), 0) : null;
    };

    const invoices = scopedInvoices();
    const bonusEntries = months.map((month) => marginEntryFor(month, invoices)).filter((entry) => entry && hasValue(entry.bonusPool));

    const base = baseRow ? baseRow.mrr : 0;
    const end = endRow ? endRow.mrr : 0;
    const firstMonths = sumOf('mrr', 'newBusiness');
    const setup = sumOf('retention', 'setupChange');
    const flows = {
        newBusiness: hasValue(firstMonths) || hasValue(setup) ? (firstMonths || 0) + (setup || 0) : null,
        upsells: sumOf('retention', 'upsells'),
        reactivated: sumOf('retention', 'reactivated'),
        churned: sumOf('retention', 'churned'),
        onboarding: sumOf('retention', 'onboardingChange'),
    };
    const explained = base
        + (flows.newBusiness || 0)
        + (flows.upsells || 0)
        + (flows.reactivated || 0)
        - (flows.churned || 0)
        + (flows.onboarding || 0);
    const other = Math.abs(end - explained) >= 1 ? end - explained : 0;
    const hasData = months.some((month) => summaryRow('mrr', month) || summaryRow('retention', month)) || Boolean(baseRow);

    return {
        months,
        label,
        hasData,
        baseMonth,
        endMonth,
        base,
        end,
        baseClients: baseRow ? baseRow.clients : null,
        endClients: endRow ? endRow.clients : null,
        ...flows,
        other,
        net: end - base,
        bonusPool: bonusEntries.length ? bonusEntries.reduce((total, entry) => total + Number(entry.bonusPool), 0) : null,
        bonusMonths: bonusEntries.length,
    };
}

function renderSummaryHealth(period) {
    setText('#summary-health-title', `Health · ${period.label}`);
    const tone = (value) => (!hasValue(value) || Number(value) === 0 ? '' : Number(value) > 0 ? 'up' : 'down');
    const flow = (value) => (hasValue(value) ? signedMoney(value) : DASH);
    const rows = period.hasData ? [
        {
            label: 'Active clients',
            value: hasValue(period.endClients) ? number(period.endClients) : DASH,
            sub: [
                period.months.length > 1 ? `in ${monthLabel(monthFromKey(period.endMonth))}` : '',
                hasValue(period.baseClients) ? `from ${number(period.baseClients)} in ${monthLabel(monthFromKey(period.baseMonth))}` : '',
            ].filter(Boolean).join(', '),
        },
        { label: 'Churn', value: flow(hasValue(period.churned) ? -period.churned : null), tone: tone(hasValue(period.churned) ? -period.churned : null) },
        { label: 'New business', value: flow(period.newBusiness), tone: tone(period.newBusiness) },
        { label: 'Upsells', value: flow(period.upsells), tone: tone(period.upsells) },
        ...(period.reactivated > 0 ? [{ label: 'Reactivated', sub: 'clients back after a gap', value: flow(period.reactivated), tone: 'up' }] : []),
        ...(Math.abs(Number(period.onboarding) || 0) >= 1 ? [{ label: 'Onboarding fees', sub: 'started or ended on existing clients, not churn', value: flow(period.onboarding), tone: tone(period.onboarding) }] : []),
        ...(period.other ? [{ label: 'Other changes', sub: 'not tied to a service line', value: flow(period.other), tone: tone(period.other) }] : []),
        { label: 'Net change', sub: `recurring base vs ${monthLabel(monthFromKey(period.baseMonth))}`, value: signedMoney(period.net), tone: tone(period.net) },
    ] : [{ label: 'No billable invoices in this period', value: DASH }];

    $('#summary-health').innerHTML = rows.map((row) => `<div class="health-row">
        <span class="health-label">${escapeHtml(row.label)}${row.sub ? `<small>${escapeHtml(row.sub)}</small>` : ''}</span>
        <span class="health-value ${row.tone ? `value-${row.tone}` : ''}">${row.value}</span>
    </div>`).join('');

    const note = $('#summary-bonus-note');
    if (!note) return;
    note.textContent = hasValue(period.bonusPool)
        ? `Bonus provisioned in ${period.label}: ${money(period.bonusPool)} — entered for ${plural(period.bonusMonths, 'month')}.`
        : `No bonus pool entered for ${period.label} in this view.`;
}

function renderSummaryPlanChart(data) {
    const canvas = $('#summary-plan-chart');
    const empty = $('#summary-plan-empty');
    if (!canvas || typeof Chart === 'undefined') return;
    const hasData = data.elapsed.length > 0;
    empty.classList.toggle('is-hidden', hasData);
    canvas.classList.toggle('is-hidden', !hasData);
    if (state.summaryPlanChart) { state.summaryPlanChart.destroy(); state.summaryPlanChart = null; }
    if (!hasData) return;

    state.summaryPlanChart = new Chart(canvas, {
        data: {
            labels: data.months.map((entry) => entry.label),
            datasets: [
                { type: 'bar', label: 'Actual', data: data.months.map((entry) => (hasValue(entry.actual) && entry.actual > 0 ? entry.actual : null)), backgroundColor: colors.authorised, borderWidth: 0, maxBarThickness: 28, order: 1 },
                { type: 'line', label: 'Target', data: data.months.map((entry) => (hasValue(entry.target) ? entry.target : null)), borderColor: '#4a544d', borderWidth: 1.5, borderDash: [5, 4], pointRadius: 2, pointBackgroundColor: '#4a544d', spanGaps: true, tension: 0, order: 0 },
            ],
        },
        options: summaryChartOptions(),
    });
}

function renderSummaryBridgeChart(period) {
    const root = $('#summary-bridge');
    const empty = $('#summary-bridge-empty');
    setText('#summary-bridge-title', `Recurring base bridge · ${period.label}`);
    setText('#summary-bridge-copy', period.hasData
        ? `From the ${monthLabel(monthFromKey(period.baseMonth))} portfolio to ${monthLabel(monthFromKey(period.endMonth))}: what came into and left the recurring base.`
        : 'What came into and left the recurring base in the selected period.');
    if (!root) return;
    if (empty) empty.classList.toggle('is-hidden', period.hasData);
    root.hidden = !period.hasData;
    if (!period.hasData) { root.innerHTML = ''; return; }

    const short = (month) => monthLabel(monthFromKey(month));
    const base = Number(period.base) || 0;
    const end = Number(period.end) || 0;
    const net = end - base;
    const netRate = base ? net / base : null;
    const optional = (value) => (Math.abs(Number(value) || 0) >= 1 ? Number(value) : null);
    const flows = [
        { label: 'New business', hint: 'New clients, including their setup months', value: Number(period.newBusiness) || 0 },
        { label: 'Upsells', hint: 'Existing clients billing more', value: Number(period.upsells) || 0 },
        { label: 'Reactivated', hint: 'Clients back after a gap', value: optional(period.reactivated) },
        { label: 'Churn', hint: 'Lost clients and downgrades', value: hasValue(period.churned) ? -Number(period.churned) : 0 },
        { label: 'Onboarding fees', hint: 'One-off fees starting or ending', value: optional(period.onboarding), adjust: true },
        { label: 'Other changes', hint: 'Not tied to a service line', value: optional(period.other), adjust: true },
    ].filter((flow) => flow.value !== null);
    const scale = Math.max(...flows.map((flow) => Math.abs(flow.value)), 1);
    const tone = (value) => (value > 0.5 ? 'is-up' : value < -0.5 ? 'is-down' : 'is-flat');

    const rows = flows.map((flow) => {
        const width = Math.abs(flow.value) >= 0.5 ? Math.max((Math.abs(flow.value) / scale) * 50, 0.6) : 0;
        return `<li class="bridge-row ${tone(flow.value)}${flow.adjust ? ' is-adjust' : ''}">
            <span class="bridge-label">${escapeHtml(flow.label)}<small>${escapeHtml(flow.hint)}</small></span>
            <span class="bridge-track" aria-hidden="true">${width ? `<span class="bridge-bar" style="width:${width.toFixed(2)}%"></span>` : ''}</span>
            <span class="bridge-value">${signedMoney(flow.value)}</span>
        </li>`;
    }).join('');

    root.innerHTML = `
        <div class="bridge-ends">
            <div class="bridge-end"><span>${escapeHtml(short(period.baseMonth))} base</span><strong>${money(base)}</strong></div>
            <div class="bridge-link" aria-hidden="true"></div>
            <div class="bridge-net ${tone(net)}"><span>Net change</span><strong>${signedMoney(net)}</strong><small>${hasValue(netRate) ? `${netRate > 0 ? '+' : netRate < 0 ? '−' : ''}${Math.abs(netRate * 100).toFixed(1)}%` : DASH}</small></div>
            <div class="bridge-link is-to" aria-hidden="true"></div>
            <div class="bridge-end is-end"><span>${escapeHtml(short(period.endMonth))} base</span><strong>${money(end)}</strong></div>
        </div>
        <div class="bridge-axis" aria-hidden="true"><span></span><span class="bridge-axis-labels"><em>Left the base</em><em>Came in</em></span><span></span></div>
        <ul class="bridge-rows">${rows}</ul>`;
}

const IMPORT_ENDPOINT = 'sheet-import.php';
const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const IMPORT_COLUMNS = [
    ['totalMrrTarget', 'Target MRR'],
    ['cogs', 'COGS'],
    ['cogsTarget', 'Target COGS'],
    ['margin', 'Margin'],
    ['marginTarget', 'Target margin'],
    ['newSalesTarget', 'Target new business'],
];
const IMPORT_DROP_NOTE = 'or drop it here · Google Sheets: File › Download › Microsoft Excel';
const importModal = $('#import-modal');
const importForm = $('#import-form');

state.importFile = null;
state.importPreview = null;
state.importToken = null;
state.importBusy = false;
state.importResult = null;

const importMonth = (key) => (key ? monthLabel(monthFromKey(key)) : DASH);
const importSpan = (from, to) => (!from ? DASH : from === to ? importMonth(from) : `${importMonth(from)} – ${importMonth(to)}`);
const importFileSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

async function importRequest(options = {}) {
    const response = redirectIfSignedOut(await fetch(IMPORT_ENDPOINT, { cache: 'no-store', ...options }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `The server answered HTTP ${response.status}.`);
    return body;
}

function renderImportStatus() {
    const node = $('#import-status');
    if (!node) return;
    if (state.marginInputsStatus === 'loading' || state.targetInputsStatus === 'loading') { node.textContent = ''; node.dataset.tone = 'muted'; return; }
    const result = state.importResult;
    if (result) {
        node.textContent = `Imported ${plural(result.figures, 'figure')} from ${result.fileName} for ${importSpan(result.from, result.to)}. They now show here, in Targets, in Margin & COGS and in Sales.`;
        node.dataset.tone = 'manual';
        return;
    }
    const entries = [...Object.values(state.marginInputs || {}), ...Object.values(state.targetInputs || {})];
    const latest = entries.map((entry) => entry.enteredAt).filter(Boolean).sort().pop();
    if (!latest) {
        node.textContent = 'Fills Target MRR, COGS, margins and the new business target for every market from the finance spreadsheet.';
        node.dataset.tone = 'muted';
        return;
    }
    const months = entries.map((entry) => entry.month).filter(Boolean).sort();
    node.textContent = `Saved figures cover ${importSpan(months[0], months[months.length - 1])}, last updated ${formatEnteredAt(latest)}. Import the sheet again to refresh them.`;
    node.dataset.tone = 'muted';
}

function showImportError(message) {
    const node = $('#import-form-error');
    node.hidden = !message;
    node.textContent = message || '';
}

function setImportDrop(stateName, title, note) {
    $('#import-drop').dataset.state = stateName;
    setText('#import-drop-title', title);
    setText('#import-drop-note', note);
}

function setImportSubmit(label, disabled) {
    const submit = $('#import-form-submit');
    submit.textContent = label;
    submit.disabled = disabled;
}

function resetImport() {
    state.importFile = null;
    state.importPreview = null;
    state.importToken = null;
    importForm.reset();
    $('#import-preview').hidden = true;
    $('#import-preview').innerHTML = '';
    setImportDrop('empty', 'Choose the .xlsx file', IMPORT_DROP_NOTE);
    setImportSubmit('Save to dashboard', true);
    showImportError('');
}

function openImportModal() {
    if (!CAN_MANUAL_INPUTS) return;
    resetImport();
    importModal.showModal();
}

function closeImportModal() {
    if (state.importBusy) return;
    importModal.close();
    $('#open-import-modal').focus();
}

function importUploadBody(mode) {
    const body = new FormData();
    body.append('csrf', importForm.elements.csrf.value);
    body.append('mode', mode);
    body.append('sheet', state.importFile, state.importFile.name);
    return body;
}

async function previewImport(file) {
    showImportError('');
    state.importPreview = null;
    state.importFile = null;
    $('#import-preview').hidden = true;
    setImportSubmit('Save to dashboard', true);
    if (!file) return;

    if (!/\.xlsx$/i.test(file.name)) {
        setImportDrop('error', file.name, 'Choose another file');
        showImportError('Upload the workbook as .xlsx. In Google Sheets: File › Download › Microsoft Excel (.xlsx).');
        return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
        setImportDrop('error', file.name, 'Choose another file');
        showImportError('The file is larger than 10 MB.');
        return;
    }

    state.importFile = file;
    const token = {};
    state.importToken = token;
    setImportDrop('loading', file.name, 'Reading the tabs…');
    try {
        const preview = await importRequest({ method: 'POST', body: importUploadBody('preview') });
        if (state.importToken !== token) return;
        state.importPreview = preview;
        setImportDrop('ready', file.name, `${importFileSize(file.size)} · choose another file to replace it`);
        renderImportPreview(preview);
        setImportSubmit(preview.figures ? `Save ${plural(preview.figures, 'figure')}` : 'Nothing to save', !preview.figures);
    } catch (error) {
        if (state.importToken !== token) return;
        state.importFile = null;
        setImportDrop('error', file.name, 'Choose another file');
        showImportError(error.message || 'Could not read the spreadsheet.');
    }
}

function importValue(item) {
    if (typeof item.value !== 'number') return String(item.value);
    return item.kind === 'fraction' ? percentOr(item.value) : moneyExact(item.value);
}

function renderImportPreview(preview) {
    const node = $('#import-preview');
    const count = (value) => (value ? `<td class="align-right mono">${number(value)}</td>` : `<td class="align-right mono is-empty">${DASH}</td>`);
    const rows = preview.tabs.map((tab) => `
        <tr>
            <td>${escapeHtml(tab.sheet)}${tab.missingRows.length ? `<span class="entry-sub">No row for ${escapeHtml(tab.missingRows.join(', '))}</span>` : ''}</td>
            <td>${escapeHtml(companyLabels[tab.scope] || 'Global')}<span class="entry-sub">${escapeHtml(serviceName(tab.category))}</span></td>
            <td class="mono">${escapeHtml(importSpan(tab.from, tab.to))}</td>
            ${IMPORT_COLUMNS.map(([field]) => count(tab.counts[field])).join('')}
        </tr>`).join('');

    const notes = [];
    if (preview.uncached) {
        notes.push(`<p class="import-note is-warning">This file has formulas saved without their calculated values, so some figures are missing below. That happens when a tool re-saves the workbook without recalculating it. Download it again from Google Sheets (File › Download › Microsoft Excel) or open and save it in Excel.</p>`);
    }
    if (preview.leftOut) {
        notes.push(`<p class="import-note">${plural(preview.leftOut, 'current margin')} left out: those months have no COGS in the sheet yet, so the margin there is a projection.</p>`);
    }
    if (preview.skipped.length) {
        const items = preview.skipped.map((item) => `<li><strong>${escapeHtml(item.sheet)}</strong>, ${escapeHtml(importMonth(item.month))}: ${escapeHtml(item.field)} ${escapeHtml(importValue(item))} <span>${escapeHtml(item.reason)}</span></li>`).join('');
        notes.push(`<details class="import-details is-warning"><summary>${plural(preview.skipped.length, 'value')} won’t be imported</summary><ul>${items}</ul></details>`);
    }
    preview.ignored.filter((item) => item.blocked).forEach((item) => {
        notes.push(`<p class="import-note is-warning">${escapeHtml(item.sheet)} won’t be imported: ${escapeHtml(item.reason)}. Widen that column to accept it, then import again.</p>`);
    });
    if (preview.ignored.length) {
        const items = preview.ignored.map((item) => `<li><strong>${escapeHtml(item.sheet)}</strong> <span>${escapeHtml(item.reason)}</span></li>`).join('');
        notes.push(`<details class="import-details"><summary>${plural(preview.ignored.length, 'tab')} not read</summary><ul>${items}</ul></details>`);
    }

    node.innerHTML = `
        <p class="import-lead"><strong>${plural(preview.figures, 'figure')}</strong> for ${escapeHtml(importSpan(preview.from, preview.to))}, from ${plural(preview.tabs.length, 'tab')}. Each count is the number of months filled.</p>
        <div class="table-scroll import-scroll">
            <table class="import-table">
                <thead><tr><th>Tab</th><th>Applies to</th><th>Months</th>${IMPORT_COLUMNS.map(([, label]) => `<th class="align-right">${label}</th>`).join('')}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${notes.join('')}`;
    node.hidden = false;
}

if (importModal && importForm) {
    const fileInput = $('#import-file');
    const drop = $('#import-drop');

    $('#open-import-modal').addEventListener('click', openImportModal);
    importModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeImportModal));
    importModal.addEventListener('click', (event) => { if (event.target === importModal) closeImportModal(); });
    importModal.addEventListener('cancel', (event) => { if (state.importBusy) event.preventDefault(); });

    fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        previewImport(file || null);
    });

    ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.dataset.drag = 'on';
    }));
    ['dragleave', 'dragend'].forEach((type) => drop.addEventListener(type, () => { delete drop.dataset.drag; }));
    drop.addEventListener('drop', (event) => {
        event.preventDefault();
        delete drop.dataset.drag;
        if (state.importBusy) return;
        const file = event.dataTransfer && event.dataTransfer.files[0];
        if (file) previewImport(file);
    });

    importForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!state.importFile || !state.importPreview || state.importBusy) return;
        const label = $('#import-form-submit').textContent;
        state.importBusy = true;
        setImportSubmit('Saving…', true);
        fileInput.disabled = true;
        showImportError('');
        try {
            const result = await importRequest({ method: 'POST', body: importUploadBody('commit') });
            state.importResult = { fileName: result.file.name, figures: result.figures, from: result.from, to: result.to };
            await Promise.all([loadMarginInputs(), loadTargetInputs(), typeof loadSalesTargets === 'function' ? loadSalesTargets() : null]);
            state.importBusy = false;
            closeImportModal();
            renderImportStatus();
        } catch (error) {
            const message = error.message || 'Could not save the figures.';
            showImportError(/nothing was saved/i.test(message) ? message : `${message} Nothing was saved.`);
            setImportSubmit(label, false);
        } finally {
            state.importBusy = false;
            fileInput.disabled = false;
        }
    });
}