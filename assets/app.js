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

const STALE_AFTER_MINUTES = 30;
state.sync = { phase: 'loading', startedAt: Date.now(), finishedAt: null, sources: {}, error: null };

function shortReason(message) {
    const text = String(message || '');
    const code = /HTTP (\d{3})/.exec(text)?.[1];
    if (/Xero/i.test(text)) return 'Xero request failed';
    if (/timed? ?out/i.test(text)) return 'Timed out';
    if (/resolve|refused|connect/i.test(text)) return 'n8n unreachable';
    if (code === '404') return 'Webhook not found';
    if (code) return `n8n error ${code}`;
    if (/not JSON|empty response/i.test(text)) return 'Unexpected response';
    if (/configuration|\.env/i.test(text)) return 'Server setup error';
    return 'Failed';
}

function relativeTime(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} h ago` : new Date(timestamp).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function listNames(names) {
    return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function syncSummary() {
    const sync = state.sync;
    const keys = Object.keys(companyLabels);
    const failed = keys.filter((key) => sync.sources[key]?.error);
    const warned = keys.filter((key) => !sync.sources[key]?.error && sync.sources[key]?.warnings?.length);
    const elapsed = Math.round((Date.now() - sync.startedAt) / 1000);

    if (sync.phase === 'loading') {
        return { tone: 'loading', title: sync.finishedAt ? 'Refreshing…' : 'Loading data…', detail: `Asking n8n for invoices from ${keys.length} Xero companies · ${elapsed}s` };
    }
    if (sync.phase === 'failed') {
        return sync.finishedAt
            ? { tone: 'error', title: 'Refresh failed', detail: `Still showing data from ${relativeTime(sync.finishedAt)}. ${shortReason(sync.error)}.` }
            : { tone: 'error', title: 'No connection', detail: `Could not load invoices (${shortReason(sync.error)}). Press Refresh to try again.` };
    }
    if (failed.length === keys.length) {
        return { tone: 'error', title: 'No data received', detail: 'None of the n8n workflows answered. Press Refresh to try again.' };
    }
    const updated = `${plural(state.invoices.length, 'invoice')} · updated ${relativeTime(sync.finishedAt)}`;
    if (failed.length) {
        return { tone: 'partial', title: `${keys.length - failed.length} of ${keys.length} companies loaded`, detail: `${listNames(failed.map((key) => companyLabels[key]))} missing from totals · ${updated}` };
    }
    if ((Date.now() - sync.finishedAt) / 60000 > STALE_AFTER_MINUTES) {
        return { tone: 'stale', title: 'Data may be outdated', detail: `Last updated ${relativeTime(sync.finishedAt)}. Press Refresh for the latest invoices.` };
    }
    return { tone: warned.length ? 'warn' : 'ok', title: 'All companies up to date', detail: warned.length ? `${updated} · check the flagged ${warned.length === 1 ? 'company' : 'companies'}` : updated };
}

function renderSyncStatus() {
    const card = $('#sync-card');
    if (!card) return;
    const sync = state.sync;
    const summary = syncSummary();
    card.dataset.state = summary.tone;
    setText('#sync-status', summary.title);
    setText('#sync-time', summary.detail);
    document.body.classList.toggle('loading', sync.phase === 'loading');

    const rows = Object.entries(companyLabels).map(([key, label]) => {
        const source = sync.sources[key];
        if (!source) return { label, tone: 'loading', value: sync.phase === 'loading' ? '…' : '—', note: '', title: 'Waiting for n8n' };
        if (source.error) return { label, tone: 'error', value: 'Failed', note: shortReason(source.error), title: source.error };
        const warnings = source.warnings || [];
        return {
            label,
            tone: warnings.length ? 'warn' : 'ok',
            value: number(source.count),
            note: warnings[0] || '',
            title: [`${plural(source.count, 'invoice')}${hasValue(source.seconds) ? ` in ${source.seconds}s` : ''}`, ...warnings].join(' · '),
        };
    });
    const targetsStatus = state.targetInputsStatus;
    const targetCount = Object.keys(state.targetInputs || {}).length;
    const targetsRow = targetsStatus === 'error'
        ? { label: 'Target MRR', tone: 'error', value: 'Failed', note: 'Database unavailable', title: state.targetInputsError || '' }
        : targetsStatus === 'ready'
            ? { label: 'Target MRR', tone: 'ok', value: number(targetCount), note: '', title: `${number(targetCount)} Target MRR ${targetCount === 1 ? 'entry' : 'entries'} in the database` }
            : { label: 'Target MRR', tone: 'loading', value: '…', note: '', title: 'Loading from the database' };
    const margin = state.marginInputsStatus;
    const entries = Object.keys(state.marginInputs || {}).length;
    rows.push(margin === 'error'
        ? { label: 'Saved figures', tone: 'error', value: 'Failed', note: 'Database unavailable', title: state.marginInputsError || '' }
        : margin === 'ready'
            ? { label: 'Saved figures', tone: 'ok', value: number(entries), note: '', title: `${number(entries)} manual ${entries === 1 ? 'entry' : 'entries'} in the database` }
            : { label: 'Saved figures', tone: 'loading', value: '…', note: '', title: 'Loading from the database' });
    rows.push(targetsRow);

    $('#sync-sources').innerHTML = rows.map((row) => `<li data-tone="${row.tone}" title="${escapeHtml(row.title)}"><span class="sync-source-name">${escapeHtml(row.label)}</span><span class="sync-source-value">${escapeHtml(row.value)}</span>${row.note ? `<small>${escapeHtml(row.note)}</small>` : ''}</li>`).join('');
}

function sourceErrorNotice(errors) {
    const failed = Object.keys(state.sync.sources).filter((key) => state.sync.sources[key].error);
    if (!failed.length) return errors.join(' · ');
    const names = listNames(failed.map((key) => companyLabels[key] || key));
    const reasons = failed.map((key) => `${companyLabels[key] || key}: ${state.sync.sources[key].error}`).join(' · ');
    return `${names} could not be loaded, so the figures below leave ${failed.length === 1 ? 'it' : 'them'} out. Details: ${reasons}`;
}

async function loadInvoices() {
    if (state.sync.phase === 'loading' && state.sync.inFlight) return;
    state.sync.phase = 'loading';
    state.sync.inFlight = true;
    state.sync.startedAt = Date.now();
    $('#refresh-button').disabled = true;
    renderSyncStatus();
    try {
        const response = await fetch('api.php?source=all', { cache: 'no-store' });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data) {
            throw new Error(data && Array.isArray(data.errors) && data.errors.length ? data.errors.join(' · ') : `The dashboard server answered HTTP ${response.status}`);
        }
        state.invoices = Array.isArray(data.invoices) ? data.invoices : [];
        state.sourceTypeCounts = data.sourceTypeCounts || {};
        state.categoryCounts = data.categoryCounts || {};
        const errors = Array.isArray(data.errors) ? data.errors : [];
        const sourceErrors = data.sourceErrors || {};
        const legacyErrors = !data.sourceErrors;
        state.sync.sources = {};
        Object.entries(data.sourceCounts || {}).forEach(([key, count]) => {
            const legacy = legacyErrors ? errors.find((message) => message.startsWith(`${companyLabels[key]}:`)) : null;
            state.sync.sources[key] = {
                count: Number(count) || 0,
                error: sourceErrors[key] || (legacy ? legacy.slice(companyLabels[key].length + 1).trim() : null),
                warnings: (data.sourceWarnings || {})[key] || [],
                seconds: (data.sourceSeconds || {})[key],
            };
        });
        state.sync.phase = 'done';
        state.sync.error = null;
        state.sync.finishedAt = Date.now();

        const notice = $('#error-notice');
        delete notice.dataset.dynamic;
        const currentPeriodHasInvoices = filteredInvoices().length > 0;
        const shouldShowAvailableData = !state.periodFromUrl && state.period === 'current' && state.invoices.length > 0 && !currentPeriodHasInvoices;
        if (shouldShowAvailableData) {
            state.period = 'all';
            $('#period-select').value = 'all';
        }
        notice.textContent = errors.length
            ? sourceErrorNotice(errors)
            : shouldShowAvailableData
                ? 'No client invoices were issued in the current month, so the dashboard is showing every invoice it fetched.'
                : '';
        notice.classList.toggle('is-hidden', !notice.textContent);
        notice.classList.toggle('is-info', errors.length === 0 && shouldShowAvailableData);
        renderAll();
    } catch (error) {
        state.sync.phase = 'failed';
        state.sync.error = error.message;
        const notice = $('#error-notice');
        delete notice.dataset.dynamic;
        notice.classList.remove('is-info');
        notice.textContent = state.sync.finishedAt
            ? `Refresh failed, the figures below are from the previous load. ${error.message}`
            : `Could not load invoices. ${error.message}`;
        notice.classList.remove('is-hidden');
    } finally {
        state.sync.inFlight = false;
        $('#refresh-button').disabled = false;
        renderSyncStatus();
    }
}

setInterval(() => { if (state.sync.phase === 'loading' || state.sync.finishedAt) renderSyncStatus(); }, 1000);

function renderMetrics(invoices) {
    const totals = { paid: 0, late: 0, open: 0, paidCount: 0, lateCount: 0, openCount: 0 };
    invoices.forEach((invoice) => { const bucket = invoiceBucket(invoice); if (bucket === 'paid') { totals.paid += amount(invoice); totals.paidCount++; } if (bucket === 'late') { totals.late += amount(invoice); totals.lateCount++; } if (bucket === 'open') { totals.open += amount(invoice); totals.openCount++; } });
    $('#paid-total').textContent = money(totals.paid); $('#late-total').textContent = money(totals.late); $('#open-total').textContent = money(totals.open);
    const totalCount = totals.paidCount + totals.lateCount + totals.openCount;
    const voidedCount = invoices.filter((invoice) => invoiceBucket(invoice) === 'voided').length;
    $('#all-total').textContent = money(totals.paid + totals.late + totals.open);
    $('#all-count').textContent = `${number(totalCount)} invoice${totalCount === 1 ? '' : 's'}`;
    $('#all-note').textContent = voidedCount ? `issued, ${number(voidedCount)} voided excluded` : 'issued in period';
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

function renderMrr() { const series = monthSeries(); const selectedInvoices = filteredInvoices(); const selected = selectedInvoices.reduce((sum, invoice) => sum + amount(invoice), 0); $('#mrr-total').textContent = money(selected); $('#mrr-label').textContent = periodBounds().label; if (state.mrrChart) state.mrrChart.destroy(); state.mrrChart = new Chart($('#mrr-chart'), { type: 'bar', data: { labels: series.labels, datasets: [{ data: series.values, backgroundColor: series.values.map((_, index) => index === series.values.length - 1 ? colors.authorised : '#d9d8d0'), borderRadius: 2, barPercentage: .58 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => ` ${money(context.raw)}` } } }, scales: { x: { grid: { display: false }, ticks: { color: '#7b827d', font: { family: 'DM Mono', size: 10 } } }, y: { beginAtZero: true, grid: { color: '#e5e3dc' }, ticks: { color: '#7b827d', font: { family: 'DM Mono', size: 9 }, callback: (value) => money(value) } } } } }); $('#mrr-empty').classList.toggle('is-hidden', series.values.length > 0); $('#mrr-breakdown').innerHTML = Object.entries(companyLabels).map(([key, label]) => { const total = selectedInvoices.filter((invoice) => invoice.companyKey === key).reduce((sum, invoice) => sum + amount(invoice), 0); const dimmed = state.scope !== 'all' && state.scope !== key; return `<div class="breakdown-item${dimmed ? ' is-dimmed' : ''}"><span>${label}</span><strong>${money(total)}</strong></div>`; }).join(''); }

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character])); }
function renderAll() { renderOverview(); renderMrr(); renderScorecard(); syncViewToUrl(); }

$('#period-select').addEventListener('change', (event) => { state.period = event.target.value; state.periodFromUrl = true; $('#date-range').hidden = state.period !== 'custom'; renderAll(); });
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
    state.periodFromUrl = true;
    $('#period-select').value = 'custom';
    $('#error-notice').classList.add('is-hidden');
    renderAll();
});
$('#refresh-button').addEventListener('click', loadInvoices);
document.querySelectorAll('.scope-tab').forEach((button) => button.addEventListener('click', () => { state.scope = button.dataset.scope; document.querySelectorAll('.scope-tab').forEach((item) => item.classList.toggle('is-active', item.dataset.scope === state.scope)); renderAll(); }));
document.querySelectorAll('.category-tab').forEach((button) => button.addEventListener('click', () => { state.category = button.dataset.category; document.querySelectorAll('.category-tab').forEach((item) => item.classList.toggle('is-active', item.dataset.category === state.category)); renderAll(); }));
document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('is-active')); button.classList.add('is-active'); document.querySelectorAll('.view').forEach((view) => view.classList.remove('is-visible')); $(`#${button.dataset.view}-view`).classList.add('is-visible'); $('#page-title').textContent = button.dataset.title || button.textContent.trim(); }));

const VIEW_PERIODS = ['current', 'previous', 'two-previous', 'quarter', 'all', 'custom'];
const VIEW_SCOPES = ['all', ...Object.keys(companyLabels)];
const VIEW_CATEGORIES = ['all', ...Object.keys(categoryLabels)];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function applyViewControls() {
    document.querySelectorAll('.scope-tab').forEach((item) => item.classList.toggle('is-active', item.dataset.scope === state.scope));
    document.querySelectorAll('.category-tab').forEach((item) => item.classList.toggle('is-active', item.dataset.category === state.category));
    $('#period-select').value = state.period;
    $('#date-from').value = state.customStart;
    $('#date-to').value = state.customEnd;
    $('#date-range').hidden = state.period !== 'custom';
}

function restoreViewFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const period = params.get('period');
    const scope = params.get('scope');
    const category = params.get('category');
    const from = params.get('from') || '';
    const to = params.get('to') || '';
    if (VIEW_SCOPES.includes(scope)) state.scope = scope;
    if (VIEW_CATEGORIES.includes(category)) state.category = category;
    if (period === 'custom') {
        if (ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to) {
            state.period = 'custom';
            state.customStart = from;
            state.customEnd = to;
            state.periodFromUrl = true;
        }
    } else if (VIEW_PERIODS.includes(period)) {
        state.period = period;
        state.periodFromUrl = true;
    }
    applyViewControls();
}

function syncViewToUrl() {
    const params = new URLSearchParams(window.location.search);
    params.set('scope', state.scope);
    params.set('category', state.category);
    if (state.periodFromUrl) params.set('period', state.period); else params.delete('period');
    if (state.periodFromUrl && state.period === 'custom') { params.set('from', state.customStart); params.set('to', state.customEnd); }
    else { params.delete('from'); params.delete('to'); }
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) history.replaceState(null, '', url);
}

restoreViewFromUrl();
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

const USE_DEMO_TARGETS = false;
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
function inScopeBillable() { return state.invoices.filter((invoice) => isBillable(invoice) && (state.scope === 'all' || invoice.companyKey === state.scope)); }
function scopedInvoices() { return inScopeBillable().filter(inCategory); }
const SERVICE_LINES = ['seo', 'ppc', 'other'];
function linesInView() { return state.category === 'all' ? SERVICE_LINES : [state.category]; }
function lineAmount(invoice, line) {
    const shares = invoice.categoryShares;
    if (!shares) return line === 'other' ? fullAmount(invoice) : 0;
    return fullAmount(invoice) * (Number(shares[line]) || 0);
}
function upsellAmount(invoice, line) {
    if (invoice.upsellShares) return fullAmount(invoice) * (Number(invoice.upsellShares[line]) || 0);
    return invoice.flags && invoice.flags.upsell ? lineAmount(invoice, line) : 0;
}
function totalsByContactLine(invoices) {
    const map = new Map();
    invoices.forEach((invoice) => {
        const key = contactKey(invoice);
        if (!map.has(key)) map.set(key, new Map());
        const lines = map.get(key);
        linesInView().forEach((line) => {
            const value = lineAmount(invoice, line);
            const tagged = upsellAmount(invoice, line);
            if (!value && !tagged) return;
            const entry = lines.get(line) || { value: 0, tagged: 0 };
            entry.value += value;
            entry.tagged += tagged;
            lines.set(line, entry);
        });
    });
    return map;
}
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
        target: resolveTarget(monthKey(month.start), state.scope, state.category)?.totalMrrTarget ?? null,
    }));
}

function buildScorecard() {
    const manual = USE_DEMO_TARGETS ? DEMO_MANUAL_INPUTS : MANUAL_INPUTS;
    const scorecard = {
        retention: { initialPortfolio: null, churned: null, upsells: null, retained: null, target: manual.retentionTarget, activeClients: null },
        newBusiness: { actual: null, target: manual.newBusinessTarget },
        totalMrr: { actual: null, target: manual.totalMrrTarget, accumulatedGap: manual.accumulatedGap, history: [] },
        cogs: { actual: manual.cogs, target: manual.cogsTarget },
        margin: { current: manual.margin, target: manual.marginTarget, bonusPool: manual.bonusPool },
    };
    const meta = { invoiceCount: 0, markedFirstMonth: 0, markedUpsell: 0, taggedUpsell: 0, crossSells: 0, upsellOutsideBase: 0, reactivated: null, newClients: 0, lostClients: 0, detection: 'none' };

    const invoices = scopedInvoices();
    const windows = scorecardWindows(invoices);
    state.scorecardMeta = meta;

    const targetWindow = windows ? windows.current : fixedWindow();
    const targets = targetWindow ? targetsForWindow(targetWindow) : null;
    meta.targets = targets;
    if (targets) {
        if (hasValue(targets.totalMrrTarget)) scorecard.totalMrr.target = targets.totalMrrTarget;
    }

    const singleMonth = selectedSingleMonth();
    const entry = singleMonth ? marginEntryFor(monthKey(singleMonth), invoices) : null;
    const aggregate = singleMonth ? null : aggregateMarginEntries(marginEntriesInPeriod(invoices), invoices);
    meta.marginEntry = entry;
    meta.marginAggregate = aggregate;
    meta.marginMonth = singleMonth;
    if (entry) {
        scorecard.cogs = { actual: entry.cogs, target: entry.cogsTarget };
        if ('revenue' in entry) scorecard.cogs.revenue = entry.revenue;
        scorecard.margin = { current: entry.margin, target: entry.marginTarget, bonusPool: entry.bonusPool };
    } else if (aggregate) {
        scorecard.cogs = { actual: aggregate.cogs, target: aggregate.cogsTarget, revenue: aggregate.revenue };
        scorecard.margin = { current: aggregate.margin, target: aggregate.marginTarget, bonusPool: aggregate.bonusPool };
    }

    if (!windows) { state.scorecard = scorecard; return; }

    meta.currentLabel = windows.current.label;
    meta.previousLabel = windows.previous.label;
    meta.priorLabel = windows.beforePrevious.label;

    const everyLine = inScopeBillable();
    const current = invoices.filter((invoice) => inWindow(invoiceDate(invoice), windows.current));
    const previous = invoices.filter((invoice) => inWindow(invoiceDate(invoice), windows.previous));
    const currentByContact = totalsByContact(current);
    const baseContacts = new Set(everyLine.filter((invoice) => inWindow(invoiceDate(invoice), windows.previous)).map(contactKey));
    const currentLines = totalsByContactLine(current);
    const previousLines = totalsByContactLine(previous);

    const firstSeen = new Map();
    let datasetStart = null;
    everyLine.forEach((invoice) => {
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
        if (invoice.flags && invoice.flags.upsell) {
            meta.markedUpsell += 1;
            if (!baseContacts.has(contactKey(invoice))) meta.upsellOutsideBase += 1;
        }
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

    let initial = 0;
    let churned = 0;
    let expansion = 0;
    let retained = 0;
    baseContacts.forEach((key) => {
        const before = previousLines.get(key) || new Map();
        const after = currentLines.get(key) || new Map();
        let beforeTotal = 0;
        let afterTotal = 0;
        linesInView().forEach((line) => {
            const previousValue = before.get(line)?.value || 0;
            const currentValue = after.get(line)?.value || 0;
            const tagged = Math.min(after.get(line)?.tagged || 0, currentValue);
            const delta = currentValue - previousValue;
            const up = Math.max(delta, 0, tagged);
            expansion += up;
            churned += up - delta;
            if (tagged > 0) meta.taggedUpsell += tagged;
            if (line !== 'other' && previousValue <= 0 && currentValue > 0) meta.crossSells += 1;
            beforeTotal += previousValue;
            afterTotal += currentValue;
        });
        initial += beforeTotal;
        retained += afterTotal;
        if (beforeTotal > 0 && Math.abs(afterTotal) < 0.005) meta.lostClients += 1;
    });

    let newBusiness = 0;
    let reactivated = 0;
    currentByContact.forEach((value, key) => {
        if (baseContacts.has(key)) return;
        if (newContacts.has(key)) { newBusiness += value; meta.newClients += 1; } else { reactivated += value; }
    });

    const hasBase = baseContacts.size > 0;
    scorecard.retention.initialPortfolio = hasBase ? initial : null;
    scorecard.retention.churned = hasBase ? churned : null;
    scorecard.retention.upsells = hasBase ? expansion : null;
    scorecard.retention.retained = hasBase ? retained : null;
    scorecard.retention.activeClients = currentByContact.size;

    scorecard.newBusiness.actual = newBusiness;
    scorecard.totalMrr.actual = current.reduce((sum, invoice) => sum + amount(invoice), 0);
    if (hasValue(scorecard.totalMrr.target)) {
        scorecard.newBusiness.target = Math.max(0, Number(scorecard.totalMrr.target) - scorecard.totalMrr.actual);
    }
    scorecard.totalMrr.history = monthlyHistory(invoices, windows.current.start);
    const carried = accumulatedGap(invoices, windows.current.end);
    meta.accumulated = carried;
    if (carried) scorecard.totalMrr.accumulatedGap = carried.gap;

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

function targetBlock({ caption, value, target, note, lowerIsBetter = false, format = 'money', naLabel = DASH, targetLabel = 'Target' }) {
    if (!hasValue(value) && !hasValue(target)) {
        return `<p class="empty-line">Waiting for data</p>`;
    }
    const isPercent = format === 'percent';
    const show = (input) => (hasValue(input) ? (isPercent ? percentOr(input, 2) : moneyOr(input)) : naLabel);
    const progress = share(value, target);
    const width = hasValue(progress) ? clampPercent(progress * 100) : 0;
    const gap = hasValue(value) && hasValue(target) ? Number(value) - Number(target) : null;
    const complete = lowerIsBetter ? hasValue(gap) && gap <= 0 : hasValue(gap) && gap >= 0;
    const scaleLeft = !hasValue(target)
        ? 'No target set'
        : !hasValue(progress)
            ? `To target <strong>${naLabel}</strong>`
            : isPercent
                ? `To target <strong>${percentOr(progress, 2)}</strong>`
                : gap >= 0
                    ? `To Target <strong>Target met</strong>`
                    : `To Target <strong>${moneyOr(-gap)}</strong>`;
    return `
        <span class="target-caption">${escapeHtml(caption)}</span>
        <span class="target-value">${show(value)}</span>
        <div class="target-track"><span class="target-fill${complete ? ' is-complete' : ''}" style="width:${width}%"></span></div>
        <div class="target-scale"><span>${scaleLeft}</span><span>${escapeHtml(targetLabel)} <strong>${show(target)}</strong></span></div>
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
    setText('#ret-upsell-note', upsellNote(meta));

    const rows = [
        { label: 'Initial portfolio value', hint: meta.previousLabel ? `Billed in ${meta.previousLabel}` : 'Previous period', value: data.initialPortfolio, tone: '', signed: false },
        { label: 'Churned value', hint: 'Lost clients and downgrades', value: hasValue(data.churned) ? -Number(data.churned) : null, tone: 'is-negative', signed: true },
        { label: 'Upsells & cross-sells', hint: meta.taggedUpsell > 0 ? `${money(meta.taggedUpsell)} tagged in Xero, rest from growth per service line` : 'Growth per client and service line', value: data.upsells, tone: 'is-positive', signed: true },
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

    const retentionRate = share(retained, data.initialPortfolio);
    const grossRate = hasValue(data.churned) ? share(Number(data.initialPortfolio) - Number(data.churned), data.initialPortfolio) : null;
    $('#retention-target').innerHTML = targetBlock({
        caption: 'Retention (existing)',
        value: retentionRate,
        target: data.target,
        format: 'percent',
        naLabel: 'N/A',
        note: hasValue(retentionRate)
            ? `The ${meta.previousLabel || 'previous'} base is worth ${moneyOr(retained)} now, against ${moneyOr(data.initialPortfolio)} before. Without upsells: ${percentOr(grossRate)}.`
            : 'Needs billing in the previous period to compare.',
    });
}

function upsellNote(meta) {
    const parts = [];
    if (meta.taggedUpsell > 0) parts.push(`${money(meta.taggedUpsell)} tagged in Xero`);
    if (meta.crossSells > 0) parts.push(`${plural(meta.crossSells, 'new service line')} on existing clients`);
    if (meta.upsellOutsideBase > 0) parts.push(`${plural(meta.upsellOutsideBase, 'upsell invoice')} for clients not billed in ${meta.previousLabel || 'the previous period'}`);
    return parts.length ? parts.join(' · ') : 'Measured by value change';
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
        caption: 'New Business (MRR)',
        targetLabel: 'Target New Business (MRR)',
        value: newBusiness.actual,
        target: newBusiness.target,
        note: hasValue(newBusiness.target) ? `Target MRR minus Total MRR. ${detectionNote}` : `Set the Target MRR to derive this target. ${detectionNote}`,
    });

    $('#totalmrr-target').innerHTML = targetBlock({
        caption: 'Total MRR',
        targetLabel: 'Target MRR',
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
    setText('#mrr-accumulated-note', meta.accumulated
        ? `Actual minus target, ${meta.accumulated.from} to ${meta.accumulated.to} (${plural(meta.accumulated.months, 'month')} with a target)`
        : 'Set monthly Total MRR targets to track this');
    renderTargetInputStatus();

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
    setText('#cogs-share', percentOr(share(cogs.actual, 'revenue' in cogs ? cogs.revenue : totalMrr.actual)));
    setText('#cogs-difference', hasValue(cogsDifference) ? signedMoney(cogsDifference) : DASH);
    $('#cogs-difference').className = hasValue(cogsDifference) ? (cogsDifference <= 0 ? 'value-up' : 'value-down') : '';

    const gap = hasValue(margin.current) && hasValue(margin.target) ? Number(margin.current) - Number(margin.target) : null;
    setText('#margin-gap-meta', hasValue(gap) ? `${signedPoints(gap)} vs target` : 'No target set');
    $('#margin-gauge').innerHTML = marginGauge(margin.current, margin.target);

    setText('#bonus-pool', moneyOr(margin.bonusPool));
    setText('#bonus-gap', signedPoints(gap));
    setText('#bonus-status', hasValue(gap) ? (gap >= 0 ? 'Unlocked' : 'Below target') : DASH);
    renderMarginInputStatus();
    renderMarginEntriesTable();

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
state.marginInputsStatus = 'loading';
const MARGIN_ENDPOINT = 'margin-inputs.php';

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

function selectedSingleMonth() {
    const { start, end } = periodBounds();
    return start && end && isCalendarMonth(start, end) ? start : null;
}

function marginEntryFor(month, invoices) {
    const exact = state.marginInputs[marginInputKey(month, state.scope, state.category)];
    if (exact || state.category !== 'all') return exact || null;
    const parts = Object.keys(categoryLabels)
        .map((category) => state.marginInputs[marginInputKey(month, state.scope, category)])
        .filter(Boolean);
    return parts.length ? combineServiceLines(month, parts, invoices) : null;
}

function combineServiceLines(month, parts, invoices) {
    const revenue = {};
    invoices.forEach((invoice) => {
        const date = invoiceDate(invoice);
        if (!date || monthKey(date) !== month) return;
        parts.forEach((part) => {
            revenue[part.category] = (revenue[part.category] || 0) + fullAmount(invoice) * categoryShare(invoice, part.category);
        });
    });
    const revenueOf = (part) => revenue[part.category] || 0;
    const sum = (field) => {
        const rows = parts.filter((part) => hasValue(part[field]));
        return rows.length ? rows.reduce((total, part) => total + Number(part[field]), 0) : null;
    };
    const weighted = (field) => {
        const rows = parts.filter((part) => hasValue(part[field]));
        if (!rows.length) return null;
        const weight = rows.reduce((total, part) => total + revenueOf(part), 0);
        if (weight > 0) return rows.reduce((total, part) => total + Number(part[field]) * revenueOf(part), 0) / weight;
        return rows.reduce((total, part) => total + Number(part[field]), 0) / rows.length;
    };
    const cogsRevenue = parts.filter((part) => hasValue(part.cogs)).reduce((total, part) => total + revenueOf(part), 0);
    return {
        month,
        scope: state.scope,
        category: 'all',
        cogs: sum('cogs'),
        cogsTarget: sum('cogsTarget'),
        margin: weighted('margin'),
        marginTarget: weighted('marginTarget'),
        bonusPool: sum('bonusPool'),
        revenue: cogsRevenue > 0 ? cogsRevenue : null,
        combinedFrom: parts.map((part) => part.category),
        enteredAt: parts.map((part) => part.enteredAt).filter(Boolean).sort().pop() || null,
    };
}

function marginEntriesInPeriod(invoices) {
    const { start, end } = periodBounds();
    const from = start ? monthKey(start) : null;
    const to = end ? monthKey(end) : null;
    const months = new Set(Object.values(state.marginInputs)
        .filter((entry) => entry.scope === state.scope)
        .filter((entry) => state.category === 'all' || entry.category === state.category)
        .map((entry) => entry.month)
        .filter((month) => (!from || month >= from) && (!to || month <= to)));
    return [...months].sort()
        .map((month) => marginEntryFor(month, invoices))
        .filter(Boolean);
}

function aggregateMarginEntries(entries, invoices) {
    if (!entries.length) return null;
    const revenueByMonth = new Map();
    invoices.forEach((invoice) => {
        const date = invoiceDate(invoice);
        if (!date) return;
        const key = monthKey(date);
        revenueByMonth.set(key, (revenueByMonth.get(key) || 0) + amount(invoice));
    });
    const revenueOf = (entry) => revenueByMonth.get(entry.month) || 0;
    const sum = (field) => {
        const rows = entries.filter((entry) => hasValue(entry[field]));
        return rows.length ? rows.reduce((total, entry) => total + Number(entry[field]), 0) : null;
    };
    const weighted = (field) => {
        const rows = entries.filter((entry) => hasValue(entry[field]));
        if (!rows.length) return null;
        const weight = rows.reduce((total, entry) => total + revenueOf(entry), 0);
        if (weight > 0) return rows.reduce((total, entry) => total + Number(entry[field]) * revenueOf(entry), 0) / weight;
        return rows.reduce((total, entry) => total + Number(entry[field]), 0) / rows.length;
    };
    const cogsRows = entries.filter((entry) => hasValue(entry.cogs));
    const revenue = cogsRows.reduce((total, entry) => total + ('revenue' in entry ? Number(entry.revenue) || 0 : revenueOf(entry)), 0);
    return {
        cogs: sum('cogs'),
        cogsTarget: sum('cogsTarget'),
        margin: weighted('margin'),
        marginTarget: weighted('marginTarget'),
        bonusPool: sum('bonusPool'),
        revenue: revenue > 0 ? revenue : null,
        months: entries.map((entry) => entry.month),
        combinedFrom: [...new Set(entries.flatMap((entry) => entry.combinedFrom || []))],
        enteredAt: entries.map((entry) => entry.enteredAt).filter(Boolean).sort().pop() || null,
    };
}

async function marginRequest(options = {}) {
    const response = await fetch(MARGIN_ENDPOINT, { cache: 'no-store', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `The server answered HTTP ${response.status}.`);
    return body;
}

function storeMarginEntry(entry) {
    state.marginInputs[marginInputKey(entry.month, entry.scope, entry.category)] = entry;
}

async function loadMarginInputs() {
    state.marginInputsStatus = 'loading';
    renderMarginInputStatus();
    try {
        const { entries = [] } = await marginRequest();
        state.marginInputs = {};
        entries.forEach(storeMarginEntry);
        state.marginInputsStatus = 'ready';
    } catch (error) {
        state.marginInputsStatus = 'error';
        state.marginInputsError = error.message;
    }
    renderScorecard();
    renderSyncStatus();
}

async function saveMarginInput(entry) {
    const { entry: saved } = await marginRequest({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
    });
    storeMarginEntry(saved);
    return saved;
}

function renderMarginInputStatus() {
    const meta = state.scorecardMeta || {};
    const node = $('#margin-input-status');
    if (!node) return;
    if (state.marginInputsStatus === 'loading') { node.textContent = 'Loading saved figures…'; node.dataset.tone = 'muted'; return; }
    if (state.marginInputsStatus === 'error') { node.textContent = `Could not load saved figures: ${state.marginInputsError}`; node.dataset.tone = 'error'; return; }
    const context = `${companyLabels[state.scope] || 'Global'}, ${state.category === 'all' ? 'all services' : categoryLabels[state.category]}`;
    if (meta.marginEntry) {
        const saved = new Date(meta.marginEntry.enteredAt).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        node.textContent = `Figures saved for ${monthLabel(monthFromKey(meta.marginEntry.month))} (${context}), last updated ${saved}.${combinedNote(meta.marginEntry)}`;
        node.dataset.tone = 'manual';
    } else if (meta.marginAggregate) {
        const months = meta.marginAggregate.months;
        const range = months.length === 1
            ? monthLabel(monthFromKey(months[0]))
            : `${months.length} months, ${monthLabel(monthFromKey(months[0]))} to ${monthLabel(monthFromKey(months[months.length - 1]))}`;
        node.textContent = `Figures saved for ${range} (${context}). COGS and bonus pool are summed; margins are weighted by revenue.${combinedNote(meta.marginAggregate)}`;
        node.dataset.tone = 'manual';
    } else if (!meta.marginMonth) {
        node.textContent = `No figures saved in this period (${context}).`;
        node.dataset.tone = 'muted';
    } else {
        node.textContent = `Nothing entered for ${monthLabel(meta.marginMonth)} (${context}) yet.${USE_DEMO_TARGETS ? ' Showing sample figures.' : ''}`;
        node.dataset.tone = USE_DEMO_TARGETS ? 'sample' : 'muted';
    }
    appendSavedEntryLinks(node, meta);
}

function combinedNote(figures) {
    const parts = (figures && figures.combinedFrom) || [];
    return parts.length ? ` Combined from ${parts.map((key) => categoryLabels[key]).join(' + ')} entries.` : '';
}

function appendSavedEntryLinks(node, meta) {
    if (meta.marginEntry || meta.marginAggregate) return;
    const month = meta.marginMonth ? monthKey(meta.marginMonth) : null;
    const entries = Object.values(state.marginInputs)
        .sort((a, b) => (a.month === month ? 0 : 1) - (b.month === month ? 0 : 1) || b.month.localeCompare(a.month))
        .slice(0, 4);
    if (!entries.length) return;
    const wrap = document.createElement('span');
    wrap.className = 'saved-entry-links';
    wrap.append(' Saved figures: ');
    entries.forEach((entry, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'link-button';
        button.textContent = `${monthLabel(monthFromKey(entry.month))} · ${companyLabels[entry.scope] || 'Global'} · ${entry.category === 'all' ? 'All services' : categoryLabels[entry.category]}`;
        button.addEventListener('click', () => showMarginEntry(entry));
        if (index) wrap.append(' · ');
        wrap.append(button);
    });
    node.append(wrap);
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

function openMarginModal(entry = null) {
    const meta = state.scorecardMeta || {};
    marginForm.reset();
    showMarginError('');
    marginForm.elements.month.value = entry ? entry.month : monthKey(meta.marginMonth || new Date());
    marginForm.elements.scope.value = entry ? entry.scope : state.scope;
    marginForm.elements.category.value = entry ? entry.category : state.category;
    fillMarginValues(null);
    loadMarginEntryIntoForm();
    marginModal.showModal();
}

function closeMarginModal() { marginModal.close(); $('#open-margin-modal').focus(); }

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

function showMarginEntry(entry) {
    state.scope = entry.scope;
    state.category = entry.category;
    state.periodFromUrl = true;

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
    }
    applyViewControls();
    renderAll();
}

state.marginEntriesMode = 'all';

function entryInView(entry) {
    const { start, end } = periodBounds();
    return entry.scope === state.scope
        && (state.category === 'all' || entry.category === state.category)
        && (!start || entry.month >= monthKey(start))
        && (!end || entry.month <= monthKey(end));
}

function formatEnteredAt(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime())
        ? date.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : DASH;
}

function renderMarginEntriesTable() {
    const body = $('#margin-entries-table');
    const empty = $('#margin-entries-empty');
    if (!body || !empty) return;
    const all = Object.values(state.marginInputs).sort((a, b) => b.month.localeCompare(a.month)
        || VIEW_SCOPES.indexOf(a.scope) - VIEW_SCOPES.indexOf(b.scope)
        || VIEW_CATEGORIES.indexOf(a.category) - VIEW_CATEGORIES.indexOf(b.category));
    const rows = state.marginEntriesMode === 'view' ? all.filter(entryInView) : all;
    const inViewCount = all.filter(entryInView).length;

    const entriesLabel = (count) => `${number(count)} ${count === 1 ? 'entry' : 'entries'}`;
    setText('#margin-entries-summary', state.marginEntriesMode === 'view'
        ? `${entriesLabel(rows.length)} of ${number(all.length)}`
        : `${entriesLabel(all.length)} · ${number(inViewCount)} used in current view`);

    body.innerHTML = rows.map((entry) => {
        const key = marginInputKey(entry.month, entry.scope, entry.category);
        const used = state.marginEntriesMode === 'all' && entryInView(entry);
        return `<tr class="${used ? 'is-in-view' : ''}"${used ? ' title="Used by the current view"' : ''}>
            <td>${escapeHtml(monthLabel(monthFromKey(entry.month)))}</td>
            <td>${escapeHtml(companyLabels[entry.scope] || 'Global')}</td>
            <td>${escapeHtml(entry.category === 'all' ? 'All services' : categoryLabels[entry.category] || entry.category)}</td>
            <td class="align-right mono">${moneyOr(entry.cogs)}</td>
            <td class="align-right mono">${moneyOr(entry.cogsTarget)}</td>
            <td class="align-right mono">${percentOr(entry.margin)}</td>
            <td class="align-right mono">${percentOr(entry.marginTarget)}</td>
            <td class="align-right mono">${moneyOr(entry.bonusPool)}</td>
            <td class="entry-date">${escapeHtml(formatEnteredAt(entry.enteredAt))}</td>
            <td class="align-right entry-actions"><button type="button" class="row-button" data-entry-show="${escapeHtml(key)}">Show</button><button type="button" class="row-button" data-entry-edit="${escapeHtml(key)}">Edit</button></td>
        </tr>`;
    }).join('');

    let message = '';
    if (state.marginInputsStatus === 'loading') message = 'Loading saved entries…';
    else if (state.marginInputsStatus === 'error') message = `Could not load saved entries: ${state.marginInputsError}`;
    else if (!all.length) message = 'No figures have been entered yet. Use "Enter COGS & margin" to add the first one.';
    else if (!rows.length) message = 'No saved entry matches the current market, service and period.';
    empty.textContent = message;
    empty.classList.toggle('is-hidden', !message || rows.length > 0);
}

document.querySelectorAll('.entries-tab').forEach((button) => button.addEventListener('click', () => {
    state.marginEntriesMode = button.dataset.entries;
    document.querySelectorAll('.entries-tab').forEach((item) => item.classList.toggle('is-active', item === button));
    renderMarginEntriesTable();
}));

$('#margin-entries-table').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const entry = state.marginInputs[button.dataset.entryShow || button.dataset.entryEdit];
    if (!entry) return;
    if (button.dataset.entryEdit) openMarginModal(entry);
    else { showMarginEntry(entry); $('#margin-view').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});

$('#open-margin-modal').addEventListener('click', () => openMarginModal());
marginModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeMarginModal));
marginModal.addEventListener('click', (event) => { if (event.target === marginModal) closeMarginModal(); });
['month', 'scope', 'category'].forEach((name) => marginForm.elements[name].addEventListener('change', loadMarginEntryIntoForm));
marginForm.addEventListener('input', () => { if (!$('#margin-form-error').hidden) showMarginError(''); });

marginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const entry = readMarginForm();
    if (!entry) return;
    const submit = $('#margin-form-submit');
    const label = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
        const saved = await saveMarginInput(entry);
        closeMarginModal();
        showMarginEntry(saved);
    } catch (error) {
        showMarginError(error.message || 'Could not save the figures.');
    } finally {
        submit.disabled = false;
        submit.textContent = label;
    }
});

state.targetInputs = {};
state.targetInputsStatus = 'loading';
state.targetInputsError = '';
const TARGETS_ENDPOINT = 'targets.php';
const TARGET_FIELDS = {
    totalMrrTarget: { kind: 'money' },
};
const MONEY_TARGETS = ['totalMrrTarget'];
const targetsModal = $('#targets-modal');
const targetsForm = $('#targets-form');

function fixedWindow() {
    const bounds = periodBounds();
    return bounds.start && bounds.end ? { start: bounds.start, end: bounds.end, label: bounds.label } : null;
}

function monthKeysBetween(start, end) {
    const keys = [];
    for (const cursor = new Date(start.getFullYear(), start.getMonth(), 1); cursor <= end; cursor.setMonth(cursor.getMonth() + 1)) keys.push(monthKey(cursor));
    return keys;
}

function exactTarget(month, scope, category) {
    return (state.targetInputs || {})[marginInputKey(month, scope, category)] || null;
}

function combineTargets(parts) {
    const rows = parts.filter(Boolean);
    if (!rows.length) return null;
    const combined = {
        entryCount: rows.reduce((total, row) => total + (row.entryCount || 1), 0),
        enteredAt: rows.map((row) => row.enteredAt).filter(Boolean).sort().pop() || null,
    };
    MONEY_TARGETS.forEach((field) => {
        const filled = rows.filter((row) => hasValue(row[field]));
        combined[field] = filled.length ? filled.reduce((total, row) => total + Number(row[field]), 0) : null;
    });
    return combined;
}

function resolveTarget(month, scope, category) {
    const exact = exactTarget(month, scope, category);
    if (exact) return exact;
    if (category === 'all') {
        const lines = combineTargets(Object.keys(categoryLabels).map((key) => exactTarget(month, scope, key)));
        if (lines) return lines;
    }
    if (scope === 'all') return combineTargets(Object.keys(companyLabels).map((key) => resolveTarget(month, key, category)));
    return null;
}

function targetsForWindow(window) {
    const months = monthKeysBetween(window.start, window.end);
    const found = months.map((month) => resolveTarget(month, state.scope, state.category)).filter(Boolean);
    const combined = combineTargets(found) || { totalMrrTarget: null, entryCount: 0, enteredAt: null };
    const label = isCalendarMonth(window.start, window.end) ? monthLabel(window.start) : window.label;
    return { ...combined, label, months, found: found.length };
}

function accumulatedGap(invoices, until) {
    const start = new Date(until.getFullYear(), 0, 1);
    let gap = 0;
    let months = 0;
    let first = null;
    let last = null;
    monthKeysBetween(start, until).forEach((key) => {
        const target = resolveTarget(key, state.scope, state.category)?.totalMrrTarget;
        if (!hasValue(target)) return;
        const month = monthFromKey(key);
        const window = { start: month, end: endOfMonth(month) };
        const actual = invoices.filter((invoice) => inWindow(invoiceDate(invoice), window)).reduce((sum, invoice) => sum + amount(invoice), 0);
        gap += actual - Number(target);
        months += 1;
        first = first || month;
        last = month;
    });
    return months ? { gap, months, from: monthLabel(first), to: monthLabel(last) } : null;
}

async function targetsRequest(options = {}) {
    const response = await fetch(TARGETS_ENDPOINT, { cache: 'no-store', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `The server answered HTTP ${response.status}.`);
    return body;
}

function storeTargetEntry(entry) {
    state.targetInputs[marginInputKey(entry.month, entry.scope, entry.category)] = entry;
}

async function loadTargetInputs() {
    state.targetInputsStatus = 'loading';
    renderTargetInputStatus();
    try {
        const { entries = [] } = await targetsRequest();
        state.targetInputs = {};
        entries.forEach(storeTargetEntry);
        state.targetInputsStatus = 'ready';
    } catch (error) {
        state.targetInputsStatus = 'error';
        state.targetInputsError = error.message;
    }
    renderScorecard();
    renderSyncStatus();
}

function renderTargetInputStatus() {
    const node = $('#targets-input-status');
    if (!node) return;
    if (state.targetInputsStatus === 'loading') { node.textContent = 'Loading saved Target MRR…'; node.dataset.tone = 'muted'; return; }
    if (state.targetInputsStatus === 'error') { node.textContent = `Could not load the saved Target MRR: ${state.targetInputsError}`; node.dataset.tone = 'error'; return; }
    const targets = (state.scorecardMeta || {}).targets;
    const context = `${companyLabels[state.scope] || 'Global'}, ${state.category === 'all' ? 'all services' : categoryLabels[state.category]}`;
    if (!targets) { node.textContent = `Pick a reporting period to see its Target MRR (${context}).`; node.dataset.tone = 'muted'; return; }
    if (!targets.found) {
        node.textContent = `No Target MRR saved for ${targets.label} (${context}) yet.`;
        node.dataset.tone = 'muted';
        return;
    }
    const parts = [`Target MRR for ${targets.label} (${context})`];
    if (targets.found < targets.months.length) parts.push(`cover ${targets.found} of ${targets.months.length} months, so the plan is understated`);
    if (targets.entryCount > 1) parts.push(`combined from ${number(targets.entryCount)} saved entries`);
    if (targets.enteredAt) parts.push(`last updated ${formatEnteredAt(targets.enteredAt)}`);
    node.textContent = `${parts.join(', ')}.`;
    node.dataset.tone = targets.found < targets.months.length ? 'sample' : 'manual';
}

function showTargetError(message, field) {
    const node = $('#targets-form-error');
    targetsForm.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
    node.hidden = !message;
    node.textContent = message || '';
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}

function loadTargetEntryIntoForm() {
    const { month, scope, category } = targetsForm.elements;
    const entry = month.value ? exactTarget(month.value, scope.value, category.value) : null;
    Object.keys(TARGET_FIELDS).forEach((name) => {
        const value = entry ? entry[name] : null;
        targetsForm.elements[name].value = hasValue(value) ? Number(value) : '';
    });
    const combined = !entry && month.value ? resolveTarget(month.value, scope.value, category.value) : null;
    setText('#targets-form-hint', entry
        ? `Editing the entry saved ${formatEnteredAt(entry.enteredAt)}.`
        : combined
            ? `No entry for this exact combination. The dashboard currently adds up ${number(combined.entryCount)} other ${combined.entryCount === 1 ? 'entry' : 'entries'} for it.`
            : 'New entry.');
    $('#targets-form-submit').textContent = entry ? 'Update Target MRR' : 'Save Target MRR';
}

function openTargetsModal() {
    const targets = (state.scorecardMeta || {}).targets;
    targetsForm.reset();
    showTargetError('');
    targetsForm.elements.month.value = targets && targets.months.length ? targets.months[targets.months.length - 1] : monthKey(new Date());
    targetsForm.elements.scope.value = state.scope;
    targetsForm.elements.category.value = state.category;
    loadTargetEntryIntoForm();
    targetsModal.showModal();
}

function closeTargetsModal() { targetsModal.close(); $('#open-targets-modal').focus(); }

function readTargetsForm() {
    const { elements } = targetsForm;
    if (!/^\d{4}-\d{2}$/.test(elements.month.value)) { showTargetError('Choose the month this Target MRR belongs to.', elements.month); return null; }
    const entry = { month: elements.month.value, scope: elements.scope.value, category: elements.category.value };
    for (const [name, field] of Object.entries(TARGET_FIELDS)) {
        const input = elements[name];
        const label = input.closest('.field').querySelector('span').textContent;
        if (input.value.trim() === '') {
            if (input.validity.badInput) { showTargetError(`${label} is not a valid number.`, input); return null; }
            entry[name] = null;
            continue;
        }
        const value = Number(input.value);
        if (!Number.isFinite(value)) { showTargetError(`${label} is not a valid number.`, input); return null; }
        if (field.kind === 'money' && value < 0) { showTargetError(`${label} cannot be negative.`, input); return null; }
        entry[name] = value;
    }
    if (entry.totalMrrTarget === null) {
        showTargetError('Enter the Target MRR.', elements.totalMrrTarget);
        return null;
    }
    return entry;
}

$('#open-targets-modal').addEventListener('click', openTargetsModal);
targetsModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeTargetsModal));
targetsModal.addEventListener('click', (event) => { if (event.target === targetsModal) closeTargetsModal(); });
['month', 'scope', 'category'].forEach((name) => targetsForm.elements[name].addEventListener('change', loadTargetEntryIntoForm));
targetsForm.addEventListener('input', () => { if (!$('#targets-form-error').hidden) showTargetError(''); });

targetsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const entry = readTargetsForm();
    if (!entry) return;
    const submit = $('#targets-form-submit');
    const label = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
        const { entry: saved } = await targetsRequest({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
        });
        storeTargetEntry(saved);
        closeTargetsModal();
        showMarginEntry(saved);
        renderSyncStatus();
    } catch (error) {
        showTargetError(error.message || 'Could not save the Target MRR.');
    } finally {
        submit.disabled = false;
        submit.textContent = label;
    }
});

renderScorecard();
loadMarginInputs();
loadTargetInputs();
loadMarginInputs();