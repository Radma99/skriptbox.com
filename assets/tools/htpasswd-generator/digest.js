// MD5 und SHA-1 für Bytefolgen. Synchron und ohne Web Crypto, weil crypto.subtle nur über HTTPS bereitsteht
// und APR1 tausend MD5-Runden hintereinander braucht.

function rotl(value, bits) {
    return (value << bits) | (value >>> (32 - bits));
}

// Nachricht auf ein Vielfaches von 64 Byte auffüllen: 0x80, Nullen, Länge in Bit (MD5 little, SHA-1 big endian)
function pad(bytes, littleEndian) {
    const length = (((bytes.length + 8) >> 6) + 1) * 64;
    const padded = new Uint8Array(length);
    const view = new DataView(padded.buffer);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    view.setUint32(length - (littleEndian ? 8 : 4), bytes.length * 8, littleEndian);
    view.setUint32(length - (littleEndian ? 4 : 8), Math.floor(bytes.length / 0x20000000), littleEndian);

    return view;
}

const MD5_SHIFT = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0);

export function md5(bytes) {
    const view = pad(bytes, true);
    const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    const words = new Int32Array(16);

    for (let offset = 0; offset < view.byteLength; offset += 64) {
        for (let i = 0; i < 16; i++) {
            words[i] = view.getInt32(offset + i * 4, true);
        }

        let [a, b, c, d] = state;

        for (let i = 0; i < 64; i++) {
            let f;
            let g;

            if (i < 16) {
                f = (b & c) | (~b & d);
                g = i;
            } else if (i < 32) {
                f = (d & b) | (~d & c);
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                f = b ^ c ^ d;
                g = (3 * i + 5) % 16;
            } else {
                f = c ^ (b | ~d);
                g = (7 * i) % 16;
            }

            const next = d;
            d = c;
            c = b;
            b = (b + rotl((a + f + MD5_K[i] + words[g]) | 0, MD5_SHIFT[(i >> 4) * 4 + (i % 4)])) | 0;
            a = next;
        }

        state[0] = (state[0] + a) | 0;
        state[1] = (state[1] + b) | 0;
        state[2] = (state[2] + c) | 0;
        state[3] = (state[3] + d) | 0;
    }

    const result = new DataView(new ArrayBuffer(16));
    state.forEach((value, i) => result.setInt32(i * 4, value, true));

    return new Uint8Array(result.buffer);
}

export function sha1(bytes) {
    const view = pad(bytes, false);
    const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    const words = new Int32Array(80);

    for (let offset = 0; offset < view.byteLength; offset += 64) {
        for (let i = 0; i < 16; i++) {
            words[i] = view.getInt32(offset + i * 4, false);
        }

        for (let i = 16; i < 80; i++) {
            words[i] = rotl(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);
        }

        let [a, b, c, d, e] = state;

        for (let i = 0; i < 80; i++) {
            let f;
            let k;

            if (i < 20) {
                f = (b & c) | (~b & d);
                k = 0x5a827999;
            } else if (i < 40) {
                f = b ^ c ^ d;
                k = 0x6ed9eba1;
            } else if (i < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8f1bbcdc;
            } else {
                f = b ^ c ^ d;
                k = 0xca62c1d6;
            }

            const temp = (rotl(a, 5) + f + e + k + words[i]) | 0;
            e = d;
            d = c;
            c = rotl(b, 30);
            b = a;
            a = temp;
        }

        state[0] = (state[0] + a) | 0;
        state[1] = (state[1] + b) | 0;
        state[2] = (state[2] + c) | 0;
        state[3] = (state[3] + d) | 0;
        state[4] = (state[4] + e) | 0;
    }

    const result = new DataView(new ArrayBuffer(20));
    state.forEach((value, i) => result.setInt32(i * 4, value, false));

    return new Uint8Array(result.buffer);
}
