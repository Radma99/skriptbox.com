// .htpasswd-Zeilen erzeugen und prüfen: bcrypt, APR1-MD5 und SHA-1 wie Apache htpasswd
import { randomInt } from '../shared/utils.js';
import { MAX_BYTES, bcrypt, parse as parseBcrypt } from './bcrypt.js';
import { md5, sha1 } from './digest.js';

export const ALGORITHMS = ['bcrypt', 'apr1', 'sha'];
export const DEFAULT_COST = 10;

// Alphabet von crypt() für MD5-Salt und -Ergebnis
const CRYPT64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// Ohne Anführungszeichen, Backslash, Leerzeichen und Doppelpunkt, damit das Passwort auch in Shell und Konfiguration problemlos passt
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.!#%+=';

const encoder = new TextEncoder();

function concat(...parts) {
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    parts.forEach((part) => {
        result.set(part, offset);
        offset += part.length;
    });

    return result;
}

export function byteLength(text) {
    return encoder.encode(text).length;
}

export function randomSalt(length, alphabet = CRYPT64) {
    return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
}

export function bcryptSalt() {
    return crypto.getRandomValues(new Uint8Array(16));
}

export function generatePassword(length = 20) {
    return randomSalt(length, PASSWORD_CHARS);
}

/**
 * MD5-crypt nach Poul-Henning Kamp; Apache nutzt es mit dem Präfix $apr1$, Linux-crypt() mit $1$.
 * Der Salt ist höchstens 8 Zeichen lang.
 */
export function md5crypt(password, salt, magic = '$apr1$') {
    const pw = encoder.encode(password);
    const saltText = salt.slice(0, 8);
    const saltBytes = encoder.encode(saltText);
    const alternate = md5(concat(pw, saltBytes, pw));
    const parts = [pw, encoder.encode(magic), saltBytes];

    for (let length = pw.length; length > 0; length -= 16) {
        parts.push(alternate.subarray(0, Math.min(16, length)));
    }

    // Eigenheit des Originals: je nach Bit der Länge ein Nullbyte oder das erste Zeichen des Passworts
    for (let i = pw.length; i > 0; i >>= 1) {
        parts.push(i & 1 ? new Uint8Array(1) : pw.subarray(0, 1));
    }

    let digest = md5(concat(...parts));

    // 1000 Runden, damit Durchprobieren teurer wird – nach heutigen Maßstäben trotzdem schnell
    for (let i = 0; i < 1000; i++) {
        digest = md5(concat(
            i & 1 ? pw : digest,
            i % 3 ? saltBytes : new Uint8Array(0),
            i % 7 ? pw : new Uint8Array(0),
            i & 1 ? digest : pw,
        ));
    }

    const to64 = (value, count) => {
        let result = '';

        for (let i = 0; i < count; i++) {
            result += CRYPT64[value & 0x3f];
            value >>= 6;
        }

        return result;
    };

    const d = digest;
    const encoded = to64((d[0] << 16) | (d[6] << 8) | d[12], 4)
        + to64((d[1] << 16) | (d[7] << 8) | d[13], 4)
        + to64((d[2] << 16) | (d[8] << 8) | d[14], 4)
        + to64((d[3] << 16) | (d[9] << 8) | d[15], 4)
        + to64((d[4] << 16) | (d[10] << 8) | d[5], 4)
        + to64(d[11], 2);

    return `${magic}${saltText}$${encoded}`;
}

export function sha(password) {
    return `{SHA}${btoa(String.fromCharCode(...sha1(encoder.encode(password))))}`;
}

/**
 * Hash für eine .htpasswd-Zeile.
 *
 * @param {{ algorithm: string, cost?: number, salt?: Uint8Array|string, onProgress?: Function }} options
 *        salt nur für Tests; ohne wird ein zufälliger erzeugt
 */
export function createHash(password, { algorithm = 'bcrypt', cost = DEFAULT_COST, salt, onProgress } = {}) {
    if (algorithm === 'apr1') {
        return md5crypt(password, salt ?? randomSalt(8));
    }

    if (algorithm === 'sha') {
        return sha(password);
    }

    return bcrypt(password, cost, salt ?? bcryptSalt(), '2y', onProgress);
}

/**
 * Erkennt das Verfahren eines Hashs. Unbekannte Formate (z. B. crypt-DES oder Klartext) ergeben null.
 *
 * @returns {{ algorithm: string, cost?: number } | null}
 */
export function identify(hash) {
    const bcryptParts = parseBcrypt(hash);

    if (bcryptParts) {
        return { algorithm: 'bcrypt', cost: bcryptParts.cost };
    }

    if (/^\$(apr1|1)\$[^$]{0,8}\$[./0-9A-Za-z]{22}$/.test(hash)) {
        return { algorithm: hash.startsWith('$1$') ? 'md5' : 'apr1' };
    }

    if (/^\{SHA\}[A-Za-z0-9+/]{27}=$/.test(hash)) {
        return { algorithm: 'sha' };
    }

    return null;
}

/**
 * Trennt eine .htpasswd-Zeile in Benutzer und Hash. Ohne Doppelpunkt gilt die ganze Eingabe als Hash.
 */
export function parseLine(line) {
    const text = line.trim();
    const colon = text.indexOf(':');

    return colon === -1 ? { user: '', hash: text } : { user: text.slice(0, colon), hash: text.slice(colon + 1) };
}

/**
 * Prüft ein Passwort gegen einen Hash, indem der Hash mit demselben Salt neu berechnet wird.
 *
 * @returns {boolean|null} null, wenn das Format unbekannt ist
 */
export function verify(hash, password, onProgress = null) {
    const type = identify(hash);

    if (!type) {
        return null;
    }

    if (type.algorithm === 'bcrypt') {
        const { prefix, cost, salt } = parseBcrypt(hash);

        // Salt neu kodieren statt durchreichen: bei abweichenden Füllbits im 22. Zeichen rechnet crypt() genauso
        return bcrypt(password, cost, salt, prefix, onProgress).slice(29) === hash.slice(29);
    }

    if (type.algorithm === 'sha') {
        return sha(password) === hash;
    }

    const magic = type.algorithm === 'md5' ? '$1$' : '$apr1$';
    const salt = hash.slice(magic.length, hash.lastIndexOf('$'));

    return md5crypt(password, salt, magic) === hash;
}

/**
 * Hinweise zu einem Benutzer: fehlender oder ungültiger Name, leeres oder für bcrypt zu langes Passwort.
 *
 * @returns {string[]} Schlüssel der Hinweise
 */
export function problems({ user, password }, algorithm) {
    const result = [];

    if (user === '') {
        result.push('user_empty');
    } else if (/[:\r\n]/.test(user)) {
        result.push('user_invalid');
    } else if (byteLength(user) > 255) {
        result.push('user_long');
    }

    if (password === '') {
        result.push('password_empty');
    } else if (algorithm === 'bcrypt' && byteLength(password) > MAX_BYTES) {
        result.push('password_long');
    }

    return result;
}

function quote(value) {
    return `"${value.replace(/["\\]/g, '\\$&')}"`;
}

// Pfade mit Leerzeichen müssen in Apache und nginx in Anführungszeichen stehen
function path(value) {
    return /[\s"';{}#]/.test(value) ? quote(value) : value;
}

export function apacheConfig({ realm, file }) {
    return [
        'AuthType Basic',
        `AuthName ${quote(realm)}`,
        `AuthUserFile ${path(file)}`,
        'Require valid-user',
    ].join('\n');
}

export function nginxConfig({ realm, file }) {
    return [
        `auth_basic ${quote(realm)};`,
        `auth_basic_user_file ${path(file)};`,
    ].join('\n');
}

export function isAbsolutePath(value) {
    return /^(\/|[A-Za-z]:[\\/])/.test(value);
}
