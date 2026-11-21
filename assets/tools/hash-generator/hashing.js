// Prüfsummen und Hashes ohne Bibliothek. SHA-* kommt aus Web Crypto, MD5 und CRC32 sind selbst implementiert,
// weil Web Crypto sie nicht anbietet – dafür lassen sie sich blockweise berechnen (große Dateien ohne ganzen Puffer).

/**
 * Reihenfolge der Ausgabe. size: Länge in Byte, daran wird ein eingefügter Hash einem Algorithmus zugeordnet.
 * weak: nicht mehr kollisionssicher. hmac: false, wenn es dafür kein HMAC gibt.
 */
export const ALGORITHMS = [
    { id: 'md5', label: 'MD5', size: 16, weak: true },
    { id: 'sha1', label: 'SHA-1', size: 20, webCrypto: 'SHA-1', weak: true },
    { id: 'sha256', label: 'SHA-256', size: 32, webCrypto: 'SHA-256' },
    { id: 'sha384', label: 'SHA-384', size: 48, webCrypto: 'SHA-384' },
    { id: 'sha512', label: 'SHA-512', size: 64, webCrypto: 'SHA-512' },
    { id: 'crc32', label: 'CRC32', size: 4, hmac: false },
];

// Web Crypto braucht die ganze Datei auf einmal im Speicher; darüber nur MD5 und CRC32
export const SHA_LIMIT = 2 ** 30;

const CHUNK_SIZE = 4 * 2 ** 20;

// floor(abs(sin(i + 1)) * 2^32) aus RFC 1321, fest eingetragen statt berechnet, damit kein Rundungsfehler mitspielt
const MD5_K = new Int32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);

const MD5_SHIFT = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

export class Md5 {
    constructor() {
        this.state = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
        this.buffer = new Uint8Array(64);
        this.buffered = 0;
        this.length = 0;
        this.words = new Int32Array(16);
    }

    update(data) {
        let offset = 0;

        // Rest vom letzten Aufruf zuerst zu einem vollen Block auffüllen
        if (this.buffered > 0) {
            offset = Math.min(64 - this.buffered, data.length);
            this.buffer.set(data.subarray(0, offset), this.buffered);
            this.buffered += offset;

            if (this.buffered === 64) {
                this.block(this.buffer, 0);
                this.buffered = 0;
            }
        }

        for (; offset + 64 <= data.length; offset += 64) {
            this.block(data, offset);
        }

        if (offset < data.length) {
            this.buffer.set(data.subarray(offset), 0);
            this.buffered = data.length - offset;
        }

        this.length += data.length;

        return this;
    }

    digest() {
        // Länge in Bit als 64-Bit-Zahl; Bitoperatoren rechnen nur mit 32 Bit, daher in zwei Hälften
        const bits = this.length * 8;
        const padding = new Uint8Array((this.buffered < 56 ? 56 : 120) - this.buffered + 8);
        const view = new DataView(padding.buffer);
        padding[0] = 0x80;
        view.setUint32(padding.length - 8, bits % 2 ** 32, true);
        view.setUint32(padding.length - 4, Math.floor(bits / 2 ** 32), true);
        this.update(padding);

        const result = new Uint8Array(16);
        const output = new DataView(result.buffer);
        this.state.forEach((value, index) => output.setInt32(index * 4, value, true));

        return result;
    }

    block(bytes, offset) {
        const x = this.words;

        for (let i = 0; i < 16; i += 1) {
            const j = offset + i * 4;
            x[i] = bytes[j] | (bytes[j + 1] << 8) | (bytes[j + 2] << 16) | (bytes[j + 3] << 24);
        }

        let [a, b, c, d] = this.state;

        for (let i = 0; i < 64; i += 1) {
            let f;
            let g;

            if (i < 16) {
                f = (b & c) | (~b & d);
                g = i;
            } else if (i < 32) {
                f = (d & b) | (~d & c);
                g = (5 * i + 1) & 15;
            } else if (i < 48) {
                f = b ^ c ^ d;
                g = (3 * i + 5) & 15;
            } else {
                f = c ^ (b | ~d);
                g = (7 * i) & 15;
            }

            const shift = MD5_SHIFT[(i >> 4) * 4 + (i & 3)];
            const sum = (a + f + MD5_K[i] + x[g]) | 0;
            a = d;
            d = c;
            c = b;
            b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
        }

        this.state[0] += a;
        this.state[1] += b;
        this.state[2] += c;
        this.state[3] += d;
    }
}

// HMAC nach RFC 2104 mit MD5, blockweise wie Md5
export class HmacMd5 {
    constructor(key) {
        const block = new Uint8Array(64);
        block.set(key.length > 64 ? new Md5().update(key).digest() : key);

        this.inner = new Md5().update(block.map((byte) => byte ^ 0x36));
        this.outerKey = block.map((byte) => byte ^ 0x5c);
    }

    update(data) {
        this.inner.update(data);

        return this;
    }

    digest() {
        return new Md5().update(this.outerKey).update(this.inner.digest()).digest();
    }
}

const CRC32_TABLE = new Int32Array(256).map((_, index) => {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    return value;
});

// CRC-32 wie zip, gzip und PHP hash('crc32b'); Ausgabe big-endian wie dort
export class Crc32 {
    constructor() {
        this.crc = -1;
    }

    update(data) {
        let crc = this.crc;

        for (let i = 0; i < data.length; i += 1) {
            crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
        }

        this.crc = crc;

        return this;
    }

    digest() {
        const result = new Uint8Array(4);
        new DataView(result.buffer).setUint32(0, ~this.crc >>> 0);

        return result;
    }
}

function streamingHashers(key) {
    const hashers = new Map([['md5', key ? new HmacMd5(key) : new Md5()]]);

    if (!key) {
        hashers.set('crc32', new Crc32());
    }

    return hashers;
}

async function webCryptoDigest(algorithm, data, key) {
    if (!key) {
        return new Uint8Array(await crypto.subtle.digest(algorithm, data));
    }

    // Leere Schlüssel lehnt Web Crypto ab. HMAC füllt den Schlüssel ohnehin mit Nullbytes auf,
    // ein einzelnes Nullbyte ergibt deshalb exakt dasselbe Ergebnis wie ein leerer Schlüssel.
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key.length > 0 ? key : new Uint8Array(1),
        { name: 'HMAC', hash: algorithm },
        false,
        ['sign'],
    );

    return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data));
}

async function webCryptoDigests(data, key, digests) {
    for (const { id, webCrypto } of ALGORITHMS) {
        if (webCrypto) {
            digests.set(id, await webCryptoDigest(webCrypto, data, key));
        }
    }
}

/**
 * Alle Hashes für Bytes im Speicher. key: Uint8Array für HMAC oder null.
 *
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function hashBytes(data, key = null) {
    const digests = new Map();

    streamingHashers(key).forEach((hasher, id) => digests.set(id, hasher.update(data).digest()));
    await webCryptoDigests(data, key, digests);

    return digests;
}

/**
 * Alle Hashes für eine Datei (oder einen Blob), gelesen in Blöcken. Über SHA_LIMIT fehlen die SHA-Werte.
 * onProgress(gelesen, gesamt) nach jedem Block; signal (AbortSignal) bricht zwischen zwei Blöcken ab.
 *
 * @returns {Promise<{ digests: Map<string, Uint8Array>, shaSkipped: boolean }>}
 */
export async function hashFile(file, { key = null, onProgress = () => {}, signal = null, chunkSize = CHUNK_SIZE } = {}) {
    const hashers = streamingHashers(key);
    let whole = null;

    if (file.size <= SHA_LIMIT) {
        try {
            whole = new Uint8Array(file.size);
        } catch (error) {
            // Zu wenig Speicher (z. B. auf dem Handy): MD5 und CRC32 gehen trotzdem
            whole = null;
        }
    }

    for (let offset = 0; offset < file.size; offset += chunkSize) {
        signal?.throwIfAborted();

        const chunk = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
        hashers.forEach((hasher) => hasher.update(chunk));
        whole?.set(chunk, offset);
        onProgress(offset + chunk.length, file.size);
    }

    signal?.throwIfAborted();

    const digests = new Map();
    hashers.forEach((hasher, id) => digests.set(id, hasher.digest()));

    if (whole) {
        await webCryptoDigests(whole, key, digests);
    }

    return { digests, shaSkipped: !whole };
}

export function formatDigest(bytes, format = 'hex') {
    if (format === 'base64') {
        return btoa(String.fromCharCode(...bytes));
    }

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

    return format === 'upper' ? hex.toUpperCase() : hex;
}

/**
 * Mögliche Hashwerte aus einer Eingabe: einzelner Hash (auch mit Leerzeichen dazwischen), Zeilen aus
 * sha256sum/md5sum („<hash>  datei“, auch mehrere) und BSD-Format („SHA256 (datei) = <hash>“).
 */
export function expectedCandidates(text) {
    const candidates = [];

    text.split(/\r?\n/).forEach((raw) => {
        const line = raw.trim();

        if (line === '' || line.startsWith('#')) {
            return;
        }

        const bsd = line.match(/^[\w-]+\s*\(.*\)\s*=\s*(\S+)$/);

        if (bsd) {
            candidates.push(bsd[1]);

            return;
        }

        // Nur Hex mit Leerzeichen: in Gruppen geschriebener Hash. Sonst „<hash>  datei“ – sha256sum stellt
        // dabei einen Backslash voran, wenn der Dateiname Sonderzeichen enthält.
        const joined = line.replace(/\s+/g, '');
        const first = line.split(/\s+/)[0].replace(/^\\/, '');
        candidates.push(...(/^[0-9a-f\s]+$/i.test(line) ? [joined, first] : [first, joined]));
    });

    return [...new Set(candidates.map((candidate) => candidate.replace(/^0x/i, '')))];
}

/**
 * Vergleicht eine Eingabe mit berechneten Hashes. Hex ohne Rücksicht auf Groß-/Kleinschreibung, Base64 exakt.
 * sameLength: Algorithmen, zu deren Länge der eingefügte Hex-Wert passt (für einen hilfreichen Hinweis bei Abweichung).
 *
 * @returns {{ matches: string[], sameLength: string[] }|null} null bei leerer Eingabe
 */
export function compareExpected(text, digests) {
    const candidates = expectedCandidates(text);

    if (candidates.length === 0) {
        return null;
    }

    const matches = [];

    digests.forEach((bytes, id) => {
        const hex = formatDigest(bytes, 'hex');
        const base64 = formatDigest(bytes, 'base64').replace(/=+$/, '');

        if (candidates.some((candidate) => candidate.toLowerCase() === hex || candidate.replace(/=+$/, '') === base64)) {
            matches.push(id);
        }
    });

    // Erster Hex-Wert mit bekannter Länge; bei „<hash>  datei“ ist das der Hash, nicht die zusammengezogene Zeile
    const lengths = candidates
        .filter((candidate) => /^[0-9a-f]+$/i.test(candidate))
        .map((candidate) => ALGORITHMS.filter(({ size }) => size * 2 === candidate.length).map(({ id }) => id));
    const sameLength = lengths.find((ids) => ids.length > 0) ?? [];

    return { matches, sameLength };
}
