const COGS_SHEET_ENDPOINT = 'cogs-sheet.php';
const COGS_SHEET_MAX_BYTES = 10 * 1024 * 1024;

// sources: the uploaded workbooks as read by the server; workbook: the COGS spreadsheet generated from them
const cogsSheet = { sources: [], notes: [], workbook: null, active: 0, busy: false, dirty: false, token: null };

const cogsSheetFileSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const cogsSheetPlural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function cogsSheetStatus(message, tone = 'muted') {
    const node = $('#cogs-sheet-status');
    node.textContent = message;
    node.dataset.tone = tone;
}

function cogsSheetError(message) {
    const node = $('#cogs-sheet-error');
    node.hidden = !message;
    node.textContent = message || '';
}

const cogsSheetFormat = {
    money: (value) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    pct: (value) => `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`,
};

function cogsSheetKind(style) {
    if (/^pct|^inputPct/.test(style)) return 'pct';
    if (/^money|^input$/.test(style)) return 'money';
    return 'text';
}

/** What a cell shows when it is not being edited. */
function cogsSheetDisplay(value, style) {
    if (value instanceof CogsModel.XlError) return value.code;
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number') {
        const kind = cogsSheetKind(style);
        return kind === 'pct' ? cogsSheetFormat.pct(value) : kind === 'money' ? cogsSheetFormat.money(value) : String(value);
    }
    return String(value);
}

/** What a cell holds when it is being edited: the formula, or the number as typed. */
function cogsSheetRaw(source, style) {
    if (source === null || source === undefined) return '';
    if (typeof source === 'number' && cogsSheetKind(style) === 'pct') return `${Math.round(source * 1e6) / 1e4}%`;
    return String(source);
}

function cogsSheetParse(text, style) {
    const value = text.trim();
    if (value === '') return null;
    if (value[0] === '=' && value.length > 1) return value;
    const pct = cogsSheetKind(style) === 'pct';
    const percent = value.match(/^(-?[\d.,]+)\s*%$/);
    const number = Number((percent ? percent[1] : value).replace(/,/g, ''));
    if (Number.isFinite(number) && /^-?[\d.,]+\s*%?$/.test(value)) {
        if (percent) return number / 100;
        return pct && Math.abs(number) > 1 ? number / 100 : number;
    }
    return value;
}

function renderCogsSheet() {
    const panel = $('#cogs-sheet-panel');
    const workbook = cogsSheet.workbook;
    panel.hidden = !workbook;
    if (!workbook) return;

    const lines = workbook.sheets[1].rows.slice(2).filter((row) => row[0]).length;
    setText('#cogs-sheet-file', 'Generated COGS spreadsheet');
    setText('#cogs-sheet-meta', `${cogsSheetPlural(cogsSheet.sources.length, 'file')} · ${cogsSheetPlural(lines, 'cost line')} · ${cogsSheet.sources.map((source) => `${source.fileName} (${cogsSheetFileSize(source.size)})`).join(', ')}`);

    $('#cogs-sheet-tabs').innerHTML = workbook.sheets
        .map((item, index) => `<button type="button" class="scope-tab${index === cogsSheet.active ? ' is-active' : ''}" role="tab" aria-selected="${index === cogsSheet.active}" data-sheet="${index}">${escapeHtml(item.name)}</button>`)
        .join('');

    const notes = [...cogsSheet.notes];
    const noteNode = $('#cogs-sheet-notes');
    noteNode.hidden = !notes.length;
    noteNode.innerHTML = notes.map((note) => `<p class="import-note is-warning">${escapeHtml(note)}</p>`).join('');

    const sheet = workbook.sheets[cogsSheet.active];
    const evaluator = CogsModel.evaluator(workbook);
    const width = Math.max(...sheet.rows.map((row) => row.length));
    const head = Array.from({ length: width }, (_, index) => `<th scope="col">${CogsModel.colName(index)}</th>`).join('');
    const body = sheet.rows
        .map((row, r) => {
            const cells = Array.from({ length: width }, (_, c) => {
                const style = sheet.style(r, c);
                const align = cogsSheetKind(style) === 'text' ? '' : ' align-right';
                const text = cogsSheetDisplay(evaluator.value(cogsSheet.active, r, c), style);
                return `<td class="cell-${style}${align}" contenteditable="true" spellcheck="false" data-r="${r}" data-c="${c}">${escapeHtml(text)}</td>`;
            }).join('');
            return `<tr><th scope="row">${r + 1}</th>${cells}</tr>`;
        })
        .join('');
    $('#cogs-sheet-table').innerHTML = `<thead><tr><th scope="col"></th>${head}</tr></thead><tbody>${body}</tbody>`;
}

/** Recalculates and refreshes every cell of the open tab except the one being edited. */
function refreshCogsSheetValues() {
    const sheet = cogsSheet.workbook.sheets[cogsSheet.active];
    const evaluator = CogsModel.evaluator(cogsSheet.workbook);
    const editing = document.activeElement;
    $('#cogs-sheet-table').querySelectorAll('td[data-r]').forEach((td) => {
        if (td === editing) return;
        const r = Number(td.dataset.r);
        const c = Number(td.dataset.c);
        const text = cogsSheetDisplay(evaluator.value(cogsSheet.active, r, c), sheet.style(r, c));
        if (td.textContent !== text) td.textContent = text;
    });
}

// Dashboard company keys → COGS entities
const COGS_SHEET_ENTITY_OF = { br: 'BR', int: 'DG', pa: 'PA', mx: 'MEX' };

/**
 * MRR per entity, service and month in BRL, from the dashboard invoices: the same mrrAmount() the Margin & COGS
 * view uses (USD), converted with the monthly BRL rate of fx-rates.php. Returns null when it cannot be built.
 */
function cogsSheetDashboardMrr(year) {
    const rates = state.fxBrlPerUsd || {};
    const known = Object.keys(rates).sort();
    if (!state.invoices.length || !known.length) return null;

    const rateFor = (key) => {
        if (rates[key]) return Number(rates[key]);
        const earlier = known.filter((month) => month < key).pop();
        return Number(rates[earlier || known[0]]);
    };
    const mrr = {};
    CogsModel.ENTITIES.forEach((entity) => { mrr[entity] = CogsModel.SERVICES.map(() => Array(12).fill(0)); });
    const services = ['seo', 'ppc', 'others'];
    const savedCategory = state.category;
    try {
        state.invoices.forEach((invoice) => {
            const entity = COGS_SHEET_ENTITY_OF[invoice.companyKey];
            const date = invoiceDate(invoice);
            if (!entity || !date || date.getFullYear() !== year || !isBillable(invoice)) return;
            const key = monthKey(date);
            services.forEach((service, index) => {
                state.category = service;
                if (!inCategory(invoice)) return;
                mrr[entity][index][date.getMonth()] += mrrAmount(invoice) * rateFor(key);
            });
        });
    } finally {
        state.category = savedCategory;
    }
    Object.values(mrr).forEach((byService) => byService.forEach((months) => months.forEach((value, i) => { months[i] = value ? Math.round(value * 100) / 100 : null; })));
    return mrr;
}

function generateCogsSheet() {
    const entity = $('#cogs-sheet-entity').value;
    const { items, notes, year } = CogsModel.readSources(cogsSheet.sources, entity);
    const mrrYear = year || new Date().getFullYear();
    const mrr = cogsSheetDashboardMrr(mrrYear);
    cogsSheet.notes = [
        ...notes,
        mrr
            ? `MRR for ${mrrYear} was filled on the Inputs tab from the dashboard invoices (USD converted to BRL at each month's rate from fx-rates.php). The cost files are assumed to be in BRL. Marketing still has to be filled in.`
            : 'MRR could not be filled from the dashboard (invoices or exchange rates are not loaded yet). Fill it in on the Inputs tab: shared costs are split by MRR, so they stay unallocated until it is there.',
    ];
    cogsSheet.workbook = CogsModel.buildWorkbook(items, mrr);
    cogsSheet.active = 0;
    cogsSheet.dirty = false;
    $('#cogs-sheet-download').disabled = false;
    renderCogsSheet();
}

const cogsSheetDiscardEdits = () => !cogsSheet.dirty || window.confirm('This replaces the spreadsheet and discards the changes you made in the preview. Continue?');

async function uploadCogsSheetFile(file) {
    const body = new FormData();
    body.append('csrf', document.querySelector('meta[name="csrf-token"]')?.content || '');
    body.append('sheet', file, file.name);
    const response = redirectIfSignedOut(await fetch(COGS_SHEET_ENDPOINT, { method: 'POST', cache: 'no-store', body }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `The server answered HTTP ${response.status}.`);
    return result;
}

async function readCogsSheets(files) {
    cogsSheetError('');
    if (!files.length) return;

    for (const file of files) {
        if (!/\.xlsx$/i.test(file.name)) {
            cogsSheetError(`${file.name}: upload the workbook as .xlsx. In Google Sheets: File › Download › Microsoft Excel (.xlsx).`);
            return;
        }
        if (file.size > COGS_SHEET_MAX_BYTES) {
            cogsSheetError(`${file.name} is larger than 10 MB.`);
            return;
        }
    }
    if (!cogsSheetDiscardEdits()) return;

    const token = {};
    cogsSheet.token = token;
    cogsSheet.busy = true;
    $('#cogs-sheet-upload').disabled = true;

    const added = [];
    try {
        for (const file of files) {
            cogsSheetStatus(`Reading ${file.name}…`);
            const result = await uploadCogsSheetFile(file);
            if (cogsSheet.token !== token) return;
            added.push(result);
        }
        cogsSheet.sources = [...cogsSheet.sources, ...added];
        generateCogsSheet();
        cogsSheetStatus(`Built from ${cogsSheetPlural(cogsSheet.sources.length, 'file')}. Edit cells in the preview, then download. Nothing is saved on the dashboard.`, 'manual');
    } catch (error) {
        if (cogsSheet.token !== token) return;
        cogsSheetError(error.message || 'Could not read the spreadsheet.');
        cogsSheetStatus('');
    } finally {
        if (cogsSheet.token === token) {
            cogsSheet.busy = false;
            $('#cogs-sheet-upload').disabled = false;
        }
    }
}

function downloadCogsSheet() {
    if (!cogsSheet.workbook) return;
    const bytes = CogsModel.toXlsx(cogsSheet.workbook);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `COGS-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function clearCogsSheet() {
    if (cogsSheet.workbook && !cogsSheetDiscardEdits()) return;
    cogsSheet.token = null;
    cogsSheet.sources = [];
    cogsSheet.notes = [];
    cogsSheet.workbook = null;
    cogsSheet.active = 0;
    cogsSheet.busy = false;
    cogsSheet.dirty = false;
    $('#cogs-sheet-upload').disabled = false;
    $('#cogs-sheet-download').disabled = true;
    $('#cogs-sheet-file-input').value = '';
    cogsSheetError('');
    cogsSheetStatus('');
    renderCogsSheet();
}

$('#cogs-sheet-upload').addEventListener('click', () => $('#cogs-sheet-file-input').click());
$('#cogs-sheet-file-input').addEventListener('change', (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    readCogsSheets(files);
});
$('#cogs-sheet-download').addEventListener('click', downloadCogsSheet);
$('#cogs-sheet-clear').addEventListener('click', clearCogsSheet);
$('#cogs-sheet-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-sheet]');
    if (!button) return;
    cogsSheet.active = Number(button.dataset.sheet);
    renderCogsSheet();
});

// Editing a cell: show the formula or typed value on focus, store it on blur, Esc cancels
const cogsSheetTable = $('#cogs-sheet-table');
cogsSheetTable.addEventListener('focusin', (event) => {
    const td = event.target.closest('td[data-r]');
    if (!td || !cogsSheet.workbook) return;
    const sheet = cogsSheet.workbook.sheets[cogsSheet.active];
    const r = Number(td.dataset.r);
    const c = Number(td.dataset.c);
    td.dataset.original = td.textContent;
    td.textContent = cogsSheetRaw(sheet.rows[r]?.[c], sheet.style(r, c));
    const range = document.createRange();
    range.selectNodeContents(td);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
});
cogsSheetTable.addEventListener('focusout', (event) => {
    const td = event.target.closest('td[data-r]');
    if (!td || !cogsSheet.workbook) return;
    const sheet = cogsSheet.workbook.sheets[cogsSheet.active];
    const r = Number(td.dataset.r);
    const c = Number(td.dataset.c);
    if (td.dataset.cancel) {
        delete td.dataset.cancel;
    } else {
        const next = cogsSheetParse(td.textContent, sheet.style(r, c));
        const before = sheet.rows[r]?.[c] ?? null;
        if (next !== before) {
            while (sheet.rows.length <= r) sheet.rows.push([]);
            while (sheet.rows[r].length <= c) sheet.rows[r].push(null);
            sheet.rows[r][c] = next;
            cogsSheet.dirty = true;
        }
    }
    delete td.dataset.original;
    td.textContent = cogsSheetDisplay(CogsModel.evaluator(cogsSheet.workbook).value(cogsSheet.active, r, c), sheet.style(r, c));
    refreshCogsSheetValues();
});
cogsSheetTable.addEventListener('keydown', (event) => {
    const td = event.target.closest('td[data-r]');
    if (!td) return;
    if (event.key === 'Enter') {
        event.preventDefault();
        const next = cogsSheetTable.querySelector(`td[data-r="${Number(td.dataset.r) + 1}"][data-c="${td.dataset.c}"]`);
        if (next) next.focus(); else td.blur();
    } else if (event.key === 'Escape') {
        td.dataset.cancel = '1';
        td.blur();
    }
});
cogsSheetTable.addEventListener('paste', (event) => {
    if (!event.target.closest('td[data-r]')) return;
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData).getData('text').replace(/[\r\n\t]+/g, ' ');
    document.execCommand('insertText', false, text);
});
