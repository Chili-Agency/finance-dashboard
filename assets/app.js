function renderAll() { renderInvoices(); renderLate(); renderMrr(); renderScorecard(); if (typeof renderSales === 'function') renderSales(); if (typeof renderClientView === 'function') renderClientView(); syncViewToUrl(); }

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

async function refreshData() {
    if (state.sync.inFlight) return;
    state.sync.phase = 'refreshing';
    state.sync.inFlight = true;
    state.sync.startedAt = Date.now();
    $('#refresh-button').disabled = true;
    renderSyncStatus();
    let problem = null;
    try {
        const response = redirectIfSignedOut(await fetch('snapshot-refresh.php', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' },
        }));
        const body = await response.json().catch(() => null);
        state.lastRefresh = body;
        if (!response.ok) problem = body && (body.errors?.length ? body.errors.join(' · ') : body.error) || `The server answered HTTP ${response.status}`;
    } catch (error) {
        problem = error.message;
    }
    state.sync.inFlight = false;
    await Promise.all([loadInvoices(), typeof loadAds === 'function' ? loadAds() : null, typeof loadCosts === 'function' ? loadCosts() : null, typeof loadClients === 'function' ? loadClients() : null, typeof loadSales === 'function' ? loadSales() : null, typeof loadSalesGoals === 'function' ? loadSalesGoals() : null]);
    if (problem) {
        const notice = $('#error-notice');
        notice.classList.remove('is-info');
        notice.textContent = `Part of the refresh failed, so some figures still use the previous data. ${problem}`;
        notice.classList.remove('is-hidden');
    }
}

$('#refresh-button').addEventListener('click', refreshData);
document.querySelectorAll('.scope-tab').forEach((button) => button.addEventListener('click', () => { state.scope = button.dataset.scope; document.querySelectorAll('.scope-tab').forEach((item) => item.classList.toggle('is-active', item.dataset.scope === state.scope)); renderAll(); }));
document.querySelectorAll('.category-tab').forEach((button) => button.addEventListener('click', () => { state.category = button.dataset.category; document.querySelectorAll('.category-tab').forEach((item) => item.classList.toggle('is-active', item.dataset.category === state.category)); renderAll(); }));
document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('is-active')); button.classList.add('is-active'); document.querySelectorAll('.view').forEach((view) => view.classList.remove('is-visible')); $(`#${button.dataset.view}-view`).classList.add('is-visible'); $('#page-title').textContent = button.dataset.title || button.textContent.trim(); }));

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

document.querySelectorAll('[data-goto-view]').forEach((button) => button.addEventListener('click', () => {
    const target = document.querySelector(`.nav-item[data-view="${button.dataset.gotoView}"]`);
    if (target) target.click();
}));

loadInvoices();
renderScorecard();
loadMarginInputs();
loadTargetInputs();
loadBrIndices();
loadUnitInputs();
loadLateRules();
loadAds();
loadCosts();
loadClients();
loadSalesGoals();