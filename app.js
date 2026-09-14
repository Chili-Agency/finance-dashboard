const state = { invoices: [], sourceTypeCounts: {}, scope: 'all', period: 'current', customStart: '', customEnd: '', statusChart: null, mrrChart: null };
const companyLabels = { br: 'Brazil', mx: 'Mexico', pa: 'Panama', int: 'International' };
const colors = { paid: '#57745d', late: '#d49b35', open: '#55778a', authorised: '#e84d2c', voided: '#a5a6a0' };

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);
const number = (value) => new Intl.NumberFormat('en-US').format(value || 0);
const monthLabel = (date) => new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date);

function parseDate(value) {
    if (!value) return null;
    if (typeof value === 'string' && value.startsWith('/Date(')) {
        const timestamp = Number(value.match(/-?\d+/)?.[0]);
        if (Number.isNaN(timestamp)) return null;
        const utc = new Date(timestamp);
        return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function invoiceDate(invoice) { return parseDate(invoice.DateString || invoice.Date); }
function dueDate(invoice) { return parseDate(invoice.DueDateString || invoice.DueDate); }
function amount(invoice) {
    const usd = invoice.amounts_usd;
    if (usd) {
        const value = usd.Total ?? usd.SubTotal ?? usd.AmountDue;
        if (Number.isFinite(Number(value))) return Number(value);
    }
    return Number(invoice.Total || invoice.SubTotal || invoice.AmountDue || 0) * Number(invoice.usdRate || 1);
}
function isRevenue(invoice) { return String(invoice.Type || '').toUpperCase() === 'ACCREC'; }
function normalStatus(invoice) { return String(invoice.Status || '').toUpperCase().replace('AUTHORIZED', 'AUTHORISED'); }

function periodBounds(period = state.period) {
    const now = new Date();
    const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    if (period === 'all') return { start: null, end: null, label: 'All available' };
    if (period === 'custom') {
        const startValue = state.customStart || $('#date-from').value;
        const endValue = state.customEnd || $('#date-to').value;
        const start = startValue ? new Date(`${startValue}T00:00:00`) : null;
        const end = endValue ? new Date(`${endValue}T23:59:59`) : null;
        return { start, end, label: `${startValue || 'Start'} to ${endValue || 'End'}` };
    }
    if (period === 'quarter') return { start: new Date(now.getFullYear(), now.getMonth() - 2, 1), end: now, label: 'Last 3 months' };
    const offset = period === 'previous' ? -1 : period === 'two-previous' ? -2 : 0;
    const start = new Date(currentStart.getFullYear(), currentStart.getMonth() + offset, 1);
    return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59), label: offset === 0 ? 'Current month' : offset === -1 ? 'Previous month' : 'Two months ago' };
}

function filteredInvoices() {
    const bounds = periodBounds();
    return state.invoices.filter((invoice) => {
        const date = invoiceDate(invoice);
        const inScope = state.scope === 'all' || invoice.companyKey === state.scope;
        const inPeriod = (!bounds.start && !bounds.end)
            || (date && (!bounds.start || date >= bounds.start) && (!bounds.end || date <= bounds.end));
        return isRevenue(invoice) && inScope && inPeriod;
    }).sort((a, b) => (invoiceDate(b)?.getTime() || 0) - (invoiceDate(a)?.getTime() || 0));
}

function invoiceBucket(invoice) {
    const status = normalStatus(invoice);
    if (status === 'PAID') return 'paid';
    if (status === 'VOIDED') return 'voided';
    const due = dueDate(invoice);
    if (Number(invoice.AmountDue || 0) > 0 && due && due < startOfToday()) return 'late';
    return 'open';
}

function setSyncStatus(text, detail, loading = false) { $('#sync-status').textContent = text; $('#sync-time').textContent = detail; document.body.classList.toggle('loading', loading); }

async function loadInvoices() {
    setSyncStatus('Fetching data', 'Contacting n8n endpoints', true);
    try {
        const response = await fetch('api.php?source=all', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Dashboard proxy returned HTTP ${response.status}`);
        const data = await response.json();
        state.invoices = Array.isArray(data.invoices) ? data.invoices : [];
        state.sourceTypeCounts = data.sourceTypeCounts || {};
        const errors = Array.isArray(data.errors) ? data.errors : [];
            const currentPeriodHasInvoices = filteredInvoices().length > 0;
            const shouldShowAvailableData = state.period === 'current' && state.invoices.length > 0 && !currentPeriodHasInvoices;
            if (shouldShowAvailableData) {
                state.period = 'all';
                $('#period-select').value = 'all';
            }
            $('#error-notice').classList.remove('is-info');
            $('#error-notice').textContent = errors.length
                ? errors.join(' · ')
                : shouldShowAvailableData
                    ? 'No client invoices were issued in the current month. Showing all available fetched records.'
                    : '';
        $('#error-notice').classList.toggle('is-hidden', errors.length === 0);
            $('#error-notice').classList.toggle('is-info', errors.length === 0 && shouldShowAvailableData);
        const fetchedCount = state.invoices.length;
        setSyncStatus(errors.length ? 'Partially synced' : 'Synced', `${fetchedCount} records · Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        renderAll();
    } catch (error) {
        setSyncStatus('Connection issue', 'Could not load invoice data');
        $('#error-notice').textContent = error.message;
        $('#error-notice').classList.remove('is-hidden');
    }
}

function renderMetrics(invoices) {
    const totals = { paid: 0, late: 0, open: 0, paidCount: 0, lateCount: 0, openCount: 0 };
    invoices.forEach((invoice) => { const bucket = invoiceBucket(invoice); if (bucket === 'paid') { totals.paid += amount(invoice); totals.paidCount++; } if (bucket === 'late') { totals.late += amount(invoice); totals.lateCount++; } if (bucket === 'open') { totals.open += amount(invoice); totals.openCount++; } });
    $('#paid-total').textContent = money(totals.paid); $('#late-total').textContent = money(totals.late); $('#open-total').textContent = money(totals.open);
    $('#paid-count').textContent = `${number(totals.paidCount)} invoice${totals.paidCount === 1 ? '' : 's'}`; $('#late-count').textContent = `${number(totals.lateCount)} invoice${totals.lateCount === 1 ? '' : 's'}`; $('#open-count').textContent = `${number(totals.openCount)} invoice${totals.openCount === 1 ? '' : 's'}`;
}

function renderStatusChart(invoices) {
    const data = { authorised: 0, paid: 0, voided: 0 };
    invoices.forEach((invoice) => { const status = normalStatus(invoice); if (status === 'PAID') data.paid++; else if (status === 'VOIDED') data.voided++; else data.authorised++; });
    const values = [data.authorised, data.paid, data.voided];
    if (state.statusChart) state.statusChart.destroy();
    state.statusChart = new Chart($('#status-chart'), { type: 'doughnut', data: { labels: ['Authorised', 'Paid', 'Voided'], datasets: [{ data: values, backgroundColor: [colors.authorised, colors.paid, colors.voided], borderWidth: 0, spacing: 3 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '73%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => ` ${context.label}: ${context.raw}` } } } } });
    $('#chart-empty').classList.toggle('is-hidden', invoices.length > 0);
    $('#chart-legend').innerHTML = [['authorised', 'Authorised'], ['paid', 'Paid'], ['voided', 'Voided']].map(([key, label], index) => `<span class="legend-item"><i class="legend-dot" style="background:${colors[key]}"></i>${label} ${values[index]}</span>`).join('');
    $('#invoice-count').textContent = `${number(invoices.length)} invoice${invoices.length === 1 ? '' : 's'}`;
}

function renderMarkets(invoices) {
    const totals = {}; invoices.forEach((invoice) => { totals[invoice.companyKey] = (totals[invoice.companyKey] || 0) + amount(invoice); });
    const max = Math.max(...Object.values(totals), 1);
    $('#market-list').innerHTML = Object.entries(companyLabels).map(([key, label]) => `<div class="market-row"><span class="market-name">${label}</span><div class="market-bar"><span style="width:${((totals[key] || 0) / max) * 100}%"></span></div><span class="market-value">${money(totals[key] || 0)}</span></div>`).join('');
}

function renderTable(invoices) {
    $('#table-summary').textContent = `${number(invoices.length)} record${invoices.length === 1 ? '' : 's'}`;
    $('#invoice-table').innerHTML = invoices.map((invoice) => { const bucket = invoiceBucket(invoice); const date = invoiceDate(invoice); const due = dueDate(invoice); const statusLabel = bucket === 'late' ? 'Late' : bucket[0].toUpperCase() + bucket.slice(1); return `<tr><td>${escapeHtml(invoice.Contact?.Name || 'Unknown client')}<div class="client-sub">${escapeHtml(invoice.InvoiceNumber || invoice.InvoiceID || 'Unnumbered')}</div></td><td>${companyLabels[invoice.companyKey] || invoice.company || '—'}</td><td>${date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td><td>${due ? due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td><td><span class="status-pill ${bucket}">${statusLabel}</span></td><td class="align-right">${money(amount(invoice))}</td></tr>`; }).join('');
    $('#table-empty').classList.toggle('is-hidden', invoices.length > 0);
}

function renderOverview() {
    const invoices = filteredInvoices();
    renderMetrics(invoices);
    renderStatusChart(invoices);
    renderMarkets(invoices);
    renderTable(invoices);
    if (state.scope !== 'all' && invoices.length === 0 && state.sourceTypeCounts[state.scope]) {
        const types = state.sourceTypeCounts[state.scope];
        const rawCount = Object.values(types).reduce((sum, count) => sum + count, 0);
        const expenseCount = types.ACCPAY || 0;
        $('#error-notice').classList.remove('is-hidden');
        $('#error-notice').classList.add('is-info');
        $('#error-notice').textContent = expenseCount === rawCount
            ? `${companyLabels[state.scope]} returned ${rawCount} records, but they are expense invoices (ACCPAY), not client invoices (ACCREC).`
            : `${companyLabels[state.scope]} returned ${rawCount} records, but none match the selected reporting period.`;
        return;
    }

    const unconverted = invoices.filter((invoice) => invoice.conversion && invoice.conversion.ok === false);
    if (unconverted.length && $('#error-notice').classList.contains('is-hidden')) {
        $('#error-notice').classList.remove('is-hidden');
        $('#error-notice').classList.add('is-info');
        $('#error-notice').textContent = `${number(unconverted.length)} invoice${unconverted.length === 1 ? '' : 's'} without a live FX rate — shown using the fallback rate.`;
    }
}

function monthSeries() {
    const bounds = periodBounds();
    const source = state.invoices.filter((invoice) => isRevenue(invoice) && (state.scope === 'all' || invoice.companyKey === state.scope));
    const dates = source.map(invoiceDate).filter(Boolean).filter((date) => (!bounds.start || date >= bounds.start) && (!bounds.end || date <= bounds.end));
    if (!dates.length) return { labels: [], values: [] };
    const first = new Date(Math.min(...dates.map((date) => date.getTime()))); first.setDate(1);
    const last = new Date(Math.max(...dates.map((date) => date.getTime()))); last.setDate(1);
    const months = [];
    for (const month = new Date(first.getFullYear(), first.getMonth(), 1); month <= last; month.setMonth(month.getMonth() + 1)) months.push(new Date(month));
    return { labels: months.map(monthLabel), values: months.map((month) => source.filter((invoice) => { const date = invoiceDate(invoice); return date && date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth() && (!bounds.start || date >= bounds.start) && (!bounds.end || date <= bounds.end); }).reduce((sum, invoice) => sum + amount(invoice), 0)) };
}

function renderMrr() { const series = monthSeries(); const selectedInvoices = filteredInvoices(); const selected = selectedInvoices.reduce((sum, invoice) => sum + amount(invoice), 0); $('#mrr-total').textContent = money(selected); $('#mrr-label').textContent = periodBounds().label; if (state.mrrChart) state.mrrChart.destroy(); state.mrrChart = new Chart($('#mrr-chart'), { type: 'bar', data: { labels: series.labels, datasets: [{ data: series.values, backgroundColor: series.values.map((_, index) => index === series.values.length - 1 ? colors.authorised : '#d9d8d0'), borderRadius: 2, barPercentage: .58 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => ` ${money(context.raw)}` } } }, scales: { x: { grid: { display: false }, ticks: { color: '#7b827d', font: { family: 'DM Mono', size: 10 } } }, y: { beginAtZero: true, grid: { color: '#e5e3dc' }, ticks: { color: '#7b827d', font: { family: 'DM Mono', size: 9 }, callback: (value) => money(value) } } } } }); $('#mrr-empty').classList.toggle('is-hidden', series.values.length > 0); $('#mrr-breakdown').innerHTML = Object.entries(companyLabels).map(([key, label]) => { const total = selectedInvoices.filter((invoice) => invoice.companyKey === key).reduce((sum, invoice) => sum + amount(invoice), 0); return `<div class="breakdown-item"><span>${label}</span><strong>${money(total)}</strong></div>`; }).join(''); }

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character])); }
function renderAll() { renderOverview(); renderMrr(); renderScorecard(); }

$('#period-select').addEventListener('change', (event) => { state.period = event.target.value; $('#date-range').hidden = state.period !== 'custom'; renderAll(); });
$('#date-from').addEventListener('input', (event) => { state.customStart = event.target.value; });
$('#date-to').addEventListener('input', (event) => { state.customEnd = event.target.value; });
$('#apply-date-filter').addEventListener('click', () => {
    state.customStart = $('#date-from').value;
    state.customEnd = $('#date-to').value;
    if (!state.customStart || !state.customEnd || state.customStart > state.customEnd) {
        $('#error-notice').textContent = 'Choose a valid start and end date.';
        $('#error-notice').classList.remove('is-hidden');
        return;
    }
    state.period = 'custom';
    $('#period-select').value = 'custom';
    $('#error-notice').classList.add('is-hidden');
    renderAll();
});
$('#refresh-button').addEventListener('click', loadInvoices);
document.querySelectorAll('.scope-tab').forEach((button) => button.addEventListener('click', () => { state.scope = button.dataset.scope; document.querySelectorAll('.scope-tab').forEach((item) => item.classList.toggle('is-active', item.dataset.scope === state.scope)); renderAll(); }));
document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('is-active')); button.classList.add('is-active'); document.querySelectorAll('.view').forEach((view) => view.classList.remove('is-visible')); $(`#${button.dataset.view}-view`).classList.add('is-visible'); $('#page-title').textContent = button.dataset.title || button.textContent.trim(); }));
loadInvoices();
/* ==========================================================================
   Scorecard: retention, targets and margin
   --------------------------------------------------------------------------
   Only the front end for now. Every number below comes from `state.scorecard`.
   Flip USE_DEMO_DATA to false to see the real empty states, and later replace
   DEMO_SCORECARD with the payload coming from api.php (see the shape below).
   ========================================================================== */

const USE_DEMO_DATA = true;

const EMPTY_SCORECARD = {
    retention: { initialPortfolio: null, churned: null, upsells: null, retained: null, target: null, activeClients: null },
    newBusiness: { actual: null, target: null },
    totalMrr: { actual: null, target: null, accumulatedGap: null, history: [] },
    cogs: { actual: null, target: null },
    margin: { current: null, target: null, bonusPool: null },
};

// Placeholder values so the components can be reviewed with content in them.
const DEMO_SCORECARD = {
    retention: { initialPortfolio: 412000, churned: 38500, upsells: 26400, retained: null, target: 405000, activeClients: 84 },
    newBusiness: { actual: 58200, target: 75000 },
    totalMrr: {
        actual: 458100,
        target: 475000,
        accumulatedGap: -32400,
        history: [
            { label: 'Apr 2026', actual: 421000, target: 430000 },
            { label: 'May 2026', actual: 436500, target: 445000 },
            { label: 'Jun 2026', actual: 449800, target: 455000 },
            { label: 'Jul 2026', actual: 447200, target: 465000 },
            { label: 'Aug 2026', actual: 461900, target: 470000 },
            { label: 'Sep 2026', actual: 458100, target: 475000 },
        ],
    },
    cogs: { actual: 186400, target: 175000 },
    margin: { current: 0.407, target: 0.45, bonusPool: 18200 },
};

state.scorecard = USE_DEMO_DATA ? DEMO_SCORECARD : EMPTY_SCORECARD;
state.gapChart = null;

const DASH = '—';
const hasValue = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const moneyOr = (value) => (hasValue(value) ? money(Number(value)) : DASH);
const signedMoney = (value) => (hasValue(value) ? `${Number(value) > 0 ? '+' : Number(value) < 0 ? '−' : ''}${money(Math.abs(Number(value)))}` : DASH);
const percentOr = (value, digits = 1) => (hasValue(value) ? `${(Number(value) * 100).toFixed(digits)}%` : DASH);
const signedPoints = (value, digits = 1) => (hasValue(value) ? `${Number(value) > 0 ? '+' : Number(value) < 0 ? '−' : ''}${Math.abs(Number(value) * 100).toFixed(digits)} pts` : DASH);
const share = (part, whole) => (hasValue(part) && hasValue(whole) && Number(whole) !== 0 ? Number(part) / Number(whole) : null);
const clampPercent = (value) => Math.max(0, Math.min(100, value));

function setText(selector, value) { const node = $(selector); if (node) node.textContent = value; }

function deltaPill(value, { lowerIsBetter = false, suffix = '', formatter = signedMoney } = {}) {
    if (!hasValue(value)) return `<span class="delta is-flat">${DASH}</span>`;
    const delta = Number(value);
    const good = lowerIsBetter ? delta <= 0 : delta >= 0;
    const tone = delta === 0 ? 'is-flat' : good ? 'is-up' : 'is-down';
    return `<span class="delta ${tone}">${formatter(delta)}${suffix}</span>`;
}

function targetBlock({ caption, value, target, note, lowerIsBetter = false }) {
    if (!hasValue(value) && !hasValue(target)) {
        return `<p class="empty-line">Waiting for target data</p>`;
    }
    const progress = share(value, target);
    const width = hasValue(progress) ? clampPercent(progress * 100) : 0;
    const gap = hasValue(value) && hasValue(target) ? Number(value) - Number(target) : null;
    const complete = lowerIsBetter ? hasValue(gap) && gap <= 0 : hasValue(gap) && gap >= 0;
    return `
        <span class="target-caption">${escapeHtml(caption)}</span>
        <span class="target-value">${moneyOr(value)}</span>
        <div class="target-track"><span class="target-fill${complete ? ' is-complete' : ''}" style="width:${width}%"></span></div>
        <div class="target-scale"><span>${hasValue(progress) ? `${(progress * 100).toFixed(0)}% of target` : 'No target set'}</span><span>Target <strong>${moneyOr(target)}</strong></span></div>
        <div class="target-foot">${deltaPill(gap, { lowerIsBetter })}<small>${escapeHtml(note)}</small></div>
    `;
}

function renderRetentionSection() {
    const data = state.scorecard.retention || {};
    const retained = hasValue(data.retained)
        ? Number(data.retained)
        : hasValue(data.initialPortfolio) && hasValue(data.churned)
            ? Number(data.initialPortfolio) - Number(data.churned) + Number(data.upsells || 0)
            : null;

    setText('#ret-initial', moneyOr(data.initialPortfolio));
    setText('#ret-churned', moneyOr(data.churned));
    setText('#ret-upsells', moneyOr(data.upsells));
    setText('#ret-clients', hasValue(data.activeClients) ? number(data.activeClients) : DASH);
    setText('#ret-churn-rate', percentOr(share(data.churned, data.initialPortfolio)));
    setText('#ret-expansion-rate', percentOr(share(data.upsells, data.initialPortfolio)));

    const rows = [
        { label: 'Initial portfolio value', hint: 'Base at the start of the period', value: data.initialPortfolio, tone: '', signed: false },
        { label: 'Churned value', hint: 'Clients lost in the period', value: hasValue(data.churned) ? -Number(data.churned) : null, tone: 'is-negative', signed: true },
        { label: 'Upsells, cross-sells & referrals', hint: 'Expansion on the same base', value: data.upsells, tone: 'is-positive', signed: true },
        { label: 'Retention (existing)', hint: 'What the base is worth now', value: retained, tone: 'is-total', signed: false },
    ];
    const max = Math.max(...rows.map((row) => Math.abs(Number(row.value) || 0)), 1);

    $('#retention-waterfall').innerHTML = rows.map((row) => `
        <div class="waterfall-row ${row.tone}">
            <div class="waterfall-label">${escapeHtml(row.label)}<small>${escapeHtml(row.hint)}</small></div>
            <div class="waterfall-bar"><span style="width:${(Math.abs(Number(row.value) || 0) / max) * 100}%"></span></div>
            <div class="waterfall-value">${row.signed ? signedMoney(row.value) : moneyOr(row.value)}</div>
        </div>
    `).join('');

    $('#retention-target').innerHTML = targetBlock({
        caption: 'Retention (existing)',
        value: retained,
        target: data.target,
        note: 'Retained base against the retention goal for the period.',
    });
}

function renderTargetsSection() {
    const newBusiness = state.scorecard.newBusiness || {};
    const totalMrr = state.scorecard.totalMrr || {};

    $('#newbiz-target').innerHTML = targetBlock({
        caption: 'Won this period',
        value: newBusiness.actual,
        target: newBusiness.target,
        note: 'New contracts signed, excluding expansion on existing clients.',
    });

    $('#totalmrr-target').innerHTML = targetBlock({
        caption: 'Total MRR',
        value: totalMrr.actual,
        target: totalMrr.target,
        note: 'Retained base plus new business, normalized to USD.',
    });

    const difference = hasValue(totalMrr.actual) && hasValue(totalMrr.target) ? Number(totalMrr.actual) - Number(totalMrr.target) : null;
    const toTarget = hasValue(difference) ? Math.max(0, -difference) : null;

    setText('#mrr-difference', hasValue(difference) ? signedMoney(difference) : DASH);
    $('#mrr-difference').className = hasValue(difference) ? (difference >= 0 ? 'value-up' : 'value-down') : '';
    setText('#mrr-to-target', hasValue(toTarget) ? (toTarget === 0 ? 'Target met' : moneyOr(toTarget)) : DASH);
    setText('#mrr-accumulated', hasValue(totalMrr.accumulatedGap) ? signedMoney(totalMrr.accumulatedGap) : DASH);
    $('#mrr-accumulated').className = hasValue(totalMrr.accumulatedGap) ? (totalMrr.accumulatedGap >= 0 ? 'value-up' : 'value-down') : '';

    renderGapChart(Array.isArray(totalMrr.history) ? totalMrr.history : []);
}

function renderGapChart(history) {
    const canvas = $('#gap-chart');
    if (!canvas) return;
    $('#gap-empty').classList.toggle('is-hidden', history.length > 0);
    if (state.gapChart) state.gapChart.destroy();
    if (!history.length) { state.gapChart = null; return; }

    state.gapChart = new Chart(canvas, {
        data: {
            labels: history.map((entry) => entry.label),
            datasets: [
                { type: 'bar', label: 'Actual', data: history.map((entry) => entry.actual), backgroundColor: history.map((entry, index) => (index === history.length - 1 ? colors.authorised : '#d9d8d0')), borderRadius: 2, barPercentage: .58, order: 2 },
                { type: 'line', label: 'Target', data: history.map((entry) => entry.target), borderColor: colors.open, borderWidth: 2, borderDash: [5, 4], pointRadius: 3, pointBackgroundColor: colors.open, tension: .25, order: 1 },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, color: '#7b827d', font: { family: 'Manrope', size: 11 } } },
                tooltip: { callbacks: { label: (context) => ` ${context.dataset.label}: ${money(context.raw)}` } },
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#7b827d', font: { family: 'DM Mono', size: 10 } } },
                y: { beginAtZero: true, grid: { color: '#e5e3dc' }, ticks: { color: '#7b827d', font: { family: 'DM Mono', size: 9 }, callback: (value) => money(value) } },
            },
        },
    });
}

function renderMarginSection() {
    const cogs = state.scorecard.cogs || {};
    const margin = state.scorecard.margin || {};
    const totalMrr = state.scorecard.totalMrr || {};

    const cogsDifference = hasValue(cogs.actual) && hasValue(cogs.target) ? Number(cogs.actual) - Number(cogs.target) : null;
    setText('#cogs-actual', moneyOr(cogs.actual));
    setText('#cogs-target', moneyOr(cogs.target));
    setText('#cogs-share', percentOr(share(cogs.actual, totalMrr.actual)));
    setText('#cogs-difference', hasValue(cogsDifference) ? signedMoney(cogsDifference) : DASH);
    $('#cogs-difference').className = hasValue(cogsDifference) ? (cogsDifference <= 0 ? 'value-up' : 'value-down') : '';

    const gap = hasValue(margin.current) && hasValue(margin.target) ? Number(margin.current) - Number(margin.target) : null;
    setText('#margin-gap-meta', hasValue(gap) ? `${signedPoints(gap)} vs target` : 'No target set');
    $('#margin-gauge').innerHTML = marginGauge(margin.current, margin.target);

    setText('#bonus-pool', moneyOr(margin.bonusPool));
    setText('#bonus-gap', signedPoints(gap));
    setText('#bonus-status', hasValue(gap) ? (gap >= 0 ? 'Unlocked' : 'Below target') : DASH);
    setText('#bonus-note', hasValue(gap) && gap < 0
        ? `Margin is ${Math.abs(gap * 100).toFixed(1)} points short of target. Close the gap to release the pool.`
        : 'Margin is at or above target for the period.');
}

function marginGauge(current, target) {
    const scaleMax = Math.ceil(Math.max(0.4, Number(current) || 0, Number(target) || 0) * 1.2 * 10) / 10;
    const radius = 78;
    const arcLength = Math.PI * radius;
    const progress = hasValue(current) ? clampPercent((Number(current) / scaleMax) * 100) / 100 : 0;
    const complete = hasValue(current) && hasValue(target) && Number(current) >= Number(target);

    let marker = '';
    if (hasValue(target)) {
        const angle = Math.PI * Math.min(1, Number(target) / scaleMax);
        const point = (length) => [100 - length * Math.cos(angle), 100 - length * Math.sin(angle)];
        const [x1, y1] = point(radius - 11);
        const [x2, y2] = point(radius + 11);
        marker = `<line class="gauge-marker" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-width="2"></line>`;
    }

    return `
        <div class="gauge-figure">
            <svg viewBox="0 0 200 126" role="img" aria-label="Current margin against target">
                <path class="gauge-track" d="M 22 100 A ${radius} ${radius} 0 0 1 178 100" fill="none" stroke-width="14"></path>
                <path class="gauge-value${complete ? ' is-complete' : ''}" d="M 22 100 A ${radius} ${radius} 0 0 1 178 100" fill="none" stroke-width="14"
                      stroke-dasharray="${arcLength.toFixed(1)}" stroke-dashoffset="${(arcLength * (1 - progress)).toFixed(1)}"></path>
                ${marker}
                <text class="gauge-caption" x="22" y="118" text-anchor="middle">0%</text>
                <text class="gauge-caption" x="178" y="118" text-anchor="middle">${(scaleMax * 100).toFixed(0)}%</text>
            </svg>
        </div>
        <div class="gauge-readout">
            <div><span>Current margin</span><strong>${percentOr(current)}</strong></div>
            <div><span>Target margin</span><strong>${percentOr(target)}</strong></div>
            <div><span>Gap</span><strong class="${hasValue(current) && hasValue(target) ? (current >= target ? 'value-up' : 'value-down') : ''}">${signedPoints(hasValue(current) && hasValue(target) ? current - target : null)}</strong></div>
        </div>
    `;
}

function renderScorecard() {
    renderRetentionSection();
    renderTargetsSection();
    renderMarginSection();
}

// Charts built inside a hidden view need a nudge once that view becomes visible.
document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
    requestAnimationFrame(() => { [state.statusChart, state.mrrChart, state.gapChart].forEach((chart) => chart && chart.resize()); });
}));

renderScorecard();