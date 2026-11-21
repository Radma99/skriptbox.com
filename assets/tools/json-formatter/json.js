// JSON prüfen, formatieren und minifizieren ohne Bibliothek.
// Eigener Parser statt JSON.parse: Die Browser melden Fehler unterschiedlich (oder ohne Position),
// außerdem bleiben so die Originalziffern großer Zahlen und die Reihenfolge der Schlüssel erhalten.

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const WORD = /[A-Za-z_$][\w$]*/y;
const NUMBER_LIKE = /[-+.\w]+/y;
const STRING_PLAIN = /[^"\\\u0000-\u001f]*/y;
const WHITESPACE = /[ \t\n\r]*/y;
const SMART_QUOTES = '“”„‟‘’‚«»';
const CLOSE = { '{': '}', '[': ']' };

// Häufige Verwechslungen aus Python, JavaScript & Co. und was in JSON gemeint ist
const LITERALS = { true: 'true', false: 'false', null: 'null', none: 'null', nil: 'null', undefined: 'null' };

// Zustände des Parsers: was an der aktuellen Stelle erlaubt ist
const VALUE = 1;
const ARRAY_FIRST = 2;
const KEY_FIRST = 3;
const KEY = 4;
const COLON = 5;
const AFTER = 6;

class JsonError extends Error {
    constructor(code, offset, length = 1, params = {}) {
        super(code);
        this.code = code;
        this.offset = offset;
        this.length = length;
        this.params = params;
    }
}

/**
 * Liest JSON. Ergebnis bei Erfolg: Syntaxbaum (Zahlen als Originaltext), Hinweise und Statistik.
 * Bei einem Fehler: Code, Position (offset, line, column), Länge der Markierung und Platzhalter für die Meldung.
 *
 * @returns {{ empty: true } | { ok: true, tree, warnings, stats } | { ok: false, error }}
 */
export function parse(text) {
    const lines = lineIndex(text);
    const warnings = [];
    const stats = { depth: 0, objects: 0, arrays: 0, keys: 0, values: 0 };
    let pos = 0;

    // BOM überspringen, aber melden: JSON.parse und PHP lehnen es ab
    if (text.charCodeAt(0) === 0xFEFF) {
        warnings.push({ code: 'bom', offset: 0 });
        pos = 1;
    }

    WHITESPACE.lastIndex = pos;
    WHITESPACE.test(text);

    if (WHITESPACE.lastIndex >= text.length) {
        return { empty: true };
    }

    try {
        const tree = run(text, pos, warnings, stats);
        warnings.forEach((warning) => {
            Object.assign(warning, lines.position(warning.offset));

            if (warning.params?.first !== undefined) {
                warning.params.first = lines.position(warning.params.first).line;
            }
        });

        return { ok: true, tree, warnings, stats };
    } catch (error) {
        if (!(error instanceof JsonError)) {
            throw error;
        }

        if (error.params.line !== undefined) {
            error.params.line = lines.position(error.params.line).line;
        }

        return {
            ok: false,
            error: { code: error.code, offset: error.offset, length: error.length, params: error.params, ...lines.position(error.offset), excerpt: excerpt(text, lines, error.offset, error.length) },
        };
    }
}

function run(text, start, warnings, stats) {
    const stack = [];
    let pos = start;
    let state = VALUE;
    let root;
    let lastComma = -1;

    const skip = () => {
        WHITESPACE.lastIndex = pos;
        WHITESPACE.test(text);
        pos = WHITESPACE.lastIndex;
    };

    // Fertigen Wert ins übergeordnete Objekt/Array hängen
    const attach = (node) => {
        const frame = stack[stack.length - 1];

        if (!frame) {
            root = node;
        } else if (frame.node.type === 'array') {
            frame.node.items.push(node);
        } else {
            frame.node.entries.push([frame.key, node]);
        }

        state = AFTER;
    };

    const open = (char) => {
        const node = char === '{' ? { type: 'object', entries: [] } : { type: 'array', items: [] };
        stack.push({ node, char, offset: pos, keys: new Map(), key: null });
        stats[char === '{' ? 'objects' : 'arrays'] += 1;
        stats.depth = Math.max(stats.depth, stack.length);
        pos += 1;
        state = char === '{' ? KEY_FIRST : ARRAY_FIRST;
    };

    const close = () => {
        const frame = stack.pop();
        pos += 1;
        attach(frame.node);
    };

    for (;;) {
        skip();
        const char = text[pos];
        const frame = stack[stack.length - 1];

        if (state === AFTER) {
            if (!frame) {
                if (pos < text.length) {
                    throw unexpected(text, pos, state, stack);
                }

                return root;
            }

            if (char === ',') {
                lastComma = pos;
                pos += 1;
                state = frame.char === '{' ? KEY : VALUE;
                continue;
            }

            if (char === CLOSE[frame.char]) {
                close();
                continue;
            }

            throw unexpected(text, pos, state, stack);
        }

        if (state === COLON) {
            if (char !== ':') {
                throw unexpected(text, pos, state, stack, { key: frame.key });
            }

            pos += 1;
            state = VALUE;
            continue;
        }

        if (state === KEY_FIRST || state === KEY) {
            if (char === '"') {
                const keyOffset = pos;
                const key = readString(text, pos);
                pos = key.end;

                if (frame.keys.has(key.value)) {
                    warnings.push({ code: 'duplicate_key', offset: keyOffset, params: { key: key.value, first: frame.keys.get(key.value) } });
                } else {
                    frame.keys.set(key.value, keyOffset);
                }

                frame.key = key.value;
                stats.keys += 1;
                state = COLON;
                continue;
            }

            if (char === '}' && state === KEY_FIRST) {
                close();
                continue;
            }

            // Komma vor } ist der häufigste Fehler überhaupt (z. B. nach dem Löschen der letzten Zeile)
            if (char === '}') {
                throw new JsonError('trailing_comma', lastComma);
            }

            throw unexpected(text, pos, state, stack);
        }

        // VALUE oder ARRAY_FIRST
        if (char === ']' && frame?.char === '[') {
            if (state === ARRAY_FIRST) {
                close();
                continue;
            }

            throw new JsonError('trailing_comma', lastComma);
        }

        if (char === '{' || char === '[') {
            open(char);
            continue;
        }

        if (char === '"') {
            const string = readString(text, pos);
            pos = string.end;
            stats.values += 1;
            attach({ type: 'string', value: string.value });
            continue;
        }

        if (char === '-' || char === '+' || char === '.' || (char >= '0' && char <= '9')) {
            NUMBER_LIKE.lastIndex = pos;
            const raw = NUMBER_LIKE.exec(text)[0];

            if (!NUMBER.test(raw)) {
                throw new JsonError(/^[-+]?(?:infinity|nan)$/i.test(raw) ? 'not_a_number' : 'invalid_number', pos, raw.length, { found: shorten(raw) });
            }

            const warning = precision(raw);

            if (warning) {
                warnings.push({ code: 'precision', offset: pos, params: warning });
            }

            pos += raw.length;
            stats.values += 1;
            attach({ type: 'number', raw });
            continue;
        }

        WORD.lastIndex = pos;
        const word = WORD.exec(text)?.[0];

        if (word === 'true' || word === 'false' || word === 'null') {
            pos += word.length;
            stats.values += 1;
            attach({ type: 'literal', raw: word });
            continue;
        }

        throw unexpected(text, pos, state, stack);
    }
}

/**
 * Liest einen String ab dem öffnenden Anführungszeichen. Den Wert liefert JSON.parse,
 * nachdem die Escape-Sequenzen geprüft sind – das ist schnell und dekodiert garantiert richtig.
 */
function readString(text, start) {
    let pos = start + 1;

    for (;;) {
        STRING_PLAIN.lastIndex = pos;
        STRING_PLAIN.test(text);
        pos = STRING_PLAIN.lastIndex;
        const char = text[pos];

        if (char === '"') {
            return { value: JSON.parse(text.slice(start, pos + 1)), end: pos + 1 };
        }

        // Zeilenumbruch oder Ende: Meist fehlt das schließende Anführungszeichen, deshalb auf den Anfang zeigen
        if (char === undefined || char === '\n' || char === '\r') {
            throw new JsonError('unterminated_string', start);
        }

        if (char !== '\\') {
            throw new JsonError('control_char', pos, 1, { found: controlName(char) });
        }

        const next = text[pos + 1];

        if (next === 'u') {
            const hex = /^[0-9a-fA-F]{0,4}/.exec(text.slice(pos + 2, pos + 6))[0];

            if (hex.length < 4) {
                throw new JsonError('invalid_unicode', pos, 2 + hex.length, { found: `\\u${hex}` });
            }

            pos += 6;
        } else if (next !== undefined && '"\\/bfnrt'.includes(next)) {
            pos += 2;
        } else {
            throw new JsonError('invalid_escape', pos, next === undefined || next === '\n' ? 1 : 2, { found: `\\${next === undefined || next === '\n' ? '' : codePointAt(text, pos + 1)}` });
        }
    }
}

// Ordnet ein unerwartetes Zeichen einem verständlichen Fehler zu
function unexpected(text, pos, state, stack, extra = {}) {
    const frame = stack[stack.length - 1];
    const char = text[pos];
    const found = tokenAt(text, pos);
    const length = found.length || 1;

    // Am Ende der Eingabe hinter das letzte Zeichen zeigen, nicht auf eine leere Zeile danach
    if (pos >= text.length) {
        const end = text.replace(/[ \t\n\r]+$/, '').length;

        if (frame) {
            return new JsonError('unclosed', end, 0, { open: frame.char, close: CLOSE[frame.char], line: frame.offset });
        }

        return new JsonError('expected_value', end, 0, { found: '' });
    }

    if (char === '/' && (text[pos + 1] === '/' || text[pos + 1] === '*')) {
        return new JsonError('comment', pos, 2, { found: text.slice(pos, pos + 2) });
    }

    if (char === "'") {
        return new JsonError('single_quotes', pos);
    }

    if (SMART_QUOTES.includes(char)) {
        return new JsonError('smart_quotes', pos, 1, { found: char });
    }

    if (state === AFTER) {
        if (!frame) {
            return new JsonError(char === '}' || char === ']' ? 'extra_bracket' : 'trailing_data', pos, length, { found });
        }

        if (char === '}' || char === ']') {
            return mismatched(frame, pos, char);
        }

        if ('"{[-'.includes(char) || /[\w$]/.test(char)) {
            return new JsonError('missing_comma', pos, length, { found });
        }

        return new JsonError(frame.char === '{' ? 'expected_comma_object' : 'expected_comma_array', pos, length, { found });
    }

    if (state === COLON) {
        return new JsonError('expected_colon', pos, length, { key: extra.key, found });
    }

    if (state === KEY || state === KEY_FIRST) {
        if (/[A-Za-z_$0-9]/.test(char)) {
            return new JsonError('unquoted_key', pos, length, { key: found });
        }

        if (char === ']') {
            return mismatched(frame, pos, char);
        }

        return new JsonError('expected_key', pos, length, { found });
    }

    if (frame && (char === '}' || char === ']') && char !== CLOSE[frame.char]) {
        return mismatched(frame, pos, char);
    }

    if (/[A-Za-z_$]/.test(char)) {
        const lower = found.toLowerCase();

        if (lower === 'nan' || lower === 'infinity') {
            return new JsonError('not_a_number', pos, length, { found });
        }

        // Auch Tippfehler wie "tru" oder "nul" erkennen
        const suggestion = LITERALS[lower] ?? (found.length >= 2 ? ['true', 'false', 'null'].find((literal) => literal.startsWith(lower)) : undefined);

        if (suggestion) {
            return new JsonError('invalid_literal', pos, length, { found, suggestion });
        }
    }

    return new JsonError('expected_value', pos, length, { found });
}

function mismatched(frame, pos, char) {
    return new JsonError('mismatched_bracket', pos, 1, { open: frame.char, line: frame.offset, found: char, close: CLOSE[frame.char] });
}

// Das Wort, die Zahl oder das Zeichen an einer Stelle, für die Fehlermeldung
function tokenAt(text, pos) {
    if (pos >= text.length) {
        return '';
    }

    for (const pattern of [WORD, NUMBER_LIKE]) {
        pattern.lastIndex = pos;
        const match = pattern.exec(text);

        if (match) {
            return shorten(match[0]);
        }
    }

    return codePointAt(text, pos);
}

function codePointAt(text, pos) {
    return String.fromCodePoint(text.codePointAt(pos));
}

function shorten(value) {
    return value.length > 24 ? `${value.slice(0, 24)}…` : value;
}

function controlName(char) {
    return { '\t': 'Tab', '\b': '\\b', '\f': '\\f' }[char] ?? `U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Prüft, ob eine Zahl beim Einlesen mit JavaScript (und den meisten anderen Sprachen mit double) ihren Wert ändert.
 * Ganzzahlen über 2^53, mehr als 17 signifikante Stellen oder zu große Exponenten.
 */
function precision(raw) {
    const number = Number(raw);

    if (!Number.isFinite(number)) {
        return { value: raw, rounded: number > 0 ? 'Infinity' : '-Infinity' };
    }

    if (/^-?\d+$/.test(raw)) {
        if (Number.isSafeInteger(number) || BigInt(raw) === BigInt(number)) {
            return null;
        }

        return { value: raw, rounded: BigInt(number).toString() };
    }

    // Zu kleine Zahlen wie 1e-400 werden zu 0
    if (number === 0 && /[1-9]/.test(raw.replace(/[eE].*$/, ''))) {
        return { value: shorten(raw), rounded: '0' };
    }

    const digits = raw.replace(/^-/, '').replace(/[eE].*$/, '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '');

    return digits.length > 17 ? { value: shorten(raw), rounded: String(number) } : null;
}

/**
 * Gibt den Baum als JSON aus. indent: '' = minifiziert, sonst z. B. '  ' oder '\t'.
 * Iterativ statt rekursiv, damit auch sehr tief verschachteltes JSON keinen Stacküberlauf auslöst.
 * Wird das Ergebnis länger als maxLength Zeichen (Einrückung wächst bei tiefer Verschachtelung quadratisch), gibt es einen RangeError.
 */
export function stringify(tree, { indent = '  ', sortKeys = false, maxLength = Infinity } = {}) {
    const out = [];
    let length = 0;
    const push = (part) => {
        length += part.length;

        if (length > maxLength) {
            throw new RangeError('JSON output too large');
        }

        out.push(part);
    };
    const stack = [];
    const newline = indent === '' ? '' : '\n';
    const colon = indent === '' ? ':' : ': ';
    const pads = [''];
    const pad = (depth) => {
        while (pads.length <= depth) {
            pads.push(pads[pads.length - 1] + indent);
        }

        return pads[depth];
    };

    const write = (node, depth) => {
        if (node.type === 'string') {
            push(JSON.stringify(node.value));
        } else if (node.type === 'number' || node.type === 'literal') {
            push(node.raw);
        } else if (node.type === 'array') {
            if (node.items.length === 0) {
                push('[]');
            } else {
                push('[');
                stack.push({ entries: node.items, index: 0, depth: depth + 1, close: ']', object: false });
            }
        } else if (node.entries.length === 0) {
            push('{}');
        } else {
            // Stabile Sortierung: doppelte Schlüssel behalten ihre Reihenfolge
            const entries = sortKeys ? [...node.entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : node.entries;
            push('{');
            stack.push({ entries, index: 0, depth: depth + 1, close: '}', object: true });
        }
    };

    write(tree, 0);

    while (stack.length > 0) {
        const frame = stack[stack.length - 1];

        if (frame.index === frame.entries.length) {
            stack.pop();
            push(newline + pad(frame.depth - 1) + frame.close);
            continue;
        }

        const entry = frame.entries[frame.index];
        push((frame.index > 0 ? ',' : '') + newline + pad(frame.depth));
        frame.index += 1;

        if (frame.object) {
            push(JSON.stringify(entry[0]) + colon);
            write(entry[1], frame.depth);
        } else {
            write(entry, frame.depth);
        }
    }

    return out.join('');
}

// Zeilenanfänge für die Umrechnung von Offset in Zeile und Spalte (Spalte in Zeichen, Emoji zählt als eins)
function lineIndex(text) {
    let starts = null;

    const lineOf = (offset) => {
        if (starts === null) {
            starts = [0];

            for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
                starts.push(i + 1);
            }
        }

        let low = 0;
        let high = starts.length - 1;

        while (low < high) {
            const middle = (low + high + 1) >> 1;

            if (starts[middle] <= offset) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }

        return low;
    };

    return {
        lineOf,
        start: (line) => starts[line],
        end: (line) => (line + 1 < starts.length ? starts[line + 1] - 1 : text.length),
        position(offset) {
            const line = lineOf(offset);

            return { line: line + 1, column: countCodePoints(text.slice(starts[line], offset)) + 1 };
        },
    };
}

function countCodePoints(value) {
    let count = 0;

    for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);

        if (code < 0xD800 || code > 0xDBFF || i + 1 >= value.length) {
            count += 1;
        } else {
            count += 1;
            i += 1;
        }
    }

    return count;
}

/**
 * Ausschnitt um die Fehlerstelle: die Zeile davor und die Fehlerzeile, lange Zeilen (z. B. minifiziertes JSON)
 * auf ein Fenster um die Stelle gekürzt. mark ist der markierte Text, leer am Ende der Eingabe.
 */
function excerpt(text, lines, offset, length, radius = 40) {
    const line = lines.lineOf(offset);
    const result = [];

    if (line > 0) {
        const start = lines.start(line - 1);
        const end = lines.end(line - 1);
        const value = text.slice(start, end).replace(/\r$/, '');

        if (value.trim() !== '') {
            result.push({ number: line, before: clip(value.slice(0, radius * 2), 'end'), mark: '', after: '' });
        }
    }

    const start = lines.start(line);
    const end = lines.end(line);
    const markEnd = Math.min(offset + length, end);
    result.push({
        number: line + 1,
        before: clip(text.slice(start, offset), 'start', radius),
        mark: text.slice(offset, markEnd),
        after: clip(text.slice(markEnd, end).replace(/\r$/, ''), 'end', radius),
    });

    return result;
}

// Kürzt auf radius Zeichen am Anfang oder Ende, ohne Emoji (Ersatzpaare) zu zerteilen
function clip(value, side, radius = 80) {
    if (value.length <= radius) {
        return value;
    }

    if (side === 'start') {
        let from = value.length - radius;

        if (/[\uDC00-\uDFFF]/.test(value[from])) {
            from += 1;
        }

        return `…${value.slice(from)}`;
    }

    let to = radius;

    if (/[\uD800-\uDBFF]/.test(value[to - 1])) {
        to -= 1;
    }

    return `${value.slice(0, to)}…`;
}

// Größe in Bytes (UTF-8), ohne den Text zu kopieren
export function byteLength(text) {
    let bytes = 0;

    for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);

        if (code < 0x80) {
            bytes += 1;
        } else if (code < 0x800) {
            bytes += 2;
        } else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length) {
            bytes += 4;
            i += 1;
        } else {
            bytes += 3;
        }
    }

    return bytes;
}
