const AH_ENDPOINT = 'account-map.php';
const AH_SERVICES = [
    { key: 'seo', label: 'SEO', color: '#1f4e79' },
    { key: 'ppc', label: 'PPC', color: '#d98324' },
    { key: 'seo_ppc', label: 'SEO + PPC', color: '#6b4c9a' },
    { key: 'smm', label: 'SMM', color: '#4a4f55' },
];
const AH_PRIORITIES = ['Cancelling', 'Escalation', 'Honeymoon', 'Post-honeymoon', 'Standard'];
const AH_RETENTION_MONTHS = 6;
const AH_EDITOR_RECENT_DAYS = 120;
const AH_CHURN_ROWS = 8;
const AH_ACTIVE_MIN_MRR = 0.5;
const AH_NPS_TARGET = 8;
const AH_FILL_TARGET = 0.9;
const AH_NPS_WINDOW = 3;
const AH_NPS_CHART_MONTHS = 6;
const AH_ESCALATE_BELOW = 8;
const AH_NO_MANAGER = 'No manager';
const AH_LATE_TARGET = 0.05;
const AH_LATE_OWNER_ROWS = 10;
const AH_LATE_ENDPOINT = 'late-tasks.php';
const AH_ATTENTION_ENDPOINT = 'attention-data.php';
const AH_BIWEEKLY_MAX_DAYS = 14;
const AH_RESULTS_MAX_DAYS = 30;
const AH_LOGIN_MAX_DAYS = 14;
const AH_ATTENTION_ROWS = 10;
const AH_GROWTH_ENDPOINT = 'growth-log.php';
const AH_GROWTH_KINDS = { referral: 'Referral', upsell: 'Upsell', crosssell: 'Cross-sell' };
const AH_GROWTH_STATUSES = { open: 'Open', won: 'Won', lost: 'Lost' };
const AH_LEADERBOARD_ROWS = 10;
const AH_OPEN_ROWS = 10;
const AH_PRIORITY_WEIGHT = { Cancelling: 3, Escalation: 2, Honeymoon: 1, 'Post-honeymoon': 1 };
const AH_KIND_LABELS = { lost: 'Contract ended', serviceChange: 'Service change', downgrade: 'Downgrade' };
const AH_CAN_EDIT = document.body.dataset.accountMap === 'on';
const AH_USER = { role: document.body.dataset.userRole || '', name: document.body.dataset.userName || '' };

state.accountMap = { status: 'loading', rows: [], error: null };
state.lateTasks = { status: 'loading', lists: [], errors: [], warnings: [], fetchedAt: null };
state.attention = { status: 'loading', meetings: { status: 'loading', rows: [], errors: [] }, logins: { status: 'loading', rows: [], errors: [] }, showAll: false };
state.growth = { status: 'loading', entries: [], error: null, showAllOpen: false };
state.accountHealth = { am: 'all', service: 'all', priority: 'all', amTouched: false, chart: null, npsChart: null };

const ahFold = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function ahRequest(options = {}) {
    const response = redirectIfSignedOut(await fetch(AH_ENDPOINT, { cache: 'no-store', ...options }));
    const body = await response.json().catch(() => null);
    if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
    if (!response.ok) throw new Error(body.error || `The server answered HTTP ${response.status}.`);
    return body;
}

async function loadAccountMap() {
    state.accountMap = { ...state.accountMap, status: 'loading' };
    try {
        const body = await ahRequest();
        state.accountMap = { status: body.ready === false ? 'off' : 'ready', rows: body.accounts || [], error: body.error || null };
    } catch (error) {
        state.accountMap = { status: 'error', rows: [], error: error.message };
    }
    ahApplyDefaultManager();
    renderAccountHealth();
}

async function loadLateTasks() {
    state.lateTasks = { ...state.lateTasks, status: 'loading' };
    try {
        const response = redirectIfSignedOut(await fetch(AH_LATE_ENDPOINT, { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
        if (body.configured === false) {
            state.lateTasks = { status: 'off', lists: [], errors: body.errors || [], warnings: [], fetchedAt: null };
        } else if (!response.ok) {
            throw new Error((body.errors || []).join(' · ') || `The server answered HTTP ${response.status}.`);
        } else {
            state.lateTasks = { status: (body.lists || []).length ? 'ready' : 'empty', lists: body.lists || [], errors: body.errors || [], warnings: body.warnings || [], fetchedAt: body.fetchedAt || null };
        }
    } catch (error) {
        state.lateTasks = { status: 'error', lists: [], errors: [error.message], warnings: [], fetchedAt: null };
    }
    renderAccountHealth();
}

async function growthRequest(options = {}) {
    const response = redirectIfSignedOut(await fetch(AH_GROWTH_ENDPOINT, { cache: 'no-store', ...options }));
    const body = await response.json().catch(() => null);
    if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
    if (!response.ok) throw new Error(body.error || `The server answered HTTP ${response.status}.`);
    return body;
}

async function loadGrowthLog() {
    state.growth = { ...state.growth, status: 'loading' };
    try {
        const body = await growthRequest();
        state.growth = { ...state.growth, status: body.ready === false ? 'off' : 'ready', entries: body.entries || [], error: body.error || null };
    } catch (error) {
        state.growth = { ...state.growth, status: 'error', entries: [], error: error.message };
    }
    renderAccountHealth();
}

async function loadAttention() {
    state.attention = { ...state.attention, status: 'loading' };
    const section = (body, key) => {
        const part = body && body[key];
        if (!part) return { status: 'error', rows: [], errors: ['Unexpected answer from the server.'], fetchedAt: null };
        if (part.configured === false) return { status: 'off', rows: [], errors: part.errors || [], fetchedAt: null };
        return { status: (part.rows || []).length ? 'ready' : 'empty', rows: part.rows || [], errors: part.errors || [], warnings: part.warnings || [], fetchedAt: part.fetchedAt || null };
    };
    try {
        const response = redirectIfSignedOut(await fetch(AH_ATTENTION_ENDPOINT, { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
        state.attention = { ...state.attention, status: 'ready', meetings: section(body, 'meetings'), logins: section(body, 'logins') };
    } catch (error) {
        const failed = { status: 'error', rows: [], errors: [error.message], fetchedAt: null };
        state.attention = { ...state.attention, status: 'error', meetings: failed, logins: failed };
    }
    renderAccountHealth();
}

function ahManagers() {
    return [...new Set(state.accountMap.rows.map((row) => row.am).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function ahPriorities() {
    const used = state.accountMap.rows.map((row) => row.priority).filter(Boolean);
    return [...new Set([...AH_PRIORITIES, ...used])];
}

function ahApplyDefaultManager() {
    const health = state.accountHealth;
    if (health.amTouched || AH_USER.role !== 'account_manager') return;
    const first = ahFold(AH_USER.name).split(' ')[0];
    if (!first) return;
    const match = ahManagers().find((name) => ahFold(name).split(' ')[0] === first);
    if (match) health.am = match;
}

function ahAllowedKeys() {
    const { am, service, priority } = state.accountHealth;
    if (am === 'all' && service === 'all' && priority === 'all') return null;
    return new Set(state.accountMap.rows
        .filter((row) => (am === 'all' || row.am === am) && (service === 'all' || row.service === service) && (priority === 'all' || row.priority === priority))
        .map((row) => row.clientKey));
}

const ahMean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

function ahNameMatcher() {
    const compact = (value) => normalizeClientName(value).replace(/ /g, '');
    const keys = state.accountMap.rows.map((row) => ({ row, compact: compact(row.clientName) }));
    return (name) => {
        const target = compact(name);
        if (!target) return null;
        const exact = keys.find((item) => item.compact === target);
        if (exact) return exact.row;
        if (target.length < 4) return null;
        const loose = keys.filter((item) => item.compact.length >= 4 && (item.compact.includes(target) || target.includes(item.compact)));
        return loose.length === 1 ? loose[0].row : null;
    };
}

function ahNpsModel(lastStart, allowed) {
    const clients = state.clients;
    if (clients.status === 'loading') return { status: 'loading' };
    if (clients.status !== 'ready' || !clients.data.aggregates) return { status: 'off' };
    const match = ahNameMatcher();
    const chartKeys = monthKeysBetween(new Date(lastStart.getFullYear(), lastStart.getMonth() - (AH_NPS_CHART_MONTHS - 1), 1), lastStart);
    const windowKeys = new Set(chartKeys.slice(-AH_NPS_WINDOW));
    const answersBy = new Map();
    clients.data.nps.forEach((answer) => {
        if (!hasValue(answer.score) || !answer.at) return;
        const key = `${answer.companyId}|${answer.at.slice(0, 7)}`;
        const list = answersBy.get(key) || [];
        list.push(answer);
        answersBy.set(key, list);
    });
    const unmatched = new Set();
    const accounts = new Map();
    clients.data.aggregates.forEach((agg) => {
        const month = String(agg.month);
        if (!chartKeys.includes(month)) return;
        const name = agg.dashboard_name || agg.company;
        const row = match(name);
        const answers = answersBy.get(`${agg.company}|${month}`) || [];
        const sent = Number(agg.total_sent) || 0;
        if (!row && windowKeys.has(month) && (sent > 0 || answers.length)) unmatched.add(name);
        if (allowed && (!row || !allowed.has(row.clientKey))) return;
        const account = accounts.get(agg.company) || { name, am: row ? row.am : AH_NO_MANAGER, months: new Map() };
        account.months.set(month, { sent, answered: Number(agg.total_answered) || 0, answers });
        accounts.set(agg.company, account);
    });
    const monthScores = new Map(chartKeys.map((key) => [key, []]));
    const managers = new Map();
    const cells = [];
    const escalate = [];
    const latestScores = [];
    let sent = 0;
    let answered = 0;
    accounts.forEach((account) => {
        const manager = managers.get(account.am) || { name: account.am, cells: [], sent: 0, answered: 0 };
        managers.set(account.am, manager);
        let latest = null;
        account.months.forEach((info, month) => {
            info.answers.forEach((answer) => monthScores.get(month).push(Number(answer.score)));
            if (!windowKeys.has(month)) return;
            info.answers.forEach((answer) => { if (!latest || String(answer.at) > String(latest.at)) latest = answer; });
            if (info.sent <= 0 && !info.answers.length) return;
            const score = info.answers.length ? ahMean(info.answers.map((answer) => Number(answer.score))) : 0;
            cells.push(score);
            manager.cells.push(score);
            manager.sent += info.sent;
            manager.answered += info.answered;
            sent += info.sent;
            answered += info.answered;
        });
        if (latest) latestScores.push({ name: account.name, score: Number(latest.score), at: String(latest.at) });
        if (latest && Number(latest.score) < AH_ESCALATE_BELOW) escalate.push({ name: account.name, am: account.am, score: Number(latest.score), at: latest.at, comment: latest.comment });
    });
    const monthName = new Intl.DateTimeFormat('en-US', { month: 'short' });
    return {
        status: 'ready',
        avg: ahMean(cells),
        fill: sent > 0 ? answered / sent : null,
        sent,
        answered,
        accounts: accounts.size,
        labels: chartKeys.map((key) => monthName.format(monthFromKey(key))),
        series: chartKeys.map((key) => ahMean(monthScores.get(key))),
        managers: [...managers.values()].filter((item) => item.cells.length || item.sent).map((item) => ({ name: item.name, avg: ahMean(item.cells), fill: item.sent > 0 ? item.answered / item.sent : null, sent: item.sent, answered: item.answered })).sort((a, b) => (a.name === AH_NO_MANAGER) - (b.name === AH_NO_MANAGER) || a.name.localeCompare(b.name)),
        latest: latestScores,
        escalate: escalate.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)),
        unmatched: [...unmatched].sort((a, b) => a.localeCompare(b)),
    };
}

function ahLateModel(allowed) {
    const late = state.lateTasks;
    if (late.status === 'loading') return { status: 'loading' };
    if (late.status !== 'ready') return { status: late.status, errors: late.errors };
    const match = ahNameMatcher();
    const unmatched = [];
    const owners = new Map();
    const managers = new Map();
    const services = new Set();
    let due = 0;
    let lateCount = 0;
    let truncated = 0;
    late.lists.forEach((item) => {
        services.add(item.service);
        const row = match(item.client);
        if (!row) unmatched.push(item.client);
        if (allowed && (!row || !allowed.has(row.clientKey))) return;
        due += item.dueTotal;
        lateCount += item.lateTotal;
        if (item.truncated) truncated += 1;
        const am = row ? row.am : AH_NO_MANAGER;
        const manager = managers.get(am) || { name: am, due: 0, late: 0, accounts: 0 };
        manager.due += item.dueTotal;
        manager.late += item.lateTotal;
        manager.accounts += 1;
        managers.set(am, manager);
        Object.entries(item.owners || {}).forEach(([name, counts]) => {
            const owner = owners.get(name) || { name, due: 0, late: 0 };
            owner.due += counts.due;
            owner.late += counts.late;
            owners.set(name, owner);
        });
    });
    const withRate = (item) => ({ ...item, rate: share(item.late, item.due) });
    return {
        status: 'ready',
        due,
        late: lateCount,
        rate: share(lateCount, due),
        truncated,
        services: [...services],
        managers: [...managers.values()].map(withRate).sort((a, b) => (a.name === AH_NO_MANAGER) - (b.name === AH_NO_MANAGER) || a.name.localeCompare(b.name)),
        owners: [...owners.values()].filter((item) => item.due > 0).map(withRate).sort((a, b) => b.late - a.late || b.due - a.due || a.name.localeCompare(b.name)),
        unmatched: [...new Set(unmatched)].sort((a, b) => a.localeCompare(b)),
    };
}

function ahDaysSince(text) {
    if (!text) return null;
    const [year, month, day] = String(text).slice(0, 10).split('-').map(Number);
    if (!year || !month || !day) return null;
    const now = new Date();
    return Math.max(0, Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(year, month - 1, day)) / 86400000));
}

const ahLatestDate = (current, next) => (next && (!current || next > current) ? next : current);

function ahAttentionModel(active, nps, allowed) {
    const attention = state.attention;
    const meetingsOn = attention.meetings.status === 'ready';
    const loginsOn = attention.logins.status === 'ready';
    const lateOn = state.lateTasks.status === 'ready';
    const npsOn = Boolean(nps) && nps.status === 'ready';
    const compact = (value) => normalizeClientName(value).replace(/ /g, '');
    const universe = active.map((item) => ({
        ...item,
        compact: compact(item.name),
        meetingLists: 0,
        biweekly: null,
        results: null,
        campaigns: 0,
        clientUsers: 0,
        pendingUsers: 0,
        lastLogin: null,
        lateFound: false,
        due: 0,
        late: 0,
        npsAt: '',
        npsScore: null,
    }));
    const find = (name) => {
        const target = compact(name);
        if (!target) return null;
        const exact = universe.find((item) => item.compact === target);
        if (exact) return exact;
        if (target.length < 4) return null;
        const loose = universe.filter((item) => item.compact.length >= 4 && (item.compact.includes(target) || target.includes(item.compact)));
        return loose.length === 1 ? loose[0] : null;
    };
    const unmatched = { meetings: new Set(), logins: new Set() };
    if (meetingsOn) {
        attention.meetings.rows.forEach((row) => {
            const item = find(row.client);
            if (!item) { unmatched.meetings.add(row.client); return; }
            item.meetingLists += 1;
            item.biweekly = ahLatestDate(item.biweekly, row.lastBiweekly);
            item.results = ahLatestDate(item.results, row.lastResults);
        });
    }
    if (loginsOn) {
        attention.logins.rows.forEach((row) => {
            if (row.status && row.status !== 'active') return;
            const item = find(row.client);
            if (!item) { unmatched.logins.add(row.client); return; }
            item.campaigns += 1;
            item.clientUsers += row.clientUsers;
            item.pendingUsers += row.pendingUsers;
            item.lastLogin = ahLatestDate(item.lastLogin, row.lastLogin);
        });
    }
    if (lateOn) {
        state.lateTasks.lists.forEach((row) => {
            const item = find(row.client);
            if (!item) return;
            item.lateFound = true;
            item.due += row.dueTotal;
            item.late += row.lateTotal;
        });
    }
    if (npsOn) {
        nps.latest.forEach((entry) => {
            const item = find(entry.name);
            if (item && entry.at > item.npsAt) { item.npsAt = entry.at; item.npsScore = entry.score; }
        });
    }
    const rows = universe.filter((item) => !allowed || allowed.has(item.key)).map((item) => {
        const priority = item.row ? item.row.priority : '';
        const weight = AH_PRIORITY_WEIGHT[priority] || 0;
        const biweeklyDays = meetingsOn && item.meetingLists ? (item.biweekly ? ahDaysSince(item.biweekly) : -1) : null;
        const resultsDays = meetingsOn && item.meetingLists ? (item.results ? ahDaysSince(item.results) : -1) : null;
        const hasUsers = loginsOn && item.campaigns > 0 && item.clientUsers > 0;
        const loginDays = hasUsers ? (item.lastLogin ? ahDaysSince(item.lastLogin) : -1) : null;
        const lateRate = lateOn && item.lateFound ? share(item.late, item.due) : null;
        const flags = [];
        if (biweeklyDays !== null && (biweeklyDays < 0 || biweeklyDays > AH_BIWEEKLY_MAX_DAYS)) flags.push('biweekly');
        if (resultsDays !== null && (resultsDays < 0 || resultsDays > AH_RESULTS_MAX_DAYS)) flags.push('results');
        if (loginDays !== null && (loginDays < 0 || loginDays > AH_LOGIN_MAX_DAYS)) flags.push('login');
        if (hasValue(lateRate) && lateRate > AH_LATE_TARGET) flags.push('late');
        if (item.npsScore !== null && item.npsScore < AH_ESCALATE_BELOW) flags.push('nps');
        return {
            key: item.key,
            name: item.name,
            am: item.row ? item.row.am : AH_NO_MANAGER,
            priority,
            nextAction: item.row ? item.row.nextAction : '',
            mrr: item.mrr,
            lateRate,
            npsScore: item.npsScore,
            biweeklyDays,
            resultsDays,
            loginDays,
            noUsers: loginsOn && item.campaigns > 0 && item.clientUsers === 0,
            pendingOnly: hasUsers && !item.lastLogin,
            flags,
            score: flags.length + weight,
            weight,
        };
    });
    const flagged = rows.filter((item) => item.flags.length || item.weight >= 2)
        .sort((a, b) => b.score - a.score || b.mrr - a.mrr || a.name.localeCompare(b.name));
    return {
        rows: flagged,
        checked: rows.length,
        sources: { meetings: meetingsOn, logins: loginsOn, late: lateOn, nps: npsOn },
        unmatchedMeetings: [...unmatched.meetings].sort((a, b) => a.localeCompare(b)),
        unmatchedLogins: [...unmatched.logins].sort((a, b) => a.localeCompare(b)),
    };
}

function ahGrowthModel(month) {
    const sales = state.sales;
    const salesData = sales && sales.status === 'ready' ? sales.data : null;
    const log = state.growth.status === 'ready' ? state.growth.entries : [];
    const owners = new Map();
    if (salesData) {
        salesData.deals.forEach((deal) => {
            if (deal.owner && !owners.has(deal.owner)) owners.set(deal.owner, salesData.nameOf(deal.owner));
        });
    }
    const named = [...owners.entries()].map(([id, name]) => ({ id, name, fold: ahFold(name), first: ahFold(name).split(' ')[0] }));
    const people = new Map();
    const person = (name) => {
        const fold = ahFold(name);
        const first = fold.split(' ')[0];
        const exact = named.find((item) => item.fold === fold);
        const firsts = named.filter((item) => item.first === first);
        const hit = exact || (firsts.length === 1 ? firsts[0] : null);
        const key = hit ? `hs:${hit.id}` : `log:${fold}`;
        if (!people.has(key)) people.set(key, { key, name: hit ? hit.name : name, first: hit ? hit.first : first, referrals: 0, open: 0, pipeline: 0, wonDeals: 0, newMrr: 0, upsellMrr: 0 });
        return people.get(key);
    };
    if (salesData) {
        salesData.deals.forEach((deal) => {
            if (!deal.owner) return;
            const entry = person(salesData.nameOf(deal.owner));
            if (deal.outcome === 'open') {
                entry.pipeline += Number(deal.valueUsd) || 0;
            } else if (deal.outcome === 'won' && deal.closedAt && deal.closedAt.slice(0, 7) === month) {
                entry.wonDeals += 1;
                if (deal.type === 'existingbusiness') entry.upsellMrr += Number(deal.mrrUsd) || 0;
                else entry.newMrr += Number(deal.mrrUsd) || 0;
            }
        });
    }
    const openList = [];
    log.forEach((item) => {
        const entry = person(item.person);
        if (item.status === 'open') {
            entry.open += 1;
            openList.push(item);
        } else if (item.status === 'won' && item.loggedOn.slice(0, 7) === month) {
            const value = Number(item.mrr) || 0;
            if (item.kind === 'referral') {
                entry.referrals += 1;
                entry.newMrr += value;
            } else {
                entry.upsellMrr += value;
            }
        }
    });
    const am = state.accountHealth.am;
    const amFirst = am === 'all' ? null : ahFold(am).split(' ')[0];
    const keep = (item) => !amFirst || item.first === amFirst;
    const rows = [...people.values()].filter((item) => keep(item) && (item.pipeline || item.open || item.wonDeals || item.referrals || item.newMrr || item.upsellMrr))
        .sort((a, b) => (b.newMrr + b.upsellMrr) - (a.newMrr + a.upsellMrr) || b.referrals - a.referrals || b.pipeline - a.pipeline || a.name.localeCompare(b.name));
    const open = openList.filter((item) => !amFirst || ahFold(item.person).split(' ')[0] === amFirst)
        .sort((a, b) => (Number(b.mrr) || 0) - (Number(a.mrr) || 0) || b.loggedOn.localeCompare(a.loggedOn));
    return { rows, open, salesOn: Boolean(salesData), logOn: state.growth.status === 'ready', people: [...new Set([...named.map((item) => item.name), ...log.map((item) => item.person)])].sort((a, b) => a.localeCompare(b)) };
}

function ahModel() {
    const saved = { scope: state.scope, category: state.category };
    state.scope = 'all';
    state.category = 'all';
    try {
        const invoices = scopedInvoices();
        const windows = scorecardWindows(invoices);
        if (!windows) return null;
        const allowed = ahAllowedKeys();
        const subset = allowed ? invoices.filter((invoice) => allowed.has(normalizeClientName(invoice.Contact?.Name))) : invoices;
        const ctx = metricContext(subset);

        const end = windows.current.end;
        const lastStart = new Date(end.getFullYear(), end.getMonth(), 1);
        const lastWindow = { start: lastStart, end: endOfMonth(lastStart), label: monthLabel(lastStart) };
        const seriesWindow = { start: new Date(end.getFullYear(), end.getMonth() - (AH_RETENTION_MONTHS - 1), 1), end: lastWindow.end, label: lastWindow.label };

        const last = retentionOverWindow(ctx, lastWindow);
        const series = retentionOverWindow(ctx, seriesWindow);
        const months = monthKeysBetween(seriesWindow.start, seriesWindow.end).map((key) => ({ key, label: monthLabel(monthFromKey(key)) }));
        const rates = months.map((item) => series.monthly.find((row) => row.key === item.key)?.rate ?? null);

        const mrrByClient = new Map();
        const nameByKey = new Map();
        subset.forEach((invoice) => {
            if (!inWindow(invoiceDate(invoice), lastWindow)) return;
            const key = normalizeClientName(invoice.Contact?.Name);
            if (!key) return;
            mrrByClient.set(key, (mrrByClient.get(key) || 0) + mrrAmount(invoice));
            if (!nameByKey.has(key)) nameByKey.set(key, String(invoice.Contact?.Name || key));
        });
        const everyMrr = new Map();
        invoices.forEach((invoice) => {
            if (!inWindow(invoiceDate(invoice), lastWindow)) return;
            const key = normalizeClientName(invoice.Contact?.Name);
            if (!key) return;
            everyMrr.set(key, (everyMrr.get(key) || 0) + mrrAmount(invoice));
            if (!nameByKey.has(key)) nameByKey.set(key, String(invoice.Contact?.Name || key));
        });

        const index = new Map(state.accountMap.rows.map((row) => [row.clientKey, row]));
        const nps = ahNpsModel(lastStart, allowed);
        const activeClients = [];
        everyMrr.forEach((value, key) => {
            if (value > AH_ACTIVE_MIN_MRR) activeClients.push({ key, name: nameByKey.get(key) || key, mrr: value, row: index.get(key) || null });
        });
        const services = new Map(AH_SERVICES.map((service) => [service.key, { ...service, count: 0, mrr: 0 }]));
        const managers = new Map();
        let total = 0;
        let active = 0;
        let mapped = 0;
        mrrByClient.forEach((value, key) => {
            if (value <= AH_ACTIVE_MIN_MRR) return;
            total += value;
            active += 1;
            const row = index.get(key);
            if (!row) return;
            mapped += 1;
            const service = services.get(row.service);
            if (service) { service.count += 1; service.mrr += value; }
            const manager = managers.get(row.am) || { name: row.am, count: 0, mrr: 0 };
            manager.count += 1;
            manager.mrr += value;
            managers.set(row.am, manager);
        });

        return {
            monthLabel: lastWindow.label,
            total,
            active,
            mapped,
            unmapped: active - mapped,
            services: [...services.values()],
            managers: [...managers.values()].sort((a, b) => b.mrr - a.mrr || a.name.localeCompare(b.name)),
            last,
            labels: months.map((item) => item.label),
            rates,
            target: MANUAL_INPUTS.retentionTarget,
            index,
            nps,
            late: ahLateModel(allowed),
            attention: ahAttentionModel(activeClients, nps, allowed),
            growth: ahGrowthModel(monthKey(lastStart)),
        };
    } finally {
        state.scope = saved.scope;
        state.category = saved.category;
    }
}

function ahCard(tone, label, value, note) {
    return `<article class="stat-card ${tone}"><span class="stat-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><p class="stat-note">${note || '&nbsp;'}</p></article>`;
}

function ahOptions(select, items, current, allLabel) {
    select.innerHTML = [`<option value="all">${escapeHtml(allLabel)}</option>`, ...items.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)].join('');
    select.value = items.some((item) => item.value === current) ? current : 'all';
}

function renderAhFilters() {
    const health = state.accountHealth;
    ahOptions($('#ah-am'), ahManagers().map((name) => ({ value: name, label: name })), health.am, 'All account managers');
    ahOptions($('#ah-service'), AH_SERVICES.map((item) => ({ value: item.key, label: item.label })), health.service, 'All services');
    ahOptions($('#ah-priority'), ahPriorities().map((name) => ({ value: name, label: name })), health.priority, 'All priorities');
    health.am = $('#ah-am').value;
    health.service = $('#ah-service').value;
    health.priority = $('#ah-priority').value;
}

function renderAhStatus(model) {
    const node = $('#ah-status');
    const map = state.accountMap;
    let tone = 'muted';
    let text;
    if (map.status === 'loading') text = 'Loading the account map…';
    else if (map.status === 'off' || map.status === 'error') { text = map.error || 'The account map could not be loaded.'; tone = 'error'; }
    else if (!model) text = 'Loading invoices…';
    else if (!map.rows.length) { text = 'No account manager is assigned yet. Fill in the account map to split the portfolio by manager.'; tone = 'sample'; }
    else if (model.unmapped > 0 && !ahAllowedKeys()) { text = `${plural(model.mapped, 'account')} of ${number(model.active)} active ${model.active === 1 ? 'has' : 'have'} an account manager.`; tone = 'sample'; }
    else text = `${plural(model.active, 'active account')} in ${model.monthLabel}.`;
    node.dataset.tone = tone;
    node.textContent = text;
}

function renderAhCards(model) {
    const host = $('#ah-kpis');
    if (!model) {
        host.innerHTML = [
            ahCard('is-neutral', 'Portfolio value (MRR)', DASH, 'Loading invoices…'),
            ahCard('is-neutral', 'Retention (MoM)', DASH, 'Loading invoices…'),
            ahCard('is-neutral', 'Upsell / cross-sell won', DASH, 'Loading invoices…'),
            ahCard('is-neutral', 'Late tasks', DASH, 'Not connected yet'),
            ahCard('is-neutral', 'NPS · 3-month avg', DASH, 'Loading invoices…'),
            ahCard('is-neutral', 'NPS fill rate · 3 months', DASH, 'Loading invoices…'),
        ].join('');
        return;
    }
    const last = model.last;
    const rate = hasValue(last.rate) ? last.rate : null;
    const retentionTone = !hasValue(rate) ? 'is-neutral' : rate >= model.target ? 'is-positive' : 'is-negative';
    const parts = [];
    if (last.taggedUpsell > 0) parts.push(`${money(last.taggedUpsell)} tagged in Xero`);
    if (last.crossSells > 0) parts.push(`${plural(last.crossSells, 'new service line')} on existing clients`);
    const upsell = hasValue(last.initial) ? last.expansion : null;
    host.innerHTML = [
        ahCard('is-neutral', 'Portfolio value (MRR)', money(model.total), `${plural(model.active, 'active account')} · ${escapeHtml(model.monthLabel)}`),
        ahCard(retentionTone, 'Retention (MoM)', percentOr(rate), hasValue(rate)
            ? `Target ≥ ${percentOr(model.target, 0)} · ${plural(last.lostClients, 'client')} lost in ${escapeHtml(last.endLabel)}`
            : 'Needs billing in the previous month'),
        ahCard('is-positive', 'Upsell / cross-sell won', hasValue(upsell) ? money(upsell) : DASH, parts.length ? escapeHtml(parts.join(' · ')) : `Existing clients · ${escapeHtml(model.monthLabel)}`),
        ahLateCard(model.late),
        ...ahNpsCards(model.nps),
    ].join('');
}

function ahLateCard(late) {
    if (late.status !== 'ready') {
        const note = late.status === 'loading' ? 'Loading ClickUp…' : late.status === 'empty' ? 'No late-task data yet' : 'ClickUp late tasks are not connected';
        return ahCard('is-neutral', 'Late tasks', DASH, note);
    }
    const tone = !hasValue(late.rate) ? 'is-neutral' : late.rate <= AH_LATE_TARGET ? 'is-positive' : late.rate <= AH_LATE_TARGET * 2 ? 'is-warning' : 'is-negative';
    const note = hasValue(late.rate)
        ? `${number(late.late)} of ${number(late.due)} due in 30 days · target ≤ ${percentOr(AH_LATE_TARGET, 0)}`
        : 'No tasks due in the last 30 days';
    return ahCard(tone, 'Late tasks', percentOr(late.rate, 1), note);
}

function ahNpsCards(nps) {
    if (nps.status !== 'ready') {
        const note = nps.status === 'loading' ? 'Loading WeHelp…' : 'WeHelp is not connected';
        return [ahCard('is-neutral', 'NPS · 3-month avg', DASH, note), ahCard('is-neutral', 'NPS fill rate · 3 months', DASH, note)];
    }
    const avgTone = !hasValue(nps.avg) ? 'is-neutral' : nps.avg >= AH_NPS_TARGET ? 'is-positive' : nps.avg >= 6 ? 'is-warning' : 'is-negative';
    const fillTone = !hasValue(nps.fill) ? 'is-neutral' : nps.fill >= AH_FILL_TARGET ? 'is-positive' : nps.fill >= 0.7 ? 'is-warning' : 'is-negative';
    return [
        ahCard(avgTone, 'NPS · 3-month avg', hasValue(nps.avg) ? nps.avg.toFixed(1) : DASH, `Target ≥ ${AH_NPS_TARGET} · unanswered surveys count as 0`),
        ahCard(fillTone, 'NPS fill rate · 3 months', percentOr(nps.fill, 0), hasValue(nps.fill) ? `${number(nps.answered)} of ${number(nps.sent)} surveys answered · target ≥ ${percentOr(AH_FILL_TARGET, 0)}` : 'No surveys sent in the period'),
    ];
}

function renderAhPortfolio(model) {
    const host = $('#ah-portfolio');
    if (!model) { host.innerHTML = '<p class="empty-line">Loading invoices…</p>'; return; }
    if (state.accountMap.status !== 'ready' || !state.accountMap.rows.length) {
        host.innerHTML = `<p class="empty-line">${state.accountMap.status === 'loading' ? 'Loading the account map…' : 'Assign clients to an account manager and a service to see the split.'}</p>`;
        return;
    }
    const max = Math.max(1, ...model.services.map((item) => item.count));
    const bars = model.services.map((item) => `
        <div class="ppc-bar-row ah-bar-row">
            <span class="ppc-bar-label">${escapeHtml(item.label)}</span>
            <span class="ppc-track"><i style="width:${(item.count / max) * 100}%;background:${item.color}"></i></span>
            <span class="ah-bar-value">${plural(item.count, 'account')} · ${money(item.mrr)}</span>
        </div>`).join('');
    const people = model.managers.slice(0, 4).map((item) => `
        <div class="ah-person"><span>${escapeHtml(item.name)}</span><strong>${number(item.count)} ${item.count === 1 ? 'account' : 'accounts'} · ${money(item.mrr)}</strong></div>`).join('');
    host.innerHTML = `<div class="ppc-bars">${bars}</div>${people ? `<div class="ah-people">${people}</div>` : ''}
        <p class="stat-scope">Bars show the number of active accounts. Value is the MRR billed in ${escapeHtml(model.monthLabel)}.${model.unmapped > 0 && !ahAllowedKeys() ? ` ${plural(model.unmapped, 'active account')} without a manager are not counted here.` : ''}</p>`;
}

function renderAhRetention(model) {
    const health = state.accountHealth;
    if (health.chart) { health.chart.destroy(); health.chart = null; }
    const empty = $('#ah-retention-empty');
    const hasData = Boolean(model) && model.rates.some(hasValue);
    empty.classList.toggle('is-hidden', hasData);
    empty.textContent = model ? 'No retention data in these months' : 'Loading invoices…';
    setText('#ah-retention-meta', model ? `Revenue retained · target line ${percentOr(model.target, 0)}` : 'Revenue retained');
    if (!hasData) return;
    const low = Math.min(...model.rates.filter(hasValue), model.target);
    const floor = Math.max(0, Math.floor((low - 0.02) * 50) / 50);
    const options = summaryChartOptions();
    options.scales.y.min = floor;
    options.scales.y.max = 1;
    options.scales.y.ticks.callback = (value) => `${Math.round(value * 100)}%`;
    options.plugins.tooltip.callbacks.label = (item) => `${item.dataset.label}: ${percentOr(item.parsed.y)}`;
    health.chart = new Chart($('#ah-retention-chart'), {
        type: 'line',
        data: {
            labels: model.labels,
            datasets: [
                { label: 'Retention', data: model.rates, borderColor: '#55778a', borderWidth: 2, spanGaps: false, pointRadius: 4, pointHoverRadius: 5, pointBackgroundColor: model.rates.map((rate) => (hasValue(rate) && rate < model.target ? '#b82d1c' : '#55778a')), pointBorderColor: model.rates.map((rate) => (hasValue(rate) && rate < model.target ? '#b82d1c' : '#55778a')), fill: false },
                { label: 'Target', data: model.rates.map(() => model.target), borderColor: '#e84d2c', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false },
            ],
        },
        options,
    });
}

function renderAhChurn(model) {
    const body = $('#ah-churn-table');
    const empty = $('#ah-churn-empty');
    if (!model) { body.innerHTML = ''; empty.textContent = 'Loading invoices…'; empty.classList.remove('is-hidden'); setText('#ah-churn-title', 'Churn log'); setText('#ah-churn-count', ''); return; }
    const events = [...(model.last.churnedClients || [])].sort((a, b) => b.churned - a.churned);
    const shown = events.slice(0, AH_CHURN_ROWS);
    setText('#ah-churn-title', `Churn log · ${model.monthLabel}`);
    setText('#ah-churn-count', events.length > shown.length ? `Top ${shown.length} of ${events.length}` : plural(events.length, 'event'));
    body.innerHTML = shown.map((item) => {
        const row = model.index.get(normalizeClientName(item.name));
        const kind = AH_KIND_LABELS[item.kind] || 'Downgrade';
        const tip = item.kind === 'serviceChange' ? ` title="${escapeHtml(serviceChangeTip(item))}"` : '';
        return `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td${tip}>${escapeHtml(kind)}</td><td>${row ? escapeHtml(row.am) : DASH}</td><td class="align-right mono"><span class="value-down">${signedMoney(-item.churned)}</span></td></tr>`;
    }).join('');
    empty.classList.toggle('is-hidden', shown.length > 0);
    empty.textContent = hasValue(model.last.initial) ? 'No client was lost or downgraded in this month.' : 'Needs billing in the previous month to compare.';
}

function renderAhNps(model) {
    const health = state.accountHealth;
    if (health.npsChart) { health.npsChart.destroy(); health.npsChart = null; }
    const nps = model ? model.nps : { status: 'loading' };
    const ready = nps.status === 'ready';
    const empty = $('#ah-nps-empty');
    const hasSeries = ready && nps.series.some(hasValue);
    empty.classList.toggle('is-hidden', hasSeries);
    empty.textContent = ready ? 'No NPS answers in these months' : nps.status === 'off' ? 'WeHelp is not connected' : 'Loading WeHelp…';
    setText('#ah-nps-meta', `Monthly avg of answers · target ${AH_NPS_TARGET.toFixed(1)}`);
    if (hasSeries) {
        const options = summaryChartOptions();
        options.scales.y.min = 0;
        options.scales.y.max = 10;
        options.scales.y.ticks.stepSize = 2;
        options.scales.y.ticks.callback = (value) => String(value);
        options.plugins.tooltip.callbacks.label = (item) => `${item.dataset.label}: ${Number(item.parsed.y).toFixed(1)}`;
        health.npsChart = new Chart($('#ah-nps-chart'), {
            type: 'line',
            data: {
                labels: nps.labels,
                datasets: [
                    { label: 'Average score', data: nps.series, borderColor: '#55778a', borderWidth: 2, spanGaps: false, pointRadius: 4, pointHoverRadius: 5, pointBackgroundColor: nps.series.map((value) => (hasValue(value) && value < AH_NPS_TARGET ? '#b82d1c' : '#55778a')), pointBorderColor: nps.series.map((value) => (hasValue(value) && value < AH_NPS_TARGET ? '#b82d1c' : '#55778a')), fill: false },
                    { label: 'Target', data: nps.series.map(() => AH_NPS_TARGET), borderColor: '#e84d2c', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false },
                ],
            },
            options,
        });
    }

    const managers = $('#ah-nps-managers');
    const managersEmpty = $('#ah-nps-managers-empty');
    const rows = ready ? nps.managers : [];
    managers.innerHTML = rows.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td class="align-right mono">${hasValue(item.avg) ? item.avg.toFixed(1) : DASH}</td><td class="align-right mono">${percentOr(item.fill, 0)}</td><td class="align-right mono">${number(item.answered)} of ${number(item.sent)}</td></tr>`).join('');
    managersEmpty.classList.toggle('is-hidden', rows.length > 0);
    managersEmpty.textContent = ready ? 'No surveys in the last 3 months.' : 'Waiting for WeHelp.';

    const escalate = ready ? nps.escalate : [];
    setText('#ah-escalate-count', ready ? plural(escalate.length, 'account') : '');
    $('#ah-escalate-table').innerHTML = escalate.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.am)}</td><td class="align-right mono"><span class="value-down">${number(item.score)}</span></td><td>${escapeHtml(item.at || DASH)}</td></tr>`).join('');
    const escalateEmpty = $('#ah-escalate-empty');
    escalateEmpty.classList.toggle('is-hidden', escalate.length > 0);
    escalateEmpty.textContent = ready ? `No account's latest answer is below ${AH_ESCALATE_BELOW}.` : 'Waiting for WeHelp.';

    const note = $('#ah-nps-note');
    const missing = ready ? nps.unmatched : [];
    note.hidden = !missing.length;
    note.textContent = missing.length ? `${plural(missing.length, 'WeHelp client')} not found in the account map, so ${missing.length === 1 ? 'it is' : 'they are'} left out of the manager filters: ${missing.join(', ')}.` : '';
}

function ahLateRows(items) {
    return items.map((item) => {
        const over = hasValue(item.rate) && item.rate > AH_LATE_TARGET;
        const fill = hasValue(item.rate) ? clampPercent((item.rate / (AH_LATE_TARGET * 2)) * 100) : 0;
        return `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td class="align-right mono">${number(item.late)}</td><td class="align-right mono">${number(item.due)}</td><td class="align-right mono"><span class="${over ? 'value-down' : 'value-up'}">${percentOr(item.rate, 1)}</span></td><td><span class="ah-meter"><i class="${over ? 'is-over' : 'is-ok'}" style="width:${fill}%"></i></span></td></tr>`;
    }).join('');
}

function renderAhLate(model) {
    const late = model ? model.late : { status: 'loading' };
    const ready = late.status === 'ready';
    const empty = ready ? '' : late.status === 'loading' ? 'Loading ClickUp…' : late.status === 'empty' ? 'No late-task data yet. Press Refresh.' : (late.errors && late.errors[0]) || 'ClickUp late tasks are not connected.';
    const managers = ready ? late.managers : [];
    $('#ah-late-managers').innerHTML = ahLateRows(managers);
    const managersEmpty = $('#ah-late-managers-empty');
    managersEmpty.classList.toggle('is-hidden', managers.length > 0);
    managersEmpty.textContent = ready ? 'No tasks were due in the last 30 days for this selection.' : empty;
    const owners = ready ? late.owners.slice(0, AH_LATE_OWNER_ROWS) : [];
    $('#ah-late-owners').innerHTML = ahLateRows(owners);
    const ownersEmpty = $('#ah-late-owners-empty');
    ownersEmpty.classList.toggle('is-hidden', owners.length > 0);
    ownersEmpty.textContent = ready ? 'No tasks were due in the last 30 days for this selection.' : empty;
    setText('#ah-late-count', ready && late.owners.length > owners.length ? `Top ${owners.length} of ${late.owners.length}` : ready ? plural(late.owners.length, 'assignee') : '');
    const note = $('#ah-late-note');
    const notes = [];
    if (ready && late.truncated) notes.push(`${plural(late.truncated, 'list')} hit the page limit, so the real numbers may be higher.`);
    if (ready && late.unmatched.length) notes.push(`${plural(late.unmatched.length, 'ClickUp client')} not found in the account map, so ${late.unmatched.length === 1 ? 'it is' : 'they are'} left out of the manager filters: ${late.unmatched.join(', ')}.`);
    note.hidden = !notes.length;
    note.textContent = notes.join(' ');
}

function ahDaysCell(days, limit, missing) {
    if (days === null) return '<span class="ah-dim">—</span>';
    if (days < 0) return `<span class="value-down">${escapeHtml(missing)}</span>`;
    return `<span class="${days > limit ? 'value-down' : ''}">${number(days)}d</span>`;
}

const AH_FLAG_LABELS = { biweekly: 'Biweekly', results: 'Results', login: 'AA login', late: 'Late tasks', nps: 'NPS' };

function renderAhAttention(model) {
    const attention = model ? model.attention : null;
    const body = $('#ah-attention-table');
    const empty = $('#ah-attention-empty');
    const toggle = $('#ah-attention-toggle');
    const rows = attention ? attention.rows : [];
    const shown = state.attention.showAll ? rows : rows.slice(0, AH_ATTENTION_ROWS);
    body.innerHTML = shown.map((item) => {
        const tone = item.weight >= 2 ? 'off' : item.weight === 1 ? 'part' : '';
        const priority = item.priority ? (tone ? ahSourceTag(tone, item.priority) : escapeHtml(item.priority)) : '<span class="ah-dim">—</span>';
        const login = item.noUsers ? '<span class="ah-dim">No client users</span>' : ahDaysCell(item.loginDays, AH_LOGIN_MAX_DAYS, item.pendingOnly ? 'Never logged in' : 'No login');
        const nps = item.npsScore === null ? '<span class="ah-dim">—</span>' : `<span class="${item.npsScore < AH_ESCALATE_BELOW ? 'value-down' : ''}">${number(item.npsScore)}</span>`;
        const late = hasValue(item.lateRate) ? `<span class="${item.lateRate > AH_LATE_TARGET ? 'value-down' : ''}">${percentOr(item.lateRate, 1)}</span>` : '<span class="ah-dim">—</span>';
        const flags = item.flags.length ? item.flags.map((flag) => AH_FLAG_LABELS[flag]).join(' · ') : '<span class="ah-dim">Priority only</span>';
        return `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.am)}</td><td>${priority}</td><td class="align-right mono">${money(item.mrr)}</td><td class="align-right mono">${late}</td><td class="align-right mono">${nps}</td><td class="align-right mono">${ahDaysCell(item.biweeklyDays, AH_BIWEEKLY_MAX_DAYS, 'None in 240d')}</td><td class="align-right mono">${ahDaysCell(item.resultsDays, AH_RESULTS_MAX_DAYS, 'None in 240d')}</td><td class="align-right mono">${login}</td><td>${flags}</td><td>${item.nextAction ? escapeHtml(item.nextAction) : '<span class="ah-dim">—</span>'}</td></tr>`;
    }).join('');
    empty.classList.toggle('is-hidden', shown.length > 0);
    empty.textContent = !attention ? 'Loading…' : attention.checked === 0 ? 'No active clients for this selection.' : 'No account breaks a limit right now.';
    setText('#ah-attention-count', attention && rows.length ? (rows.length > shown.length ? `Top ${shown.length} of ${rows.length}` : plural(rows.length, 'account')) : '');
    toggle.hidden = !attention || rows.length <= AH_ATTENTION_ROWS;
    toggle.textContent = state.attention.showAll ? 'Show the top 10 only' : `Show all ${rows.length} accounts`;
    const note = $('#ah-attention-note');
    const notes = [];
    if (attention) {
        const missing = [['ClickUp meetings', attention.sources.meetings], ['AgencyAnalytics logins', attention.sources.logins], ['Late tasks', attention.sources.late], ['NPS', attention.sources.nps]].filter((item) => !item[1]).map((item) => item[0]);
        if (missing.length) notes.push(`Not counted because the data is missing: ${missing.join(', ')}.`);
        if (attention.unmatchedMeetings.length) notes.push(`ClickUp lists without a matching active client: ${attention.unmatchedMeetings.join(', ')}.`);
        if (attention.unmatchedLogins.length) notes.push(`AgencyAnalytics campaigns without a matching active client: ${attention.unmatchedLogins.join(', ')}.`);
    }
    note.hidden = !notes.length;
    note.textContent = notes.join(' ');
}

function renderAhGrowth(model) {
    const growth = model ? model.growth : null;
    const rows = growth ? growth.rows.slice(0, AH_LEADERBOARD_ROWS) : [];
    $('#ah-growth-table').innerHTML = rows.map((item, index) => `<tr><td class="mono">${index + 1}</td><td><strong>${escapeHtml(item.name)}</strong></td><td class="align-right mono">${number(item.referrals)}</td><td class="align-right mono">${number(item.open)}</td><td class="align-right mono">${item.pipeline ? money(item.pipeline) : DASH}</td><td class="align-right mono">${number(item.wonDeals)}</td><td class="align-right mono">${item.newMrr ? money(item.newMrr) : DASH}</td><td class="align-right mono">${item.upsellMrr ? money(item.upsellMrr) : DASH}</td></tr>`).join('');
    const empty = $('#ah-growth-empty');
    empty.classList.toggle('is-hidden', rows.length > 0);
    empty.textContent = !growth ? 'Loading…' : !growth.salesOn && !growth.logOn ? 'Connect HubSpot and run sql/008_growth_log.sql to fill this table.' : 'Nothing to rank for this month yet.';
    setText('#ah-growth-count', growth && growth.rows.length > rows.length ? `Top ${rows.length} of ${growth.rows.length}` : growth && rows.length ? `${rows.length} ${rows.length === 1 ? 'person' : 'people'}` : '');
    setText('#ah-growth-month', model ? model.monthLabel : '');
    const note = $('#ah-growth-note');
    const notes = [];
    if (growth && !growth.salesOn) notes.push('HubSpot deals are not loaded, so pipeline, won deals and HubSpot MRR are missing.');
    if (growth && state.growth.status === 'off') notes.push(state.growth.error || 'The growth log table does not exist yet.');
    note.hidden = !notes.length;
    note.textContent = notes.join(' ');

    const open = growth ? (state.growth.showAllOpen ? growth.open : growth.open.slice(0, AH_OPEN_ROWS)) : [];
    $('#ah-open-table').innerHTML = open.map((item) => `<tr><td><strong>${escapeHtml(item.clientName)}</strong></td><td>${escapeHtml(item.person)}</td><td>${escapeHtml(AH_GROWTH_KINDS[item.kind] || item.kind)}</td><td class="align-right mono">${item.mrr ? money(item.mrr) : DASH}</td><td>${escapeHtml(item.loggedOn)}</td><td>${item.note ? escapeHtml(item.note) : '<span class="ah-dim">—</span>'}</td>${AH_CAN_EDIT ? `<td class="align-right"><button type="button" class="seo-toggle ah-edit" data-growth-edit="${item.id}">Edit</button></td>` : ''}</tr>`).join('');
    const openEmpty = $('#ah-open-empty');
    openEmpty.classList.toggle('is-hidden', open.length > 0);
    openEmpty.textContent = !growth ? 'Loading…' : state.growth.status === 'off' ? 'The growth log table does not exist yet.' : 'No open opportunities logged.';
    setText('#ah-open-count', growth && growth.open.length ? plural(growth.open.length, 'open opportunity') : '');
    const toggle = $('#ah-open-toggle');
    toggle.hidden = !growth || growth.open.length <= AH_OPEN_ROWS;
    toggle.textContent = state.growth.showAllOpen ? 'Show the top 10 only' : `Show all ${growth ? growth.open.length : 0}`;
}

function ahSourceTag(tone, label) {
    return `<span class="ah-tag is-${tone}">${escapeHtml(label)}</span>`;
}

function ahLateTag() {
    const late = state.lateTasks;
    if (late.status === 'loading') return ahSourceTag('off', 'Loading');
    if (late.status !== 'ready') return ahSourceTag('off', late.status === 'empty' ? 'No data yet' : 'Not connected');
    if (late.lists.some((item) => item.truncated)) return ahSourceTag('part', 'Some lists truncated');
    if (!late.lists.some((item) => item.service === 'seo')) return ahSourceTag('part', 'PPC only so far');
    return ahSourceTag('ok', 'Connected');
}

function ahAttentionTag(key) {
    const part = state.attention[key];
    if (part.status === 'loading') return ahSourceTag('off', 'Loading');
    if (part.status === 'ready') return part.rows.some((row) => row.truncated) ? ahSourceTag('part', 'Some lists truncated') : ahSourceTag('ok', 'Connected');
    return ahSourceTag('off', part.status === 'empty' ? 'No data yet' : 'Not connected');
}

function renderAhHealth() {
    const clients = state.clients.status;
    const rows = [
        ['Billing — MRR, retention, churn', state.invoices.length ? ahSourceTag('ok', 'Xero connected') : ahSourceTag('off', 'Loading')],
        ['Account map — manager, service, priority', state.accountMap.status === 'ready' && state.accountMap.rows.length ? ahSourceTag('ok', 'Connected') : state.accountMap.status === 'ready' ? ahSourceTag('part', 'Empty') : ahSourceTag('off', state.accountMap.status === 'loading' ? 'Loading' : 'Not connected')],
        ['WeHelp — NPS answers', clients === 'ready' ? ahSourceTag('ok', 'Connected') : ahSourceTag('off', clients === 'loading' ? 'Loading' : 'Not connected')],
        ['WeHelp — surveys sent (fill rate)', clients === 'ready' ? ahSourceTag('ok', 'Connected') : ahSourceTag('off', clients === 'loading' ? 'Loading' : 'Not connected')],
        ['ClickUp — late tasks, owners', ahLateTag()],
        ['ClickUp — biweekly and results meetings', ahAttentionTag('meetings')],
        ['AgencyAnalytics — client logins', ahAttentionTag('logins')],
        ['HubSpot — pipeline, won deals, new MRR', state.sales.status === 'ready' ? ahSourceTag('ok', 'Connected') : ahSourceTag('off', state.sales.status === 'loading' ? 'Loading' : 'Not connected')],
        ['Growth log — referrals, upsells, opportunities', state.growth.status === 'ready' ? ahSourceTag(state.growth.entries.length ? 'ok' : 'part', state.growth.entries.length ? 'Connected' : 'Empty') : ahSourceTag('off', state.growth.status === 'loading' ? 'Loading' : 'Not connected')],
    ];
    $('#ah-health').innerHTML = rows.map(([label, tag]) => `<li><span>${escapeHtml(label)}</span>${tag}</li>`).join('');
}

function renderAccountHealth() {
    const view = $('#account-health-view');
    if (!view || !view.classList.contains('is-visible')) return;
    renderAhFilters();
    const model = state.invoices.length ? ahModel() : null;
    renderAhStatus(model);
    renderAhCards(model);
    renderAhPortfolio(model);
    renderAhRetention(model);
    renderAhChurn(model);
    renderAhNps(model);
    renderAhLate(model);
    renderAhAttention(model);
    renderAhGrowth(model);
    renderAhHealth();
}

$('#ah-attention-toggle')?.addEventListener('click', () => {
    state.attention.showAll = !state.attention.showAll;
    renderAccountHealth();
});

['am', 'service', 'priority'].forEach((key) => {
    $(`#ah-${key}`)?.addEventListener('change', (event) => {
        state.accountHealth[key] = event.target.value;
        if (key === 'am') state.accountHealth.amTouched = true;
        renderAccountHealth();
    });
});

const accountMapModal = $('#account-map-modal');
const accountMapForm = $('#account-map-form');

function showAccountMapError(message) {
    const node = $('#account-map-error');
    node.hidden = !message;
    node.textContent = message || '';
}

function ahEditorClients() {
    const cutoff = Date.now() - AH_EDITOR_RECENT_DAYS * 86400000;
    const byKey = new Map();
    xeroClientList().forEach((client) => {
        if (!client.norm || byKey.has(client.norm)) return;
        const recent = client.last && client.last.getTime() >= cutoff;
        byKey.set(client.norm, { key: client.norm, name: client.name, recent });
    });
    state.accountMap.rows.forEach((row) => {
        if (!byKey.has(row.clientKey)) byKey.set(row.clientKey, { key: row.clientKey, name: row.clientName, recent: true });
    });
    const mapped = new Set(state.accountMap.rows.map((row) => row.clientKey));
    return [...byKey.values()].filter((item) => item.recent || mapped.has(item.key)).sort((a, b) => a.name.localeCompare(b.name));
}

function renderAccountMapRows() {
    const index = new Map(state.accountMap.rows.map((row) => [row.clientKey, row]));
    $('#ah-am-list').innerHTML = ahManagers().map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
    const serviceOptions = (current) => `<option value="">—</option>${AH_SERVICES.map((item) => `<option value="${item.key}"${item.key === current ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}`;
    const priorityOptions = (current) => `<option value="">—</option>${ahPriorities().map((name) => `<option value="${escapeHtml(name)}"${name === current ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}`;
    $('#account-map-rows').innerHTML = ahEditorClients().map((client) => {
        const row = index.get(client.key);
        return `<tr data-key="${escapeHtml(client.key)}" data-name="${escapeHtml(client.name)}" data-mapped="${row ? '1' : '0'}">
            <td><strong>${escapeHtml(client.name)}</strong></td>
            <td><input class="ah-input" type="text" name="am" list="ah-am-list" maxlength="80" autocomplete="off" value="${escapeHtml(row?.am || '')}" aria-label="Account manager for ${escapeHtml(client.name)}"></td>
            <td><select class="ah-input" name="service" aria-label="Service for ${escapeHtml(client.name)}">${serviceOptions(row?.service || '')}</select></td>
            <td><select class="ah-input" name="priority" aria-label="Priority for ${escapeHtml(client.name)}">${priorityOptions(row?.priority || '')}</select></td>
            <td><input class="ah-input" type="text" name="nextAction" maxlength="255" autocomplete="off" value="${escapeHtml(row?.nextAction || '')}" aria-label="Next action for ${escapeHtml(client.name)}"></td>
        </tr>`;
    }).join('');
}

function openAccountMapModal() {
    if (!AH_CAN_EDIT || !accountMapModal) return;
    showAccountMapError('');
    renderAccountMapRows();
    const latest = state.accountMap.rows.map((row) => row.enteredAt).filter(Boolean).sort().pop();
    setText('#account-map-meta', latest ? `Last saved ${new Date(latest).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.` : 'Nothing saved yet.');
    accountMapModal.showModal();
}

function closeAccountMapModal() {
    accountMapModal.close();
    $('#open-account-map-modal')?.focus();
}

function readAccountMapForm() {
    const accounts = [];
    for (const tr of $('#account-map-rows').querySelectorAll('tr')) {
        const read = (name) => tr.querySelector(`[name="${name}"]`).value.trim();
        const am = read('am');
        const service = read('service');
        const wasMapped = tr.dataset.mapped === '1';
        if (am === '' && !wasMapped) continue;
        if (am !== '' && service === '') {
            showAccountMapError(`Choose a service for ${tr.dataset.name}.`);
            tr.querySelector('[name="service"]').focus();
            return null;
        }
        accounts.push({ clientKey: tr.dataset.key, clientName: tr.dataset.name, am, service, priority: read('priority'), nextAction: read('nextAction') });
    }
    return accounts;
}

if (accountMapForm) {
    $('#open-account-map-modal')?.addEventListener('click', openAccountMapModal);
    accountMapModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeAccountMapModal));
    accountMapModal.addEventListener('click', (event) => { if (event.target === accountMapModal) closeAccountMapModal(); });
    accountMapForm.addEventListener('input', () => { if (!$('#account-map-error').hidden) showAccountMapError(''); });
    accountMapForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const accounts = readAccountMapForm();
        if (!accounts) return;
        if (!accounts.length) { closeAccountMapModal(); return; }
        const submit = $('#account-map-submit');
        const label = submit.textContent;
        submit.disabled = true;
        submit.textContent = 'Saving…';
        try {
            const body = await ahRequest({
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' },
                body: JSON.stringify({ accounts }),
            });
            state.accountMap = { status: 'ready', rows: body.accounts || [], error: null };
            closeAccountMapModal();
            renderAccountHealth();
        } catch (error) {
            showAccountMapError(error.message || 'Could not save the account map.');
        } finally {
            submit.disabled = false;
            submit.textContent = label;
        }
    });
}

const growthModal = $('#growth-modal');
const growthForm = $('#growth-form');

function showGrowthError(message) {
    const node = $('#growth-error');
    node.hidden = !message;
    node.textContent = message || '';
}

function openGrowthModal(id) {
    if (!AH_CAN_EDIT || !growthModal) return;
    const entry = id ? state.growth.entries.find((item) => item.id === id) : null;
    const form = growthForm.elements;
    showGrowthError('');
    const today = new Date();
    form.id.value = entry ? entry.id : '';
    form.loggedOn.value = entry ? entry.loggedOn : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    form.person.value = entry ? entry.person : (AH_USER.role === 'account_manager' ? AH_USER.name : '');
    form.kind.value = entry ? entry.kind : 'referral';
    form.clientName.value = entry ? entry.clientName : '';
    form.mrr.value = entry && entry.mrr !== null ? entry.mrr : '';
    form.status.value = entry ? entry.status : 'open';
    form.note.value = entry && entry.note ? entry.note : '';
    $('#growth-delete').hidden = !entry;
    setText('#growth-modal-title', entry ? 'Edit growth entry' : 'Log growth entry');
    const model = state.invoices.length ? ahGrowthModel('') : null;
    $('#growth-people').innerHTML = (model ? model.people : []).map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
    growthModal.showModal();
}

function closeGrowthModal() {
    growthModal.close();
    $('#open-growth-modal')?.focus();
}

async function saveGrowth(payload) {
    const submit = $('#growth-submit');
    const label = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
        const body = await growthRequest({
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' },
            body: JSON.stringify(payload),
        });
        state.growth = { ...state.growth, status: 'ready', entries: body.entries || [], error: null };
        closeGrowthModal();
        renderAccountHealth();
    } catch (error) {
        showGrowthError(error.message || 'Could not save the entry.');
    } finally {
        submit.disabled = false;
        submit.textContent = label;
    }
}

if (growthForm) {
    $('#open-growth-modal')?.addEventListener('click', () => openGrowthModal(null));
    growthModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeGrowthModal));
    growthModal.addEventListener('click', (event) => { if (event.target === growthModal) closeGrowthModal(); });
    growthForm.addEventListener('input', () => { if (!$('#growth-error').hidden) showGrowthError(''); });
    growthForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const form = growthForm.elements;
        const mrr = form.mrr.value.trim();
        saveGrowth({ entry: {
            id: form.id.value ? Number(form.id.value) : null,
            loggedOn: form.loggedOn.value,
            person: form.person.value,
            kind: form.kind.value,
            clientName: form.clientName.value,
            mrr: mrr === '' ? null : Number(mrr),
            status: form.status.value,
            note: form.note.value,
        } });
    });
    $('#growth-delete')?.addEventListener('click', () => {
        const id = Number(growthForm.elements.id.value);
        if (id && window.confirm('Delete this entry?')) saveGrowth({ delete: id });
    });
    $('#ah-open-table')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-growth-edit]');
        if (button) openGrowthModal(Number(button.dataset.growthEdit));
    });
    $('#ah-open-toggle')?.addEventListener('click', () => {
        state.growth.showAllOpen = !state.growth.showAllOpen;
        renderAccountHealth();
    });
}
