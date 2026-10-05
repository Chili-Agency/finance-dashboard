/*
 * Página Sales. Carregado depois de app.js e usa os mesmos filtros (período, mercado, serviço)
 * e helpers dele (state, periodBounds, money, monthKeysBetween...).
 *
 * Dados: sales.php (deals, contatos, chamadas e reuniões do HubSpot), state.ads (Google + Meta,
 * carregado pelo app.js), sales-targets.php (meta de receita por mês, mercado, serviço e vendedor,
 * entrada manual) e goals.php (metas por tier: nome, valor, vendedor, mercado e serviço).
 * Contatos, chamadas e reuniões não têm linha de serviço; chamadas e reuniões também não têm
 * mercado. Nesses blocos o filtro que não se aplica é ignorado e a página avisa.
 */

const SALES_ENDPOINT = 'sales.php';
const SALES_TARGETS_ENDPOINT = 'sales-targets.php';
const GOALS_ENDPOINT = 'goals.php';
const SALES_MARKET_LABELS = { ...companyLabels, unknown: 'No country' };
const SALES_MARKET_COLORS = { br: '#57745d', mx: '#d49b35', pa: '#55778a', int: '#e84d2c', unknown: '#a5a6a0' };
const SALES_CHANNELS = [
    { key: 'google', label: 'Google Ads', spend: 'google', color: '#55778a' },
    { key: 'meta', label: 'Meta Ads', spend: 'meta', color: '#e84d2c' },
    { key: 'linkedin', label: 'LinkedIn Ads', color: '#202522' },
    { key: 'organic', label: 'Organic search', color: '#57745d' },
    { key: 'social', label: 'Organic social', color: '#d49b35' },
    { key: 'referral', label: 'Referrals', color: '#8fa792' },
    { key: 'ai', label: 'AI referrals', color: '#88a2b0' },
    { key: 'other', label: 'Direct and other', color: '#a5a6a0' },
];
const SALES_PEOPLE_COLORS = ['#57745d', '#55778a', '#d49b35', '#e84d2c', '#202522', '#8fa792', '#88a2b0', '#a5a6a0'];
const SALES_TREND_MONTHS = 6;
const SALES_TOP_PEOPLE = 8;
const compactMoney = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);

state.sales = { status: 'loading', data: null, errors: [] };
state.salesTargets = {};
state.salesTargetsStatus = 'loading';
state.salesTargetsError = '';
state.goalList = { status: 'loading', goals: [], error: '' }; // metas por tier (tabela sales_goals)

// ---- Vendedores e metas por pessoa (HubSpot) ----
const SALES_GOALS_ENDPOINT = 'sales-goals.php';
// Receita mensal usada em "new sales" e comparada com a meta de cada pessoa: 'mrrUsd' (Monthly recurring revenue
// do deal) ou 'valueUsd' (valor do deal), caso as metas do HubSpot sejam sobre o valor do deal.
const SALES_NEW_SALES_FIELD = 'mrrUsd';
state.salesOwner = 'all';
state.salesGoals = { status: 'loading', goals: [], kinds: [], errors: [], warnings: [], fetchedAt: null };
state.salesCharts = {};
state.salesPoll = null; // HubSpot atualizando em segundo plano, depois do Refresh

// ---------- Carregamento ----------

async function loadSales() {
    state.sales = { ...state.sales, status: 'loading' };
    renderSales();
    try {
        const response = redirectIfSignedOut(await fetch(SALES_ENDPOINT, { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
        if (body.configured === false) {
            state.sales = { status: 'off', data: null, errors: body.errors || [] };
        } else if (!response.ok) {
            throw new Error((body.errors || []).join(' · ') || `The server answered HTTP ${response.status}.`);
        } else {
            state.sales = { status: 'ready', data: prepareSales(body), errors: body.errors || [] };
        }
    } catch (error) {
        state.sales = { status: 'error', data: state.sales.data, errors: [error.message] };
    }
    refreshOverviewSales();
    const refresh = state.lastRefresh;
    state.lastRefresh = null;
    if (refresh && (refresh.sources || []).some((source) => source.source === 'sales' && source.pending)) watchSalesRefresh();
    renderSales();
}

// Depois do Refresh, o HubSpot roda em segundo plano (leva alguns minutos) e o n8n envia o
// resultado ao servidor. Aqui a página pergunta de tempos em tempos se ele já chegou.
const SALES_POLL_SECONDS = 20;
const SALES_POLL_LIMIT_MINUTES = 10;

function watchSalesRefresh() {
    if (state.salesPoll) clearInterval(state.salesPoll.timer);
    const startedAt = Date.now();
    const before = (state.sales.data && state.sales.data.fetchedAt) || '';
    // O timer fica numa variável local: o intervalo sempre consegue se cancelar, mesmo que
    // outra parte do código troque ou zere state.salesPoll.
    const timer = setInterval(async () => {
        try {
            const response = redirectIfSignedOut(await fetch(SALES_ENDPOINT, { cache: 'no-store' }));
            const body = await response.json().catch(() => null);
            if (response.ok && body && body.configured !== false && body.fetchedAt && body.fetchedAt !== before) {
                clearInterval(timer);
                state.salesPoll = null;
                state.sales = { status: 'ready', data: prepareSales(body), errors: body.errors || [] };
                refreshOverviewSales();
                renderSales();
                return;
            }
        } catch (error) {
            // tenta de novo na próxima volta
        }
        if (Date.now() - startedAt > SALES_POLL_LIMIT_MINUTES * 60 * 1000) {
            clearInterval(timer);
            state.salesPoll = { timedOut: true };
            renderSalesStatus();
        }
    }, SALES_POLL_SECONDS * 1000);
    state.salesPoll = { startedAt, timedOut: false, timer };
}

function prepareSales(body) {
    const owners = body.owners || {};
    const nameOf = (id) => (id ? (owners[id] && owners[id].name) || 'Former owner' : 'No owner');
    const people = new Set();
    [body.deals, body.calls, body.meetings].forEach((list) => (list || []).forEach((item) => people.add(item.owner || '')));
    const colors = new Map([...people]
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
        .map((id, index) => [id, SALES_PEOPLE_COLORS[index % SALES_PEOPLE_COLORS.length]]));
    return {
        ...body,
        deals: body.deals || [],
        contacts: body.contacts || [],
        calls: body.calls || [],
        meetings: body.meetings || [],
        nameOf,
        colorOf: (id) => colors.get(id || '') || '#a5a6a0',
    };
}

async function salesTargetsRequest(options = {}) {
    const response = redirectIfSignedOut(await fetch(SALES_TARGETS_ENDPOINT, { cache: 'no-store', ...options }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `The server answered HTTP ${response.status}.`);
    return body;
}

// owner 'all' = meta da empresa; um id = meta de um vendedor (id do owner no HubSpot).
const salesTargetKey = (month, scope, category, owner = 'all') => `${month}|${scope}|${category}|${owner || 'all'}`;
function storeSalesTarget(entry) { state.salesTargets[salesTargetKey(entry.month, entry.scope, entry.category, entry.ownerId)] = entry; }

async function loadSalesTargets() {
    try {
        const { entries = [] } = await salesTargetsRequest();
        state.salesTargets = {};
        entries.forEach(storeSalesTarget);
        state.salesTargetsStatus = 'ready';
    } catch (error) {
        state.salesTargetsStatus = 'error';
        state.salesTargetsError = error.message;
    }
    refreshOverviewSales();
    renderSales();
}

// ---------- Período e filtros ----------

const salesDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function salesWindow() {
    const bounds = periodBounds();
    if (bounds.start && bounds.end) {
        return { start: bounds.start, end: bounds.end, from: salesDay(bounds.start), to: salesDay(bounds.end), label: salesPeriodLabel(bounds), bounded: true };
    }
    const since = state.sales.data && state.sales.data.since;
    const today = startOfToday();
    const start = since ? monthFromKey(since.slice(0, 7)) : new Date(today.getFullYear(), 0, 1);
    return { start, end: endOfMonth(today), from: null, to: null, label: bounds.label, bounded: false };
}

function salesPeriodLabel(window) {
    return isCalendarMonth(window.start, window.end) ? monthLabel(window.start) : window.label;
}

const salesWithin = (day, window) => Boolean(day) && (!window.from || day >= window.from) && (!window.to || day <= window.to);
const salesInScope = (market) => state.scope === 'all' || market === state.scope;
const dealShare = (deal) => (state.category === 'all' ? 1 : Number((deal.shares || {})[state.category]) || 0);
const dealValue = (deal) => (Number(deal.valueUsd) || 0) * dealShare(deal);
const sumOf = (items, valueOf) => items.reduce((total, item) => total + valueOf(item), 0);

/** Meses do período que já começaram, para médias mensais. */
function elapsedMonths(window) {
    const current = monthKey(startOfToday());
    const months = monthKeysBetween(window.start, window.end).filter((key) => key <= current);
    return Math.max(1, months.length);
}

function salesMeasure(window) {
    const data = state.sales.data;
    const deals = data.deals.filter((deal) => salesInScope(deal.market) && salesOwnerMatch(deal.owner) && dealShare(deal) > 0);
    const closed = deals.filter((deal) => deal.outcome !== 'open' && salesWithin(deal.closedAt, window));
    const won = closed.filter((deal) => deal.outcome === 'won');
    const lost = closed.filter((deal) => deal.outcome === 'lost');
    const contacts = data.contacts.filter((contact) => salesInScope(contact.market));
    const cycles = won
        .filter((deal) => deal.createdAt && deal.closedAt)
        .map((deal) => Math.max(0, (Date.parse(deal.closedAt) - Date.parse(deal.createdAt)) / DAY_MS));
    return {
        won,
        lost,
        revenue: sumOf(won, dealValue),
        leads: contacts.filter((contact) => salesWithin(contact.lead, window)),
        mql: contacts.filter((contact) => salesWithin(contact.mql, window)).length,
        sql: contacts.filter((contact) => salesWithin(contact.sql, window)).length,
        cycle: cycles.length ? sumOf(cycles, (days) => days) / cycles.length : null,
        cycleCount: cycles.length,
    };
}

function revenueByMonth(months) {
    const wanted = new Set(months);
    const totals = new Map(months.map((key) => [key, 0]));
    state.sales.data.deals.forEach((deal) => {
        if (deal.outcome !== 'won' || !deal.closedAt || !salesInScope(deal.market) || !salesOwnerMatch(deal.owner) || dealShare(deal) <= 0) return;
        const key = deal.closedAt.slice(0, 7);
        if (wanted.has(key)) totals.set(key, totals.get(key) + dealValue(deal));
    });
    return months.map((key) => totals.get(key));
}

// ---------- Metas ----------

function exactSalesTarget(month, scope, category, owner = 'all') {
    const entry = state.salesTargets[salesTargetKey(month, scope, category, owner)];
    return entry && hasValue(entry.revenueTarget) ? Number(entry.revenueTarget) : null;
}

// A meta de um vendedor e a da empresa são separadas: cada uma soma só as próprias entradas por mercado e serviço.
function resolveSalesTarget(month, scope, category, owner = 'all') {
    const exact = exactSalesTarget(month, scope, category, owner);
    if (hasValue(exact)) return exact;
    if (category === 'all') {
        const lines = Object.keys(categoryLabels).map((key) => exactSalesTarget(month, scope, key, owner)).filter(hasValue);
        if (lines.length) return sumOf(lines, Number);
    }
    if (scope === 'all') {
        const markets = Object.keys(companyLabels).map((key) => resolveSalesTarget(month, key, category, owner)).filter(hasValue);
        if (markets.length) return sumOf(markets, Number);
    }
    return null;
}

/** Soma das metas dos meses (da empresa, ou do vendedor escolhido); covered = quantos meses têm meta. */
function salesTargetFor(months, owner = 'all') {
    const values = months.map((month) => resolveSalesTarget(month, state.scope, state.category, owner)).filter(hasValue);
    return { target: values.length ? sumOf(values, Number) : null, covered: values.length, months: months.length };
}

// ---------- Ad spend (Google + Meta, do ads.php) ----------

function adSpendRows() {
    if (state.ads.status !== 'ready') return [];
    return state.ads.rows.filter((row) => hasValue(row.costUsd)
        && (state.scope === 'all' || row.market === state.scope)); // sem filtro de serviço: as campanhas não têm
}

function spendByMonth(months) {
    const totals = new Map(months.map((key) => [key, 0]));
    adSpendRows().forEach((row) => { if (totals.has(row.month)) totals.set(row.month, totals.get(row.month) + Number(row.costUsd)); });
    return months.map((key) => totals.get(key));
}

function spendBySource(window) {
    const months = window.bounded ? new Set(monthKeysBetween(window.start, window.end)) : null;
    const totals = { google: 0, meta: 0 };
    adSpendRows().forEach((row) => {
        if (months && !months.has(row.month)) return;
        const source = row.source === 'meta' ? 'meta' : 'google';
        totals[source] += Number(row.costUsd);
    });
    return totals;
}

// ---------- Blocos da página ----------

function salesKpi(id, { value, note, ratio = undefined, tone = '' }) {
    setText(`#sales-${id}`, value);
    setText(`#sales-${id}-note`, note);
    const card = $(`#sales-${id}-card`);
    const valueNode = $(`#sales-${id}`);
    if (valueNode) valueNode.className = tone;
    if (ratio === undefined || !card) return;
    const bar = $(`#sales-${id}-bar`);
    if (bar) bar.style.width = `${hasValue(ratio) ? clampPercent(Number(ratio) * 100) : 0}%`;
    card.dataset.state = hasValue(ratio) ? (Number(ratio) >= 1 ? 'good' : 'behind') : 'empty';
}

function salesBarRows(rows, { format = money, empty }) {
    const max = Math.max(0, ...rows.map((row) => row.value));
    if (!rows.length || max <= 0) return `<p class="sales-empty">${escapeHtml(empty)}</p>`;
    return rows.map((row) => `
        <div class="sales-bar-row">
            <div class="sales-bar-head"><span title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span><strong>${escapeHtml(format(row.value))}</strong>${row.sub ? `<small>${escapeHtml(row.sub)}</small>` : ''}</div>
            <div class="sales-bar-track" aria-hidden="true"><span style="width:${clampPercent(row.value / max * 100)}%;background:${row.color}"></span></div>
        </div>`).join('');
}

function groupDeals(deals, keyOf) {
    const groups = new Map();
    deals.forEach((deal) => {
        const key = keyOf(deal);
        const entry = groups.get(key) || { value: 0, count: 0 };
        entry.value += dealValue(deal);
        entry.count += 1;
        groups.set(key, entry);
    });
    return [...groups.entries()].sort((a, b) => b[1].value - a[1].value);
}

function countBy(items, keyOf) {
    const counts = new Map();
    items.forEach((item) => counts.set(keyOf(item), (counts.get(keyOf(item)) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function renderSalesKpis(window, current) {
    salesKpi('revenue', { value: money(current.revenue), note: `${plural(current.won.length, 'won deal')} · ${window.label}` });
    renderSalesTiers(window, current);

    const byMarket = countBy(current.won, (deal) => deal.market);
    salesKpi('deals', {
        value: number(current.won.length),
        note: state.scope === 'all' && byMarket.length
            ? byMarket.map(([market, count]) => `${SALES_MARKET_LABELS[market] || market} ${count}`).join(' · ')
            : `${plural(current.lost.length, 'lost deal')} in the same period`,
    });

    if (window.bounded) {
        const previousWindow = previousWindowOf({ start: window.start, end: window.end });
        const previous = salesMeasure({ ...previousWindow, from: salesDay(previousWindow.start), to: salesDay(previousWindow.end) });
        const growth = previous.revenue > 0 ? (current.revenue - previous.revenue) / previous.revenue : null;
        salesKpi('growth', {
            value: hasValue(growth) ? signedPercent(growth) : DASH,
            note: previous.revenue > 0 ? `vs ${money(previous.revenue)} in ${previousWindow.label}` : `No won deals in ${previousWindow.label} to compare`,
            tone: toneClass(growth),
        });
    } else {
        salesKpi('growth', { value: DASH, note: 'Choose a month or range to compare' });
    }

    const months = monthKeysBetween(window.start, window.end);
    const plan = salesTargetFor(months, state.salesOwner);
    const coverage = plan.covered && plan.covered < plan.months ? ` · target set for ${plan.covered} of ${plan.months} months` : '';
    salesKpi('target', {
        value: hasValue(plan.target) && plan.target > 0 ? percentOr(current.revenue / plan.target, 0) : DASH,
        note: hasValue(plan.target) ? `${money(current.revenue)} of ${money(plan.target)}${coverage}` : 'No sales target for this period yet',
        ratio: hasValue(plan.target) && plan.target > 0 ? current.revenue / plan.target : null,
    });

    const anchor = window.bounded ? window.end : startOfToday();
    const quarterStart = new Date(anchor.getFullYear(), Math.floor(anchor.getMonth() / 3) * 3, 1);
    const quarterEnd = endOfMonth(new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 2, 1));
    const toDate = anchor < quarterEnd ? anchor : quarterEnd;
    const quarterRevenue = salesMeasure({ start: quarterStart, end: toDate, from: salesDay(quarterStart), to: salesDay(toDate) }).revenue;
    const quarterPlan = salesTargetFor(monthKeysBetween(quarterStart, quarterEnd), state.salesOwner);
    setText('#sales-quarter-label', `Q${Math.floor(quarterStart.getMonth() / 3) + 1} ${quarterStart.getFullYear()} to date`);
    salesKpi('quarter', {
        value: hasValue(quarterPlan.target) && quarterPlan.target > 0 ? percentOr(quarterRevenue / quarterPlan.target, 0) : DASH,
        note: hasValue(quarterPlan.target) ? `${money(quarterRevenue)} of ${money(quarterPlan.target)} for the quarter` : `${money(quarterRevenue)} won, no quarter target yet`,
        ratio: hasValue(quarterPlan.target) && quarterPlan.target > 0 ? quarterRevenue / quarterPlan.target : null,
    });
}

function renderSalesFunnel(window, current) {
    const stages = [
        ['leads', 'Leads', current.leads.length],
        ['mql', 'MQL', current.mql],
        ['sql', 'SQL', current.sql],
    ];
    $('#sales-funnel').innerHTML = `${stages.map(([key, label, value]) => `<div class="funnel-stage is-${key}"><strong>${number(value)}</strong><span>${label}</span></div>`).join('')}
        <div class="funnel-outcomes">
            <div class="is-won"><strong>${number(current.won.length)}</strong><span>Won</span></div>
            <div class="is-lost"><strong>${number(current.lost.length)}</strong><span>Lost</span></div>
        </div>`;
    const rate = (label, part, whole) => `<span>${label} <strong>${hasValue(share(part, whole)) ? percentOr(share(part, whole), 0) : DASH}</strong></span>`;
    $('#sales-funnel-rates').innerHTML = [
        rate('Lead to MQL', current.mql, current.leads.length),
        rate('MQL to SQL', current.sql, current.mql),
        rate('SQL to won', current.won.length, current.sql),
    ].join('');
    setText('#sales-funnel-meta', `${window.label} · reached each stage in the period`);
}

function renderSalesBreakdowns(current) {
    const data = state.sales.data;
    $('#sales-by-market').innerHTML = salesBarRows(groupDeals(current.won, (deal) => deal.market).map(([market, entry]) => ({
        label: SALES_MARKET_LABELS[market] || market, value: entry.value, sub: plural(entry.count, 'deal'), color: SALES_MARKET_COLORS[market] || '#a5a6a0',
    })), { empty: 'No won deals in this period' });
    const wonLink = $('#open-sales-won-modal');
    if (wonLink) {
        wonLink.hidden = current.won.length === 0;
        wonLink.firstChild.textContent = `See ${plural(current.won.length, 'client')} `;
    }

    $('#sales-by-owner').innerHTML = salesBarRows(groupDeals(current.won, (deal) => deal.owner || '').slice(0, SALES_TOP_PEOPLE).map(([owner, entry]) => ({
        label: data.nameOf(owner), value: entry.value, sub: plural(entry.count, 'deal'), color: data.colorOf(owner),
    })), { empty: 'No won deals in this period' });

    $('#sales-leads-market').innerHTML = salesBarRows(countBy(current.leads, (contact) => contact.market).map(([market, count]) => ({
        label: SALES_MARKET_LABELS[market] || market, value: count, sub: 'leads', color: SALES_MARKET_COLORS[market] || '#a5a6a0',
    })), { format: number, empty: 'No leads in this period' });
}

function renderSalesChannels(window, current) {
    const spend = spendBySource(window);
    const adsReady = state.ads.status === 'ready';
    const leads = new Map(countBy(current.leads, (contact) => contact.channel));
    const rows = SALES_CHANNELS.map((channel) => {
        const count = leads.get(channel.key) || 0;
        const cost = channel.spend && adsReady ? spend[channel.spend] : null;
        return { ...channel, count, cost };
    }).filter((row) => row.count > 0 || row.cost > 0 || row.spend);

    const cell = (value, format) => (hasValue(value) ? format(value) : DASH);
    $('#sales-channels').innerHTML = rows.map((row) => `<tr>
        <td><span class="channel-dot" style="background:${row.color}" aria-hidden="true"></span>${escapeHtml(row.label)}</td>
        <td class="align-right mono">${number(row.count)}</td>
        <td class="align-right mono">${cell(row.cost, money)}</td>
        <td class="align-right mono">${row.count > 0 && hasValue(row.cost) ? moneyExact(row.cost / row.count) : DASH}</td>
    </tr>`).join('');

    const totalLeads = current.leads.length;
    const totalSpend = adsReady ? spend.google + spend.meta : null;
    $('#sales-channels-total').innerHTML = `<tr><td>All channels</td><td class="align-right mono">${number(totalLeads)}</td><td class="align-right mono">${cell(totalSpend, money)}</td><td class="align-right mono">${totalLeads > 0 && hasValue(totalSpend) ? moneyExact(totalSpend / totalLeads) : DASH}</td></tr>`;
    setText('#sales-spend-total', adsReady ? money(totalSpend) : state.ads.status === 'off' ? 'Not connected' : DASH);
}

function renderSalesActivity(window) {
    const data = state.sales.data;
    const partial = state.scope !== 'all' || state.category !== 'all';
    [['calls', 'call'], ['meetings', 'meeting']].forEach(([key, word]) => {
        const items = data[key].filter((item) => salesWithin(item.at, window) && salesOwnerMatch(item.owner));
        const totals = new Map();
        items.forEach((item) => totals.set(item.owner || '', (totals.get(item.owner || '') || 0) + (Number(item.n) || 1)));
        const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, SALES_TOP_PEOPLE).map(([owner, count]) => ({
            label: data.nameOf(owner), value: count, color: data.colorOf(owner),
        }));
        const total = [...totals.values()].reduce((sum, count) => sum + count, 0);
        $(`#sales-${key}`).innerHTML = salesBarRows(rows, { format: number, empty: `No ${word}s logged in this period` });
        setText(`#sales-${key}-meta`, `${plural(total, word)}${partial ? ' · every market and service' : ''}`);
    });
}

function renderSalesStats(window, current) {
    const decided = current.won.length + current.lost.length;
    setText('#sales-close-rate', decided ? percentOr(current.won.length / decided) : DASH);
    setText('#sales-close-rate-note', decided ? `${number(current.won.length)} won of ${plural(decided, 'closed deal')}` : 'No deals closed in this period');

    let cycleNote = current.cycleCount ? `From deal created to won, ${plural(current.cycleCount, 'deal')}` : 'No won deals in this period';
    if (window.bounded && hasValue(current.cycle)) {
        const previousWindow = previousWindowOf({ start: window.start, end: window.end });
        const previous = salesMeasure({ ...previousWindow, from: salesDay(previousWindow.start), to: salesDay(previousWindow.end) });
        if (hasValue(previous.cycle)) cycleNote = `${Math.round(previous.cycle)} days in ${previousWindow.label}`;
    }
    setText('#sales-cycle', hasValue(current.cycle) ? plural(Math.round(current.cycle), 'day') : DASH);
    setText('#sales-cycle-note', cycleNote);

    setText('#sales-lead-mql', current.leads.length ? percentOr(current.mql / current.leads.length, 0) : DASH);
    setText('#sales-lead-mql-note', `${number(current.mql)} MQL from ${plural(current.leads.length, 'lead')}`);

    const months = elapsedMonths(window);
    setText('#sales-velocity', `${(current.won.length / months).toFixed(1).replace(/\.0$/, '')}/mo`);
    setText('#sales-velocity-note', `${plural(current.won.length, 'won deal')} over ${plural(months, 'month')}`);
}

function salesChartOptions(format) {
    const options = summaryChartOptions();
    options.plugins.tooltip.callbacks.label = (item) => `${item.dataset.label}: ${format(item.parsed.y)}`;
    options.scales.y.ticks.callback = (value) => compactMoney(value);
    options.scales.y.beginAtZero = true;
    return options;
}

function renderSalesCharts(window) {
    const last = window.bounded ? new Date(window.end.getFullYear(), window.end.getMonth(), 1) : new Date(startOfToday().getFullYear(), startOfToday().getMonth(), 1);
    const months = monthKeysBetween(new Date(last.getFullYear(), last.getMonth() - (SALES_TREND_MONTHS - 1), 1), last);
    const labels = months.map((key) => new Intl.DateTimeFormat('en-US', { month: 'short' }).format(monthFromKey(key)));

    const revenue = revenueByMonth(months);
    const targets = months.map((key) => resolveSalesTarget(key, state.scope, state.category, state.salesOwner));
    if (state.salesCharts.trend) state.salesCharts.trend.destroy();
    state.salesCharts.trend = new Chart($('#sales-trend-chart'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Revenue', data: revenue, borderColor: '#57745d', backgroundColor: 'rgba(87,116,93,.12)', fill: 'origin', cubicInterpolationMode: 'monotone', pointRadius: 3, pointBackgroundColor: '#57745d', borderWidth: 2 },
                { label: 'Target', data: targets, borderColor: '#7b827d', borderDash: [5, 4], pointRadius: 2, pointBackgroundColor: '#7b827d', fill: false, cubicInterpolationMode: 'monotone', borderWidth: 1.5, spanGaps: false },
            ],
        },
        options: salesChartOptions(money),
    });
    const trendEmpty = $('#sales-trend-empty');
    trendEmpty.textContent = 'No won deals or targets in these months';
    trendEmpty.classList.toggle('is-hidden', revenue.some((value) => value > 0) || targets.some(hasValue));

    const spend = spendByMonth(months);
    if (state.salesCharts.spend) state.salesCharts.spend.destroy();
    state.salesCharts.spend = new Chart($('#sales-spend-chart'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Ad spend', data: spend, backgroundColor: spend.map((_, index) => (index === spend.length - 1 ? '#d49b35' : '#ead6ab')), borderRadius: 2, barPercentage: .62 }] },
        options: { ...salesChartOptions(money), plugins: { ...salesChartOptions(money).plugins, legend: { display: false } } },
    });
    const spendEmpty = $('#sales-spend-empty');
    spendEmpty.textContent = state.ads.status === 'off' ? 'Ads integration is not set up' : state.ads.status === 'loading' ? 'Loading ad spend…' : state.ads.status === 'error' ? 'Ad spend could not be loaded' : 'No ad spend in these months';
    spendEmpty.classList.toggle('is-hidden', spend.some((value) => value > 0));
}

function renderSalesStatus() {
    const node = $('#sales-status');
    if (!node) return;
    const { status, data, errors } = state.sales;
    const notes = [];
    let tone = 'muted';
    if (status === 'loading' && !data) notes.push('Loading HubSpot data…');
    else if (status === 'off') notes.push('HubSpot is not connected yet. Add N8N_WEBHOOK_SALES to the .env file and press Refresh.');
    else if (status === 'error' && !data) { notes.push(`Could not load HubSpot data. ${errors.join(' ')}`); tone = 'error'; }
    else if (data) {
        const fetched = Date.parse(data.fetchedAt || '');
        notes.push(Number.isFinite(fetched) ? `HubSpot data from ${relativeTime(fetched)}.` : 'HubSpot data loaded.');
        if (state.salesPoll && !state.salesPoll.timedOut) notes.push('Fetching new HubSpot data in the background. This page updates on its own in a few minutes.');
        else if (state.salesPoll && state.salesPoll.timedOut) { notes.push('The HubSpot refresh is taking longer than usual. Check the workflow executions in n8n.'); tone = 'sample'; }
        if (state.category !== 'all') notes.push('Leads, calls, meetings and ad spend have no service line, so they count every service.');
        else if (state.scope !== 'all') notes.push('Calls and meetings have no market, so they count every market.');
        if (errors.length) { notes.push(errors.join(' ')); tone = 'sample'; }
    }
    if (state.salesTargetsStatus === 'error') { notes.push(`Sales targets: ${state.salesTargetsError}`); tone = 'error'; }
    if (state.goalList.status === 'error') { notes.push(`Sales goals: ${state.goalList.error}`); tone = 'error'; }
    if (data && state.salesOwner !== 'all') notes.push('Leads, MQL and SQL are not split by person.');
    const goalsNote = salesGoalsNote();
    if (goalsNote.text) {
        notes.push(goalsNote.text);
        if (goalsNote.tone === 'error') tone = 'error';
        else if (goalsNote.tone === 'sample' && tone === 'muted') tone = 'sample';
    }
    node.textContent = notes.join(' ');
    node.dataset.tone = tone;
}

function clearSalesPage() {
    ['revenue', 'deals', 'growth', 'target', 'quarter'].forEach((id) => salesKpi(id, { value: DASH, note: DASH, ratio: id === 'target' || id === 'quarter' ? null : undefined }));
    const waiting = state.sales.status === 'loading' ? 'Loading…' : 'No HubSpot data';
    ['#sales-funnel', '#sales-by-market', '#sales-by-owner', '#sales-leads-market', '#sales-calls', '#sales-meetings'].forEach((selector) => { $(selector).innerHTML = `<p class="sales-empty">${waiting}</p>`; });
    $('#sales-funnel-rates').innerHTML = '';
    const overviewTable = $('#sales-overview-table');
    if (overviewTable) overviewTable.innerHTML = '';
    const tierNode = $('#sales-revenue-tier');
    if (tierNode) tierNode.textContent = '';
    $('#sales-channels').innerHTML = '';
    $('#sales-channels-total').innerHTML = '';
    const wonLink = $('#open-sales-won-modal');
    if (wonLink) wonLink.hidden = true;
    ['#sales-close-rate', '#sales-cycle', '#sales-lead-mql', '#sales-velocity', '#sales-spend-total'].forEach((selector) => setText(selector, DASH));
    ['#sales-close-rate-note', '#sales-cycle-note', '#sales-lead-mql-note', '#sales-velocity-note'].forEach((selector) => setText(selector, ''));
    Object.values(state.salesCharts).forEach((chart) => chart.destroy());
    state.salesCharts = {};
    $('#sales-trend-empty').textContent = waiting;
    $('#sales-spend-empty').textContent = waiting;
    $('#sales-trend-empty').classList.remove('is-hidden');
    $('#sales-spend-empty').classList.remove('is-hidden');
}

function renderSales() {
    if (!$('#sales-view')) return;
    renderSalesStatus();
    if (!state.sales.data) { clearSalesPage(); return; }
    const window = salesWindow();
    const current = salesMeasure(window);
    renderSalesOwnerFilter();
    renderSalesKpis(window, current);
    renderSalesOverview(window);
    renderSalesFunnel(window, current);
    renderSalesBreakdowns(current);
    renderSalesChannels(window, current);
    renderSalesActivity(window);
    renderSalesStats(window, current);
    renderSalesCharts(window);
    const wonModal = $('#sales-won-modal');
    if (wonModal && wonModal.open) renderSalesWonModal();
}

// ---------- Modal dos clientes ganhos (painel By market) ----------

const salesWonModal = $('#sales-won-modal');
const SALES_SERVICE_LABELS = { ...categoryLabels, other: 'Unclassified' };
const SALES_DEAL_TYPES = { newbusiness: ['New', 'is-new'], existingbusiness: ['Existing', 'is-existing'] };
const salesDate = (day) => (day ? new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) : null);

function renderSalesWonModal() {
    const data = state.sales.data;
    if (!data) return;
    const window = salesWindow();
    const deals = salesMeasure(window).won
        .map((deal) => ({ ...deal, value: dealValue(deal) }))
        .sort((a, b) => b.closedAt.localeCompare(a.closedAt) || b.value - a.value);
    const total = sumOf(deals, (deal) => deal.value);
    const types = countBy(deals, (deal) => deal.type || '');
    const typeNote = types
        .filter(([type]) => SALES_DEAL_TYPES[type])
        .map(([type, count]) => `${number(count)} ${SALES_DEAL_TYPES[type][0].toLowerCase()}`);
    const untyped = deals.filter((deal) => !SALES_DEAL_TYPES[deal.type || '']).length;
    if (untyped) typeNote.push(`${number(untyped)} with no type`);

    setText('#sales-won-modal-context', `${state.scope === 'all' ? 'Global' : companyLabels[state.scope]} · ${serviceName(state.category)} · ${window.label}`);
    setText('#sales-won-modal-summary', deals.length
        ? `${plural(deals.length, 'client')} · ${money(total)} TCV${typeNote.length ? ` · ${typeNote.join(', ')}` : ''}`
        : 'No won deals in this period.');

    const split = state.category !== 'all' && deals.some((deal) => dealShare(deal) < 1);
    const unnamed = deals.some((deal) => !deal.name);
    const scopeNote = $('#sales-won-modal-scope');
    scopeNote.hidden = !split && !unnamed;
    scopeNote.textContent = [
        split ? `Some deals sold more than one service: only their ${serviceName(state.category)} share is counted here.` : '',
        unnamed ? 'Some deals show no name: the saved HubSpot data is from before deal names were fetched. Press Refresh to load them.' : '',
    ].filter(Boolean).join(' ');

    $('#sales-won-table').innerHTML = deals.map((deal) => {
        const lines = Object.entries(deal.shares || {}).filter(([, part]) => Number(part) > 0).map(([line]) => SALES_SERVICE_LABELS[line] || line).join(' + ');
        const cycle = deal.createdAt ? Math.max(0, Math.round((Date.parse(deal.closedAt) - Date.parse(deal.createdAt)) / DAY_MS)) : null;
        const [typeLabel, typeClass] = SALES_DEAL_TYPES[deal.type || ''] || [deal.type || DASH, 'is-other'];
        return `<tr>
            <td>${escapeHtml(deal.name || `Deal ${deal.id}`)}<span class="entry-sub">Closed ${escapeHtml(shortDate(salesDate(deal.closedAt)))}</span></td>
            <td>${escapeHtml(SALES_MARKET_LABELS[deal.market] || deal.market || DASH)}</td>
            <td>${escapeHtml(monthLabel(monthFromKey(deal.closedAt.slice(0, 7))))}</td>
            <td>${escapeHtml(lines || DASH)}</td>
            <td>${escapeHtml(data.nameOf(deal.owner))}</td>
            <td class="align-right mono">${hasValue(cycle) ? plural(cycle, 'day') : DASH}</td>
            <td class="align-right mono">${hasValue(deal.valueUsd) ? `<span class="value-up">${money(deal.value)}</span>` : DASH}</td>
            <td><span class="status-pill ${typeClass}">${escapeHtml(typeLabel)}</span></td>
        </tr>`;
    }).join('');
    $('#sales-won-table-empty').classList.toggle('is-hidden', deals.length > 0);
    $('#sales-won-table-total').classList.toggle('is-hidden', deals.length === 0);
    setText('#sales-won-total-value', money(total));
}

function openSalesWonModal() {
    renderSalesWonModal();
    salesWonModal.showModal();
}

function closeSalesWonModal() {
    salesWonModal.close();
    $('#open-sales-won-modal').focus();
}

if (salesWonModal) {
    $('#open-sales-won-modal').addEventListener('click', openSalesWonModal);
    salesWonModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeSalesWonModal));
    salesWonModal.addEventListener('click', (event) => { if (event.target === salesWonModal) closeSalesWonModal(); });
}

// ---------- Modal da meta ----------

const salesTargetModal = $('#sales-target-modal');
const salesTargetForm = $('#sales-target-form');

function showSalesTargetError(message, field) {
    const node = $('#sales-target-error');
    node.textContent = message;
    node.hidden = !message;
    if (field) field.focus();
}

function loadSalesTargetIntoForm() {
    const { month, scope, category, ownerId, revenueTarget } = salesTargetForm.elements;
    const entry = month.value ? state.salesTargets[salesTargetKey(month.value, scope.value, category.value, ownerId.value)] : null;
    revenueTarget.value = entry && hasValue(entry.revenueTarget) ? Number(entry.revenueTarget) : '';
    const combined = !entry && month.value ? resolveSalesTarget(month.value, scope.value, category.value, ownerId.value) : null;
    setText('#sales-target-hint', entry
        ? `Editing the saved target${entry.enteredAt ? ` from ${formatEnteredAt(entry.enteredAt)}` : ''}${entry.updatedBy ? ` by ${entry.updatedBy}` : ''}.`
        : hasValue(combined) ? `No target for this exact combination. The page currently adds up ${money(combined)} from markets and services.` : 'New target.');
    $('#sales-target-submit').textContent = entry ? 'Update target' : 'Save target';
}

function openSalesTargetModal() {
    if (document.body.dataset.salesTargets === 'off') return;
    const window = salesWindow();
    salesTargetForm.reset();
    showSalesTargetError('');
    // Vendedor já escolhido no filtro da página vem marcado; All salespeople = meta da empresa.
    fillSalesPersonSelect(salesTargetForm.elements.ownerId, 'All salespeople (company target)', state.salesOwner);
    salesTargetForm.elements.month.value = monthKey(window.bounded ? window.start : startOfToday());
    salesTargetForm.elements.scope.value = state.scope;
    salesTargetForm.elements.category.value = state.category;
    loadSalesTargetIntoForm();
    salesTargetModal.showModal();
}

function closeSalesTargetModal() { salesTargetModal.close(); $('#open-sales-target-modal').focus(); }

if (salesTargetModal && salesTargetForm) {
    $('#open-sales-target-modal').addEventListener('click', openSalesTargetModal);
    salesTargetModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeSalesTargetModal));
    salesTargetModal.addEventListener('click', (event) => { if (event.target === salesTargetModal) closeSalesTargetModal(); });
    ['month', 'scope', 'category', 'ownerId'].forEach((name) => salesTargetForm.elements[name].addEventListener('change', loadSalesTargetIntoForm));
    salesTargetForm.addEventListener('input', () => { if (!$('#sales-target-error').hidden) showSalesTargetError(''); });

    salesTargetForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const { month, scope, category, ownerId, revenueTarget } = salesTargetForm.elements;
        if (!/^\d{4}-\d{2}$/.test(month.value)) { showSalesTargetError('Choose the month this target belongs to.', month); return; }
        const value = Number(revenueTarget.value);
        if (revenueTarget.value.trim() === '' || !Number.isFinite(value) || value < 0) { showSalesTargetError('Enter the revenue target in USD.', revenueTarget); return; }

        const submit = $('#sales-target-submit');
        const label = submit.textContent;
        submit.disabled = true;
        submit.textContent = 'Saving…';
        try {
            const { entry } = await salesTargetsRequest({
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' },
                body: JSON.stringify({ month: month.value, scope: scope.value, category: category.value, ownerId: ownerId.value, revenueTarget: value }),
            });
            storeSalesTarget(entry);
            state.salesTargetsStatus = 'ready';
            closeSalesTargetModal();
            refreshOverviewSales();
            renderSales();
        } catch (error) {
            showSalesTargetError(error.message || 'Could not save the target.');
        } finally {
            submit.disabled = false;
            submit.textContent = label;
        }
    });
}

loadSales();
loadSalesTargets();
loadGoalList();

// ---------- Vendedor, metas por pessoa e visão geral ----------

const salesOwnerMatch = (owner) => state.salesOwner === 'all' || (owner || '') === state.salesOwner;

async function loadSalesGoals() {
    state.salesGoals = { ...state.salesGoals, status: 'loading' };
    try {
        const response = redirectIfSignedOut(await fetch(SALES_GOALS_ENDPOINT, { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
        if (body.configured === false) {
            state.salesGoals = { status: 'off', goals: [], kinds: [], errors: body.errors || [], warnings: [], fetchedAt: null };
        } else if (!response.ok) {
            throw new Error((body.errors || []).join(' · ') || `The server answered HTTP ${response.status}.`);
        } else {
            state.salesGoals = { status: 'ready', goals: body.goals || [], kinds: body.kinds || [], errors: body.errors || [], warnings: body.warnings || [], fetchedAt: body.fetchedAt || null };
        }
    } catch (error) {
        state.salesGoals = { status: 'error', goals: [], kinds: [], errors: [error.message], warnings: [], fetchedAt: null };
    }
    refreshOverviewSales();
    renderSales();
}

// Só aparece texto quando há algo a avisar (não conectado, erro ou aviso do workflow).
function salesGoalsNote() {
    const goals = state.salesGoals;
    if (goals.status === 'off') return { text: 'Targets by person are not connected: set N8N_WEBHOOK_GOALS in the .env with the webhook of the n8n workflow.', tone: 'sample' };
    if (goals.status === 'error') return { text: `Could not load targets by person: ${goals.errors.join(' · ')}`, tone: 'error' };
    if (goals.status === 'ready') {
        const extra = [...goals.errors, ...goals.warnings];
        if (extra.length) return { text: `Targets by person: ${extra.join(' · ')}`, tone: 'sample' };
    }
    return { text: '', tone: 'muted' };
}

// Salespeople vêm do HubSpot: owners dos deals e das metas, com o nome do owner.
function salesPeople() {
    const data = state.sales.data;
    if (!data) return [];
    const ids = new Set();
    data.deals.forEach((deal) => { if (deal.owner) ids.add(deal.owner); });
    state.salesGoals.goals.forEach((goal) => ids.add(goal.ownerId));
    return [...ids].map((id) => ({ id, name: data.nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name));
}

function renderSalesOwnerFilter() {
    const select = $('#sales-owner-select');
    if (!select) return;
    const people = salesPeople();
    if (state.salesOwner !== 'all' && !people.some((person) => person.id === state.salesOwner)) state.salesOwner = 'all';
    const signature = people.map((person) => `${person.id}:${person.name}`).join('|');
    if (select.dataset.signature !== signature) {
        select.dataset.signature = signature;
        select.innerHTML = `<option value="all">All salespeople</option>${people.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join('')}`;
    }
    select.value = state.salesOwner;
}

// Meta mensal de cada pessoa: a meta do HubSpot de um período (mês, trimestre, ano) é repartida por igual entre os meses dele.
function goalMonths(start, end) {
    const first = String(start).slice(0, 7);
    let last = String(end).slice(0, 7);
    if (String(end).slice(8, 10) === '01' && end > start) {
        const before = new Date(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, 0);
        last = monthKey(before);
    }
    if (last < first) last = first;
    return monthKeysBetween(monthFromKey(first), monthFromKey(last));
}

function salesMonthlyTargets() {
    const cache = state.salesGoalsCache;
    if (cache && cache.source === state.salesGoals) return cache.map;
    const map = new Map();
    state.salesGoals.goals.forEach((goal) => {
        const months = goalMonths(goal.start, goal.end);
        if (!months.length) return;
        const owner = map.get(goal.ownerId) || new Map();
        months.forEach((month) => owner.set(month, (owner.get(month) || 0) + goal.amount / months.length));
        map.set(goal.ownerId, owner);
    });
    state.salesGoalsCache = { source: state.salesGoals, map };
    return map;
}

const dealMonthly = (deal) => (Number(deal[SALES_NEW_SALES_FIELD]) || 0) * dealShare(deal);

// ---------- Vendas novas por mês (matriz do Overview) ----------
// Usadas por assets/overview.js. Seguem o mercado e o serviço filtrados no Overview e somam todos os vendedores
// (o filtro de vendedor é só da página Sales).

/** Vendas novas por mês (deals ganhos de negócio novo, pela receita mensal), na ordem de months. null = sem dados do HubSpot nesse mês. */
function overviewNewSales(months) {
    const data = state.sales.data;
    if (!data) return months.map(() => null);
    const totals = new Map(months.map((key) => [key, 0]));
    data.deals.forEach((deal) => {
        if (deal.outcome !== 'won' || deal.type === 'existingbusiness' || !deal.closedAt) return;
        if (!salesInScope(deal.market) || dealShare(deal) <= 0) return;
        const key = deal.closedAt.slice(0, 7);
        if (totals.has(key)) totals.set(key, totals.get(key) + dealMonthly(deal));
    });
    const since = data.since ? String(data.since).slice(0, 7) : null;
    const current = monthKey(startOfToday());
    // Mês futuro, ou anterior ao que o HubSpot trouxe: ainda não há como saber.
    return months.map((key) => (key > current || (since && key < since) ? null : totals.get(key)));
}

/**
 * Meta de vendas novas de um mês: a da empresa (Set sales target com "All salespeople"); se não houver,
 * a soma das metas dos vendedores; por fim a soma das metas do HubSpot (só sem filtro de mercado e serviço).
 */
function overviewSalesTarget(month) {
    const company = resolveSalesTarget(month, state.scope, state.category, 'all');
    if (hasValue(company)) return company;

    const owners = new Set(Object.values(state.salesTargets)
        .filter((entry) => entry.month === month && entry.ownerId && entry.ownerId !== 'all')
        .map((entry) => entry.ownerId));
    const people = [...owners].map((owner) => resolveSalesTarget(month, state.scope, state.category, owner)).filter(hasValue);
    if (people.length) return sumOf(people, Number);

    if (state.salesGoals.status === 'ready' && state.scope === 'all' && state.category === 'all') {
        const fromHubspot = [...salesMonthlyTargets().values()].map((byMonth) => byMonth.get(month)).filter(hasValue);
        if (fromHubspot.length) return sumOf(fromHubspot, Number);
    }
    return null;
}

// Os dados de vendas e de metas chegam depois da página: avisa a matriz do Overview para se refazer.
function refreshOverviewSales() {
    if (typeof refreshSummaryMatrix === 'function') refreshSummaryMatrix();
}

// Vendas novas por pessoa no período: deals ganhos de negócio novo (não "existing business"), pela receita mensal.
function salesNewByOwner(window) {
    const people = new Map();
    let withoutRevenue = 0;
    state.sales.data.deals.forEach((deal) => {
        if (deal.outcome !== 'won' || deal.type === 'existingbusiness' || !salesWithin(deal.closedAt, window)) return;
        if (!salesInScope(deal.market) || dealShare(deal) <= 0) return;
        if (!hasValue(deal[SALES_NEW_SALES_FIELD])) withoutRevenue += 1;
        const key = deal.owner || '';
        const entry = people.get(key) || { sales: 0, deals: 0 };
        entry.sales += dealMonthly(deal);
        entry.deals += 1;
        people.set(key, entry);
    });
    return { people, withoutRevenue };
}

function renderSalesOverview(window) {
    const body = $('#sales-overview-table');
    if (!body || !state.sales.data) return;
    const data = state.sales.data;
    const { people, withoutRevenue } = salesNewByOwner(window);
    const targets = salesMonthlyTargets();
    const months = monthKeysBetween(window.start, window.end);
    const targetsApply = state.salesGoals.status === 'ready' && state.scope === 'all' && state.category === 'all';

    // Meta do vendedor: a que se grava em "Set sales target" (segue os filtros de mercado e serviço);
    // sem ela, a meta do HubSpot, que só vale sem filtro de mercado nem de serviço.
    const manualOf = (owner) => {
        if (!owner) return null;
        const values = months.map((month) => resolveSalesTarget(month, state.scope, state.category, owner)).filter(hasValue);
        return values.length ? sumOf(values, Number) : null;
    };
    const hubspotOf = (owner) => {
        if (!targetsApply || !owner || !targets.has(owner)) return null;
        const values = months.map((month) => targets.get(owner).get(month)).filter(hasValue);
        return values.length ? sumOf(values, (value) => value) : null;
    };
    const targetOf = (owner) => {
        const manual = manualOf(owner);
        return hasValue(manual) ? manual : hubspotOf(owner);
    };
    const manualOwners = new Set(Object.values(state.salesTargets)
        .filter((entry) => entry.ownerId && entry.ownerId !== 'all' && months.includes(entry.month))
        .map((entry) => entry.ownerId));
    const ids = new Set([...people.keys()]);
    manualOwners.forEach((owner) => { if (targetOf(owner) !== null) ids.add(owner); });
    if (targetsApply) targets.forEach((_, owner) => { if (targetOf(owner) !== null) ids.add(owner); });

    const rows = [...ids]
        .filter((id) => state.salesOwner === 'all' || id === state.salesOwner)
        .map((id) => ({ id, name: data.nameOf(id), sales: (people.get(id) || { sales: 0 }).sales, deals: (people.get(id) || { deals: 0 }).deals, target: targetOf(id) }))
        .sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name));

    const missingOf = (sales, target) => (hasValue(target) && target > 0 ? Math.max(0, 1 - sales / target) : null);
    const cells = (row) => {
        const missing = missingOf(row.sales, row.target);
        const tone = missing === null ? '' : missing === 0 ? 'value-up' : 'value-down';
        return `<td class="align-right mono">${money(row.sales)}<span class="entry-sub">${plural(row.deals, 'deal')}</span></td>
            <td class="align-right mono">${moneyOr(row.target)}</td>
            <td class="align-right mono"><span class="${tone}">${missing === null ? DASH : percentOr(missing, 0)}</span></td>`;
    };

    let html = rows.map((row) => `<tr><td><i class="legend-dot" style="background:${data.colorOf(row.id)}"></i> ${escapeHtml(row.name)}</td>${cells(row)}</tr>`).join('');
    if (rows.length > 1) {
        const withTarget = rows.filter((row) => hasValue(row.target));
        const total = { sales: sumOf(rows, (row) => row.sales), deals: sumOf(rows, (row) => row.deals), target: withTarget.length ? sumOf(withTarget, (row) => row.target) : null };
        const comparable = sumOf(withTarget, (row) => row.sales);
        const missing = missingOf(comparable, total.target);
        const tone = missing === null ? '' : missing === 0 ? 'value-up' : 'value-down';
        html += `<tr class="is-total"><td><strong>Total</strong></td><td class="align-right mono"><strong>${money(total.sales)}</strong><span class="entry-sub">${plural(total.deals, 'deal')}</span></td>
            <td class="align-right mono"><strong>${moneyOr(total.target)}</strong></td>
            <td class="align-right mono" title="Compared only with the people who have a target"><span class="${tone}">${missing === null ? DASH : percentOr(missing, 0)}</span></td></tr>`;
    }
    body.innerHTML = html || `<tr><td colspan="4" class="table-empty">No new sales in this period.</td></tr>`;

    const note = $('#sales-overview-note');
    if (note) {
        const parts = [`New sales = won deals of new business, by ${SALES_NEW_SALES_FIELD === 'mrrUsd' ? 'monthly recurring revenue (MRR)' : 'deal value'}, in USD.`];
        parts.push('Targets are the ones set in Set sales target for each salesperson, or the HubSpot goals when none was set.');
        if (!rows.some((row) => hasValue(row.target))) parts.push('No targets by person for this period yet: use Set sales target and choose a salesperson.');
        else if (state.salesGoals.status === 'ready' && !targetsApply) parts.push('HubSpot goals only count with no market or service filter; targets from Set sales target follow the filters.');
        if (withoutRevenue) parts.push(`${plural(withoutRevenue, 'won deal')} without ${SALES_NEW_SALES_FIELD === 'mrrUsd' ? 'MRR' : 'a value'} in HubSpot count as $0.`);
        note.textContent = parts.join(' ');
        note.dataset.tone = withoutRevenue ? 'sample' : 'muted';
    }
}

const salesOwnerSelect = $('#sales-owner-select');
if (salesOwnerSelect) {
    salesOwnerSelect.addEventListener('change', () => {
        state.salesOwner = salesOwnerSelect.value || 'all';
        renderSales();
    });
}

// ---------- Vendedores nos formulários ----------

// Quem aparece nas listas dos formulários: salespeople dos deals e das metas do HubSpot mais todos os owners ativos
// (um vendedor novo, sem nenhum deal ainda, também precisa poder receber meta).
function salesFormPeople() {
    const data = state.sales.data;
    const people = new Map(salesPeople().map((person) => [person.id, person.name]));
    if (data) {
        Object.entries(data.owners || {}).forEach(([id, owner]) => {
            if (owner && owner.active && !people.has(id)) people.set(id, owner.name || `Owner ${id}`);
        });
    }
    return [...people.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

function fillSalesPersonSelect(select, allLabel, selected = 'all') {
    const people = salesFormPeople();
    if (selected !== 'all' && !people.some((person) => person.id === selected)) {
        people.push({ id: selected, name: state.sales.data ? state.sales.data.nameOf(selected) : `Owner ${selected}` });
    }
    select.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>${people.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join('')}`;
    select.value = selected;
}

// ---------- Metas por tier (tabela sales_goals, via goals.php) ----------
// Cada meta tem nome livre, valor em USD por mês, vendedor, mercado e serviço ('all' = vale para todos).
// Não há lista fixa de tiers: o card de TCV mostra quais metas da visão atual o período já alcançou.

async function goalsRequest(options = {}) {
    const response = redirectIfSignedOut(await fetch(GOALS_ENDPOINT, { cache: 'no-store', ...options }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `The server answered HTTP ${response.status}.`);
    return body;
}

const sortGoals = (goals) => [...goals].sort((a, b) => a.amount - b.amount || a.name.localeCompare(b.name));

async function loadGoalList() {
    try {
        const { goals = [] } = await goalsRequest();
        state.goalList = { status: 'ready', goals: sortGoals(goals), error: '' };
    } catch (error) {
        state.goalList = { status: 'error', goals: state.goalList.goals, error: error.message };
    }
    renderSales();
    if (typeof renderSalesGoalsTable === 'function') renderSalesGoalsTable();
}

/**
 * Metas que valem para a visão atual. Uma meta vale quando vendedor, mercado e serviço dela são "all"
 * ou iguais ao que está filtrado na página. Se duas têm o mesmo nome, vence a mais específica.
 * O valor é mensal: um período de vários meses multiplica pelo número de meses.
 */
function goalTiersForView(window) {
    if (state.goalList.status !== 'ready') return [];
    const months = Math.max(1, monthKeysBetween(window.start, window.end).length);
    const best = new Map();
    state.goalList.goals.forEach((goal) => {
        if (goal.ownerId !== 'all' && goal.ownerId !== state.salesOwner) return;
        if (goal.scope !== 'all' && goal.scope !== state.scope) return;
        if (goal.category !== 'all' && goal.category !== state.category) return;
        const specificity = (goal.ownerId !== 'all' ? 4 : 0) + (goal.scope !== 'all' ? 2 : 0) + (goal.category !== 'all' ? 1 : 0);
        const key = goal.name.toLowerCase();
        if (!best.has(key) || specificity > best.get(key).specificity) best.set(key, { name: goal.name, monthly: goal.amount, specificity });
    });
    return [...best.values()]
        .map((goal) => ({ name: goal.name, monthly: goal.monthly, amount: goal.monthly * months }))
        .sort((a, b) => a.amount - b.amount || a.name.localeCompare(b.name));
}

// Linha de tiers do card "Total contract value (goals by tier)".
function renderSalesTiers(window, current) {
    const node = $('#sales-revenue-tier');
    if (!node) return;
    node.classList.remove('is-reached');
    node.removeAttribute('title');
    const { status } = state.goalList;
    if (status === 'loading') { node.textContent = ''; return; }
    if (status === 'error') { node.textContent = 'Goal tiers could not be loaded'; return; }
    const tiers = goalTiersForView(window);
    if (!tiers.length) { node.textContent = 'No goal tiers for this view'; return; }

    const tcv = Number(current.revenue) || 0;
    const reached = tiers.filter((tier) => tcv >= tier.amount);
    const next = tiers.find((tier) => tcv < tier.amount);
    const top = reached.length ? reached[reached.length - 1] : null;
    const parts = [top ? `${top.name} reached` : 'No tier reached yet'];
    parts.push(next ? `${money(next.amount - tcv)} to ${next.name}` : 'top tier');
    node.textContent = parts.join(' · ');
    node.classList.toggle('is-reached', Boolean(top));
    node.title = tiers.map((tier) => `${tier.name}: ${money(tier.amount)}`).join(' · ');
}

// ---------- Modal "Manage goals" ----------

const salesGoalsModal = $('#sales-goals-modal');
const salesGoalsForm = $('#sales-goals-form');
const GOALS_DEFAULT_HINT = 'Amounts are per month. A period of several months multiplies them.';

function showSalesGoalsError(message, field) {
    const node = $('#sales-goals-error');
    node.textContent = message;
    node.hidden = !message;
    if (field) field.focus();
}

function salesGoalLabels(goal) {
    const data = state.sales.data;
    const known = data && data.owners && data.owners[goal.ownerId];
    return {
        owner: goal.ownerId === 'all' ? 'All salespeople' : (known ? known.name : goal.ownerName || 'Former owner'),
        market: goal.scope === 'all' ? 'All markets' : (SALES_MARKET_LABELS[goal.scope] || goal.scope),
        service: goal.category === 'all' ? 'All services' : (SALES_SERVICE_LABELS[goal.category] || goal.category),
    };
}

function renderSalesGoalsTable() {
    const body = $('#sales-goals-table');
    if (!body || !salesGoalsForm) return;
    const goals = state.goalList.goals;
    const editing = salesGoalsForm.elements.id.value;
    body.innerHTML = goals.map((goal) => {
        const label = salesGoalLabels(goal);
        return `<tr${String(goal.id) === editing ? ' class="is-editing"' : ''}>
            <td>${escapeHtml(goal.name)}</td>
            <td>${escapeHtml(label.owner)}</td>
            <td>${escapeHtml(label.market)}</td>
            <td>${escapeHtml(label.service)}</td>
            <td class="align-right mono">${money(goal.amount)}</td>
            <td class="goal-actions"><button type="button" data-goal-edit="${goal.id}">Edit</button><button type="button" data-goal-delete="${goal.id}">Delete</button></td>
        </tr>`;
    }).join('');
    $('#sales-goals-empty').classList.toggle('is-hidden', goals.length > 0 || state.goalList.status !== 'ready');
}

function resetSalesGoalsForm(hint = GOALS_DEFAULT_HINT) {
    salesGoalsForm.reset();
    fillSalesPersonSelect(salesGoalsForm.elements.ownerId, 'All salespeople', 'all');
    salesGoalsForm.elements.id.value = '';
    setText('#sales-goals-legend', 'New goal');
    $('#sales-goals-submit').textContent = 'Save goal';
    setText('#sales-goals-hint', hint);
    showSalesGoalsError('');
    renderSalesGoalsTable();
}

function editSalesGoal(id) {
    const goal = state.goalList.goals.find((item) => String(item.id) === String(id));
    if (!goal) return;
    const { name, amount, ownerId, scope, category } = salesGoalsForm.elements;
    fillSalesPersonSelect(ownerId, 'All salespeople', goal.ownerId);
    salesGoalsForm.elements.id.value = String(goal.id);
    name.value = goal.name;
    amount.value = goal.amount;
    scope.value = goal.scope;
    category.value = goal.category;
    setText('#sales-goals-legend', `Editing “${goal.name}”`);
    $('#sales-goals-submit').textContent = 'Update goal';
    setText('#sales-goals-hint', `${goal.updatedBy ? `Last saved by ${goal.updatedBy}` : 'Saved goal'}${goal.enteredAt ? ` on ${formatEnteredAt(goal.enteredAt)}` : ''}.`);
    showSalesGoalsError('');
    renderSalesGoalsTable();
    name.focus();
}

async function deleteSalesGoal(id) {
    const goal = state.goalList.goals.find((item) => String(item.id) === String(id));
    if (!goal || !confirm(`Delete the goal “${goal.name}”?`)) return;
    try {
        await goalsRequest({
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' },
            body: JSON.stringify({ action: 'delete', id: goal.id }),
        });
        state.goalList = { ...state.goalList, goals: state.goalList.goals.filter((item) => item.id !== goal.id) };
        const wasEditing = salesGoalsForm.elements.id.value === String(goal.id);
        if (wasEditing) resetSalesGoalsForm(`Deleted “${goal.name}”.`);
        else { renderSalesGoalsTable(); setText('#sales-goals-hint', `Deleted “${goal.name}”.`); }
        renderSales();
    } catch (error) {
        showSalesGoalsError(error.message || 'Could not delete the goal.');
    }
}

function openSalesGoalsModal() {
    if (document.body.dataset.salesTargets === 'off') return;
    resetSalesGoalsForm();
    if (state.goalList.status === 'error') showSalesGoalsError(state.goalList.error);
    salesGoalsModal.showModal();
}

function closeSalesGoalsModal() { salesGoalsModal.close(); $('#open-sales-goals-modal').focus(); }

if (salesGoalsModal && salesGoalsForm) {
    $('#open-sales-goals-modal').addEventListener('click', openSalesGoalsModal);
    salesGoalsModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeSalesGoalsModal));
    salesGoalsModal.addEventListener('click', (event) => { if (event.target === salesGoalsModal) closeSalesGoalsModal(); });
    $('#sales-goals-new').addEventListener('click', () => resetSalesGoalsForm());
    salesGoalsForm.addEventListener('input', () => { if (!$('#sales-goals-error').hidden) showSalesGoalsError(''); });
    $('#sales-goals-table').addEventListener('click', (event) => {
        const edit = event.target.closest('[data-goal-edit]');
        const remove = event.target.closest('[data-goal-delete]');
        if (edit) editSalesGoal(edit.dataset.goalEdit);
        else if (remove) deleteSalesGoal(remove.dataset.goalDelete);
    });

    salesGoalsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const { id, name, amount, ownerId, scope, category } = salesGoalsForm.elements;
        if (!name.value.trim()) { showSalesGoalsError('Give the goal a name, for example Tier 1.', name); return; }
        const value = Number(amount.value);
        if (amount.value.trim() === '' || !Number.isFinite(value) || value <= 0) { showSalesGoalsError('Enter the goal amount in USD, greater than zero.', amount); return; }

        const submit = $('#sales-goals-submit');
        const label = submit.textContent;
        submit.disabled = true;
        submit.textContent = 'Saving…';
        try {
            const { goal } = await goalsRequest({
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' },
                body: JSON.stringify({
                    id: id.value ? Number(id.value) : null,
                    name: name.value.trim(),
                    amount: value,
                    ownerId: ownerId.value,
                    ownerName: ownerId.value === 'all' ? null : ownerId.selectedOptions[0].textContent,
                    scope: scope.value,
                    category: category.value,
                }),
            });
            const others = state.goalList.goals.filter((item) => item.id !== goal.id);
            state.goalList = { status: 'ready', goals: sortGoals([...others, goal]), error: '' };
            resetSalesGoalsForm(`Saved “${goal.name}”. Add another goal, or close this window.`);
            renderSales();
        } catch (error) {
            showSalesGoalsError(error.message || 'Could not save the goal.');
        } finally {
            submit.disabled = false;
            if (submit.textContent === 'Saving…') submit.textContent = label;
        }
    });
}