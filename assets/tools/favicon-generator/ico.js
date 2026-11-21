/**
 * Schreibt eine .ico-Datei mit mehreren Größen. Die Bilder werden als PNG eingebettet,
 * das unterstützen alle aktuellen Browser und Windows ab Vista.
 *
 * @param {{size: number, png: Uint8Array}[]} images
 * @returns {Uint8Array}
 */
export function createIco(images) {
    const headerSize = 6 + images.length * 16;
    const total = headerSize + images.reduce((sum, image) => sum + image.png.length, 0);
    const bytes = new Uint8Array(total);
    const view = new DataView(bytes.buffer);

    view.setUint16(0, 0, true); // reserviert
    view.setUint16(2, 1, true); // Typ 1 = Icon
    view.setUint16(4, images.length, true);

    let offset = headerSize;

    images.forEach(({ size, png }, index) => {
        const entry = 6 + index * 16;
        view.setUint8(entry, size >= 256 ? 0 : size); // 0 steht für 256
        view.setUint8(entry + 1, size >= 256 ? 0 : size);
        view.setUint8(entry + 2, 0); // keine Farbpalette
        view.setUint8(entry + 3, 0);
        view.setUint16(entry + 4, 1, true); // Farbebenen
        view.setUint16(entry + 6, 32, true); // Bit pro Pixel
        view.setUint32(entry + 8, png.length, true);
        view.setUint32(entry + 12, offset, true);

        bytes.set(png, offset);
        offset += png.length;
    });

    return bytes;
}
