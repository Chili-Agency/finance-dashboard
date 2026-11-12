/*
 * Página "KPI scorecard" (admin): monta o scorecard de KPI de um usuário do ClickUp com a mesma estrutura da subtask do ClickUp
 * (nível, KPI 1-7 com peso/meta/atual/score/fonte/direção, score geral, zona, gerente) e salva em kpi-scorecards.php.
 * O envio ao ClickUp será feito depois por um workflow do n8n.
 *
 * Nome do scorecard: KPI-YYYYMM-Sobrenome-Nome-SEO|PPC.
 * Para mudar os KPIs padrão (nome, peso, meta, direção, fonte), edite KPI_DEFAULTS logo abaixo.
 */
const KPI_ENDPOINT = 'kpi-scorecards.php';
const KPI_USERS_ENDPOINT = 'clickup-users.php';
const KPI_DATA_ENDPOINT = 'kpi-data.php'; // KPI 1 e KPI 3 vêm do n8n (workflow "Data Fetching Workflow for KPIs")
const KPI_DATA_ROWS = { 1: 0, 3: 2 }; // número do KPI no n8n -> posição da linha na tabela
const KPI_USERS_FRESH_MS = 10 * 60 * 1000;
const KPI_MAX_SLOTS = 7;
const KPI_SCORE_CAP = 1.2;
const KPI_TEMPLATE_DOC = 'Chili_KPIs_by_Department_v5';

// Nomes, pesos e metas são os mesmos em todo L1 de todo departamento; só a fonte muda.
// As fontes abaixo foram copiadas do scorecard PPC. A fonte de SEO é a mesma até alguém informar outra.
const KPI_DEFAULTS = {
    default: [
        { name: 'Delivery / SLA Hit-Rate', weight: 25, target: 95, direction: 'higher', source: 'ClickUp' },
        { name: 'Quality / Rework Rate', weight: 25, target: 10, direction: 'lower', source: 'ClickUp QA' },
        { name: 'Time Tracking + Billable %', weight: 20, target: 95, direction: 'higher', source: 'ClickUp' },
        { name: 'Scope Support Contribution', weight: 15, target: 80, direction: 'higher', source: 'Platform/HubSpot' },
        { name: 'Training & Certification', weight: 15, target: 100, direction: 'higher', source: 'Platform (certifications)' },
    ],
};
const KPI_ROLE_DEFAULT = { SEO: 'SEO Analyst', PPC: 'PPC Analyst' };

state.kpi = { users: [], usersStatus: 'idle', usersError: null, usersLoadedAt: 0, saved: [], savedStatus: 'idle', savedError: null, rows: [], monthLabel: '', basis: '', billableTouched: false, data: { status: 'idle', key: '', kpis: null, errors: [] } };

const kpiEl = {
    form: () => $('#kpi-form'), user: () => $('#kpi-user'), manager: () => $('#kpi-manager'), month: () => $('#kpi-month'),
    service: () => $('#kpi-service'), first: () => $('#kpi-first'), last: () => $('#kpi-last'), level: () => $('#kpi-level'),
    role: () => $('#kpi-role'), billable: () => $('#kpi-billable'), provisional: () => $('#kpi-provisional'), notes: () => $('#kpi-notes'),
};

const kpiToken = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
const kpiNum = (value) => { const t = String(value ?? '').trim().replace(',', '.'); return t !== '' && Number.isFinite(Number(t)) ? Number(t) : null; };
const kpiFmt = (n) => (Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '');
const kpiPeriod = () => kpiEl.month().value.replace('-', '');
const kpiPart = (value) => String(value || '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

function kpiScore(row) {
    const target = kpiNum(row.target);
    const actual = kpiNum(row.actual);
    if (actual === null || target === null) return null;
    let ratio;
    if (row.direction === 'lower') ratio = actual <= 0 ? KPI_SCORE_CAP : target / actual;
    else ratio = target > 0 ? actual / target : 0;
    return Math.round(Math.min(ratio, KPI_SCORE_CAP) * 1000) / 10;
}

function kpiOverall() {
    let weight = 0, sum = 0, total = 0;
    state.kpi.rows.forEach((row) => {
        const w = kpiNum(row.weight) ?? 0;
        total += w;
        const score = kpiScore(row);
        if (score !== null) { weight += w; sum += w * score; }
    });
    return { total, scoredWeight: weight, overall: weight > 0 ? Math.round((sum / weight) * 10) / 10 : null };
}

const kpiZoneOf = (overall) => (overall >= 80 ? 'GREEN' : overall >= 70 ? 'YELLOW' : overall >= 50 ? 'ORANGE' : 'RED');

function kpiName() {
    const period = kpiPeriod();
    return `KPI-${/^\d{6}$/.test(period) ? period : 'YYYYMM'}-${kpiPart(kpiEl.last().value) || 'Surname'}-${kpiPart(kpiEl.first().value) || 'Name'}-${kpiEl.service().value || 'SEO|PPC'}`;
}

function kpiSplitName(full) {
    const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return { first: parts[0] || '', last: '' };
    const cut = parts.length >= 4 ? 2 : 1;
    return { first: parts.slice(0, cut).join(' '), last: parts.slice(cut).join(' ') };
}

function kpiUserById(id) { return state.kpi.users.find((u) => String(u.id) === String(id)) || null; }

function kpiEmployeeName() {
    const id = kpiEl.user().value;
    return id && id !== '__manual' ? (kpiUserById(id)?.username || '') : `${kpiEl.first().value} ${kpiEl.last().value}`.trim();
}

async function kpiRequest(options = {}, query = '') {
    const response = redirectIfSignedOut(await fetch(KPI_ENDPOINT + query, { cache: 'no-store', ...options }));
    const body = await response.json().catch(() => null);
    if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
    if (!response.ok) throw new Error(body.error || `The server answered HTTP ${response.status}.`);
    return body;
}

async function kpiLoadUsers() {
    const s = state.kpi;
    if (s.usersStatus === 'loading' || (s.usersStatus === 'ready' && Date.now() - s.usersLoadedAt < KPI_USERS_FRESH_MS)) return;
    s.usersStatus = 'loading';
    try {
        const response = redirectIfSignedOut(await fetch(KPI_USERS_ENDPOINT, { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
        if (!response.ok || !body.ok) throw new Error((body.errors || []).join(' · ') || `The server answered HTTP ${response.status}.`);
        s.users = (body.users || []).filter((u) => u.username).sort((a, b) => a.username.localeCompare(b.username));
        s.usersStatus = 'ready';
        s.usersError = null;
        s.usersLoadedAt = Date.now();
    } catch (error) {
        s.usersStatus = 'error';
        s.usersError = error.message;
    }
    kpiRenderUsers();
}

async function kpiLoadSaved() {
    const s = state.kpi;
    try {
        const body = await kpiRequest();
        s.saved = body.scorecards || [];
        s.savedStatus = body.ready === false ? 'off' : 'ready';
        s.savedError = body.error || null;
    } catch (error) {
        s.savedStatus = 'error';
        s.savedError = error.message;
    }
    kpiRenderSaved();
}

function kpiRenderUsers() {
    const s = state.kpi;
    const options = (current) => s.users.map((u) => `<option value="${escapeHtml(u.id)}"${String(u.id) === current ? ' selected' : ''}>${escapeHtml(u.username)}</option>`).join('');
    const employee = kpiEl.user().value;
    kpiEl.user().innerHTML = `<option value="">${s.usersStatus === 'loading' ? 'Loading users…' : 'Select a user…'}</option>${options(employee)}<option value="__manual"${employee === '__manual' ? ' selected' : ''}>Other (type the name)</option>`;
    const manager = kpiEl.manager().value;
    kpiEl.manager().innerHTML = `<option value="">—</option>${options(manager)}`;
    $('#kpi-users-note').textContent = s.usersStatus === 'error' ? `Could not load the ClickUp users (${s.usersError}). Choose "Other" for the employee and type the name.` : '';
}

// Chave do que o n8n precisa: usuário do ClickUp (id numérico) + mês. Usuário digitado à mão não tem dados automáticos.
function kpiDataKey() {
    const id = kpiEl.user().value;
    const period = kpiPeriod();
    return id && id !== '__manual' && /^\d{6}$/.test(period) ? `${id}|${period}` : '';
}

// Coloca os valores do n8n nas linhas. Não sobrescreve o que o usuário já digitou.
function kpiApplyData() {
    const s = state.kpi;
    if (!s.data.kpis || s.data.key !== kpiDataKey()) return;
    Object.entries(KPI_DATA_ROWS).forEach(([n, index]) => {
        const row = s.rows[index];
        const item = s.data.kpis[n];
        if (!row || !item || !Number.isFinite(item.value)) return;
        const fresh = kpiFmt(item.value);
        if (String(row.actual).trim() === '' || String(row.actual) === row.dashActual) row.actual = fresh;
        row.dashActual = fresh;
        row.dashNote = item.note || '';
    });
}

async function kpiFetchData(force = false) {
    const s = state.kpi;
    const key = kpiDataKey();
    if (!key) {
        s.data = { status: 'idle', key: '', kpis: null, errors: [] };
        kpiRenderDerived();
        return;
    }
    if (!force && s.data.key === key && (s.data.status === 'ready' || s.data.status === 'loading')) {
        kpiApplyData();
        kpiRenderRows();
        return;
    }
    s.data = { status: 'loading', key, kpis: null, errors: [] };
    kpiRenderDerived();
    try {
        const [userId, period] = key.split('|');
        const response = redirectIfSignedOut(await fetch(`${KPI_DATA_ENDPOINT}?userId=${encodeURIComponent(userId)}&month=${period}`, { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
        if (!response.ok || !body.ok) throw new Error((body.errors || []).join(' · ') || `The server answered HTTP ${response.status}.`);
        if (s.data.key !== key) return; // o usuário ou o mês mudou enquanto carregava
        s.data = { status: 'ready', key, kpis: body.kpis, errors: body.errors || [] };
    } catch (error) {
        if (s.data.key !== key) return;
        s.data = { status: 'error', key, kpis: null, errors: [error.message] };
    }
    kpiApplyData();
    kpiRenderRows();
}

function kpiBasisText() {
    const s = state.kpi;
    if (s.basis) return s.basis;
    if (!kpiEl.service().value || !kpiEmployeeName()) return '';
    const d = s.data;
    if (d.status === 'loading') return 'Loading the ClickUp data for this user and month…';
    if (d.status === 'error') return `Could not load the ClickUp data (${d.errors[0] || 'unknown error'}). Type the values by hand.`;
    if (d.status === 'ready') return `KPI 1 and KPI 3 come from ClickUp for the review month.${d.errors.length ? ` Partial data: ${d.errors.join(' · ')}.` : ''} The other KPIs have no automatic source yet: type them in.`;
    return 'No automatic data for a typed user. Choose the user from the ClickUp list, or type the values by hand.';
}

function kpiBuildRows() {
    const s = state.kpi;
    s.rows = KPI_DEFAULTS.default.map((d) => ({ ...d, actual: '', dashActual: '', dashNote: '' }));
    s.billableTouched = false;
    s.monthLabel = '';
    s.basis = '';
    kpiApplyData();
}

function kpiRenderRows() {
    const s = state.kpi;
    $('#kpi-rows').innerHTML = s.rows.map((row, i) => {
        const edited = row.dashActual !== '' && String(row.actual) !== row.dashActual;
        return `<tr data-i="${i}">
        <td>${i + 1}</td>
        <td><input class="ah-input" type="text" data-f="name" maxlength="120" value="${escapeHtml(row.name)}" aria-label="KPI ${i + 1} name"></td>
        <td><input class="ah-input" type="text" inputmode="decimal" data-f="weight" maxlength="6" value="${escapeHtml(row.weight)}" aria-label="KPI ${i + 1} weight"></td>
        <td><input class="ah-input" type="text" inputmode="decimal" data-f="target" maxlength="10" value="${escapeHtml(row.target)}" aria-label="KPI ${i + 1} target"></td>
        <td><select class="ah-input" data-f="direction" aria-label="KPI ${i + 1} direction"><option value="higher"${row.direction === 'higher' ? ' selected' : ''}>Higher is better</option><option value="lower"${row.direction === 'lower' ? ' selected' : ''}>Lower is better</option></select></td>
        <td><input class="ah-input" type="text" inputmode="decimal" data-f="actual" maxlength="10" value="${escapeHtml(row.actual)}" aria-label="KPI ${i + 1} actual">
            ${row.dashNote ? `<div class="kpi-dash-note"><span>ClickUp: ${escapeHtml(row.dashNote)}</span>${edited ? '<button type="button" class="kpi-link" data-act="restore">Restore</button>' : ''}</div>` : ''}</td>
        <td><span class="kpi-score" data-score>—</span></td>
        <td><input class="ah-input" type="text" data-f="source" maxlength="80" value="${escapeHtml(row.source)}" aria-label="KPI ${i + 1} source or tool">${i >= 5 ? '<button type="button" class="kpi-link" data-act="remove">Remove</button>' : ''}</td>
    </tr>`;
    }).join('');
    kpiRenderDerived();
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function kpiMonthName() {
    const period = kpiPeriod();
    return /^\d{6}$/.test(period) ? `${MONTHS[Number(period.slice(4)) - 1]} ${period.slice(0, 4)}` : '';
}

function kpiDescription() {
    const s = state.kpi;
    const { scoredWeight, overall } = kpiOverall();
    const dept = kpiEl.service().value || '—';
    const level = kpiEl.level().value;
    const full = `${kpiPart(kpiEl.first().value)} ${kpiPart(kpiEl.last().value)}`.trim() || '—';
    const mon = kpiMonthName();
    const monShort = mon ? mon.slice(0, 3) : 'Actual';
    const lines = [`KPI scorecard — ${full} · ${kpiEl.role().value.trim() || dept} (${level}) · ${mon || '—'}`, ''];
    if (kpiEl.provisional().checked) lines.push(`⚠️ Provisional data. ${scoredWeight}% of the weight could be scored from system data.${kpiEl.notes().value.trim() ? ' ' + kpiEl.notes().value.trim() : ''} Do not use this for a zone, a PIP or a probation decision. Performance Zone is intentionally left blank.`, '');
    else if (kpiEl.notes().value.trim()) lines.push(kpiEl.notes().value.trim(), '');
    lines.push(`Template: ${level} · ${dept} tab of ${KPI_TEMPLATE_DOC}. The KPI names, weights and targets are identical for every ${level} in every department. Only the Source / Tool column varies.`, '');
    lines.push(`| # | KPI | Weight | Target | Actual (${monShort}) | Score % | Source / note |`, '|---|---|---|---|---|---|---|');
    s.rows.forEach((row, i) => {
        const score = kpiScore(row);
        const target = `${row.target} (%)${row.direction === 'lower' ? ' (lower better)' : ''}`;
        lines.push(`| ${i + 1} | ${row.name} | ${row.weight}% | ${target} | ${String(row.actual).trim() || '—'} | ${score === null ? '—' : kpiFmt(score)} | ${row.source || ''}${row.dashNote && String(row.actual) === row.dashActual ? '; ' + row.dashNote : ''} |`);
    });
    lines.push('', `Overall KPI Score${kpiEl.provisional().checked ? ' (provisional)' : ''}: ${overall === null ? '—' : kpiFmt(overall)}${overall === null ? '' : `, calculated on the ${scoredWeight}% of weight with data`}.`, '');
    lines.push('How it\'s scored: KPI Score % = MIN(Actual ÷ Target, 1.2) × 100, or MIN(Target ÷ Actual, 1.2) × 100 for a "Lower is better" KPI, so overachievement is credited up to 120% per KPI. Overall = the weighted average of the scored KPIs.');
    lines.push('Zones: RED <50 · ORANGE 50–69.99 · YELLOW 70–79.99 · GREEN ≥80, which is bonus eligible.');
    const manager = kpiUserById(kpiEl.manager().value);
    if (manager) lines.push(`Direct Manager: ${manager.username}.`);
    return lines.join('\n');
}

function kpiRenderDerived() {
    const s = state.kpi;
    $('#kpi-rows').querySelectorAll('tr').forEach((tr) => {
        const score = kpiScore(s.rows[Number(tr.dataset.i)]);
        tr.querySelector('[data-score]').textContent = score === null ? '—' : kpiFmt(score);
    });
    const { total, scoredWeight, overall } = kpiOverall();
    const provisional = kpiEl.provisional().checked;
    $('#kpi-overall').textContent = overall === null ? '—' : kpiFmt(overall);
    $('#kpi-coverage').textContent = overall === null ? 'No actuals yet' : `On ${scoredWeight}% of the weight`;
    const weights = $('#kpi-weights');
    weights.textContent = `${Math.round(total * 100) / 100}`;
    weights.style.color = Math.abs(total - 100) > 0.01 ? '#b3261e' : '';
    if (!s.billableTouched) kpiEl.billable().value = s.rows[2] && kpiNum(s.rows[2].actual) !== null ? kpiFmt(kpiNum(s.rows[2].actual)) : '';
    const zone = $('#kpi-zone');
    const name = overall === null || provisional ? '' : kpiZoneOf(overall);
    zone.textContent = name || '—';
    zone.className = name ? `kpi-zone-${name.toLowerCase()}` : '';
    $('#kpi-zone-note').textContent = provisional ? 'Left blank: provisional' : '';
    $('#kpi-name').textContent = kpiName();
    $('#kpi-source-note').textContent = kpiBasisText();
    $('#kpi-description').textContent = kpiDescription();
}

function kpiShowError(message) { const n = $('#kpi-error'); n.hidden = !message; n.textContent = message || ''; }
function kpiSetStatus(message, tone = 'muted') { const n = $('#kpi-status'); n.textContent = message || ''; n.dataset.tone = tone; }

function kpiPayload() {
    const s = state.kpi;
    const id = kpiEl.user().value;
    const manager = kpiUserById(kpiEl.manager().value);
    return {
        period: kpiPeriod(), service: kpiEl.service().value, level: kpiEl.level().value, roleTitle: kpiEl.role().value,
        userId: id && id !== '__manual' ? id : '', userName: kpiEmployeeName(),
        firstName: kpiEl.first().value, lastName: kpiEl.last().value,
        managerId: manager ? String(manager.id) : '', managerName: manager ? manager.username : '',
        provisional: kpiEl.provisional().checked, billable: kpiEl.billable().value, notes: kpiEl.notes().value,
        description: kpiDescription(), dashboardPeriod: s.monthLabel,
        kpis: s.rows.map((r) => ({ name: r.name, weight: r.weight, target: r.target, actual: String(r.actual).trim(), direction: r.direction, source: r.source, dashboardActual: r.dashActual })),
    };
}

function kpiValidate() {
    if (!/^20\d{4}$/.test(kpiPeriod())) return 'Choose the review month.';
    if (!kpiEl.service().value) return 'Choose the department: SEO or PPC.';
    if (!kpiPart(kpiEl.first().value) || !kpiPart(kpiEl.last().value)) return 'Fill in the first and last name.';
    const rows = state.kpi.rows;
    if (!rows.length) return 'Add at least one KPI.';
    for (let i = 0; i < rows.length; i += 1) {
        if (!rows[i].name.trim()) return `KPI ${i + 1} needs a name.`;
        if (kpiNum(rows[i].weight) === null || kpiNum(rows[i].target) === null) return `KPI ${i + 1} needs a numeric weight and target.`;
        if (String(rows[i].actual).trim() !== '' && kpiNum(rows[i].actual) === null) return `KPI ${i + 1} actual must be a number.`;
    }
    if (Math.abs(kpiOverall().total - 100) > 0.01) return 'The KPI weights must add up to 100.';
    return '';
}

async function kpiSave(event) {
    event.preventDefault();
    const problem = kpiValidate();
    kpiShowError(problem);
    if (problem) return;
    const button = $('#kpi-save');
    button.disabled = true;
    kpiSetStatus('Saving…');
    try {
        const body = await kpiRequest({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': kpiToken() }, body: JSON.stringify(kpiPayload()) });
        state.kpi.saved = body.scorecards || [];
        state.kpi.savedStatus = 'ready';
        kpiRenderSaved();
        kpiSetStatus(`Saved ${body.savedName}.`, 'good');
    } catch (error) {
        kpiShowError(error.message);
        kpiSetStatus('');
    } finally {
        button.disabled = false;
    }
}

function kpiRenderSaved() {
    const s = state.kpi;
    $('#kpi-saved-count').textContent = s.saved.length ? `${s.saved.length} saved` : '';
    $('#kpi-saved-rows').innerHTML = s.saved.map((card, i) => {
        const p = card.payload || {};
        return `<tr data-i="${i}">
        <td><strong>${escapeHtml(card.name)}</strong>${p.provisional ? '<div class="client-sub">Provisional</div>' : ''}</td>
        <td>${escapeHtml(card.userName)}</td>
        <td>${Number.isFinite(p.overallScore) ? escapeHtml(String(p.overallScore)) : DASH}${p.performanceZone ? ` · ${escapeHtml(p.performanceZone)}` : ''}</td>
        <td>${card.updatedAt ? escapeHtml(new Date(card.updatedAt).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })) : DASH}${card.updatedBy ? `<div class="client-sub">${escapeHtml(card.updatedBy)}</div>` : ''}</td>
        <td><button type="button" class="kpi-link" data-act="load">Open</button> <button type="button" class="kpi-link" data-act="delete">Delete</button></td>
    </tr>`;
    }).join('');
    const empty = $('#kpi-saved-empty');
    empty.classList.toggle('is-hidden', s.saved.length > 0);
    empty.textContent = s.savedStatus === 'off' || s.savedStatus === 'error' ? (s.savedError || 'Could not load the saved scorecards.') : 'No scorecards saved yet.';
}

function kpiLoadCard(card) {
    const s = state.kpi;
    const p = card.payload || {};
    kpiEl.month().value = `${card.period.slice(0, 4)}-${card.period.slice(4)}`;
    kpiEl.service().value = card.service;
    kpiEl.level().value = p.level || 'L1';
    kpiEl.role().value = p.roleTitle || '';
    kpiEl.user().value = kpiUserById(card.userId) ? String(card.userId) : '__manual';
    kpiEl.manager().value = kpiUserById(p.managerId) ? String(p.managerId) : '';
    kpiEl.first().value = p.firstName || '';
    kpiEl.last().value = p.lastName || '';
    kpiEl.provisional().checked = !!p.provisional;
    kpiEl.notes().value = p.notes || '';
    s.rows = (p.kpis || []).map((k) => {
        const dash = Number.isFinite(k.dashboardActual) ? kpiFmt(k.dashboardActual) : '';
        return { name: k.name, weight: String(k.weight), target: String(k.target), direction: k.direction, source: k.source || '', actual: k.actual === null || k.actual === undefined ? '' : String(k.actual), dashActual: dash, dashNote: dash ? 'value pulled when saved' : '' };
    });
    s.billableTouched = Number.isFinite(p.billable);
    kpiRenderRows();
    kpiEl.billable().value = Number.isFinite(p.billable) ? kpiFmt(p.billable) : '';
    s.basis = 'Loaded from a saved scorecard. "Reset" pulls the defaults and the current dashboard figures again.';
    kpiRenderDerived();
    kpiShowError('');
    kpiSetStatus(`Opened ${card.name}.`);
    kpiEl.form().scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function kpiCopy(text, okMessage) {
    try { await navigator.clipboard.writeText(text); kpiSetStatus(okMessage, 'good'); }
    catch (error) { kpiSetStatus('Your browser blocked copying. Select the text and copy it by hand.'); }
}

function kpiRebuild() { kpiBuildRows(); kpiRenderRows(); }

function kpiInit() {
    const form = kpiEl.form();
    if (!form) return;
    const now = new Date();
    // Revisão do mês que acabou: em novembro, o padrão é outubro (o scorecard é montado depois do fechamento).
    const review = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    kpiEl.month().value = `${review.getFullYear()}-${String(review.getMonth() + 1).padStart(2, '0')}`;

    kpiEl.user().addEventListener('change', () => {
        const user = kpiUserById(kpiEl.user().value);
        if (user) { const parts = kpiSplitName(user.username); kpiEl.first().value = parts.first; kpiEl.last().value = parts.last; }
        else if (!kpiEl.user().value) { kpiEl.first().value = ''; kpiEl.last().value = ''; }
        kpiRebuild();
        kpiFetchData();
    });
    kpiEl.service().addEventListener('change', () => {
        const role = kpiEl.role().value.trim();
        if (!role || Object.values(KPI_ROLE_DEFAULT).includes(role)) kpiEl.role().value = KPI_ROLE_DEFAULT[kpiEl.service().value] || '';
        kpiRebuild();
        kpiFetchData();
    });
    kpiEl.month().addEventListener('input', () => kpiFetchData());
    [kpiEl.month(), kpiEl.first(), kpiEl.last(), kpiEl.level(), kpiEl.role(), kpiEl.manager(), kpiEl.provisional(), kpiEl.notes()].forEach((el) => el.addEventListener('input', kpiRenderDerived));
    kpiEl.billable().addEventListener('input', () => { state.kpi.billableTouched = true; });

    $('#kpi-rows').addEventListener('input', (event) => {
        const input = event.target.closest('[data-f]');
        if (!input) return;
        state.kpi.rows[Number(input.closest('tr').dataset.i)][input.dataset.f] = input.value;
        kpiRenderDerived();
    });
    $('#kpi-rows').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-act]');
        if (!button) return;
        const index = Number(button.closest('tr').dataset.i);
        if (button.dataset.act === 'remove') state.kpi.rows.splice(index, 1);
        if (button.dataset.act === 'restore') state.kpi.rows[index].actual = state.kpi.rows[index].dashActual;
        kpiRenderRows();
    });
    $('#kpi-add').addEventListener('click', () => {
        if (state.kpi.rows.length >= KPI_MAX_SLOTS) { kpiShowError(`A scorecard has at most ${KPI_MAX_SLOTS} KPIs.`); return; }
        kpiShowError('');
        state.kpi.rows.push({ name: '', weight: '0', target: '', direction: 'higher', source: '', actual: '', dashActual: '', dashNote: '' });
        kpiRenderRows();
        $('#kpi-rows').querySelector('tr:last-child input[data-f="name"]')?.focus();
    });
    $('#kpi-reset').addEventListener('click', () => { kpiRebuild(); kpiFetchData(true); kpiSetStatus('Defaults restored. Fetching the ClickUp data again.'); });
    $('#kpi-copy-name').addEventListener('click', () => kpiCopy(kpiName(), 'Name copied.'));
    $('#kpi-copy-desc').addEventListener('click', () => kpiCopy(kpiDescription(), 'Description copied.'));
    $('#kpi-copy-json').addEventListener('click', () => kpiCopy(JSON.stringify({ name: kpiName(), ...kpiPayload() }, null, 2), 'JSON copied.'));
    form.addEventListener('submit', kpiSave);

    $('#kpi-saved-rows').addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-act]');
        if (!button) return;
        const card = state.kpi.saved[Number(button.closest('tr').dataset.i)];
        if (button.dataset.act === 'load') return kpiLoadCard(card);
        if (!window.confirm(`Delete ${card.name}?`)) return;
        try {
            const body = await kpiRequest({ method: 'DELETE', headers: { 'X-CSRF-Token': kpiToken() } }, `?name=${encodeURIComponent(card.name)}`);
            state.kpi.saved = body.scorecards || [];
            kpiRenderSaved();
            kpiSetStatus('Scorecard deleted.');
        } catch (error) { kpiShowError(error.message); }
    });

    document.querySelectorAll('.nav-item[data-view="kpi-scorecard"]').forEach((button) => button.addEventListener('click', () => {
        kpiLoadUsers();
        kpiLoadSaved();
        if (!state.kpi.rows.length) kpiRebuild();
    }));
    kpiRenderUsers();
    kpiBuildRows();
    kpiRenderRows();
}

kpiInit();
