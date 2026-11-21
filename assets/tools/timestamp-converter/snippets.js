// Code-Schnipsel mit den aktuellen Werten: Timestamp jetzt, Timestamp → Datum, Datum → Timestamp

const quote = (value) => `'${value.replace(/'/g, "\\'")}'`;

/**
 * @param {{ seconds: string, zone: string, wall: string, iso: string, fields: object, locale: string }} values
 *   seconds: Timestamp für "→ Datum"; wall/fields: Wanduhrzeit für "→ Timestamp" in zone;
 *   iso: dieselbe Uhrzeit als RFC 3339 mit Offset (für JavaScript, das keine Zonen-Eingabe kennt)
 * @returns {Array<{ language: string, snippets: Array<[string, string]> }>} snippets: [Schlüssel, Code]
 */
export function snippets({ seconds, zone, wall, iso, fields, locale }) {
    const z = quote(zone);
    const { year, month, day, hour, minute, second } = fields;

    return [
        {
            language: 'PHP',
            snippets: [
                ['now', 'time();'],
                ['now_ms', '(int) floor(microtime(true) * 1000);'],
                ['to_date', `(new DateTime('@${seconds}'))\n    ->setTimezone(new DateTimeZone(${z}))\n    ->format(DATE_RFC3339);`],
                ['to_timestamp', `(new DateTime(${quote(wall)}, new DateTimeZone(${z})))->getTimestamp();`],
            ],
        },
        {
            language: 'JavaScript',
            snippets: [
                ['now', 'Math.floor(Date.now() / 1000);'],
                ['now_ms', 'Date.now();'],
                ['to_date', `new Date(${seconds} * 1000).toLocaleString(${quote(locale)}, { timeZone: ${z} });`],
                ['to_timestamp', `Date.parse(${quote(iso)}) / 1000;`],
            ],
        },
        {
            language: 'Python',
            snippets: [
                ['now', 'import time\n\nint(time.time())'],
                ['now_ms', 'import time\n\ntime.time_ns() // 1_000_000'],
                ['to_date', `from datetime import datetime\nfrom zoneinfo import ZoneInfo\n\ndatetime.fromtimestamp(${seconds}, ZoneInfo(${z})).isoformat()`],
                ['to_timestamp', `from datetime import datetime\nfrom zoneinfo import ZoneInfo\n\nint(datetime(${year}, ${month}, ${day}, ${hour}, ${minute}, ${second}, tzinfo=ZoneInfo(${z})).timestamp())`],
            ],
        },
        {
            language: 'MySQL',
            snippets: [
                ['now', 'SELECT UNIX_TIMESTAMP();'],
                ['now_ms', 'SELECT FLOOR(UNIX_TIMESTAMP(NOW(3)) * 1000);'],
                ['to_date', `SET time_zone = ${z};\nSELECT FROM_UNIXTIME(${seconds});`],
                ['to_timestamp', `SET time_zone = ${z};\nSELECT UNIX_TIMESTAMP(${quote(wall)});`],
            ],
        },
        {
            language: 'PostgreSQL',
            snippets: [
                ['now', 'SELECT floor(extract(epoch FROM now()))::bigint;'],
                ['now_ms', 'SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;'],
                ['to_date', `SELECT to_timestamp(${seconds}) AT TIME ZONE ${z};`],
                ['to_timestamp', `SELECT extract(epoch FROM timestamp ${quote(wall)} AT TIME ZONE ${z})::bigint;`],
            ],
        },
        {
            // GNU date (Linux) und BSD date (macOS) haben unterschiedliche Optionen
            language: 'Bash (Linux)',
            snippets: [
                ['now', 'date +%s'],
                ['now_ms', 'date +%s%3N'],
                ['to_date', `TZ=${z} date -d @${seconds} '+%Y-%m-%d %H:%M:%S %Z'`],
                ['to_timestamp', `TZ=${z} date -d ${quote(wall)} +%s`],
            ],
        },
        {
            language: 'Bash (macOS)',
            snippets: [
                ['now', 'date +%s'],
                // BSD date kennt kein %N
                ['now_ms', "perl -MTime::HiRes=time -e 'printf \"%d\\n\", time * 1000'"],
                ['to_date', `TZ=${z} date -r ${seconds} '+%Y-%m-%d %H:%M:%S %Z'`],
                ['to_timestamp', `TZ=${z} date -j -f '%Y-%m-%d %H:%M:%S' ${quote(wall)} +%s`],
            ],
        },
    ];
}
