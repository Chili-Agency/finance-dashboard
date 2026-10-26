/*
 * COGS spreadsheet model: reads the uploaded cost lines, builds the COGS workbook
 * (Items → Allocation → COGS, fed by Inputs), recalculates it in the browser and writes .xlsx.
 * No DOM access here, so it can also be exercised from Node.
 */
const CogsModel = (() => {
    const ENTITIES = ['BR', 'DG', 'PA', 'MEX'];
    const SERVICES = ['SEO', 'PPC', 'Others'];
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const SPARE_ROWS = 15;
    const FIRST_ITEM_ROW = 3; // 1-based row of the first line on Items and Allocation

    const colName = (index) => {
        let name = '';
        for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
            name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
        }
        return name;
    };
    const colIndex = (name) => name.split('').reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
    const fold = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

    /* ------------------------------------------------------------------ reading the uploads */

    const MONTH_NAMES = {};
    [
        ['jan', 'january', 'janeiro'], ['feb', 'february', 'fev', 'fevereiro'], ['mar', 'march', 'marco'],
        ['apr', 'april', 'abr', 'abril'], ['may', 'mai', 'maio'], ['jun', 'june', 'junho'], ['jul', 'july', 'julho'],
        ['aug', 'august', 'ago', 'agosto'], ['sep', 'sept', 'september', 'set', 'setembro'],
        ['oct', 'october', 'out', 'outubro'], ['nov', 'november', 'novembro'], ['dec', 'december', 'dez', 'dezembro'],
    ].forEach((names, month) => names.forEach((name) => { MONTH_NAMES[name] = month; }));

    function monthOf(cell) {
        if (typeof cell === 'number') {
            if (cell < 25569 || cell > 80000) return -1;
            return new Date(Math.round((cell - 25569) * 86400000)).getUTCMonth();
        }
        if (typeof cell !== 'string') return -1;
        const word = fold(cell).toLowerCase().match(/^[a-z]+/);
        return word && word[0] in MONTH_NAMES ? MONTH_NAMES[word[0]] : -1;
    }

    function amountOf(cell) {
        if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
        if (typeof cell !== 'string') return null;
        const text = cell.replace(/[\s$€£R]/g, '').replace(/,/g, '');
        const negative = /^\(.*\)$/.test(text);
        const value = Number(text.replace(/[()]/g, ''));
        return text === '' || !Number.isFinite(value) ? null : (negative ? -value : value);
    }

    function entityOf(text) {
        const upper = fold(text).toUpperCase();
        if (!upper) return null;
        if (/BRAZIL|BRASIL/.test(upper)) return 'BR';
        if (/PANAMA/.test(upper)) return 'PA';
        if (/MEXICO/.test(upper)) return 'MEX';
        const found = upper.match(/(?:^|[^A-Z])(BR|DG|PA|MEX|MX)(?=[^A-Z]|$)/) || upper.match(/^(?:SEO|PPC)(BR|DG|PA|MEX|MX)$/);
        if (!found) return null;
        return found[1] === 'MX' ? 'MEX' : found[1];
    }

    const SERVICE_WORDS = [['SEO', 0], ['PPC', 1], ['OTHERS', 2], ['OTHER', 2], ['OUTROS', 2], ['OUTRO', 2]];

    /** "SEO", "PPC 50% / SEO 50%", "SEO/PPC", "Shared", "OPS" … → how a cost line is allocated. */
    function classify(group) {
        const text = fold(group).toUpperCase();
        const split = [null, null, null];
        const parts = text.split(/[\/,+&;]|\bAND\b|\bE\b/);
        let services = 0;
        for (const part of parts) {
            const hit = SERVICE_WORDS.find(([word]) => new RegExp(`(^|[^A-Z])${word}([^A-Z]|$)`).test(part));
            if (!hit) continue;
            const number = part.match(/(\d+(?:[.,]\d+)?)\s*%?/);
            split[hit[1]] = number ? Number(number[1].replace(',', '.')) : 1;
            services += 1;
        }
        if (!services) return { type: 'Shared', split: [0, 0, 0], known: /SHARED|COMPARTILH|RATEIO|\bOPS\b|OPERA|MGMT|MANAGEMENT|GESTAO|R&D|\bRD\b|\bSALES\b|VENDAS|ADMIN|G&A|\bHR\b|\bRH\b|PEOPLE|FINANCE|FINANCEIRO/.test(text) };
        const total = split.reduce((sum, value) => sum + (value || 0), 0);
        return { type: 'Direct', split: split.map((value) => (value ? value / total : 0)), known: true };
    }

    function headerOf(rows) {
        for (let r = 0; r < Math.min(rows.length, 30); r++) {
            const months = {};
            rows[r].forEach((cell, c) => {
                const month = monthOf(cell);
                if (month >= 0 && !(month in months)) months[month] = c;
            });
            if (Object.keys(months).length >= 3) return { row: r, months };
        }
        return null;
    }


    /** Xero "Account Transactions" export: one row per transaction with Date, Description, Debit and Cost center. */
    function transactionHeaderOf(rows) {
        for (let r = 0; r < Math.min(rows.length, 30); r++) {
            const names = rows[r].map((cell) => (typeof cell === 'string' ? fold(cell).toLowerCase() : ''));
            const date = names.findIndex((name) => name === 'date' || name === 'data');
            const debits = names.map((name, c) => (/^(debit|debito)/.test(name) ? c : -1)).filter((c) => c >= 0);
            if (date < 0 || !debits.length) continue;
            const column = (pattern) => names.findIndex((name) => pattern.test(name));
            const pick = (list, pattern) => list.find((c) => pattern.test(names[c])) ?? list[0];
            const credits = names.map((name, c) => (/^(credit|credito)/.test(name) ? c : -1)).filter((c) => c >= 0);
            return {
                row: r,
                date,
                description: column(/^(description|descricao)/),
                center: column(/cost ?cent|centro de custo|tracking|grupo|group/),
                debit: pick(debits, /brl/),
                credit: credits.length ? pick(credits, /brl/) : -1,
            };
        }
        return null;
    }

    function supplierOf(description) {
        const text = String(description ?? '').replace(/\s*\n\s*/g, '').replace(/\s+/g, ' ').trim();
        const parts = text.split(/\s+-\s+/);
        return (parts.length > 1 ? parts[parts.length - 1] : text).replace(/^["“]+|["”]+$/g, '').trim() || text;
    }

    function yearOfDate(value) {
        if (typeof value === 'number') return value >= 25569 && value < 80000 ? new Date(Math.round((value - 25569) * 86400000)).getUTCFullYear() : null;
        const parsed = typeof value === 'string' ? new Date(value) : null;
        return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getFullYear() : null;
    }

    function monthOfDate(value) {
        if (typeof value === 'number') return value >= 25569 && value < 80000 ? new Date(Math.round((value - 25569) * 86400000)).getUTCMonth() : -1;
        const parsed = typeof value === 'string' ? new Date(value) : null;
        return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getMonth() : -1;
    }

    /**
     * Turns uploaded workbooks ([{fileName, sheets:[{name, rows}]}]) into cost lines.
     * @returns {{items: object[], notes: string[]}}
     */
    function readSources(sources, defaultEntity) {
        const items = [];
        const notes = [];
        let defaulted = 0;
        const ungrouped = [];
        const years = {};

        for (const source of sources) {
            for (const sheet of source.sheets) {
                const header = headerOf(sheet.rows);
                const ledger = header ? null : transactionHeaderOf(sheet.rows);
                if (ledger) {
                    const lines = new Map();
                    const tabEntity = entityOf(sheet.name) || entityOf(source.fileName);
                    for (let r = ledger.row + 1; r < sheet.rows.length; r++) {
                        const row = sheet.rows[r];
                        const month = monthOfDate(row[ledger.date]);
                        if (month < 0) continue;
                        const year = yearOfDate(row[ledger.date]);
                        if (year) years[year] = (years[year] || 0) + 1;
                        const amount = (amountOf(row[ledger.debit]) || 0) - (ledger.credit >= 0 ? amountOf(row[ledger.credit]) || 0 : 0);
                        if (!amount) continue;
                        const label = supplierOf(ledger.description >= 0 ? row[ledger.description] : '');
                        const center = ledger.center >= 0 && typeof row[ledger.center] === 'string' ? row[ledger.center] : '';
                        const key = `${label.toLowerCase()}|${fold(center).toLowerCase()}`;
                        if (!lines.has(key)) lines.set(key, { label, center, months: Array(12).fill(null) });
                        const line = lines.get(key);
                        line.months[month] = (line.months[month] || 0) + amount;
                    }
                    for (const line of lines.values()) {
                        const rule = classify(line.center);
                        if (!rule.known) ungrouped.push(line.label);
                        if (!tabEntity) defaulted += 1;
                        items.push({
                            label: line.label,
                            entity: tabEntity || defaultEntity,
                            source: `${source.fileName} › ${sheet.name}`,
                            type: rule.type,
                            split: rule.split,
                            months: line.months,
                        });
                    }
                    if (!lines.size) notes.push(`${source.fileName} › ${sheet.name}: no transactions with a date and a debit amount were found.`);
                    continue;
                }
                if (!header) {
                    notes.push(`${source.fileName} › ${sheet.name} was skipped: no month columns (Jan, Feb, …) were found.`);
                    continue;
                }
                const head = sheet.rows[header.row];
                const firstMonth = Math.min(...Object.values(header.months));
                const find = (pattern) => head.findIndex((cell) => typeof cell === 'string' && pattern.test(fold(cell)));
                let groupColumn = find(/^(grupo|group|service|servico|setor|sector|area|department|categoria|category)$/i);
                if (groupColumn < 0 && firstMonth > 1) groupColumn = 1;
                const entityColumn = find(/^(entity|entidade|empresa|company|market|mercado)$/i);
                const tabEntity = entityOf(sheet.name) || entityOf(source.fileName);

                for (let r = header.row + 1; r < sheet.rows.length; r++) {
                    const row = sheet.rows[r];
                    const label = typeof row[0] === 'string' ? row[0].trim() : (typeof row[0] === 'number' ? String(row[0]) : '');
                    if (!label || /^(total|subtotal|sub-total|gross|net )/i.test(fold(label))) continue;

                    const group = groupColumn >= 0 && typeof row[groupColumn] === 'string' ? row[groupColumn] : '';
                    const rule = classify(group);
                    if (!rule.known) ungrouped.push(label);

                    let entity = entityColumn >= 0 ? entityOf(String(row[entityColumn] ?? '')) : null;
                    if (!entity) entity = tabEntity;
                    if (!entity) { entity = defaultEntity; defaulted += 1; }

                    const months = Array.from({ length: 12 }, (_, month) => (month in header.months ? amountOf(row[header.months[month]]) : null));
                    items.push({
                        label,
                        entity,
                        source: `${source.fileName} › ${sheet.name}`,
                        type: rule.type,
                        split: rule.split,
                        months,
                    });
                }
            }
        }

        if (defaulted) notes.push(`${defaulted} line${defaulted === 1 ? '' : 's'} had no entity in the file, tab name or file name, so ${defaultEntity} was used. Change the Entity column on the Items tab if that is wrong.`);
        if (ungrouped.length) {
            const shown = ungrouped.slice(0, 5).join(', ') + (ungrouped.length > 5 ? `, … (${ungrouped.length} lines)` : '');
            notes.push(`No service group (SEO, PPC, Others) was recognised for: ${shown}. They were treated as Shared and are split by MRR. Set Type to Direct and fill the % columns on the Items tab to allocate them to a service.`);
        }
        const aggregates = items.filter((item) => /^(subscriptions?|wages and salaries|salaries|partners)$/i.test(item.label) && item.months.some((value) => value));
        if (aggregates.length && sources.length > 1) {
            notes.push(`${[...new Set(aggregates.map((item) => item.label))].join(', ')} look like totals. If the detailed subscription or salary file is also uploaded, delete the total line on the Items tab so it is not counted twice.`);
        }
        const year = Number(Object.keys(years).sort((a, b) => years[b] - years[a])[0]) || null;
        return { items, notes, year };
    }

    /* ------------------------------------------------------------------ building the workbook */

    /** @param {object} [mrr] MRR to prefill, as mrr[entity][serviceIndex][monthIndex] */
    function buildWorkbook(items, mrr) {
        const count = items.length + SPARE_ROWS;
        const lastRow = FIRST_ITEM_ROW + count - 1;
        const monthCols = (start) => Array.from({ length: 12 }, (_, month) => colName(start + month));

        /* Items: one row per cost line, month amounts in H:S */
        const itemRows = [
            ['Cost lines. Type is Direct (allocated to the service % shown) or Shared (split by MRR). Edit any cell; rows left empty at the bottom are free for new lines.'],
            ['Line', 'Entity', 'Source', 'Type', 'SEO %', 'PPC %', 'Others %', ...MONTHS, 'YTD', 'Check'],
        ];
        for (let i = 0; i < count; i++) {
            const r = FIRST_ITEM_ROW + i;
            const item = items[i];
            itemRows.push([
                item ? item.label : null,
                item ? item.entity : null,
                item ? item.source : null,
                item ? item.type : null,
                ...(item && item.type === 'Direct' ? item.split.map((value) => value || null) : [null, null, null]),
                ...(item ? item.months : Array(12).fill(null)),
                `=SUM(H${r}:S${r})`,
                `=IF(A${r}="","",IF(OR(B${r}="BR",B${r}="DG",B${r}="PA",B${r}="MEX"),IF(D${r}="Direct",IF(ROUND(E${r}+F${r}+G${r},4)=1,"OK","Split must total 100%"),IF(D${r}="Shared","OK","Type must be Direct or Shared")),"Entity must be BR, DG, PA or MEX"))`,
            ]);
        }
        const itemsSheet = {
            name: 'Items',
            rows: itemRows,
            widths: [34, 9, 34, 10, 9, 9, 10, ...Array(12).fill(12), 13, 30],
            freeze: { rows: 2, cols: 1 },
            style: (r, c) => {
                if (r === 0) return 'note';
                if (r === 1) return 'head';
                if (c <= 3) return 'inputText';
                if (c <= 6) return 'inputPct';
                if (c <= 18) return 'input';
                return c === 19 ? 'moneyBold' : 'text';
            },
        };

        /* Allocation: per line, direct cost per service and shared cost, month by month */
        const allocationRows = [
            ['', '', 'Direct · SEO', ...Array(11).fill(''), 'Direct · PPC', ...Array(11).fill(''), 'Direct · Others', ...Array(11).fill(''), 'Shared (split by MRR)', ...Array(11).fill('')],
            ['Line', 'Entity', ...Array(4).fill(MONTHS).flat()],
        ];
        for (let i = 0; i < count; i++) {
            const r = FIRST_ITEM_ROW + i;
            const row = [`=IF(Items!A${r}="","",Items!A${r})`, `=IF(Items!B${r}="","",Items!B${r})`];
            for (let service = 0; service < 3; service++) {
                for (const month of monthCols(7)) row.push(`=IF(Items!$D${r}="Direct",Items!${month}${r}*Items!$${colName(4 + service)}${r},0)`);
            }
            for (const month of monthCols(7)) row.push(`=IF(Items!$D${r}="Shared",Items!${month}${r},0)`);
            allocationRows.push(row);
        }
        const allocationSheet = {
            name: 'Allocation',
            rows: allocationRows,
            widths: [34, 9, ...Array(48).fill(11)],
            freeze: { rows: 2, cols: 2 },
            style: (r, c) => (r === 0 ? 'section' : r === 1 ? 'head' : c < 2 ? 'text' : 'money'),
        };

        /* Inputs: MRR and Marketing per entity and service (not in the uploaded files) */
        const inputsRows = [['Monthly recurring revenue and marketing spend per entity and service. Shared costs are split by each service\'s share of MRR, so fill MRR in first.']];
        const inputRow = {};
        const inputKinds = { 0: 'note' };
        ENTITIES.forEach((entity, index) => {
            const start = 2 + index * 8;
            while (inputsRows.length < start) inputsRows.push([]);
            inputsRows.push([entity, ...MONTHS, 'YTD']);
            inputKinds[start] = 'head';
            ['MRR', 'Marketing'].forEach((kind, offset) => {
                SERVICES.forEach((service, k) => {
                    const r = inputsRows.length;
                    inputRow[`${entity}|${kind}|${k}`] = r + 1;
                    inputKinds[r] = 'inputs';
                    inputsRows.push([`${kind} · ${service}`, ...Array.from({ length: 12 }, (_, month) => (kind === 'MRR' ? mrr?.[entity]?.[k]?.[month] ?? null : null)), `=SUM(B${r + 1}:M${r + 1})`]);
                });
            });
        });
        const inputsSheet = {
            name: 'Inputs',
            rows: inputsRows,
            widths: [24, ...Array(12).fill(12), 13],
            freeze: { rows: 0, cols: 1 },
            style: (r, c) => {
                const kind = inputKinds[r];
                if (kind === 'note') return 'note';
                if (kind === 'head') return 'head';
                if (kind === 'inputs') return c === 0 ? 'label' : c === 13 ? 'moneyBold' : 'input';
                return 'text';
            },
        };

        /* COGS: per entity and service, then the entity total, then all entities */
        const cogsRows = [['COGS = direct costs + shared costs split by MRR. COGS % = COGS ÷ MRR. Contribution margin = (MRR − COGS − Marketing) ÷ MRR.']];
        const cogsKinds = { 0: 'note' };
        const rangeOf = (column) => `Allocation!$${column}$${FIRST_ITEM_ROW}:$${column}$${lastRow}`;
        const entityRange = rangeOf('B');
        const GROUP_LABELS = ['MRR', 'Direct costs', 'Shared costs', 'COGS', 'COGS %', 'Marketing', 'Contribution margin'];
        const GROUP_KINDS = ['money', 'money', 'money', 'moneyBold', 'pct', 'money', 'pctBold'];
        const BASE = { mrr: 0, direct: 1, shared: 2, mkt: 5 };

        /** base(kind, service, columnLetter) → formula for the MRR, direct, shared and marketing rows */
        function block(start, title, base, unallocated) {
            while (cogsRows.length < start) cogsRows.push([]);
            cogsRows.push([title, ...MONTHS, 'YTD']);
            cogsKinds[start] = 'head';
            const groups = [];
            const writeGroup = (label, groupStart, formulaFor) => {
                groups.push(groupStart);
                GROUP_LABELS.forEach((name, offset) => {
                    const r = groupStart + offset;
                    cogsKinds[r] = GROUP_KINDS[offset];
                    const row = [label ? `${label} · ${name}` : name];
                    for (let c = 1; c <= 13; c++) {
                        const L = colName(c);
                        const money = GROUP_KINDS[offset].startsWith('money');
                        if (money && c === 13) row.push(`=SUM(B${r + 1}:M${r + 1})`);
                        else row.push(formulaFor(offset, L, c));
                    }
                    cogsRows[r] = row;
                });
            };
            const derived = (groupStart, offset, L) => {
                const at = (k) => `${L}${groupStart + k + 1}`;
                if (offset === 3) return `=${at(1)}+${at(2)}`;
                // no MRR or no cost in the month: leave the ratio blank instead of showing 0% COGS or 100% margin
                if (offset === 4) return `=IF(OR(${at(0)}=0,${at(3)}=0),"",${at(3)}/${at(0)})`;
                if (offset === 6) return `=IF(OR(${at(0)}=0,${at(3)}=0),"",(${at(0)}-${at(3)}-${at(5)})/${at(0)})`;
                return null;
            };
            const totalStart = start + 1;
            SERVICES.forEach((service, k) => {
                const groupStart = start + 9 + k * 7;
                writeGroup(service, groupStart, (offset, L, c) => derived(groupStart, offset, L)
                    ?? base(Object.keys(BASE)[Object.values(BASE).indexOf(offset)], k, L, c, totalStart));
            });
            // The total COGS also carries shared costs that could not be split yet (no MRR), so no cost disappears from it
            writeGroup('Total', totalStart, (offset, L) => (offset === 3 ? `=${L}${totalStart + 2}+${L}${totalStart + 3}+${L}${totalStart + 8}` : derived(totalStart, offset, L))
                ?? `=${SERVICES.map((_, k) => `${L}${start + 9 + k * 7 + offset + 1}`).join('+')}`);
            const unallocatedRow = totalStart + 7;
            cogsKinds[unallocatedRow] = 'money';
            cogsRows[unallocatedRow] = ['Shared costs not split yet (no MRR)', ...Array.from({ length: 13 }, (_, i) => (i === 12 ? `=SUM(B${unallocatedRow + 1}:M${unallocatedRow + 1})` : unallocated(colName(i + 1), i, totalStart)))];
            return { start, totalStart };
        }

        const entityBlocks = {};
        ENTITIES.forEach((entity, index) => {
            entityBlocks[entity] = block(
                2 + index * 31,
                entity,
                (kind, k, L, c, totalStart) => {
                    const month = c - 1;
                    if (kind === 'mrr') return `=Inputs!${L}${inputRow[`${entity}|MRR|${k}`]}`;
                    if (kind === 'mkt') return `=Inputs!${L}${inputRow[`${entity}|Marketing|${k}`]}`;
                    if (kind === 'direct') {
                        const column = colName(2 + 12 * k + month);
                        return `=SUMIF(${entityRange},"${entity}",${rangeOf(column)})`;
                    }
                    const column = colName(2 + 36 + month);
                    const groupStart = 2 + index * 31 + 9 + k * 7;
                    return `=IF(${L}${totalStart + 1}=0,0,SUMIF(${entityRange},"${entity}",${rangeOf(column)})*${L}${groupStart + 1}/${L}${totalStart + 1})`;
                },
                (L, i, totalStart) => `=SUMIF(${entityRange},"${entity}",${rangeOf(colName(2 + 36 + i))})-${L}${totalStart + 3}`,
            );
        });
        const consolidatedStart = 2 + ENTITIES.length * 31;
        block(
            consolidatedStart,
            'All entities',
            (kind, k, L) => `=${ENTITIES.map((entity) => `${L}${entityBlocks[entity].start + 9 + k * 7 + BASE[kind] + 1}`).join('+')}`,
            (L) => `=${ENTITIES.map((entity) => `${L}${entityBlocks[entity].totalStart + 8}`).join('+')}`,
        );

        const cogsSheet = {
            name: 'COGS',
            rows: cogsRows,
            widths: [38, ...Array(12).fill(12), 14],
            freeze: { rows: 0, cols: 1 },
            style: (r, c) => {
                const kind = cogsKinds[r];
                if (kind === 'note') return 'note';
                if (kind === 'head') return 'head';
                if (!kind) return 'text';
                if (c === 0) return kind.endsWith('Bold') ? 'labelBold' : 'label';
                return kind;
            },
        };

        return { sheets: [cogsSheet, itemsSheet, inputsSheet, allocationSheet] };
    }

    /* ------------------------------------------------------------------ formulas */

    class XlError {
        constructor(code) { this.code = code; }
    }

    function evaluator(workbook) {
        const byName = new Map(workbook.sheets.map((sheet, index) => [sheet.name.toLowerCase(), index]));
        const cache = new Map();
        const busy = new Set();

        const raw = (sheet, r, c) => workbook.sheets[sheet].rows[r]?.[c] ?? null;

        function cell(sheet, r, c) {
            const key = `${sheet}:${r}:${c}`;
            if (cache.has(key)) return cache.get(key);
            const source = raw(sheet, r, c);
            let value = source;
            if (typeof source === 'string' && source.length > 1 && source[0] === '=') {
                if (busy.has(key)) return new XlError('#CIRC!');
                busy.add(key);
                try {
                    value = run(source.slice(1), sheet);
                    if (value && value.rows) value = value.rows[0]?.[0] ?? null;
                    if (value === null) value = 0;
                } catch (error) {
                    value = new XlError(error instanceof XlError ? error.code : '#ERROR!');
                }
                busy.delete(key);
            }
            cache.set(key, value);
            return value;
        }

        function run(formula, sheet) {
            const tokens = tokenize(formula);
            let pos = 0;
            const peek = () => tokens[pos];
            const take = () => tokens[pos++];
            const accept = (type, text) => (peek() && peek().type === type && (text === undefined || peek().text === text) ? take() : null);

            const refRange = (token) => {
                const target = token.sheet === null ? sheet : byName.get(token.sheet.toLowerCase());
                if (target === undefined) throw new XlError('#REF!');
                return { sheet: target, r1: token.r1, c1: token.c1, r2: token.r2, c2: token.c2 };
            };
            const scalar = (value) => {
                if (value && value.ref) {
                    const { sheet: s, r1, c1 } = value.ref;
                    return cell(s, r1, c1);
                }
                return value;
            };
            const number = (value) => {
                value = scalar(value);
                if (value instanceof XlError) throw value;
                if (value === null || value === '') return 0;
                if (typeof value === 'boolean') return value ? 1 : 0;
                if (typeof value === 'number') return value;
                const parsed = Number(value);
                if (Number.isFinite(parsed)) return parsed;
                throw new XlError('#VALUE!');
            };
            const cellsOf = (value) => {
                if (!(value && value.ref)) return [scalar(value)];
                const { sheet: s, r1, c1, r2, c2 } = value.ref;
                const out = [];
                for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(cell(s, r, c));
                return out;
            };
            const compare = (a, b) => {
                a = scalar(a); b = scalar(b);
                if (a instanceof XlError) throw a;
                if (b instanceof XlError) throw b;
                if (a === null) a = typeof b === 'string' ? '' : 0;
                if (b === null) b = typeof a === 'string' ? '' : 0;
                if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase().localeCompare(b.toLowerCase());
                if (typeof a === 'string') return 1;
                if (typeof b === 'string') return -1;
                return Number(a) - Number(b);
            };
            const matches = (value, criterion) => {
                if (value instanceof XlError) return false;
                let operator = '=';
                let target = criterion;
                if (typeof criterion === 'string') {
                    const found = criterion.match(/^(<=|>=|<>|<|>|=)?(.*)$/s);
                    operator = found[1] || '=';
                    target = found[2];
                    if (target !== '' && Number.isFinite(Number(target))) target = Number(target);
                }
                const order = typeof target === 'number'
                    ? (typeof value === 'number' ? value - target : Number.NaN)
                    : String(value ?? '').toLowerCase().localeCompare(String(target).toLowerCase());
                if (Number.isNaN(order)) return operator === '<>';
                return { '=': order === 0, '<>': order !== 0, '<': order < 0, '>': order > 0, '<=': order <= 0, '>=': order >= 0 }[operator];
            };

            const FUNCTIONS = {
                SUM: (args) => args.flatMap(cellsOf).reduce((sum, value) => {
                    if (value instanceof XlError) throw value;
                    return sum + (typeof value === 'number' ? value : 0);
                }, 0),
                SUMIF: (args) => {
                    const test = cellsOf(args[0]);
                    const criterion = scalar(args[1]);
                    const sum = args[2] ? cellsOf(args[2]) : test;
                    let total = 0;
                    test.forEach((value, i) => { if (matches(value, criterion) && typeof sum[i] === 'number') total += sum[i]; });
                    return total;
                },
                IF: (args) => {
                    const test = scalar(args[0]);
                    if (test instanceof XlError) throw test;
                    const truthy = typeof test === 'boolean' ? test : number(test) !== 0;
                    return truthy ? args[1] : (args.length > 2 ? args[2] : false);
                },
                IFERROR: (args) => (scalar(args[0]) instanceof XlError ? args[1] : args[0]),
                MAX: (args) => Math.max(0, ...args.flatMap(cellsOf).filter((value) => typeof value === 'number')),
                MIN: (args) => Math.min(0, ...args.flatMap(cellsOf).filter((value) => typeof value === 'number')),
                ABS: (args) => Math.abs(number(args[0])),
                ROUND: (args) => { const f = 10 ** number(args[1] ?? 0); return Math.round(number(args[0]) * f) / f; },
                AND: (args) => args.flatMap(cellsOf).every((value) => value === true || (typeof value === 'number' && value !== 0)),
                OR: (args) => args.flatMap(cellsOf).some((value) => value === true || (typeof value === 'number' && value !== 0)),
            };

            function primary() {
                const token = take();
                if (!token) throw new XlError('#ERROR!');
                if (token.type === 'number') return token.value;
                if (token.type === 'string') return token.value;
                if (token.type === 'ref') return { ref: refRange(token) };
                if (token.type === 'op' && token.text === '(') {
                    const value = expression();
                    if (!accept('op', ')')) throw new XlError('#ERROR!');
                    return value;
                }
                if (token.type === 'func') {
                    const fn = FUNCTIONS[token.text];
                    if (!fn) throw new XlError('#NAME?');
                    accept('op', '(');
                    const args = [];
                    if (!accept('op', ')')) {
                        // an argument that fails is passed on as a value so IFERROR can see it
                        do {
                            try { args.push(expression()); } catch (error) { if (!(error instanceof XlError)) throw error; args.push(error); }
                        } while (accept('op', ','));
                        if (!accept('op', ')')) throw new XlError('#ERROR!');
                    }
                    return fn(args);
                }
                throw new XlError('#ERROR!');
            }
            function unary() {
                if (accept('op', '-')) return -number(unary());
                if (accept('op', '+')) return number(unary());
                return primary();
            }
            function term() {
                let left = unary();
                for (;;) {
                    if (accept('op', '*')) left = number(left) * number(unary());
                    else if (accept('op', '/')) {
                        const divisor = number(unary());
                        if (divisor === 0) throw new XlError('#DIV/0!');
                        left = number(left) / divisor;
                    } else return left;
                }
            }
            function sum() {
                let left = term();
                for (;;) {
                    if (accept('op', '+')) left = number(left) + number(term());
                    else if (accept('op', '-')) left = number(left) - number(term());
                    else return left;
                }
            }
            function expression() {
                const left = sum();
                const token = peek();
                if (token && token.type === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(token.text)) {
                    take();
                    const order = compare(left, sum());
                    return { '=': order === 0, '<>': order !== 0, '<': order < 0, '>': order > 0, '<=': order <= 0, '>=': order >= 0 }[token.text];
                }
                return left;
            }

            const result = expression();
            if (pos < tokens.length) throw new XlError('#ERROR!');
            if (result && result.ref) return cell(result.ref.sheet, result.ref.r1, result.ref.c1);
            if (result instanceof XlError) throw result;
            return result;
        }

        function tokenize(text) {
            const tokens = [];
            let i = 0;
            while (i < text.length) {
                const rest = text.slice(i);
                let m;
                if ((m = rest.match(/^\s+/))) { i += m[0].length; continue; }
                if ((m = rest.match(/^"((?:[^"]|"")*)"/))) { tokens.push({ type: 'string', value: m[1].replace(/""/g, '"') }); i += m[0].length; continue; }
                if ((m = rest.match(/^(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_.]*))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/))) {
                    tokens.push(refToken(m[1] ?? m[2], m[3], m[4], m[5], m[6]));
                    i += m[0].length; continue;
                }
                if ((m = rest.match(/^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![A-Za-z0-9(])/))) {
                    tokens.push(refToken(null, m[1], m[2], m[3], m[4]));
                    i += m[0].length; continue;
                }
                if ((m = rest.match(/^(\d+(?:\.\d+)?)/))) { tokens.push({ type: 'number', value: Number(m[1]) }); i += m[0].length; continue; }
                if ((m = rest.match(/^([A-Za-z][A-Za-z0-9.]*)(?=\()/))) { tokens.push({ type: 'func', text: m[1].toUpperCase() }); i += m[0].length; continue; }
                if ((m = rest.match(/^(<>|<=|>=|[-+*\/(),=<>])/))) { tokens.push({ type: 'op', text: m[1] }); i += m[0].length; continue; }
                throw new XlError('#ERROR!');
            }
            return tokens;
        }

        function refToken(sheetName, col1, row1, col2, row2) {
            const c1 = colIndex(col1);
            const r1 = Number(row1) - 1;
            const c2 = col2 ? colIndex(col2) : c1;
            const r2 = row2 ? Number(row2) - 1 : r1;
            return { type: 'ref', sheet: sheetName, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
        }

        return { value: cell };
    }

    /* ------------------------------------------------------------------ writing .xlsx */

    const STYLE_INDEX = ['text', 'head', 'section', 'label', 'labelBold', 'money', 'moneyBold', 'pct', 'pctBold', 'input', 'inputPct', 'inputText', 'note'];

    const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]\\-#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6B6B6B"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E6DF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E1"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>
<xf numFmtId="165" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
</styleSheet>`;

    const xml = (text) => String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    function sheetXml(workbook, index, ev) {
        const sheet = workbook.sheets[index];
        const width = Math.max(0, ...sheet.rows.map((row) => row.length));
        let data = '';
        sheet.rows.forEach((row, r) => {
            let cells = '';
            for (let c = 0; c < width; c++) {
                const source = row[c] ?? null;
                const style = STYLE_INDEX.indexOf(sheet.style(r, c));
                const s = style > 0 ? ` s="${style}"` : '';
                const ref = `${colName(c)}${r + 1}`;
                if (source === null || source === '') {
                    if (style > 0) cells += `<c r="${ref}"${s}/>`;
                } else if (typeof source === 'string' && source.length > 1 && source[0] === '=') {
                    const value = ev.value(index, r, c);
                    const formula = `<f>${xml(source.slice(1))}</f>`;
                    if (value instanceof XlError) cells += `<c r="${ref}"${s} t="e">${formula}<v>${xml(value.code)}</v></c>`;
                    else if (typeof value === 'number') cells += `<c r="${ref}"${s}>${formula}<v>${value}</v></c>`;
                    else if (typeof value === 'boolean') cells += `<c r="${ref}"${s} t="b">${formula}<v>${value ? 1 : 0}</v></c>`;
                    else cells += `<c r="${ref}"${s} t="str">${formula}<v>${xml(value ?? '')}</v></c>`;
                } else if (typeof source === 'number') {
                    cells += `<c r="${ref}"${s}><v>${source}</v></c>`;
                } else {
                    cells += `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(source)}</t></is></c>`;
                }
            }
            data += `<row r="${r + 1}">${cells}</row>`;
        });
        const cols = sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
        const { rows: fr, cols: fc } = sheet.freeze;
        const pane = fr || fc
            ? `<sheetViews><sheetView workbookViewId="0"><pane${fc ? ` xSplit="${fc}"` : ''}${fr ? ` ySplit="${fr}"` : ''} topLeftCell="${colName(fc)}${fr + 1}" activePane="${fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight'}" state="frozen"/></sheetView></sheetViews>`
            : '';
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<cols>${cols}</cols><sheetData>${data}</sheetData></worksheet>`;
    }

    const CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
        return table;
    })();
    const crc32 = (bytes) => {
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    };

    /** Stored (uncompressed) zip: plenty for a few small XML parts and needs no library. */
    function zip(files) {
        const encoder = new TextEncoder();
        const chunks = [];
        const central = [];
        let offset = 0;
        const now = new Date();
        const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
        const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
        for (const [name, content] of files) {
            const nameBytes = encoder.encode(name);
            const data = encoder.encode(content);
            const crc = crc32(data);
            const local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true);
            local.setUint16(4, 20, true);
            local.setUint16(6, 0x0800, true);
            local.setUint16(10, dosTime, true);
            local.setUint16(12, dosDate, true);
            local.setUint32(14, crc, true);
            local.setUint32(18, data.length, true);
            local.setUint32(22, data.length, true);
            local.setUint16(26, nameBytes.length, true);
            chunks.push(new Uint8Array(local.buffer), nameBytes, data);
            const entry = new DataView(new ArrayBuffer(46));
            entry.setUint32(0, 0x02014b50, true);
            entry.setUint16(4, 20, true);
            entry.setUint16(6, 20, true);
            entry.setUint16(8, 0x0800, true);
            entry.setUint16(12, dosTime, true);
            entry.setUint16(14, dosDate, true);
            entry.setUint32(16, crc, true);
            entry.setUint32(20, data.length, true);
            entry.setUint32(24, data.length, true);
            entry.setUint16(28, nameBytes.length, true);
            entry.setUint32(42, offset, true);
            central.push(new Uint8Array(entry.buffer), nameBytes);
            offset += 30 + nameBytes.length + data.length;
        }
        const centralSize = central.reduce((sum, part) => sum + part.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, files.length, true);
        end.setUint16(10, files.length, true);
        end.setUint32(12, centralSize, true);
        end.setUint32(16, offset, true);
        const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
        const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
        let at = 0;
        for (const part of parts) { out.set(part, at); at += part.length; }
        return out;
    }

    function toXlsx(workbook) {
        const ev = evaluator(workbook);
        const sheets = workbook.sheets;
        const files = [
            ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
            ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
            ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`],
            ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
            ['xl/styles.xml', STYLES_XML],
            ...sheets.map((_, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(workbook, i, ev)]),
        ];
        return zip(files);
    }

    return { ENTITIES, SERVICES, MONTHS, colName, readSources, classify, buildWorkbook, evaluator, XlError, toXlsx };
})();

if (typeof module !== 'undefined') module.exports = CogsModel;
