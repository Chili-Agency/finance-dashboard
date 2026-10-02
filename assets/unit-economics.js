const CHURN_GRACE_MONTHS = 2;

state.unitInputs = {};
state.unitInputsStatus = 'loading';
state.unitInputsError = '';
state.unitEntriesMode = 'all';
state.clientEntriesMode = 'all';
const UNIT_ENDPOINT = 'unit-inputs.php';
const UNIT_FIELDS = {
    salesMarketingCost: { kind: 'money' },
    newClients: { kind: 'count' },
};

const ADS_PLATFORM_LABELS = { google: 'Google Ads', meta: 'Meta Ads' };

function adsFor(months, scope = state.scope) {
    if (state.ads.status !== 'ready') return null;
    const wanted = new Set(months);
    const totals = { cost: 0, conversions: 0, missingFx: 0, rows: 0, bySource: { google: 0, meta: 0 } };
    state.ads.rows.forEach((row) => {
        if (!wanted.has(row.month) || (scope !== 'all' && row.market !== scope)) return;
        if (!hasValue(row.costUsd)) { totals.missingFx += 1; return; }
        totals.cost += Number(row.costUsd);
        totals.bySource[row.source === 'meta' ? 'meta' : 'google'] += Number(row.costUsd);
        totals.conversions += Number(row.conversions) || 0;
        totals.rows += 1;
    });
    return totals;
}

function adsAccountsInView(scope = state.scope) {
    return state.ads.accounts.filter((account) => account.configured && (scope === 'all' || account.market === 'all' || account.market === scope));
}

const COSTS_ENDPOINT = 'costs.php';
state.costs = { status: 'loading', rows: [], rules: [], errors: [], warnings: [], fetchedAt: null };

async function loadCosts() {
    state.costs = { ...state.costs, status: 'loading' };
    renderUnitSection();
    try {
        const response = redirectIfSignedOut(await fetch(COSTS_ENDPOINT, { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
        if (body.configured === false) {
            state.costs = { status: 'off', rows: [], rules: [], errors: body.errors || [], warnings: [], fetchedAt: null };
        } else if (!response.ok) {
            throw new Error((body.errors || []).join(' · ') || `The server answered HTTP ${response.status}.`);
        } else {
            state.costs = { status: 'ready', rows: body.rows || [], rules: body.rules || [], errors: body.errors || [], warnings: body.warnings || [], fetchedAt: body.fetchedAt || null };
        }
    } catch (error) {
        state.costs = { status: 'error', rows: [], rules: [], errors: [error.message], warnings: [], fetchedAt: null };
    }
    renderUnitSection();
}

// Custos de assinaturas (backlinks, HubSpot, Linked Helper, Sender.net) lidos do Xero, em USD.
// Mesmo recorte de adsFor: meses do período e mercado da visão; o serviço não divide esse custo.
function costsFor(months, scope = state.scope) {
    if (state.costs.status !== 'ready') return null;
    const wanted = new Set(months);
    const totals = { cost: 0, rows: 0, missingFx: 0, byKey: {}, labels: {} };
    state.costs.rows.forEach((row) => {
        if (!wanted.has(row.month) || (scope !== 'all' && row.market !== scope)) return;
        if (!hasValue(row.costUsd)) { totals.missingFx += 1; return; }
        totals.cost += Number(row.costUsd);
        totals.byKey[row.key] = (totals.byKey[row.key] || 0) + Number(row.costUsd);
        totals.labels[row.key] = row.label || row.key;
        totals.rows += 1;
    });
    return totals;
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
        entry.revenue += mrrAmount(invoice);
        entry.months.add(monthKey(date));
        entry.invoices += 1;
        clients.set(key, entry);
    });

    const cutoff = new Date(today.getFullYear(), today.getMonth() - CHURN_GRACE_MONTHS, 1);
    return [...clients.values()].map((entry) => {
        const lifetime = monthKeysBetween(entry.first, entry.last).length;
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
    const revenue = invoices.reduce((total, invoice) => total + mrrAmount(invoice), 0);


    const earliest = inScopeBillable().reduce((first, invoice) => { const date = invoiceDate(invoice); return date && (!first || date < first) ? date : first; }, null);
    const months = monthKeysBetween(window.start < new Date(1990, 0, 1) ? (earliest || startOfToday()) : window.start, window.end > new Date(9000, 0, 1) ? startOfToday() : window.end);

    const inputs = combineUnit(months.map((month) => resolveUnit(month, state.scope, state.category))) || {};
    const meta = state.scorecardMeta || {};
    const scorecard = state.scorecard || {};


    const fromInvoices = start && end ? meta.newClients : newClientsInWindow(window);
    const newClients = hasValue(inputs.newClients) ? inputs.newClients : (hasValue(fromInvoices) ? fromInvoices : null);

    const clients = clientLifetimes();
    const churned = clients.filter((client) => !client.active && !client.leftCensored);
    const alt = churned.length ? churned.reduce((total, client) => total + client.lifetime, 0) / churned.length : null;

    const activeClients = scorecard.retention ? scorecard.retention.activeClients : null;
    const monthsInWindow = Math.max(1, months.length);
    const arpa = hasValue(activeClients) && activeClients > 0 ? revenue / activeClients / monthsInWindow : null;
    const margin = meta.marginEntry?.margin ?? meta.marginAggregate?.margin ?? null;
    const acquisition = acquisitionFigures(adsFor(months), inputs.salesMarketingCost, newClients, state.category, costsFor(months));

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

function newClientsInWindow(window) {
    const firstSeen = new Map();
    inScopeBillable().forEach((invoice) => {
        const date = invoiceDate(invoice);
        if (!date) return;
        const key = contactKey(invoice);
        const known = firstSeen.get(key);
        if (!known || date < known) firstSeen.set(key, date);
    });
    if (!firstSeen.size) return null;
    const historyStart = monthKey(new Date(Math.min(...[...firstSeen.values()].map((date) => date.getTime()))));
    const inView = new Set(scopedInvoices().filter((invoice) => inWindow(invoiceDate(invoice), window)).map(contactKey));
    let count = 0;
    firstSeen.forEach((date, key) => {
        if (inView.has(key) && inWindow(date, window) && monthKey(date) > historyStart) count += 1;
    });
    return count;
}

function acquisitionFigures(ads, manualCost, newClients, category = state.category, subscriptions = null) {
    const adsCost = ads ? ads.cost : null;
    const hasAds = Boolean(ads) && ads.rows > 0;
    const manual = hasValue(manualCost) ? Number(manualCost) : null;
    const fromXero = subscriptions && subscriptions.rows > 0 ? subscriptions.cost : null;
    const other = hasValue(manual) || hasValue(fromXero) ? (manual || 0) + (fromXero || 0) : null;
    const acquisitionCost = hasAds || hasValue(other) ? (hasAds ? adsCost : 0) + (other || 0) : null;
    return {
        ads,
        adsCost: hasAds ? adsCost : (ads ? 0 : null),
        conversions: ads ? ads.conversions : null,
        otherCost: other,
        otherManual: manual,
        otherSubscriptions: subscriptions,
        acquisitionCost,
        cac: category === 'all' && hasValue(acquisitionCost) && hasValue(newClients) && newClients > 0 ? acquisitionCost / newClients : null,
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
    const adsBySource = metrics.ads && metrics.ads.rows > 0 ? metrics.ads.bySource : null;
    const costParts = [
        adsBySource ? `Google Ads ${money(adsBySource.google)}` : null,
        adsBySource ? `Meta Ads ${money(adsBySource.meta)}` : null,
    ].filter(Boolean).join(' + ');
    const byService = state.category !== 'all';
    unitCard('cac', {
        value: moneyOr(metrics.cac),
        note: byService
            ? `Shown only for All services: ad spend isn't split by ${serviceName(state.category)} or any other service`
            : hasValue(metrics.acquisitionCost)
            ? `${moneyOr(metrics.acquisitionCost)} over ${hasValue(metrics.newClients) && metrics.newClients > 0 ? plural(metrics.newClients, 'new client') : 'no new clients'}`
            : adsUnavailableNote('No acquisition cost for this period'),
        foot: byService
            ? (costParts ? `${costParts}, for every service` : adsUnavailableNote('No acquisition cost for this period'))
            : `${costParts ? `${costParts} · ` : ''}${metrics.newClientsFromInvoices ? 'new clients from the invoices' : 'new clients entered by hand'}`,
        state: hasValue(metrics.cac) ? 'good' : 'empty',
    });
    renderOtherCostsLine(metrics);
    unitCard('cpl', {
        value: moneyOr(metrics.cpl),
        note: hasValue(metrics.adsCost) && metrics.ads && metrics.ads.rows > 0
            ? `${money(metrics.adsCost)} in ads over ${plural(Math.round(metrics.conversions), 'lead')}`
            : adsUnavailableNote('No ad spend in this period'),
        foot: metrics.ads && metrics.ads.missingFx > 0 ? 'Some ad spend has no exchange rate and is left out'
            : state.category !== 'all' ? `Ad spend and leads of every service, not only ${serviceName(state.category)}` : periodLabel,
        state: hasValue(metrics.cpl) ? 'good' : 'empty',
    });
    const ratio = hasValue(metrics.ltv) && hasValue(metrics.cac) && metrics.cac > 0 ? metrics.ltv / metrics.cac : null;
    unitCard('ratio', {
        value: hasValue(ratio) ? `${ratio.toFixed(1)}×` : DASH,
        note: 'How much a client returns for each dollar spent to win them',
        foot: hasValue(ratio) ? (ratio >= 3 ? 'At or above the usual 3× benchmark' : 'Below the usual 3× benchmark')
            : state.category !== 'all' ? 'Needs CAC, shown only for All services' : 'Needs LTV and CAC',
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

// Detalhe do "Other costs" por assinatura (ordem das regras do n8n) + o que foi digitado à mão.
function otherCostsBreakdown(metrics) {
    const subscriptions = metrics.otherSubscriptions;
    const lines = [];
    const known = new Set();
    state.costs.rules.forEach((rule) => {
        known.add(rule.key);
        lines.push({ label: rule.label, value: subscriptions && subscriptions.byKey[rule.key] ? subscriptions.byKey[rule.key] : 0 });
    });
    if (subscriptions) {
        Object.entries(subscriptions.byKey).forEach(([key, value]) => {
            if (!known.has(key)) lines.push({ label: subscriptions.labels[key] || key, value });
        });
    }
    if (hasValue(metrics.otherManual) && metrics.otherManual > 0) lines.push({ label: 'Entered by hand', value: metrics.otherManual });
    return lines;
}

// Linha extra do card de CAC, criada aqui (logo abaixo do texto dos anúncios) para não depender do index.php.
function renderOtherCostsLine(metrics) {
    const foot = $('#unit-cac-foot');
    if (!foot) return;
    let node = $('#unit-cac-other');
    if (!node) {
        node = document.createElement('p');
        node.id = 'unit-cac-other';
        node.className = foot.className;
        foot.insertAdjacentElement('afterend', node);
    }
    const status = state.costs.status;
    node.style.display = status === 'off' ? 'none' : '';
    if (status === 'off') return;
    const hint = 'cursor:help;text-decoration:underline dotted;text-underline-offset:2px';
    if (status === 'loading') { node.textContent = 'Other costs: loading…'; return; }
    if (status === 'error') {
        node.innerHTML = `Other costs: <span tabindex="0" style="${hint}" title="${escapeHtml(state.costs.errors.join(' · '))}">unavailable</span>`;
        return;
    }
    const total = hasValue(metrics.otherCost) ? Number(metrics.otherCost) : 0;
    const subscriptions = metrics.otherSubscriptions;
    const lines = otherCostsBreakdown(metrics).map((line) => `${line.label}: ${money(line.value)}`);
    if (subscriptions && subscriptions.missingFx > 0) lines.push(`${plural(subscriptions.missingFx, 'cost')} without an exchange rate left out`);
    const tip = escapeHtml(lines.length ? lines.join('\n') : 'No subscription costs found in Xero for this period').replace(/\n/g, '&#10;');
    node.innerHTML = `Other costs: <span tabindex="0" style="${hint}" title="${tip}">${money(total)}</span>`;
}

function costsStatus() {
    const costs = state.costs;
    if (costs.status === 'loading') return { text: 'Loading subscription costs…', tone: 'muted' };
    if (costs.status === 'off') return { text: 'Subscription costs are not connected: set N8N_WEBHOOK_COSTS in the .env with the webhook of the n8n workflow.', tone: 'sample' };
    if (costs.status === 'error') return { text: `Could not load subscription costs: ${costs.errors.join(' · ')}`, tone: 'error' };
    const names = costs.rules.map((rule) => rule.label);
    const parts = [
        `${names.length ? listNames(names) : 'Subscription costs'} are read from the Xero bank transactions${costs.fetchedAt ? `, fetched ${relativeTime(new Date(costs.fetchedAt).getTime())}` : ''}, and added in Other costs. A cost shows up once its bank line is reconciled in Xero.`,
        costs.errors.length ? `Issues: ${costs.errors.join(' · ')}` : '',
        costs.warnings.length ? costs.warnings.join(' · ') : '',
    ].filter(Boolean);
    return { text: parts.join(' '), tone: costs.errors.length ? 'error' : costs.warnings.length ? 'sample' : 'manual' };
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
    const costs = costsStatus();
    const manualText = count
        ? `${plural(count, 'entry')} saved. Other acquisition costs are added to the ad spend (Google + Meta) in CAC; leave New clients empty to use the count from the invoices.`
        : 'No other acquisition costs entered. CAC uses only the ad spend (Google + Meta) until you add them (salaries, tools, other channels).';
    node.textContent = `${manualText} ${costs.text}`;
    node.dataset.tone = costs.tone === 'error' ? 'error' : count ? 'manual' : 'muted';
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
            ...acquisitionFigures(adsFor([row.month], row.scope), input?.salesMarketingCost, newClients, row.category, costsFor([row.month], row.scope)),
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
    if (!CAN_MANUAL_INPUTS) return;
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