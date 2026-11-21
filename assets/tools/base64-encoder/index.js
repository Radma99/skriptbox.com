import { copyToClipboard, formatBytes, readI18n } from '../shared/utils.js';
import { downloadBlob } from '../shared/zip.js';
import {
    CODE, decodeBase64, decodeUtf8, detectType, encodeBytes, encodeText, extensionFor, hexDump, isPreviewable, snippet, wrapLines,
} from './base64.js';
import './base64-encoder.scss';

// Mehr Text bremst das Rendern spürbar; Kopieren und Download enthalten trotzdem alles
const PREVIEW_LIMIT = 100000;
const HEX_LIMIT = 4096;

class Base64Encoder {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.locale = document.documentElement.lang || 'de';
        this.mode = 'encode';
        this.form = root.querySelector('[data-b64-form]');
        this.fileForm = root.querySelector('[data-b64-file-form]');
        this.bytesForm = root.querySelector('[data-b64-bytes-form]');
        this.output = root.querySelector('[data-b64-output]');
        this.result = '';
        this.resultIsText = true;
        this.decoded = null;
        this.file = null;
        this.fileResult = '';
        this.bytes = null;
        this.urls = {};

        this.form.addEventListener('input', () => this.render());
        this.fileForm.addEventListener('input', () => this.renderFile());
        this.bytesForm.addEventListener('input', (event) => {
            // Der Dateiname ändert nichts am Ergebnis
            if (event.target.name !== 'filename') {
                this.renderBytes();
            }
        });
        [this.form, this.fileForm, this.bytesForm].forEach((form) => form.addEventListener('submit', (event) => event.preventDefault()));

        root.querySelectorAll('[data-b64-mode]').forEach((tab) => {
            tab.addEventListener('click', () => this.selectMode(tab.dataset.b64Mode));
        });

        const fileInput = root.querySelector('[data-b64-file]');
        fileInput.addEventListener('change', () => this.readFile(fileInput.files[0]));
        this.bindDropzone(root.querySelector('[data-b64-dropzone]'));

        this.action('copy', (button) => copyToClipboard(button, this.result, this.i18n.copied));
        this.action('copy-file', (button) => copyToClipboard(button, this.fileResult, this.i18n.copied));
        this.action('download-text', () => {
            downloadBlob(new Blob([this.fileResult], { type: 'text/plain' }), `${this.file.name}.txt`);
        });
        this.action('download-decoded', () => this.download(this.decoded));
        this.action('download-bytes', () => this.download(this.bytes, this.bytesForm.elements.namedItem('filename').value.trim()));
        this.action('open-bytes', () => {
            this.bytesForm.elements.namedItem('input').value = this.form.elements.namedItem('input').value;
            this.selectMode('bytes');
        });

        this.render();
        this.renderFile();
        this.renderBytes();
    }

    action(name, callback) {
        this.root.querySelector(`[data-b64-action="${name}"]`).addEventListener('click', (event) => callback(event.currentTarget));
    }

    bindDropzone(dropzone) {
        ['dragenter', 'dragover'].forEach((type) => {
            dropzone.addEventListener(type, (event) => {
                event.preventDefault();
                dropzone.classList.add('is-dragover');
            });
        });

        ['dragleave', 'drop'].forEach((type) => {
            dropzone.addEventListener(type, () => dropzone.classList.remove('is-dragover'));
        });

        dropzone.addEventListener('drop', (event) => {
            event.preventDefault();
            this.readFile(event.dataTransfer.files[0]);
        });
    }

    selectMode(mode) {
        const input = this.form.elements.namedItem('input');

        // Beim Wechsel zwischen Kodieren und Dekodieren wird das Ergebnis zur neuen Eingabe (nur wenn es Text ist)
        if (((this.mode === 'encode' && mode === 'decode') || (this.mode === 'decode' && mode === 'encode')) && this.resultIsText) {
            input.value = this.result;
        }

        this.mode = mode;
        const panel = mode === 'encode' || mode === 'decode' ? 'text' : mode;

        this.root.querySelectorAll('[data-b64-mode]').forEach((tab) => {
            const active = tab.dataset.b64Mode === mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        this.root.querySelectorAll('[data-b64-panel]').forEach((element) => {
            element.hidden = element.dataset.b64Panel !== panel;
        });
        this.root.querySelectorAll('[data-b64-options]').forEach((options) => {
            options.hidden = options.dataset.b64Options !== mode;
        });
        this.root.querySelector('[data-b64-input-label]').textContent = this.i18n[`input_${mode}`] ?? '';

        if (panel === 'text') {
            this.render();
        } else if (panel === 'bytes') {
            this.renderBytes();
        }
    }

    // Text kodieren bzw. dekodieren
    render() {
        const value = (name) => this.form.elements.namedItem(name);
        const input = value('input').value;
        const urlSafe = value('variant').value === 'url';
        let problems = [];
        let binary = null;
        let code = [];

        this.root.querySelector('[data-b64-padding]').hidden = !urlSafe;
        this.decoded = null;
        this.resultIsText = true;

        if (this.mode === 'decode') {
            const decoded = decodeBase64(input);
            problems = decoded.problems;
            this.result = '';

            if (decoded.bytes) {
                const { text, valid } = decodeUtf8(decoded.bytes);
                const type = detectType(decoded.bytes);
                this.decoded = this.describe(decoded, type);

                // Kein Text: statt Zeichensalat die Bytes zeigen und den Download anbieten
                if (!valid || (type && !type.text)) {
                    binary = type;
                    this.resultIsText = false;
                }

                this.result = this.resultIsText ? text : hexDump(decoded.bytes, HEX_LIMIT);
                code = input.trim() !== '' && this.resultIsText ? CODE[decoded.urlSafe ? 'decode-url' : 'decode-standard'] : [];
            }
        } else {
            const padding = !urlSafe || value('padding').checked;
            this.result = encodeText(input, { urlSafe, padding, wrap: value('wrap').checked });

            if (input !== '' && !value('wrap').checked) {
                code = CODE[urlSafe ? `encode-url${padding ? '-padded' : ''}` : 'encode-standard'];
            }
        }

        const hint = this.resultIsText ? '' : this.hexHint(this.decoded.bytes);
        // Bei Fehlern nicht zur Eingabe auffordern, die Hinweise darüber erklären es
        const empty = input.trim() === '' ? this.i18n[`empty_${this.mode}`] : '–';
        this.show(this.output, this.root.querySelector('[data-b64-output-hint]'), this.result, empty, hint);
        this.output.classList.toggle('b64-output--hex', !this.resultIsText);
        this.root.querySelector('[data-b64-action="copy"]').disabled = !this.result || !this.resultIsText;

        this.renderProblems(problems, '[data-b64-problems]', '[data-b64-notes]');
        this.renderBinary(binary);
        this.renderCode(code);
    }

    renderBinary(type) {
        const box = this.root.querySelector('[data-b64-binary]');
        box.hidden = this.resultIsText;

        if (!this.resultIsText) {
            box.querySelector('[data-b64-binary-text]').textContent = type
                ? this.i18n.binary.replace('%type%', type.label)
                : this.i18n.binary_unknown;
        }
    }

    renderCode(code) {
        this.root.querySelector('[data-b64-code]').replaceChildren(...code.flatMap(([language, snippetText]) => {
            const term = document.createElement('dt');
            const definition = document.createElement('dd');
            const value = document.createElement('code');
            term.textContent = language;
            value.textContent = snippetText;
            definition.append(value);

            return [term, definition];
        }));
        this.root.querySelector('[data-b64-code-section]').hidden = code.length === 0;
    }

    async readFile(file) {
        if (!file) {
            return;
        }

        const bytes = new Uint8Array(await file.arrayBuffer());
        const type = detectType(bytes);

        // Der Browser kennt den Typ nur anhand der Endung; fehlt sie, helfen die ersten Bytes
        this.file = { name: file.name, size: file.size, mime: file.type || type?.mime || 'application/octet-stream', base64: encodeBytes(bytes) };
        this.setPreview('file', isPreviewable(this.file.mime) ? new Blob([bytes], { type: this.file.mime }) : null);
        this.renderFile();
    }

    // Datei → Base64 / Data-URI
    renderFile() {
        const result = this.root.querySelector('[data-b64-file-result]');
        const format = this.fileForm.elements.namedItem('format').value;
        const wrap = this.fileForm.elements.namedItem('wrap');

        // Umbrechen ist nur für reines Base64 sinnvoll, in Data-URIs zerbricht es die Adresse
        this.root.querySelector('[data-b64-file-wrap]').hidden = format !== 'base64';
        result.hidden = !this.file;
        this.fileResult = '';

        if (this.file) {
            const base64 = format === 'base64' && wrap.checked ? wrapLines(this.file.base64) : this.file.base64;
            this.fileResult = snippet(format, base64, this.file.mime);

            const fact = (name, text) => { this.root.querySelector(`[data-b64-fact="${name}"]`).textContent = text; };
            const after = new TextEncoder().encode(this.fileResult).length;
            const change = this.file.size > 0 ? Math.round(((after - this.file.size) / this.file.size) * 100) : 0;
            fact('name', this.file.name);
            fact('type', this.file.mime);
            fact('before', formatBytes(this.file.size, this.locale));
            fact('after', `${formatBytes(after, this.locale)} (${change >= 0 ? '+' : ''}${new Intl.NumberFormat(this.locale).format(change)} %)`);
        }

        this.show(this.root.querySelector('[data-b64-file-output]'), this.root.querySelector('[data-b64-file-hint]'), this.fileResult, this.i18n.empty_file);
        this.root.querySelector('[data-b64-action="copy-file"]').disabled = !this.fileResult;
        this.root.querySelector('[data-b64-action="download-text"]').disabled = !this.fileResult;
    }

    // Base64 / Data-URI → Datei
    renderBytes() {
        const input = this.bytesForm.elements.namedItem('input').value;
        const decoded = decodeBase64(input);
        const filename = this.bytesForm.elements.namedItem('filename');
        const empty = input.trim() === '';

        this.bytes = decoded.bytes && decoded.bytes.length > 0 ? this.describe(decoded, detectType(decoded.bytes)) : null;
        this.renderProblems(empty ? [] : decoded.problems, '[data-b64-bytes-problems]', '[data-b64-bytes-notes]');
        this.root.querySelector('[data-b64-bytes-empty]').hidden = !empty;
        this.root.querySelector('[data-b64-bytes-result]').hidden = !this.bytes;
        this.root.querySelector('[data-b64-action="download-bytes"]').disabled = !this.bytes;
        filename.placeholder = this.bytes ? this.defaultName(this.bytes) : '';

        if (!this.bytes) {
            this.setPreview('bytes', null);

            return;
        }

        const { bytes, mime, label } = this.bytes;
        this.root.querySelector('[data-b64-bytes-fact="type"]').textContent = label ? `${label} (${mime})` : `${this.i18n.unknown} (${mime})`;
        this.root.querySelector('[data-b64-bytes-fact="size"]').textContent = formatBytes(bytes.length, this.locale);
        this.root.querySelector('[data-b64-hex]').textContent = hexDump(bytes, HEX_LIMIT);

        const hint = this.root.querySelector('[data-b64-hex-hint]');
        hint.textContent = this.hexHint(bytes);
        hint.hidden = hint.textContent === '';

        this.setPreview('bytes', isPreviewable(mime) ? new Blob([bytes], { type: mime }) : null);
    }

    /**
     * Typ dekodierter Daten: Die ersten Bytes zählen mehr als die Angabe in der Data-URI,
     * weil diese oft falsch kopiert ist (z. B. image/png für ein JPEG).
     */
    describe(decoded, type) {
        const mime = type && !type.text ? type.mime : decoded.mime || type?.mime || 'application/octet-stream';

        return { bytes: decoded.bytes, mime, label: type?.label ?? null, ext: type?.ext ?? extensionFor(mime) };
    }

    defaultName({ ext }) {
        return `${this.i18n.file_name}.${ext}`;
    }

    download(data, name = '') {
        downloadBlob(new Blob([data.bytes], { type: data.mime }), name || this.defaultName(data));
    }

    // Vorschau über eine Blob-URL; auch SVG ist sicher, weil Skripte in <img> nicht laufen
    setPreview(key, blob) {
        const figure = this.root.querySelector(`[data-b64-${key}-preview]`);

        if (this.urls[key]) {
            URL.revokeObjectURL(this.urls[key]);
            this.urls[key] = null;
        }

        figure.hidden = !blob;

        if (blob) {
            this.urls[key] = URL.createObjectURL(blob);
            figure.querySelector('img').src = this.urls[key];
        } else {
            figure.querySelector('img').removeAttribute('src');
        }
    }

    hexHint(bytes) {
        return bytes.length > HEX_LIMIT ? this.format(this.i18n.hex_limited, { shown: HEX_LIMIT, total: bytes.length }) : '';
    }

    // Ergebnis anzeigen, sehr lange Ergebnisse gekürzt
    show(output, hintElement, text, emptyText, extraHint = '') {
        const truncated = text.length > PREVIEW_LIMIT;
        output.textContent = truncated ? `${text.slice(0, PREVIEW_LIMIT)}…` : text || emptyText;
        output.classList.toggle('is-empty', !text);

        hintElement.textContent = extraHint || (truncated ? this.format(this.i18n.truncated, { shown: PREVIEW_LIMIT, total: text.length }) : '');
        hintElement.hidden = hintElement.textContent === '';
    }

    format(message, params) {
        const number = new Intl.NumberFormat(this.locale);

        return Object.entries(params).reduce((text, [key, value]) => {
            const formatted = typeof value === 'number' ? number.format(value) : value;

            return text.replaceAll(`%${key}%`, formatted);
        }, message ?? '');
    }

    // Fehler und Warnungen hervorgehoben, reine Hinweise (z. B. "Zeilenumbrüche ignoriert") dezent
    renderProblems(problems, problemSelector, noteSelector) {
        const item = ({ key, params }) => {
            const element = document.createElement('li');
            const values = { ...params };

            if (Array.isArray(values.chars)) {
                values.chars = values.chars.map((char) => this.i18n.quote.replace('%char%', this.visible(char))).join(', ');
            }

            element.textContent = this.format(this.i18n[`problem_${key}`], values);

            return element;
        };
        const fill = (selector, list) => {
            const element = this.root.querySelector(selector);
            element.hidden = list.length === 0;
            element.replaceChildren(...list.map(item));
        };

        fill(problemSelector, problems.filter(({ level }) => level !== 'info'));
        fill(noteSelector, problems.filter(({ level }) => level === 'info'));
    }

    // Unsichtbare oder verwechselbare Zeichen (z. B. Zero-Width-Space) als U+XXXX zeigen
    visible(char) {
        return /[\p{C}\p{Z}]/u.test(char) ? `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : char;
    }
}

document.querySelectorAll('[data-base64-encoder]').forEach((root) => new Base64Encoder(root));
