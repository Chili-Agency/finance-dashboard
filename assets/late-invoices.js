const EDITABLE_RULE_SCOPES = ['mx', 'pa', 'int'];
const LATE_RULES_ENDPOINT = 'late-rules.php';
state.lateRules = {};
state.lateRulesStatus = 'loading';
state.lateRulesError = '';
state.brIndices = { status: 'loading', series: {}, latest: {}, error: null, stale: [] };
const AGING_BUCKETS = [
    { label: '1–30 days', min: 1, max: 30 },
    { label: '31–60 days', min: 31, max: 60 },
    { label: '61–90 days', min: 61, max: 90 },
    { label: '90+ days', min: 91, max: Infinity },
];
const ratePercent = (value) => `${Number((value * 100).toFixed(2))}%`;

function lateRuleLabel(rule) {
    if (rule.source === 'unset') return 'Rate not set';
    const parts = [];
    if (rule.lateFee) parts.push(`${ratePercent(rule.lateFee)} fee`);
    if (rule.monthlyInterest) parts.push(`${ratePercent(rule.monthlyInterest)}/month`);
    if (rule.correction.length) parts.push(rule.correction.map((key) => INDEX_LABELS[key]).join('/'));
    const label = parts.join(' + ') || 'No charges';
    return rule.graceDays ? `${label} after ${plural(rule.graceDays, 'day')}` : label;
}

function originalBalance(invoice) {
    const currency = String(invoice.CurrencyCode || invoice.companyCurrency || '').toUpperCase();
    if (!currency || currency === 'USD') return '';
    const value = Number(invoice.AmountDue || 0) * categoryShare(invoice);
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code' }).format(value);
    } catch {
        return `${currency} ${value.toFixed(2)}`;
    }
}

async function loadBrIndices() {
    try {
        const response = redirectIfSignedOut(await fetch('br-indices.php', { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body || !body.series) throw new Error(`The dashboard server answered HTTP ${response.status}.`);
        const errors = Array.isArray(body.errors) ? body.errors : [];
        state.brIndices = {
            status: errors.length ? 'partial' : 'ready',
            series: body.series,
            latest: body.latest || {},
            stale: body.stale || [],
            error: errors.join(' · ') || null,
        };
    } catch (error) {
        state.brIndices = { status: 'error', series: {}, latest: {}, stale: [], error: error.message };
    }
    renderLate();
}

function renderIndexNote() {
    const node = $('#late-index-note');
    if (!node) return;
    const info = state.brIndices;
    let text = '';
    let tone = 'muted';
    if (info.status === 'loading') text = 'Loading IGP-M and IPCA from the Central Bank…';
    else if (info.status === 'error') { text = `Brazil inflation correction is not applied: ${info.error}`; tone = 'error'; }
    else {
        const published = Object.keys(INDEX_LABELS)
            .map((key) => (info.latest[key] ? `${INDEX_LABELS[key]} through ${monthLabel(monthFromKey(info.latest[key]))}` : null))
            .filter(Boolean);
        text = `Brazil correction uses the higher of IGP-M and IPCA (Central Bank). Published: ${published.join(', ')}. Months not yet published count as zero.`;
        if (info.stale.length) { text += ` Could not refresh ${info.stale.map((key) => INDEX_LABELS[key]).join(' and ')}, showing the last saved values.`; tone = 'sample'; }
        if (info.error) { text += ` ${info.error}`; tone = 'error'; }
    }
    node.textContent = text;
    node.dataset.tone = tone;
}

function correctionCell(item) {
    if (!item.hasCorrection) return DASH;
    if (item.correctionUnavailable && !item.correctionIndex) return `${DASH}<div class="client-sub">index unavailable</div>`;
    const notes = [item.correctionIndex || 'no inflation'];
    if (item.correctionPending) notes.push('partial');
    return `${moneyExact(item.correction)}<div class="client-sub">${escapeHtml(notes.join(' · '))}</div>`;
}

function barRows(rows) {
    const max = Math.max(...rows.map((row) => row.total), 1);
    return rows.map((row) => `<div class="market-row${row.dimmed ? ' is-dimmed' : ''}">
        <span class="market-name">${escapeHtml(row.label)}<small class="market-sub">${plural(row.count, 'invoice')}</small></span>
        <div class="market-bar"><span style="width:${(row.total / max) * 100}%"></span></div>
        <span class="market-value">${money(row.total)}</span>
    </div>`).join('');
}

function renderLate() {
    if (!$('#late-view')) return;
    const items = lateInvoices();
    const sum = (list, field) => list.reduce((total, item) => total + item[field], 0);
    const principal = sum(items, 'balance');
    const fees = sum(items, 'fee');
    const interest = sum(items, 'interest');
    const correction = sum(items, 'correction');
    const clients = new Set(items.map((item) => contactKey(item.invoice))).size;

    setText('#late-principal', money(principal));
    setText('#late-invoice-count', plural(items.length, 'invoice'));
    setText('#late-client-count', `from ${plural(clients, 'client')}`);
    setText('#late-charges', money(fees + interest + correction));
    setText('#late-fees', `${money(fees)} fees + ${money(interest)} interest`);
    setText('#late-correction', `+ ${money(correction)} correction`);
    setText('#late-total-due', money(principal + fees + interest + correction));
    renderIndexNote();

    const markets = state.scope === 'all' ? Object.keys(companyLabels) : [state.scope];
    const labels = [...new Set(markets.map((key) => lateRuleLabel(lateRule(key))))];
    setText('#late-rate-label', labels.length === 1 ? labels[0] : 'Per-market rates');
    renderLateRulesPanel(items);

    const averageDays = principal > 0 ? Math.round(items.reduce((total, item) => total + item.days * item.balance, 0) / principal) : 0;
    setText('#late-average-days', items.length ? plural(averageDays, 'day') : DASH);
    setText('#late-oldest', items.length ? plural(items[0].days, 'day') : DASH);

    $('#late-aging').innerHTML = barRows(AGING_BUCKETS.map((bucket) => {
        const rows = items.filter((item) => item.days >= bucket.min && item.days <= bucket.max);
        return { label: bucket.label, count: rows.length, total: sum(rows, 'total') };
    }));

    const allMarkets = lateInvoicesByMarket(items);
    $('#late-markets').innerHTML = barRows(Object.entries(companyLabels).map(([key, label]) => ({
        label,
        count: allMarkets[key]?.count || 0,
        total: allMarkets[key]?.total || 0,
        dimmed: state.scope !== 'all' && state.scope !== key,
    })));

    setText('#late-table-summary', `${number(items.length)} record${items.length === 1 ? '' : 's'}`);
    $('#late-table').closest('table').classList.toggle('shows-service', state.category === 'others');
    $('#late-table').innerHTML = items.map((item) => {
        const { invoice } = item;
        const severity = item.days > 90 ? 'is-critical' : item.days > 30 ? 'is-warning' : '';
        const original = originalBalance(invoice);
        const rule = lateRule(invoice.companyKey);
        const graceNote = rule.source === 'unset'
            ? '<div class="client-sub">rate not set</div>'
            : item.days <= rule.graceDays ? '<div class="client-sub">in grace period</div>' : '';
        return `<tr>
            <td>${escapeHtml(invoice.Contact?.Name || 'Unknown client')}<div class="client-sub">${escapeHtml(invoice.InvoiceNumber || invoice.InvoiceID || 'Unnumbered')}${categoryTag(invoice) ? ` · <span class="category-tag">${escapeHtml(categoryTag(invoice))}</span>` : ''}</div></td>
            ${otherServiceCell(invoice)}
            <td>${escapeHtml(companyLabels[invoice.companyKey] || invoice.company || DASH)}</td>
            <td>${shortDate(invoiceDate(invoice))}</td>
            <td>${shortDate(item.due)}</td>
            <td class="align-right"><span class="days-pill ${severity}">${number(item.days)}</span></td>
            <td class="align-right mono">${moneyExact(item.balance)}${original ? `<div class="client-sub">${escapeHtml(original)}</div>` : ''}</td>
            <td class="align-right mono">${correctionCell(item)}</td>
            <td class="align-right mono">${moneyExact(item.fee)}${graceNote}</td>
            <td class="align-right mono">${moneyExact(item.interest)}</td>
            <td class="align-right mono late-total">${moneyExact(item.total)}</td>
        </tr>`;
    }).join('');

    const empty = $('#late-table-empty');
    empty.textContent = !state.invoices.length && state.sync.phase === 'loading'
        ? 'Loading invoices…'
        : !state.invoices.length && state.sync.phase === 'failed'
            ? 'Could not load invoices.'
            : 'No overdue invoices for this market and service.';
    empty.classList.toggle('is-hidden', items.length > 0);
}

function lateInvoicesByMarket(itemsInView) {
    if (state.scope === 'all') {
        return itemsInView.reduce((map, item) => {
            const entry = map[item.invoice.companyKey] || (map[item.invoice.companyKey] = { count: 0, total: 0 });
            entry.count += 1;
            entry.total += item.total;
            return map;
        }, {});
    }
    return withView('all', state.category, () => lateInvoicesByMarket(lateInvoices()));
}

const rulesForm = $('#rules-form');
const rulesModal = $('#rules-modal');

async function lateRulesRequest(options = {}) {
    const response = redirectIfSignedOut(await fetch(LATE_RULES_ENDPOINT, { cache: 'no-store', ...options }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `The server answered HTTP ${response.status}.`);
    return body;
}

function storeLateRules(rules) {
    state.lateRules = {};
    (rules || []).forEach((rule) => {
        if (EDITABLE_RULE_SCOPES.includes(rule.scope)) state.lateRules[rule.scope] = rule;
    });
}

async function loadLateRules() {
    state.lateRulesStatus = 'loading';
    try {
        const { rules } = await lateRulesRequest();
        storeLateRules(rules);
        state.lateRulesStatus = 'ready';
    } catch (error) {
        state.lateRulesStatus = 'error';
        state.lateRulesError = error.message;
    }
    renderLate();
}

function renderLateRulesPanel(items) {
    const summary = $('#late-rules-summary');
    const status = $('#late-rules-status');
    if (!summary || !status) return;

    summary.innerHTML = Object.entries(companyLabels).map(([key, label]) => {
        const rule = lateRule(key);
        const dimmed = state.scope !== 'all' && state.scope !== key;
        return `<div class="rules-chip${rule.source === 'unset' ? ' is-unset' : ''}${dimmed ? ' is-dimmed' : ''}">
            <span>${escapeHtml(label)}</span><strong>${escapeHtml(lateRuleLabel(rule))}</strong>
        </div>`;
    }).join('');

    if (state.lateRulesStatus === 'loading') { status.textContent = 'Loading saved rates…'; status.dataset.tone = 'muted'; return; }
    if (state.lateRulesStatus === 'error') {
        status.textContent = `Could not load the saved rates, so only Brazil has charges applied: ${state.lateRulesError}`;
        status.dataset.tone = 'error';
        return;
    }
    const unset = EDITABLE_RULE_SCOPES.filter((key) => !state.lateRules[key]);
    const affected = unset.filter((key) => items.some((item) => item.invoice.companyKey === key));
    if (affected.length) {
        status.textContent = `No rate saved for ${affected.map((key) => companyLabels[key]).join(', ')}: their overdue invoices show no charges until you set one.`;
        status.dataset.tone = 'sample';
        return;
    }
    const latest = Object.values(state.lateRules).sort((a, b) => String(b.enteredAt).localeCompare(String(a.enteredAt)))[0];
    status.textContent = latest
        ? `Last changed ${new Date(latest.enteredAt).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${latest.updatedBy ? ` by ${latest.updatedBy}` : ''}.`
        : 'Brazil follows its contract rule. Set the rates for the other markets.';
    status.dataset.tone = latest ? 'manual' : 'muted';
}

const percentField = (value) => (hasValue(value) ? String(Number((Number(value) * 100).toFixed(4))) : '');

function showRulesError(message, field) {
    const node = $('#rules-form-error');
    rulesForm.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
    node.hidden = !message;
    node.textContent = message || '';
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}

function openRulesModal() {
    if (!CAN_MANUAL_INPUTS) return;
    rulesForm.reset();
    showRulesError('');
    EDITABLE_RULE_SCOPES.forEach((key) => {
        const rule = state.lateRules[key];
        rulesForm.elements[`${key}-lateFee`].value = rule ? percentField(rule.lateFee) : '';
        rulesForm.elements[`${key}-monthlyInterest`].value = rule ? percentField(rule.monthlyInterest) : '';
        rulesForm.elements[`${key}-graceDays`].value = rule ? String(rule.graceDays) : '';
    });
    const latest = Object.values(state.lateRules).sort((a, b) => String(b.enteredAt).localeCompare(String(a.enteredAt)))[0];
    setText('#rules-form-meta', latest
        ? `Last saved ${new Date(latest.enteredAt).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${latest.updatedBy ? ` by ${latest.updatedBy}` : ''}. A blank field counts as zero.`
        : 'Nothing saved yet. A blank field counts as zero.');
    rulesModal.showModal();
    rulesForm.elements['mx-lateFee'].focus();
}

function closeRulesModal() { rulesModal.close(); $('#open-rules-modal').focus(); }

function readRulesForm() {
    const rules = [];
    for (const key of EDITABLE_RULE_SCOPES) {
        const market = companyLabels[key];
        const read = (name, label, { max, whole = false }) => {
            const input = rulesForm.elements[`${key}-${name}`];
            if (input.value.trim() === '') {
                if (input.validity.badInput) { showRulesError(`${market}: ${label} is not a valid number.`, input); return undefined; }
                return 0;
            }
            const value = Number(input.value);
            if (!Number.isFinite(value)) { showRulesError(`${market}: ${label} is not a valid number.`, input); return undefined; }
            if (value < 0 || value > max) { showRulesError(`${market}: ${label} must be between 0 and ${max}${whole ? ' days' : '%'}.`, input); return undefined; }
            if (whole && !Number.isInteger(value)) { showRulesError(`${market}: ${label} must be a whole number of days.`, input); return undefined; }
            return value;
        };
        const lateFee = read('lateFee', 'late fee', { max: 100 });
        if (lateFee === undefined) return null;
        const monthlyInterest = read('monthlyInterest', 'monthly interest', { max: 100 });
        if (monthlyInterest === undefined) return null;
        const graceDays = read('graceDays', 'grace period', { max: 365, whole: true });
        if (graceDays === undefined) return null;
        rules.push({ scope: key, lateFee: lateFee / 100, monthlyInterest: monthlyInterest / 100, graceDays });
    }
    return rules;
}

if (rulesForm) {
    $('#open-rules-modal').addEventListener('click', openRulesModal);
    rulesModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeRulesModal));
    rulesModal.addEventListener('click', (event) => { if (event.target === rulesModal) closeRulesModal(); });
    rulesForm.addEventListener('input', () => { if (!$('#rules-form-error').hidden) showRulesError(''); });

    rulesForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const rules = readRulesForm();
        if (!rules) return;
        const submit = $('#rules-form-submit');
        const label = submit.textContent;
        submit.disabled = true;
        submit.textContent = 'Saving…';
        try {
            const body = await lateRulesRequest({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rules }),
            });
            storeLateRules(body.rules);
            state.lateRulesStatus = 'ready';
            closeRulesModal();
            renderLate();
        } catch (error) {
            showRulesError(error.message || 'Could not save the rates.');
        } finally {
            submit.disabled = false;
            submit.textContent = label;
        }
    });
}