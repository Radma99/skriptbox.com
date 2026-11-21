// UUIDs (RFC 9562) und ULIDs ohne Bibliothek. Zufall ausschließlich aus crypto.getRandomValues.

const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

// Crockford Base32 ohne I, L, O und U, damit nichts verwechselt wird
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const NAMESPACES = {
    dns: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    url: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
    oid: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
    x500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
};

export const NIL = '00000000-0000-0000-0000-000000000000';
export const MAX = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

// 100-ns-Schritte zwischen dem Beginn des Gregorianischen Kalenders (v1/v6) und 1970
const GREGORIAN_OFFSET = 122192928000000000n;

function randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
}

function toUuid(bytes) {
    const hex = Array.from(bytes, (byte) => HEX[byte]).join('');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function setVersion(bytes, version) {
    bytes[6] = (bytes[6] & 0x0f) | (version << 4);
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    return bytes;
}

function writeTimestamp(bytes, ms) {
    for (let i = 5; i >= 0; i -= 1) {
        bytes[i] = ms % 256;
        ms = Math.floor(ms / 256);
    }
}

export function v4() {
    return toUuid(setVersion(randomBytes(16), 4));
}

/**
 * UUID v7 mit 12-Bit-Zähler in rand_a (RFC 9562, 6.2 Methode 1). Pro neuer Millisekunde startet der Zähler
 * zufällig in der unteren Hälfte, damit Platz zum Hochzählen bleibt. Läuft er über oder geht die Uhr zurück,
 * wird die Millisekunde der vorigen ID weiterverwendet bzw. vorgezogen – die Reihenfolge bleibt streng aufsteigend.
 */
export function createV7(now = () => Date.now()) {
    let lastMs = -1;
    let counter = 0;

    return () => {
        const ms = now();

        if (ms > lastMs) {
            lastMs = ms;
            const [high, low] = randomBytes(2);
            counter = ((high << 8) | low) & 0x7ff;
        } else if (counter < 0xfff) {
            counter += 1;
        } else {
            lastMs += 1;
            counter = 0;
        }

        const bytes = randomBytes(16);
        writeTimestamp(bytes, lastMs);
        bytes[6] = 0x70 | (counter >> 8);
        bytes[7] = counter & 0xff;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;

        return toUuid(bytes);
    };
}

function encodeCrockford(value, length) {
    let result = '';

    for (let i = 0; i < length; i += 1) {
        result = CROCKFORD[Number(value & 31n)] + result;
        value >>= 5n;
    }

    return result;
}

/**
 * ULID nach https://github.com/ulid/spec, monoton: In derselben Millisekunde wird der 80-Bit-Zufallsteil
 * um 1 erhöht. Statt beim (praktisch unmöglichen) Überlauf abzubrechen, rückt die Zeit um 1 ms vor.
 */
export function createUlid(now = () => Date.now()) {
    const limit = (1n << 80n) - 1n;
    let lastMs = -1;
    let random = 0n;

    return () => {
        const ms = now();

        if (ms > lastMs) {
            lastMs = ms;
            random = randomBytes(10).reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
        } else if (random < limit) {
            random += 1n;
        } else {
            lastMs += 1;
            random = 0n;
        }

        return encodeCrockford(BigInt(lastMs), 10) + encodeCrockford(random, 16);
    };
}

function uuidBytes(uuid) {
    const hex = uuid.replace(/-/g, '');

    return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

// Namensbasierte UUID v5: SHA-1 über Namespace-Bytes und UTF-8-Namen, gekürzt auf 128 Bit
export async function v5(namespace, name) {
    const data = new Uint8Array([...uuidBytes(namespace), ...new TextEncoder().encode(name)]);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data));

    return toUuid(setVersion(hash.slice(0, 16), 5));
}

/**
 * Darstellung einer UUID; ULIDs sind laut Spezifikation immer großgeschrieben und ohne Trennzeichen.
 */
export function formatId(id, { uppercase = false, hyphens = true, braces = false } = {}) {
    if (id.length === 26) {
        return id;
    }

    let result = hyphens ? id : id.replace(/-/g, '');
    result = uppercase ? result.toUpperCase() : result;

    return braces ? `{${result}}` : result;
}

export function formatList(ids, format) {
    switch (format) {
        case 'json':
            return JSON.stringify(ids, null, 2);
        case 'sql':
            return `VALUES\n${ids.map((id) => `    ('${id}')`).join(',\n')};`;
        case 'csv':
            return ids.join(',');
        default:
            return ids.join('\n');
    }
}

// Normalisiert Eingaben wie "{6BA7B810-…}", "urn:uuid:…" oder eine UUID ohne Bindestriche
export function normalize(input) {
    return input.trim().replace(/^urn:uuid:/i, '').replace(/^\{(.*)\}$/s, '$1').trim();
}

function isoFromTicks(ticks) {
    // Ticks in 100 ns seit 1970; Date kennt nur Millisekunden, die restlichen vier Stellen hängen wir an
    const ms = ticks >= 0n ? ticks / 10000n : -((-ticks + 9999n) / 10000n);
    const rest = ticks - ms * 10000n;

    return {
        date: new Date(Number(ms)),
        iso: new Date(Number(ms)).toISOString().replace('Z', `${rest.toString().padStart(4, '0')}Z`),
    };
}

function decodeUlid(value) {
    const upper = value.toUpperCase();

    if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(upper)) {
        return null;
    }

    let number = 0n;
    for (const char of upper) {
        number = (number << 5n) | BigInt(CROCKFORD.indexOf(char));
    }

    const hex = number.toString(16).padStart(32, '0');
    const date = new Date(Number(number >> 80n));

    return {
        valid: true,
        type: 'ulid',
        canonical: upper,
        uuid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
        date,
        iso: date.toISOString(),
    };
}

/**
 * Prüft und zerlegt eine UUID oder ULID.
 *
 * @returns {{ valid: boolean, type?: 'uuid'|'ulid', canonical?: string, version?: number, variant?: string,
 *             special?: 'nil'|'max', date?: Date, iso?: string, node?: string, uuid?: string }}
 */
export function inspect(input) {
    const value = normalize(input);

    if (value.length === 26) {
        return decodeUlid(value) ?? { valid: false };
    }

    if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(value)
        || (value.includes('-') && value.length !== 36)) {
        return { valid: false };
    }

    const hex = value.replace(/-/g, '').toLowerCase();
    const canonical = toUuid(uuidBytes(hex));
    const result = { valid: true, type: 'uuid', canonical };

    if (canonical === NIL || canonical === MAX) {
        return { ...result, special: canonical === NIL ? 'nil' : 'max' };
    }

    const variantBits = parseInt(hex[16], 16);
    result.variant = variantBits < 8 ? 'ncs' : variantBits < 12 ? 'rfc' : variantBits < 14 ? 'microsoft' : 'future';

    // Die Versionsnummer ist nur bei der Variante nach RFC 9562 definiert
    if (result.variant !== 'rfc') {
        return result;
    }

    result.version = parseInt(hex[12], 16);

    if (result.version === 1 || result.version === 6) {
        const ticks = result.version === 1
            ? BigInt(`0x${hex.slice(13, 16)}${hex.slice(8, 12)}${hex.slice(0, 8)}`)
            : BigInt(`0x${hex.slice(0, 12)}${hex.slice(13, 16)}`);
        Object.assign(result, isoFromTicks(ticks - GREGORIAN_OFFSET));
        result.node = hex.slice(20).match(/../g).join(':');
    } else if (result.version === 7) {
        result.date = new Date(parseInt(hex.slice(0, 12), 16));
        result.iso = result.date.toISOString();
    }

    return result;
}
