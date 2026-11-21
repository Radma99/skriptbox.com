// Base64 (RFC 4648) ohne btoa/atob: arbeitet auf Bytes, damit Umlaute, Emoji und Dateien korrekt bleiben.

const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Wert je Zeichen für beide Alphabete; -1 = kein Base64-Zeichen
const VALUES = (() => {
    const table = new Int8Array(128).fill(-1);
    [...STANDARD].forEach((char, index) => { table[char.charCodeAt(0)] = index; });
    table['-'.charCodeAt(0)] = 62;
    table['_'.charCodeAt(0)] = 63;

    return table;
})();

// MIME (RFC 2045) bricht nach 76 Zeichen um
export const MIME_LINE = 76;

/**
 * Funktionen, die dasselbe Ergebnis liefern (zum Nachbauen im eigenen Projekt).
 * Schlüssel: Modus und Variante, bei base64url zusätzlich mit/ohne Padding.
 */
export const CODE = {
    'encode-standard': [
        ['PHP', 'base64_encode($value)'],
        ['JavaScript', "btoa(Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(''))"],
        ['Node.js', "Buffer.from(value).toString('base64')"],
        ['Python', 'base64.b64encode(value.encode()).decode()'],
    ],
    'encode-url': [
        ['PHP', "rtrim(strtr(base64_encode($value), '+/', '-_'), '=')"],
        ['Node.js', "Buffer.from(value).toString('base64url')"],
        ['Python', "base64.urlsafe_b64encode(value.encode()).rstrip(b'=').decode()"],
    ],
    'encode-url-padded': [
        ['PHP', "strtr(base64_encode($value), '+/', '-_')"],
        ['Python', 'base64.urlsafe_b64encode(value.encode()).decode()'],
    ],
    'decode-standard': [
        ['PHP', 'base64_decode($value, true)'],
        ['Node.js', "Buffer.from(value, 'base64').toString()"],
        ['Python', 'base64.b64decode(value).decode()'],
    ],
    'decode-url': [
        ['PHP', "base64_decode(strtr($value, '-_', '+/'))"],
        ['Node.js', "Buffer.from(value, 'base64url').toString()"],
        ['Python', "base64.urlsafe_b64decode(value + '=' * (-len(value) % 4)).decode()"],
    ],
};

// Bytes → Text in Blöcken; String.fromCharCode mit sehr vielen Argumenten sprengt sonst den Stack
function asciiToString(codes) {
    let result = '';

    for (let i = 0; i < codes.length; i += 0x8000) {
        result += String.fromCharCode.apply(null, codes.subarray(i, i + 0x8000));
    }

    return result;
}

export function wrapLines(text, width = MIME_LINE) {
    const lines = [];

    for (let i = 0; i < text.length; i += width) {
        lines.push(text.slice(i, i + width));
    }

    return lines.join('\n');
}

/**
 * @param {Uint8Array} bytes
 * @param {{ urlSafe?: boolean, padding?: boolean, wrap?: boolean }} options
 */
export function encodeBytes(bytes, { urlSafe = false, padding = true, wrap = false } = {}) {
    const alphabet = urlSafe ? URL_SAFE : STANDARD;
    const codes = Uint8Array.from(alphabet, (char) => char.charCodeAt(0));
    const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4);
    let o = 0;
    let i = 0;

    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out[o++] = codes[n >> 18];
        out[o++] = codes[(n >> 12) & 63];
        out[o++] = codes[(n >> 6) & 63];
        out[o++] = codes[n & 63];
    }

    const rest = bytes.length - i;

    if (rest > 0) {
        const n = (bytes[i] << 16) | (rest === 2 ? bytes[i + 1] << 8 : 0);
        out[o++] = codes[n >> 18];
        out[o++] = codes[(n >> 12) & 63];
        out[o++] = rest === 2 ? codes[(n >> 6) & 63] : 61;
        out[o++] = 61;
    }

    let text = asciiToString(out);

    if (!padding) {
        text = text.replace(/=+$/, '');
    }

    return wrap ? wrapLines(text) : text;
}

export function encodeText(text, options) {
    return encodeBytes(new TextEncoder().encode(text), options);
}

// Data-URI ohne ;base64 (z. B. data:image/svg+xml,%3Csvg…) enthält %-kodierten Text
function percentToBytes(text) {
    const encoder = new TextEncoder();
    const bytes = [];

    for (let i = 0; i < text.length; i += 1) {
        const pair = text.slice(i + 1, i + 3);

        if (text[i] === '%' && /^[0-9a-fA-F]{2}$/.test(pair)) {
            bytes.push(parseInt(pair, 16));
            i += 2;
            continue;
        }

        const full = String.fromCodePoint(text.codePointAt(i));
        bytes.push(...encoder.encode(full));
        i += full.length - 1;
    }

    return new Uint8Array(bytes);
}

/**
 * Dekodiert Base64, base64url oder eine Data-URI. Leerzeichen und Zeilenumbrüche werden übersprungen.
 *
 * problems: { key, level: 'error'|'warning'|'info', params }
 *   error   invalid_chars (params.chars: bis zu fünf Zeichen), padding_position (bytes ist dann null)
 *   warning length, padding_invalid, trailing_bits, mixed
 *   info    whitespace, padding_missing, data_uri, data_uri_plain
 *
 * @returns {{ bytes: Uint8Array|null, mime: string|null, urlSafe: boolean, problems: object[] }}
 */
export function decodeBase64(input) {
    const problems = [];
    const add = (key, level, params = {}) => problems.push({ key, level, params });
    let body = input;
    let offset = 0;
    let mime = null;

    const dataUri = /^\s*data:([^,]*),/i.exec(input);

    if (dataUri) {
        const params = dataUri[1].split(';').map((part) => part.trim());
        mime = params[0] || 'text/plain';
        body = input.slice(dataUri[0].length);
        offset = dataUri[0].length;

        if (!params.some((part) => part.toLowerCase() === 'base64')) {
            add('data_uri_plain', 'info', { mime });

            return { bytes: percentToBytes(body), mime, urlSafe: false, problems };
        }

        add('data_uri', 'info', { mime });
    }

    // Höchstens ein Wert je Zeichen; typisiert, weil Dateien schnell mehrere Megabyte groß sind
    const values = new Uint8Array(body.length);
    let count = 0;
    const invalid = [];
    let firstInvalid = 0;
    let firstPadding = 0;
    let misplaced = false;
    let whitespace = false;
    let padding = 0;
    let standardChars = false;
    let urlChars = false;
    let position = offset;

    // Zeichenweise nach Codepoints, damit die Stellenangabe auch nach Emoji stimmt
    for (const char of body) {
        position += 1;
        const code = char.codePointAt(0);
        const value = code < 128 ? VALUES[code] : -1;

        if (value >= 0) {
            misplaced ||= padding > 0;

            values[count++] = value;
            standardChars ||= char === '+' || char === '/';
            urlChars ||= char === '-' || char === '_';
        } else if (char === '=') {
            padding += 1;
            firstPadding ||= position;
        } else if (/\s/.test(char)) {
            whitespace = true;
        } else {
            if (!invalid.includes(char) && invalid.length < 5) {
                invalid.push(char);
            }

            firstInvalid ||= position;
        }
    }

    if (whitespace) {
        add('whitespace', 'info');
    }

    if (invalid.length > 0) {
        add('invalid_chars', 'error', { chars: invalid, position: firstInvalid });
    }

    if (misplaced) {
        add('padding_position', 'error', { position: firstPadding });
    }

    if (problems.some((problem) => problem.level === 'error')) {
        return { bytes: null, mime, urlSafe: urlChars, problems };
    }

    if (standardChars && urlChars) {
        add('mixed', 'warning');
    }

    // Ein einzelnes Zeichen am Ende trägt nur 6 Bit und ergibt kein Byte
    if (count % 4 === 1) {
        add('length', 'warning');
        count -= 1;
    }

    const rest = count % 4;
    const expected = rest === 0 ? 0 : 4 - rest;

    if (padding === 0 && expected > 0) {
        add('padding_missing', 'info');
    } else if (padding !== expected) {
        add('padding_invalid', 'warning', { found: padding, expected });
    }

    const bytes = new Uint8Array(Math.floor((count * 3) / 4));
    let b = 0;
    let i = 0;

    for (; i + 3 < count; i += 4) {
        const n = (values[i] << 18) | (values[i + 1] << 12) | (values[i + 2] << 6) | values[i + 3];
        bytes[b++] = n >> 16;
        bytes[b++] = (n >> 8) & 255;
        bytes[b++] = n & 255;
    }

    if (rest >= 2) {
        const n = (values[i] << 18) | (values[i + 1] << 12) | (rest === 3 ? values[i + 2] << 6 : 0);
        bytes[b++] = n >> 16;

        if (rest === 3) {
            bytes[b++] = (n >> 8) & 255;
        }

        // Übrige Bits des letzten Zeichens müssen 0 sein, sonst wurde der Text verändert
        const last = values[count - 1];

        if ((rest === 2 && (last & 15) !== 0) || (rest === 3 && (last & 3) !== 0)) {
            add('trailing_bits', 'warning');
        }
    }

    return { bytes, mime, urlSafe: urlChars, problems };
}

export function decodeUtf8(bytes) {
    try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), valid: true };
    } catch (error) {
        return { text: new TextDecoder('utf-8').decode(bytes), valid: false };
    }
}

const startsWith = (bytes, signature, at = 0) => signature.every((byte, index) => bytes[at + index] === byte);
const ascii = (text) => Array.from(text, (char) => char.charCodeAt(0));

// Erkennung an den ersten Bytes ("Magic Numbers"). text: Inhalt ist Text und kann als solcher angezeigt werden.
const SIGNATURES = [
    { label: 'PNG', ext: 'png', mime: 'image/png', test: (b) => startsWith(b, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) },
    { label: 'JPEG', ext: 'jpg', mime: 'image/jpeg', test: (b) => startsWith(b, [0xFF, 0xD8, 0xFF]) },
    { label: 'GIF', ext: 'gif', mime: 'image/gif', test: (b) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a')) },
    { label: 'WebP', ext: 'webp', mime: 'image/webp', test: (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8) },
    { label: 'AVIF', ext: 'avif', mime: 'image/avif', test: (b) => startsWith(b, ascii('ftypavi'), 4) },
    { label: 'HEIC', ext: 'heic', mime: 'image/heic', test: (b) => startsWith(b, ascii('ftyphei'), 4) || startsWith(b, ascii('ftypmif1'), 4) },
    { label: 'BMP', ext: 'bmp', mime: 'image/bmp', test: (b) => startsWith(b, ascii('BM')) && b.length > 26 && startsWith(b, [0, 0, 0, 0], 6) },
    { label: 'ICO', ext: 'ico', mime: 'image/x-icon', test: (b) => startsWith(b, [0, 0, 1, 0]) && b.length > 6 },
    { label: 'PDF', ext: 'pdf', mime: 'application/pdf', test: (b) => startsWith(b, ascii('%PDF-')) },
    { label: 'ZIP', ext: 'zip', mime: 'application/zip', test: (b) => startsWith(b, [0x50, 0x4B, 0x03, 0x04]) || startsWith(b, [0x50, 0x4B, 0x05, 0x06]) },
    { label: 'GZIP', ext: 'gz', mime: 'application/gzip', test: (b) => startsWith(b, [0x1F, 0x8B]) },
    { label: '7-Zip', ext: '7z', mime: 'application/x-7z-compressed', test: (b) => startsWith(b, [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]) },
    { label: 'WOFF2', ext: 'woff2', mime: 'font/woff2', test: (b) => startsWith(b, ascii('wOF2')) },
    { label: 'WOFF', ext: 'woff', mime: 'font/woff', test: (b) => startsWith(b, ascii('wOFF')) },
    { label: 'TrueType', ext: 'ttf', mime: 'font/ttf', test: (b) => startsWith(b, [0, 1, 0, 0, 0]) },
    { label: 'OpenType', ext: 'otf', mime: 'font/otf', test: (b) => startsWith(b, ascii('OTTO')) },
    { label: 'MP3', ext: 'mp3', mime: 'audio/mpeg', test: (b) => startsWith(b, ascii('ID3')) || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) },
    { label: 'WAV', ext: 'wav', mime: 'audio/wav', test: (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WAVE'), 8) },
    { label: 'Ogg', ext: 'ogg', mime: 'audio/ogg', test: (b) => startsWith(b, ascii('OggS')) },
    { label: 'MP4', ext: 'mp4', mime: 'video/mp4', test: (b) => startsWith(b, ascii('ftyp'), 4) },
    { label: 'WebM', ext: 'webm', mime: 'video/webm', test: (b) => startsWith(b, [0x1A, 0x45, 0xDF, 0xA3]) },
];

/**
 * @returns {{ label: string, ext: string, mime: string, text?: boolean }|null}
 */
export function detectType(bytes) {
    const match = SIGNATURES.find((signature) => signature.test(bytes));

    if (match) {
        return { label: match.label, ext: match.ext, mime: match.mime };
    }

    const { text, valid } = decodeUtf8(bytes.subarray(0, 4096));

    // Abgeschnittenes Mehrbyte-Zeichen am Ende der Stichprobe ist kein Fehler
    if (!valid && !(bytes.length > 4096 && decodeUtf8(bytes.subarray(0, 4093)).valid)) {
        return null;
    }

    const start = text.replace(/^﻿/, '').trimStart();

    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(start)) {
        return { label: 'SVG', ext: 'svg', mime: 'image/svg+xml', text: true };
    }

    if (/^[{[]/.test(start)) {
        try {
            JSON.parse(decodeUtf8(bytes).text);

            return { label: 'JSON', ext: 'json', mime: 'application/json', text: true };
        } catch (error) {
            // kein JSON, weiter als Text
        }
    }

    if (/^<(!doctype html|html)[\s>]/i.test(start)) {
        return { label: 'HTML', ext: 'html', mime: 'text/html', text: true };
    }

    return bytes.length > 0 ? { label: 'Text', ext: 'txt', mime: 'text/plain', text: true } : null;
}

// Übliche Dateiendung zu einem MIME-Typ, z. B. aus einer Data-URI
export function extensionFor(mime) {
    const match = SIGNATURES.find((signature) => signature.mime === mime);
    const known = { 'image/svg+xml': 'svg', 'application/json': 'json', 'text/html': 'html', 'text/plain': 'txt', 'text/css': 'css' };

    return match?.ext ?? known[mime] ?? 'bin';
}

// Anzeigbar als <img>: was Browser zuverlässig darstellen (HEIC nur Safari, daher nicht)
export function isPreviewable(mime) {
    return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon', 'image/svg+xml'].includes(mime);
}

/**
 * Hex-Ansicht wie `xxd`: Offset, 16 Bytes, ASCII.
 */
export function hexDump(bytes, limit = 4096) {
    const lines = [];
    const end = Math.min(bytes.length, limit);

    for (let i = 0; i < end; i += 16) {
        const row = bytes.subarray(i, Math.min(i + 16, end));
        const hex = Array.from(row, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
        const text = Array.from(row, (byte) => (byte >= 0x20 && byte < 0x7F ? String.fromCharCode(byte) : '.')).join('');
        lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${text}`);
    }

    return lines.join('\n');
}

/**
 * Fertige Schnipsel für eine Datei: reines Base64, Data-URI, CSS und HTML.
 */
export function snippet(format, base64, mime) {
    const uri = `data:${mime};base64,${base64}`;

    switch (format) {
        case 'datauri':
            return uri;
        case 'css':
            return `background-image: url("${uri}");`;
        case 'img':
            return `<img src="${uri}" alt="">`;
        default:
            return base64;
    }
}
