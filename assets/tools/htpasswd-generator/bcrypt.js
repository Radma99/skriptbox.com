// bcrypt ($2y$, $2b$, $2a$) nach dem Original von Provos und Mazières: Blowfish mit teurem Schlüsselaufbau (eksblowfish)
import PI from './pi.js';

// Eigenes Base64-Alphabet von bcrypt, nicht kompatibel mit dem üblichen Base64
const ALPHABET = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const MAX_BYTES = 72;
export const MIN_COST = 4;
export const MAX_COST = 31;

const INITIAL = Uint32Array.from({ length: PI.length / 8 }, (_, i) => parseInt(PI.slice(i * 8, i * 8 + 8), 16));

// "OrpheanBeholderScryDoubt" als sechs 32-Bit-Wörter: der Text, den bcrypt am Ende 64-mal verschlüsselt
const MAGIC = [0x4f727068, 0x65616e42, 0x65686f6c, 0x64657253, 0x63727944, 0x6f756274];

export function encode(bytes, length) {
    let result = '';
    let i = 0;

    while (i < length) {
        const c1 = bytes[i++];
        result += ALPHABET[c1 >> 2];
        let c2 = (c1 & 0x03) << 4;

        if (i >= length) {
            result += ALPHABET[c2];
            break;
        }

        const c3 = bytes[i++];
        c2 |= c3 >> 4;
        result += ALPHABET[c2];
        let c4 = (c3 & 0x0f) << 2;

        if (i >= length) {
            result += ALPHABET[c4];
            break;
        }

        const c5 = bytes[i++];
        c4 |= c5 >> 6;
        result += ALPHABET[c4] + ALPHABET[c5 & 0x3f];
    }

    return result;
}

export function decode(text, length) {
    const bytes = new Uint8Array(length);
    const values = Array.from(text, (char) => ALPHABET.indexOf(char));
    let i = 0;
    let j = 0;

    if (values.includes(-1)) {
        throw new Error('invalid salt');
    }

    while (j < length) {
        const [a, b, c = 0, d = 0] = values.slice(i, i + 4);
        i += 4;
        bytes[j++] = (a << 2) | (b >> 4);

        if (j < length) {
            bytes[j++] = ((b & 0x0f) << 4) | (c >> 2);
        }

        if (j < length) {
            bytes[j++] = ((c & 0x03) << 6) | d;
        }
    }

    return bytes;
}

class Blowfish {
    constructor() {
        this.p = INITIAL.slice(0, 18);
        this.s = INITIAL.slice(18);
        this.block = new Uint32Array(2);
    }

    // Verschlüsselt this.block an Ort und Stelle (16 Feistel-Runden)
    encipher() {
        const { p, s, block } = this;
        let left = block[0];
        let right = block[1];

        left ^= p[0];

        for (let i = 1; i < 17; i += 2) {
            right ^= (((s[left >>> 24] + s[0x100 | ((left >>> 16) & 0xff)]) ^ s[0x200 | ((left >>> 8) & 0xff)]) + s[0x300 | (left & 0xff)]) ^ p[i];
            left ^= (((s[right >>> 24] + s[0x100 | ((right >>> 16) & 0xff)]) ^ s[0x200 | ((right >>> 8) & 0xff)]) + s[0x300 | (right & 0xff)]) ^ p[i + 1];
        }

        block[0] = right ^ p[17];
        block[1] = left;
    }

    // Schlüssel (und optional Salt) zyklisch in P-Array und S-Boxen einarbeiten
    expand(key, salt) {
        const { p, s, block } = this;
        let k = 0;
        let n = 0;

        for (let i = 0; i < 18; i++) {
            p[i] ^= key[k++ % key.length];
        }

        block[0] = 0;
        block[1] = 0;

        const next = (target, i) => {
            if (salt) {
                block[0] ^= salt[n++ % salt.length];
                block[1] ^= salt[n++ % salt.length];
            }

            this.encipher();
            target[i] = block[0];
            target[i + 1] = block[1];
        };

        for (let i = 0; i < 18; i += 2) {
            next(p, i);
        }

        for (let i = 0; i < 1024; i += 2) {
            next(s, i);
        }
    }
}

// Bytefolge als 32-Bit-Wörter (big endian), dabei zyklisch auf ein Vielfaches von 4 Byte aufgefüllt – wie stream2word im Original
function toWords(bytes) {
    const count = bytes.length;
    const length = count % 4 === 0 ? count / 4 : count;

    return Uint32Array.from({ length }, (_, i) => {
        const offset = i * 4;

        return ((bytes[offset % count] << 24) | (bytes[(offset + 1) % count] << 16) | (bytes[(offset + 2) % count] << 8) | bytes[(offset + 3) % count]) >>> 0;
    });
}

/**
 * Passwort-Bytes für bcrypt: UTF-8 plus abschließendes Nullbyte, höchstens 72 Byte.
 * Alles dahinter ignoriert bcrypt.
 */
export function keyBytes(password) {
    const bytes = new TextEncoder().encode(password);
    const key = new Uint8Array(Math.min(bytes.length + 1, MAX_BYTES));
    key.set(bytes.subarray(0, key.length));

    return key;
}

/**
 * Berechnet einen bcrypt-Hash.
 *
 * @param {string} password
 * @param {number} cost 4–31, Rechenaufwand 2^cost
 * @param {Uint8Array} salt 16 zufällige Bytes
 * @param {string} prefix '2y' (Apache, PHP), '2b' oder '2a'
 * @param {(share: number) => void} [onProgress] wird gelegentlich mit dem erledigten Anteil (0–1) aufgerufen
 */
export function bcrypt(password, cost, salt, prefix = '2y', onProgress = null) {
    if (!Number.isInteger(cost) || cost < MIN_COST || cost > MAX_COST) {
        throw new RangeError('cost');
    }

    const key = toWords(keyBytes(password));
    const saltWords = toWords(salt);
    const state = new Blowfish();
    const rounds = 2 ** cost;
    // Etwa 64 Rückmeldungen je Hash: oft genug für einen flüssigen Balken, selten genug, um nicht zu bremsen
    const step = Math.max(1, rounds >>> 6);

    state.expand(key, saltWords);

    for (let i = 0; i < rounds; i++) {
        state.expand(key);
        state.expand(saltWords);

        if (onProgress && (i + 1) % step === 0) {
            onProgress((i + 1) / rounds);
        }
    }

    const text = Uint32Array.from(MAGIC);

    for (let j = 0; j < text.length; j += 2) {
        state.block[0] = text[j];
        state.block[1] = text[j + 1];

        for (let i = 0; i < 64; i++) {
            state.encipher();
        }

        text[j] = state.block[0];
        text[j + 1] = state.block[1];
    }

    const output = new Uint8Array(24);
    text.forEach((word, i) => {
        output[i * 4] = word >>> 24;
        output[i * 4 + 1] = (word >>> 16) & 0xff;
        output[i * 4 + 2] = (word >>> 8) & 0xff;
        output[i * 4 + 3] = word & 0xff;
    });

    // Das letzte Byte fehlt im Ergebnis seit jeher (23 statt 24 Byte → 31 Zeichen)
    return `$${prefix}$${String(cost).padStart(2, '0')}$${encode(salt, 16)}${encode(output, 23)}`;
}

/**
 * Zerlegt einen bcrypt-Hash in Präfix, Kosten und Salt.
 *
 * @returns {{ prefix: string, cost: number, salt: Uint8Array } | null}
 */
export function parse(hash) {
    const match = /^\$(2[aby])\$(\d\d)\$([./A-Za-z0-9]{22})[./A-Za-z0-9]{31}$/.exec(hash);
    const cost = match ? Number(match[2]) : 0;

    if (!match || cost < MIN_COST || cost > MAX_COST) {
        return null;
    }

    return { prefix: match[1], cost, salt: decode(match[3], 16) };
}
