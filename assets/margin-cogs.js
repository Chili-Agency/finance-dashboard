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
    if (!CAN_MANUAL_INPUTS) return;
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

document.querySelectorAll('#margin-view .entries-tab').forEach((button) => button.addEventListener('click', () => {
    state.marginEntriesMode = button.dataset.entries;
    document.querySelectorAll('#margin-view .entries-tab').forEach((item) => item.classList.toggle('is-active', item === button));
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