/**
 * Zeichnet Favicons in beliebiger Größe – aus Text (Buchstabe, Kürzel) oder aus einem Bild.
 */

export const FONTS = {
    sans: '"Inter Variable", system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

// Pfad für Quadrat, abgerundetes Quadrat oder Kreis
function shapePath(context, size, shape) {
    context.beginPath();

    if (shape === 'circle') {
        context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    } else if (shape === 'rounded') {
        context.roundRect(0, 0, size, size, size * 0.22);
    } else {
        context.rect(0, 0, size, size);
    }
}

function drawText(context, size, options) {
    const text = options.text.trim() || 'A';
    // Längere Kürzel kleiner setzen, damit sie in das Icon passen
    const scale = [0.68, 0.62, 0.5, 0.4][Math.min(text.length, 4) - 1] * options.textScale;

    context.fillStyle = options.color;
    context.font = `${options.weight} ${Math.round(size * scale)}px ${FONTS[options.font] ?? FONTS.sans}`;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';

    // Optisch exakt mittig: anhand der tatsächlichen Glyphenhöhe statt der Schriftlinie
    const metrics = context.measureText(text);
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    const y = size / 2 + height / 2 - metrics.actualBoundingBoxDescent;

    context.fillText(text, size / 2, y);
}

function drawImage(context, size, image, padding) {
    const inner = size * (1 - padding * 2);
    const ratio = Math.min(inner / image.width, inner / image.height);
    const width = image.width * ratio;
    const height = image.height * ratio;

    context.imageSmoothingQuality = 'high';
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
}

/**
 * @param {number} size Kantenlänge in Pixeln
 * @param {object} options mode, text, font, weight, color, background, transparent, shape, padding, textScale, image
 * @param {boolean} opaque Hintergrund erzwingen (Apple-Touch-Icon darf nicht transparent sein)
 * @returns {HTMLCanvasElement}
 */
export function renderIcon(size, options, opaque = false) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');

    const transparent = options.transparent && !opaque;
    // Apple schneidet selbst Ecken ab, deshalb dort immer ein volles Quadrat
    const shape = opaque ? 'square' : options.shape;

    context.save();
    shapePath(context, size, shape);
    context.clip();

    if (!transparent) {
        context.fillStyle = options.background;
        context.fillRect(0, 0, size, size);
    }

    if (options.mode === 'image' && options.image) {
        drawImage(context, size, options.image, opaque ? Math.max(options.padding, 0.1) : options.padding);
    } else {
        drawText(context, size, options);
    }

    context.restore();

    return canvas;
}

export function canvasToPng(canvas) {
    return new Promise((resolve) => {
        canvas.toBlob(async (blob) => resolve(new Uint8Array(await blob.arrayBuffer())), 'image/png');
    });
}

const escapeXml = (text) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// Vektor-Favicon für Text; scharf in jeder Größe und mit Hell-/Dunkelmodus-tauglicher Form
export function textToSvg(options) {
    const text = escapeXml(options.text.trim() || 'A');
    const scale = [0.68, 0.62, 0.5, 0.4][Math.min(options.text.trim().length || 1, 4) - 1] * options.textScale;
    const shapes = {
        circle: '<circle cx="50" cy="50" r="50"',
        rounded: '<rect width="100" height="100" rx="22"',
        square: '<rect width="100" height="100"',
    };
    const background = options.transparent ? '' : `${shapes[options.shape] ?? shapes.square} fill="${options.background}"/>`;
    const font = (FONTS[options.font] ?? FONTS.sans).replace(/"/g, "'");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${background}`
        + `<text x="50" y="50" dy=".35em" text-anchor="middle" font-family="${font}" font-weight="${options.weight}" `
        + `font-size="${Math.round(100 * scale)}" fill="${options.color}">${text}</text></svg>`;
}

export function manifest(name, background, theme) {
    return JSON.stringify({
        name,
        short_name: name.length > 12 ? name.slice(0, 12) : name,
        icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        theme_color: theme,
        background_color: background,
        display: 'standalone',
    }, null, 4);
}

export function htmlSnippet(hasSvg) {
    return [
        '<link rel="icon" href="/favicon.ico" sizes="32x32">',
        hasSvg ? '<link rel="icon" href="/icon.svg" type="image/svg+xml">' : null,
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
        '<link rel="manifest" href="/site.webmanifest">',
    ].filter(Boolean).join('\n');
}
