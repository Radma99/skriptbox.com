/**
 * Liest Tabellen aus Excel/Google Sheets (Tab-getrennt) oder CSV und gibt HTML, Markdown oder CSV aus.
 * Reine Funktionen ohne DOM.
 */

// Trennzeichen aus der ersten Zeile erraten: Tab (Excel-Kopie), sonst ; oder , (außerhalb von Anführungszeichen)
export function detectDelimiter(input) {
    const firstLine = input.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';

    if (firstLine.includes('\t')) {
        return '\t';
    }

    const outsideQuotes = firstLine.replace(/"[^"]*"/g, '');
    const counts = { ';': 0, ',': 0, '|': 0 };

    for (const char of outsideQuotes) {
        if (char in counts) {
            counts[char] += 1;
        }
    }

    const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

    return count > 0 ? best : '\t';
}

/**
 * CSV-Parser nach RFC 4180: Anführungszeichen, "" als Escape, Zeilenumbrüche innerhalb von Zellen.
 *
 * @returns {string[][]}
 */
export function parse(input, delimiter = detectDelimiter(input)) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    for (let i = 0; i < input.length; i += 1) {
        const char = input[i];

        if (quoted) {
            if (char === '"' && input[i + 1] === '"') {
                cell += '"';
                i += 1;
            } else if (char === '"') {
                quoted = false;
            } else {
                cell += char;
            }
        } else if (char === '"' && cell === '') {
            quoted = true;
        } else if (char === delimiter) {
            row.push(cell);
            cell = '';
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && input[i + 1] === '\n') {
                i += 1;
            }

            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += char;
        }
    }

    if (cell !== '' || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }

    // Markdown-Tabellen: Randstriche und die Trennzeile |---| entfernen
    const cleaned = delimiter === '|'
        ? rows.map((cells) => cells.slice(cells[0].trim() === '' ? 1 : 0, cells.at(-1)?.trim() === '' ? -1 : undefined))
            .filter((cells) => !cells.every((value) => /^\s*:?-{2,}:?\s*$/.test(value)))
        : rows;

    const trimmed = cleaned
        .map((cells) => cells.map((value) => value.trim()))
        .filter((cells) => cells.some((value) => value !== ''));

    // Alle Zeilen auf dieselbe Spaltenzahl bringen
    const columns = Math.max(0, ...trimmed.map((cells) => cells.length));

    return trimmed.map((cells) => [...cells, ...Array(columns - cells.length).fill('')]);
}

const escapeHtml = (text) => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '<br>');

// Zahlen wie 1.234,56 · 12 % · −5 · 3,5 € erkennen
const isNumber = (value) => /^[-−+]?\s?[\d.,\s]+\s?(%|€|\$|EUR|USD)?$/i.test(value) && /\d/.test(value);

/**
 * @param {string[][]} rows
 * @param {{headerRow: boolean, headerColumn: boolean, caption: string, className: string, alignNumbers: boolean}} options
 */
export function toHtml(rows, options) {
    if (rows.length === 0) {
        return '';
    }

    const body = options.headerRow ? rows.slice(1) : rows;
    const columns = rows[0].length;

    // Spalten, in denen alle befüllten Zellen Zahlen sind, rechtsbündig setzen
    const numeric = Array.from({ length: columns }, (_, column) => {
        const values = body.map((cells) => cells[column]).filter((value) => value !== '');

        return options.alignNumbers && values.length > 0 && values.every(isNumber);
    });

    const attributes = (column) => (numeric[column] ? ' style="text-align: right"' : '');
    const lines = [`<table${options.className.trim() ? ` class="${escapeHtml(options.className.trim())}"` : ''}>`];

    if (options.caption.trim()) {
        lines.push(`    <caption>${escapeHtml(options.caption.trim())}</caption>`);
    }

    if (options.headerRow) {
        lines.push('    <thead>', '        <tr>');
        rows[0].forEach((value, column) => {
            lines.push(`            <th scope="col"${attributes(column)}>${escapeHtml(value)}</th>`);
        });
        lines.push('        </tr>', '    </thead>');
    }

    lines.push('    <tbody>');

    body.forEach((cells) => {
        lines.push('        <tr>');
        cells.forEach((value, column) => {
            const tag = options.headerColumn && column === 0 ? 'th' : 'td';
            const scope = tag === 'th' ? ' scope="row"' : '';
            lines.push(`            <${tag}${scope}${attributes(column)}>${escapeHtml(value)}</${tag}>`);
        });
        lines.push('        </tr>');
    });

    lines.push('    </tbody>', '</table>');

    return lines.join('\n');
}

export function toMarkdown(rows, options) {
    if (rows.length === 0) {
        return '';
    }

    const cell = (value) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    const line = (cells) => `| ${cells.map(cell).join(' | ')} |`;
    const header = options.headerRow ? rows[0] : rows[0].map((_, index) => `Spalte ${index + 1}`);
    const body = options.headerRow ? rows.slice(1) : rows;

    return [line(header), `| ${header.map(() => '---').join(' | ')} |`, ...body.map(line)].join('\n');
}

export function toCsv(rows, delimiter = ';') {
    const cell = (value) => (value.includes(delimiter) || /["\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

    return rows.map((cells) => cells.map(cell).join(delimiter)).join('\n');
}
