const COGS_SHEET_ENDPOINT = 'cogs-sheet.php';
const COGS_SHEET_MAX_BYTES = 10 * 1024 * 1024;

const cogsSheet = { file: null, data: null, active: 0, busy: false, token: null };

const cogsSheetColumnName = (index) => {
    let name = '';
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
        name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    }
    return name;
};

const cogsSheetFileSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

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

function cogsSheetCell(value) {
    if (value === null || value === undefined || value === '') return '<td></td>';
    if (typeof value === 'number') return `<td class="align-right mono">${escapeHtml(value.toLocaleString('en-US', { maximumFractionDigits: 6 }))}</td>`;
    if (typeof value === 'boolean') return `<td class="mono">${value ? 'TRUE' : 'FALSE'}</td>`;
    return `<td>${escapeHtml(value)}</td>`;
}

function renderCogsSheet() {
    const panel = $('#cogs-sheet-panel');
    const data = cogsSheet.data;
    panel.hidden = !data;
    if (!data) return;

    const sheet = data.sheets[cogsSheet.active];
    setText('#cogs-sheet-file', data.fileName);
    setText('#cogs-sheet-meta', `${cogsSheetFileSize(data.size)} · ${data.sheets.length} ${data.sheets.length === 1 ? 'tab' : 'tabs'}`);

    $('#cogs-sheet-tabs').innerHTML = data.sheets
        .map((item, index) => `<button type="button" class="scope-tab${index === cogsSheet.active ? ' is-active' : ''}" role="tab" aria-selected="${index === cogsSheet.active}" data-sheet="${index}">${escapeHtml(item.name)}</button>`)
        .join('');

    const notes = [];
    if (data.uncached) notes.push('Some formulas in this file were saved without their calculated values, so those cells appear empty. Download the file again from Google Sheets (File › Download › Microsoft Excel) or open and save it in Excel.');
    if (sheet.truncated) notes.push(`Only the first ${sheet.rowCount.toLocaleString('en-US')} rows of this tab are shown.`);
    const noteNode = $('#cogs-sheet-notes');
    noteNode.hidden = !notes.length;
    noteNode.innerHTML = notes.map((note) => `<p class="import-note is-warning">${escapeHtml(note)}</p>`).join('');

    const empty = $('#cogs-sheet-empty');
    const table = $('#cogs-sheet-table');
    if (!sheet.rowCount || !sheet.columnCount) {
        table.innerHTML = '';
        empty.hidden = false;
        empty.textContent = 'This tab has no data.';
        return;
    }
    empty.hidden = true;

    const head = Array.from({ length: sheet.columnCount }, (_, index) => `<th scope="col">${cogsSheetColumnName(index)}</th>`).join('');
    const body = sheet.rows
        .map((row, index) => `<tr><th scope="row">${index + 1}</th>${row.map(cogsSheetCell).join('')}</tr>`)
        .join('');
    table.innerHTML = `<thead><tr><th scope="col"></th>${head}</tr></thead><tbody>${body}</tbody>`;
}

async function readCogsSheet(file) {
    cogsSheetError('');
    if (!file) return;

    if (!/\.xlsx$/i.test(file.name)) {
        cogsSheetError('Upload the workbook as .xlsx. In Google Sheets: File › Download › Microsoft Excel (.xlsx).');
        return;
    }
    if (file.size > COGS_SHEET_MAX_BYTES) {
        cogsSheetError('The file is larger than 10 MB.');
        return;
    }

    const token = {};
    cogsSheet.token = token;
    cogsSheet.busy = true;
    $('#cogs-sheet-upload').disabled = true;
    cogsSheetStatus(`Reading ${file.name}…`);

    try {
        const body = new FormData();
        body.append('csrf', document.querySelector('meta[name="csrf-token"]')?.content || '');
        body.append('sheet', file, file.name);
        const response = redirectIfSignedOut(await fetch(COGS_SHEET_ENDPOINT, { method: 'POST', cache: 'no-store', body }));
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `The server answered HTTP ${response.status}.`);
        if (cogsSheet.token !== token) return;

        cogsSheet.file = file;
        cogsSheet.data = result;
        cogsSheet.active = 0;
        cogsSheetStatus(`${result.fileName} was read. Nothing is saved on the dashboard.`, 'manual');
        renderCogsSheet();
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

function clearCogsSheet() {
    cogsSheet.token = null;
    cogsSheet.file = null;
    cogsSheet.data = null;
    cogsSheet.active = 0;
    cogsSheet.busy = false;
    $('#cogs-sheet-upload').disabled = false;
    $('#cogs-sheet-file-input').value = '';
    cogsSheetError('');
    cogsSheetStatus('');
    renderCogsSheet();
}

$('#cogs-sheet-upload').addEventListener('click', () => $('#cogs-sheet-file-input').click());
$('#cogs-sheet-file-input').addEventListener('change', (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    readCogsSheet(file);
});
$('#cogs-sheet-clear').addEventListener('click', clearCogsSheet);
$('#cogs-sheet-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-sheet]');
    if (!button) return;
    cogsSheet.active = Number(button.dataset.sheet);
    renderCogsSheet();
});
