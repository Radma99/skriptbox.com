/**
 * Minimales DER (ASN.1) zum Umverpacken von Schlüsseln, damit Web Crypto sie importieren kann:
 * PKCS#1 → SPKI/PKCS#8, SEC1 → PKCS#8 und der öffentliche Schlüssel aus einem X.509-Zertifikat.
 */

const OID = {
    rsaEncryption: [0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01],
    ecPublicKey: [0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01],
    'P-256': [0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07],
    'P-384': [0x06, 0x05, 0x2B, 0x81, 0x04, 0x00, 0x22],
    'P-521': [0x06, 0x05, 0x2B, 0x81, 0x04, 0x00, 0x23],
};

function length(size) {
    if (size < 0x80) {
        return [size];
    }

    const bytes = [];

    for (let value = size; value > 0; value >>= 8) {
        bytes.unshift(value & 0xFF);
    }

    return [0x80 | bytes.length, ...bytes];
}

function tlv(tag, content) {
    return Uint8Array.from([tag, ...length(content.length), ...content]);
}

const concat = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part]));
const sequence = (...parts) => tlv(0x30, concat(...parts));
const NULL = Uint8Array.from([0x05, 0x00]);

// Ein Element lesen: Tag, Inhalt und Position des nächsten Elements
export function read(bytes, offset = 0) {
    const tag = bytes[offset];
    let size = bytes[offset + 1];
    let start = offset + 2;

    if (size & 0x80) {
        const count = size & 0x7F;
        size = 0;

        for (let i = 0; i < count; i += 1) {
            size = (size * 256) + bytes[start + i];
        }

        start += count;
    }

    if (start + size > bytes.length) {
        throw new Error('der');
    }

    return { tag, start, end: start + size, offset };
}

function children(bytes, element) {
    const list = [];

    for (let offset = element.start; offset < element.end;) {
        const child = read(bytes, offset);
        list.push(child);
        offset = child.end;
    }

    return list;
}

export function pkcs1PublicToSpki(pkcs1) {
    return sequence(sequence(Uint8Array.from(OID.rsaEncryption), NULL), tlv(0x03, concat([0x00], pkcs1)));
}

export function pkcs1PrivateToPkcs8(pkcs1) {
    return sequence(Uint8Array.from([0x02, 0x01, 0x00]), sequence(Uint8Array.from(OID.rsaEncryption), NULL), tlv(0x04, pkcs1));
}

export function sec1ToPkcs8(sec1, curve) {
    return sequence(Uint8Array.from([0x02, 0x01, 0x00]), sequence(Uint8Array.from(OID.ecPublicKey), Uint8Array.from(OID[curve])), tlv(0x04, sec1));
}

// Certificate → tbsCertificate → [version], serial, signature, issuer, validity, subject, subjectPublicKeyInfo
export function certificateToSpki(certificate) {
    const tbs = children(certificate, read(certificate))[0];
    const fields = children(certificate, tbs);
    const index = fields[0].tag === 0xA0 ? 6 : 5;
    const spki = fields[index];

    if (!spki || spki.tag !== 0x30) {
        throw new Error('certificate');
    }

    return certificate.slice(spki.offset, spki.end);
}
