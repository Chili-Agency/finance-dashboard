function renderRetentionSection() {
    const data = state.scorecard.retention || {};
    const meta = state.scorecardMeta || {};
    const retained = hasValue(data.retained)
        ? Number(data.retained)
        : hasValue(data.initialPortfolio) && hasValue(data.churned)
            ? Number(data.initialPortfolio) - Number(data.churned)
            : null;
    const onboardingNote = meta.onboardingInBase > 0.005 ? ` · ${money(meta.onboardingInBase)} of onboarding fees left out` : '';
    const baseHint = `${meta.previousLabel ? `Final portfolio of ${meta.previousLabel}` : 'Final portfolio of the previous month'}${onboardingNote}`;
    const summed = !meta.latestOnly && meta.retentionMonths > 1;
    const churnRate = hasValue(data.churnRate) ? data.churnRate : share(data.churned, data.initialPortfolio);
    const expansionRate = hasValue(data.expansionRate) ? data.expansionRate : share(data.upsells, data.initialPortfolio);

    setText('#ret-initial', moneyOr(data.initialPortfolio));
    setText('#ret-churned', moneyOr(data.churned));
    setText('#ret-upsells', moneyOr(data.upsells));
    setText('#ret-clients', hasValue(data.activeClients) ? number(data.activeClients) : DASH);
    setText('#ret-churn-rate', percentOr(churnRate));
    setText('#ret-churn-rate-label', summed ? 'of the base per month' : 'of the initial base');
    setText('#ret-expansion-rate', percentOr(expansionRate));
    setText('#ret-expansion-rate-label', summed ? 'expansion per month' : 'expansion');
    setText('#ret-initial-note', baseHint);
    setText('#ret-clients-note', meta.invoiceCount ? `${plural(meta.invoiceCount, 'invoice')} in the period` : 'No invoices in the period');
    setText('#ret-churn-note', meta.lostClients ? `${plural(meta.lostClients, 'client')} stopped billing` : 'No client stopped billing');
    setText('#ret-upsell-note', upsellNote(meta));
    const churnScope = $('#ret-churn-scope');
    if (churnScope) {
        churnScope.hidden = !meta.latestOnly && !summed;
        churnScope.textContent = meta.latestOnly
            ? `Latest month only: ${meta.currentLabel} vs ${meta.previousLabel}${meta.hiddenDowngrades ? ` · downgrades listed when ${meta.hiddenDowngrades.month} is selected` : ''}`
            : summed ? `Summed month by month, ${plural(meta.retentionMonths, 'month')} through ${meta.retentionEndLabel}` : '';
    }
    const churnLink = $('#open-churn-modal');
    if (churnLink) {
        const count = hasValue(data.churned) && Array.isArray(meta.churnedClients) ? new Set(meta.churnedClients.map((item) => item.key)).size : 0;
        churnLink.hidden = count === 0;
        churnLink.firstChild.textContent = `See ${plural(count, 'client')} `;
    }

    const rows = [
        { label: 'Initial portfolio value', hint: baseHint, value: data.initialPortfolio, tone: '', signed: false },
        { label: 'Churned value', hint: 'Lost clients and downgrades', value: hasValue(data.churned) ? -Number(data.churned) : null, tone: 'is-negative', signed: true },
        { label: 'Retained portfolio', hint: 'Initial portfolio minus churn', value: retained, tone: 'is-total', signed: false },
        { label: 'Upsells & cross-sells', hint: `${meta.taggedUpsell > 0 ? `${money(meta.taggedUpsell)} tagged in Xero · ` : ''}not counted in retention`, value: data.upsells, tone: 'is-positive', signed: true },
    ];
    const max = Math.max(...rows.map((row) => Math.abs(Number(row.value) || 0)), 1);

    $('#retention-waterfall').innerHTML = rows.map((row) => `
        <div class="waterfall-row ${row.tone}">
            <div class="waterfall-label">${escapeHtml(row.label)}<span class="waterfall-hint">${escapeHtml(row.hint)}</span></div>
            <div class="waterfall-bar"><span style="width:${(Math.abs(Number(row.value) || 0) / max) * 100}%"></span></div>
            <div class="waterfall-value">${row.signed ? signedMoney(row.value) : moneyOr(row.value)}</div>
        </div>
    `).join('');

    const retentionRate = hasValue(data.rate) ? data.rate : share(retained, data.initialPortfolio);
    const netRate = hasValue(data.netRate) ? data.netRate : hasValue(retained) ? share(retained + Number(data.upsells || 0), data.initialPortfolio) : null;
    const monthly = Array.isArray(meta.retentionMonthly) ? meta.retentionMonthly : [];
    const note = !hasValue(retentionRate)
        ? 'Needs billing in the previous month to compare.'
        : summed && monthly.length > 1
            ? `Average of ${plural(monthly.length, 'month')}, each against the month before, weighted by its base: ${monthly.map((row) => `${row.label} ${percentOr(row.rate)}`).join(' · ')}. With upsells: ${percentOr(netRate)}.`
            : `${moneyOr(retained)} kept of the ${moneyOr(data.initialPortfolio)} ${meta.previousLabel ? `${meta.previousLabel} ` : ''}portfolio after ${moneyOr(data.churned)} churned. With upsells: ${percentOr(netRate)}.`;
    $('#retention-target').innerHTML = targetBlock({
        caption: summed ? 'Retention (existing), monthly avg.' : 'Retention (existing)',
        value: retentionRate,
        target: data.target,
        format: 'percent',
        naLabel: 'N/A',
        note,
    });
}

function upsellNote(meta) {
    const parts = [];
    if (meta.taggedUpsell > 0) parts.push(`${money(meta.taggedUpsell)} tagged in Xero`);
    if (meta.crossSells > 0) parts.push(`${plural(meta.crossSells, 'new service line')} on existing clients`);
    if (meta.upsellOutsideBase > 0) parts.push(`${plural(meta.upsellOutsideBase, 'upsell invoice')} for clients not billed in ${meta.previousLabel || 'the previous period'}`);
    return parts.length ? parts.join(' · ') : 'Measured by value change';
}

const SERVICE_LINE_LABELS = { ...categoryLabels, other: 'Unclassified' };

const churnModal = $('#churn-modal');

function renderChurnModal() {
    const meta = state.scorecardMeta || {};
    const events = Array.isArray(meta.churnedClients) ? meta.churnedClients : [];
    const total = events.reduce((sum, item) => sum + item.churned, 0);
    const clientCount = new Set(events.map((item) => item.key)).size;
    const lost = events.filter((item) => item.lost).length;
    const downgrades = events.length - lost;
    const previous = meta.previousLabel || 'Previous period';
    const window = meta.currentWindow;
    const current = meta.retentionEndLabel
        || (window && isCalendarMonth(window.start, window.end) ? monthLabel(window.start) : meta.currentLabel || 'Selected period');
    const summed = !meta.latestOnly && meta.retentionMonths > 1;

    setText('#churn-modal-context', `${state.scope === 'all' ? 'Global' : companyLabels[state.scope]} · ${serviceName(state.category)} · ${summed ? `${meta.retentionMonths} months through ${current}` : `${current} against ${previous}`}`);
    const hidden = meta.hiddenDowngrades;
    setText('#churn-modal-summary', [
        events.length
            ? `${plural(clientCount, 'client')} · ${money(total)} churned · ${plural(lost, 'client')} lost, ${plural(downgrades, 'downgrade')}`
            : 'No client lost value in this period.',
        hidden ? `${plural(hidden.count, 'downgrade')} (${money(hidden.value)}) from ${hidden.month} not listed: select ${hidden.month} in Reporting period to see them.` : '',
        meta.setupClients
            ? `${plural(meta.setupClients, 'new client')} still in the first ${SETUP_MONTHS + 1} months ${meta.setupClients === 1 ? 'is' : 'are'} left out: changes while a contract is being set up (onboarding fee, services phased in, prepaid months) are not churn.`
            : '',
    ].filter(Boolean).join(' '));
    setText('#churn-col-previous', summed ? 'Month before' : previous);
    setText('#churn-col-current', summed ? 'That month' : current);

    const scopeNote = $('#churn-modal-scope');
    scopeNote.hidden = !meta.latestOnly && !summed;
    scopeNote.textContent = meta.latestOnly
        ? `“${periodBounds().label}” has no earlier period to compare against, so this list compares the latest month with invoices (${current}) with the month before it (${previous}). Pick a month or range in Reporting period to see other months.`
        : summed
            ? `Each row is one drop, in the month it happened, against the month before it. A client can appear more than once (a downgrade in one month, lost in another).`
            : '';

    $('#churn-table').innerHTML = events.map((item) => {
        const lines = item.lines.map((line) => SERVICE_LINE_LABELS[line] || line).join(' + ');
        const when = item.lost && item.returned ? `Billing again in ${current}` : '';
        return `<tr>
            <td>${escapeHtml(item.name)}<span class="entry-sub">Last invoice ${escapeHtml(shortDate(item.lastDate))}</span></td>
            <td>${escapeHtml(companyLabels[item.companyKey] || DASH)}</td>
            <td>${escapeHtml(monthLabel(monthFromKey(item.month)))}</td>
            <td>${escapeHtml(lines || DASH)}</td>
            <td class="align-right mono">${money(item.before)}</td>
            <td class="align-right mono">${money(item.after)}</td>
            <td class="align-right mono"><span class="value-down">${signedMoney(-item.churned)}</span></td>
            <td><span class="status-pill ${item.lost ? 'is-lost' : 'is-downgrade'}">${item.lost ? 'Lost' : 'Downgrade'}</span>${when ? `<span class="entry-sub">${escapeHtml(when)}</span>` : ''}</td>
        </tr>`;
    }).join('');
    $('#churn-table-empty').classList.toggle('is-hidden', events.length > 0);
    const foot = $('#churn-table-total');
    foot.classList.toggle('is-hidden', events.length === 0);
    setText('#churn-total-value', signedMoney(-total));
}

function openChurnModal() {
    renderChurnModal();
    churnModal.showModal();
}

function closeChurnModal() {
    churnModal.close();
    $('#open-churn-modal').focus();
}

if (churnModal) {
    $('#open-churn-modal').addEventListener('click', openChurnModal);
    churnModal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeChurnModal));
    churnModal.addEventListener('click', (event) => { if (event.target === churnModal) closeChurnModal(); });
}