/**
 * Base64url (RFC 4648 §5), UTF-8 und PEM. Keine Abhängigkeiten.
 */

export function bytesToBase64(bytes) {
    let binary = '';

    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }

    return btoa(binary);
}

export function base64ToBytes(base64) {
    const binary = atob(base64.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

export function base64UrlEncode(bytes) {
    return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text) {
    if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
        throw new Error('base64url');
    }

    const base64 = text.replace(/-/g, '+').replace(/_/g, '/');

    return base64ToBytes(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

export const utf8Encode = (text) => new TextEncoder().encode(text);

export const utf8Decode = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

export function toPem(bytes, label) {
    const lines = bytesToBase64(bytes).match(/.{1,64}/g).join('\n');

    return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

/**
 * @returns {{label: string, bytes: Uint8Array}|null}
 */
export function fromPem(text) {
    const match = text.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]+?)-----END \1-----/);

    return match ? { label: match[1], bytes: base64ToBytes(match[2]) } : null;
}
