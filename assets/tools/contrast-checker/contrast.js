// Farbkontrast nach WCAG 2.x und APCA ohne Bibliothek. Farben sind { r, g, b, a } mit r/g/b 0–255 und a 0–1.

// CSS-Farbnamen (CSS Color Level 4), kompakt als Name und sechsstelliger Hexwert
const NAMES = Object.fromEntries(`
aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4
black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0
chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff
darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9
darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000
darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f
darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969
dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc
ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080
honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa
lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff
lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1
lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899
lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000
mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371
mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585
midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080
oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa
palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f
pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f
royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee
sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa
springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0
violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32
`.trim().split(/\s+/).reduce((pairs, value, index, list) => (index % 2 ? pairs : [...pairs, [value, list[index + 1]]]), []));

export const NAMED_COLORS = NAMES;

/**
 * Schwellen der Erfolgskriterien. Großer Text: ab 24 px bzw. ab 18,66 px fett.
 * 1.4.11 (Nicht-Text-Kontrast) hat nur eine Stufe (AA).
 */
export const CRITERIA = [
    { id: 'normal_aa', level: 'AA', sc: '1.4.3', min: 4.5 },
    { id: 'normal_aaa', level: 'AAA', sc: '1.4.6', min: 7 },
    { id: 'large_aa', level: 'AA', sc: '1.4.3', min: 3 },
    { id: 'large_aaa', level: 'AAA', sc: '1.4.6', min: 4.5 },
    { id: 'ui', level: 'AA', sc: '1.4.11', min: 3 },
];

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function number(text) {
    return NUMBER.test(text) ? Number(text) : NaN;
}

// Wert mit optionalem % (oder "none" aus der modernen Syntax); scale ist der Wert für 100 %
function component(text, scale) {
    if (text === 'none') {
        return 0;
    }

    return text.endsWith('%') ? number(text.slice(0, -1)) / 100 * scale : number(text);
}

function hue(text) {
    const match = /^(.*?)(deg|grad|rad|turn)?$/.exec(text);
    const value = number(match[1]);
    const factor = { grad: 0.9, rad: 180 / Math.PI, turn: 360 }[match[2]] ?? 1;

    return text === 'none' ? 0 : value * factor;
}

function fromHex(hex) {
    const digits = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
    const [r, g, b, a = 255] = digits.match(/../g).map((pair) => parseInt(pair, 16));

    return { r, g, b, a: a / 255 };
}

export function hslToRgb(h, s, l) {
    const channel = (n) => {
        const k = (n + h / 30) % 12;

        return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };

    return { r: channel(0) * 255, g: channel(8) * 255, b: channel(4) * 255 };
}

export function rgbToHsl({ r, g, b }) {
    const [red, green, blue] = [r / 255, g / 255, b / 255];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const l = (max + min) / 2;
    const d = max - min;

    if (d === 0) {
        return { h: 0, s: 0, l };
    }

    const s = d / (1 - Math.abs(2 * l - 1));
    let h;

    if (max === red) {
        h = ((green - blue) / d) % 6;
    } else if (max === green) {
        h = (blue - red) / d + 2;
    } else {
        h = (red - green) / d + 4;
    }

    return { h: (h * 60 + 360) % 360, s, l };
}

/**
 * Liest eine Farbe tolerant: Hex mit oder ohne # (3, 4, 6, 8 Stellen), rgb()/rgba() und hsl()/hsla()
 * in alter (Kommas) und moderner Schreibweise (Leerzeichen, / Alpha), CSS-Farbnamen und drei nackte Zahlen.
 *
 * @returns {{ r: number, g: number, b: number, a: number } | null}
 */
export function parseColor(input) {
    const text = String(input ?? '').trim().toLowerCase().replace(/;$/, '').trim();

    if (text === '') {
        return null;
    }

    if (text === 'transparent') {
        return { r: 0, g: 0, b: 0, a: 0 };
    }

    const name = text.replace(/[\s-]/g, '');

    if (Object.hasOwn(NAMES, name)) {
        return fromHex(NAMES[name]);
    }

    const hex = /^#?\s*([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);

    if (hex) {
        return fromHex(hex[1]);
    }

    // Funktion mit fehlender schließender Klammer gilt auch; ohne Funktionsnamen werden Zahlen als RGB gelesen
    const match = /^(?:(rgba?|hsla?)\s*\(([^)]*)\)?|([\d.,%\s/]+))$/.exec(text);

    if (!match) {
        return null;
    }

    const type = (match[1] ?? 'rgb').slice(0, 3);
    const [main, slashAlpha] = (match[2] ?? match[3]).split('/');
    const parts = main.split(/[\s,]+/).filter(Boolean);
    let alphaText = slashAlpha?.trim();

    if (parts.length === 4 && alphaText === undefined) {
        alphaText = parts.pop();
    }

    if (parts.length !== 3 || alphaText === '') {
        return null;
    }

    const a = alphaText === undefined ? 1 : component(alphaText, 1);
    let rgb;

    if (type === 'rgb') {
        const [r, g, b] = parts.map((part) => component(part, 255));
        rgb = { r, g, b };
    } else {
        // In hsl() sind Sättigung und Helligkeit Prozentwerte, auch wenn das % fehlt
        const [s, l] = parts.slice(1).map((part) => component(part === 'none' || part.endsWith('%') ? part : `${part}%`, 1));
        rgb = hslToRgb(((hue(parts[0]) % 360) + 360) % 360, clamp(s, 0, 1), clamp(l, 0, 1));
    }

    if ([rgb.r, rgb.g, rgb.b, a].some(Number.isNaN)) {
        return null;
    }

    // Bildschirme zeigen 8-Bit-Werte; so passen geprüfte Farbe und angezeigter Hexwert zusammen
    return {
        r: Math.round(clamp(rgb.r, 0, 255)),
        g: Math.round(clamp(rgb.g, 0, 255)),
        b: Math.round(clamp(rgb.b, 0, 255)),
        a: clamp(a, 0, 1),
    };
}

// #rrggbb, bei Transparenz #rrggbbaa
export function toHex({ r, g, b, a = 1 }) {
    const pair = (value) => Math.round(value).toString(16).padStart(2, '0');
    const alpha = Math.round(a * 255);

    return `#${pair(r)}${pair(g)}${pair(b)}${alpha < 255 ? pair(alpha) : ''}`;
}

// Halbtransparente Farbe über eine deckende legen, wie der Browser es darstellt
export function blend(top, bottom) {
    const mix = (key) => Math.round(top[key] * top.a + bottom[key] * (1 - top.a));

    return { r: mix('r'), g: mix('g'), b: mix('b'), a: 1 };
}

const WHITE = { r: 255, g: 255, b: 255, a: 1 };

/**
 * Tatsächlich sichtbare Farben: Ein transparenter Hintergrund liegt auf der weißen Seite,
 * ein transparenter Vordergrund auf dem Hintergrund.
 */
export function visibleColors(fg, bg) {
    const background = bg.a < 1 ? blend(bg, WHITE) : { ...bg, a: 1 };

    return { fg: fg.a < 1 ? blend(fg, background) : { ...fg, a: 1 }, bg: background };
}

/**
 * Relative Luminanz nach WCAG 2.x. Grenzwert 0.04045 aus IEC 61966-2-1; die 0.03928 im alten
 * WCAG-Text ergeben bei 8-Bit-Werten dasselbe Ergebnis.
 */
export function luminance({ r, g, b }) {
    const linear = (value) => {
        const c = value / 255;

        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };

    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(fg, bg) {
    const visible = visibleColors(fg, bg);
    const a = luminance(visible.fg);
    const b = luminance(visible.bg);

    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Auf zwei Stellen abschneiden statt runden: 4.499 darf nicht als 4.5 bestehen.
 * Das kleine Epsilon fängt nur Rechenungenauigkeiten wie 4.4999999999 für exakt 4.5 ab.
 */
export function truncate(ratio) {
    return Math.floor(ratio * 100 + 1e-9) / 100;
}

export function passes(ratio, min) {
    return truncate(ratio) >= min;
}

// APCA 0.0.98G-4g (Entwurf für WCAG 3). Vorzeichen: positiv = dunkle Schrift auf hellem Grund.
const APCA = {
    mainTRC: 2.4,
    sRco: 0.2126729,
    sGco: 0.7151522,
    sBco: 0.0721750,
    normBG: 0.56,
    normTXT: 0.57,
    revTXT: 0.62,
    revBG: 0.65,
    blkThrs: 0.022,
    blkClmp: 1.414,
    scaleBoW: 1.14,
    scaleWoB: 1.14,
    loBoWoffset: 0.027,
    loWoBoffset: 0.027,
    deltaYmin: 0.0005,
    loClip: 0.1,
};

function apcaY({ r, g, b }) {
    const y = APCA.sRco * (r / 255) ** APCA.mainTRC
        + APCA.sGco * (g / 255) ** APCA.mainTRC
        + APCA.sBco * (b / 255) ** APCA.mainTRC;

    // Weiche Klemmung nahe Schwarz (Streulicht des Bildschirms)
    return y > APCA.blkThrs ? y : y + (APCA.blkThrs - y) ** APCA.blkClmp;
}

export function apcaContrast(fg, bg) {
    const visible = visibleColors(fg, bg);
    const text = apcaY(visible.fg);
    const background = apcaY(visible.bg);

    if (Math.abs(background - text) < APCA.deltaYmin) {
        return 0;
    }

    if (background > text) {
        const sapc = (background ** APCA.normBG - text ** APCA.normTXT) * APCA.scaleBoW;

        return sapc < APCA.loClip ? 0 : (sapc - APCA.loBoWoffset) * 100;
    }

    const sapc = (background ** APCA.revBG - text ** APCA.revTXT) * APCA.scaleWoB;

    return sapc > -APCA.loClip ? 0 : (sapc + APCA.loWoBoffset) * 100;
}

/**
 * Nächstgelegene Farbe, die die Schwelle erreicht: nur die HSL-Helligkeit wandert, Farbton und Sättigung bleiben.
 * Gesucht wird in kleinen Schritten nach dunkler und nach heller; gewinnt die kleinere Änderung.
 * Geprüft wird jeweils die auf 8 Bit gerundete Farbe, damit der angezeigte Hexwert sicher besteht.
 *
 * @param {'fg'|'bg'} target  welche Farbe angepasst wird
 * @returns {{ color: object, ratio: number, met: boolean } | null}  null, wenn mit diesem Farbton unerreichbar
 */
export function suggest(fg, bg, min, target = 'fg') {
    const ratioWith = (color) => (target === 'fg' ? contrastRatio(color, bg) : contrastRatio(fg, color));
    const original = target === 'fg' ? fg : bg;

    if (passes(ratioWith(original), min)) {
        return { color: original, ratio: ratioWith(original), met: true };
    }

    const { h, s, l } = rgbToHsl(original);
    const step = 0.0005;
    let best = null;

    [-1, 1].forEach((direction) => {
        for (let lightness = l + direction * step; ; lightness += direction * step) {
            const value = clamp(lightness, 0, 1);
            const rgb = hslToRgb(h, s, value);
            const color = { r: Math.round(rgb.r), g: Math.round(rgb.g), b: Math.round(rgb.b), a: original.a };
            const ratio = ratioWith(color);

            if (passes(ratio, min)) {
                const distance = Math.abs(value - l);

                if (!best || distance < best.distance) {
                    best = { color, ratio, met: false, distance };
                }
                break;
            }

            if (value === 0 || value === 1) {
                break;
            }
        }
    });

    if (!best) {
        return null;
    }

    const { distance, ...result } = best;

    return result;
}

// Farben für die Adresse: Hex ohne #, damit der Hash lesbar bleibt
export function toHash(fg, bg) {
    return `fg=${toHex(fg).slice(1)}&bg=${toHex(bg).slice(1)}`;
}

export function fromHash(hash) {
    const params = new URLSearchParams(String(hash).replace(/^#/, ''));
    const read = (key) => (params.has(key) ? parseColor(params.get(key)) : null);

    return { fg: read('fg'), bg: read('bg') };
}
