const state = { invoices: [], sourceTypeCounts: {}, categoryCounts: {}, scope: 'all', category: 'all', period: 'current', customStart: '', customEnd: '', statusChart: null, mrrChart: null };
const companyLabels = { br: 'Brazil', mx: 'Mexico', pa: 'Panama', int: 'International' };
const categoryLabels = { seo: 'SEO', ppc: 'PPC' };
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
function categoryShare(invoice, category = state.category) {
    if (category === 'all') return 1;
    const value = Number(invoice.categoryShares?.[category]);
    return Number.isFinite(value) ? value : 0;
}
function inCategory(invoice) { return state.category === 'all' || categoryShare(invoice) > 0; }
function categoryTag(invoice) {
    const list = (invoice.categories || []).map((key) => categoryLabels[key]).filter(Boolean);
    return list.length ? list.join(' + ') : '';
}
function amount(invoice) { return fullAmount(invoice) * categoryShare(invoice); }
function fullAmount(invoice) {
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
        return isRevenue(invoice) && inScope && inPeriod && inCategory(invoice);
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
        state.categoryCounts = data.categoryCounts || {};
        const errors = Array.isArray(data.errors) ? data.errors : [];
        delete $('#error-notice').dataset.dynamic;
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
    $('#invoice-table').innerHTML = invoices.map((invoice) => { const bucket = invoiceBucket(invoice); const date = invoiceDate(invoice); const due = dueDate(invoice); const statusLabel = bucket === 'late' ? 'Late' : bucket[0].toUpperCase() + bucket.slice(1); return `<tr><td>${escapeHtml(invoice.Contact?.Name || 'Unknown client')}<div class="client-sub">${escapeHtml(invoice.InvoiceNumber || invoice.InvoiceID || 'Unnumbered')}${categoryTag(invoice) ? ` · <span class="category-tag">${escapeHtml(categoryTag(invoice))}</span>` : ''}</div></td><td>${companyLabels[invoice.companyKey] || invoice.company || '—'}</td><td>${date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td><td>${due ? due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td><td><span class="status-pill ${bucket}">${statusLabel}</span></td><td class="align-right">${money(amount(invoice))}</td></tr>`; }).join('');
    $('#table-empty').classList.toggle('is-hidden', invoices.length > 0);
}

function showDynamicNotice(text) {
    const notice = $('#error-notice');
    notice.classList.remove('is-hidden');
    notice.classList.add('is-info');
    notice.dataset.dynamic = '1';
    notice.textContent = text;
}

function clearDynamicNotice() {
    const notice = $('#error-notice');
    if (notice.dataset.dynamic !== '1') return;
    delete notice.dataset.dynamic;
    notice.textContent = '';
    notice.classList.add('is-hidden');
    notice.classList.remove('is-info');
}

function renderOverview() {
    const invoices = filteredInvoices();
    clearDynamicNotice();
    renderMetrics(invoices);
    renderStatusChart(invoices);
    renderMarkets(invoices);
    renderTable(invoices);
    const noticeFree = $('#error-notice').classList.contains('is-hidden');
    if (state.category !== 'all' && invoices.length === 0 && noticeFree && state.invoices.length) {
        const label = categoryLabels[state.category];
        showDynamicNotice(Number(state.categoryCounts[state.category] || 0) === 0
            ? `No invoice line is linked to a ${label} account yet. Check that the n8n workflow sends AccountName, or add the ${label} account codes to $categoryRules in api.php.`
            : `No ${label} client invoices match this market and reporting period.`);
        return;
    }
    if (state.scope !== 'all' && invoices.length === 0 && state.sourceTypeCounts[state.scope]) {
        const types = state.sourceTypeCounts[state.scope];
        const rawCount = Object.values(types).reduce((sum, count) => sum + count, 0);
        const expenseCount = types.ACCPAY || 0;
        showDynamicNotice(expenseCount === rawCount
            ? `${companyLabels[state.scope]} returned ${rawCount} records, but they are expense invoices (ACCPAY), not client invoices (ACCREC).`
            : `${companyLabels[state.scope]} returned ${rawCount} records, but none match the selected reporting period.`);
        return;
    }

    const unconverted = invoices.filter((invoice) => invoice.conversion && invoice.conversion.ok === false);
    if (unconverted.length && $('#error-notice').classList.contains('is-hidden')) {
        showDynamicNotice(`${number(unconverted.length)} invoice${unconverted.length === 1 ? '' : 's'} without a live FX rate — shown using the fallback rate.`);
    }
}

function monthSeries() {
    const bounds = periodBounds();
    const source = state.invoices.filter((invoice) => isRevenue(invoice) && inCategory(invoice) && (state.scope === 'all' || invoice.companyKey === state.scope));
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
document.querySelectorAll('.category-tab').forEach((button) => button.addEventListener('click', () => { state.category = button.dataset.category; document.querySelectorAll('.category-tab').forEach((item) => item.classList.toggle('is-active', item.dataset.category === state.category)); renderAll(); }));
document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('is-active')); button.classList.add('is-active'); document.querySelectorAll('.view').forEach((view) => view.classList.remove('is-visible')); $(`#${button.dataset.view}-view`).classList.add('is-visible'); $('#page-title').textContent = button.dataset.title || button.textContent.trim(); }));
loadInvoices();

const MANUAL_INPUTS = {
    retentionTarget: 0.96,
    newBusinessTarget: null,
    totalMrrTarget: null,
    accumulatedGap: null,
    cogs: null,
    cogsTarget: null,
    margin: null,
    marginTarget: null,
    bonusPool: null,
};

const USE_DEMO_TARGETS = true;
const DEMO_MANUAL_INPUTS = {
    retentionTarget: 0.96,
    newBusinessTarget: 75000,
    totalMrrTarget: 475000,
    accumulatedGap: -32400,
    cogs: 186400,
    cogsTarget: 175000,
    margin: 0.407,
    marginTarget: 0.45,
    bonusPool: 18200,
};

const EXCLUDED_STATUSES = ['VOIDED', 'DELETED', 'DRAFT'];

const HISTORY_MONTHS = 6;

state.scorecard = null;
state.scorecardMeta = {};
state.gapChart = null;

const DASH = '—';
const hasValue = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const moneyOr = (value) => (hasValue(value) ? money(Number(value)) : DASH);
const signedMoney = (value) => (hasValue(value) ? `${Number(value) > 0 ? '+' : Number(value) < 0 ? '−' : ''}${money(Math.abs(Number(value)))}` : DASH);
const percentOr = (value, digits = 1) => (hasValue(value) ? `${(Number(value) * 100).toFixed(digits)}%` : DASH);
const signedPoints = (value, digits = 1) => (hasValue(value) ? `${Number(value) > 0 ? '+' : Number(value) < 0 ? '−' : ''}${Math.abs(Number(value) * 100).toFixed(digits)} pts` : DASH);
const share = (part, whole) => (hasValue(part) && hasValue(whole) && Number(whole) !== 0 ? Number(part) / Number(whole) : null);
const clampPercent = (value) => Math.max(0, Math.min(100, value));
const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;

function setText(selector, value) { const node = $(selector); if (node) node.textContent = value; }

function contactKey(invoice) { return invoice.Contact?.ContactID || invoice.Contact?.Name || 'unknown-contact'; }
function isBillable(invoice) { return isRevenue(invoice) && !EXCLUDED_STATUSES.includes(normalStatus(invoice)); }
function scopedInvoices() { return state.invoices.filter((invoice) => isBillable(invoice) && inCategory(invoice) && (state.scope === 'all' || invoice.companyKey === state.scope)); }
function endOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59); }
function inWindow(date, window) { return Boolean(date) && date >= window.start && date <= window.end; }
function isCalendarMonth(start, end) { return start.getDate() === 1 && start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear() && end.getDate() === endOfMonth(start).getDate(); }

function scorecardWindows(invoices) {
    const bounds = periodBounds();
    let start = bounds.start;
    let end = bounds.end;
    let label = bounds.label;

    if (!start || !end) {
        const dates = invoices.map(invoiceDate).filter(Boolean);
        if (!dates.length) return null;
        const latest = new Date(Math.max(...dates.map((date) => date.getTime())));
        start = new Date(latest.getFullYear(), latest.getMonth(), 1);
        end = endOfMonth(start);
        label = monthLabel(start);
    }

    const current = { start, end, label };
    const previous = previousWindowOf(current);
    return { current, previous, beforePrevious: previousWindowOf(previous) };
}

function previousWindowOf(window) {
    if (isCalendarMonth(window.start, window.end)) {
        const start = new Date(window.start.getFullYear(), window.start.getMonth() - 1, 1);
        return { start, end: endOfMonth(start), label: monthLabel(start) };
    }
    const end = new Date(window.start.getTime() - 1);
    const start = new Date(end.getTime() - (window.end.getTime() - window.start.getTime()));
    return { start, end, label: 'previous window' };
}

function totalsByContact(invoices) {
    const map = new Map();
    invoices.forEach((invoice) => {
        const key = contactKey(invoice);
        map.set(key, (map.get(key) || 0) + amount(invoice));
    });
    return map;
}

function monthlyHistory(invoices, until) {
    const months = [];
    for (let offset = HISTORY_MONTHS - 1; offset >= 0; offset -= 1) {
        const start = new Date(until.getFullYear(), until.getMonth() - offset, 1);
        months.push({ start, end: endOfMonth(start) });
    }
    return months.map((month) => ({
        label: monthLabel(month.start),
        actual: invoices.filter((invoice) => inWindow(invoiceDate(invoice), month)).reduce((sum, invoice) => sum + amount(invoice), 0),
        target: null,
    }));
}

function buildScorecard() {
    const manual = USE_DEMO_TARGETS ? DEMO_MANUAL_INPUTS : MANUAL_INPUTS;
    const scorecard = {
        retention: { initialPortfolio: null, churned: null, upsells: null, retained: null, initialPortfolioPrior: null, target: manual.retentionTarget, activeClients: null },
        newBusiness: { actual: null, target: manual.newBusinessTarget },
        totalMrr: { actual: null, target: manual.totalMrrTarget, accumulatedGap: manual.accumulatedGap, history: [] },
        cogs: { actual: manual.cogs, target: manual.cogsTarget },
        margin: { current: manual.margin, target: manual.marginTarget, bonusPool: manual.bonusPool },
    };
    const meta = { invoiceCount: 0, markedFirstMonth: 0, markedUpsell: 0, reactivated: null, newClients: 0, lostClients: 0, detection: 'none' };

    const invoices = scopedInvoices();
    const windows = scorecardWindows(invoices);
    state.scorecardMeta = meta;

    const entry = marginInputFor(windows);
    meta.marginEntry = entry;
    meta.marginMonth = windows && isCalendarMonth(windows.current.start, windows.current.end) ? windows.current.start : null;
    if (entry) {
        scorecard.cogs = { actual: entry.cogs, target: entry.cogsTarget };
        scorecard.margin = { current: entry.margin, target: entry.marginTarget, bonusPool: entry.bonusPool };
    }

    if (!windows) { state.scorecard = scorecard; return; }

    meta.currentLabel = windows.current.label;
    meta.previousLabel = windows.previous.label;
    meta.priorLabel = windows.beforePrevious.label;

    const current = invoices.filter((invoice) => inWindow(invoiceDate(invoice), windows.current));
    const previous = invoices.filter((invoice) => inWindow(invoiceDate(invoice), windows.previous));
    const beforePrevious = invoices.filter((invoice) => inWindow(invoiceDate(invoice), windows.beforePrevious));
    const currentByContact = totalsByContact(current);
    const previousByContact = totalsByContact(previous);
    const firstSeen = new Map();
    let datasetStart = null;
    invoices.forEach((invoice) => {
        const date = invoiceDate(invoice);
        if (!date) return;
        if (!datasetStart || date < datasetStart) datasetStart = date;
        const key = contactKey(invoice);
        const known = firstSeen.get(key);
        if (!known || date < known) firstSeen.set(key, date);
    });
    const historyAvailable = Boolean(datasetStart) && datasetStart < windows.current.start;

    const newContacts = new Set();
    current.forEach((invoice) => {
        if (invoice.flags && invoice.flags.firstMonth) { newContacts.add(contactKey(invoice)); meta.markedFirstMonth += 1; }
        if (invoice.flags && invoice.flags.upsell) meta.markedUpsell += 1;
    });
    if (historyAvailable) {
        currentByContact.forEach((_, key) => {
            const first = firstSeen.get(key);
            if (first && first >= windows.current.start) newContacts.add(key);
        });
    }
    meta.detection = meta.markedFirstMonth > 0 && historyAvailable ? 'marker + history'
        : meta.markedFirstMonth > 0 ? 'marker'
            : historyAvailable ? 'history' : 'unavailable';

    let churned = 0;
    let expansion = 0;
    let retained = 0;
    previousByContact.forEach((previousValue, key) => {
        const currentValue = currentByContact.get(key) || 0;
        retained += currentValue;
        if (currentValue < previousValue) churned += previousValue - currentValue;
        if (currentValue > previousValue) expansion += currentValue - previousValue;
        if (currentValue === 0) meta.lostClients += 1;
    });

    let newBusiness = 0;
    let reactivated = 0;
    currentByContact.forEach((value, key) => {
        if (previousByContact.has(key)) return;
        if (newContacts.has(key)) { newBusiness += value; meta.newClients += 1; } else { reactivated += value; }
    });

    scorecard.retention.initialPortfolio = previous.length ? [...previousByContact.values()].reduce((sum, value) => sum + value, 0) : null;
    scorecard.retention.churned = previous.length ? churned : null;
    scorecard.retention.upsells = previous.length ? expansion : null;
    scorecard.retention.retained = previous.length ? retained : null;
    scorecard.retention.activeClients = currentByContact.size;
    scorecard.retention.initialPortfolioPrior = beforePrevious.length
        ? beforePrevious.reduce((sum, invoice) => sum + amount(invoice), 0)
        : null;

    scorecard.newBusiness.actual = newBusiness;
    scorecard.totalMrr.actual = current.reduce((sum, invoice) => sum + amount(invoice), 0);
    scorecard.totalMrr.history = monthlyHistory(invoices, windows.current.start);

    meta.invoiceCount = current.length;
    meta.reactivated = reactivated;

    state.scorecard = scorecard;
}

function deltaPill(value, { lowerIsBetter = false, suffix = '', formatter = signedMoney } = {}) {
    if (!hasValue(value)) return `<span class="delta is-flat">${DASH}</span>`;
    const delta = Number(value);
    const good = lowerIsBetter ? delta <= 0 : delta >= 0;
    const tone = delta === 0 ? 'is-flat' : good ? 'is-up' : 'is-down';
    return `<span class="delta ${tone}">${formatter(delta)}${suffix}</span>`;
}

function targetBlock({ caption, value, target, note, lowerIsBetter = false, format = 'money', naLabel = DASH }) {
    if (!hasValue(value) && !hasValue(target)) {
        return `<p class="empty-line">Waiting for data</p>`;
    }
    const isPercent = format === 'percent';
    const show = (input) => (hasValue(input) ? (isPercent ? percentOr(input, 2) : moneyOr(input)) : naLabel);
    const progress = share(value, target);                 // "to target" in the spreadsheet
    const width = hasValue(progress) ? clampPercent(progress * 100) : 0;
    const gap = hasValue(value) && hasValue(target) ? Number(value) - Number(target) : null;
    const complete = lowerIsBetter ? hasValue(gap) && gap <= 0 : hasValue(gap) && gap >= 0;
    const scaleLeft = !hasValue(target)
        ? 'No target set'
        : !hasValue(progress)
            ? `To target <strong>${naLabel}</strong>`
            : isPercent
                ? `To target <strong>${percentOr(progress, 2)}</strong>`
                : `${(progress * 100).toFixed(0)}% of target`;
    return `
        <span class="target-caption">${escapeHtml(caption)}</span>
        <span class="target-value">${show(value)}</span>
        <div class="target-track"><span class="target-fill${complete ? ' is-complete' : ''}" style="width:${width}%"></span></div>
        <div class="target-scale"><span>${scaleLeft}</span><span>Target <strong>${show(target)}</strong></span></div>
        <div class="target-foot">${deltaPill(gap, { lowerIsBetter, formatter: isPercent ? signedPoints : signedMoney })}<small>${escapeHtml(note)}</small></div>
    `;
}

function renderRetentionSection() {
    const data = state.scorecard.retention || {};
    const meta = state.scorecardMeta || {};
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
    setText('#ret-initial-note', meta.previousLabel ? `Billed in ${meta.previousLabel}` : 'Previous period');
    setText('#ret-clients-note', meta.invoiceCount ? `${plural(meta.invoiceCount, 'invoice')} in the period` : 'No invoices in the period');
    setText('#ret-churn-note', meta.lostClients ? `${plural(meta.lostClients, 'client')} stopped billing` : 'No client stopped billing');
    setText('#ret-upsell-note', meta.markedUpsell ? `${plural(meta.markedUpsell, 'invoice')} tagged as upsell` : 'Measured by value change');

    const rows = [
        { label: 'Initial portfolio value', hint: meta.previousLabel ? `Billed in ${meta.previousLabel}` : 'Previous period', value: data.initialPortfolio, tone: '', signed: false },
        { label: 'Churned value', hint: 'Lost clients and downgrades', value: hasValue(data.churned) ? -Number(data.churned) : null, tone: 'is-negative', signed: true },
        { label: 'Upsells, cross-sells & referrals', hint: 'Expansion on the same base', value: data.upsells, tone: 'is-positive', signed: true },
        { label: 'Retention (existing)', hint: 'What the same base is worth now', value: retained, tone: 'is-total', signed: false },
    ];
    const max = Math.max(...rows.map((row) => Math.abs(Number(row.value) || 0)), 1);

    $('#retention-waterfall').innerHTML = rows.map((row) => `
        <div class="waterfall-row ${row.tone}">
            <div class="waterfall-label">${escapeHtml(row.label)}<span class="waterfall-hint">${escapeHtml(row.hint)}</span></div>
            <div class="waterfall-bar"><span style="width:${(Math.abs(Number(row.value) || 0) / max) * 100}%"></span></div>
            <div class="waterfall-value">${row.signed ? signedMoney(row.value) : moneyOr(row.value)}</div>
        </div>
    `).join('');

    const retentionRate = share(data.initialPortfolio, data.initialPortfolioPrior);
    $('#retention-target').innerHTML = targetBlock({
        caption: 'Retention (existing)',
        value: retentionRate,
        target: data.target,
        format: 'percent',
        naLabel: 'N/A',
        note: hasValue(retentionRate)
            ? `${moneyOr(data.initialPortfolio)} in ${escapeHtml(meta.previousLabel || 'this period')} against ${moneyOr(data.initialPortfolioPrior)} in ${escapeHtml(meta.priorLabel || 'the one before')}.`
            : 'Needs two closed periods of history to compare.',
    });
}

function renderTargetsSection() {
    const newBusiness = state.scorecard.newBusiness || {};
    const totalMrr = state.scorecard.totalMrr || {};
    const meta = state.scorecardMeta || {};

    const detectionNote = {
        'marker + history': `${plural(meta.newClients || 0, 'new client')}, detected by the Xero marker and by first invoice.`,
        marker: `${plural(meta.newClients || 0, 'new client')}, detected by the "first month" marker in Xero.`,
        history: `${plural(meta.newClients || 0, 'new client')}, detected by first invoice in the fetched history.`,
        unavailable: 'No history before this period and no marker found — cannot separate new clients yet.',
        none: 'Waiting for invoice data.',
    }[meta.detection || 'none'];

    $('#newbiz-target').innerHTML = targetBlock({
        caption: 'Won this period',
        value: newBusiness.actual,
        target: newBusiness.target,
        note: detectionNote,
    });

    $('#totalmrr-target').innerHTML = targetBlock({
        caption: 'Total MRR',
        value: totalMrr.actual,
        target: totalMrr.target,
        note: hasValue(meta.reactivated) && meta.reactivated > 0
            ? `Includes ${money(meta.reactivated)} from clients that came back after a gap.`
            : 'Retained base plus new business, normalized to USD.',
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

    const hasTargets = history.some((entry) => hasValue(entry.target));
    const datasets = [
        { type: 'bar', label: 'Actual', data: history.map((entry) => entry.actual), backgroundColor: history.map((entry, index) => (index === history.length - 1 ? colors.authorised : '#d9d8d0')), borderRadius: 2, barPercentage: .58, order: 2 },
    ];
    if (hasTargets) {
        datasets.push({ type: 'line', label: 'Target', data: history.map((entry) => entry.target), borderColor: colors.open, borderWidth: 2, borderDash: [5, 4], pointRadius: 3, pointBackgroundColor: colors.open, tension: .25, order: 1 });
    }

    state.gapChart = new Chart(canvas, {
        data: { labels: history.map((entry) => entry.label), datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: hasTargets, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, color: '#7b827d', font: { family: 'Manrope', size: 11 } } },
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
    renderMarginInputStatus();

    setText('#bonus-note', hasValue(gap) && gap < 0
        ? `Margin is ${Math.abs(gap * 100).toFixed(1)} points short of target. Close the gap to release the pool.`
        : hasValue(gap) ? 'Margin is at or above target for the period.' : 'Typed by hand until COGS has a source.');
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
    buildScorecard();
    renderRetentionSection();
    renderTargetsSection();
    renderMarginSection();
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
    requestAnimationFrame(() => { [state.statusChart, state.mrrChart, state.gapChart].forEach((chart) => chart && chart.resize()); });
}));

state.marginInputs = {};

const MARGIN_FIELDS = {
    cogs: { kind: 'money' },
    cogsTarget: { kind: 'money' },
    margin: { kind: 'percent', min: -100, max: 100 },
    marginTarget: { kind: 'percent', min: 0, max: 100 },
    bonusPool: { kind: 'money' },
};

const marginModal = $('#margin-modal');
const marginForm = $('#margin-form');

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const marginInputKey = (month, scope, category) => `${month}|${scope}|${category}`;
const monthFromKey = (key) => { const [year, month] = key.split('-').map(Number); return new Date(year, month - 1, 1); };

function marginInputFor(windows) {
    if (!windows || !isCalendarMonth(windows.current.start, windows.current.end)) return null;
    return state.marginInputs[marginInputKey(monthKey(windows.current.start), state.scope, state.category)] || null;
}

async function saveMarginInput(entry) {
    state.marginInputs[marginInputKey(entry.month, entry.scope, entry.category)] = entry;
    return entry;
}

function renderMarginInputStatus() {
    const meta = state.scorecardMeta || {};
    const node = $('#margin-input-status');
    if (!node) return;
    const context = `${companyLabels[state.scope] || 'Global'}, ${state.category === 'all' ? 'all services' : categoryLabels[state.category]}`;
    if (meta.marginEntry) {
        const saved = new Date(meta.marginEntry.enteredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        node.textContent = `Figures entered by hand for ${monthLabel(monthFromKey(meta.marginEntry.month))} (${context}) at ${saved}.`;
        node.dataset.tone = 'manual';
    } else if (!meta.marginMonth) {
        node.textContent = 'Pick a single month in the reporting period to see figures entered by hand.';
        node.dataset.tone = 'muted';
    } else {
        node.textContent = `Nothing entered for ${monthLabel(meta.marginMonth)} (${context}) yet.${USE_DEMO_TARGETS ? ' Showing sample figures.' : ''}`;
        node.dataset.tone = USE_DEMO_TARGETS ? 'sample' : 'muted';
    }
}

function fillMarginValues(entry) {
    Object.entries(MARGIN_FIELDS).forEach(([name, field]) => {
        const value = entry ? entry[name] : null;
        marginForm.elements[name].value = hasValue(value)
            ? (field.kind === 'percent' ? Number((Number(value) * 100).toFixed(2)) : Number(value))
            : '';
    });
}

function loadMarginEntryIntoForm() {
    const { month, scope, category } = marginForm.elements;
    const entry = month.value ? state.marginInputs[marginInputKey(month.value, scope.value, category.value)] : null;
    if (entry) fillMarginValues(entry);
    $('#margin-form-submit').textContent = entry ? 'Update figures' : 'Save figures';
}

function showMarginError(message, field) {
    const node = $('#margin-form-error');
    marginForm.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
    node.hidden = !message;
    node.textContent = message || '';
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}

function openMarginModal() {
    const meta = state.scorecardMeta || {};
    marginForm.reset();
    showMarginError('');
    marginForm.elements.month.value = monthKey(meta.marginMonth || new Date());
    marginForm.elements.scope.value = state.scope;
    marginForm.elements.category.value = state.category;
    fillMarginValues(null);
    loadMarginEntryIntoForm();
    marginModal.showModal();
}

function closeMarginModal() { marginModal.close(); $('#open-margin-modal').focus(); }

/* Reads and validates the form. Returns the entry, or null after showing an error. */
function readMarginForm() {
    const { elements } = marginForm;
    if (!/^\d{4}-\d{2}$/.test(elements.month.value)) { showMarginError('Choose the month these figures belong to.', elements.month); return null; }

    const entry = { month: elements.month.value, scope: elements.scope.value, category: elements.category.value };
    for (const [name, field] of Object.entries(MARGIN_FIELDS)) {
        const input = elements[name];
        const label = input.closest('.field').querySelector('span').textContent;
        if (input.value.trim() === '') {
            if (input.validity.badInput) { showMarginError(`${label} is not a valid number.`, input); return null; }
            entry[name] = null;
            continue;
        }
        const value = Number(input.value);
        if (!Number.isFinite(value)) { showMarginError(`${label} is not a valid number.`, input); return null; }
        if (field.kind === 'money' && value < 0) { showMarginError(`${label} cannot be negative.`, input); return null; }
        if (field.kind === 'percent' && (value < field.min || value > field.max)) { showMarginError(`${label} must be between ${field.min}% and ${field.max}%.`, input); return null; }
        entry[name] = field.kind === 'percent' ? value / 100 : value;
    }

    if (Object.keys(MARGIN_FIELDS).every((name) => entry[name] === null)) {
        showMarginError('Fill in at least one figure.', elements.cogs);
        return null;
    }
    entry.enteredAt = new Date().toISOString();
    return entry;
}

/* Moves the dashboard to the month, market and service of the entry just saved. */
function showMarginEntry(entry) {
    state.scope = entry.scope;
    state.category = entry.category;
    document.querySelectorAll('.scope-tab').forEach((item) => item.classList.toggle('is-active', item.dataset.scope === state.scope));
    document.querySelectorAll('.category-tab').forEach((item) => item.classList.toggle('is-active', item.dataset.category === state.category));

    const start = monthFromKey(entry.month);
    const today = new Date();
    const offset = (start.getFullYear() - today.getFullYear()) * 12 + start.getMonth() - today.getMonth();
    const named = { 0: 'current', '-1': 'previous', '-2': 'two-previous' }[offset];
    if (named) {
        state.period = named;
    } else {
        state.period = 'custom';
        state.customStart = `${entry.month}-01`;
        state.customEnd = `${entry.month}-${String(endOfMonth(start).getDate()).padStart(2, '0')}`;
        $('#date-from').value = state.customStart;
        $('#date-to').value = state.customEnd;
    }
    $('#period-select').value = state.period;
    $('#date-range').hidden = state.period !== 'custom';
    renderAll();
}

$('#open-margin-modal').addEventListener('click', openMarginModal);
marginModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeMarginModal));
marginModal.addEventListener('click', (event) => { if (event.target === marginModal) closeMarginModal(); });
['month', 'scope', 'category'].forEach((name) => marginForm.elements[name].addEventListener('change', loadMarginEntryIntoForm));
marginForm.addEventListener('input', () => { if (!$('#margin-form-error').hidden) showMarginError(''); });

marginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const entry = readMarginForm();
    if (!entry) return;
    const submit = $('#margin-form-submit');
    submit.disabled = true;
    try {
        await saveMarginInput(entry);
        closeMarginModal();
        showMarginEntry(entry);
    } catch (error) {
        showMarginError(error.message || 'Could not save the figures.');
    } finally {
        submit.disabled = false;
    }
});

renderScorecard();