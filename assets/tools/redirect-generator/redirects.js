/**
 * Erzeugt Weiterleitungsregeln aus einer Liste "alte URL → neue URL".
 * Reine Funktionen ohne DOM.
 */

/**
 * Eine Zeile pro Weiterleitung. Getrennt durch Tab (aus Excel), Semikolon, Komma, "->" oder Leerzeichen.
 * Kopfzeilen und Kommentare (#) werden übersprungen.
 *
 * @returns {{line: number, from: string, to: string}[]}
 */
export function parse(input) {
    const entries = [];

    input.split(/\r?\n/).forEach((raw, index) => {
        const line = raw.trim();

        if (line === '' || line.startsWith('#')) {
            return;
        }

        // Eindeutige Trenner zuerst; Leerzeichen nur, wenn es keinen anderen gibt (Pfade können Leerzeichen enthalten)
        const separator = [/\t/, /\s*(?:->|=>|→)\s*/, /;/, /,(?=\s*(?:https?:\/\/|\/))/].find((pattern) => pattern.test(line)) ?? /\s+/;
        const parts = line
            .split(separator)
            .map((part) => part.trim().replace(/^"(.*)"$/, '$1'))
            .filter(Boolean);

        if (parts.length >= 2) {
            entries.push({ line: index + 1, from: parts[0], to: parts[1] });
        } else {
            entries.push({ line: index + 1, from: parts[0] ?? '', to: '' });
        }
    });

    // Eine Kopfzeile wie "alt;neu" oder "Quelle,Ziel" erkennen und entfernen
    if (entries.length > 0 && !/[/.]/.test(entries[0].from) && !/[/.]/.test(entries[0].to)) {
        entries.shift();
    }

    return entries;
}

/**
 * Alte Adressen werden immer auf den Pfad (mit Query) reduziert, neue bleiben absolut,
 * wenn sie auf eine andere Domain zeigen.
 */
function split(value, baseHost) {
    try {
        const url = new URL(value, 'https://placeholder.invalid');
        const external = url.hostname !== 'placeholder.invalid' && (!baseHost || url.hostname.replace(/^www\./, '') !== baseHost);

        return {
            path: decodeURI(url.pathname) || '/',
            query: url.search.replace(/^\?/, ''),
            absolute: url.hostname !== 'placeholder.invalid' ? url.href : null,
            external,
            valid: true,
        };
    } catch (error) {
        return { path: value, query: '', absolute: null, external: false, valid: false };
    }
}

function normalizePath(path, ignoreTrailingSlash) {
    return ignoreTrailingSlash && path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * Prüft die Liste und löst optional Ketten auf (a → b → c wird a → c).
 *
 * @returns {{rules: object[], problems: {line: number, type: string, detail?: string}[]}}
 */
export function analyze(entries, { domain = '', resolveChains = true, ignoreTrailingSlash = true } = {}) {
    const baseHost = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase();
    const problems = [];
    const rules = [];
    const seen = new Map();

    for (const entry of entries) {
        if (!entry.to) {
            problems.push({ line: entry.line, type: 'missing_target' });
            continue;
        }

        const from = split(entry.from, baseHost);
        const to = split(entry.to, baseHost);

        if (!from.valid || !to.valid) {
            problems.push({ line: entry.line, type: 'invalid' });
            continue;
        }

        if (from.external) {
            problems.push({ line: entry.line, type: 'foreign_source', detail: entry.from });
            continue;
        }

        const key = normalizePath(from.path, ignoreTrailingSlash) + (from.query ? `?${from.query}` : '');
        const target = to.external ? to.absolute : to.path + (to.query ? `?${to.query}` : '');

        if (normalizePath(to.path, ignoreTrailingSlash) === normalizePath(from.path, ignoreTrailingSlash) && !to.external && to.query === from.query) {
            problems.push({ line: entry.line, type: 'self', detail: key });
            continue;
        }

        if (seen.has(key)) {
            problems.push({ line: entry.line, type: 'duplicate', detail: `${key} (Zeile ${seen.get(key).line})` });
            continue;
        }

        const rule = { line: entry.line, key, path: normalizePath(from.path, ignoreTrailingSlash), query: from.query, target, external: to.external };
        seen.set(key, rule);
        rules.push(rule);
    }

    // Ketten und Schleifen über die interne Zieladresse finden
    const byKey = new Map(rules.map((rule) => [rule.key, rule]));

    for (const rule of rules) {
        const visited = new Set([rule.key]);
        let target = rule.target;
        let hops = 0;

        while (!rule.external && byKey.has(normalizePath(target, ignoreTrailingSlash))) {
            const next = byKey.get(normalizePath(target, ignoreTrailingSlash));

            if (visited.has(next.key)) {
                rule.loop = true;
                problems.push({ line: rule.line, type: 'loop', detail: rule.key });
                break;
            }

            visited.add(next.key);
            target = next.target;
            hops += 1;

            if (next.external) {
                break;
            }
        }

        if (!rule.loop && hops > 0) {
            problems.push({ line: rule.line, type: resolveChains ? 'chain_resolved' : 'chain', detail: `${rule.key} → ${target}` });

            if (resolveChains) {
                rule.target = target;
            }
        }
    }

    return { rules: rules.filter((rule) => !rule.loop), problems };
}

// Sonderzeichen für reguläre Ausdrücke in Apache maskieren
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Leerzeichen in Apache-Zielen maskieren
const apacheTarget = (target) => target.replace(/ /g, '\\ ');

export function toApache(rules, { status = 301, ignoreCase = false, ignoreTrailingSlash = true }) {
    const flags = [`R=${status}`, 'L', ignoreCase ? 'NC' : null].filter(Boolean).join(',');
    const lines = [
        '# Weiterleitungen – ganz oben in die .htaccess, vor alle anderen RewriteRules',
        '<IfModule mod_rewrite.c>',
        '    RewriteEngine On',
    ];

    for (const rule of rules) {
        const pattern = escapeRegex(rule.path.replace(/^\//, '')).replace(/ /g, '\\ ') + (ignoreTrailingSlash && rule.path !== '/' ? '/?' : '');
        // Ziel ohne eigene Query: "?" am Ende verhindert, dass die alte Query angehängt wird
        const target = apacheTarget(rule.target) + (rule.target.includes('?') ? '' : '?');

        if (rule.query) {
            lines.push(`    RewriteCond %{QUERY_STRING} ^${escapeRegex(rule.query)}$`);
        }

        lines.push(`    RewriteRule ^${pattern}$ ${target} [${flags}]`);
    }

    lines.push('</IfModule>');

    return lines.join('\n');
}

export function toNginx(rules, { status = 301, ignoreCase = false, ignoreTrailingSlash = true }) {
    const quote = (text) => `"${text.replace(/(["\\])/g, '\\$1')}"`;
    const lines = [
        '# In den http-Block: Zuordnung alte Adresse → neue Adresse',
        'map $request_uri $redirect_target {',
        '    default "";',
    ];

    for (const rule of rules) {
        // $request_uri ist nicht dekodiert: Umlaute und Leerzeichen stehen dort als %C3%BC bzw. %20
        const path = encodeURI(rule.path);

        if (ignoreCase || (ignoreTrailingSlash && rule.path !== '/')) {
            const slash = ignoreTrailingSlash && rule.path !== '/' ? '/?' : '';
            const query = rule.query ? `\\?${escapeRegex(rule.query)}` : '(\\?.*)?';
            lines.push(`    ${quote(`~${ignoreCase ? '*' : ''}^${escapeRegex(path)}${slash}${query}$`)} ${quote(rule.target)};`);
        } else {
            lines.push(`    ${quote(path + (rule.query ? `?${rule.query}` : ''))} ${quote(rule.target)};`);
        }
    }

    lines.push('}', '', '# In den server-Block:', 'if ($redirect_target) {', `    return ${status} $redirect_target;`, '}');

    return lines.join('\n');
}

export function toCsv(rules, { status = 301 }) {
    const cell = (text) => (/[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

    return ['alt;neu;status', ...rules.map((rule) => [rule.key, rule.target, status].map((value) => cell(String(value))).join(';'))].join('\n');
}
