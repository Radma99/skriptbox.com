/**
 * Minimaler ZIP-Packer ohne Kompression ("stored"). Reicht für Downloads mit mehreren Dateien
 * und wird von allen Betriebssystemen geöffnet. Spezifikation: PKWARE APPNOTE.TXT.
 */

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);

    for (let n = 0; n < 256; n += 1) {
        let c = n;

        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        }

        table[n] = c >>> 0;
    }

    return table;
})();

export function crc32(bytes) {
    let crc = 0xFFFFFFFF;

    for (let i = 0; i < bytes.length; i += 1) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Datum und Uhrzeit im DOS-Format, wie ZIP es erwartet
function dosDateTime(date) {
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
}

async function toBytes(data) {
    if (data instanceof Uint8Array) {
        return data;
    }

    if (data instanceof Blob) {
        return new Uint8Array(await data.arrayBuffer());
    }

    return new TextEncoder().encode(String(data));
}

/**
 * @param {{name: string, data: Blob|Uint8Array|string}[]} files
 * @returns {Promise<Blob>}
 */
export async function createZip(files) {
    const encoder = new TextEncoder();
    const { time, date } = dosDateTime(new Date());
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
        const name = encoder.encode(file.name);
        const data = await toBytes(file.data);
        const crc = crc32(data);

        // Local file header (30 Bytes + Name)
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034B50, true);
        local.setUint16(4, 20, true); // benötigte Version 2.0
        local.setUint16(6, 0x0800, true); // Dateinamen in UTF-8
        local.setUint16(8, 0, true); // keine Kompression
        local.setUint16(10, time, true);
        local.setUint16(12, date, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);

        localParts.push(new Uint8Array(local.buffer), name, data);

        // Eintrag im zentralen Verzeichnis (46 Bytes + Name)
        const central = new DataView(new ArrayBuffer(46));
        central.setUint32(0, 0x02014B50, true);
        central.setUint16(4, 20, true);
        central.setUint16(6, 20, true);
        central.setUint16(8, 0x0800, true);
        central.setUint16(10, 0, true);
        central.setUint16(12, time, true);
        central.setUint16(14, date, true);
        central.setUint32(16, crc, true);
        central.setUint32(20, data.length, true);
        central.setUint32(24, data.length, true);
        central.setUint16(28, name.length, true);
        central.setUint32(42, offset, true);

        centralParts.push(new Uint8Array(central.buffer), name);
        offset += 30 + name.length + data.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);

    // End of central directory record (22 Bytes)
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054B50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...localParts, ...centralParts, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

export function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
