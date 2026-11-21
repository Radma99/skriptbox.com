// Unix-Timestamps umrechnen ohne Bibliothek. Zeitpunkte werden als BigInt in Nanosekunden geführt,
// damit Mikro- und Nanosekunden exakt bleiben; Zeitzonen kommen aus Intl.

export const UNITS = { s: 1_000_000_000n, ms: 1_000_000n, us: 1_000n, ns: 1n };

// Größter Abstand zu 1970, den Date darstellen kann (±100 Mio. Tage)
const MAX_MS = 8_640_000_000_000_000;

// Grenzen des vorzeichenbehafteten 32-Bit-time_t (Jahr-2038-Problem)
export const INT32_MAX = 2_147_483_647n;
export const INT32_MIN = -2_147_483_648n;

// Gängige Zonen unter ihren aktuellen Namen, auch als Ersatz, falls der Browser Intl.supportedValuesOf nicht kennt
const FALLBACK_ZONES = [
    'UTC', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi', 'America/Anchorage',
    'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Chicago', 'America/Denver', 'America/Halifax',
    'America/Los_Angeles', 'America/Mexico_City', 'America/New_York', 'America/Phoenix', 'America/Santiago',
    'America/Sao_Paulo', 'America/St_Johns', 'America/Toronto', 'Asia/Bangkok', 'Asia/Dhaka', 'Asia/Dubai',
    'Asia/Hong_Kong', 'Asia/Jakarta', 'Asia/Jerusalem', 'Asia/Karachi', 'Asia/Kathmandu', 'Asia/Kolkata',
    'Asia/Manila', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tehran', 'Asia/Tokyo',
    'Atlantic/Azores', 'Atlantic/Reykjavik', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Darwin',
    'Australia/Perth', 'Australia/Sydney', 'Europe/Amsterdam', 'Europe/Athens', 'Europe/Berlin', 'Europe/Istanbul',
    'Europe/Kyiv', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Moscow', 'Europe/Paris',
    'Europe/Rome', 'Europe/Stockholm', 'Europe/Vienna', 'Europe/Warsaw', 'Europe/Zurich', 'Pacific/Auckland',
    'Pacific/Chatham', 'Pacific/Honolulu',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (value, length = 2) => String(value).padStart(length, '0');

// Ganzzahlige Division mit Abrundung Richtung −∞, auch für negative Zeitpunkte vor 1970
function floorDiv(a, b) {
    const q = a / b;

    return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q;
}

function floorMod(a, b) {
    return a - floorDiv(a, b) * b;
}

// Einheit nach Größenordnung: 1e11 Sekunden wären das Jahr 5138, 1e11 Millisekunden erst 1973
export function detectUnit(integer) {
    const abs = integer < 0n ? -integer : integer;

    if (abs < 100_000_000_000n) {
        return 's';
    }
    if (abs < 100_000_000_000_000n) {
        return 'ms';
    }

    return abs < 100_000_000_000_000_000n ? 'us' : 'ns';
}

/**
 * Liest einen Timestamp, z. B. "1700000000", "-86400", "1700000000.5" oder "1 700 000 000 123".
 *
 * @returns {null|{ error: string }|{ ns: bigint, unit: string, detected: string }}
 */
export function parseTimestamp(text, unit = 'auto') {
    const clean = text.trim().replace(/[\s_'’]/g, '').replace(',', '.');

    if (clean === '') {
        return null;
    }

    const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(clean);

    if (!match) {
        return { error: 'invalid' };
    }

    const [, sign, digits, fraction = ''] = match;
    const integer = BigInt(`${sign}${digits}`);
    const detected = detectUnit(integer);
    const used = UNITS[unit] ? unit : detected;
    const scale = 10n ** BigInt(fraction.length);
    const magnitude = (BigInt(digits) * scale + BigInt(fraction || '0')) * UNITS[used];
    // Bruchteile unter einer Nanosekunde fallen weg, gerundet wird wie bei floor() Richtung Vergangenheit
    const ns = floorDiv(sign === '-' ? -magnitude : magnitude, scale);

    if (Math.abs(Number(floorDiv(ns, UNITS.ms))) > MAX_MS) {
        return { error: 'range', unit: used, detected };
    }

    return { ns, unit: used, detected };
}

export function fromMilliseconds(ms) {
    return BigInt(Math.floor(ms)) * UNITS.ms;
}

export function toMilliseconds(ns) {
    return Number(floorDiv(ns, UNITS.ms));
}

// Der Wert in allen Einheiten, ganzzahlig abgerundet (wie floor() bzw. intdiv bei positiven Werten)
export function inUnits(ns) {
    return Object.fromEntries(Object.entries(UNITS).map(([unit, factor]) => [unit, floorDiv(ns, factor)]));
}

const partFormatters = new Map();

function partFormatter(timeZone) {
    if (!partFormatters.has(timeZone)) {
        partFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            era: 'short',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
        }));
    }

    return partFormatters.get(timeZone);
}

// Date.UTC deutet zweistellige Jahre als 19xx, setUTCFullYear nicht
function utcFromFields({ year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 }) {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, millisecond);

    return date.getTime();
}

/**
 * Datum und Uhrzeit eines Zeitpunkts in einer Zone plus Offset in Sekunden.
 * Der Offset ergibt sich aus der Differenz von Wanduhrzeit und UTC – so stimmen auch historische Offsets wie +00:53:28.
 */
export function zonedFields(ms, timeZone) {
    const second = Math.floor(ms / 1000) * 1000;
    const parts = Object.fromEntries(partFormatter(timeZone).formatToParts(new Date(second)).map(({ type, value }) => [type, value]));
    const year = Number(parts.year);
    const fields = {
        year: parts.era === 'BC' || parts.era === 'B' ? 1 - year : year,
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
        second: Number(parts.second),
        millisecond: ms - second,
    };

    return { ...fields, offset: (utcFromFields({ ...fields, millisecond: 0 }) - second) / 1000 };
}

export function offsetSeconds(ms, timeZone) {
    return zonedFields(ms, timeZone).offset;
}

/**
 * Offset als ±HH:MM. withSeconds zeigt historische Sekunden-Offsets an;
 * ohne werden sie wie bei PHP (Format P/O) abgeschnitten.
 */
export function formatOffset(offset, { separator = ':', withSeconds = false } = {}) {
    const abs = Math.abs(offset);
    const sign = offset < 0 ? '-' : '+';
    const seconds = abs % 60;
    let result = `${sign}${pad(Math.floor(abs / 3600))}${separator}${pad(Math.floor(abs / 60) % 60)}`;

    if (withSeconds && seconds !== 0) {
        result += `${separator}${pad(seconds)}`;
    }

    return result;
}

function formatYear(year) {
    // ISO 8601 erweitert Jahre außerhalb von 0000–9999 auf sechs Stellen mit Vorzeichen
    if (year >= 0 && year <= 9999) {
        return pad(year, 4);
    }

    return `${year < 0 ? '-' : '+'}${pad(Math.abs(year), 6)}`;
}

// Nachkommastellen der Sekunde in Dreiergruppen (.123, .123456, .123456789), ohne Bruchteil gar nicht
function formatFraction(ns) {
    const nanos = floorMod(ns, UNITS.s);

    if (nanos === 0n) {
        return '';
    }

    let digits = pad(nanos, 9);

    while (digits.endsWith('000')) {
        digits = digits.slice(0, -3);
    }

    return `.${digits}`;
}

function wallString(fields, ns, dateTimeSeparator = 'T') {
    const date = `${formatYear(fields.year)}-${pad(fields.month)}-${pad(fields.day)}`;

    return `${date}${dateTimeSeparator}${pad(fields.hour)}:${pad(fields.minute)}:${pad(fields.second)}${formatFraction(ns)}`;
}

// ISO 8601 in UTC wie Date.prototype.toISOString, aber mit beliebiger Genauigkeit
export function formatIso(ns) {
    return `${wallString(zonedFields(toMilliseconds(ns), 'UTC'), ns)}Z`;
}

// RFC 3339 mit Offset der Zone, entspricht PHP DATE_RFC3339 (plus Bruchteile, falls vorhanden)
export function formatRfc3339(ns, timeZone) {
    const fields = zonedFields(toMilliseconds(ns), timeZone);

    return `${wallString(fields, ns)}${formatOffset(fields.offset)}`;
}

// RFC 2822 wie PHP DATE_RFC2822: "Fri, 20 Nov 2026 13:34:56 +0100" (Namen immer englisch)
export function formatRfc2822(ns, timeZone) {
    const fields = zonedFields(toMilliseconds(ns), timeZone);
    const weekday = DAYS[new Date(utcFromFields(fields)).getUTCDay()];

    return `${weekday}, ${pad(fields.day)} ${MONTHS[fields.month - 1]} ${pad(fields.year, 4)} `
        + `${pad(fields.hour)}:${pad(fields.minute)}:${pad(fields.second)} ${formatOffset(fields.offset, { separator: '' })}`;
}

// "2026-03-29 02:30:00" – Wanduhrzeit ohne Zone, wie sie MySQL, PostgreSQL und date erwarten
export function formatWall(fields) {
    return wallString(fields, 0n, ' ');
}

/** Kalenderwoche nach ISO 8601: Woche mit dem ersten Donnerstag ist Woche 1, Wochen beginnen montags. */
export function isoWeek({ year, month, day }) {
    const date = new Date(utcFromFields({ year, month, day }));
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - weekday);
    const weekYear = date.getUTCFullYear();
    const week = Math.ceil(((date.getTime() - utcFromFields({ year: weekYear, month: 1, day: 1 })) / 86_400_000 + 1) / 7);

    return { week, year: weekYear, weekday, label: `${formatYear(weekYear)}-W${pad(week)}-${weekday}` };
}

export function dayOfYear({ year, month, day }) {
    const start = utcFromFields({ year, month: 1, day: 1 });

    return {
        day: (utcFromFields({ year, month, day }) - start) / 86_400_000 + 1,
        days: (utcFromFields({ year: year + 1, month: 1, day: 1 }) - start) / 86_400_000,
    };
}

const RELATIVE_STEPS = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30.436875],
    ['month', 12],
    ['year', Infinity],
];

/** "vor 3 Tagen" / "in 2 Monaten" über Intl.RelativeTimeFormat */
export function relativeTime(ms, now, locale) {
    let value = (ms - now) / 1000;

    for (const [unit, size] of RELATIVE_STEPS) {
        if (Math.abs(value) < size || unit === 'year') {
            const rounded = Math.round(value);

            // Auf eine volle Einheit gerundet ("vor 60 Sekunden") lieber zur nächsten wechseln
            if (Math.abs(rounded) < size || unit === 'year') {
                return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(rounded, unit);
            }
        }

        value /= size;
    }

    return '';
}

/**
 * Wanduhrzeit in einer Zone → Zeitpunkt. Prüft die Offsets kurz vor und nach der Uhrzeit und erkennt so
 * Lücken (Uhr wird vorgestellt, Uhrzeit gibt es nicht) und Doppelungen (Uhr wird zurückgestellt).
 *
 * @returns {{ ms: number, status: 'ok'|'gap'|'ambiguous', earlier?: number, later?: number, before?: number, after?: number }}
 *   ms folgt wie PHP, Python und Temporal bei Lücken dem Offset vor der Umstellung (02:30 → 03:30)
 *   und nimmt bei Doppelungen das erste Vorkommen.
 */
export function zonedToEpoch(fields, timeZone) {
    const wall = utcFromFields(fields);
    const day = 86_400_000;
    // Zwei Tage Abstand reichen auch für Samoa, das 2011 einen ganzen Tag übersprungen hat
    const before = offsetSeconds(wall - 2 * day, timeZone);
    const after = offsetSeconds(wall + 2 * day, timeZone);
    const candidates = [...new Set([before, after])]
        .map((offset) => wall - offset * 1000)
        .filter((ms) => offsetSeconds(ms, timeZone) * 1000 === wall - ms)
        .sort((a, b) => a - b);

    if (candidates.length === 0) {
        return { ms: wall - before * 1000, status: 'gap', before, after };
    }

    if (candidates.length > 1) {
        return { ms: candidates[0], status: 'ambiguous', earlier: candidates[0], later: candidates[candidates.length - 1], before, after };
    }

    return { ms: candidates[0], status: 'ok' };
}

// "2026-03-29T02:30" oder "2026-03-29T02:30:15.250" aus <input type="datetime-local">
export function parseDateTimeLocal(value) {
    const match = /^(\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value.trim());

    if (!match) {
        return null;
    }

    const [year, month, day, hour, minute, second] = match.slice(1, 7).map((part) => Number(part ?? 0));
    const millisecond = Number((match[7] ?? '').padEnd(3, '0'));
    const check = new Date(utcFromFields({ year, month, day }));

    // 31.02. o. Ä. ablehnen statt still in den März zu rutschen
    if (check.getUTCMonth() !== month - 1 || hour > 23 || minute > 59 || second > 59) {
        return null;
    }

    return { year, month, day, hour, minute, second, millisecond };
}

export function toDateTimeLocal(fields) {
    return `${pad(fields.year, 4)}-${pad(fields.month)}-${pad(fields.day)}T${pad(fields.hour)}:${pad(fields.minute)}:${pad(fields.second)}`;
}

export function localTimeZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (error) {
        return 'UTC';
    }
}

export function isValidTimeZone(timeZone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone });

        return true;
    } catch (error) {
        return false;
    }
}

// Alle Zonen des Browsers. Ergänzt um UTC, die eigene Zone und die Ausweichliste, weil Chrome "UTC" weglässt
// und teils nur alte Namen kennt (Asia/Calcutta statt Asia/Kolkata, Asia/Katmandu statt Asia/Kathmandu).
export function timeZones() {
    let zones = [];

    try {
        if (typeof Intl.supportedValuesOf === 'function') {
            zones = Intl.supportedValuesOf('timeZone');
        }
    } catch (error) {
        zones = [];
    }

    const all = new Set(['UTC', localTimeZone(), ...zones, ...FALLBACK_ZONES].filter(isValidTimeZone));

    return [...all].sort((a, b) => (a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)));
}

/**
 * Wandelt eine Liste um, ein Timestamp je Zeile. Leere Zeilen bleiben leer.
 *
 * @returns {Array<{ input: string, result: ReturnType<typeof parseTimestamp> }>}
 */
export function convertLines(text, unit = 'auto') {
    return text.split(/\r?\n/).map((line) => ({ input: line.trim(), result: parseTimestamp(line, unit) }));
}
