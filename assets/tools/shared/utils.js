// Kleine Helfer, die mehrere Tools nutzen

export function debounce(callback, delay) {
    let timer;

    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => callback(...args), delay);
    };
}

// Gleichverteilte Zufallszahl in [0, max) aus Web Crypto, ohne Modulo-Verzerrung
export function randomInt(max) {
    const limit = Math.floor(0x100000000 / max) * max;
    const buffer = new Uint32Array(1);

    do {
        crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);

    return buffer[0] % max;
}

// Kopiert Text und zeigt kurz eine Bestätigung im Button
export async function copyToClipboard(button, text, copiedLabel) {
    await navigator.clipboard.writeText(text);

    const label = button.textContent;
    button.textContent = copiedLabel;
    button.disabled = true;

    setTimeout(() => {
        button.textContent = label;
        button.disabled = false;
    }, 1500);
}

export function formatBytes(bytes, locale) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;

    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }

    const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 });

    return `${formatter.format(value)} ${units[unit]}`;
}

export function readI18n(root, attribute = 'i18n') {
    try {
        return JSON.parse(root.dataset[attribute] || '{}');
    } catch (error) {
        return {};
    }
}
