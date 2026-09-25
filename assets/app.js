const state = { invoices: [], sourceTypeCounts: {}, categoryCounts: {}, scope: 'all', category: 'all', period: 'current', customStart: '', customEnd: '', statusChart: null, mrrChart: null };
const companyLabels = { br: 'Brazil', mx: 'Mexico', pa: 'Panama', int: 'International' };
const categoryLabels = { seo: 'SEO', ppc: 'PPC', others: 'Others' };
// Serviços agrupados em Others (api.php › $otherServiceRules), na ordem de prioridade.
const otherServiceLabels = { smm: 'SMM', marketing: 'Marketing', webdev: 'Web dev' };
const colors = { paid: '#57745d', late: '#d49b35', open: '#55778a', authorised: '#e84d2c', voided: '#a5a6a0' };

function redirectIfSignedOut(response) {
    if (response.status === 401) {
        window.location.href = 'login.php?expired=1';
        throw new Error('Your session has ended. Redirecting to sign in…');
    }
    return response;
}

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
function otherServicesOf(invoice) {
    return (invoice.otherServices || []).filter((key) => otherServiceLabels[key]);
}
// Célula "Service" das tabelas quando o filtro é Others: o serviço específico e, se a
// fatura mistura mais de um, a fatia de cada um dentro da parte Others.
function otherServiceCell(invoice) {
    const services = otherServicesOf(invoice);
    if (!services.length) return `<td class="service-col">${DASH}</td>`;
    const shares = invoice.otherServiceShares || {};
    const total = services.reduce((sum, key) => sum + (Number(shares[key]) || 0), 0);
    const pills = services.map((key) => {
        const part = total > 0 && services.length > 1 ? ` <small>${Math.round((Number(shares[key]) || 0) / total * 100)}%</small>` : '';
        return `<span class="service-pill is-${key}">${escapeHtml(otherServiceLabels[key])}${part}</span>`;
    }).join('');
    return `<td class="service-col">${pills}</td>`;
}
function categoryTag(invoice) {
    // Others aparece pelo nome do serviço (ex.: "SEO + SMM"), não pelo nome do grupo.
    const list = (invoice.categories || []).flatMap((key) => {
        if (key !== 'others') return [categoryLabels[key]];
        const services = otherServicesOf(invoice).map((service) => otherServiceLabels[service]);
        return services.length ? services : [categoryLabels.others];
    }).filter(Boolean);
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
        const response = redirectIfSignedOut(await fetch('api.php?source=all', { cache: 'no-store' }));
        const data = await response.json().catch(() => null);
        if (!response.ok || !data) {
            throw new Error(data && Array.isArray(data.errors) && data.errors.length ? data.errors.join(' · ') : `The dashboard server answered HTTP ${response.status}`);
        }
        state.invoices = Array.isArray(data.invoices) ? data.invoices : [];
        state.monthlyRows = null;
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
    // O card de atrasados usa a mesma regra da aba Late invoices: saldo em aberto, vencido hoje, qualquer data de emissão.
    const overdue = lateInvoices();
    const overdueCount = overdue.length;
    $('#paid-total').textContent = money(totals.paid); $('#late-total').textContent = money(overdue.reduce((sum, item) => sum + item.balance, 0)); $('#open-total').textContent = money(totals.open);
    const totalCount = totals.paidCount + totals.lateCount + totals.openCount;
    const voidedCount = invoices.filter((invoice) => invoiceBucket(invoice) === 'voided').length;
    $('#all-total').textContent = money(totals.paid + totals.late + totals.open);
    $('#all-count').textContent = `${number(totalCount)} invoice${totalCount === 1 ? '' : 's'}`;
    $('#all-note').textContent = voidedCount ? `issued, ${number(voidedCount)} voided excluded` : 'issued in period';
    $('#paid-count').textContent = `${number(totals.paidCount)} invoice${totals.paidCount === 1 ? '' : 's'}`; $('#late-count').textContent = `${number(overdueCount)} invoice${overdueCount === 1 ? '' : 's'}`; $('#open-count').textContent = `${number(totals.openCount)} invoice${totals.openCount === 1 ? '' : 's'}`;
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
    $('#invoice-table').closest('table').classList.toggle('shows-service', state.category === 'others');
    $('#invoice-table').innerHTML = invoices.map((invoice) => { const bucket = invoiceBucket(invoice); const date = invoiceDate(invoice); const due = dueDate(invoice); const statusLabel = bucket === 'late' ? 'Late' : bucket[0].toUpperCase() + bucket.slice(1); return `<tr><td>${escapeHtml(invoice.Contact?.Name || 'Unknown client')}<div class="client-sub">${escapeHtml(invoice.InvoiceNumber || invoice.InvoiceID || 'Unnumbered')}${categoryTag(invoice) ? ` · <span class="category-tag">${escapeHtml(categoryTag(invoice))}</span>` : ''}</div></td>${otherServiceCell(invoice)}<td>${companyLabels[invoice.companyKey] || invoice.company || '—'}</td><td>${date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td><td>${due ? due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td><td><span class="status-pill ${bucket}">${statusLabel}</span></td><td class="align-right">${money(amount(invoice))}</td></tr>`; }).join('');
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

function renderInvoices() {
    const invoices = filteredInvoices();
    clearDynamicNotice();
    renderMetrics(invoices);
    renderStatusChart(invoices);
    renderMarkets(invoices);
    renderTable(invoices);
    const noticeFree = $('#error-notice').classList.contains('is-hidden');
    if (state.category !== 'all' && invoices.length === 0 && noticeFree && state.invoices.length) {
        const label = categoryLabels[state.category];
        const noneYet = state.category === 'others'
            ? 'No invoice line matches SMM, Marketing or Web dev yet. Check the Xero account names, or add their wording to $otherServiceRules in api.php.'
            : `No invoice line is linked to a ${label} account yet. Check that the n8n workflow sends AccountName, or add the ${label} account codes to $categoryRules in api.php.`;
        showDynamicNotice(Number(state.categoryCounts[state.category] || 0) === 0
            ? noneYet
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
    const source = state.invoices.filter((invoice) => isBillable(invoice) && inCategory(invoice) && (state.scope === 'all' || invoice.companyKey === state.scope));
    const dates = source.map(invoiceDate).filter(Boolean).filter((date) => (!bounds.start || date >= bounds.start) && (!bounds.end || date <= bounds.end));
    if (!dates.length) return { labels: [], values: [] };
    const first = new Date(Math.min(...dates.map((date) => date.getTime()))); first.setDate(1);
    const last = new Date(Math.max(...dates.map((date) => date.getTime()))); last.setDate(1);
    const months = [];
    for (const month = new Date(first.getFullYear(), first.getMonth(), 1); month <= last; month.setMonth(month.getMonth() + 1)) months.push(new Date(month));
    return { labels: months.map(monthLabel), values: months.map((month) => source.filter((invoice) => { const date = invoiceDate(invoice); return date && date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth() && (!bounds.start || date >= bounds.start) && (!bounds.end || date <= bounds.end); }).reduce((sum, invoice) => sum + amount(invoice), 0)) };
}

function renderMrr() { const series = monthSeries(); const selectedInvoices = filteredInvoices().filter(isBillable); const selected = selectedInvoices.reduce((sum, invoice) => sum + amount(invoice), 0); $('#mrr-total').textContent = money(selected); $('#mrr-label').textContent = periodBounds().label; if (state.mrrChart) state.mrrChart.destroy(); state.mrrChart = new Chart($('#mrr-chart'), { type: 'bar', data: { labels: series.labels, datasets: [{ data: series.values, backgroundColor: series.values.map((_, index) => index === series.values.length - 1 ? colors.authorised : '#d9d8d0'), borderRadius: 2, barPercentage: .58 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => ` ${money(context.raw)}` } } }, scales: { x: { grid: { display: false }, ticks: { color: '#7b827d', font: { family: 'DM Mono', size: 10 } } }, y: { beginAtZero: true, grid: { color: '#e5e3dc' }, ticks: { color: '#7b827d', font: { family: 'DM Mono', size: 9 }, callback: (value) => money(value) } } } } }); $('#mrr-empty').classList.toggle('is-hidden', series.values.length > 0); $('#mrr-breakdown').innerHTML = Object.entries(companyLabels).map(([key, label]) => { const total = selectedInvoices.filter((invoice) => invoice.companyKey === key).reduce((sum, invoice) => sum + amount(invoice), 0); const dimmed = state.scope !== 'all' && state.scope !== key; return `<div class="breakdown-item${dimmed ? ' is-dimmed' : ''}"><span>${label}</span><strong>${money(total)}</strong></div>`; }).join(''); }

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character])); }
function renderAll() { renderInvoices(); renderLate(); renderMrr(); renderScorecard(); syncViewToUrl(); }

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
$('#refresh-button').addEventListener('click', () => { loadInvoices(); if (typeof loadAds === 'function') loadAds(); });
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
const plural = (count, word) => `${number(count)} ${count === 1 ? word : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`}`;

function setText(selector, value) { const node = $(selector); if (node) node.textContent = value; }


function contactKey(invoice) { return invoice.Contact?.ContactID || invoice.Contact?.Name || 'unknown-contact'; }
function isBillable(invoice) { return isRevenue(invoice) && !EXCLUDED_STATUSES.includes(normalStatus(invoice)); }
function inScopeBillable() { return state.invoices.filter((invoice) => isBillable(invoice) && (state.scope === 'all' || invoice.companyKey === state.scope)); }
function scopedInvoices() { return inScopeBillable().filter(inCategory); }
const SERVICE_LINES = ['seo', 'ppc', 'others', 'other'];
function linesInView() { return state.category === 'all' ? SERVICE_LINES : [state.category]; }
function lineAmount(invoice, line) {
    const shares = invoice.categoryShares;
    if (!shares) return line === 'other' ? fullAmount(invoice) : 0;
    return fullAmount(invoice) * (Number(shares[line]) || 0);
}
// Onboarding fee (primeiras parcelas de um cliente) não é receita recorrente: a retenção usa
// só o valor recorrente, para o fim da fee não aparecer como downgrade. O Total MRR não muda.
function onboardingLineAmount(invoice, line) {
    const share = Number(invoice.onboardingShares?.[line]) || 0;
    return share ? fullAmount(invoice) * share : 0;
}
function recurringLineAmount(invoice, line) { return lineAmount(invoice, line) - onboardingLineAmount(invoice, line); }
function onboardingAmount(invoice) {
    const shares = invoice.onboardingShares;
    if (!shares) return 0;
    const keys = state.category === 'all' ? Object.keys(shares) : [state.category];
    const share = keys.reduce((sum, key) => sum + (Number(shares[key]) || 0), 0);
    return share ? fullAmount(invoice) * share : 0;
}
function recurringAmount(invoice) { return amount(invoice) - onboardingAmount(invoice); }
// Período de implantação: nos primeiros meses de um cliente novo o valor varia por contrato
// (onboarding fee diluída nas 3 primeiras parcelas, serviços entrando em meses diferentes,
// meses pagos adiantados). As mudanças do 2º ao 4º mês (1→2, 2→3, 3→4) não são churn nem
// upsell: entram como novo negócio. O cliente passa a contar na retenção a partir do 5º mês.
// Exceção: quem para de faturar nesse período e não volta mais continua sendo churn (Lost).
const SETUP_MONTHS = 3;
const monthsApart = (from, to) => (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
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
            const value = recurringLineAmount(invoice, line);
            const tagged = upsellAmount(invoice, line);
            const onboarding = onboardingLineAmount(invoice, line);
            if (!value && !tagged && !onboarding) return;
            const entry = lines.get(line) || { value: 0, tagged: 0, onboarding: 0 };
            entry.value += value;
            entry.tagged += tagged;
            entry.onboarding += onboarding;
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

    // Sem início e fim (ex.: "All available"), a comparação usa só o último mês com invoices.
    const current = { start, end, label, latestOnly: !bounds.start || !bounds.end };
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

// Dados pré-calculados de um recorte (mercado + serviço): usados pelo scorecard e pelas tabelas mensais.
// Depende de state.scope / state.category, como o resto do scorecard.
function metricContext(invoices) {
    const everyLine = inScopeBillable();
    const byMonth = groupByMonth(invoices);
    const everyByMonth = groupByMonth(everyLine);
    const firstSeen = new Map();
    const billedMonths = new Map();
    let datasetStart = null;
    everyLine.forEach((invoice) => {
        const date = invoiceDate(invoice);
        if (!date) return;
        if (!datasetStart || date < datasetStart) datasetStart = date;
        const key = contactKey(invoice);
        const known = firstSeen.get(key);
        if (!known || date < known) firstSeen.set(key, date);
        if (!billedMonths.has(key)) billedMonths.set(key, new Set());
        billedMonths.get(key).add(monthKey(date));
    });
    const lastBilled = new Map();
    billedMonths.forEach((months, key) => lastBilled.set(key, [...months].sort().pop()));
    return { invoices, everyLine, byMonth, everyByMonth, firstSeen, billedMonths, lastBilled, datasetStart };
}

// Cliente novo ainda em implantação no mês `month`? (ver SETUP_MONTHS)
function isInSetup(ctx, key, month) {
    const first = ctx.firstSeen.get(key);
    if (!first || !ctx.datasetStart) return false;
    const firstMonth = new Date(first.getFullYear(), first.getMonth(), 1);
    // Quem já fatura no primeiro mês dos dados pode ser cliente antigo: não dá para saber o início.
    if (monthKey(firstMonth) <= monthKey(ctx.datasetStart)) return false;
    const index = monthsApart(firstMonth, month);
    return index >= 1 && index <= SETUP_MONTHS;
}

// Parou de faturar neste mês e não voltou em nenhum mês seguinte (até o fim dos dados)?
function stoppedForGood(ctx, key, month) {
    const last = ctx.lastBilled.get(key);
    return !last || last < monthKey(month);
}

function groupByMonth(invoices) {
    const map = new Map();
    invoices.forEach((invoice) => {
        const date = invoiceDate(invoice);
        if (!date) return;
        const key = monthKey(date);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(invoice);
    });
    return map;
}

// Mês fechado usa o índice por mês; janelas personalizadas filtram a lista inteira.
function invoicesInWindow(list, buckets, window) {
    if (isCalendarMonth(window.start, window.end)) return buckets.get(monthKey(window.start)) || [];
    return list.filter((invoice) => inWindow(invoiceDate(invoice), window));
}

function measureWindow(ctx, windows, meta) {
    const current = invoicesInWindow(ctx.invoices, ctx.byMonth, windows.current);
    const previous = invoicesInWindow(ctx.invoices, ctx.byMonth, windows.previous);
    const currentByContact = totalsByContact(current);
    const baseContacts = new Set(invoicesInWindow(ctx.everyLine, ctx.everyByMonth, windows.previous).map(contactKey));
    const currentLines = totalsByContactLine(current);
    const previousLines = totalsByContactLine(previous);
    const historyAvailable = Boolean(ctx.datasetStart) && ctx.datasetStart < windows.current.start;

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
            const first = ctx.firstSeen.get(key);
            if (first && first >= windows.current.start) newContacts.add(key);
        });
    }
    meta.detection = meta.markedFirstMonth > 0 && historyAvailable ? 'marker + history'
        : meta.markedFirstMonth > 0 ? 'marker'
            : historyAvailable ? 'history' : 'unavailable';

    // Portfólio inicial = portfólio final (recorrente) do período anterior: o MRR do mês
    // anterior sem as onboarding fees e sem clientes em implantação.
    let initial = previous.reduce((sum, invoice) => sum + recurringAmount(invoice), 0);
    const onboardingInBase = previous.reduce((sum, invoice) => sum + onboardingAmount(invoice), 0);
    const month = windows.current.start;
    const monthly = isCalendarMonth(windows.current.start, windows.current.end);
    let churned = 0;
    let expansion = 0;
    // Variação das onboarding fees de clientes da base (negativa quando a fee acaba). Fica fora
    // do churn; só serve para a ponte do Overview fechar com o MRR.
    let onboardingChange = 0;
    // Variação de clientes em implantação (entra como novo negócio na ponte).
    let setupChange = 0;
    const setupClients = new Set();
    const churnedClients = meta.collectClients ? [] : null;
    baseContacts.forEach((key) => {
        const before = previousLines.get(key) || new Map();
        const after = currentLines.get(key) || new Map();
        let beforeTotal = 0;
        let afterTotal = 0;
        let tagged = 0;
        let newLines = 0;
        const droppedLines = [];
        linesInView().forEach((line) => {
            const previousValue = before.get(line)?.value || 0;
            const currentValue = after.get(line)?.value || 0;
            tagged += Math.min(after.get(line)?.tagged || 0, Math.max(currentValue, 0));
            if (currentValue < previousValue - 0.005) droppedLines.push(line);
            if (line !== 'other' && previousValue <= 0 && currentValue > 0) newLines += 1;
            onboardingChange += (after.get(line)?.onboarding || 0) - (before.get(line)?.onboarding || 0);
            beforeTotal += previousValue;
            afterTotal += currentValue;
        });
        const lost = beforeTotal > 0 && Math.abs(afterTotal) < 0.005;

        // Cliente em implantação: fica fora da retenção (base, churn e upsell), salvo se parou
        // de faturar de vez.
        if (monthly && isInSetup(ctx, key, month) && !(lost && stoppedForGood(ctx, key, month))) {
            initial -= beforeTotal;
            setupChange += afterTotal - beforeTotal;
            setupClients.add(key);
            return;
        }

        // Churn e upsell pelo total do cliente, não por linha de serviço: se o valor só mudou de
        // linha (SEO → Unclassified, WEB → SEO + PPC), o total não caiu e não é downgrade.
        const delta = afterTotal - beforeTotal;
        const up = Math.max(delta, 0, tagged);
        const clientChurn = up - delta;
        expansion += up;
        churned += clientChurn;
        if (tagged > 0) meta.taggedUpsell += tagged;
        meta.crossSells += newLines;
        if (lost) meta.lostClients += 1;
        if (churnedClients && clientChurn > 0.005) {
            const lines = droppedLines.length ? droppedLines : linesInView().filter((line) => (before.get(line)?.value || 0) > 0);
            churnedClients.push({ key, month: monthKey(month), before: beforeTotal, after: afterTotal, churned: clientChurn, lines, lost });
        }
    });
    if (churnedClients) meta.churnedClients = describeChurnedClients(churnedClients, ctx, windows);

    let newBusiness = 0;
    let reactivated = 0;
    currentByContact.forEach((value, key) => {
        if (baseContacts.has(key)) return;
        if (newContacts.has(key)) { newBusiness += value; meta.newClients += 1; return; }
        // Volta dentro da implantação (ex.: meses pagos adiantados): não é reativação.
        if (monthly && isInSetup(ctx, key, month)) { setupChange += value; setupClients.add(key); return; }
        reactivated += value;
    });
    meta.setupClients = setupClients.size;

    meta.invoiceCount = current.length;
    meta.reactivated = reactivated;

    return {
        hasBase: baseContacts.size > 0,
        initial,
        churned,
        expansion,
        // Retenção = (portfólio inicial − churn) / portfólio inicial. Upsells ficam de fora.
        retained: initial - churned,
        onboardingInBase,
        onboardingChange,
        setupChange,
        activeClients: currentByContact.size,
        newBusiness,
        reactivated,
        totalMrr: current.reduce((sum, invoice) => sum + amount(invoice), 0),
        // Portfólio final da retenção: MRR sem onboarding fees (vira o inicial do mês seguinte).
        recurringMrr: current.reduce((sum, invoice) => sum + recurringAmount(invoice), 0),
        invoiceCount: current.length,
    };
}

// Retenção do período do seletor, sempre mês contra o mês anterior. Num mês só, é a
// comparação com o mês anterior. Em vários meses, cada mês é medido contra o anterior e a
// taxa do período é a média desses meses ponderada pela base (Σ retido / Σ base inicial);
// churn e upsells em dólar são a soma dos meses (mesma regra da ponte do Overview).
// Datas personalizadas que não começam no dia 1 entram pelo mês inteiro.
function retentionOverWindow(ctx, window) {
    const lastBilled = [...ctx.byMonth.keys()].sort().pop();
    let months = monthKeysBetween(window.start, window.end);
    if (lastBilled) months = months.filter((key) => key <= lastBilled);
    if (!months.length) months = [monthKey(window.start)];

    const monthWindow = (date) => ({ start: date, end: endOfMonth(date), label: monthLabel(date) });
    const firstMonth = monthFromKey(months[0]);
    const baseWindow = monthWindow(new Date(firstMonth.getFullYear(), firstMonth.getMonth() - 1, 1));
    const endWindow = monthWindow(monthFromKey(months[months.length - 1]));

    const totals = { hasBase: false, initial: null, onboardingInBase: 0, churned: 0, expansion: 0, taggedUpsell: 0, crossSells: 0, upsellOutsideBase: 0 };
    const monthly = [];
    const events = [];
    const setupMonths = [];
    months.forEach((key, index) => {
        const current = monthWindow(monthFromKey(key));
        const previous = previousWindowOf(current);
        const meta = { ...emptyScorecardMeta(), collectClients: true };
        const m = measureWindow(ctx, { current, previous, beforePrevious: previousWindowOf(previous) }, meta);
        if (index === 0) { totals.hasBase = m.hasBase; totals.initial = m.initial; totals.onboardingInBase = m.onboardingInBase; }
        totals.churned += m.churned;
        totals.expansion += m.expansion;
        totals.taggedUpsell += meta.taggedUpsell;
        totals.crossSells += meta.crossSells;
        totals.upsellOutsideBase += meta.upsellOutsideBase;
        if (m.hasBase && m.initial > 0) {
            monthly.push({ key, label: current.label, initial: m.initial, churned: m.churned, expansion: m.expansion, retained: m.retained, rate: share(m.retained, m.initial) });
        }
        // Cada queda é um evento do mês em que aconteceu (mês contra o anterior), com os
        // valores desses dois meses. Um cliente pode ter um downgrade num mês e sair em outro.
        (meta.churnedClients || []).forEach((item) => events.push({ ...item, month: key }));
        setupMonths.push({ clients: meta.setupClients, change: m.setupChange });
    });

    // Clientes que pararam de faturar e voltaram até o fim do período.
    const endTotals = totalsByContact(invoicesInWindow(ctx.invoices, ctx.byMonth, endWindow));
    const endKey = monthKey(endWindow.start);
    const churnedClients = describeChurnedClients(events, ctx, { current: endWindow })
        .map((item) => ({ ...item, returned: item.lost && item.month < endKey && Math.abs(endTotals.get(item.key) || 0) >= 0.005 }))
        .sort((a, b) => b.month.localeCompare(a.month) || b.churned - a.churned || a.name.localeCompare(b.name));

    // Taxa ponderada pela base de cada mês: meses com base maior pesam mais.
    const pooled = (field) => monthly.reduce((sum, row) => sum + row[field], 0);
    const pooledInitial = pooled('initial');
    const rate = pooledInitial > 0 ? pooled('retained') / pooledInitial : null;

    return {
        ...totals,
        retained: hasValue(totals.initial) ? totals.initial - totals.churned : null,
        rate,
        churnRate: pooledInitial > 0 ? pooled('churned') / pooledInitial : null,
        expansionRate: pooledInitial > 0 ? pooled('expansion') / pooledInitial : null,
        netRate: pooledInitial > 0 ? (pooled('retained') + pooled('expansion')) / pooledInitial : null,
        monthly,
        baseLabel: baseWindow.label,
        endLabel: endWindow.label,
        months: months.length,
        setupClients: setupMonths.reduce((max, item) => Math.max(max, item.clients), 0),
        churnedClients,
        lostClients: new Set(churnedClients.filter((item) => item.lost).map((item) => item.key)).size,
    };
}

function emptyScorecardMeta() {
    return { invoiceCount: 0, markedFirstMonth: 0, markedUpsell: 0, taggedUpsell: 0, crossSells: 0, upsellOutsideBase: 0, reactivated: null, newClients: 0, lostClients: 0, detection: 'none' };
}

function buildScorecard() {
    const manual = USE_DEMO_TARGETS ? DEMO_MANUAL_INPUTS : MANUAL_INPUTS;
    const scorecard = {
        retention: { initialPortfolio: null, churned: null, upsells: null, retained: null, rate: null, churnRate: null, expansionRate: null, netRate: null, target: manual.retentionTarget, activeClients: null },
        newBusiness: { actual: null, target: manual.newBusinessTarget },
        totalMrr: { actual: null, target: manual.totalMrrTarget, accumulatedGap: manual.accumulatedGap, history: [] },
        cogs: { actual: manual.cogs, target: manual.cogsTarget },
        margin: { current: manual.margin, target: manual.marginTarget, bonusPool: manual.bonusPool },
    };
    const meta = emptyScorecardMeta();

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
    meta.currentWindow = windows.current;
    meta.latestOnly = Boolean(windows.current.latestOnly);
    meta.previousLabel = windows.previous.label;
    meta.priorLabel = windows.beforePrevious.label;

    const ctx = metricContext(invoices);
    const result = measureWindow(ctx, windows, meta);
    const retention = retentionOverWindow(ctx, windows.current);
    meta.previousLabel = retention.baseLabel;
    meta.retentionEndLabel = retention.endLabel;
    meta.retentionMonths = retention.months;
    // Downgrade é um evento do mês: só aparece quando o período escolhido contém esse mês.
    // Em "All available" nenhum mês foi escolhido (a comparação usa o último mês com
    // invoices), então os downgrades ficam fora da lista; o valor continua no churn do card.
    const hiddenDowngrades = meta.latestOnly ? retention.churnedClients.filter((item) => !item.lost) : [];
    meta.churnedClients = meta.latestOnly ? retention.churnedClients.filter((item) => item.lost) : retention.churnedClients;
    meta.hiddenDowngrades = hiddenDowngrades.length
        ? { count: hiddenDowngrades.length, value: hiddenDowngrades.reduce((sum, item) => sum + item.churned, 0), month: retention.endLabel }
        : null;
    meta.lostClients = retention.lostClients;
    meta.retentionMonthly = retention.monthly;
    meta.onboardingInBase = retention.onboardingInBase;
    meta.setupClients = retention.setupClients;
    meta.taggedUpsell = retention.taggedUpsell;
    meta.crossSells = retention.crossSells;
    meta.upsellOutsideBase = retention.upsellOutsideBase;
    scorecard.retention.initialPortfolio = retention.hasBase ? retention.initial : null;
    scorecard.retention.churned = retention.hasBase ? retention.churned : null;
    scorecard.retention.upsells = retention.hasBase ? retention.expansion : null;
    scorecard.retention.retained = retention.hasBase ? retention.retained : null;
    scorecard.retention.rate = retention.hasBase ? retention.rate : null;
    scorecard.retention.churnRate = retention.hasBase ? retention.churnRate : null;
    scorecard.retention.expansionRate = retention.hasBase ? retention.expansionRate : null;
    scorecard.retention.netRate = retention.hasBase ? retention.netRate : null;
    scorecard.retention.activeClients = result.activeClients;

    scorecard.newBusiness.actual = result.newBusiness;
    scorecard.totalMrr.actual = result.totalMrr;
    if (hasValue(scorecard.totalMrr.target)) {
        scorecard.newBusiness.target = Math.max(0, Number(scorecard.totalMrr.target) - scorecard.totalMrr.actual);
    }
    scorecard.totalMrr.history = monthlyHistory(invoices, windows.current.start);
    const carried = accumulatedGap(invoices, windows.current.end);
    meta.accumulated = carried;
    if (carried) scorecard.totalMrr.accumulatedGap = carried.gap;

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
    // Retido = portfólio inicial − churn (upsells não entram na retenção).
    const retained = hasValue(data.retained)
        ? Number(data.retained)
        : hasValue(data.initialPortfolio) && hasValue(data.churned)
            ? Number(data.initialPortfolio) - Number(data.churned)
            : null;
    const onboardingNote = meta.onboardingInBase > 0.005 ? ` · ${money(meta.onboardingInBase)} of onboarding fees left out` : '';
    const baseHint = `${meta.previousLabel ? `Final portfolio of ${meta.previousLabel}` : 'Final portfolio of the previous month'}${onboardingNote}`;
    const summed = !meta.latestOnly && meta.retentionMonths > 1;
    // Taxas sempre mês contra o mês anterior; em vários meses, a média ponderada pela base.
    const churnRate = hasValue(data.churnRate) ? data.churnRate : share(data.churned, data.initialPortfolio);
    const expansionRate = hasValue(data.expansionRate) ? data.expansionRate : share(data.upsells, data.initialPortfolio);

    setText('#ret-initial', moneyOr(data.initialPortfolio));
    setText('#ret-churned', moneyOr(data.churned));
    setText('#ret-upsells', moneyOr(data.upsells));
    setText('#ret-clients', hasValue(data.activeClients) ? number(data.activeClients) : DASH);
    setText('#ret-churn-rate', percentOr(churnRate));
    setText('#ret-churn-rate-label', summed ? 'of the base per month' : 'of the initial base');
    setText('#ret-expansion-rate', percentOr(expansionRate));
    setText('#ret-expansion-rate-label', summed ? 'expansion per month' : 'expansion');
    setText('#ret-initial-note', baseHint);
    setText('#ret-clients-note', meta.invoiceCount ? `${plural(meta.invoiceCount, 'invoice')} in the period` : 'No invoices in the period');
    setText('#ret-churn-note', meta.lostClients ? `${plural(meta.lostClients, 'client')} stopped billing` : 'No client stopped billing');
    setText('#ret-upsell-note', upsellNote(meta));
    const churnScope = $('#ret-churn-scope');
    if (churnScope) {
        churnScope.hidden = !meta.latestOnly && !summed;
        churnScope.textContent = meta.latestOnly
            ? `Latest month only: ${meta.currentLabel} vs ${meta.previousLabel}${meta.hiddenDowngrades ? ` · downgrades listed when ${meta.hiddenDowngrades.month} is selected` : ''}`
            : summed ? `Summed month by month, ${plural(meta.retentionMonths, 'month')} through ${meta.retentionEndLabel}` : '';
    }
    const churnLink = $('#open-churn-modal');
    if (churnLink) {
        const count = hasValue(data.churned) && Array.isArray(meta.churnedClients) ? new Set(meta.churnedClients.map((item) => item.key)).size : 0;
        churnLink.hidden = count === 0;
        churnLink.firstChild.textContent = `See ${plural(count, 'client')} `;
    }

    const rows = [
        { label: 'Initial portfolio value', hint: baseHint, value: data.initialPortfolio, tone: '', signed: false },
        { label: 'Churned value', hint: 'Lost clients and downgrades', value: hasValue(data.churned) ? -Number(data.churned) : null, tone: 'is-negative', signed: true },
        { label: 'Retained portfolio', hint: 'Initial portfolio minus churn', value: retained, tone: 'is-total', signed: false },
        { label: 'Upsells & cross-sells', hint: `${meta.taggedUpsell > 0 ? `${money(meta.taggedUpsell)} tagged in Xero · ` : ''}not counted in retention`, value: data.upsells, tone: 'is-positive', signed: true },
    ];
    const max = Math.max(...rows.map((row) => Math.abs(Number(row.value) || 0)), 1);

    $('#retention-waterfall').innerHTML = rows.map((row) => `
        <div class="waterfall-row ${row.tone}">
            <div class="waterfall-label">${escapeHtml(row.label)}<span class="waterfall-hint">${escapeHtml(row.hint)}</span></div>
            <div class="waterfall-bar"><span style="width:${(Math.abs(Number(row.value) || 0) / max) * 100}%"></span></div>
            <div class="waterfall-value">${row.signed ? signedMoney(row.value) : moneyOr(row.value)}</div>
        </div>
    `).join('');

    // Retenção = (portfólio inicial − churn) / portfólio inicial, sempre contra o mês anterior.
    // Em vários meses: média dos meses ponderada pela base (Σ retido / Σ base inicial).
    const retentionRate = hasValue(data.rate) ? data.rate : share(retained, data.initialPortfolio);
    const netRate = hasValue(data.netRate) ? data.netRate : hasValue(retained) ? share(retained + Number(data.upsells || 0), data.initialPortfolio) : null;
    const monthly = Array.isArray(meta.retentionMonthly) ? meta.retentionMonthly : [];
    const note = !hasValue(retentionRate)
        ? 'Needs billing in the previous month to compare.'
        : summed && monthly.length > 1
            ? `Average of ${plural(monthly.length, 'month')}, each against the month before, weighted by its base: ${monthly.map((row) => `${row.label} ${percentOr(row.rate)}`).join(' · ')}. With upsells: ${percentOr(netRate)}.`
            : `${moneyOr(retained)} kept of the ${moneyOr(data.initialPortfolio)} ${meta.previousLabel ? `${meta.previousLabel} ` : ''}portfolio after ${moneyOr(data.churned)} churned. With upsells: ${percentOr(netRate)}.`;
    $('#retention-target').innerHTML = targetBlock({
        caption: summed ? 'Retention (existing), monthly avg.' : 'Retention (existing)',
        value: retentionRate,
        target: data.target,
        format: 'percent',
        naLabel: 'N/A',
        note,
    });
}

function upsellNote(meta) {
    const parts = [];
    if (meta.taggedUpsell > 0) parts.push(`${money(meta.taggedUpsell)} tagged in Xero`);
    if (meta.crossSells > 0) parts.push(`${plural(meta.crossSells, 'new service line')} on existing clients`);
    if (meta.upsellOutsideBase > 0) parts.push(`${plural(meta.upsellOutsideBase, 'upsell invoice')} for clients not billed in ${meta.previousLabel || 'the previous period'}`);
    return parts.length ? parts.join(' · ') : 'Measured by value change';
}

// ---- Clientes que geraram churn no período (modal do card "Churned value") ----
// Mesma regra do card: cliente da base do período anterior cuja receita caiu em alguma
// linha de serviço. "Lost" parou de faturar por completo; "Downgrade" continua, mas menor.
const SERVICE_LINE_LABELS = { ...categoryLabels, other: 'Unclassified' };

function describeChurnedClients(list, ctx, windows) {
    const wanted = new Set(list.map((item) => item.key));
    const info = new Map();
    ctx.invoices.forEach((invoice) => {
        const key = contactKey(invoice);
        if (!wanted.has(key)) return;
        const date = invoiceDate(invoice);
        if (!date || date > windows.current.end) return;
        const known = info.get(key);
        if (!known || date > known.lastDate) {
            info.set(key, { name: invoice.Contact?.Name || 'Unnamed client', companyKey: invoice.companyKey, lastDate: date });
        }
    });
    return list.map((item) => ({ ...item, ...(info.get(item.key) || { name: 'Unnamed client', companyKey: null, lastDate: null }) }))
        .sort((a, b) => b.churned - a.churned || a.name.localeCompare(b.name));
}

const churnModal = $('#churn-modal');

function renderChurnModal() {
    const meta = state.scorecardMeta || {};
    // Uma linha por queda: cliente × mês em que ela aconteceu (mês contra o anterior).
    const events = Array.isArray(meta.churnedClients) ? meta.churnedClients : [];
    const total = events.reduce((sum, item) => sum + item.churned, 0);
    const clientCount = new Set(events.map((item) => item.key)).size;
    const lost = events.filter((item) => item.lost).length;
    const downgrades = events.length - lost;
    const previous = meta.previousLabel || 'Previous period';
    const window = meta.currentWindow;
    const current = meta.retentionEndLabel
        || (window && isCalendarMonth(window.start, window.end) ? monthLabel(window.start) : meta.currentLabel || 'Selected period');
    const summed = !meta.latestOnly && meta.retentionMonths > 1;

    setText('#churn-modal-context', `${state.scope === 'all' ? 'Global' : companyLabels[state.scope]} · ${serviceName(state.category)} · ${summed ? `${meta.retentionMonths} months through ${current}` : `${current} against ${previous}`}`);
    const hidden = meta.hiddenDowngrades;
    setText('#churn-modal-summary', [
        events.length
            ? `${plural(clientCount, 'client')} · ${money(total)} churned · ${plural(lost, 'client')} lost, ${plural(downgrades, 'downgrade')}`
            : 'No client lost value in this period.',
        hidden ? `${plural(hidden.count, 'downgrade')} (${money(hidden.value)}) from ${hidden.month} not listed: select ${hidden.month} in Reporting period to see them.` : '',
        meta.setupClients
            ? `${plural(meta.setupClients, 'new client')} still in the first ${SETUP_MONTHS + 1} months ${meta.setupClients === 1 ? 'is' : 'are'} left out: changes while a contract is being set up (onboarding fee, services phased in, prepaid months) are not churn.`
            : '',
    ].filter(Boolean).join(' '));
    setText('#churn-col-previous', summed ? 'Month before' : previous);
    setText('#churn-col-current', summed ? 'That month' : current);

    const scopeNote = $('#churn-modal-scope');
    scopeNote.hidden = !meta.latestOnly && !summed;
    scopeNote.textContent = meta.latestOnly
        ? `“${periodBounds().label}” has no earlier period to compare against, so this list compares the latest month with invoices (${current}) with the month before it (${previous}). Pick a month or range in Reporting period to see other months.`
        : summed
            ? `Each row is one drop, in the month it happened, against the month before it. A client can appear more than once (a downgrade in one month, lost in another).`
            : '';

    $('#churn-table').innerHTML = events.map((item) => {
        const lines = item.lines.map((line) => SERVICE_LINE_LABELS[line] || line).join(' + ');
        const when = item.lost && item.returned ? `Billing again in ${current}` : '';
        return `<tr>
            <td>${escapeHtml(item.name)}<span class="entry-sub">Last invoice ${escapeHtml(shortDate(item.lastDate))}</span></td>
            <td>${escapeHtml(companyLabels[item.companyKey] || DASH)}</td>
            <td>${escapeHtml(monthLabel(monthFromKey(item.month)))}</td>
            <td>${escapeHtml(lines || DASH)}</td>
            <td class="align-right mono">${money(item.before)}</td>
            <td class="align-right mono">${money(item.after)}</td>
            <td class="align-right mono"><span class="value-down">${signedMoney(-item.churned)}</span></td>
            <td><span class="status-pill ${item.lost ? 'is-lost' : 'is-downgrade'}">${item.lost ? 'Lost' : 'Downgrade'}</span>${when ? `<span class="entry-sub">${escapeHtml(when)}</span>` : ''}</td>
        </tr>`;
    }).join('');
    $('#churn-table-empty').classList.toggle('is-hidden', events.length > 0);
    const foot = $('#churn-table-total');
    foot.classList.toggle('is-hidden', events.length === 0);
    setText('#churn-total-value', signedMoney(-total));
}

function openChurnModal() {
    renderChurnModal();
    churnModal.showModal();
}

function closeChurnModal() {
    churnModal.close();
    $('#open-churn-modal').focus();
}

if (churnModal) {
    $('#open-churn-modal').addEventListener('click', openChurnModal);
    churnModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeChurnModal));
    churnModal.addEventListener('click', (event) => { if (event.target === churnModal) closeChurnModal(); });
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
    renderMonthlyTables();
    renderOverview();
    renderUnitSection();
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
    requestAnimationFrame(() => { [state.statusChart, state.mrrChart, state.gapChart, state.summaryPlanChart, state.summaryBridgeChart].forEach((chart) => chart && chart.resize()); });
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

// COGS e margem de um mês. Cascata igual à dos targets:
// 1) lançamento exato; 2) soma de SEO + PPC do mesmo mercado; 3) na visão Global, soma dos mercados.
function marginEntryFor(month, invoices, scope = state.scope, category = state.category) {
    const exact = state.marginInputs[marginInputKey(month, scope, category)];
    if (exact) return exact;
    if (category === 'all') {
        const lines = Object.keys(categoryLabels)
            .map((key) => state.marginInputs[marginInputKey(month, scope, key)])
            .filter(Boolean);
        if (lines.length) return combineMarginParts(month, lines, scope, category, false);
    }
    if (scope === 'all') {
        const markets = Object.keys(companyLabels)
            .map((key) => marginEntryFor(month, invoices, key, category))
            .filter(Boolean);
        if (markets.length) return combineMarginParts(month, markets, scope, category, true);
    }
    return null;
}

// Receita faturada de uma parte (mercado + serviço) no mês: é o peso das margens.
function marginPartRevenue(monthInvoices, part) {
    return monthInvoices.reduce((total, invoice) => {
        if (part.scope !== 'all' && invoice.companyKey !== part.scope) return total;
        const value = fullAmount(invoice);
        return total + (part.category === 'all' ? value : value * categoryShare(invoice, part.category));
    }, 0);
}

function combineMarginParts(month, parts, scope, category, acrossMarkets) {
    const monthInvoices = state.invoices.filter((invoice) => {
        if (!isBillable(invoice)) return false;
        const date = invoiceDate(invoice);
        return date && monthKey(date) === month;
    });
    const revenueOf = (part) => marginPartRevenue(monthInvoices, part);
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
    const labelsOf = (part) => {
        const inner = part.combinedFrom && part.combinedFrom.length
            ? part.combinedFrom
            : [part.category === 'all' ? 'all services' : categoryLabels[part.category]];
        return acrossMarkets ? inner.map((label) => `${companyLabels[part.scope] || 'Global'} ${label}`) : inner;
    };
    return {
        month,
        scope,
        category,
        cogs: sum('cogs'),
        cogsTarget: sum('cogsTarget'),
        margin: weighted('margin'),
        marginTarget: weighted('marginTarget'),
        bonusPool: sum('bonusPool'),
        revenue: cogsRevenue > 0 ? cogsRevenue : null,
        combinedFrom: parts.flatMap(labelsOf),
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
    const response = redirectIfSignedOut(await fetch(MARGIN_ENDPOINT, { cache: 'no-store', ...options }));
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
    return parts.length ? ` Combined from ${parts.join(' + ')} entries.` : '';
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

document.querySelectorAll('.entries-tab:not([data-monthly])').forEach((button) => button.addEventListener('click', () => {
    state.marginEntriesMode = button.dataset.entries;
    document.querySelectorAll('.entries-tab:not([data-monthly])').forEach((item) => item.classList.toggle('is-active', item === button));
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
    const response = redirectIfSignedOut(await fetch(TARGETS_ENDPOINT, { cache: 'no-store', ...options }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `The server answered HTTP ${response.status}.`);
    return body;
}

function storeTargetEntry(entry) {
    state.targetInputs[marginInputKey(entry.month, entry.scope, entry.category)] = entry;
    state.monthlyRows = null;
}

async function loadTargetInputs() {
    state.targetInputsStatus = 'loading';
    renderTargetInputStatus();
    try {
        const { entries = [] } = await targetsRequest();
        state.targetInputs = {};
        state.monthlyRows = null;
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

function openTargetsModal(entry = null) {
    const targets = (state.scorecardMeta || {}).targets;
    targetsForm.reset();
    showTargetError('');
    targetsForm.elements.month.value = entry ? entry.month : targets && targets.months.length ? targets.months[targets.months.length - 1] : monthKey(new Date());
    targetsForm.elements.scope.value = entry ? entry.scope : state.scope;
    targetsForm.elements.category.value = entry ? entry.category : state.category;
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

$('#open-targets-modal').addEventListener('click', () => openTargetsModal());
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

// ---- Tabelas mensais (MRR, Retention, Targets) ----
// Uma linha por mês × mercado × serviço, calculada a partir das invoices,
// com a mesma lógica do scorecard. O resultado fica em cache até as
// invoices ou os targets mudarem.

state.monthlyRows = null;
state.monthlyModes = { mrr: 'all', retention: 'all', targets: 'all' };

const serviceName = (category) => (category === 'all' ? 'All services' : categoryLabels[category] || category);
const toneClass = (value, lowerIsBetter = false) => (!hasValue(value) || Number(value) === 0 ? '' : (Number(value) > 0) !== lowerIsBetter ? 'value-up' : 'value-down');
const signedPercent = (value) => (hasValue(value) ? `${Number(value) > 0 ? '+' : Number(value) < 0 ? '−' : ''}${Math.abs(Number(value) * 100).toFixed(1)}%` : DASH);

function withView(scope, category, run) {
    const saved = { scope: state.scope, category: state.category };
    state.scope = scope;
    state.category = category;
    try { return run(); } finally { state.scope = saved.scope; state.category = saved.category; }
}

function reportingMonths() {
    let first = null;
    let last = null;
    state.invoices.forEach((invoice) => {
        if (!isBillable(invoice)) return;
        const date = invoiceDate(invoice);
        if (!date) return;
        if (!first || date < first) first = date;
        if (!last || date > last) last = date;
    });
    if (!first) return [];
    const today = startOfToday();
    return monthKeysBetween(first, last > today ? last : today).map(monthFromKey);
}

function buildMonthlyRows() {
    const months = reportingMonths();
    const retentionTarget = (USE_DEMO_TARGETS ? DEMO_MANUAL_INPUTS : MANUAL_INPUTS).retentionTarget;
    const rows = { mrr: [], retention: [], targets: [] };

    VIEW_SCOPES.forEach((scope) => VIEW_CATEGORIES.forEach((category) => withView(scope, category, () => {
        const ctx = metricContext(scopedInvoices());
        let previousMrr = null;
        let yearGap = 0;
        let yearGapMonths = 0;

        months.forEach((start) => {
            const key = monthKey(start);
            if (start.getMonth() === 0) { yearGap = 0; yearGapMonths = 0; }
            const current = { start, end: endOfMonth(start), label: monthLabel(start) };
            const previous = previousWindowOf(current);
            const meta = emptyScorecardMeta();
            const m = measureWindow(ctx, { current, previous, beforePrevious: previousWindowOf(previous) }, meta);
            const base = { key: marginInputKey(key, scope, category), month: key, scope, category };
            const target = resolveTarget(key, scope, category)?.totalMrrTarget ?? null;

            if (hasValue(target)) { yearGap += m.totalMrr - Number(target); yearGapMonths += 1; }

            if (m.invoiceCount > 0) {
                rows.mrr.push({
                    ...base,
                    mrr: m.totalMrr,
                    change: previousMrr === null ? null : m.totalMrr - previousMrr,
                    changeRate: previousMrr ? (m.totalMrr - previousMrr) / previousMrr : null,
                    invoices: m.invoiceCount,
                    clients: m.activeClients,
                    newClients: meta.newClients,
                    newBusiness: m.newBusiness,
                    average: m.activeClients ? m.totalMrr / m.activeClients : null,
                });
            }

            if (m.hasBase || m.activeClients > 0) {
                rows.retention.push({
                    ...base,
                    initial: m.hasBase ? m.initial : null,
                    churned: m.hasBase ? m.churned : null,
                    upsells: m.hasBase ? m.expansion : null,
                    retained: m.hasBase ? m.retained : null,
                    // Portfólio final do mês = MRR do mês sem onboarding fees; é o inicial do mês seguinte.
                    final: m.recurringMrr,
                    onboardingChange: m.hasBase ? m.onboardingChange : null,
                    setupChange: m.setupChange,
                    rate: m.hasBase ? share(m.retained, m.initial) : null,
                    target: retentionTarget,
                    lostClients: m.hasBase ? meta.lostClients : null,
                    reactivated: m.reactivated,
                });
            }

            if (m.invoiceCount > 0 || hasValue(target)) {
                rows.targets.push({
                    ...base,
                    actual: m.totalMrr,
                    target,
                    difference: hasValue(target) ? m.totalMrr - Number(target) : null,
                    newBusiness: m.newBusiness,
                    newBusinessTarget: hasValue(target) ? Math.max(0, Number(target) - m.totalMrr) : null,
                    accumulated: yearGapMonths ? yearGap : null,
                    hasExactTarget: Boolean(exactTarget(key, scope, category)),
                });
            }

            previousMrr = m.totalMrr;
        });
    })));

    const order = (a, b) => b.month.localeCompare(a.month)
        || VIEW_SCOPES.indexOf(a.scope) - VIEW_SCOPES.indexOf(b.scope)
        || VIEW_CATEGORIES.indexOf(a.category) - VIEW_CATEGORIES.indexOf(b.category);
    Object.values(rows).forEach((list) => list.sort(order));
    return rows;
}

const MONTHLY_TABLES = {
    mrr: {
        section: '#mrr-view',
        emptyAll: 'No billable client invoices yet.',
        columns: [
            (row) => `<td class="align-right mono">${moneyOr(row.mrr)}</td>`,
            (row) => `<td class="align-right mono"><span class="${toneClass(row.change)}">${signedMoney(row.change)}</span><span class="entry-sub">${signedPercent(row.changeRate)}</span></td>`,
            (row) => `<td class="align-right mono">${number(row.invoices)}</td>`,
            (row) => `<td class="align-right mono">${number(row.clients)}</td>`,
            (row) => `<td class="align-right mono">${moneyOr(row.average)}</td>`,
        ],
    },
    retention: {
        section: '#retention-view',
        emptyAll: 'No billable client invoices yet.',
        columns: [
            (row) => `<td class="align-right mono">${moneyOr(row.initial)}</td>`,
            (row) => `<td class="align-right mono">${hasValue(row.churned) ? `<span class="${row.churned > 0 ? 'value-down' : ''}">${moneyOr(row.churned)}</span>` : DASH}</td>`,
            (row) => `<td class="align-right mono">${moneyOr(row.retained)}</td>`,
            (row) => `<td class="align-right mono">${hasValue(row.rate) ? `<span class="${hasValue(row.target) ? (row.rate >= row.target ? 'value-up' : 'value-down') : ''}">${percentOr(row.rate)}</span>` : 'N/A'}</td>`,
            (row) => `<td class="align-right mono">${percentOr(row.target)}</td>`,
            (row) => `<td class="align-right mono">${hasValue(row.upsells) ? `<span class="${row.upsells > 0 ? 'value-up' : ''}">${moneyOr(row.upsells)}</span>` : DASH}</td>`,
            (row) => `<td class="align-right mono">${moneyOr(row.final)}</td>`,
            (row) => `<td class="align-right mono">${hasValue(row.lostClients) ? number(row.lostClients) : DASH}</td>`,
        ],
    },
    targets: {
        section: '#targets-view',
        editable: true,
        emptyAll: 'No billable client invoices or Target MRR saved yet.',
        columns: [
            (row) => `<td class="align-right mono">${moneyOr(row.actual)}</td>`,
            (row) => `<td class="align-right mono">${moneyOr(row.target)}</td>`,
            (row) => `<td class="align-right mono"><span class="${toneClass(row.difference)}">${signedMoney(row.difference)}</span></td>`,
            (row) => `<td class="align-right mono">${moneyOr(row.newBusiness)}</td>`,
            (row) => `<td class="align-right mono">${moneyOr(row.newBusinessTarget)}</td>`,
            (row) => `<td class="align-right mono"><span class="${toneClass(row.accumulated)}">${signedMoney(row.accumulated)}</span></td>`,
        ],
    },
};

function renderMonthlyTables() {
    if (!state.monthlyRows) state.monthlyRows = buildMonthlyRows();
    Object.keys(MONTHLY_TABLES).forEach(renderMonthlyTable);
}

function renderMonthlyTable(name) {
    const config = MONTHLY_TABLES[name];
    const body = $(`#${name}-entries-table`);
    const empty = $(`#${name}-entries-empty`);
    if (!body || !empty) return;
    const mode = state.monthlyModes[name];
    const all = state.monthlyRows[name] || [];
    const rows = mode === 'view' ? all.filter(entryInView) : all;
    const inViewCount = all.filter(entryInView).length;

    const entriesLabel = (count) => `${number(count)} ${count === 1 ? 'entry' : 'entries'}`;
    setText(`#${name}-entries-summary`, mode === 'view'
        ? `${entriesLabel(rows.length)} of ${number(all.length)}`
        : `${entriesLabel(all.length)} · ${number(inViewCount)} used in current view`);

    body.innerHTML = rows.map((row) => {
        const used = mode === 'all' && entryInView(row);
        const edit = config.editable
            ? `<button type="button" class="row-button" data-row-edit="${escapeHtml(row.key)}">${row.hasExactTarget ? 'Edit' : 'Set target'}</button>`
            : '';
        return `<tr class="${used ? 'is-in-view' : ''}"${used ? ' title="Used by the current view"' : ''}>
            <td>${escapeHtml(monthLabel(monthFromKey(row.month)))}</td>
            <td>${escapeHtml(companyLabels[row.scope] || 'Global')}</td>
            <td>${escapeHtml(serviceName(row.category))}</td>
            ${config.columns.map((column) => column(row)).join('')}
            <td class="align-right entry-actions"><button type="button" class="row-button" data-row-show="${escapeHtml(row.key)}">Show</button>${edit}</td>
        </tr>`;
    }).join('');

    let message = '';
    if (!state.invoices.length && state.sync.phase === 'loading') message = 'Loading invoices…';
    else if (!state.invoices.length && state.sync.phase === 'failed') message = 'Could not load invoices.';
    else if (!all.length) message = config.emptyAll;
    else if (!rows.length) message = 'No month matches the current market, service and period.';
    empty.textContent = message;
    empty.classList.toggle('is-hidden', !message || rows.length > 0);
}

Object.entries(MONTHLY_TABLES).forEach(([name, config]) => {
    document.querySelectorAll(`.entries-tab[data-monthly="${name}"]`).forEach((button) => button.addEventListener('click', () => {
        state.monthlyModes[name] = button.dataset.entries;
        document.querySelectorAll(`.entries-tab[data-monthly="${name}"]`).forEach((item) => item.classList.toggle('is-active', item === button));
        renderMonthlyTable(name);
    }));

    const body = $(`#${name}-entries-table`);
    if (!body) return;
    body.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        const key = button.dataset.rowShow || button.dataset.rowEdit;
        const row = (state.monthlyRows?.[name] || []).find((item) => item.key === key);
        if (!row) return;
        if (button.dataset.rowEdit) { openTargetsModal(row); return; }
        showMarginEntry(row);
        $(config.section).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
});

// ---- Late invoices ----
// Encargos por atraso.
// Brasil: regra fixa do contrato, definida abaixo.
// México, Panamá e International: vêm da tabela late_charge_rules (botão "Edit rates" na aba).
// Mercado sem taxa salva não tem encargo aplicado, e a aba avisa.
//   lateFee          multa única sobre o saldo em aberto (0.02 = 2%)
//   monthlyInterest  juros simples ao mês, pro rata por dia, contados desde o vencimento (0.01 = 1% a.m.)
//   graceDays        dias de carência: até aqui, nenhum encargo é cobrado
// Um mercado sem entrada própria usa o "default".
//   correction       índices de correção monetária; com mais de um, vale o maior acumulado no atraso
// Ordem: o saldo é corrigido primeiro; multa e juros incidem sobre o saldo corrigido.
const LATE_CHARGE_RULES = {
    default: { lateFee: 0, monthlyInterest: 0, graceDays: 0, correction: [] },
    br: { lateFee: 0.10, monthlyInterest: 0.01, graceDays: 0, correction: ['igpm', 'ipca'] },
};
const EDITABLE_RULE_SCOPES = ['mx', 'pa', 'int'];
const LATE_RULES_ENDPOINT = 'late-rules.php';
state.lateRules = {};
state.lateRulesStatus = 'loading';
state.lateRulesError = '';
const INDEX_LABELS = { igpm: 'IGP-M', ipca: 'IPCA' };
state.brIndices = { status: 'loading', series: {}, latest: {}, error: null, stale: [] };
const DAY_MS = 24 * 60 * 60 * 1000;
const AGING_BUCKETS = [
    { label: '1–30 days', min: 1, max: 30 },
    { label: '31–60 days', min: 31, max: 60 },
    { label: '61–90 days', min: 61, max: 90 },
    { label: '90+ days', min: 91, max: Infinity },
];
const moneyExact = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
const shortDate = (date) => (date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : DASH);
const ratePercent = (value) => `${Number((value * 100).toFixed(2))}%`;

function lateRule(companyKey) {
    if (LATE_CHARGE_RULES[companyKey]) return { ...LATE_CHARGE_RULES.default, ...LATE_CHARGE_RULES[companyKey], source: 'contract' };
    const saved = state.lateRules[companyKey];
    if (saved) return { ...LATE_CHARGE_RULES.default, ...saved, correction: [], source: 'saved' };
    return { ...LATE_CHARGE_RULES.default, source: 'unset' };
}

function lateRuleLabel(rule) {
    if (rule.source === 'unset') return 'Rate not set';
    const parts = [];
    if (rule.lateFee) parts.push(`${ratePercent(rule.lateFee)} fee`);
    if (rule.monthlyInterest) parts.push(`${ratePercent(rule.monthlyInterest)}/month`);
    if (rule.correction.length) parts.push(rule.correction.map((key) => INDEX_LABELS[key]).join('/'));
    const label = parts.join(' + ') || 'No charges';
    return rule.graceDays ? `${label} after ${plural(rule.graceDays, 'day')}` : label;
}

// Saldo em aberto em USD (já considera pagamentos parciais), na fatia do serviço selecionado.
function outstandingUsd(invoice) {
    const usd = invoice.amounts_usd;
    const converted = usd && usd.AmountDue !== null && usd.AmountDue !== undefined && Number.isFinite(Number(usd.AmountDue))
        ? Number(usd.AmountDue)
        : Number(invoice.AmountDue || 0) * Number(invoice.usdRate || 1);
    return converted * categoryShare(invoice);
}

function originalBalance(invoice) {
    const currency = String(invoice.CurrencyCode || invoice.companyCurrency || '').toUpperCase();
    if (!currency || currency === 'USD') return '';
    const value = Number(invoice.AmountDue || 0) * categoryShare(invoice);
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code' }).format(value);
    } catch {
        return `${currency} ${value.toFixed(2)}`;
    }
}

// Fator acumulado de um índice entre o vencimento e hoje, pro rata die dentro de cada mês.
// Meses ainda sem índice publicado entram como zero e são sinalizados.
function indexFactor(series, from, to) {
    let factor = 1;
    let pending = false;
    for (let month = new Date(from.getFullYear(), from.getMonth(), 1); month < to; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
        const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
        const start = from > month ? from : month;
        const end = to < next ? to : next;
        const days = Math.round((end - start) / DAY_MS);
        if (days <= 0) continue;
        const rate = series[monthKey(month)];
        if (rate === undefined) { pending = true; continue; }
        factor *= (1 + Number(rate)) ** (days / Math.round((next - month) / DAY_MS));
    }
    return { factor, pending };
}

function correctionFor(rule, due, today) {
    if (!rule.correction.length) return { factor: 1, index: null, pending: false, unavailable: false };
    const options = rule.correction
        .filter((key) => Object.keys(state.brIndices.series[key] || {}).length)
        .map((key) => ({ key, ...indexFactor(state.brIndices.series[key], due, today) }));
    if (!options.length) return { factor: 1, index: null, pending: false, unavailable: true };
    const best = options.reduce((top, option) => (option.factor > top.factor ? option : top));
    // Deflação não reduz a dívida: sem correção negativa.
    return {
        factor: Math.max(1, best.factor),
        index: best.factor > 1 ? INDEX_LABELS[best.key] : null,
        pending: best.pending,
        unavailable: options.length < rule.correction.length,
    };
}

function lateCharges(invoice, today) {
    const due = dueDate(invoice);
    const days = Math.max(0, Math.round((today - due) / DAY_MS));
    const rule = lateRule(invoice.companyKey);
    const balance = outstandingUsd(invoice);
    const chargeable = days > rule.graceDays;
    const correction = chargeable ? correctionFor(rule, due, today) : { factor: 1, index: null, pending: false, unavailable: false };
    const corrected = balance * correction.factor;
    const fee = chargeable ? corrected * rule.lateFee : 0;
    const interest = chargeable ? corrected * rule.monthlyInterest * (days / 30) : 0;
    return {
        invoice, due, days, balance, fee, interest,
        correction: corrected - balance,
        correctionIndex: correction.index,
        correctionPending: correction.pending,
        correctionUnavailable: correction.unavailable,
        hasCorrection: chargeable && rule.correction.length > 0,
        total: corrected + fee + interest,
    };
}

async function loadBrIndices() {
    try {
        const response = redirectIfSignedOut(await fetch('br-indices.php', { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body || !body.series) throw new Error(`The dashboard server answered HTTP ${response.status}.`);
        const errors = Array.isArray(body.errors) ? body.errors : [];
        state.brIndices = {
            status: errors.length ? 'partial' : 'ready',
            series: body.series,
            latest: body.latest || {},
            stale: body.stale || [],
            error: errors.join(' · ') || null,
        };
    } catch (error) {
        state.brIndices = { status: 'error', series: {}, latest: {}, stale: [], error: error.message };
    }
    renderLate();
}

function renderIndexNote() {
    const node = $('#late-index-note');
    if (!node) return;
    const info = state.brIndices;
    let text = '';
    let tone = 'muted';
    if (info.status === 'loading') text = 'Loading IGP-M and IPCA from the Central Bank…';
    else if (info.status === 'error') { text = `Brazil inflation correction is not applied: ${info.error}`; tone = 'error'; }
    else {
        const published = Object.keys(INDEX_LABELS)
            .map((key) => (info.latest[key] ? `${INDEX_LABELS[key]} through ${monthLabel(monthFromKey(info.latest[key]))}` : null))
            .filter(Boolean);
        text = `Brazil correction uses the higher of IGP-M and IPCA (Central Bank). Published: ${published.join(', ')}. Months not yet published count as zero.`;
        if (info.stale.length) { text += ` Could not refresh ${info.stale.map((key) => INDEX_LABELS[key]).join(' and ')}, showing the last saved values.`; tone = 'sample'; }
        if (info.error) { text += ` ${info.error}`; tone = 'error'; }
    }
    node.textContent = text;
    node.dataset.tone = tone;
}

function lateInvoices() {
    const today = startOfToday();
    return state.invoices
        .filter((invoice) => isBillable(invoice)
            && invoiceBucket(invoice) === 'late'
            && (state.scope === 'all' || invoice.companyKey === state.scope)
            && inCategory(invoice))
        .map((invoice) => lateCharges(invoice, today))
        .filter((item) => item.balance > 0)
        .sort((a, b) => b.days - a.days || b.total - a.total);
}

function correctionCell(item) {
    if (!item.hasCorrection) return DASH;
    if (item.correctionUnavailable && !item.correctionIndex) return `${DASH}<div class="client-sub">index unavailable</div>`;
    const notes = [item.correctionIndex || 'no inflation'];
    if (item.correctionPending) notes.push('partial');
    return `${moneyExact(item.correction)}<div class="client-sub">${escapeHtml(notes.join(' · '))}</div>`;
}

function barRows(rows) {
    const max = Math.max(...rows.map((row) => row.total), 1);
    return rows.map((row) => `<div class="market-row${row.dimmed ? ' is-dimmed' : ''}">
        <span class="market-name">${escapeHtml(row.label)}<small class="market-sub">${plural(row.count, 'invoice')}</small></span>
        <div class="market-bar"><span style="width:${(row.total / max) * 100}%"></span></div>
        <span class="market-value">${money(row.total)}</span>
    </div>`).join('');
}

function renderLate() {
    if (!$('#late-view')) return;
    const items = lateInvoices();
    const sum = (list, field) => list.reduce((total, item) => total + item[field], 0);
    const principal = sum(items, 'balance');
    const fees = sum(items, 'fee');
    const interest = sum(items, 'interest');
    const correction = sum(items, 'correction');
    const clients = new Set(items.map((item) => contactKey(item.invoice))).size;

    setText('#late-principal', money(principal));
    setText('#late-invoice-count', plural(items.length, 'invoice'));
    setText('#late-client-count', `from ${plural(clients, 'client')}`);
    setText('#late-charges', money(fees + interest + correction));
    setText('#late-fees', `${money(fees)} fees + ${money(interest)} interest`);
    setText('#late-correction', `+ ${money(correction)} correction`);
    setText('#late-total-due', money(principal + fees + interest + correction));
    renderIndexNote();

    const markets = state.scope === 'all' ? Object.keys(companyLabels) : [state.scope];
    const labels = [...new Set(markets.map((key) => lateRuleLabel(lateRule(key))))];
    setText('#late-rate-label', labels.length === 1 ? labels[0] : 'Per-market rates');
    renderLateRulesPanel(items);

    const averageDays = principal > 0 ? Math.round(items.reduce((total, item) => total + item.days * item.balance, 0) / principal) : 0;
    setText('#late-average-days', items.length ? plural(averageDays, 'day') : DASH);
    setText('#late-oldest', items.length ? plural(items[0].days, 'day') : DASH);

    $('#late-aging').innerHTML = barRows(AGING_BUCKETS.map((bucket) => {
        const rows = items.filter((item) => item.days >= bucket.min && item.days <= bucket.max);
        return { label: bucket.label, count: rows.length, total: sum(rows, 'total') };
    }));

    const allMarkets = lateInvoicesByMarket(items);
    $('#late-markets').innerHTML = barRows(Object.entries(companyLabels).map(([key, label]) => ({
        label,
        count: allMarkets[key]?.count || 0,
        total: allMarkets[key]?.total || 0,
        dimmed: state.scope !== 'all' && state.scope !== key,
    })));

    setText('#late-table-summary', `${number(items.length)} record${items.length === 1 ? '' : 's'}`);
    $('#late-table').closest('table').classList.toggle('shows-service', state.category === 'others');
    $('#late-table').innerHTML = items.map((item) => {
        const { invoice } = item;
        const severity = item.days > 90 ? 'is-critical' : item.days > 30 ? 'is-warning' : '';
        const original = originalBalance(invoice);
        const rule = lateRule(invoice.companyKey);
        const graceNote = rule.source === 'unset'
            ? '<div class="client-sub">rate not set</div>'
            : item.days <= rule.graceDays ? '<div class="client-sub">in grace period</div>' : '';
        return `<tr>
            <td>${escapeHtml(invoice.Contact?.Name || 'Unknown client')}<div class="client-sub">${escapeHtml(invoice.InvoiceNumber || invoice.InvoiceID || 'Unnumbered')}${categoryTag(invoice) ? ` · <span class="category-tag">${escapeHtml(categoryTag(invoice))}</span>` : ''}</div></td>
            ${otherServiceCell(invoice)}
            <td>${escapeHtml(companyLabels[invoice.companyKey] || invoice.company || DASH)}</td>
            <td>${shortDate(invoiceDate(invoice))}</td>
            <td>${shortDate(item.due)}</td>
            <td class="align-right"><span class="days-pill ${severity}">${number(item.days)}</span></td>
            <td class="align-right mono">${moneyExact(item.balance)}${original ? `<div class="client-sub">${escapeHtml(original)}</div>` : ''}</td>
            <td class="align-right mono">${correctionCell(item)}</td>
            <td class="align-right mono">${moneyExact(item.fee)}${graceNote}</td>
            <td class="align-right mono">${moneyExact(item.interest)}</td>
            <td class="align-right mono late-total">${moneyExact(item.total)}</td>
        </tr>`;
    }).join('');

    const empty = $('#late-table-empty');
    empty.textContent = !state.invoices.length && state.sync.phase === 'loading'
        ? 'Loading invoices…'
        : !state.invoices.length && state.sync.phase === 'failed'
            ? 'Could not load invoices.'
            : 'No overdue invoices for this market and service.';
    empty.classList.toggle('is-hidden', items.length > 0);
}

// Por mercado sempre mostra os quatro, mesmo com um mercado selecionado (os outros ficam apagados).
function lateInvoicesByMarket(itemsInView) {
    if (state.scope === 'all') {
        return itemsInView.reduce((map, item) => {
            const entry = map[item.invoice.companyKey] || (map[item.invoice.companyKey] = { count: 0, total: 0 });
            entry.count += 1;
            entry.total += item.total;
            return map;
        }, {});
    }
    return withView('all', state.category, () => lateInvoicesByMarket(lateInvoices()));
}

// ---- Overview ----
// Plano contra realizado do ano selecionado, numa tela só.
// Tudo vem das linhas mensais (buildMonthlyRows) e dos inputs manuais de COGS/margem,
// então os números batem com as abas de origem.

state.summaryPlanChart = null;
state.summaryBridgeChart = null;

const SUMMARY_ROWS = [
    { key: 'actual', label: 'MRR actual', format: moneyOr },
    { key: 'target', label: 'MRR target', format: moneyOr },
    { key: 'attainment', label: 'Attainment', format: (value) => percentOr(value, 0), tone: 'ratio' },
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

    const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`).map((month) => {
        const targets = pick('targets', month);
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

    // O ano "até agora": vai até o último mês com receita registrada.
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

    // Custo e margem só fecham nos meses com COGS lançado. O mês corrente costuma ter
    // receita antes de ter COGS: somar a receita ou o orçamento dele inflaria a margem
    // acumulada e a sobra de orçamento.
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
            // Orçamento comparável: só dos meses que já têm COGS.
            cogsTarget: sumOver(costed, 'cogsTarget'),
            bonusPool: totalOf('bonusPool'),
            // Margem do ano pela receita e pelo COGS acumulados dos mesmos meses, não pela média das margens mensais.
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
    // Último mês com margem, que pode ser anterior ao último mês com receita.
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
        return `<tr><th scope="row">${escapeHtml(row.label)}</th>${cells}</tr>`;
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
}

// Verde acima da meta, vermelho abaixo; para COGS a lógica se inverte.
function summaryTone(row, entry) {
    if (!row.tone) return '';
    const pairs = { ratio: [entry.attainment, 1], retention: [entry.retention, entry.retentionTarget], margin: [entry.margin, entry.marginTarget], cogs: [entry.cogsTarget, entry.cogs] };
    const [value, reference] = pairs[row.tone] || [];
    if (!hasValue(value) || !hasValue(reference)) return '';
    return Number(value) >= Number(reference) ? 'cell-up' : 'cell-down';
}

// ---- Health e ponte da base recorrente: seguem o período do seletor ----
// Os dois blocos usam os meses (calendário) que o período cobre. A base de partida é o
// portfólio (MRR) do mês anterior ao início do período; a de chegada, o do último mês.
// Datas personalizadas que não começam no dia 1 entram pelo mês inteiro.
function summaryRow(name, month) {
    if (!month) return null;
    if (!state.monthlyRows) state.monthlyRows = buildMonthlyRows();
    return (state.monthlyRows[name] || [])
        .find((row) => row.month === month && row.scope === state.scope && row.category === state.category) || null;
}

// Meses com faturamento nesta visão (mercado + serviço). O período é recortado até o último
// deles: um mês ainda sem invoices não é lido como se a base inteira tivesse saído.
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

    // Soma um campo nos meses do período; null quando nenhum mês tem o dado.
    const sumOf = (name, field) => {
        const values = months.map((month) => summaryRow(name, month)).filter((row) => row && hasValue(row[field]));
        return values.length ? values.reduce((total, row) => total + Number(row[field]), 0) : null;
    };

    const invoices = scopedInvoices();
    const bonusEntries = months.map((month) => marginEntryFor(month, invoices)).filter((entry) => entry && hasValue(entry.bonusPool));

    const base = baseRow ? baseRow.mrr : 0;
    const end = endRow ? endRow.mrr : 0;
    // Novo negócio = clientes no 1º mês + variação dos clientes ainda em implantação.
    const firstMonths = sumOf('mrr', 'newBusiness');
    const setup = sumOf('retention', 'setupChange');
    const flows = {
        newBusiness: hasValue(firstMonths) || hasValue(setup) ? (firstMonths || 0) + (setup || 0) : null,
        upsells: sumOf('retention', 'upsells'),
        reactivated: sumOf('retention', 'reactivated'),
        churned: sumOf('retention', 'churned'),
        // Onboarding fees de clientes da base que começaram ou acabaram (não é churn).
        onboarding: sumOf('retention', 'onboardingChange'),
    };
    const explained = base
        + (flows.newBusiness || 0)
        + (flows.upsells || 0)
        + (flows.reactivated || 0)
        - (flows.churned || 0)
        + (flows.onboarding || 0);
    // Diferença que as linhas de serviço não explicam (ex.: rateio de categorias que não fecha 100%).
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
                { type: 'bar', label: 'Actual', data: data.months.map((entry) => (hasValue(entry.actual) && entry.actual > 0 ? entry.actual : null)), backgroundColor: colors.authorised, borderWidth: 0, maxBarThickness: 28 },
                { type: 'line', label: 'Target', data: data.months.map((entry) => (hasValue(entry.target) ? entry.target : null)), borderColor: '#4a544d', borderWidth: 1.5, borderDash: [5, 4], pointRadius: 2, pointBackgroundColor: '#4a544d', spanGaps: true, tension: 0 },
            ],
        },
        options: summaryChartOptions(),
    });
}

// Ponte da base recorrente: as bases do início e do fim como números nas pontas, e as
// movimentações como barras divergentes a partir de um eixo central (saídas à esquerda,
// entradas à direita), na escala da maior movimentação. Barras sobre a base inteira deixavam
// as movimentações achatadas, porque a base é muito maior do que elas.
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

function summaryChartOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
            legend: { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { family: 'Manrope', size: 10 }, color: '#6d6f68' } },
            tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${money(item.parsed.y)}` } },
        },
        scales: {
            x: { grid: { display: false }, ticks: { font: { family: 'DM Mono', size: 10 }, color: '#8a8c84' } },
            y: { grid: { color: '#ece9e2' }, ticks: { font: { family: 'DM Mono', size: 10 }, color: '#8a8c84', callback: (value) => money(value) } },
        },
    };
}

document.querySelectorAll('[data-goto-view]').forEach((button) => button.addEventListener('click', () => {
    const target = document.querySelector(`.nav-item[data-view="${button.dataset.gotoView}"]`);
    if (target) target.click();
}));

// ---- Unit economics ----
// ATV, ARPA, ALT e LTV saem das invoices do Xero; CAC e CPL usam a mídia paga (Google Ads + Meta Ads, via n8n)
// e os outros custos de aquisição lançados à mão.
// Definições:
//   ATV  = receita / número de invoices no período
//   ARPA = receita do mês / clientes ativos no mês
//   ALT  = tempo médio, em meses, entre a primeira e a última invoice dos clientes já perdidos
//   LTV  = ARPA × ALT (receita; a margem entra na nota do card)
//   CAC  = (gasto em Google Ads + Meta Ads + outros custos de aquisição) / novos clientes
//   CPL  = gasto em Google Ads + Meta Ads / leads (conversões primárias do Google + leads do Meta)
// As duas plataformas são somadas: nenhum número do painel é separado por origem.
// Um cliente é considerado perdido após CHURN_GRACE_MONTHS meses sem invoice.
const CHURN_GRACE_MONTHS = 2;

state.unitInputs = {};
state.unitInputsStatus = 'loading';
state.unitInputsError = '';
state.unitEntriesMode = 'all';
state.clientEntriesMode = 'all';
const UNIT_ENDPOINT = 'unit-inputs.php';
// salesMarketingCost guarda os "outros custos de aquisição", somados à mídia paga no CAC.
const UNIT_FIELDS = {
    salesMarketingCost: { kind: 'money' },
    newClients: { kind: 'count' },
};

// ---- Mídia paga (workflow n8n "Chili Finance - Ads (Google + Meta) (CAC/CPL)", via ads.php) ----
// Cada linha traz source 'google' ou 'meta'; adsFor() soma todas, sem distinguir a origem.
const ADS_PLATFORM_LABELS = { google: 'Google Ads', meta: 'Meta Ads' };
state.ads = { status: 'loading', rows: [], accounts: [], errors: [], fetchedAt: null };
const ADS_ENDPOINT = 'ads.php';

async function loadAds() {
    state.ads = { ...state.ads, status: 'loading' };
    renderUnitSection();
    try {
        const response = redirectIfSignedOut(await fetch(ADS_ENDPOINT, { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
        if (body.configured === false) {
            state.ads = { status: 'off', rows: [], accounts: [], errors: body.errors || [], fetchedAt: null };
        } else if (!response.ok) {
            throw new Error((body.errors || []).join(' · ') || `The server answered HTTP ${response.status}.`);
        } else {
            state.ads = { status: 'ready', rows: body.rows || [], accounts: body.accounts || [], errors: body.errors || [], fetchedAt: body.fetchedAt || null };
        }
    } catch (error) {
        state.ads = { status: 'error', rows: [], accounts: [], errors: [error.message], fetchedAt: null };
    }
    renderUnitSection();
}

// Soma a mídia paga (Google + Meta) de um recorte. Campanhas sem serviço no nome ("unassigned") só entram em All.
function adsFor(months, scope = state.scope, category = state.category) {
    if (state.ads.status !== 'ready') return null;
    const wanted = new Set(months);
    const totals = { cost: 0, conversions: 0, unassignedCost: 0, missingFx: 0, rows: 0 };
    state.ads.rows.forEach((row) => {
        if (!wanted.has(row.month) || (scope !== 'all' && row.market !== scope)) return;
        if (category !== 'all' && row.category !== category) {
            if (row.category === 'unassigned' && hasValue(row.costUsd)) totals.unassignedCost += Number(row.costUsd);
            return;
        }
        if (!hasValue(row.costUsd)) { totals.missingFx += 1; return; }
        totals.cost += Number(row.costUsd);
        totals.conversions += Number(row.conversions) || 0;
        totals.rows += 1;
    });
    return totals;
}

function adsAccountsInView(scope = state.scope) {
    // market "all": uma conta só, dividida por país no n8n; vale para qualquer mercado.
    return state.ads.accounts.filter((account) => account.configured && (scope === 'all' || account.market === 'all' || account.market === scope));
}

const unitForm = $('#unit-form');
const unitModal = $('#unit-modal');

async function unitRequest(options = {}) {
    const response = redirectIfSignedOut(await fetch(UNIT_ENDPOINT, { cache: 'no-store', ...options }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `The server answered HTTP ${response.status}.`);
    return body;
}

function storeUnitEntry(entry) {
    state.unitInputs[marginInputKey(entry.month, entry.scope, entry.category)] = entry;
}

async function loadUnitInputs() {
    state.unitInputsStatus = 'loading';
    try {
        const { entries = [] } = await unitRequest();
        state.unitInputs = {};
        entries.forEach(storeUnitEntry);
        state.unitInputsStatus = 'ready';
    } catch (error) {
        state.unitInputsStatus = 'error';
        state.unitInputsError = error.message;
    }
    renderUnitSection();
}

async function saveUnitInput(entry) {
    const { entry: saved } = await unitRequest({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
    });
    storeUnitEntry(saved);
    return saved;
}

function exactUnit(month, scope, category) {
    return state.unitInputs[marginInputKey(month, scope, category)] || null;
}

// Combina somando: custos, leads e novos clientes são aditivos entre serviços e mercados.
function combineUnit(entries) {
    const parts = entries.filter(Boolean);
    if (!parts.length) return null;
    const sum = (field) => {
        const rows = parts.filter((part) => hasValue(part[field]));
        return rows.length ? rows.reduce((total, part) => total + Number(part[field]), 0) : null;
    };
    return {
        salesMarketingCost: sum('salesMarketingCost'),
        newClients: sum('newClients'),
        entryCount: parts.reduce((total, part) => total + (part.entryCount || 1), 0),
    };
}

function resolveUnit(month, scope, category) {
    const exact = exactUnit(month, scope, category);
    if (exact) return exact;
    if (category === 'all') {
        const lines = combineUnit(Object.keys(categoryLabels).map((key) => exactUnit(month, scope, key)));
        if (lines) return lines;
    }
    if (scope === 'all') return combineUnit(Object.keys(companyLabels).map((key) => resolveUnit(month, key, category)));
    return null;
}

// ---- Ciclo de vida por cliente ----
// Esquerda censurada: o n8n só traz invoices a partir de jan/2025, então quem já era
// cliente antes disso tem a data de início truncada e fica fora da média do ALT.
function clientLifetimes() {
    const invoices = scopedInvoices();
    const today = startOfToday();
    const currentMonth = monthKey(today);
    const datasetStart = invoices.reduce((first, invoice) => {
        const date = invoiceDate(invoice);
        return date && (!first || date < first) ? date : first;
    }, null);

    const clients = new Map();
    invoices.forEach((invoice) => {
        const date = invoiceDate(invoice);
        if (!date) return;
        const key = contactKey(invoice);
        const entry = clients.get(key) || { key, name: invoice.Contact?.Name || 'Unknown client', scope: invoice.companyKey, first: date, last: date, revenue: 0, months: new Set(), invoices: 0 };
        if (date < entry.first) entry.first = date;
        if (date > entry.last) entry.last = date;
        entry.revenue += amount(invoice);
        entry.months.add(monthKey(date));
        entry.invoices += 1;
        clients.set(key, entry);
    });

    const cutoff = new Date(today.getFullYear(), today.getMonth() - CHURN_GRACE_MONTHS, 1);
    return [...clients.values()].map((entry) => {
        const lifetime = monthKeysBetween(entry.first, entry.last).length; // meses de calendário, ponta a ponta
        const active = monthKey(entry.last) === currentMonth || entry.last >= cutoff;
        return {
            ...entry,
            lifetime,
            active,
            leftCensored: Boolean(datasetStart) && monthKey(entry.first) === monthKey(datasetStart),
            arpa: lifetime > 0 ? entry.revenue / lifetime : null,
        };
    }).sort((a, b) => b.revenue - a.revenue);
}

function unitMetrics() {
    const { start, end } = periodBounds();
    const window = { start: start || new Date(1970, 0, 1), end: end || new Date(9999, 11, 31) };
    const invoices = scopedInvoices().filter((invoice) => inWindow(invoiceDate(invoice), window));
    const revenue = invoices.reduce((total, invoice) => total + amount(invoice), 0);
    const months = monthKeysBetween(window.start < new Date(1990, 0, 1) ? (invoices.length ? invoiceDate(invoices[0]) : startOfToday()) : window.start, window.end > new Date(9000, 0, 1) ? startOfToday() : window.end);

    const inputs = combineUnit(months.map((month) => resolveUnit(month, state.scope, state.category))) || {};
    const meta = state.scorecardMeta || {};
    const scorecard = state.scorecard || {};
    const newClients = hasValue(inputs.newClients) ? inputs.newClients : (hasValue(meta.newClients) ? meta.newClients : null);

    const clients = clientLifetimes();
    const churned = clients.filter((client) => !client.active && !client.leftCensored);
    const alt = churned.length ? churned.reduce((total, client) => total + client.lifetime, 0) / churned.length : null;

    const activeClients = scorecard.retention ? scorecard.retention.activeClients : null;
    const monthsInWindow = Math.max(1, months.length);
    const arpa = hasValue(activeClients) && activeClients > 0 ? revenue / activeClients / monthsInWindow : null;
    const margin = meta.marginEntry?.margin ?? meta.marginAggregate?.margin ?? null;
    const acquisition = acquisitionFigures(adsFor(months), inputs.salesMarketingCost, newClients);

    return {
        months,
        revenue,
        invoiceCount: invoices.length,
        atv: invoices.length ? revenue / invoices.length : null,
        arpa,
        alt,
        ltv: hasValue(arpa) && hasValue(alt) ? arpa * alt : null,
        margin,
        newClients,
        newClientsFromInvoices: !hasValue(inputs.newClients),
        ...acquisition,
        clients,
        churnedCount: churned.length,
        censoredCount: clients.filter((client) => client.leftCensored).length,
        activeCount: clients.filter((client) => client.active).length,
    };
}

// CAC = (mídia paga + outros custos) / novos clientes; CPL = mídia paga / leads.
function acquisitionFigures(ads, otherCost, newClients) {
    const adsCost = ads ? ads.cost : null;
    const hasAds = Boolean(ads) && ads.rows > 0;
    const other = hasValue(otherCost) ? Number(otherCost) : null;
    const acquisitionCost = hasAds || hasValue(other) ? (hasAds ? adsCost : 0) + (other || 0) : null;
    return {
        ads,
        adsCost: hasAds ? adsCost : (ads ? 0 : null),
        conversions: ads ? ads.conversions : null,
        otherCost: other,
        acquisitionCost,
        cac: hasValue(acquisitionCost) && hasValue(newClients) && newClients > 0 ? acquisitionCost / newClients : null,
        cpl: hasAds && ads.conversions > 0 ? adsCost / ads.conversions : null,
    };
}

function unitCard(key, { value, note, foot, state: tone = 'empty' }) {
    setText(`#unit-${key}-value`, value);
    setText(`#unit-${key}-note`, note);
    setText(`#unit-${key}-foot`, foot);
    const card = $(`#unit-${key}-card`);
    if (card) card.dataset.state = tone;
}

function renderUnitSection() {
    if (!$('#unit-view')) return;
    const metrics = unitMetrics();
    const periodLabel = periodBounds().label;

    unitCard('atv', {
        value: moneyOr(metrics.atv),
        note: `${moneyOr(metrics.revenue)} over ${plural(metrics.invoiceCount, 'invoice')}`,
        foot: periodLabel,
        state: hasValue(metrics.atv) ? 'good' : 'empty',
    });
    unitCard('arpa', {
        value: moneyOr(metrics.arpa),
        note: 'Revenue per active client per month',
        foot: `${plural(metrics.activeCount, 'client')} with invoices in this view`,
        state: hasValue(metrics.arpa) ? 'good' : 'empty',
    });
    unitCard('alt', {
        value: hasValue(metrics.alt) ? `${metrics.alt.toFixed(1)} mo` : DASH,
        note: metrics.churnedCount ? `Average across ${plural(metrics.churnedCount, 'lost client')}` : 'No lost clients with a known start date',
        foot: metrics.censoredCount ? `${plural(metrics.censoredCount, 'client')} left out: they started before the invoice history` : 'All clients have a known start date',
        state: hasValue(metrics.alt) ? 'good' : 'empty',
    });
    unitCard('ltv', {
        value: moneyOr(metrics.ltv),
        note: 'ARPA × ALT, in revenue',
        foot: hasValue(metrics.ltv) && hasValue(metrics.margin) ? `${moneyOr(metrics.ltv * metrics.margin)} at the ${percentOr(metrics.margin)} margin entered` : 'Enter a margin to see it net of COGS',
        state: hasValue(metrics.ltv) ? 'good' : 'empty',
    });
    const costParts = [
        hasValue(metrics.adsCost) ? `ads ${money(metrics.adsCost)}` : null,
        hasValue(metrics.otherCost) ? `other ${money(metrics.otherCost)}` : null,
    ].filter(Boolean).join(' + ');
    unitCard('cac', {
        value: moneyOr(metrics.cac),
        note: hasValue(metrics.acquisitionCost)
            ? `${moneyOr(metrics.acquisitionCost)} over ${hasValue(metrics.newClients) && metrics.newClients > 0 ? plural(metrics.newClients, 'new client') : 'no new clients'}`
            : adsUnavailableNote('No acquisition cost for this period'),
        foot: `${costParts ? `${costParts} · ` : ''}${metrics.newClientsFromInvoices ? 'new clients from the invoices' : 'new clients entered by hand'}`,
        state: hasValue(metrics.cac) ? 'good' : 'empty',
    });
    unitCard('cpl', {
        value: moneyOr(metrics.cpl),
        note: hasValue(metrics.adsCost) && metrics.ads && metrics.ads.rows > 0
            ? `${money(metrics.adsCost)} in ads over ${plural(Math.round(metrics.conversions), 'lead')}`
            : adsUnavailableNote('No ad spend in this period'),
        foot: metrics.ads && metrics.ads.unassignedCost > 0
            ? `${money(metrics.ads.unassignedCost)} from campaigns without a service in the name is left out of ${serviceName(state.category)}`
            : metrics.ads && metrics.ads.missingFx > 0 ? 'Some ad spend has no exchange rate and is left out' : periodLabel,
        state: hasValue(metrics.cpl) ? 'good' : 'empty',
    });
    const ratio = hasValue(metrics.ltv) && hasValue(metrics.cac) && metrics.cac > 0 ? metrics.ltv / metrics.cac : null;
    unitCard('ratio', {
        value: hasValue(ratio) ? `${ratio.toFixed(1)}×` : DASH,
        note: 'How much a client returns for each dollar spent to win them',
        foot: hasValue(ratio) ? (ratio >= 3 ? 'At or above the usual 3× benchmark' : 'Below the usual 3× benchmark') : 'Needs LTV and CAC',
        state: hasValue(ratio) ? (ratio >= 3 ? 'good' : 'behind') : 'empty',
    });
    unitCard('clients', {
        value: hasValue(metrics.newClients) ? number(metrics.newClients) : DASH,
        note: `Won in ${periodLabel.toLowerCase()}`,
        foot: `${plural(metrics.churnedCount, 'client')} lost with a known start date`,
        state: hasValue(metrics.newClients) ? 'good' : 'empty',
    });

    renderUnitInputStatus();
    renderUnitMonthlyTable();
    renderClientTable(metrics.clients);
}

function adsUnavailableNote(fallback) {
    if (state.ads.status === 'loading') return 'Loading ad spend…';
    if (state.ads.status === 'off') return 'Ad accounts are not connected yet';
    if (state.ads.status === 'error') return 'Ad spend could not be loaded';
    if (!adsAccountsInView().length) return `No ad account set up for ${companyLabels[state.scope] || 'this view'}`;
    return fallback;
}

function renderAdsStatus() {
    const node = $('#unit-ads-status');
    if (!node) return;
    const ads = state.ads;
    if (ads.status === 'loading') { node.textContent = 'Loading ad spend…'; node.dataset.tone = 'muted'; return; }
    if (ads.status === 'off') { node.textContent = 'Ad accounts are not connected: set N8N_WEBHOOK_ADS in the .env with the webhook of the n8n workflow.'; node.dataset.tone = 'sample'; return; }
    if (ads.status === 'error') { node.textContent = `Could not load ad spend: ${ads.errors.join(' · ')}`; node.dataset.tone = 'error'; return; }
    const configured = ads.accounts.filter((account) => account.configured);
    const loaded = configured.filter((account) => account.ok);
    const markets = loaded.map((account) => (account.market === 'all' ? 'all markets' : companyLabels[account.market] || account.market));
    const platforms = [...new Set(loaded.map((account) => ADS_PLATFORM_LABELS[account.platform || 'google'] || account.platform))];
    const parts = [
        loaded.length
            ? `${listNames(platforms)} connected for ${listNames([...new Set(markets)])}${ads.fetchedAt ? `, fetched ${relativeTime(new Date(ads.fetchedAt).getTime())}` : ''}. Spend and leads are added together in CAC and CPL.`
            : 'The ads workflow is connected, but no Google Ads or Meta Ads account is set up in n8n yet.',
        ads.errors.length ? `Issues: ${ads.errors.join(' · ')}` : '',
    ].filter(Boolean);
    node.textContent = parts.join(' ');
    node.dataset.tone = ads.errors.length ? 'error' : loaded.length ? 'manual' : 'sample';
}

function renderUnitInputStatus() {
    renderAdsStatus();
    const node = $('#unit-input-status');
    if (!node) return;
    if (state.unitInputsStatus === 'loading') { node.textContent = 'Loading saved figures…'; node.dataset.tone = 'muted'; return; }
    if (state.unitInputsStatus === 'error') { node.textContent = `Could not load saved figures: ${state.unitInputsError}`; node.dataset.tone = 'error'; return; }
    const count = Object.keys(state.unitInputs).length;
    node.textContent = count
        ? `${plural(count, 'entry')} saved. Other acquisition costs are added to the ad spend (Google + Meta) in CAC; leave New clients empty to use the count from the invoices.`
        : 'No other acquisition costs entered. CAC uses only the ad spend (Google + Meta) until you add them (salaries, tools, other channels).';
    node.dataset.tone = count ? 'manual' : 'muted';
}

function unitMonthlyRows() {
    if (!state.monthlyRows) state.monthlyRows = buildMonthlyRows();
    return (state.monthlyRows.mrr || []).map((row) => {
        const input = resolveUnit(row.month, row.scope, row.category);
        const newClients = hasValue(input?.newClients) ? input.newClients : row.newClients;
        return {
            ...row,
            atv: row.invoices ? row.mrr / row.invoices : null,
            arpa: row.clients ? row.mrr / row.clients : null,
            newClients,
            ...acquisitionFigures(adsFor([row.month], row.scope, row.category), input?.salesMarketingCost, newClients),
            hasExactInput: Boolean(exactUnit(row.month, row.scope, row.category)),
        };
    });
}

function renderUnitMonthlyTable() {
    const body = $('#unit-entries-table');
    if (!body) return;
    const all = unitMonthlyRows();
    const mode = state.unitEntriesMode;
    const rows = mode === 'view' ? all.filter(entryInView) : all;
    const inViewCount = all.filter(entryInView).length;
    setText('#unit-entries-summary', mode === 'view'
        ? `${plural(rows.length, 'entry')} of ${number(all.length)}`
        : `${plural(all.length, 'entry')} · ${number(inViewCount)} used in current view`);

    body.innerHTML = rows.map((row) => {
        const used = mode === 'all' && entryInView(row);
        return `<tr class="${used ? 'is-in-view' : ''}"${used ? ' title="Used by the current view"' : ''}>
            <td>${escapeHtml(monthLabel(monthFromKey(row.month)))}</td>
            <td>${escapeHtml(companyLabels[row.scope] || 'Global')}</td>
            <td>${escapeHtml(serviceName(row.category))}</td>
            <td class="align-right mono">${moneyOr(row.mrr)}</td>
            <td class="align-right mono">${number(row.invoices)}</td>
            <td class="align-right mono">${moneyOr(row.atv)}</td>
            <td class="align-right mono">${number(row.clients)}</td>
            <td class="align-right mono">${moneyOr(row.arpa)}</td>
            <td class="align-right mono">${hasValue(row.newClients) ? number(row.newClients) : DASH}</td>
            <td class="align-right mono">${moneyOr(row.adsCost)}</td>
            <td class="align-right mono">${moneyOr(row.otherCost)}</td>
            <td class="align-right mono">${moneyOr(row.cac)}</td>
            <td class="align-right mono">${hasValue(row.conversions) ? number(Math.round(row.conversions)) : DASH}</td>
            <td class="align-right mono">${moneyOr(row.cpl)}</td>
            <td class="align-right entry-actions"><button type="button" class="row-button" data-unit-show="${escapeHtml(row.key)}">Show</button><button type="button" class="row-button" data-unit-edit="${escapeHtml(row.key)}">${row.hasExactInput ? 'Edit' : 'Add costs'}</button></td>
        </tr>`;
    }).join('');

    const empty = $('#unit-entries-empty');
    empty.textContent = !state.invoices.length && state.sync.phase === 'loading'
        ? 'Loading invoices…'
        : !all.length ? 'No billable client invoices yet.'
            : !rows.length ? 'No month matches the current market, service and period.' : '';
    empty.classList.toggle('is-hidden', rows.length > 0);
}

function renderClientTable(clients) {
    const body = $('#client-entries-table');
    if (!body) return;
    const rows = state.clientEntriesMode === 'view' ? clients.filter((client) => !client.active) : clients;
    setText('#client-entries-summary', `${plural(rows.length, 'client')} · ${number(clients.filter((client) => !client.active).length)} lost`);

    body.innerHTML = rows.map((client) => `<tr>
        <td>${escapeHtml(client.name)}${client.leftCensored ? '<div class="client-sub">started before the invoice history</div>' : ''}</td>
        <td>${escapeHtml(companyLabels[client.scope] || DASH)}</td>
        <td>${escapeHtml(monthLabel(client.first))}</td>
        <td>${escapeHtml(monthLabel(client.last))}</td>
        <td class="align-right mono">${number(client.lifetime)}</td>
        <td class="align-right mono">${moneyOr(client.revenue)}</td>
        <td class="align-right mono">${moneyOr(client.arpa)}</td>
        <td class="align-right"><span class="status-pill ${client.active ? 'paid' : 'late'}">${client.active ? 'Active' : 'Lost'}</span></td>
    </tr>`).join('');

    const empty = $('#client-entries-empty');
    empty.textContent = rows.length ? '' : state.invoices.length ? 'No client matches this market and service.' : 'Loading invoices…';
    empty.classList.toggle('is-hidden', rows.length > 0);
}

// ---- Formulário ----
function fillUnitValues(entry) {
    Object.keys(UNIT_FIELDS).forEach((name) => {
        const value = entry ? entry[name] : null;
        unitForm.elements[name].value = hasValue(value) ? String(value) : '';
    });
}

function loadUnitEntryIntoForm() {
    const { month, scope, category } = unitForm.elements;
    const entry = month.value ? exactUnit(month.value, scope.value, category.value) : null;
    fillUnitValues(entry);
    $('#unit-form-submit').textContent = entry ? 'Update figures' : 'Save figures';
}

function showUnitError(message, field) {
    const node = $('#unit-form-error');
    unitForm.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
    node.hidden = !message;
    node.textContent = message || '';
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}

function openUnitModal(entry = null) {
    unitForm.reset();
    showUnitError('');
    unitForm.elements.month.value = entry ? entry.month : monthKey(selectedSingleMonth() || new Date());
    unitForm.elements.scope.value = entry ? entry.scope : state.scope;
    unitForm.elements.category.value = entry ? entry.category : state.category;
    loadUnitEntryIntoForm();
    unitModal.showModal();
}

function closeUnitModal() { unitModal.close(); $('#open-unit-modal').focus(); }

function readUnitForm() {
    const { elements } = unitForm;
    if (!/^\d{4}-\d{2}$/.test(elements.month.value)) { showUnitError('Choose the month these figures belong to.', elements.month); return null; }
    const entry = { month: elements.month.value, scope: elements.scope.value, category: elements.category.value };
    for (const [name, field] of Object.entries(UNIT_FIELDS)) {
        const input = elements[name];
        const label = input.closest('.field').querySelector('span').textContent;
        if (input.value.trim() === '') {
            if (input.validity.badInput) { showUnitError(`${label} is not a valid number.`, input); return null; }
            entry[name] = null;
            continue;
        }
        const value = Number(input.value);
        if (!Number.isFinite(value)) { showUnitError(`${label} is not a valid number.`, input); return null; }
        if (value < 0) { showUnitError(`${label} cannot be negative.`, input); return null; }
        entry[name] = field.kind === 'count' ? Math.round(value) : value;
    }
    if (Object.keys(UNIT_FIELDS).every((name) => entry[name] === null)) {
        showUnitError('Fill in the other acquisition costs or the new clients.', elements.salesMarketingCost);
        return null;
    }
    entry.enteredAt = new Date().toISOString();
    return entry;
}

if (unitForm) {
    $('#open-unit-modal').addEventListener('click', () => openUnitModal());
    unitModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeUnitModal));
    unitModal.addEventListener('click', (event) => { if (event.target === unitModal) closeUnitModal(); });
    ['month', 'scope', 'category'].forEach((name) => unitForm.elements[name].addEventListener('change', loadUnitEntryIntoForm));
    unitForm.addEventListener('input', () => { if (!$('#unit-form-error').hidden) showUnitError(''); });

    unitForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const entry = readUnitForm();
        if (!entry) return;
        const submit = $('#unit-form-submit');
        const label = submit.textContent;
        submit.disabled = true;
        submit.textContent = 'Saving…';
        try {
            const saved = await saveUnitInput(entry);
            closeUnitModal();
            showMarginEntry(saved);
        } catch (error) {
            showUnitError(error.message || 'Could not save the figures.');
        } finally {
            submit.disabled = false;
            submit.textContent = label;
        }
    });

    document.querySelectorAll('.entries-tab[data-unit-table="unit"]').forEach((button) => button.addEventListener('click', () => {
        state.unitEntriesMode = button.dataset.entries;
        document.querySelectorAll('.entries-tab[data-unit-table="unit"]').forEach((item) => item.classList.toggle('is-active', item === button));
        renderUnitMonthlyTable();
    }));
    document.querySelectorAll('.entries-tab[data-unit-table="client"]').forEach((button) => button.addEventListener('click', () => {
        state.clientEntriesMode = button.dataset.entries;
        document.querySelectorAll('.entries-tab[data-unit-table="client"]').forEach((item) => item.classList.toggle('is-active', item === button));
        renderClientTable(clientLifetimes());
    }));

    $('#unit-entries-table').addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        const key = button.dataset.unitShow || button.dataset.unitEdit;
        const [month, scope, category] = String(key).split('|');
        if (button.dataset.unitEdit) { openUnitModal({ month, scope, category, ...(exactUnit(month, scope, category) || {}) }); return; }
        showMarginEntry({ month, scope, category });
        $('#unit-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

// ---- Taxas de encargos editáveis (México, Panamá, International) ----
const rulesForm = $('#rules-form');
const rulesModal = $('#rules-modal');

async function lateRulesRequest(options = {}) {
    const response = redirectIfSignedOut(await fetch(LATE_RULES_ENDPOINT, { cache: 'no-store', ...options }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `The server answered HTTP ${response.status}.`);
    return body;
}

function storeLateRules(rules) {
    state.lateRules = {};
    (rules || []).forEach((rule) => {
        if (EDITABLE_RULE_SCOPES.includes(rule.scope)) state.lateRules[rule.scope] = rule;
    });
}

async function loadLateRules() {
    state.lateRulesStatus = 'loading';
    try {
        const { rules } = await lateRulesRequest();
        storeLateRules(rules);
        state.lateRulesStatus = 'ready';
    } catch (error) {
        state.lateRulesStatus = 'error';
        state.lateRulesError = error.message;
    }
    renderLate();
}

function renderLateRulesPanel(items) {
    const summary = $('#late-rules-summary');
    const status = $('#late-rules-status');
    if (!summary || !status) return;

    summary.innerHTML = Object.entries(companyLabels).map(([key, label]) => {
        const rule = lateRule(key);
        const dimmed = state.scope !== 'all' && state.scope !== key;
        return `<div class="rules-chip${rule.source === 'unset' ? ' is-unset' : ''}${dimmed ? ' is-dimmed' : ''}">
            <span>${escapeHtml(label)}</span><strong>${escapeHtml(lateRuleLabel(rule))}</strong>
        </div>`;
    }).join('');

    if (state.lateRulesStatus === 'loading') { status.textContent = 'Loading saved rates…'; status.dataset.tone = 'muted'; return; }
    if (state.lateRulesStatus === 'error') {
        status.textContent = `Could not load the saved rates, so only Brazil has charges applied: ${state.lateRulesError}`;
        status.dataset.tone = 'error';
        return;
    }
    const unset = EDITABLE_RULE_SCOPES.filter((key) => !state.lateRules[key]);
    const affected = unset.filter((key) => items.some((item) => item.invoice.companyKey === key));
    if (affected.length) {
        status.textContent = `No rate saved for ${affected.map((key) => companyLabels[key]).join(', ')}: their overdue invoices show no charges until you set one.`;
        status.dataset.tone = 'sample';
        return;
    }
    const latest = Object.values(state.lateRules).sort((a, b) => String(b.enteredAt).localeCompare(String(a.enteredAt)))[0];
    status.textContent = latest
        ? `Last changed ${new Date(latest.enteredAt).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${latest.updatedBy ? ` by ${latest.updatedBy}` : ''}.`
        : 'Brazil follows its contract rule. Set the rates for the other markets.';
    status.dataset.tone = latest ? 'manual' : 'muted';
}

const percentField = (value) => (hasValue(value) ? String(Number((Number(value) * 100).toFixed(4))) : '');

function showRulesError(message, field) {
    const node = $('#rules-form-error');
    rulesForm.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
    node.hidden = !message;
    node.textContent = message || '';
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}

function openRulesModal() {
    rulesForm.reset();
    showRulesError('');
    EDITABLE_RULE_SCOPES.forEach((key) => {
        const rule = state.lateRules[key];
        rulesForm.elements[`${key}-lateFee`].value = rule ? percentField(rule.lateFee) : '';
        rulesForm.elements[`${key}-monthlyInterest`].value = rule ? percentField(rule.monthlyInterest) : '';
        rulesForm.elements[`${key}-graceDays`].value = rule ? String(rule.graceDays) : '';
    });
    const latest = Object.values(state.lateRules).sort((a, b) => String(b.enteredAt).localeCompare(String(a.enteredAt)))[0];
    setText('#rules-form-meta', latest
        ? `Last saved ${new Date(latest.enteredAt).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${latest.updatedBy ? ` by ${latest.updatedBy}` : ''}. A blank field counts as zero.`
        : 'Nothing saved yet. A blank field counts as zero.');
    rulesModal.showModal();
    rulesForm.elements['mx-lateFee'].focus();
}

function closeRulesModal() { rulesModal.close(); $('#open-rules-modal').focus(); }

function readRulesForm() {
    const rules = [];
    for (const key of EDITABLE_RULE_SCOPES) {
        const market = companyLabels[key];
        const read = (name, label, { max, whole = false }) => {
            const input = rulesForm.elements[`${key}-${name}`];
            if (input.value.trim() === '') {
                if (input.validity.badInput) { showRulesError(`${market}: ${label} is not a valid number.`, input); return undefined; }
                return 0;
            }
            const value = Number(input.value);
            if (!Number.isFinite(value)) { showRulesError(`${market}: ${label} is not a valid number.`, input); return undefined; }
            if (value < 0 || value > max) { showRulesError(`${market}: ${label} must be between 0 and ${max}${whole ? ' days' : '%'}.`, input); return undefined; }
            if (whole && !Number.isInteger(value)) { showRulesError(`${market}: ${label} must be a whole number of days.`, input); return undefined; }
            return value;
        };
        const lateFee = read('lateFee', 'late fee', { max: 100 });
        if (lateFee === undefined) return null;
        const monthlyInterest = read('monthlyInterest', 'monthly interest', { max: 100 });
        if (monthlyInterest === undefined) return null;
        const graceDays = read('graceDays', 'grace period', { max: 365, whole: true });
        if (graceDays === undefined) return null;
        rules.push({ scope: key, lateFee: lateFee / 100, monthlyInterest: monthlyInterest / 100, graceDays });
    }
    return rules;
}

if (rulesForm) {
    $('#open-rules-modal').addEventListener('click', openRulesModal);
    rulesModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeRulesModal));
    rulesModal.addEventListener('click', (event) => { if (event.target === rulesModal) closeRulesModal(); });
    rulesForm.addEventListener('input', () => { if (!$('#rules-form-error').hidden) showRulesError(''); });

    rulesForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const rules = readRulesForm();
        if (!rules) return;
        const submit = $('#rules-form-submit');
        const label = submit.textContent;
        submit.disabled = true;
        submit.textContent = 'Saving…';
        try {
            const body = await lateRulesRequest({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rules }),
            });
            storeLateRules(body.rules);
            state.lateRulesStatus = 'ready';
            closeRulesModal();
            renderLate();
        } catch (error) {
            showRulesError(error.message || 'Could not save the rates.');
        } finally {
            submit.disabled = false;
            submit.textContent = label;
        }
    });
}

// ---- Importação da planilha de metas (Overview) ----
// O servidor lê o .xlsx duas vezes: uma para a prévia (nada é gravado) e outra na
// confirmação, que grava tudo numa transação em mrr_targets e margin_inputs.
const IMPORT_ENDPOINT = 'sheet-import.php';
const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const IMPORT_COLUMNS = [
    ['totalMrrTarget', 'Target MRR'],
    ['cogs', 'COGS'],
    ['cogsTarget', 'Target COGS'],
    ['margin', 'Margin'],
    ['marginTarget', 'Target margin'],
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

// Status do botão: vem das próprias tabelas mrr_targets e margin_inputs (campo enteredAt),
// então funciona igual para figuras importadas ou digitadas no modal.
function renderImportStatus() {
    const node = $('#import-status');
    if (!node) return;
    if (state.marginInputsStatus === 'loading' || state.targetInputsStatus === 'loading') { node.textContent = ''; node.dataset.tone = 'muted'; return; }
    const result = state.importResult;
    if (result) {
        node.textContent = `Imported ${plural(result.figures, 'figure')} from ${result.fileName} for ${importSpan(result.from, result.to)}. They now show here, in Targets and in Margin & COGS.`;
        node.dataset.tone = 'manual';
        return;
    }
    const entries = [...Object.values(state.marginInputs || {}), ...Object.values(state.targetInputs || {})];
    const latest = entries.map((entry) => entry.enteredAt).filter(Boolean).sort().pop();
    if (!latest) {
        node.textContent = 'Fills Target MRR, COGS and margins for every market from the finance spreadsheet.';
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
        fileInput.value = ''; // permite escolher o mesmo arquivo de novo depois de corrigi-lo
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
            await Promise.all([loadMarginInputs(), loadTargetInputs()]);
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

renderScorecard();
loadMarginInputs();
loadTargetInputs();
loadBrIndices();
loadUnitInputs();
loadLateRules();
loadAds();