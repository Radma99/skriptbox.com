/**
 * JSON Web Tokens (RFC 7519) mit Web Crypto: dekodieren, Signatur prüfen, signieren, Beispiele erzeugen.
 * Läuft im Browser und in Node (globalThis.crypto.subtle), ohne Abhängigkeiten.
 */
import { certificateToSpki, pkcs1PrivateToPkcs8, pkcs1PublicToSpki, sec1ToPkcs8 } from './der.js';
import { base64ToBytes, base64UrlDecode, base64UrlEncode, fromPem, toPem, utf8Decode, utf8Encode } from './encoding.js';

const subtle = () => globalThis.crypto.subtle;

const HASH = { 256: 'SHA-256', 384: 'SHA-384', 512: 'SHA-512' };
const CURVE = { ES256: 'P-256', ES384: 'P-384', ES512: 'P-521' };

/**
 * Parameter für Web Crypto je JWT-Algorithmus (RFC 7518).
 */
export function algorithm(alg) {
    const bits = alg.slice(2);

    if (/^HS(256|384|512)$/.test(alg)) {
        return { family: 'hmac', key: { name: 'HMAC', hash: HASH[bits] }, sign: { name: 'HMAC' } };
    }

    if (/^RS(256|384|512)$/.test(alg)) {
        return { family: 'rsa', key: { name: 'RSASSA-PKCS1-v1_5', hash: HASH[bits] }, sign: { name: 'RSASSA-PKCS1-v1_5' } };
    }

    if (/^PS(256|384|512)$/.test(alg)) {
        return { family: 'rsa', key: { name: 'RSA-PSS', hash: HASH[bits] }, sign: { name: 'RSA-PSS', saltLength: Number(bits) / 8 } };
    }

    if (/^ES(256|384|512)$/.test(alg)) {
        return { family: 'ec', curve: CURVE[alg], key: { name: 'ECDSA', namedCurve: CURVE[alg] }, sign: { name: 'ECDSA', hash: HASH[bits] } };
    }

    if (alg === 'EdDSA' || alg === 'Ed25519') {
        return { family: 'okp', key: { name: 'Ed25519' }, sign: { name: 'Ed25519' } };
    }

    return null;
}

export const ALGORITHMS = ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];

/**
 * Zerlegt ein Token und meldet Fehler je Teil, statt beim ersten Problem abzubrechen.
 *
 * @returns {{parts: string[], header: ?object, payload: ?object, errors: string[]}}
 */
export function decode(token) {
    const parts = token.trim().replace(/^Bearer\s+/i, '').split('.');
    const errors = [];
    const result = { parts, header: null, payload: null, errors };

    if (parts.length !== 3) {
        errors.push(parts.length === 5 ? 'jwe' : 'parts');

        return result;
    }

    ['header', 'payload'].forEach((name, index) => {
        try {
            const value = JSON.parse(utf8Decode(base64UrlDecode(parts[index])));

            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                throw new Error('object');
            }

            result[name] = value;
        } catch (error) {
            errors.push(error.message === 'base64url' ? `${name}_base64` : `${name}_json`);
        }
    });

    try {
        base64UrlDecode(parts[2]);
    } catch (error) {
        errors.push('signature_base64');
    }

    return result;
}

/**
 * Zeitliche Gültigkeit nach exp und nbf (mit wenigen Sekunden Toleranz wie in RFC 7519 empfohlen).
 */
export function timing(payload, now = Date.now() / 1000, leeway = 0) {
    if (!payload) {
        return [];
    }

    const notes = [];

    if (typeof payload.exp === 'number' && now > payload.exp + leeway) {
        notes.push('expired');
    }

    if (typeof payload.nbf === 'number' && now < payload.nbf - leeway) {
        notes.push('not_yet_valid');
    }

    if (typeof payload.iat === 'number' && payload.iat > now + 300) {
        notes.push('issued_in_future');
    }

    return notes;
}

function pemBytes(text) {
    const pem = fromPem(text);

    if (!pem) {
        throw new Error('key_format');
    }

    return pem;
}

/**
 * Sucht in einem JWK Set den Schlüssel zum kid aus dem Header, sonst den ersten passenden.
 */
function pickJwk(json, header, use) {
    const keys = Array.isArray(json.keys) ? json.keys : [json];
    const matching = keys.filter((key) => !header.kid || !key.kid || key.kid === header.kid);
    const jwk = matching.find((key) => !key.alg || key.alg === header.alg) ?? matching[0];

    if (!jwk) {
        throw new Error('jwk_kid');
    }

    // key_ops und use würden den Import für die jeweils andere Verwendung verhindern
    const { key_ops: keyOps, use: keyUse, ...clean } = jwk;

    return use === 'sign' ? clean : { ...clean, d: undefined, p: undefined, q: undefined, dp: undefined, dq: undefined, qi: undefined };
}

/**
 * Importiert Secret, öffentlichen oder privaten Schlüssel für Web Crypto.
 *
 * @param {'verify'|'sign'} use
 * @param {{alg: string, kid?: string}} header
 * @param {string} keyText Secret, PEM (SPKI, PKCS#1, PKCS#8, SEC1, Zertifikat) oder JWK/JWKS
 * @param {{secretBase64?: boolean}} options
 */
export async function importKey(use, header, keyText, { secretBase64 = false } = {}) {
    const params = algorithm(header.alg);

    if (!params) {
        throw new Error('alg_unsupported');
    }

    const text = keyText.trim();

    if (text === '') {
        throw new Error('key_missing');
    }

    if (params.family === 'hmac') {
        if (text.startsWith('{')) {
            const jwk = pickJwk(JSON.parse(text), header, use);

            return subtle().importKey('jwk', jwk, params.key, false, [use]);
        }

        const secret = secretBase64 ? base64ToBytes(text.replace(/-/g, '+').replace(/_/g, '/')) : utf8Encode(keyText);

        return subtle().importKey('raw', secret, params.key, false, [use]);
    }

    if (text.startsWith('{')) {
        let json;

        try {
            json = JSON.parse(text);
        } catch (error) {
            throw new Error('key_json');
        }

        return subtle().importKey('jwk', JSON.parse(JSON.stringify(pickJwk(json, header, use))), params.key, false, [use]);
    }

    const pem = pemBytes(text);

    if (use === 'verify') {
        const formats = {
            'PUBLIC KEY': () => pem.bytes,
            'RSA PUBLIC KEY': () => pkcs1PublicToSpki(pem.bytes),
            CERTIFICATE: () => certificateToSpki(pem.bytes),
        };

        if (!formats[pem.label]) {
            throw new Error(pem.label.includes('PRIVATE') ? 'key_private_for_verify' : 'key_format');
        }

        return subtle().importKey('spki', formats[pem.label](), params.key, false, ['verify']);
    }

    const formats = {
        'PRIVATE KEY': () => pem.bytes,
        'RSA PRIVATE KEY': () => pkcs1PrivateToPkcs8(pem.bytes),
        'EC PRIVATE KEY': () => sec1ToPkcs8(pem.bytes, params.curve),
    };

    if (!formats[pem.label]) {
        throw new Error(pem.label.includes('PUBLIC') || pem.label === 'CERTIFICATE' ? 'key_public_for_sign' : 'key_format');
    }

    return subtle().importKey('pkcs8', formats[pem.label](), params.key, false, ['sign']);
}

/**
 * @returns {Promise<boolean>}
 */
export async function verify(token, keyText, options = {}) {
    const { parts, header } = decode(token);

    if (!header?.alg) {
        throw new Error('header_alg');
    }

    if (header.alg === 'none') {
        throw new Error('alg_none');
    }

    const key = await importKey('verify', header, keyText, options);

    return subtle().verify(algorithm(header.alg).sign, key, base64UrlDecode(parts[2]), utf8Encode(`${parts[0]}.${parts[1]}`));
}

/**
 * Signiert Header und Payload. Der Algorithmus kommt aus header.alg.
 */
export async function sign(header, payload, keyText, options = {}) {
    const input = `${base64UrlEncode(utf8Encode(JSON.stringify(header)))}.${base64UrlEncode(utf8Encode(JSON.stringify(payload)))}`;
    const key = await importKey('sign', header, keyText, options);
    const signature = new Uint8Array(await subtle().sign(algorithm(header.alg).sign, key, utf8Encode(input)));

    return `${input}.${base64UrlEncode(signature)}`;
}

/**
 * Erzeugt Schlüssel und ein signiertes Beispiel-Token für einen Algorithmus.
 *
 * @returns {Promise<{token: string, header: object, payload: object, signKey: string, verifyKey: string}>}
 */
export async function example(alg) {
    const params = algorithm(alg);
    const now = Math.floor(Date.now() / 1000);
    const random = (size) => globalThis.crypto.getRandomValues(new Uint8Array(size));
    const header = { alg, typ: 'JWT', kid: Array.from(random(4), (byte) => byte.toString(16).padStart(2, '0')).join('') };
    const payload = {
        sub: '1234567890',
        name: 'Erika Mustermann',
        email: 'erika@musterfirma.example',
        roles: ['editor'],
        iss: 'https://auth.musterfirma.example',
        aud: 'skriptbox-demo',
        iat: now,
        nbf: now,
        exp: now + 3600,
        jti: globalThis.crypto.randomUUID(),
    };

    let signKey;
    let verifyKey;

    if (params.family === 'hmac') {
        // Secret mindestens so lang wie der Hash (RFC 7518 §3.2)
        signKey = base64UrlEncode(random(Number(alg.slice(2)) / 8));
        verifyKey = signKey;
    } else {
        const generate = params.family === 'rsa' ? { ...params.key, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) } : params.key;
        const pair = await subtle().generateKey(generate, true, ['sign', 'verify']);
        signKey = toPem(new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey)), 'PRIVATE KEY');
        verifyKey = toPem(new Uint8Array(await subtle().exportKey('spki', pair.publicKey)), 'PUBLIC KEY');
    }

    const token = await sign(header, payload, signKey, { secretBase64: params.family === 'hmac' });

    return { token, header, payload, signKey, verifyKey };
}

// Zeitangaben in Sekunden seit 1970, die als Datum angezeigt werden
export const TIME_CLAIMS = ['exp', 'nbf', 'iat', 'auth_time', 'updated_at'];
