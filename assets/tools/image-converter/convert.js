/**
 * Verkleinert und konvertiert Bilder im Browser mit Canvas.
 * Metadaten wie GPS-Position oder Kameramodell gehen dabei verloren, weil nur die Pixel übernommen werden.
 */

export const EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

async function decode(file) {
    try {
        // Dreht Handyfotos anhand der EXIF-Ausrichtung richtig herum
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (error) {
        return createImageBitmap(file);
    }
}

export function targetSize(width, height, { maxWidth, maxHeight }) {
    const scale = Math.min(
        1,
        maxWidth > 0 ? maxWidth / width : 1,
        maxHeight > 0 ? maxHeight / height : 1,
    );

    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

export function targetType(file, format) {
    if (format !== 'original') {
        return format;
    }

    return EXTENSIONS[file.type] ? file.type : 'image/png';
}

function canvas(width, height) {
    const element = document.createElement('canvas');
    element.width = width;
    element.height = height;

    return element;
}

// Starkes Verkleinern in Halbierungsschritten, sonst wirkt das Ergebnis pixelig
function resize(source, width, height) {
    let current = source;
    let currentWidth = source.width;
    let currentHeight = source.height;

    while (currentWidth / 2 > width && currentHeight / 2 > height) {
        currentWidth = Math.round(currentWidth / 2);
        currentHeight = Math.round(currentHeight / 2);

        const step = canvas(currentWidth, currentHeight);
        const context = step.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.drawImage(current, 0, 0, currentWidth, currentHeight);
        current = step;
    }

    return current;
}

export async function convert(file, { format, quality, maxWidth, maxHeight }) {
    const bitmap = await decode(file);
    const size = targetSize(bitmap.width, bitmap.height, { maxWidth, maxHeight });
    const type = targetType(file, format);

    const output = canvas(size.width, size.height);
    const context = output.getContext('2d');

    // JPG kennt keine Transparenz, transparente Flächen werden weiß statt schwarz
    if (type === 'image/jpeg') {
        context.fillStyle = '#fff';
        context.fillRect(0, 0, size.width, size.height);
    }

    context.imageSmoothingQuality = 'high';
    context.drawImage(resize(bitmap, size.width, size.height), 0, 0, size.width, size.height);

    const original = { width: bitmap.width, height: bitmap.height };
    bitmap.close();

    const blob = await new Promise((resolve) => {
        output.toBlob(resolve, type, type === 'image/png' ? undefined : quality);
    });

    // Ältere Browser liefern still PNG, wenn sie das Zielformat nicht kodieren können
    if (!blob || blob.type !== type) {
        throw new Error('unsupported-format');
    }

    return { blob, type, original, ...size };
}

export function outputName(fileName, type) {
    const base = fileName.replace(/\.[^.]+$/, '') || 'bild';

    return `${base}.${EXTENSIONS[type]}`;
}
