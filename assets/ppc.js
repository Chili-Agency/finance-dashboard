const PPC_ENDPOINT = 'ppc.php';
const PPC_CAMPAIGNS_ENDPOINT = 'ppc-campaigns.php';
const PPC_NPS_ENDPOINT = 'ppc-nps.php';
const PPC_STATUSES = ['Off Track', 'On Track', 'No Objective', 'No Data'];
const PPC_STATUS_CLASS = { 'Off Track': 'is-off', 'On Track': 'is-on', 'No Objective': 'is-muted', 'No Data': 'is-muted' };
const PPC_KPI_CLASS = { 'Off Track': 'is-negative', 'On Track': 'is-positive', 'No Objective': 'is-neutral' };
const PPC_STATUS_COLORS = ['#b82d1c', '#57745d', '#7b827d', '#c9c8c0'];
const PPC_REGIONS = ['Brasil', 'Panama', 'Panama INT', 'Mexico', 'Other'];
const PPC_REGION_LABELS = { Brasil: 'Brazil' };
const PPC_REGION_BADGES = { Brasil: 'BR', Panama: 'PA', 'Panama INT': 'PA', Mexico: 'MX', Other: 'OT' };
const PPC_REGION_COLORS = { Brasil: '#57745d', Panama: '#55778a', 'Panama INT': '#8aa5b3', Mexico: '#e84d2c', Other: '#b9bdb8' };
const PPC_CHANNEL_COLORS = { google: '#57745d', meta: '#55778a' };
const PPC_NO_DATA = 'No Data';
const PPC_NPS_MIN_RESPONSES = 5;
const PPC_NPS_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PPC_HM_ORDER = ['Overdue', 'In Progress', 'Not Started', 'Completed', 'N/A'];
const PPC_HM_ACTIVE = ['Overdue', 'In Progress', 'Not Started'];
const PPC_HM_TONE = { Completed: 'is-done', 'In Progress': 'is-progress', Overdue: 'is-overdue', 'Not Started': 'is-idle', 'N/A': 'is-idle' };
const PPC_HM_WEEKS = ['Wk1 Media Plan', 'Wk2 Creative & Campaign Setup', 'Wk3 Launch & Report', 'Wk4 Project Hygiene'];
const PPC_LATE_BANDS = [
    { key: 'late1to7', label: '1–7 days', color: '#d49b35' },
    { key: 'late8to30', label: '8–30 days', color: '#e0803a' },
    { key: 'late30plus', label: 'Over 30 days', color: '#b82d1c' },
];
const PPC_CLICKUP_TEAM = '9014972154';

state.ppc = { status: 'loading', data: null, errors: [], warnings: [], fetchedAt: null, updatedAt: null };
state.ppcNps = { status: 'idle', rows: [], responses: [], error: null, fetchedAt: null };
state.ppcUi = {
    status: [],
    channel: [],
    collapsedGroups: [PPC_NO_DATA],
    hm: { status: null, week: null, expanded: null, legacyOpen: false },
    nps: { period: null, expanded: null, search: '' },
    drawer: { row: null, status: 'idle', items: [], message: '' },
    charts: {},
    sections: { nps: ppcStored('nps'), hm: ppcStored('hm'), late: ppcStored('late') },
};

function ppcStored(key) {
    try { return localStorage.getItem(`ppc-collapsed-${key}`) === '1'; } catch (error) { return false; }
}

function ppcStore(key, collapsed) {
    try { localStorage.setItem(`ppc-collapsed-${key}`, collapsed ? '1' : '0'); } catch (error) { return; }
}

const ppcNum = (value, digits = 2) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
const ppcHas = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const ppcCell = (value, digits = 2) => ppcHas(value) ? ppcNum(value, digits) : DASH;
const ppcMoney = (value, currency) => ppcHas(value) ? `${currency ? `<small class="ppc-currency">${escapeHtml(currency)}</small>` : ''}${ppcNum(value)}` : DASH;
const ppcRegion = (value) => PPC_REGIONS.includes(value) ? value : 'Other';
const ppcRegionLabel = (name) => PPC_REGION_LABELS[name] || name;
const ppcStatusOf = (account) => PPC_STATUSES.includes(account.goalStatus) ? account.goalStatus : PPC_NO_DATA;
const ppcIsNoData = (account) => ppcStatusOf(account) === PPC_NO_DATA && !account.spend && !account.clicks && !account.impressions;
const ppcDay = (value) => { const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || ''); return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null; };
const ppcDateText = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const ppcDateTimeText = (date) => date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const ppcChannelColor = (name) => /google/i.test(name) ? PPC_CHANNEL_COLORS.google : /meta|facebook/i.test(name) ? PPC_CHANNEL_COLORS.meta : '#b9bdb8';

function ppcAccounts() {
    return (state.ppc.data?.accounts || []).map((account) => ({ ...account, status: ppcStatusOf(account) }));
}

function ppcFiltered(accounts) {
    const ui = state.ppcUi;
    return accounts.filter((account) => (!ui.status.length || ui.status.includes(account.status)) && (!ui.channel.length || ui.channel.includes(account.channel)));
}

function ppcSortRows(rows) {
    const rank = (account) => { const index = PPC_STATUSES.indexOf(account.goalStatus); return index === -1 ? PPC_STATUSES.length : index; };
    return [...rows].sort((a, b) => rank(a) - rank(b) || (b.spend || 0) - (a.spend || 0));
}

async function loadPpc() {
    state.ppc = { ...state.ppc, status: 'loading' };
    renderPpc();
    try {
        const response = redirectIfSignedOut(await fetch(PPC_ENDPOINT, { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
        if (body.configured === false) {
            state.ppc = { status: 'off', data: null, errors: body.errors || [], warnings: [], fetchedAt: null, updatedAt: null };
        } else if (!response.ok) {
            throw new Error((body.errors || []).join(' · ') || `The server answered HTTP ${response.status}.`);
        } else if (!(body.accounts || []).length) {
            state.ppc = { status: 'empty', data: null, errors: body.errors || [], warnings: body.warnings || [], fetchedAt: null, updatedAt: null };
        } else {
            state.ppc = {
                status: 'ready',
                data: { accounts: body.accounts || [], honeymoon: body.honeymoon || [], lateTasks: body.lateTasks || [] },
                errors: body.errors || [],
                warnings: body.warnings || [],
                fetchedAt: body.fetchedAt || null,
                updatedAt: body.updatedAt || null,
            };
        }
    } catch (error) {
        state.ppc = { status: 'error', data: null, errors: [error.message], warnings: [], fetchedAt: null, updatedAt: null };
    }
    renderPpc();
}

async function loadPpcNps() {
    state.ppcNps = { ...state.ppcNps, status: 'loading' };
    renderPpc();
    try {
        const response = redirectIfSignedOut(await fetch(PPC_NPS_ENDPOINT, { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
        if (body.configured === false) {
            state.ppcNps = { status: 'off', rows: [], responses: [], error: body.error || null, fetchedAt: null };
        } else if (!response.ok) {
            throw new Error(body.error || `The server answered HTTP ${response.status}.`);
        } else {
            state.ppcNps = { status: 'ready', rows: body.rows || [], responses: body.responses || [], error: null, fetchedAt: body.fetchedAt || null };
        }
    } catch (error) {
        state.ppcNps = { status: 'error', rows: [], responses: [], error: error.message, fetchedAt: null };
    }
    renderPpc();
}

function ppcViewVisible() {
    const view = $('#ppc-view');
    return Boolean(view && view.classList.contains('is-visible'));
}

function renderPpc() {
    if (!ppcViewVisible()) return;
    renderPpcSources();
    renderPpcOverview();
    renderPpcNps();
    renderPpcHoneymoon();
    renderPpcLate();
    renderPpcDrawer();
}

function renderPpcSources() {
    const node = $('#ppc-sources-note');
    if (!node) return;
    const ppc = state.ppc;
    let tone = 'muted';
    let text;
    if (ppc.status === 'loading') text = 'Loading PPC data…';
    else if (ppc.status === 'off') { text = ppc.errors.join(' · '); tone = 'sample'; }
    else if (ppc.status === 'empty') { text = ppc.errors.join(' · ') || 'No saved PPC data yet. Press Refresh to fetch it.'; tone = 'sample'; }
    else if (ppc.status === 'error') { text = `Could not load the PPC data: ${ppc.errors.join(' · ')}`; tone = 'error'; }
    else {
        const clients = new Set(ppc.data.accounts.map((account) => account.client)).size;
        text = `PPC: ${plural(ppc.data.accounts.length, 'account')} from ${plural(clients, 'client')}${ppc.fetchedAt ? `, saved ${relativeTime(new Date(ppc.fetchedAt).getTime())}` : ''}.`;
        if (ppc.warnings.length) { text += ` ${ppc.warnings.join(' · ')}`; tone = 'sample'; }
    }
    node.dataset.tone = tone;
    node.textContent = text;
}

function ppcMessage(text, tone = '') {
    return `<div class="table-empty ${tone}">${escapeHtml(text)}</div>`;
}

function ppcChip(kind, value, label, count, color, active) {
    return `<button type="button" class="ppc-chip${active ? ' is-active' : ''}" data-ppc-filter="${kind}" data-value="${escapeHtml(value)}"><i style="background:${color}"></i><span>${escapeHtml(label)}</span><b>${number(count)}</b></button>`;
}

function renderPpcOverview() {
    const host = $('#ppc-overview');
    if (!host) return;
    const ppc = state.ppc;
    if (ppc.status !== 'ready') {
        destroyPpcCharts();
        const text = ppc.status === 'loading' ? 'Loading PPC data…' : ppc.status === 'error' ? `Could not load the PPC data. ${ppc.errors.join(' · ')}` : ppc.errors.join(' · ') || 'No saved PPC data yet. Press Refresh to fetch it.';
        host.innerHTML = `<article class="panel">${ppcMessage(text)}</article>`;
        return;
    }
    const ui = state.ppcUi;
    const all = ppcAccounts();
    const rows = ppcFiltered(all);
    const channels = [...new Set(all.map((account) => account.channel).filter(Boolean))];
    const statusCount = (status) => rows.filter((account) => account.status === status).length;
    const noData = ppcSortRows(rows.filter(ppcIsNoData));
    const regionGroups = PPC_REGIONS.map((name) => ({ name, rows: ppcSortRows(rows.filter((account) => !ppcIsNoData(account) && ppcRegion(account.region) === name)) })).filter((group) => group.rows.length);
    const month = all.map((account) => account.month).filter(Boolean).sort().pop();
    const updated = ppc.updatedAt ? new Date(ppc.updatedAt) : null;
    const stale = updated && Date.now() - updated.getTime() > 24 * 3600 * 1000;
    const filtering = ui.status.length || ui.channel.length;

    const kpis = PPC_STATUSES.slice(0, 3).map((status) => `
        <button type="button" class="stat-card ${PPC_KPI_CLASS[status]} ppc-kpi${ui.status.includes(status) ? ' is-selected' : ''}" data-ppc-filter="status" data-value="${status}">
            <span class="stat-label">${status}</span>
            <strong>${number(statusCount(status))}</strong>
            <p class="stat-note">Accounts in the current selection</p>
        </button>`).join('');
    const uniqueClients = new Set(rows.map((account) => account.client)).size;

    host.innerHTML = `
        <p class="stat-scope" id="ppc-period-note">${month ? escapeHtml(monthLabel(monthFromKey(month))) : DASH}${updated ? ` · data updated ${escapeHtml(ppcDateTimeText(updated))}${stale ? ' · may be outdated (last sync over 24h ago)' : ''}` : ''}</p>
        <article class="panel ppc-filters">
            <div class="ppc-filter-group"><span class="stat-label">Status</span><div class="ppc-chips">${PPC_STATUSES.map((status, index) => ppcChip('status', status, status, all.filter((account) => account.status === status).length, PPC_STATUS_COLORS[index], ui.status.includes(status))).join('')}</div></div>
            <div class="ppc-filter-group"><span class="stat-label">Channel</span><div class="ppc-chips">${channels.map((channel) => ppcChip('channel', channel, channel, all.filter((account) => account.channel === channel).length, ppcChannelColor(channel), ui.channel.includes(channel))).join('')}</div></div>
            <button type="button" class="link-button ppc-clear" data-ppc-action="clear-filters"${filtering ? '' : ' hidden'}>Clear filters</button>
        </article>
        <div class="scorecard-grid">
            ${kpis}
            <article class="stat-card is-warning"><span class="stat-label">Unique clients</span><strong>${number(uniqueClients)}</strong><p class="stat-note">In the current selection</p></article>
        </div>
        <div class="scorecard-grid is-three ppc-donuts">
            ${ppcDonutPanel('status', 'Goal status')}
            ${ppcDonutPanel('channel', 'Channel')}
            ${ppcDonutPanel('region', 'Region')}
        </div>
        <article class="panel table-panel">
            <div class="panel-header"><div><p class="eyebrow">Operational detail</p><h3>Accounts by region</h3></div><span class="panel-meta">${plural(rows.length, 'record')} displayed</span></div>
            <div class="table-scroll">
                <table class="entries-table ppc-table">
                    <thead><tr><th>Client / channel</th><th>Goal status</th><th class="align-right">Budget</th><th class="align-right">Investment</th><th class="align-right">Goal</th><th class="align-right">Generated</th><th class="align-right">Gap</th><th class="align-right">CPL</th><th class="align-right">Converted</th><th class="align-right">CPA</th><th class="align-right">Campaigns</th></tr></thead>
                    <tbody>${regionGroups.map((group) => ppcGroupRows(ppcRegionLabel(group.name), PPC_REGION_BADGES[group.name], group.rows, ppcAccountRow)).join('')}${noData.length ? ppcGroupRows(PPC_NO_DATA, 'ND', noData, ppcNoDataRow) : ''}</tbody>
                </table>
                ${rows.length ? '' : ppcMessage(filtering ? 'No accounts match these filters.' : 'No accounts available.')}
            </div>
        </article>`;
    renderPpcCharts(rows, channels, regionGroups);
}

function ppcDonutPanel(key, title) {
    return `<article class="panel ppc-donut-panel"><h3>${title}</h3><div class="chart-wrap"><canvas id="ppc-chart-${key}" aria-label="${title}"></canvas></div><div class="ppc-legend" id="ppc-legend-${key}"></div></article>`;
}

function destroyPpcCharts() {
    Object.values(state.ppcUi.charts).forEach((chart) => chart && chart.destroy());
    state.ppcUi.charts = {};
}

function renderPpcCharts(rows, channels, regionGroups) {
    destroyPpcCharts();
    const ui = state.ppcUi;
    const sets = {
        status: PPC_STATUSES.map((status, index) => ({ label: status, value: rows.filter((account) => account.status === status).length, color: PPC_STATUS_COLORS[index], filter: 'status', active: ui.status.includes(status) })),
        channel: channels.map((channel) => ({ label: channel, value: rows.filter((account) => account.channel === channel).length, color: ppcChannelColor(channel), filter: 'channel', active: ui.channel.includes(channel) })),
        region: regionGroups.map((group) => ({ label: ppcRegionLabel(group.name), value: rows.filter((account) => ppcRegion(account.region) === group.name).length, color: PPC_REGION_COLORS[group.name], filter: null, active: false })),
    };
    Object.entries(sets).forEach(([key, items]) => {
        const canvas = $(`#ppc-chart-${key}`);
        const legend = $(`#ppc-legend-${key}`);
        if (!canvas || !legend) return;
        legend.innerHTML = items.map((item) => item.filter
            ? `<button type="button" class="ppc-legend-row${item.active ? ' is-active' : ''}" data-ppc-filter="${item.filter}" data-value="${escapeHtml(item.label)}"><i style="background:${item.color}"></i><span>${escapeHtml(item.label)}</span><b>${number(item.value)}</b></button>`
            : `<div class="ppc-legend-row"><i style="background:${item.color}"></i><span>${escapeHtml(item.label)}</span><b>${number(item.value)}</b></div>`).join('');
        if (typeof Chart === 'undefined') return;
        state.ppcUi.charts[key] = new Chart(canvas, {
            type: 'doughnut',
            data: { labels: items.map((item) => item.label), datasets: [{ data: items.map((item) => item.value), backgroundColor: items.map((item) => item.color), borderWidth: 0, spacing: 3 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: '73%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => ` ${context.label}: ${context.raw}` } } } },
        });
    });
}

function ppcGroupRows(name, badge, rows, renderRow) {
    const open = !state.ppcUi.collapsedGroups.includes(name);
    return `<tr class="ppc-group${open ? '' : ' is-collapsed'}" data-ppc-action="toggle-group" data-value="${escapeHtml(name)}" tabindex="0" role="button" aria-expanded="${open}"><td colspan="11"><span class="ppc-badge">${badge}</span><strong>${escapeHtml(name)}</strong><b>${number(rows.length)}</b><i class="ppc-chevron" aria-hidden="true"></i></td></tr>${open ? rows.map(renderRow).join('') : ''}`;
}

function ppcStatusPill(status) {
    return `<span class="status-pill ppc-pill ${PPC_STATUS_CLASS[status]}">${escapeHtml(status)}</span>`;
}

function ppcCampaignsCell(account) {
    if (!account.campaigns) return DASH;
    const active = ppcHas(account.activeCampaigns) ? ` · ${account.activeCampaigns > 0 ? `${number(account.activeCampaigns)} active` : 'none active'}` : '';
    return `${number(account.campaigns)} total${active}`;
}

function ppcAccountRow(account) {
    const cpa = ppcHas(account.spend) && account.leadsConverted > 0 ? account.spend / account.leadsConverted : null;
    const gapClass = !ppcHas(account.gap) ? '' : account.gap > 0 ? 'value-down' : 'value-up';
    return `<tr class="ppc-row" data-ppc-action="open-campaigns" data-id="${escapeHtml(account.id)}" tabindex="0" role="button">
        <td>${escapeHtml(account.client || DASH)}<span class="entry-sub">${escapeHtml(account.channel || DASH)}</span></td>
        <td>${ppcStatusPill(account.status)}</td>
        <td class="align-right mono">${ppcMoney(account.budget, account.currency)}</td>
        <td class="align-right mono">${ppcMoney(account.spend, account.currency)}</td>
        <td class="align-right mono">${ppcCell(account.leadGoal)}</td>
        <td class="align-right mono">${ppcCell(account.leadsGenerated)}</td>
        <td class="align-right mono"><span class="${gapClass}">${ppcCell(account.gap)}</span></td>
        <td class="align-right mono">${ppcMoney(account.cpl, account.currency)}</td>
        <td class="align-right mono">${ppcCell(account.leadsConverted)}</td>
        <td class="align-right mono">${ppcMoney(cpa, account.currency)}</td>
        <td class="align-right mono">${escapeHtml(ppcCampaignsCell(account))}</td>
    </tr>`;
}

function ppcNoDataRow(account) {
    return `<tr class="ppc-row" data-ppc-action="open-campaigns" data-id="${escapeHtml(account.id)}" tabindex="0" role="button">
        <td>${escapeHtml(account.client || DASH)}<span class="entry-sub">${escapeHtml(account.channel || DASH)} · ${escapeHtml(ppcRegionLabel(ppcRegion(account.region)))}</span></td>
        <td>${ppcStatusPill(account.status)}</td>
        <td class="align-right mono">${DASH}</td>
        <td class="align-right mono">${ppcMoney(account.spend, account.currency)}</td>
        ${'<td class="align-right mono">—</td>'.repeat(7)}
    </tr>`;
}

function ppcSection(key, eyebrow, title, summary, body) {
    const collapsed = state.ppcUi.sections[key];
    return `<article class="panel ppc-section${collapsed ? ' is-collapsed' : ''}">
        <div class="panel-header"><button type="button" class="ppc-section-toggle" data-ppc-action="toggle-section" data-value="${key}" aria-expanded="${!collapsed}"><span><span class="eyebrow">${eyebrow}</span><span class="ppc-section-title">${title}</span></span><i class="ppc-chevron" aria-hidden="true"></i></button>${summary}</div>
        <div class="ppc-section-body">${body}</div>
    </article>`;
}

function ppcNpsColor(nps) {
    if (!ppcHas(nps)) return 'var(--muted)';
    return nps >= 50 ? 'var(--green)' : nps >= 0 ? 'var(--yellow)' : 'var(--red-deep)';
}

function ppcNpsLabel(nps) {
    if (!ppcHas(nps)) return DASH;
    return nps >= 50 ? 'Excellent' : nps >= 0 ? 'Neutral' : 'Critical';
}

function ppcScoreColor(avg) {
    if (!ppcHas(avg)) return 'var(--muted)';
    return avg >= 9 ? 'var(--green)' : avg >= 7 ? 'var(--yellow)' : 'var(--red-deep)';
}

function ppcAverage(evaluations) {
    const notes = (evaluations || []).map((item) => Number(item.evaluation)).filter((value) => Number.isFinite(value));
    return notes.length ? notes.reduce((sum, value) => sum + value, 0) / notes.length : null;
}

function ppcNpsMonth(month) {
    if (!month) return DASH;
    const [year, index] = String(month).split('-');
    return `${PPC_NPS_MONTHS[Number(index) - 1] || index} ${year}`;
}

function ppcAggregateYear(history, year) {
    const months = (history || []).filter((item) => String(item.month).startsWith(`${year}-`));
    if (!months.length) return null;
    const totals = months.reduce((acc, item) => ({
        promoters: acc.promoters + (item.promoters ?? 0),
        passives: acc.passives + (item.passives ?? 0),
        detractors: acc.detractors + (item.detractors ?? 0),
        responses: acc.responses + (item.responses ?? 0),
        total_sent: acc.total_sent + (item.total_sent ?? 0),
        total_answered: acc.total_answered + (item.total_answered ?? 0),
    }), { promoters: 0, passives: 0, detractors: 0, responses: 0, total_sent: 0, total_answered: 0 });
    const updated = months.map((item) => item.updated_at).filter(Boolean).sort().pop();
    const base = months[months.length - 1];
    return {
        ...base,
        month: `${year}`,
        nps: totals.responses > 0 ? Math.round(((totals.promoters - totals.detractors) / totals.responses) * 100) : null,
        fill_rate: totals.total_sent > 0 ? (totals.total_answered / totals.total_sent) * 100 : null,
        updated_at: updated || base.updated_at,
        ...totals,
    };
}

function ppcNpsModel() {
    const nps = state.ppcNps;
    const summaryHistory = nps.rows.filter((row) => row.company === '__summary__').sort((a, b) => String(a.month).localeCompare(String(b.month)));
    const historyByCompany = {};
    nps.rows.forEach((row) => {
        if (row.company === '__summary__') return;
        (historyByCompany[row.company] = historyByCompany[row.company] || []).push(row);
    });
    Object.values(historyByCompany).forEach((list) => list.sort((a, b) => String(a.month).localeCompare(String(b.month))));
    const evaluationsByCompany = {};
    nps.responses.forEach((item) => { (evaluationsByCompany[item.company] = evaluationsByCompany[item.company] || []).push(item); });
    Object.values(evaluationsByCompany).forEach((list) => list.sort((a, b) => String(b.date_reply).localeCompare(String(a.date_reply))));
    const months = summaryHistory.map((item) => item.month).filter(Boolean).sort().reverse();
    const years = [...new Set(months.map((month) => month.split('-')[0]))];
    const picked = state.ppcUi.nps.period;
    const period = picked && (picked.type === 'year' ? years.includes(picked.value) : months.includes(picked.value)) ? picked : months[0] ? { type: 'month', value: months[0] } : null;
    return { summaryHistory, historyByCompany, evaluationsByCompany, months, years, period };
}

function renderPpcNps() {
    const host = $('#ppc-nps');
    if (!host) return;
    const nps = state.ppcNps;
    if (nps.status !== 'ready') {
        const text = nps.status === 'loading' || nps.status === 'idle' ? 'Loading NPS data…' : nps.status === 'off' ? nps.error || 'NPS is not connected.' : `Could not load the NPS data. ${nps.error || ''}`;
        host.innerHTML = ppcSection('nps', 'NPS · via WeHelp', 'Client NPS', '', ppcMessage(text));
        return;
    }
    const model = ppcNpsModel();
    const { period } = model;
    const evaluationsFor = (company) => {
        const all = model.evaluationsByCompany[company] || [];
        if (!period) return all;
        return period.type === 'year' ? all.filter((item) => String(item.month).startsWith(`${period.value}-`)) : all.filter((item) => item.month === period.value);
    };
    const rows = Object.values(model.historyByCompany).map((history) => {
        const company = history[0]?.company;
        const dashboardName = history[0]?.dashboard_name;
        if (!period) return { entry: history[history.length - 1], history };
        const entry = period.type === 'year' ? ppcAggregateYear(history, period.value) : history.find((item) => item.month === period.value);
        if (entry) return { entry, history };
        if (period.type === 'month' && history[0]?.month > period.value) return null;
        const activeUntil = history[history.length - 1]?.active_until;
        if (activeUntil && (period.type === 'year' ? `${period.value}-01` : period.value) > activeUntil) return null;
        return { entry: { company, dashboard_name: dashboardName, month: period.value, nps: null, promoters: 0, passives: 0, detractors: 0, responses: 0, total_sent: 0, total_answered: 0, fill_rate: null, updated_at: null }, history };
    }).filter(Boolean).sort((a, b) => (a.entry.nps ?? Infinity) - (b.entry.nps ?? Infinity));
    const summary = period ? (period.type === 'year' ? ppcAggregateYear(model.summaryHistory, period.value) : model.summaryHistory.find((item) => item.month === period.value)) : model.summaryHistory[model.summaryHistory.length - 1] || null;
    const previous = period && period.type === 'month' ? model.summaryHistory[model.summaryHistory.findIndex((item) => item.month === period.value) - 1] : null;
    const delta = summary && previous && ppcHas(summary.nps) && ppcHas(previous.nps) ? summary.nps - previous.nps : null;
    const periodLabel = period ? (period.type === 'year' ? `Year ${period.value}` : ppcNpsMonth(period.value)) : DASH;
    const periodEvaluations = Object.keys(model.evaluationsByCompany).flatMap(evaluationsFor);
    const summaryAverage = ppcAverage(periodEvaluations);
    const summaryResponses = summary?.responses ?? 0;
    const showAverage = summaryResponses > 0 && summaryResponses < PPC_NPS_MIN_RESPONSES && summaryAverage !== null;
    const summaryValue = showAverage ? summaryAverage.toFixed(1) : ppcHas(summary?.nps) ? summary.nps : DASH;
    const summaryColor = showAverage ? ppcScoreColor(summaryAverage) : ppcNpsColor(summary?.nps);
    const lowSample = rows.filter((item) => (item.entry.responses ?? 0) > 0 && (item.entry.responses ?? 0) < PPC_NPS_MIN_RESPONSES).length;
    const noDataCount = rows.filter((item) => !item.entry.responses).length;

    const select = model.months.length ? `<select id="ppc-nps-period" aria-label="NPS period"><optgroup label="Month">${model.months.map((month) => `<option value="month:${month}"${period && period.type === 'month' && period.value === month ? ' selected' : ''}>${escapeHtml(ppcNpsMonth(month))}</option>`).join('')}</optgroup>${model.years.length ? `<optgroup label="Year (cumulative)">${model.years.map((year) => `<option value="year:${year}"${period && period.type === 'year' && period.value === year ? ' selected' : ''}>Year ${year}</option>`).join('')}</optgroup>` : ''}</select>` : '';
    const search = state.ppcUi.nps.search;
    const query = search.trim().toLowerCase();
    const visibleRows = query ? rows.filter((item) => `${item.entry.company || ''} ${item.entry.dashboard_name || ''}`.toLowerCase().includes(query)) : rows;
    const searchBox = `<input type="search" id="ppc-nps-search" class="ppc-nps-search" placeholder="Search client…" aria-label="Filter NPS by client" autocomplete="off" value="${escapeHtml(search)}">`;
    const head = `<div class="ppc-nps-tools">${searchBox}${select}</div>`;
    const summaryBlock = summary ? `
        <div class="ppc-nps-summary">
            <div><span class="stat-label">${showAverage ? 'Average score' : 'Overall NPS'} · ${escapeHtml(periodLabel)}</span>
                <div class="ppc-nps-big"><strong style="color:${summaryColor}">${escapeHtml(summaryValue)}</strong>${showAverage ? '<small>/10</small>' : `<span class="ppc-tag" style="color:${summaryColor}">${ppcNpsLabel(summary.nps)}</span>`}${!showAverage && delta !== null ? ppcTrend(delta) : ''}</div>
                ${showAverage ? `<p class="stat-scope">NPS needs at least ${PPC_NPS_MIN_RESPONSES} responses to be representative. With ${summaryResponses} ${summaryResponses === 1 ? 'response' : 'responses'}, the average score is shown.</p>` : ''}
            </div>
            <div class="ppc-nps-side"><span>${plural(summaryResponses, 'response')} · ${ppcHas(summary.fill_rate) ? `${Math.round(summary.fill_rate)}% fill rate` : DASH}</span>${summary.updated_at ? `<small>Updated ${escapeHtml(ppcDateTimeText(new Date(summary.updated_at)))}</small>` : ''}</div>
            <div class="ppc-nps-pills"><span><b>${number(lowSample)}</b> Low sample</span><span><b>${number(noDataCount)}</b> No data</span></div>
        </div>` : '';
    const table = !rows.length ? ppcMessage('No NPS data available.') : !visibleRows.length ? ppcMessage(`No clients match "${escapeHtml(search.trim())}".`) : `
        <div class="table-scroll">
            <table class="entries-table ppc-nps-table">
                <thead><tr><th>Client</th><th class="align-right">NPS / average</th><th class="align-right">Status</th><th>Fill rate</th></tr></thead>
                <tbody>${visibleRows.map((item) => ppcNpsRow(item, evaluationsFor(item.entry.company), model, periodLabel)).join('')}</tbody>
            </table>
        </div>
        <p class="manual-input-status" data-tone="muted">Excellent: NPS ≥ 50 or average ≥ 9 · Neutral: NPS 0–49 or average 7–8.9 · Critical: NPS &lt; 0 or average &lt; 7.</p>`;
    const hadFocus = document.activeElement && document.activeElement.id === 'ppc-nps-search';
    const caret = hadFocus ? document.activeElement.selectionStart : null;
    host.innerHTML = ppcSection('nps', 'NPS · via WeHelp', 'Client NPS', head, `${summaryBlock}${table}`);
    if (hadFocus) {
        const input = $('#ppc-nps-search');
        if (input) { input.focus(); input.setSelectionRange(caret, caret); }
    }
}

function ppcTrend(delta) {
    if (!delta) return '<span class="delta is-flat">—</span>';
    return `<span class="delta ${delta > 0 ? 'is-up' : 'is-down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}</span>`;
}

function ppcNpsRow(item, evaluations, model, periodLabel) {
    const row = item.entry;
    const expanded = state.ppcUi.nps.expanded === row.company;
    const responses = row.responses ?? 0;
    const average = ppcAverage(evaluations);
    const showAverage = responses > 0 && responses < PPC_NPS_MIN_RESPONSES && average !== null;
    const value = showAverage ? average.toFixed(1) : ppcHas(row.nps) ? row.nps : DASH;
    const color = showAverage ? ppcScoreColor(average) : ppcNpsColor(row.nps);
    const status = !responses ? 'No data' : showAverage ? `Low sample · ${responses} resp.` : ppcNpsLabel(row.nps);
    const fill = Math.min(100, Math.max(0, row.fill_rate ?? 0));
    const link = (evaluations[0] && evaluations[0].wehelp_url) || 'https://app.wehelpsoftware.com/en-US/responses';
    const main = `<tr class="ppc-row${expanded ? ' is-open' : ''}" data-ppc-action="toggle-nps" data-value="${escapeHtml(row.company)}" tabindex="0" role="button" aria-expanded="${expanded}">
        <td style="box-shadow:inset 3px 0 0 ${color}"><i class="ppc-chevron${expanded ? ' is-open' : ''}" aria-hidden="true"></i>${escapeHtml(row.dashboard_name || row.company)}</td>
        <td class="align-right mono"><b style="color:${color}">${escapeHtml(value)}</b>${showAverage ? '<span class="entry-sub">average /10</span>' : ''}</td>
        <td class="align-right"><span class="ppc-tag" style="color:${color}">${escapeHtml(status)}</span></td>
        <td><div class="ppc-fill"><div class="target-track"><span class="target-fill${fill >= 50 ? ' is-complete' : ''}" style="width:${fill}%"></span></div><small>${Math.round(fill)}%</small></div></td>
    </tr>`;
    if (!expanded) return main;
    const cell = (label, content, tone) => `<div><span class="stat-label">${label}</span><strong${tone ? ` style="color:${tone}"` : ''}>${content}</strong></div>`;
    const history = ppcNpsHistory(item.history, model.evaluationsByCompany[row.company] || []);
    const ratings = evaluations.length ? evaluations.map((entry) => `<div class="ppc-rating"><b style="color:${ppcScoreColor(Number(entry.evaluation))}">${escapeHtml(entry.evaluation)}</b><div>${entry.comment ? `<p>“${escapeHtml(entry.comment)}”</p>` : '<p class="is-muted">No comment</p>'}<small>${entry.date_reply ? escapeHtml(ppcDateText(new Date(entry.date_reply))) : DASH}</small></div></div>`).join('') : '<p class="stat-scope">No ratings submitted in this period.</p>';
    return `${main}<tr class="ppc-detail"><td colspan="4">
        ${responses ? '' : '<p class="stat-scope">No NPS responses in this period for this client.</p>'}
        <div class="ppc-facts">${cell('Promoters', row.promoters ?? DASH, 'var(--green)')}${cell('Passives', row.passives ?? DASH, 'var(--yellow)')}${cell('Detractors', row.detractors ?? DASH, 'var(--red-deep)')}${cell('Responses', responses)}${cell('Average score', average !== null ? `${average.toFixed(1)}/10` : DASH, ppcScoreColor(average))}${cell('Last updated', row.updated_at ? escapeHtml(ppcDateTimeText(new Date(row.updated_at))) : DASH)}</div>
        <a class="ppc-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open in WeHelp</a>
        ${showAverage ? `<p class="stat-scope">With ${responses} ${responses === 1 ? 'response' : 'responses'}, the NPS (${escapeHtml(row.nps)}) is not representative, so the average score is shown.</p>` : ''}
        ${history}
        <span class="stat-label ppc-subhead">Ratings · ${escapeHtml(periodLabel)}</span>${ratings}
    </td></tr>`;
}

function ppcNpsHistory(history, allEvaluations) {
    if (!history || !history.length) return '';
    if (history.length === 1) return `<span class="stat-label ppc-subhead">Monthly history</span><p class="stat-scope">Only ${escapeHtml(history[0].month)} has data so far.</p>`;
    const body = history.slice().reverse().map((entry, index, list) => {
        const before = list[index + 1];
        const delta = ppcHas(entry.nps) && before && ppcHas(before.nps) ? entry.nps - before.nps : null;
        const average = ppcAverage(allEvaluations.filter((item) => item.month === entry.month));
        const enough = (entry.responses ?? 0) >= PPC_NPS_MIN_RESPONSES;
        return `<tr><td>${escapeHtml(entry.month)}</td><td class="align-right mono"><b style="color:${enough ? ppcNpsColor(entry.nps) : 'var(--muted)'}">${enough && ppcHas(entry.nps) ? entry.nps : DASH}</b></td><td class="align-right mono"><b style="color:${ppcScoreColor(average)}">${average !== null ? average.toFixed(1) : DASH}</b></td><td class="align-right">${enough ? ppcTrend(delta) : DASH}</td><td class="align-right mono">${entry.responses ?? DASH}</td><td class="align-right mono">${ppcHas(entry.fill_rate) ? `${Math.round(entry.fill_rate)}%` : DASH}</td></tr>`;
    }).join('');
    return `<span class="stat-label ppc-subhead">Monthly history</span><div class="table-scroll"><table class="entries-table ppc-history"><thead><tr><th>Month</th><th class="align-right">NPS</th><th class="align-right">Average</th><th class="align-right">Change</th><th class="align-right">Responses</th><th class="align-right">Fill rate</th></tr></thead><tbody>${body}</tbody></table></div><p class="stat-scope">NPS is only shown from ${PPC_NPS_MIN_RESPONSES} responses per month. Below that, use the average score.</p>`;
}

function ppcHmRank(status) {
    const index = PPC_HM_ORDER.indexOf(status || '');
    return index < 0 ? PPC_HM_ORDER.length : index;
}

function ppcHmCompare(a, b) {
    return ppcHmRank(a.status) - ppcHmRank(b.status) || (b.behindWeeks || 0) - (a.behindWeeks || 0) || (a.weeksCompleted || 0) - (b.weeksCompleted || 0);
}

function ppcHmContract(item) {
    const start = ppcDay(item.startDate);
    if (!start) return '';
    if (typeof item.daysSinceStart === 'number' && item.daysSinceStart <= 28) return `Started ${ppcDateText(start)}, day ${Math.max(item.daysSinceStart, 0)} of 28`;
    const end = ppcDay(item.endDate);
    return end ? `Started ${ppcDateText(start)}, window ended ${ppcDateText(end)}` : `Started ${ppcDateText(start)}`;
}

function ppcHmDue(value) {
    const date = ppcDay(value);
    return date ? { text: ppcDateText(date), past: date.getTime() + 86400000 <= Date.now() } : null;
}

function ppcHmWeekTone(status) {
    return status === 'complete' ? 'is-done' : status === 'in progress' ? 'is-progress' : 'is-idle';
}

function ppcHmKey(item) {
    return `${item.client}|${item.region}`;
}

function ppcHmRow(item) {
    const ui = state.ppcUi.hm;
    const active = PPC_HM_ACTIVE.includes(item.status);
    const expanded = ui.expanded === ppcHmKey(item);
    const due = active ? ppcHmDue(item.nextDueDate) : null;
    const behind = active ? item.behindWeeks || 0 : 0;
    const contract = active ? ppcHmContract(item) : '';
    const weeks = [item.wk1, item.wk2, item.wk3, item.wk4];
    const badge = PPC_REGION_BADGES[ppcRegion(item.region)];
    const main = `<tr class="ppc-row${expanded ? ' is-open' : ''}" data-ppc-action="toggle-hm" data-value="${escapeHtml(ppcHmKey(item))}" tabindex="0" role="button" aria-expanded="${expanded}">
        <td><i class="ppc-chevron${expanded ? ' is-open' : ''}" aria-hidden="true"></i>${escapeHtml(item.client)} <span class="ppc-badge">${badge}</span>${contract ? `<span class="entry-sub">${escapeHtml(contract)}</span>` : ''}</td>
        <td><div class="ppc-weeks" title="${item.weeksCompleted || 0} of 4 weeks">${weeks.map((week, index) => `<i class="${ppcHmWeekTone(week)}" title="${escapeHtml(`${PPC_HM_WEEKS[index]}: ${week || 'missing'}`)}"></i>`).join('')}</div><span class="entry-sub">${item.weeksTotal === 0 ? 'No weekly tasks' : `${item.weeksCompleted || 0}/4 weeks`}</span></td>
        <td><span class="status-pill ppc-pill ${PPC_HM_TONE[item.status] || 'is-idle'}">${escapeHtml(item.status || 'N/A')}</span>${behind > 0 ? `<span class="entry-sub value-down">Behind ${behind} wk</span>` : ''}</td>
        <td>${item.signoffDone ? '<span class="value-up">Signoff done</span>' : '<span class="ppc-muted">Signoff pending</span>'}</td>
        <td class="align-right mono${due && due.past ? ' value-down' : ''}">${due ? escapeHtml(due.text) : DASH}</td>
    </tr>`;
    if (!expanded) return main;
    const start = ppcDay(item.startDate);
    const end = ppcDay(item.endDate);
    const facts = [
        ['Signoff', item.signoffDone ? 'Done' : 'Pending'],
        start ? ['Start date', ppcDateText(start)] : null,
        end ? ['Honeymoon end', ppcDateText(end)] : null,
        typeof item.daysSinceStart === 'number' ? ['Days since start', item.daysSinceStart] : null,
        behind > 0 ? ['Behind', `${behind} wk`] : null,
        due ? ['Next due', due.text] : null,
    ].filter(Boolean);
    return `${main}<tr class="ppc-detail"><td colspan="5">
        <ul class="ppc-hm-weeks">${weeks.map((week, index) => `<li class="${ppcHmWeekTone(week)}">${escapeHtml(PPC_HM_WEEKS[index])}: ${escapeHtml(week || 'not started')}</li>`).join('')}</ul>
        <div class="ppc-facts">${facts.map(([label, value]) => `<div><span class="stat-label">${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
        ${item.projectListId ? `<a class="ppc-link" href="https://app.clickup.com/${PPC_CLICKUP_TEAM}/v/li/${encodeURIComponent(item.projectListId)}" target="_blank" rel="noopener noreferrer">Open in ClickUp</a>` : ''}
    </td></tr>`;
}

function ppcHmTable(list) {
    return `<div class="table-scroll"><table class="entries-table ppc-hm-table"><thead><tr><th>Client</th><th>Progress</th><th>Status</th><th>Signoff</th><th class="align-right">Due</th></tr></thead><tbody>${list.map(ppcHmRow).join('')}</tbody></table></div>`;
}

function renderPpcHoneymoon() {
    const host = $('#ppc-honeymoon');
    if (!host) return;
    const ppc = state.ppc;
    if (ppc.status !== 'ready') {
        host.innerHTML = ppcSection('hm', 'Onboarding', 'Honeymoon progress', '', ppcMessage(ppc.status === 'loading' ? 'Loading Honeymoon data…' : 'No Honeymoon data available.'));
        return;
    }
    const ui = state.ppcUi.hm;
    const items = ppc.data.honeymoon;
    const count = (status) => items.filter((item) => item.status === status).length;
    const filtered = items.filter((item) => (ui.status === null || item.status === ui.status) && (ui.week === null || ((item.weeksTotal || 0) > 0 && item[`wk${ui.week}`] !== 'complete')));
    const active = filtered.filter((item) => PPC_HM_ACTIVE.includes(item.status)).sort(ppcHmCompare);
    const legacy = filtered.filter((item) => !PPC_HM_ACTIVE.includes(item.status)).sort(ppcHmCompare);
    const filtering = ui.status !== null || ui.week !== null;
    const summary = `<div class="ppc-hm-summary">${['Completed', 'In Progress', 'Overdue', 'Not Started'].map((status) => `<button type="button" class="ppc-chip${ui.status === status ? ' is-active' : ''}" data-ppc-action="hm-status" data-value="${status}"><span>${status}</span><b>${number(count(status))}</b></button>`).join('')}</div>`;
    if (!items.length) {
        host.innerHTML = ppcSection('hm', 'Onboarding', 'Honeymoon progress', '', ppcMessage('No Honeymoon data available.'));
        return;
    }
    const considered = items.filter((item) => (item.weeksTotal || 0) > 0);
    const done = [1, 2, 3, 4].map((week) => considered.filter((item) => item[`wk${week}`] === 'complete').length);
    const chart = considered.length ? `<div class="ppc-hm-bars">${done.map((value, index) => {
        const percent = Math.round((value / considered.length) * 100);
        return `<button type="button" class="ppc-bar-row${ui.week === index + 1 ? ' is-active' : ''}" data-ppc-action="hm-week" data-value="${index + 1}"><span class="ppc-bar-label">${escapeHtml(PPC_HM_WEEKS[index])}</span><span class="target-track"><span class="target-fill${percent === 100 ? ' is-complete' : ''}" style="width:${percent}%"></span></span><span class="ppc-bar-value">${value} of ${considered.length} · ${percent}%</span></button>`;
    }).join('')}</div>${ui.week !== null ? `<p class="stat-scope">Showing clients pending ${escapeHtml(PPC_HM_WEEKS[ui.week - 1])} (${filtered.length}) <button type="button" class="link-button" data-ppc-action="hm-clear">Clear</button></p>` : ''}` : '';
    const body = `${chart}
        ${filtering ? '<p class="stat-scope"><button type="button" class="link-button" data-ppc-action="hm-clear-all">Clear filters</button></p>' : ''}
        ${filtered.length === 0 ? ppcMessage(filtering ? 'No clients match these filters.' : 'No active honeymoons.') : `
            ${active.length ? ppcHmTable(active) : filtering ? '' : ppcMessage('No active honeymoons.')}
            ${legacy.length ? `<button type="button" class="seo-toggle" data-ppc-action="hm-legacy">${ui.legacyOpen ? 'Hide' : 'Show'} completed and legacy (${legacy.length})</button>${ui.legacyOpen ? ppcHmTable(legacy) : ''}` : ''}`}`;
    host.innerHTML = ppcSection('hm', 'Onboarding', 'Honeymoon progress', summary, body);
}

function ppcOwnerName(names) {
    const first = (name) => name.split(' ')[0];
    const counts = new Map();
    names.forEach((name) => counts.set(first(name), (counts.get(first(name)) || 0) + 1));
    return Object.fromEntries(names.map((name) => {
        const parts = name.split(' ');
        return [name, (counts.get(first(name)) || 0) > 1 && parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]];
    }));
}

function renderPpcLate() {
    const host = $('#ppc-late');
    if (!host) return;
    const ppc = state.ppc;
    if (ppc.status !== 'ready') {
        host.innerHTML = ppcSection('late', 'Tasks', 'Late tasks', '', ppcMessage(ppc.status === 'loading' ? 'Loading task data…' : 'No task data available.'));
        return;
    }
    const items = ppc.data.lateTasks;
    const sum = (pick) => items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
    const total = sum((item) => item.total);
    const unassigned = sum((item) => item.unassigned);
    const over30 = sum((item) => item.late30plus);
    const average = total > 0 ? sum((item) => (item.avgDelayDays || 0) * (item.total || 0)) / total : 0;
    const cards = [
        { label: 'Late tasks', value: number(total), note: '', tone: 'is-negative' },
        { label: 'Without an owner', value: number(unassigned), note: `${total > 0 ? Math.round((unassigned / total) * 100) : 0}% of total`, tone: 'is-warning' },
        { label: 'Average delay', value: `${average.toFixed(1)} days`, note: '', tone: 'is-neutral' },
        { label: 'Over 30 days', value: number(over30), note: '', tone: 'is-negative' },
    ];
    const ownerTotals = new Map();
    let noOwner = 0;
    items.forEach((item) => Object.entries(item.owners || {}).forEach(([raw, count]) => {
        const name = String(raw).replace(/\s+/g, ' ').trim();
        if (!name) return;
        if (name.toLowerCase() === 'unassigned') noOwner += count; else ownerTotals.set(name, (ownerTotals.get(name) || 0) + count);
    }));
    const ranked = [...ownerTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const top = ranked.slice(0, 8);
    const rest = ranked.slice(8);
    const shown = ppcOwnerName(top.map(([name]) => name));
    const ownerRows = top.map(([name, count]) => ({ label: shown[name], count, color: 'var(--blue)' }));
    if (rest.length) ownerRows.push({ label: `Others (${rest.length})`, count: rest.reduce((acc, [, count]) => acc + count, 0), color: 'var(--blue)' });
    if (noOwner > 0) ownerRows.push({ label: 'Unassigned', count: noOwner, color: 'var(--muted)' });
    const ownerMax = Math.max(1, ...ownerRows.map((row) => row.count));
    const clients = items.filter((item) => item.total > 0).sort((a, b) => b.total - a.total);
    const clientMax = Math.max(1, ...clients.map((item) => item.total));
    const owners = ownerRows.length ? `<div class="ppc-bars">${ownerRows.map((row) => `<div class="ppc-bar-row"><span class="ppc-bar-label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span><span class="ppc-track"><i style="width:${(row.count / ownerMax) * 100}%;background:${row.color}"></i></span><span class="ppc-bar-value">${number(row.count)}</span></div>`).join('')}</div>` : '<p class="stat-scope">No late tasks.</p>';
    const byClient = clients.length ? `<div class="ppc-legend-inline">${PPC_LATE_BANDS.map((band) => `<span><i style="background:${band.color}"></i>${band.label}</span>`).join('')}</div><div class="ppc-bars">${clients.map((item) => `<div class="ppc-bar-row"><span class="ppc-bar-label" title="${escapeHtml(item.client)}">${escapeHtml(item.client)}</span><span class="ppc-track"><span class="ppc-stack" style="width:${(item.total / clientMax) * 100}%">${PPC_LATE_BANDS.map((band) => item[band.key] > 0 ? `<i style="flex-grow:${item[band.key]};background:${band.color}" title="${band.label}: ${number(item[band.key])}"></i>` : '').join('')}</span></span><span class="ppc-bar-value"${item.truncated ? ' title="Showing the first 100 late tasks; this client has more."' : ''}>${item.truncated ? '100+' : number(item.total)}</span></div>`).join('')}</div>` : '<p class="stat-scope">No late tasks.</p>';
    const summary = state.ppcUi.sections.late ? `<span class="panel-meta">${plural(total, 'late task')}, ${number(unassigned)} without an owner</span>` : '';
    host.innerHTML = ppcSection('late', 'Tasks', 'Late tasks', summary, `
        <div class="scorecard-grid">${cards.map((card) => `<article class="stat-card ${card.tone}"><span class="stat-label">${card.label}</span><strong>${card.value}</strong><p class="stat-note">${card.note || '&nbsp;'}</p></article>`).join('')}</div>
        <div class="split-grid"><article class="panel ppc-subpanel"><h3>Late tasks by owner</h3>${owners}</article><article class="panel ppc-subpanel"><h3>Late tasks by client and delay</h3>${byClient}</article></div>`);
}

async function openPpcCampaigns(id) {
    const account = ppcAccounts().find((item) => item.id === id);
    if (!account) return;
    const drawer = state.ppcUi.drawer;
    drawer.row = account;
    drawer.status = account.externalId ? 'loading' : 'error';
    drawer.items = [];
    drawer.message = account.externalId ? '' : 'The data has no identifier for this account, so campaigns cannot be loaded.';
    const modal = $('#ppc-campaigns-modal');
    renderPpcDrawer();
    if (modal && !modal.open) modal.showModal();
    if (!account.externalId) return;
    try {
        const response = redirectIfSignedOut(await fetch(`${PPC_CAMPAIGNS_ENDPOINT}?parent_id=${encodeURIComponent(account.externalId)}`, { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
        if (!response.ok || body.error) throw new Error(body.error || `The server answered HTTP ${response.status}.`);
        if (drawer.row !== account) return;
        drawer.status = 'ready';
        drawer.items = body.items || [];
    } catch (error) {
        if (drawer.row !== account) return;
        drawer.status = 'error';
        drawer.message = error.message;
    }
    renderPpcDrawer();
}

function renderPpcDrawer() {
    const host = $('#ppc-campaigns-body');
    const drawer = state.ppcUi.drawer;
    if (!host || !drawer.row) return;
    const account = drawer.row;
    setText('#ppc-campaigns-title', account.client || DASH);
    setText('#ppc-campaigns-sub', `${account.channel || DASH} · ${account.month ? account.month.replace('-', ' / ') : DASH} · ${account.status}`);
    const items = [...drawer.items].sort((a, b) => (b.spend || 0) - (a.spend || 0));
    const tone = (status) => { const key = String(status || '').trim().toUpperCase(); return key === 'ENABLED' ? 'is-on' : key === 'PAUSED' ? 'is-muted' : 'is-warn'; };
    if (drawer.status === 'loading') host.innerHTML = ppcMessage('Loading campaigns…');
    else if (drawer.status === 'error') host.innerHTML = ppcMessage(`Could not load campaigns. ${drawer.message}`);
    else if (!items.length) host.innerHTML = ppcMessage('No campaigns found.');
    else {
        const currency = items[0].currency || account.currency;
        host.innerHTML = `<div class="table-scroll"><table class="entries-table"><thead><tr><th>Campaign</th><th>Status</th><th class="align-right">Investment</th><th class="align-right">Clicks</th><th class="align-right">Impressions</th><th class="align-right">CTR</th><th class="align-right">CPC</th></tr></thead><tbody>${items.map((item) => `<tr>
            <td>${escapeHtml(item.name || DASH)}</td>
            <td><span class="status-pill ppc-pill ${tone(item.status)}">${escapeHtml(item.status || DASH)}</span></td>
            <td class="align-right mono">${ppcMoney(item.spend, item.currency)}</td>
            <td class="align-right mono">${ppcCell(item.clicks)}</td>
            <td class="align-right mono">${ppcCell(item.impressions)}</td>
            <td class="align-right mono">${ppcHas(item.ctr) ? `${ppcNum(item.ctr)}%` : DASH}</td>
            <td class="align-right mono">${ppcMoney(item.cpc, item.currency)}</td>
        </tr>`).join('')}</tbody></table></div>
        <p class="modal-footnote">${plural(items.length, 'campaign')} · total investment ${ppcMoney(items.reduce((sum, item) => sum + (item.spend || 0), 0), currency)}</p>`;
    }
}

function togglePpcFilter(kind, value) {
    const list = state.ppcUi[kind];
    state.ppcUi[kind] = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
    renderPpc();
}

function handlePpcAction(target) {
    const ui = state.ppcUi;
    const action = target.dataset.ppcAction;
    const value = target.dataset.value;
    if (action === 'clear-filters') { ui.status = []; ui.channel = []; }
    else if (action === 'toggle-group') ui.collapsedGroups = ui.collapsedGroups.includes(value) ? ui.collapsedGroups.filter((item) => item !== value) : [...ui.collapsedGroups, value];
    else if (action === 'open-campaigns') { openPpcCampaigns(target.dataset.id); return; }
    else if (action === 'toggle-section') { ui.sections[value] = !ui.sections[value]; ppcStore(value, ui.sections[value]); }
    else if (action === 'toggle-nps') ui.nps.expanded = ui.nps.expanded === value ? null : value;
    else if (action === 'toggle-hm') ui.hm.expanded = ui.hm.expanded === value ? null : value;
    else if (action === 'hm-status') { ui.hm.status = ui.hm.status === value ? null : value; if (ui.hm.status === 'Completed') ui.hm.legacyOpen = true; }
    else if (action === 'hm-week') ui.hm.week = ui.hm.week === Number(value) ? null : Number(value);
    else if (action === 'hm-clear') ui.hm.week = null;
    else if (action === 'hm-clear-all') { ui.hm.status = null; ui.hm.week = null; }
    else if (action === 'hm-legacy') ui.hm.legacyOpen = !ui.hm.legacyOpen;
    else return;
    renderPpc();
}

const ppcView = $('#ppc-view');
if (ppcView) {
    ppcView.addEventListener('click', (event) => {
        const filter = event.target.closest('[data-ppc-filter]');
        if (filter) { togglePpcFilter(filter.dataset.ppcFilter, filter.dataset.value); return; }
        const action = event.target.closest('[data-ppc-action]');
        if (action && !event.target.closest('a')) handlePpcAction(action);
    });
    ppcView.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const action = event.target.closest('tr[data-ppc-action]');
        if (!action) return;
        event.preventDefault();
        handlePpcAction(action);
    });
    ppcView.addEventListener('input', (event) => {
        if (event.target.id !== 'ppc-nps-search') return;
        state.ppcUi.nps.search = event.target.value;
        state.ppcUi.nps.expanded = null;
        renderPpc();
    });
    ppcView.addEventListener('change', (event) => {
        if (event.target.id !== 'ppc-nps-period') return;
        const [type, value] = event.target.value.split(':');
        state.ppcUi.nps.period = { type, value };
        state.ppcUi.nps.expanded = null;
        renderPpc();
    });
}

const ppcModal = $('#ppc-campaigns-modal');
if (ppcModal) {
    ppcModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => ppcModal.close()));
    ppcModal.addEventListener('click', (event) => { if (event.target === ppcModal) ppcModal.close(); });
    ppcModal.addEventListener('close', () => { state.ppcUi.drawer = { row: null, status: 'idle', items: [], message: '' }; });
}