// ---- Client view ----
// Uma tela por cliente para acompanhar escalações: pagamentos (Xero), histórico de NPS (HubSpot) e a data de
// onboarding (invoice com onboarding fee no Xero). O vínculo HubSpot <-> Xero é pelo nome normalizado da empresa.

const CLIENTS_ENDPOINT = 'clients.php';
const CLIENT_DAY_MS = 24 * 60 * 60 * 1000;
// Palavras que não distinguem uma empresa da outra: tipo societário e conectores (LTDA, S.A. de C.V., Inc...).
const CLIENT_NAME_NOISE = new Set([
    'ltda', 'ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'sa', 'sas', 'srl', 'sl', 'sc',
    'gmbh', 'eireli', 'me', 'epp', 'cv', 'rl', 's', 'a', 'c', 'v', 'de', 'del', 'la', 'el', 'do', 'da', 'dos', 'das', 'the', 'and', 'y', 'e', 'of',
]);

state.clients = { status: 'loading', data: null, errors: [], warnings: [], fetchedAt: null };
state.clientView = { selected: null, listCache: null, indexCache: null, optionsFor: null, labels: new Map() };

async function loadClients() {
    state.clients = { ...state.clients, status: 'loading' };
    renderClientView();
    try {
        const response = redirectIfSignedOut(await fetch(CLIENTS_ENDPOINT, { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
        if (body.configured === false) {
            state.clients = { status: 'off', data: null, errors: body.errors || [], warnings: [], fetchedAt: null };
        } else if (!response.ok) {
            throw new Error((body.errors || []).join(' · ') || `The server answered HTTP ${response.status}.`);
        } else {
            state.clients = { status: 'ready', data: { companies: body.companies || [], nps: body.nps || [] }, errors: body.errors || [], warnings: body.warnings || [], fetchedAt: body.fetchedAt || null };
        }
    } catch (error) {
        state.clients = { status: 'error', data: null, errors: [error.message], warnings: [], fetchedAt: null };
    }
    renderClientView();
}

// "PLAZA DEL TATUAJE MEXICO (Tarmex)" e "Plaza del Tatuaje México S.A. de C.V." viram o mesmo texto.
function normalizeClientName(name) {
    return String(name || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter((token) => token && !CLIENT_NAME_NOISE.has(token))
        .join(' ');
}

const clientDay = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
};
const clientDays = (from, to) => Math.round((to - from) / CLIENT_DAY_MS);
const clientSum = (list) => list.reduce((total, value) => total + value, 0);

// Clientes do Xero: uma entrada por contato com invoices de cliente (sem rascunho, anuladas ou excluídas).
function xeroClientList() {
    const cache = state.clientView.listCache;
    if (cache && cache.source === state.invoices) return cache.list;
    const map = new Map();
    state.invoices.filter(isBillable).forEach((invoice) => {
        const key = contactKey(invoice);
        const entry = map.get(key) || { key, name: invoice.Contact?.Name || 'Unknown client', invoices: [], markets: new Set(), first: null, last: null };
        entry.invoices.push(invoice);
        entry.markets.add(invoice.companyKey);
        const date = invoiceDate(invoice);
        if (date && (!entry.first || date < entry.first)) entry.first = date;
        if (date && (!entry.last || date > entry.last)) entry.last = date;
        map.set(key, entry);
    });
    const list = [...map.values()]
        .map((client) => ({ ...client, norm: normalizeClientName(client.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    state.clientView.listCache = { source: state.invoices, list };
    return list;
}

// Empresas do HubSpot por nome normalizado, já com as respostas de NPS de cada uma.
function hubspotIndex() {
    const data = state.clients.data;
    const cache = state.clientView.indexCache;
    if (cache && cache.source === data) return cache.map;
    const map = new Map();
    if (data) {
        const byCompany = new Map();
        data.nps.forEach((row) => {
            if (!byCompany.has(row.companyId)) byCompany.set(row.companyId, []);
            byCompany.get(row.companyId).push(row);
        });
        data.companies.forEach((company) => {
            const key = normalizeClientName(company.name);
            if (!key) return;
            const entry = map.get(key) || { companies: [], nps: [] };
            entry.companies.push(company);
            entry.nps.push(...(byCompany.get(company.id) || []));
            map.set(key, entry);
        });
    }
    state.clientView.indexCache = { source: data, map };
    return map;
}

function npsCategory(score) {
    if (!hasValue(score)) return { key: 'none', label: DASH, pill: 'open' };
    if (score >= 9) return { key: 'promoter', label: 'Promoter', pill: 'paid' };
    if (score >= 7) return { key: 'passive', label: 'Passive', pill: 'open' };
    return { key: 'detractor', label: 'Detractor', pill: 'late' };
}

function outstandingOf(invoice) {
    const usd = invoice.amounts_usd;
    if (usd && hasValue(usd.AmountDue)) return Number(usd.AmountDue);
    return Number(invoice.AmountDue || 0) * Number(invoice.usdRate || 1);
}

function clientPaymentRow(invoice, today) {
    const bucket = invoiceBucket(invoice);
    const due = dueDate(invoice);
    const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
    const lastPayment = payments.length ? clientDay(payments[payments.length - 1].date) : null;
    const paidOn = bucket === 'paid' ? (clientDay(invoice.paidAt) || lastPayment) : lastPayment;
    let days = null;
    if (due) {
        if (bucket === 'paid') days = paidOn ? clientDays(due, paidOn) : null;
        else days = clientDays(due, today); // negativo = ainda não venceu
    }
    return {
        number: invoice.InvoiceNumber || invoice.InvoiceID || 'Unnumbered',
        market: invoice.companyKey,
        bucket,
        issued: invoiceDate(invoice),
        due,
        paidOn,
        days,
        total: fullAmount(invoice),
        outstanding: bucket === 'paid' ? 0 : outstandingOf(invoice),
    };
}

function clientDetail(client) {
    const today = startOfToday();
    const rows = client.invoices.map((invoice) => clientPaymentRow(invoice, today)).sort((a, b) => (b.issued || 0) - (a.issued || 0));
    const billed = clientSum(rows.map((row) => row.total));
    const outstanding = clientSum(rows.map((row) => row.outstanding));
    const late = rows.filter((row) => row.bucket === 'late');
    const settled = rows.filter((row) => row.bucket === 'paid' && row.paidOn && row.due);

    const onboarding = client.invoices
        .map((invoice) => {
            const share = Object.values(invoice.onboardingShares || {}).reduce((total, value) => total + (Number(value) || 0), 0);
            return share > 0.0001 ? { number: invoice.InvoiceNumber || invoice.InvoiceID || 'Unnumbered', date: invoiceDate(invoice), fee: fullAmount(invoice) * share, market: invoice.companyKey } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.date - b.date);

    const match = hubspotIndex().get(client.norm) || null;
    const nps = match ? [...match.nps].sort((a, b) => String(b.at).localeCompare(String(a.at))) : [];
    const scored = nps.filter((row) => hasValue(row.score));

    return {
        rows,
        billed,
        outstanding,
        paid: billed - outstanding,
        overdue: clientSum(late.map((row) => row.outstanding)),
        lateCount: late.length,
        averageDelay: settled.length ? clientSum(settled.map((row) => row.days)) / settled.length : null,
        onboarding,
        onboardingDate: onboarding.length ? onboarding[0].date : null,
        match,
        nps,
        averageScore: scored.length ? clientSum(scored.map((row) => Number(row.score))) / scored.length : null,
    };
}

function clientDelay(row) {
    if (row.days === null) return DASH;
    if (row.bucket === 'paid') return row.days > 0 ? `${plural(row.days, 'day')} late` : row.days < 0 ? `${plural(-row.days, 'day')} early` : 'on time';
    if (row.days > 0) return `${plural(row.days, 'day')} overdue`;
    return row.days === 0 ? 'due today' : `due in ${plural(-row.days, 'day')}`;
}

function clientMarkets(client) {
    return [...client.markets].map((key) => companyLabels[key] || key).join(' · ');
}

function clientDetailHtml(client, detail) {
    const today = startOfToday();
    const active = client.last && client.last >= new Date(today.getFullYear(), today.getMonth() - 2, 1);
    const latest = detail.nps.find((row) => hasValue(row.score)) || null;
    const previous = latest ? detail.nps.filter((row) => hasValue(row.score))[1] : null;
    const category = npsCategory(latest ? latest.score : null);
    const delta = latest && previous ? latest.score - previous.score : null;
    const onboardingFirst = detail.onboarding[0] || null;

    const cards = `<div class="metric-grid">
        <article class="metric-card"><div class="metric-heading"><span class="metric-label">Billed</span><span class="metric-badge">01</span></div><strong>${money(detail.billed)}</strong><p><span>${money(detail.paid)}</span> <span class="metric-muted">paid · ${plural(detail.rows.length, 'invoice')}</span></p></article>
        <article class="metric-card"><div class="metric-heading"><span class="metric-label">Outstanding</span><span class="metric-badge">02</span></div><strong>${money(detail.outstanding)}</strong><p><span>${money(detail.overdue)}</span> <span class="metric-muted">overdue${detail.lateCount ? ` · ${plural(detail.lateCount, 'invoice')}` : ''}</span></p></article>
        <article class="metric-card"><div class="metric-heading"><span class="metric-label">Latest NPS</span><span class="metric-badge">03</span></div><strong>${latest ? number(latest.score) : DASH}</strong><p><span>${escapeHtml(category.label)}</span> <span class="metric-muted">${latest ? `${escapeHtml(latest.at || '')}${hasValue(delta) ? ` · ${delta > 0 ? '+' : ''}${delta} vs previous` : ''}` : detail.match ? 'no scored response yet' : 'not linked to HubSpot'}</span></p></article>
        <article class="metric-card"><div class="metric-heading"><span class="metric-label">Onboarding</span><span class="metric-badge">04</span></div><strong>${detail.onboardingDate ? shortDate(detail.onboardingDate) : DASH}</strong><p><span>${onboardingFirst ? `${money(onboardingFirst.fee)} fee` : 'no onboarding fee found'}</span> <span class="metric-muted">${onboardingFirst ? escapeHtml(onboardingFirst.number) : `client since ${client.first ? shortDate(client.first) : DASH}`}</span></p></article>
    </div>`;

    const header = `<article class="panel">
        <div class="panel-header"><div><p class="eyebrow">${escapeHtml(clientMarkets(client))}</p><h3>${escapeHtml(client.name)}</h3></div><span class="panel-meta">${active ? 'Active' : `No invoice since ${client.last ? monthLabel(client.last) : DASH}`}</span></div>
        <p class="section-copy">Client since ${client.first ? shortDate(client.first) : DASH} · last invoice ${client.last ? shortDate(client.last) : DASH} · average payment delay ${hasValue(detail.averageDelay) ? `${detail.averageDelay > 0 ? '+' : ''}${detail.averageDelay.toFixed(1)} days` : DASH}</p>
    </article>`;

    const payments = `<article class="panel table-panel"><div class="panel-header"><div><p class="eyebrow">Xero</p><h3>Payments</h3></div><span class="panel-meta">${plural(detail.rows.length, 'invoice')}</span></div>
        <div class="table-scroll"><table class="entries-table"><thead><tr><th>Invoice</th><th>Market</th><th>Issued</th><th>Due</th><th>Paid on</th><th class="align-right">Timing</th><th class="align-right">Amount</th><th class="align-right">Outstanding</th><th>Status</th></tr></thead><tbody>${detail.rows.map((row) => `<tr>
            <td>${escapeHtml(row.number)}</td><td>${escapeHtml(companyLabels[row.market] || DASH)}</td><td>${row.issued ? shortDate(row.issued) : DASH}</td><td>${row.due ? shortDate(row.due) : DASH}</td><td>${row.paidOn ? shortDate(row.paidOn) : DASH}</td>
            <td class="align-right mono">${escapeHtml(clientDelay(row))}</td><td class="align-right mono">${money(row.total)}</td><td class="align-right mono">${row.outstanding > 0.005 ? money(row.outstanding) : DASH}</td>
            <td><span class="status-pill ${row.bucket}">${row.bucket === 'paid' ? 'Paid' : row.bucket === 'late' ? 'Late' : 'Open'}</span></td></tr>`).join('')}</tbody></table></div>
        <p class="manual-input-status" data-tone="muted">Amounts are issued values in USD, excluding tax. Invoices load from January 2025 on.</p></article>`;

    let npsBody;
    if (!detail.match) {
        npsBody = `<p class="manual-input-status" data-tone="sample">${state.clients.status === 'ready'
            ? `No HubSpot company matched this client. The match uses the normalized name: “${escapeHtml(client.norm)}”.`
            : state.clients.status === 'loading' ? 'Loading HubSpot data…' : 'HubSpot data is not available (see the note at the top).'}</p>`;
    } else if (!detail.nps.length) {
        npsBody = `<p class="manual-input-status" data-tone="muted">HubSpot company “${escapeHtml(detail.match.companies[0].name || '')}” found, with no NPS responses since the workflow start date.</p>`;
    } else {
        const counts = { promoter: 0, passive: 0, detractor: 0 };
        detail.nps.forEach((row) => { const key = npsCategory(row.score).key; if (counts[key] !== undefined) counts[key] += 1; });
        npsBody = `<p class="manual-input-status" data-tone="manual">${plural(detail.nps.length, 'response')} · average ${hasValue(detail.averageScore) ? detail.averageScore.toFixed(1) : DASH} · ${counts.promoter} promoters, ${counts.passive} passives, ${counts.detractor} detractors.</p>
        <div class="table-scroll"><table class="entries-table"><thead><tr><th>Date</th><th class="align-right">Score</th><th>Category</th><th>Survey</th><th>Comment</th></tr></thead><tbody>${detail.nps.map((row) => {
            const kind = npsCategory(row.score);
            return `<tr><td>${escapeHtml(row.at || DASH)}</td><td class="align-right mono">${hasValue(row.score) ? number(row.score) : DASH}</td><td><span class="status-pill ${kind.pill}">${escapeHtml(kind.label)}</span></td><td>${escapeHtml(row.survey || row.type || DASH)}</td><td>${escapeHtml(row.comment || '')}</td></tr>`;
        }).join('')}</tbody></table></div>`;
    }
    const nps = `<article class="panel table-panel"><div class="panel-header"><div><p class="eyebrow">HubSpot</p><h3>NPS history</h3></div><span class="panel-meta">${plural(detail.nps.length, 'response')}</span></div>${npsBody}</article>`;

    const onboarding = `<article class="panel table-panel"><div class="panel-header"><div><p class="eyebrow">Xero</p><h3>Onboarding</h3></div><span class="panel-meta">${detail.onboardingDate ? shortDate(detail.onboardingDate) : 'no date'}</span></div>${detail.onboarding.length
        ? `<div class="table-scroll"><table class="entries-table"><thead><tr><th>Date</th><th>Invoice</th><th>Market</th><th class="align-right">Onboarding fee</th></tr></thead><tbody>${detail.onboarding.map((row) => `<tr><td>${row.date ? shortDate(row.date) : DASH}</td><td>${escapeHtml(row.number)}</td><td>${escapeHtml(companyLabels[row.market] || DASH)}</td><td class="align-right mono">${money(row.fee)}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="manual-input-status" data-tone="sample">No invoice with an onboarding fee was found for this client. The first invoice in the loaded history is from ${client.first ? shortDate(client.first) : DASH}, which may be later than the real start.</p>`}</article>`;

    return header + cards + payments + nps + onboarding;
}

function renderClientSources() {
    const node = $('#client-sources-note');
    if (!node) return;
    const clients = state.clients;
    const invoices = state.invoices.length ? `Xero: ${plural(xeroClientList().length, 'client')} from ${plural(state.invoices.filter(isBillable).length, 'invoice')}.` : 'Loading Xero invoices…';
    let hubspot;
    let tone = 'muted';
    if (clients.status === 'loading') hubspot = 'Loading HubSpot NPS…';
    else if (clients.status === 'off') { hubspot = 'NPS is not connected: set N8N_WEBHOOK_CLIENTS in the .env with the webhook of the n8n workflow.'; tone = 'sample'; }
    else if (clients.status === 'error') { hubspot = `Could not load NPS: ${clients.errors.join(' · ')}`; tone = 'error'; }
    else {
        const linked = xeroClientList().filter((client) => hubspotIndex().has(client.norm)).length;
        hubspot = `HubSpot: ${plural(clients.data.nps.length, 'NPS response')} for ${plural(clients.data.companies.length, 'company')}, ${linked} linked to a Xero client by name${clients.fetchedAt ? `, fetched ${relativeTime(new Date(clients.fetchedAt).getTime())}` : ''}.`;
        const extra = [...clients.errors, ...clients.warnings];
        if (extra.length) { hubspot += ` ${extra.join(' · ')}`; tone = 'sample'; }
    }
    node.textContent = `${invoices} ${hubspot}`;
    node.dataset.tone = tone;
}

function renderClientOptions(list) {
    const options = $('#client-options');
    if (!options || state.clientView.optionsFor === list) return;
    state.clientView.optionsFor = list;
    const counts = new Map();
    list.forEach((client) => counts.set(client.name, (counts.get(client.name) || 0) + 1));
    state.clientView.labels = new Map();
    options.innerHTML = list.map((client) => {
        const label = counts.get(client.name) > 1 ? `${client.name} · ${clientMarkets(client)}` : client.name;
        state.clientView.labels.set(label.toLowerCase(), client.key);
        return `<option value="${escapeHtml(label)}"></option>`;
    }).join('');
}

function renderClientView() {
    if (!$('#clients-view')) return;
    renderClientSources();
    const list = xeroClientList();
    renderClientOptions(list);

    const client = state.clientView.selected ? list.find((item) => item.key === state.clientView.selected) : null;
    const empty = $('#client-empty');
    const detail = $('#client-detail');
    if (!client) {
        detail.hidden = true;
        detail.innerHTML = '';
        empty.hidden = false;
        empty.textContent = state.invoices.length ? 'Pick a client above to see payments, NPS history and onboarding.' : 'Loading invoices…';
        return;
    }
    empty.hidden = true;
    detail.hidden = false;
    detail.innerHTML = `<div style="display:grid;gap:18px">${clientDetailHtml(client, clientDetail(client))}</div>`;
}

function selectClientFromInput(value) {
    const key = state.clientView.labels.get(String(value || '').trim().toLowerCase());
    if (!key) return;
    state.clientView.selected = key;
    renderClientView();
}

const clientSearch = $('#client-search');
if (clientSearch) {
    clientSearch.addEventListener('input', () => selectClientFromInput(clientSearch.value));
    clientSearch.addEventListener('change', () => selectClientFromInput(clientSearch.value));
}