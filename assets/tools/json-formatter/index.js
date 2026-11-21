import { copyToClipboard, debounce, formatBytes, readI18n } from '../shared/utils.js';
import { downloadBlob } from '../shared/zip.js';
import { byteLength, parse, stringify } from './json.js';
import './json-formatter.scss';

const INDENT = { 2: '  ', 4: '    ', tab: '\t' };

// Ab dieser Größe erst nach einer kurzen Tipppause prüfen, sonst ruckelt die Eingabe
const LIVE_LIMIT = 200000;

// Längere Ergebnisse bringen den Browser beim Anzeigen an seine Grenzen
const OUTPUT_LIMIT = 20000000;

// Farbige Ausgabe nur bis zu dieser Länge, darüber kosten die vielen Elemente zu viel Zeit
const HIGHLIGHT_LIMIT = 300000;

// Zahl größer als 2^53, damit das Beispiel den Hinweis zur Genauigkeit zeigt
const EXAMPLE = '{"id":9007199254740993,"name":"Skriptbox","active":true,"rating":4.8,"tags":["json","formatter","validator"],'
    + '"address":{"street":"Domkloster 4","city":"Köln","country":"DE"},"owner":null,'
    + '"tools":[{"slug":"json-formatter","local":true},{"slug":"url-encoder","local":true}],"emoji":"✓ 😀"}';

// Unsichtbare Zeichen in der Fehlermarkierung sichtbar machen
const VISIBLE = { ' ': '␣', '\t': '⇥', '\r': '␍' };

// Platzhalter, deren Werte als Code erscheinen
const CODE_PARAMS = ['found', 'key', 'open', 'close', 'suggestion', 'value', 'rounded'];

class JsonFormatter {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.locale = document.documentElement.lang || 'de';
        this.mode = 'format';
        this.form = root.querySelector('[data-jf-form]');
        this.input = root.querySelector('[data-jf-input]');
        this.file = root.querySelector('[data-jf-file]');
        this.status = root.querySelector('[data-jf-status]');
        this.warnings = root.querySelector('[data-jf-warnings]');
        this.output = root.querySelector('[data-jf-output]');
        this.stats = root.querySelector('[data-jf-stats]');
        this.result = '';
        this.fileName = '';

        const delayed = debounce(() => this.render(), 300);
        this.input.addEventListener('input', () => (this.input.value.length > LIVE_LIMIT ? delayed() : this.render()));
        this.form.addEventListener('change', (event) => {
            if (event.target !== this.input) {
                this.render();
            }
        });
        this.form.addEventListener('submit', (event) => event.preventDefault());

        root.querySelectorAll('[data-jf-mode]').forEach((tab) => {
            tab.addEventListener('click', () => this.selectMode(tab.dataset.jfMode));
        });

        this.action('example', () => this.load(EXAMPLE, ''));
        this.action('clear', () => this.load('', ''));
        this.action('open', () => this.file.click());
        this.action('copy', (event) => copyToClipboard(event.currentTarget, this.result, this.i18n.copied));
        this.action('download', () => this.download());

        this.file.addEventListener('change', () => {
            this.open(this.file.files[0]);
            this.file.value = '';
        });

        ['dragenter', 'dragover'].forEach((type) => {
            this.input.addEventListener(type, (event) => {
                if (event.dataTransfer?.types.includes('Files')) {
                    event.preventDefault();
                    this.input.classList.add('is-dragover');
                }
            });
        });
        ['dragleave', 'drop'].forEach((type) => {
            this.input.addEventListener(type, () => this.input.classList.remove('is-dragover'));
        });
        this.input.addEventListener('drop', (event) => {
            if (event.dataTransfer?.files.length) {
                event.preventDefault();
                this.open(event.dataTransfer.files[0]);
            }
        });

        this.render();
    }

    action(name, callback) {
        this.root.querySelector(`[data-jf-action="${name}"]`).addEventListener('click', callback);
    }

    selectMode(mode) {
        this.mode = mode;

        this.root.querySelectorAll('[data-jf-mode]').forEach((tab) => {
            const active = tab.dataset.jfMode === mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        this.root.querySelector('[data-jf-options="format"]').hidden = mode !== 'format';
        this.render();
    }

    load(text, fileName) {
        this.input.value = text;
        this.fileName = fileName;
        this.render();
    }

    // Datei wird nur lokal gelesen, nichts verlässt den Browser
    async open(file) {
        if (!file) {
            return;
        }

        try {
            this.load(await file.text(), file.name.replace(/\.[^.]+$/, ''));
        } catch (error) {
            this.status.replaceChildren(this.alert('danger', this.i18n.file_error));
        }
    }

    download() {
        const name = `${this.fileName || 'data'}${this.mode === 'minify' ? '.min' : ''}.json`;
        downloadBlob(new Blob([this.result], { type: 'application/json;charset=utf-8' }), name);
    }

    render() {
        const text = this.input.value;
        const result = parse(text);
        let output = '';

        if (result.ok) {
            try {
                output = stringify(result.tree, {
                    indent: this.mode === 'minify' ? '' : INDENT[this.form.elements.namedItem('indent').value],
                    sortKeys: this.form.elements.namedItem('sortKeys').checked,
                    maxLength: OUTPUT_LIMIT,
                });
            } catch (error) {
                // Bei extrem tiefer Verschachtelung wächst die Einrückung quadratisch
                output = null;
            }
        }

        this.result = output ?? '';
        this.renderStatus(result);
        this.renderWarnings(result.ok ? result.warnings : []);
        this.renderOutput(result, output);
        this.renderStats(result.ok && output !== null ? result.stats : null, text);
        this.root.querySelectorAll('[data-jf-action="copy"], [data-jf-action="download"]').forEach((button) => {
            button.disabled = !this.result;
        });
    }

    renderStatus(result) {
        if (result.empty) {
            this.status.replaceChildren();

            return;
        }

        if (result.ok) {
            this.status.replaceChildren(this.alert('success', this.i18n.valid));

            return;
        }

        const { error } = result;
        const box = document.createElement('div');
        box.className = 'jf-error';

        const title = document.createElement('p');
        title.className = 'jf-error__title';
        title.textContent = `${this.i18n.invalid} – ${this.translate(this.i18n.position, error)}`;

        const message = document.createElement('p');
        message.className = 'jf-error__message';
        message.append(this.message(this.i18n[`error_${error.code}`], error.params));

        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'btn btn-sm btn-outline-danger';
        jump.textContent = this.i18n.jump;
        jump.addEventListener('click', () => this.select(error.offset, error.length, error.line));

        box.append(title, message, this.excerpt(error.excerpt), jump);
        this.status.replaceChildren(box);
    }

    alert(type, text) {
        const element = document.createElement('p');
        element.className = `jf-alert jf-alert--${type}`;
        element.textContent = text;

        return element;
    }

    // Fehlerzeile mit Zeilennummer, die fehlerhafte Stelle ist mit <mark> hervorgehoben
    excerpt(lines) {
        const pre = document.createElement('pre');
        pre.className = 'jf-excerpt';
        const width = String(lines[lines.length - 1].number).length;

        lines.forEach((line, index) => {
            const number = document.createElement('span');
            number.className = 'jf-excerpt__number';
            number.textContent = String(line.number).padStart(width);
            pre.append(index > 0 ? '\n' : '', number, line.before);

            if (index === lines.length - 1) {
                const mark = document.createElement('mark');
                mark.textContent = Array.from(line.mark, (char) => VISIBLE[char] ?? char).join('') || ' ';
                pre.append(mark, line.after);
            }
        });

        return pre;
    }

    renderWarnings(warnings) {
        const groups = new Map();
        warnings.forEach((warning) => groups.set(warning.code, [...(groups.get(warning.code) ?? []), warning]));
        const items = [];

        // Pro Art höchstens fünf Einträge, damit z. B. hunderte doppelte Schlüssel die Seite nicht fluten
        groups.forEach((list, code) => {
            list.slice(0, 5).forEach((warning) => {
                const item = document.createElement('li');
                item.append(this.message(this.i18n[`warning_${code}`], warning.params ?? {}), ' ');

                if (code !== 'bom') {
                    const link = document.createElement('button');
                    link.type = 'button';
                    link.className = 'btn btn-link jf-line-link';
                    link.textContent = `(${this.translate(this.i18n.line, warning)})`;
                    link.addEventListener('click', () => this.select(warning.offset, 1, warning.line));
                    item.append(link);
                }

                items.push(item);
            });

            if (list.length > 5) {
                const item = document.createElement('li');
                item.textContent = this.translate(this.i18n.more, { count: this.number(list.length - 5) });
                items.push(item);
            }
        });

        this.warnings.hidden = items.length === 0;
        this.warnings.replaceChildren(...items);
    }

    renderOutput(result, output) {
        const empty = !output;
        this.output.classList.toggle('is-empty', empty);

        if (result.empty) {
            this.output.textContent = this.i18n.empty;
        } else if (!result.ok) {
            this.output.textContent = this.i18n.output_invalid;
        } else if (output === null) {
            this.output.textContent = this.i18n.too_large;
        } else if (output.length <= HIGHLIGHT_LIMIT) {
            this.output.replaceChildren(highlight(output));
        } else {
            this.output.textContent = output;
        }
    }

    renderStats(stats, text) {
        this.stats.hidden = stats === null;

        if (stats === null) {
            return;
        }

        const values = {
            ...stats,
            input_size: formatBytes(byteLength(text), this.locale),
            output_size: formatBytes(byteLength(this.result), this.locale),
        };

        this.stats.querySelectorAll('[data-jf-stat]').forEach((element) => {
            const value = values[element.dataset.jfStat];
            element.textContent = typeof value === 'number' ? this.number(value) : value;
        });
    }

    // Markiert eine Stelle in der Eingabe und scrollt dorthin (wrap="off": eine Zeile = eine Zeilenhöhe)
    select(offset, length, line) {
        this.input.focus();
        this.input.setSelectionRange(offset, offset + Math.max(length, 0));
        const lineHeight = parseFloat(getComputedStyle(this.input).lineHeight) || 20;
        this.input.scrollTop = Math.max(0, (line - 3) * lineHeight);
    }

    number(value) {
        return new Intl.NumberFormat(this.locale).format(value);
    }

    translate(template, params) {
        return (template ?? '').replace(/%(\w+)%/g, (match, name) => params[name] ?? match);
    }

    // Meldung mit Platzhaltern; Zeichen aus dem JSON erscheinen als <code>, das Eingabeende als Text
    message(template, params) {
        const fragment = document.createDocumentFragment();

        (template ?? '').split(/(%\w+%)/).forEach((part) => {
            const name = part.match(/^%(\w+)%$/)?.[1];

            if (!name || params[name] === undefined) {
                fragment.append(part);
            } else if (CODE_PARAMS.includes(name) && params[name] !== '') {
                const code = document.createElement('code');
                code.textContent = params[name];
                fragment.append(code);
            } else {
                fragment.append(params[name] === '' ? this.i18n.end : String(params[name]));
            }
        });

        return fragment;
    }
}

// Färbt gültiges JSON ein: Schlüssel, Texte, Zahlen und true/false/null
function highlight(json) {
    const fragment = document.createDocumentFragment();
    const pattern = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    let last = 0;

    for (const match of json.matchAll(pattern)) {
        fragment.append(json.slice(last, match.index));
        const span = document.createElement('span');

        if (match[1] !== undefined) {
            span.className = match[2] !== undefined ? 'jf-key' : 'jf-string';
            span.textContent = match[1];
            fragment.append(span, match[2] ?? '');
        } else {
            span.className = /\d/.test(match[0]) ? 'jf-number' : 'jf-literal';
            span.textContent = match[0];
            fragment.append(span);
        }

        last = match.index + match[0].length;
    }

    fragment.append(json.slice(last));

    return fragment;
}

document.querySelectorAll('[data-json-formatter]').forEach((root) => new JsonFormatter(root));
