const SEO_ENDPOINT = 'seo.php';
const SEO_NPS_MIN_RESPONSE = 0.8;
const SEO_CLIENT_ROWS = 6;
const SEO_EVENT_ROWS = 6;
const SEO_MOVERS = 3;
const SEO_DEFAULT_GOALS = { kwPage1: 400, pagespeed: 80, drDelta: 2 };
const SEO_MOCK = {
    month: null,
    goals: SEO_DEFAULT_GOALS,
    clients: [
        { name: 'Pulsar', kwTotal: 60, kwPage1: 14, kwPrev: 11, pagespeed: 62, drStart: 31, drEnd: 33 },
        { name: 'Schneider Electric', kwTotal: 120, kwPage1: 71, kwPrev: 68, pagespeed: 84, drStart: 78, drEnd: 78 },
        { name: 'Dportenis', kwTotal: 80, kwPage1: 41, kwPrev: 36, pagespeed: 71, drStart: 52, drEnd: 54 },
        { name: 'Diunsa', kwTotal: 70, kwPage1: 29, kwPrev: 30, pagespeed: 58, drStart: 44, drEnd: 45 },
        { name: 'Mapei', kwTotal: 50, kwPage1: 18, kwPrev: 15, pagespeed: 88, drStart: 47, drEnd: 50 },
        { name: 'Virbac', kwTotal: 40, kwPage1: 9, kwPrev: 10, pagespeed: 76, drStart: 39, drEnd: 39 },
        { name: 'Multinational PR', kwTotal: 35, kwPage1: 17, kwPrev: 13, pagespeed: 91, drStart: 22, drEnd: 25 },
        { name: 'Salesforge', kwTotal: 60, kwPage1: 22, kwPrev: 18, pagespeed: 93, drStart: 35, drEnd: 38 },
        { name: 'Sacflow', kwTotal: 30, kwPage1: 4, kwPrev: 2, pagespeed: 69, drStart: 18, drEnd: 21 },
        { name: 'Nexyun', kwTotal: 45, kwPage1: 8, kwPrev: 6, pagespeed: 82, drStart: 15, drEnd: 16 },
        { name: 'ECX Pay', kwTotal: 50, kwPage1: 6, kwPrev: 3, pagespeed: 74, drStart: 12, drEnd: 15 },
        { name: 'Joico', kwTotal: 40, kwPage1: 19, kwPrev: 19, pagespeed: 86, drStart: 41, drEnd: 42 },
    ],
};

state.seo = { status: 'loading', data: null, errors: [], warnings: [], fetchedAt: null };
state.seoView = { allClients: false };

async function loadSeo() {
    state.seo = { ...state.seo, status: 'loading' };
    renderSeo();
    try {
        const response = redirectIfSignedOut(await fetch(SEO_ENDPOINT, { cache: 'no-store' }));
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server answered HTTP ${response.status}.`);
        if (body.configured === false) {
            state.seo = { status: 'off', data: null, errors: body.errors || [], warnings: [], fetchedAt: null };
        } else if (!response.ok) {
            throw new Error((body.errors || []).join(' · ') || `The server answered HTTP ${response.status}.`);
        } else {
            state.seo = {
                status: 'ready',
                data: { month: body.month || null, goals: { ...SEO_DEFAULT_GOALS, ...(body.goals || {}) }, clients: body.clients || [] },
                errors: body.errors || [],
                warnings: body.warnings || [],
                fetchedAt: body.fetchedAt || null,
            };
        }
    } catch (error) {
        state.seo = { status: 'error', data: null, errors: [error.message], warnings: [], fetchedAt: null };
    }
    renderSeo();
}

function seoScorecard() {
    const saved = { category: state.category, scorecard: state.scorecard, meta: state.scorecardMeta };
    state.category = 'seo';
    try {
        buildScorecard();
        return { scorecard: state.scorecard, meta: state.scorecardMeta };
    } finally {
        state.category = saved.category;
        state.scorecard = saved.scorecard;
        state.scorecardMeta = saved.meta;
    }
}

function seoNps(meta) {
    const span = meta.currentWindow;
    if (!span) return null;
    const active = new Map();
    state.invoices.forEach((invoice) => {
        if (!isBillable(invoice) || (state.scope !== 'all' && invoice.companyKey !== state.scope) || categoryShare(invoice, 'seo') <= 0) return;
        if (!inWindow(invoiceDate(invoice), span)) return;
        const key = normalizeClientName(invoice.Contact?.Name);
        if (key && !active.has(key)) active.set(key, invoice.Contact?.Name || 'Unnamed client');
    });
    const index = state.clients.status === 'ready' ? hubspotIndex() : null;
    const scores = [];
    if (index) {
        active.forEach((name, key) => {
            const answers = (index.get(key)?.nps || [])
                .filter((row) => hasValue(row.score) && inWindow(clientDay(row.at), span))
                .sort((a, b) => String(b.at).localeCompare(String(a.at)));
            if (answers.length) scores.push({ name, score: Number(answers[0].score), at: answers[0].at });
        });
    }
    const promoters = scores.filter((item) => item.score >= 9).length;
    const detractors = scores.filter((item) => item.score <= 6).length;
    return {
        ready: Boolean(index),
        active: active.size,
        scores: scores.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)),
        rate: active.size ? scores.length / active.size : null,
        average: scores.length ? scores.reduce((sum, item) => sum + item.score, 0) / scores.length : null,
        nps: scores.length ? Math.round(((promoters - detractors) / scores.length) * 100) : null,
    };
}

function seoProgress({ caption, value, percent, complete, left, right }) {
    return `
        ${caption ? `<span class="target-caption">${escapeHtml(caption)}</span>` : ''}
        ${value ? `<span class="target-value">${value}</span>` : ''}
        <div class="target-track"><span class="target-fill${complete ? ' is-complete' : ''}" style="width:${clampPercent(percent || 0)}%"></span></div>
        <div class="target-scale"><span>${left}</span><span>${right}</span></div>
    `;
}

function renderSeoSources() {
    const node = $('#seo-sources-note');
    if (!node) return;
    const seo = state.seo;
    let tone = 'muted';
    let kpis;
    if (seo.status === 'loading') kpis = 'Loading SEO KPIs…';
    else if (seo.status === 'off') { kpis = 'Keywords, PageSpeed and DR show example data until N8N_WEBHOOK_SEO is set in the .env with the webhook of the n8n workflow.'; tone = 'sample'; }
    else if (seo.status === 'error') { kpis = `Could not load the SEO KPIs: ${seo.errors.join(' · ')}`; tone = 'error'; }
    else {
        kpis = `SEO KPIs: ${plural(seo.data.clients.length, 'client')}${seo.data.month ? ` for ${monthLabel(monthFromKey(seo.data.month))}` : ''}${seo.fetchedAt ? `, fetched ${relativeTime(new Date(seo.fetchedAt).getTime())}` : ''}.`;
        const extra = [...seo.errors, ...seo.warnings];
        if (extra.length) { kpis += ` ${extra.join(' · ')}`; tone = 'sample'; }
    }
    const nps = state.clients.status === 'off' ? ' NPS is not connected: set N8N_WEBHOOK_CLIENTS in the .env.' : state.clients.status === 'error' ? ' NPS could not be loaded.' : '';
    node.dataset.tone = tone;
    node.textContent = `${state.invoices.length ? `Xero: ${plural(state.invoices.filter(isBillable).length, 'invoice')}.` : 'Loading Xero invoices…'} ${kpis}${nps}`;
}

function renderSeoFinance() {
    const { scorecard, meta } = seoScorecard();
    const retention = scorecard.retention || {};
    const totalMrr = scorecard.totalMrr || {};
    const newBusiness = scorecard.newBusiness || {};
    const churnTarget = hasValue(retention.target) ? 1 - Number(retention.target) : null;
    const gap = hasValue(totalMrr.actual) && hasValue(totalMrr.target) ? Number(totalMrr.target) - Number(totalMrr.actual) : null;
    const recovered = hasValue(retention.upsells) && Number(retention.churned) > 0 ? Number(retention.upsells) / Number(retention.churned) : null;
    const nps = seoNps(meta);

    setText('#seo-mrr', moneyOr(totalMrr.actual));
    setText('#seo-mrr-note', hasValue(totalMrr.target) ? `${percentOr(share(totalMrr.actual, totalMrr.target))} of the ${moneyOr(totalMrr.target)} target` : 'No Total MRR target set for this period');
    setText('#seo-gap', hasValue(gap) ? (gap <= 0 ? 'Target met' : moneyOr(gap)) : DASH);
    setText('#seo-gap-note', hasValue(totalMrr.target) ? `Target ${moneyOr(totalMrr.target)}` : 'Set the Target MRR in Targets');
    setText('#seo-churn', percentOr(retention.churnRate));
    setText('#seo-churn-note', hasValue(churnTarget) ? `Target ≤ ${percentOr(churnTarget)} · ${moneyOr(retention.churned)} lost` : `${moneyOr(retention.churned)} lost`);
    setText('#seo-recovered', hasValue(recovered) ? percentOr(Math.min(1, recovered), 0) : DASH);
    setText('#seo-recovered-note', 'Upsells and cross-sells against churned value');
    setText('#seo-nps-rate', nps && hasValue(nps.rate) ? percentOr(nps.rate, 0) : DASH);
    setText('#seo-nps-rate-note', nps && nps.ready ? `${nps.scores.length} of ${nps.active} clients answered · minimum ${percentOr(SEO_NPS_MIN_RESPONSE, 0)}` : 'Waiting for HubSpot NPS');
    setText('#seo-period-note', meta.currentLabel ? `${meta.currentLabel}${meta.latestOnly ? ' (latest month with invoices)' : ''}` : 'No SEO invoices yet');

    const rows = [
        { label: 'Initial portfolio', hint: meta.previousLabel ? `Final portfolio of ${meta.previousLabel}` : 'Previous month', value: retention.initialPortfolio, tone: '', signed: false },
        { label: 'New business', hint: 'Clients billing for the first time', value: newBusiness.actual, tone: 'is-positive', signed: true },
        { label: 'Upsells & cross-sells', hint: 'Expansion on existing clients', value: retention.upsells, tone: 'is-positive', signed: true },
        { label: 'Churn', hint: 'Clients that stopped billing', value: hasValue(retention.lost) ? -Number(retention.lost) : null, tone: 'is-negative', signed: true },
        { label: 'Downgrades & service changes', hint: 'Clients still billing, but less', value: hasValue(retention.contraction) ? -Number(retention.contraction) : null, tone: 'is-negative', signed: true },
        { label: 'Total MRR', hint: 'SEO share of the month', value: totalMrr.actual, tone: 'is-total', signed: false },
    ];
    const max = Math.max(...rows.map((row) => Math.abs(Number(row.value) || 0)), 1);
    $('#seo-waterfall').innerHTML = rows.map((row) => `
        <div class="waterfall-row ${row.tone}">
            <div class="waterfall-label">${escapeHtml(row.label)}<span class="waterfall-hint">${escapeHtml(row.hint)}</span></div>
            <div class="waterfall-bar"><span style="width:${(Math.abs(Number(row.value) || 0) / max) * 100}%"></span></div>
            <div class="waterfall-value">${row.signed ? signedMoney(row.value) : moneyOr(row.value)}</div>
        </div>
    `).join('');

    $('#seo-mrr-target').innerHTML = targetBlock({
        caption: 'SEO Total MRR',
        targetLabel: 'Target MRR',
        value: totalMrr.actual,
        target: totalMrr.target,
        note: hasValue(totalMrr.target) ? 'Target set for the SEO service line in Targets.' : 'Set the SEO Target MRR in Targets to track the gap.',
    });

    const churnGap = hasValue(retention.churnRate) && hasValue(churnTarget) ? Number(retention.churnRate) - churnTarget : null;
    $('#seo-churn-target').innerHTML = `${seoProgress({
        caption: 'Churn (lost + downgrades)',
        value: percentOr(retention.churnRate, 2),
        percent: hasValue(churnGap) && churnTarget > 0 ? (Number(retention.churnRate) / churnTarget) * 100 : 0,
        complete: hasValue(churnGap) && churnGap <= 0,
        left: hasValue(churnTarget) ? `Target <strong>≤ ${percentOr(churnTarget, 2)}</strong>` : 'No target set',
        right: hasValue(retention.churned) ? `Lost <strong>${moneyOr(retention.churned)}</strong>` : 'Needs billing in the previous month',
    })}<div class="target-foot">${deltaPill(churnGap, { lowerIsBetter: true, formatter: signedPoints })}<small>${hasValue(churnGap) ? (churnGap <= 0 ? 'Within the churn target.' : 'Above the churn target.') : 'No comparison yet.'}</small></div>`;

    const events = [...(meta.churnedClients || []), ...(meta.contractionClients || [])]
        .sort((a, b) => b.churned - a.churned)
        .slice(0, SEO_EVENT_ROWS);
    const total = (meta.churnedClients || []).length + (meta.contractionClients || []).length;
    $('#seo-churn-table').innerHTML = events.map((item) => {
        const pill = KIND_PILLS[item.kind] || KIND_PILLS[item.lost ? 'lost' : 'downgrade'];
        return `<tr>
            <td>${escapeHtml(item.name)}<span class="entry-sub">${escapeHtml(monthLabel(monthFromKey(item.month)))}</span></td>
            <td><span class="status-pill ${pill.cls}">${pill.label}</span></td>
            <td class="align-right mono"><span class="value-down">${signedMoney(-item.churned)}</span></td>
        </tr>`;
    }).join('');
    $('#seo-churn-empty').classList.toggle('is-hidden', events.length > 0);
    $('#seo-churn-empty').textContent = hasValue(retention.churned) ? 'No client was lost or downgraded in this period.' : 'Needs billing in the previous month to compare.';
    setText('#seo-churn-count', total > SEO_EVENT_ROWS ? `Top ${SEO_EVENT_ROWS} of ${total}` : plural(total, 'event'));

    const expansionShare = hasValue(recovered) ? recovered * 100 : 0;
    $('#seo-growth').innerHTML = seoProgress({
        caption: 'Lost revenue recovered',
        value: percentOr(hasValue(recovered) ? Math.min(1, recovered) : null, 0),
        percent: expansionShare,
        complete: hasValue(recovered) && recovered >= 1,
        left: `Upsells &amp; cross-sells <strong>${moneyOr(retention.upsells)}</strong>`,
        right: `Churned <strong>${moneyOr(retention.churned)}</strong>`,
    });
    setText('#seo-growth-detail', upsellNote(meta));

    renderSeoNps(nps);
}

function renderSeoNps(nps) {
    const rate = nps && hasValue(nps.rate) ? nps.rate : null;
    const counts = !nps || !nps.ready
        ? 'Waiting for HubSpot NPS'
        : `${nps.scores.length} of ${nps.active} clients answered · average ${hasValue(nps.average) ? nps.average.toFixed(1) : DASH}`;
    setText('#seo-nps-meta', counts);
    $('#seo-nps-score').textContent = nps && hasValue(nps.nps) ? number(nps.nps) : DASH;
    const counted = hasValue(rate) && rate >= SEO_NPS_MIN_RESPONSE;
    $('#seo-nps-gate').innerHTML = !nps || !nps.ready
        ? '<p class="manual-input-status" data-tone="muted">NPS needs the HubSpot client data.</p>'
        : counted
            ? `<p class="manual-input-status" data-tone="manual">Response rate is above the ${percentOr(SEO_NPS_MIN_RESPONSE, 0)} minimum: the NPS KPI counts.</p>`
            : `<p class="manual-input-status" data-tone="sample">Below ${percentOr(SEO_NPS_MIN_RESPONSE, 0)} of responses the NPS KPI does not count. Chase the missing answers.</p>`;
    const rows = nps ? nps.scores : [];
    $('#seo-nps-table').innerHTML = rows.map((item) => {
        const kind = npsCategory(item.score);
        return `<tr><td>${escapeHtml(item.name)}</td><td class="align-right mono">${number(item.score)}</td><td><span class="status-pill ${kind.pill}">${escapeHtml(kind.label)}</span></td><td>${escapeHtml(item.at || DASH)}</td></tr>`;
    }).join('');
    $('#seo-nps-empty').classList.toggle('is-hidden', rows.length > 0);
    $('#seo-nps-empty').textContent = nps && nps.ready ? 'No SEO client answered the NPS in this period.' : 'Waiting for HubSpot NPS.';
}

function renderSeoKpis() {
    const seo = state.seo;
    const example = seo.status === 'off';
    const source = seo.status === 'ready' ? seo.data : example ? SEO_MOCK : null;
    const ready = source !== null;
    const clients = ready ? source.clients : [];
    const goals = ready ? source.goals : SEO_DEFAULT_GOALS;
    const kwTotal = clients.reduce((sum, client) => sum + (Number(client.kwTotal) || 0), 0);
    const kwPage1 = clients.reduce((sum, client) => sum + (Number(client.kwPage1) || 0), 0);
    const kwPrev = clients.reduce((sum, client) => sum + (Number(client.kwPrev) || 0), 0);
    const scored = clients.filter((client) => hasValue(client.pagespeed));
    const passing = scored.filter((client) => client.pagespeed >= goals.pagespeed).length;
    const withDr = (list) => list.filter((client) => hasValue(client.drStart) && hasValue(client.drEnd));
    const drExample = ready && withDr(clients).length === 0;
    const ranked = drExample ? withDr(SEO_MOCK.clients) : withDr(clients);
    const growing = ranked.filter((client) => client.drEnd - client.drStart >= goals.drDelta).length;
    const movers = clients
        .filter((client) => hasValue(client.kwPage1) && hasValue(client.kwPrev))
        .map((client) => ({ name: client.name, delta: client.kwPage1 - client.kwPrev, value: client.kwPage1 }))
        .filter((item) => item.delta > 0)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, SEO_MOVERS);

    const blank = ready ? '' : DASH;
    const scope = $('#seo-kpi-scope');
    const monthName = seo.status === 'ready' && seo.data.month ? monthLabel(monthFromKey(seo.data.month)) : 'the current month';
    scope.dataset.tone = example ? 'sample' : 'muted';
    scope.textContent = seo.status === 'ready'
        ? `Keywords, PageSpeed and DR show ${monthName} up to yesterday, compared with the end of the previous month. They do not follow the reporting period above.`
        : example
            ? 'Example data. Once connected, keywords, PageSpeed and DR show the current month up to yesterday and do not follow the reporting period above.'
            : 'Keywords, PageSpeed and DR do not follow the reporting period above.';
    setText('#seo-kw', ready ? number(kwPage1) : blank);
    setText('#seo-kw-note', ready ? `${deltaText(kwPage1 - kwPrev)} vs previous month · of ${number(kwTotal)} ranking (${percentOr(share(kwPage1, kwTotal), 0)})` : 'Waiting for SEO KPIs');
    setText('#seo-kw-movers', movers.length ? `Top climbers: ${movers.map((item) => `${item.name} +${item.delta}`).join(' · ')}` : '');
    $('#seo-kw-progress').innerHTML = ready ? seoProgress({
        caption: '',
        value: '',
        percent: (kwPage1 / (goals.kwPage1 || 1)) * 100,
        complete: kwPage1 >= goals.kwPage1,
        left: `To goal <strong>${kwPage1 >= goals.kwPage1 ? 'Goal met' : number(goals.kwPage1 - kwPage1)}</strong>`,
        right: `Goal <strong>${number(goals.kwPage1)}</strong>`,
    }) : '';
    setText('#seo-ps', ready ? number(passing) : blank);
    setText('#seo-ps-note', ready ? `of ${plural(scored.length, 'site')} with PageSpeed ${goals.pagespeed} or more` : 'Waiting for SEO KPIs');
    setText('#seo-dr', ready ? number(growing) : blank);
    setText('#seo-dr-note', ready ? `${drExample ? 'Example data, DR is not connected yet · ' : ''}of ${plural(ranked.length, 'client')} gaining ${goals.drDelta}+ DR points in the month` : 'Waiting for SEO KPIs');

    const sorted = [...clients].sort((a, b) => (Number(b.kwPage1) || 0) - (Number(a.kwPage1) || 0) || a.name.localeCompare(b.name));
    const shown = state.seoView.allClients ? sorted : sorted.slice(0, SEO_CLIENT_ROWS);
    $('#seo-clients-table').innerHTML = shown.map((client) => {
        const climb = hasValue(client.kwPage1) && hasValue(client.kwPrev) ? client.kwPage1 - client.kwPrev : null;
        const drDelta = hasValue(client.drStart) && hasValue(client.drEnd) ? client.drEnd - client.drStart : null;
        const speedPill = hasValue(client.pagespeed)
            ? `<span class="status-pill${client.pagespeed >= goals.pagespeed ? '' : ' is-lost'}"${client.pagespeedAt ? ` title="Measured ${escapeHtml(client.pagespeedAt.slice(0, 10))}"` : ''}>${number(client.pagespeed)}</span>`
            : DASH;
        const drPill = hasValue(drDelta)
            ? `<span class="status-pill${drDelta >= goals.drDelta ? '' : ' is-lost'}">${drDelta > 0 ? '+' : ''}${number(drDelta)}</span>`
            : DASH;
        return `<tr>
            <td>${escapeHtml(client.name)}${client.domain ? `<span class="entry-sub">${escapeHtml(client.domain)}</span>` : ''}</td>
            <td class="align-right mono">${hasValue(client.kwPage1) ? number(client.kwPage1) : DASH} / ${hasValue(client.kwTotal) ? number(client.kwTotal) : DASH}</td>
            <td class="align-right">${deltaPill(climb, { formatter: (value) => (value > 0 ? '+' : value < 0 ? '−' : '') + number(Math.abs(value)) })}</td>
            <td class="align-right">${speedPill}</td>
            <td class="align-right mono">${hasValue(client.drStart) ? number(client.drStart) : DASH} → ${hasValue(client.drEnd) ? number(client.drEnd) : DASH}</td>
            <td class="align-right">${drPill}</td>
        </tr>`;
    }).join('');
    const emptyNote = $('#seo-clients-empty');
    emptyNote.classList.toggle('is-hidden', clients.length > 0);
    emptyNote.textContent = seo.status === 'loading' ? 'Loading SEO KPIs…' : seo.status === 'ready' ? 'The SEO workflow returned no clients.' : 'The SEO KPIs are not available (see the note at the top).';
    const toggle = $('#seo-clients-toggle');
    toggle.hidden = clients.length <= SEO_CLIENT_ROWS;
    toggle.textContent = state.seoView.allClients ? 'Show fewer clients' : `Show all ${clients.length} clients`;
    setText('#seo-clients-meta', clients.length ? `${plural(clients.length, 'client')}${example ? ' · example data' : ''}` : 'No data');
}

function deltaText(value) {
    return `${value > 0 ? '▲ +' : value < 0 ? '▼ −' : ''}${number(Math.abs(value))}`;
}

function renderSeo() {
    const view = $('#seo-view');
    if (!view || !view.classList.contains('is-visible')) return;
    renderSeoSources();
    if (!state.invoices.length) {
        setText('#seo-period-note', 'Loading invoices…');
    } else {
        renderSeoFinance();
    }
    renderSeoKpis();
}

$('#seo-clients-toggle')?.addEventListener('click', () => {
    state.seoView.allClients = !state.seoView.allClients;
    renderSeoKpis();
});
