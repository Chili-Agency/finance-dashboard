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

state.targetInputs = {};
state.targetInputsStatus = 'loading';
state.targetInputsError = '';
const TARGETS_ENDPOINT = 'targets.php';
const TARGET_FIELDS = {
    totalMrrTarget: { kind: 'money' },
};
const targetsModal = $('#targets-modal');
const targetsForm = $('#targets-form');

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
    if (!CAN_MANUAL_INPUTS) return;
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