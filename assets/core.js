const CAN_MANUAL_INPUTS = document.body.dataset.manualInputs !== 'off';
const state = { invoices: [], sourceTypeCounts: {}, categoryCounts: {}, scope: 'all', category: 'all', period: 'current', customStart: '', customEnd: '', statusChart: null, mrrChart: null };
const companyLabels = { br: 'Brazil', mx: 'Mexico', pa: 'Panama', int: 'International' };
const categoryLabels = { seo: 'SEO', ppc: 'PPC', others: 'Others' };
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
    const list = (invoice.categories || []).flatMap((key) => {
        if (key !== 'others') return [categoryLabels[key]];
        const services = otherServicesOf(invoice).map((service) => otherServiceLabels[service]);
        return services.length ? services : [categoryLabels.others];
    }).filter(Boolean);
    return list.length ? list.join(' + ') : '';
}

function amount(invoice) { return fullAmount(invoice) * categoryShare(invoice); }

function fullAmount(invoice) {
    const pick = (source) => [source.SubTotal, source.Total, source.AmountDue]
        .find((value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)));
    const usd = invoice.amounts_usd;
    if (usd) {
        const value = pick(usd);
        if (value !== undefined) return Number(value);
    }
    const local = pick(invoice);
    return Number(local ?? 0) * Number(invoice.usdRate || 1);
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

const STALE_AFTER_MINUTES = 17 * 24 * 60;
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

    if (sync.phase === 'refreshing') {
        return { tone: 'loading', title: 'Fetching new data…', detail: `Asking n8n for invoices from ${keys.length} Xero companies and ads · ${elapsed}s` };
    }
    if (sync.phase === 'loading') {
        return { tone: 'loading', title: 'Loading data…', detail: 'Reading the saved data' };
    }
    if (sync.phase === 'failed') {
        return sync.finishedAt
            ? { tone: 'error', title: 'Refresh failed', detail: `Still showing data fetched ${relativeTime(sync.dataAt || sync.finishedAt)}. ${shortReason(sync.error)}.` }
            : { tone: 'error', title: 'No connection', detail: `Could not load invoices (${shortReason(sync.error)}). Press Refresh to try again.` };
    }
    if (failed.length === keys.length) {
        return { tone: 'error', title: 'No data yet', detail: 'Nothing saved for any company. Press Refresh to fetch it from n8n.' };
    }
    const updated = `${plural(state.invoices.length, 'invoice')} · fetched ${relativeTime(sync.dataAt || sync.finishedAt)}`;
    if (failed.length) {
        return { tone: 'partial', title: `${keys.length - failed.length} of ${keys.length} companies loaded`, detail: `${listNames(failed.map((key) => companyLabels[key]))} missing from totals · ${updated}` };
    }
    if ((Date.now() - (sync.dataAt || sync.finishedAt)) / 60000 > STALE_AFTER_MINUTES) {
        return { tone: 'stale', title: 'Data may be outdated', detail: `Last fetched ${relativeTime(sync.dataAt)}. Press Refresh for the latest invoices.` };
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
            title: [`${plural(source.count, 'invoice')}${source.fetchedAt ? `, fetched ${new Date(source.fetchedAt).toLocaleString()}` : ''}${hasValue(source.seconds) ? ` in ${source.seconds}s` : ''}`, ...warnings].join(' · '),
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
        state.cogsBills = Array.isArray(data.cogsLines) ? data.cogsLines : [];
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
                fetchedAt: (data.sourceFetchedAt || {})[key] || null,
            };
        });
        const fetchedTimes = Object.values(state.sync.sources).map((source) => Date.parse(source.fetchedAt || '')).filter(Number.isFinite);
        state.sync.dataAt = fetchedTimes.length ? Math.min(...fetchedTimes) : null;
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

setInterval(() => { if (state.sync.phase === 'loading' || state.sync.phase === 'refreshing' || state.sync.finishedAt) renderSyncStatus(); }, 1000);

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

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character])); }

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

// Chave do cliente na retenção. O ContactID do Xero é diferente em cada organização, então o mesmo cliente
// que passa de um mercado para outro (ex.: DG para BR) virava um cliente perdido e outro novo. Aqui o nome
// identifica o cliente entre mercados; sem nome, cai no ContactID.
function retentionKey(invoice) {
    const name = String(invoice.Contact?.Name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    return name || contactKey(invoice);
}

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

function onboardingLineAmount(invoice, line) {
    const share = Number(invoice.onboardingShares?.[line]) || 0;
    return share ? fullAmount(invoice) * share : 0;
}

// Multa de rescisão (break fee): receita não recorrente, cobrada quando o cliente sai.
// Fica fora de todo o MRR; as abas Invoices e Late invoices seguem mostrando o valor cheio da fatura.
function breakFeeLineAmount(invoice, line) {
    const share = Number(invoice.breakFeeShares?.[line]) || 0;
    return share ? fullAmount(invoice) * share : 0;
}

function breakFeeAmount(invoice) {
    const shares = invoice.breakFeeShares;
    if (!shares) return 0;
    const keys = state.category === 'all' ? Object.keys(shares) : [state.category];
    const share = keys.reduce((sum, key) => sum + (Number(shares[key]) || 0), 0);
    return share ? fullAmount(invoice) * share : 0;
}

/** Valor que entra no MRR: a fatura sem a multa de rescisão. */
function mrrAmount(invoice) { return amount(invoice) - breakFeeAmount(invoice); }

function mrrLineAmount(invoice, line) { return lineAmount(invoice, line) - breakFeeLineAmount(invoice, line); }

// Base da retenção: MRR sem a onboarding fee.
function recurringLineAmount(invoice, line) { return mrrLineAmount(invoice, line) - onboardingLineAmount(invoice, line); }

function onboardingAmount(invoice) {
    const shares = invoice.onboardingShares;
    if (!shares) return 0;
    const keys = state.category === 'all' ? Object.keys(shares) : [state.category];
    const share = keys.reduce((sum, key) => sum + (Number(shares[key]) || 0), 0);
    return share ? fullAmount(invoice) * share : 0;
}

function recurringAmount(invoice) { return mrrAmount(invoice) - onboardingAmount(invoice); }

const SETUP_MONTHS = 3;
const CHURN_MIN_USD = 0.5;
const monthsApart = (from, to) => (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();

function upsellAmount(invoice, line) {
    if (invoice.upsellShares) return fullAmount(invoice) * (Number(invoice.upsellShares[line]) || 0);
    return invoice.flags && invoice.flags.upsell ? lineAmount(invoice, line) : 0;
}

function totalsByContactLine(invoices) {
    const map = new Map();
    invoices.forEach((invoice) => {
        const key = retentionKey(invoice);
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
        const key = retentionKey(invoice);
        map.set(key, (map.get(key) || 0) + mrrAmount(invoice));
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
        actual: invoices.filter((invoice) => inWindow(invoiceDate(invoice), month)).reduce((sum, invoice) => sum + mrrAmount(invoice), 0),
        target: resolveTarget(monthKey(month.start), state.scope, state.category)?.totalMrrTarget ?? null,
    }));
}

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
        const key = retentionKey(invoice);
        const known = firstSeen.get(key);
        if (!known || date < known) firstSeen.set(key, date);
        if (!billedMonths.has(key)) billedMonths.set(key, new Set());
        billedMonths.get(key).add(monthKey(date));
    });
    const lastBilled = new Map();
    billedMonths.forEach((months, key) => lastBilled.set(key, [...months].sort().pop()));
    return { invoices, everyLine, byMonth, everyByMonth, firstSeen, billedMonths, lastBilled, datasetStart };
}

function isInSetup(ctx, key, month) {
    const first = ctx.firstSeen.get(key);
    if (!first || !ctx.datasetStart) return false;
    const firstMonth = new Date(first.getFullYear(), first.getMonth(), 1);
    if (monthKey(firstMonth) <= monthKey(ctx.datasetStart)) return false;
    const index = monthsApart(firstMonth, month);
    return index >= 1 && index <= SETUP_MONTHS;
}

// Cliente que paga toda semana: faturas em 3 ou mais semanas distintas do mês. Enquanto o mês em andamento
// não fecha, ele só tem as semanas já faturadas, e comparar isso com o mês cheio vira um downgrade falso.
function weeklyPayers(invoices) {
    const weeks = new Map();
    invoices.forEach((invoice) => {
        const date = invoiceDate(invoice);
        if (!date) return;
        const key = retentionKey(invoice);
        if (!weeks.has(key)) weeks.set(key, new Set());
        weeks.get(key).add(Math.floor((date.getDate() - 1) / 7));
    });
    return new Set([...weeks].filter(([, set]) => set.size >= 3).map(([key]) => key));
}

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

function invoicesInWindow(list, buckets, window) {
    if (isCalendarMonth(window.start, window.end)) return buckets.get(monthKey(window.start)) || [];
    return list.filter((invoice) => inWindow(invoiceDate(invoice), window));
}

// Retenção em câmbio constante. Cada fatura é convertida para USD pela cotação do mês dela, então o mesmo
// valor em BRL ou MXN virava um USD diferente no mês seguinte e a comparação lia isso como queda (churn).
// Aqui o mês anterior é reconvertido pela cotação do mês atual (a fatura já traz o valor local e a taxa),
// e só uma queda de valor na moeda local conta como churn. Faturas em USD não mudam.
function invoiceCurrency(invoice) {
    return String(invoice.CurrencyCode || invoice.companyCurrency || 'USD').toUpperCase();
}

function restateAtCurrentRates(previous, currentInvoices, meta) {
    const reference = new Map();
    currentInvoices.forEach((invoice) => {
        const rate = Number(invoice.usdRate);
        const date = invoiceDate(invoice);
        if (!date || !(rate > 0)) return;
        const code = invoiceCurrency(invoice);
        const known = reference.get(code);
        if (!known || date > known.date) reference.set(code, { date, rate });
    });
    return previous.map((invoice) => {
        const known = reference.get(invoiceCurrency(invoice));
        const own = Number(invoice.usdRate);
        if (!known || !(own > 0)) return invoice;
        const factor = known.rate / own;
        if (Math.abs(factor - 1) < 0.0001) return invoice;
        meta.fxRestated = true;
        const usd = invoice.amounts_usd
            ? Object.fromEntries(Object.entries(invoice.amounts_usd).map(([field, value]) => [field, value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) * factor : value]))
            : invoice.amounts_usd;
        return { ...invoice, usdRate: known.rate, amounts_usd: usd };
    });
}

function measureWindow(ctx, windows, meta) {
    const current = invoicesInWindow(ctx.invoices, ctx.byMonth, windows.current);
    const previous = restateAtCurrentRates(
        invoicesInWindow(ctx.invoices, ctx.byMonth, windows.previous),
        invoicesInWindow(ctx.everyLine, ctx.everyByMonth, windows.current),
        meta,
    );
    const currentByContact = totalsByContact(current);
    const baseContacts = new Set(invoicesInWindow(ctx.everyLine, ctx.everyByMonth, windows.previous).map(retentionKey));
    const currentLines = totalsByContactLine(current);
    const previousLines = totalsByContactLine(previous);
    const historyAvailable = Boolean(ctx.datasetStart) && ctx.datasetStart < windows.current.start;

    const newContacts = new Set();
    current.forEach((invoice) => {
        if (invoice.flags && invoice.flags.firstMonth) { newContacts.add(retentionKey(invoice)); meta.markedFirstMonth += 1; }
        if (invoice.flags && invoice.flags.upsell) {
            meta.markedUpsell += 1;
            if (!baseContacts.has(retentionKey(invoice))) meta.upsellOutsideBase += 1;
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

    let initial = previous.reduce((sum, invoice) => sum + recurringAmount(invoice), 0);
    const onboardingInBase = previous.reduce((sum, invoice) => sum + onboardingAmount(invoice), 0);
    const month = windows.current.start;
    const monthly = isCalendarMonth(windows.current.start, windows.current.end);
    let churnedLost = 0;
    let churnedDowngrade = 0;
    let churnedServiceChange = 0;
    let expansion = 0;
    let onboardingChange = 0;
    let setupChange = 0;
    const setupClients = new Set();
    const churnedClients = meta.collectClients ? [] : null;
    const today = new Date();
    const partialMonth = monthly && today >= windows.current.start && today <= windows.current.end;
    const weekly = partialMonth ? weeklyPayers(previous) : new Set();
    baseContacts.forEach((key) => {
        const before = previousLines.get(key) || new Map();
        const after = currentLines.get(key) || new Map();
        let beforeTotal = 0;
        let afterTotal = 0;
        let tagged = 0;
        let newLines = 0;
        const droppedLines = [];
        const removedLines = [];
        const linesBefore = [];
        const linesAfter = [];
        linesInView().forEach((line) => {
            const previousValue = before.get(line)?.value || 0;
            const currentValue = after.get(line)?.value || 0;
            tagged += Math.min(after.get(line)?.tagged || 0, Math.max(currentValue, 0));
            if (currentValue < previousValue - 0.005) droppedLines.push(line);
            if (previousValue > 0.005 && currentValue <= 0.005) removedLines.push(line);
            if (previousValue > 0.005) linesBefore.push(line);
            if (currentValue > 0.005) linesAfter.push(line);
            if (line !== 'other' && previousValue <= 0 && currentValue > 0) newLines += 1;
            onboardingChange += (after.get(line)?.onboarding || 0) - (before.get(line)?.onboarding || 0);
            beforeTotal += previousValue;
            afterTotal += currentValue;
        });
        const lost = beforeTotal > 0 && Math.abs(afterTotal) < 0.005;

        if (monthly && isInSetup(ctx, key, month) && !(lost && stoppedForGood(ctx, key, month))) {
            initial -= beforeTotal;
            setupChange += afterTotal - beforeTotal;
            setupClients.add(key);
            return;
        }

        // Pagador semanal no mês em andamento: só conta como perdido depois de 2 semanas sem nenhuma fatura.
        if (weekly.has(key) && !(lost && today.getDate() > 14)) return;

        const delta = afterTotal - beforeTotal;
        const up = Math.max(delta, 0, tagged);
        // Resíduo de câmbio/arredondamento (frações de centavo) não é churn: abaixo de US$ 0,50 o valor exibido seria $0.
        const rawChurn = up - delta;
        const clientChurn = rawChurn >= CHURN_MIN_USD ? rawChurn : 0;
        const kind = lost ? 'lost' : removedLines.length ? 'serviceChange' : 'downgrade';
        expansion += up;
        if (kind === 'lost') churnedLost += clientChurn;
        else if (kind === 'serviceChange') churnedServiceChange += clientChurn;
        else churnedDowngrade += clientChurn;
        if (tagged > 0) meta.taggedUpsell += tagged;
        meta.crossSells += newLines;
        if (lost) meta.lostClients += 1;
        if (churnedClients && clientChurn > 0) {
            const lines = droppedLines.length ? droppedLines : linesInView().filter((line) => (before.get(line)?.value || 0) > 0);
            churnedClients.push({ key, month: monthKey(month), before: beforeTotal, after: afterTotal, churned: clientChurn, lines, lost, kind, linesBefore, linesAfter });
        }
    });
    if (churnedClients) meta.churnedClients = describeChurnedClients(churnedClients, ctx, windows);

    let newBusiness = 0;
    let reactivated = 0;
    currentByContact.forEach((value, key) => {
        if (baseContacts.has(key)) return;
        if (newContacts.has(key)) { newBusiness += value; meta.newClients += 1; return; }
        if (monthly && isInSetup(ctx, key, month)) { setupChange += value; setupClients.add(key); return; }
        reactivated += value;
    });
    meta.setupClients = setupClients.size;

    meta.invoiceCount = current.length;
    meta.reactivated = reactivated;

    const churned = churnedLost + churnedDowngrade + churnedServiceChange;

    return {
        hasBase: baseContacts.size > 0,
        initial,
        churned,
        churnedLost,
        churnedDowngrade,
        churnedServiceChange,
        expansion,
        retained: initial - churned,
        onboardingInBase,
        onboardingChange,
        setupChange,
        activeClients: currentByContact.size,
        newBusiness,
        reactivated,
        totalMrr: current.reduce((sum, invoice) => sum + mrrAmount(invoice), 0),
        recurringMrr: current.reduce((sum, invoice) => sum + recurringAmount(invoice), 0),
        invoiceCount: current.length,
    };
}

function retentionOverWindow(ctx, window) {
    const lastBilled = [...ctx.byMonth.keys()].sort().pop();
    let months = monthKeysBetween(window.start, window.end);
    if (lastBilled) months = months.filter((key) => key <= lastBilled);
    if (!months.length) months = [monthKey(window.start)];

    const monthWindow = (date) => ({ start: date, end: endOfMonth(date), label: monthLabel(date) });
    const firstMonth = monthFromKey(months[0]);
    const baseWindow = monthWindow(new Date(firstMonth.getFullYear(), firstMonth.getMonth() - 1, 1));
    const endWindow = monthWindow(monthFromKey(months[months.length - 1]));

    const totals = { hasBase: false, initial: null, onboardingInBase: 0, churned: 0, churnedLost: 0, churnedDowngrade: 0, churnedServiceChange: 0, expansion: 0, taggedUpsell: 0, crossSells: 0, upsellOutsideBase: 0, fxRestated: false };
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
        totals.churnedLost += m.churnedLost;
        totals.churnedDowngrade += m.churnedDowngrade;
        totals.churnedServiceChange += m.churnedServiceChange;
        totals.expansion += m.expansion;
        totals.taggedUpsell += meta.taggedUpsell;
        totals.crossSells += meta.crossSells;
        totals.upsellOutsideBase += meta.upsellOutsideBase;
        if (meta.fxRestated) totals.fxRestated = true;
        if (m.hasBase && m.initial > 0) {
            monthly.push({ key, label: current.label, initial: m.initial, churned: m.churned, churnedLost: m.churnedLost, churnedContraction: m.churnedDowngrade + m.churnedServiceChange, expansion: m.expansion, retained: m.retained, rate: share(m.retained, m.initial) });
        }
        (meta.churnedClients || []).forEach((item) => events.push({ ...item, month: key }));
        setupMonths.push({ clients: meta.setupClients, change: m.setupChange });
    });

    const endTotals = totalsByContact(invoicesInWindow(ctx.invoices, ctx.byMonth, endWindow));
    const endKey = monthKey(endWindow.start);
    const churnedClients = describeChurnedClients(events, ctx, { current: endWindow })
        .map((item) => ({ ...item, returned: item.lost && item.month < endKey && Math.abs(endTotals.get(item.key) || 0) >= 0.005 }))
        .sort((a, b) => b.month.localeCompare(a.month) || b.churned - a.churned || a.name.localeCompare(b.name));

    const pooled = (field) => monthly.reduce((sum, row) => sum + row[field], 0);
    const pooledInitial = pooled('initial');
    const rate = pooledInitial > 0 ? pooled('retained') / pooledInitial : null;

    return {
        ...totals,
        retained: hasValue(totals.initial) ? totals.initial - totals.churned : null,
        rate,
        churnRate: pooledInitial > 0 ? pooled('churned') / pooledInitial : null,
        lostRate: pooledInitial > 0 ? pooled('churnedLost') / pooledInitial : null,
        contractionRate: pooledInitial > 0 ? pooled('churnedContraction') / pooledInitial : null,
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

function contractionOf(row) {
    return (Number(row.downgrade) || 0) + (Number(row.serviceChange) || 0);
}

function churnTotalOf(row) {
    if (!row || !hasValue(row.lost)) return null;
    return Number(row.lost) + contractionOf(row);
}

function emptyScorecardMeta() {
    return { invoiceCount: 0, markedFirstMonth: 0, markedUpsell: 0, taggedUpsell: 0, crossSells: 0, upsellOutsideBase: 0, reactivated: null, newClients: 0, lostClients: 0, detection: 'none' };
}

function buildScorecard() {
    const manual = USE_DEMO_TARGETS ? DEMO_MANUAL_INPUTS : MANUAL_INPUTS;
    const scorecard = {
        retention: { initialPortfolio: null, churned: null, lost: null, downgrade: null, serviceChange: null, contraction: null, lostRate: null, contractionRate: null, upsells: null, retained: null, rate: null, churnRate: null, expansionRate: null, netRate: null, target: manual.retentionTarget, activeClients: null },
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
    const contractionEvents = retention.churnedClients.filter((item) => !item.lost);
    meta.churnedClients = retention.churnedClients.filter((item) => item.lost);
    meta.contractionClients = meta.latestOnly ? [] : contractionEvents;
    meta.hiddenDowngrades = meta.latestOnly && contractionEvents.length
        ? { count: contractionEvents.length, value: contractionEvents.reduce((sum, item) => sum + item.churned, 0), month: retention.endLabel }
        : null;
    meta.lostClients = retention.lostClients;
    meta.retentionMonthly = retention.monthly;
    meta.onboardingInBase = retention.onboardingInBase;
    meta.fxRestated = retention.fxRestated;
    meta.setupClients = retention.setupClients;
    meta.taggedUpsell = retention.taggedUpsell;
    meta.crossSells = retention.crossSells;
    meta.upsellOutsideBase = retention.upsellOutsideBase;
    scorecard.retention.initialPortfolio = retention.hasBase ? retention.initial : null;
    scorecard.retention.churned = retention.hasBase ? retention.churned : null;
    scorecard.retention.lost = retention.hasBase ? retention.churnedLost : null;
    scorecard.retention.downgrade = retention.hasBase ? retention.churnedDowngrade : null;
    scorecard.retention.serviceChange = retention.hasBase ? retention.churnedServiceChange : null;
    scorecard.retention.contraction = retention.hasBase ? retention.churnedDowngrade + retention.churnedServiceChange : null;
    scorecard.retention.lostRate = retention.hasBase ? retention.lostRate : null;
    scorecard.retention.contractionRate = retention.hasBase ? retention.contractionRate : null;
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

function describeChurnedClients(list, ctx, windows) {
    const wanted = new Set(list.map((item) => item.key));
    const info = new Map();
    ctx.invoices.forEach((invoice) => {
        const key = retentionKey(invoice);
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

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const marginInputKey = (month, scope, category) => `${month}|${scope}|${category}`;
const monthFromKey = (key) => { const [year, month] = key.split('-').map(Number); return new Date(year, month - 1, 1); };

function selectedSingleMonth() {
    const { start, end } = periodBounds();
    return start && end && isCalendarMonth(start, end) ? start : null;
}

function manualMarginEntryFor(month, invoices, scope = state.scope, category = state.category) {
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
            .map((key) => manualMarginEntryFor(month, invoices, key, category))
            .filter(Boolean);
        if (markets.length) return combineMarginParts(month, markets, scope, category, true);
    }
    return null;
}

function marginPartRevenue(monthInvoices, part) {
    return monthInvoices.reduce((total, invoice) => {
        if (part.scope !== 'all' && invoice.companyKey !== part.scope) return total;
        const shares = invoice.breakFeeShares || {};
        const share = part.category === 'all' ? 1 : categoryShare(invoice, part.category);
        const breakFee = part.category === 'all'
            ? Object.values(shares).reduce((sum, value) => sum + (Number(value) || 0), 0)
            : Number(shares[part.category]) || 0;
        return total + fullAmount(invoice) * Math.max(0, share - breakFee);
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

// ---- COGS lido do Xero, somado por cima do COGS lançado à mão ----
// Fontes: bills (ACCPAY) vindas do api.php e Spend Money vindas do workflow de custos (costs.php).
// Cada linha traz mercado, mês, conta, serviço (centro de custo) e costUsd.
function cogsLines() {
    return [...(state.cogsBills || []), ...((state.costs && state.costs.cogsRows) || [])];
}

function cogsIndex() {
    const cache = state.cogsIndexCache;
    if (cache && cache.bills === state.cogsBills && cache.costs === state.costs) return cache.byMonth;
    const byMonth = new Map();
    cogsLines().forEach((line) => {
        if (!hasValue(line.costUsd)) return;
        if (!byMonth.has(line.month)) byMonth.set(line.month, []);
        byMonth.get(line.month).push(line);
    });
    state.cogsIndexCache = { bills: state.cogsBills, costs: state.costs, byMonth };
    return byMonth;
}

function xeroCogsFor(month, scope = state.scope, category = state.category) {
    const lines = (cogsIndex().get(month) || [])
        .filter((line) => (scope === 'all' || line.market === scope) && (category === 'all' || line.service === category));
    if (!lines.length) return null;
    const byAccount = {};
    let total = 0;
    lines.forEach((line) => {
        total += Number(line.costUsd);
        byAccount[line.account] = (byAccount[line.account] || 0) + Number(line.costUsd);
    });
    return { total, byAccount, lines: lines.length };
}

function mergeXeroCogs(list) {
    const parts = list.filter(Boolean);
    if (!parts.length) return null;
    const byAccount = {};
    parts.forEach((part) => Object.entries(part.byAccount).forEach(([account, value]) => { byAccount[account] = (byAccount[account] || 0) + value; }));
    return { total: parts.reduce((sum, part) => sum + part.total, 0), byAccount, lines: parts.reduce((sum, part) => sum + part.lines, 0) };
}

function marginEntryFor(month, invoices, scope = state.scope, category = state.category) {
    const manual = manualMarginEntryFor(month, invoices, scope, category);
    const xero = xeroCogsFor(month, scope, category);
    if (!xero) return manual;
    if (!manual) {
        return { month, scope, category, cogs: xero.total, cogsTarget: null, margin: null, marginTarget: null, bonusPool: null, combinedFrom: [], enteredAt: null, xero };
    }
    // Sem "revenue": com o Xero somado, a parcela do COGS sobre a receita usa a receita do mês inteiro.
    const { revenue, ...rest } = manual;
    return { ...rest, cogs: hasValue(manual.cogs) ? Number(manual.cogs) + xero.total : xero.total, xero };
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
    cogsIndex().forEach((lines, month) => {
        if ((from && month < from) || (to && month > to)) return;
        if (lines.some((line) => (state.scope === 'all' || line.market === state.scope) && (state.category === 'all' || line.service === state.category))) months.add(month);
    });
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
        revenueByMonth.set(key, (revenueByMonth.get(key) || 0) + mrrAmount(invoice));
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
        xero: mergeXeroCogs(entries.map((entry) => entry.xero)),
    };
}

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

const MONEY_TARGETS = ['totalMrrTarget'];

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
        const actual = invoices.filter((invoice) => inWindow(invoiceDate(invoice), window)).reduce((sum, invoice) => sum + mrrAmount(invoice), 0);
        gap += actual - Number(target);
        months += 1;
        first = first || month;
        last = month;
    });
    return months ? { gap, months, from: monthLabel(first), to: monthLabel(last) } : null;
}

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
                    lost: m.hasBase ? m.churnedLost : null,
                    downgrade: m.hasBase ? m.churnedDowngrade : null,
                    serviceChange: m.hasBase ? m.churnedServiceChange : null,
                    upsells: m.hasBase ? m.expansion : null,
                    retained: m.hasBase ? m.retained : null,
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
            (row) => `<td class="align-right mono">${hasValue(row.lost) ? `<span class="${row.lost > 0 ? 'value-down' : ''}">${moneyOr(row.lost)}</span>` : DASH}</td>`,
            (row) => `<td class="align-right mono">${hasValue(row.downgrade) ? `<span class="${contractionOf(row) > 0 ? 'value-down' : ''}">${moneyOr(contractionOf(row))}</span>` : DASH}</td>`,
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

const LATE_CHARGE_RULES = {
    default: { lateFee: 0, monthlyInterest: 0, graceDays: 0, correction: [] },
    br: { lateFee: 0.10, monthlyInterest: 0.01, graceDays: 0, correction: ['igpm', 'ipca'] },
};
const INDEX_LABELS = { igpm: 'IGP-M', ipca: 'IPCA' };
const DAY_MS = 24 * 60 * 60 * 1000;
const moneyExact = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
const shortDate = (date) => (date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : DASH);

function lateRule(companyKey) {
    if (LATE_CHARGE_RULES[companyKey]) return { ...LATE_CHARGE_RULES.default, ...LATE_CHARGE_RULES[companyKey], source: 'contract' };
    const saved = state.lateRules[companyKey];
    if (saved) return { ...LATE_CHARGE_RULES.default, ...saved, correction: [], source: 'saved' };
    return { ...LATE_CHARGE_RULES.default, source: 'unset' };
}

function outstandingUsd(invoice) {
    const usd = invoice.amounts_usd;
    const converted = usd && usd.AmountDue !== null && usd.AmountDue !== undefined && Number.isFinite(Number(usd.AmountDue))
        ? Number(usd.AmountDue)
        : Number(invoice.AmountDue || 0) * Number(invoice.usdRate || 1);
    return converted * categoryShare(invoice);
}

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

function summaryChartOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {


            legend: { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { family: 'Manrope', size: 10 }, color: '#6d6f68', sort: (a, b) => a.datasetIndex - b.datasetIndex } },
            tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${money(item.parsed.y)}` } },
        },
        scales: {
            x: { grid: { display: false }, ticks: { font: { family: 'DM Mono', size: 10 }, color: '#8a8c84' } },
            y: { grid: { color: '#ece9e2' }, ticks: { font: { family: 'DM Mono', size: 10 }, color: '#8a8c84', callback: (value) => money(value) } },
        },
    };
}

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
    if (typeof renderSales === 'function') renderSales();
}