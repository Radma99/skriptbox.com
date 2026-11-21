// Prozent-Kodierung (URL-Encoding) ohne Bibliothek. Alle Varianten arbeiten auf den UTF-8-Bytes des Textes.

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Varianten: Zeichen, die unverändert bleiben, und ob Leerzeichen zu "+" werden.
 * code: Funktionen, die genau dasselbe Ergebnis liefern (zum Nachbauen im eigenen Projekt).
 */
export const VARIANTS = {
    // RFC 3986, nur "unreserved" bleibt stehen; wie PHP rawurlencode(), sicher für Passwörter in URLs
    rfc3986: {
        safe: `${ALNUM}-_.~`,
        code: [
            ['PHP', 'rawurlencode($value)'],
            ['Python', "urllib.parse.quote(value, safe='')"],
            ['JavaScript', "encodeURIComponent(value).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())"],
        ],
    },
    // application/x-www-form-urlencoded wie PHP urlencode(): Leerzeichen als +, ~ wird kodiert
    form: {
        safe: `${ALNUM}-_.`,
        spacePlus: true,
        code: [['PHP', 'urlencode($value)']],
    },
    component: {
        safe: `${ALNUM}-_.!~*'()`,
        code: [
            ['JavaScript', 'encodeURIComponent(value)'],
            ['Python', "urllib.parse.quote(value, safe=\"!'()*\")"],
        ],
    },
    // Ganze Adresse: Trennzeichen wie / ? # & = bleiben stehen
    uri: {
        safe: `${ALNUM}-_.!~*'();,/?:@&=+$#`,
        code: [['JavaScript', 'encodeURI(value)']],
    },
    all: {
        safe: '',
        code: [],
    },
};

const encoder = new TextEncoder();

function hex(byte, lowercase) {
    const value = byte.toString(16).padStart(2, '0');

    return `%${lowercase ? value : value.toUpperCase()}`;
}

/**
 * Kodiert einen Text. Ergebnis: kodierter Text und die kodierten Zeichen (je Zeichen einmal, in Reihenfolge).
 *
 * @returns {{ text: string, encoded: Array<{ char: string, code: string }> }}
 */
export function encode(text, { variant = 'rfc3986', lowercase = false } = {}) {
    const { safe, spacePlus = false } = VARIANTS[variant] ?? VARIANTS.rfc3986;
    const encoded = new Map();
    let result = '';

    // Zeichenweise (nicht byteweise), damit die Liste z. B. "€ → %E2%82%AC" zeigen kann
    for (const char of text) {
        if (char.length === 1 && safe.includes(char)) {
            result += char;
            continue;
        }

        const code = char === ' ' && spacePlus ? '+' : Array.from(encoder.encode(char), (byte) => hex(byte, lowercase)).join('');
        result += code;

        if (!encoded.has(char)) {
            encoded.set(char, code);
        }
    }

    return { text: result, encoded: Array.from(encoded, ([char, code]) => ({ char, code })) };
}

/**
 * Dekodiert %XX-Folgen (UTF-8). Ungültige Folgen bleiben stehen und werden gemeldet.
 *
 * @returns {{ text: string, problems: string[] }} problems: invalid_percent, invalid_utf8, double_encoded
 */
export function decode(text, { plusAsSpace = false } = {}) {
    const bytes = [];
    const problems = new Set();

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];

        if (char === '%') {
            const pair = text.slice(i + 1, i + 3);

            if (/^[0-9a-fA-F]{2}$/.test(pair)) {
                bytes.push(parseInt(pair, 16));
                i += 2;
                continue;
            }

            problems.add('invalid_percent');
        }

        if (char === '+' && plusAsSpace) {
            bytes.push(0x20);
            continue;
        }

        // Ersatzpaare (z. B. Emoji) zusammenhalten
        const codePoint = text.codePointAt(i);
        const full = String.fromCodePoint(codePoint);
        bytes.push(...encoder.encode(full));
        i += full.length - 1;
    }

    const data = new Uint8Array(bytes);
    let result;

    try {
        result = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch (error) {
        result = new TextDecoder('utf-8').decode(data);
        problems.add('invalid_utf8');
    }

    // Steht nach dem Dekodieren noch %XX da, war der Text vermutlich doppelt kodiert (z. B. %2540 statt %40)
    if (/%[0-9a-fA-F]{2}/.test(result)) {
        problems.add('double_encoded');
    }

    return { text: result, problems: Array.from(problems) };
}

// Wendet eine Funktion auf jede Zeile an (\n und \r\n bleiben erhalten)
export function perLine(text, callback) {
    return text.split(/(\r?\n)/).map((part, index) => (index % 2 === 1 ? part : callback(part)));
}

/**
 * Setzt eine Verbindungs-URL zusammen, z. B. mysql://user:p%40ss@localhost:3306/app.
 * Benutzer, Passwort und die Abschnitte des Pfads werden nach RFC 3986 kodiert, Host und Parameter bleiben unverändert.
 */
export function connectionUrl({ scheme, user, password, host, port, path, query }) {
    const part = (value) => encode(value).text;
    let auth = '';

    if (user !== '' || password !== '') {
        auth = `${part(user)}${password !== '' ? `:${part(password)}` : ''}@`;
    }

    const segments = path.replace(/^\/+/, '');
    const encodedPath = segments !== '' ? `/${segments.split('/').map(part).join('/')}` : '';
    const params = query.replace(/^\?+/, '');

    return `${scheme.replace(/:\/*$/, '')}://${auth}${host}${port !== '' ? `:${port}` : ''}${encodedPath}${params !== '' ? `?${params}` : ''}`;
}
