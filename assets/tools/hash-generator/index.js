import { copyToClipboard, debounce, formatBytes, readI18n } from '../shared/utils.js';
import { ALGORITHMS, compareExpected, formatDigest, hashBytes, hashFile, SHA_LIMIT } from './hashing.js';
import './hash-generator.scss';

const encoder = new TextEncoder();

class HashGenerator {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.locale = document.documentElement.lang || undefined;
        this.mode = 'text';
        this.form = root.querySelector('[data-hg-form]');
        this.status = root.querySelector('[data-hg-status]');
        this.compare = root.querySelector('[data-hg-compare]');
        this.list = root.querySelector('[data-hg-results]');
        this.dropzone = root.querySelector('[data-hg-dropzone]');
        this.fileInput = root.querySelector('[data-hg-file]');
        this.progress = root.querySelector('[data-hg-progress]');

        // Ergebnis je Modus, damit beim Wechsel der Reiter nichts neu gelesen werden muss
        this.results = { text: null, file: null };
        this.file = null;
        this.controller = null;
        this.run = 0;

        const rehashText = debounce(() => this.hashText(), 150);
        const rehashAll = debounce(() => this.hash(), 300);

        this.form.addEventListener('submit', (event) => event.preventDefault());
        this.form.addEventListener('input', (event) => {
            const { name } = event.target;

            if (name === 'hmac') {
                this.root.querySelector('[data-hg-key]').hidden = !event.target.checked;
            }

            if (name === 'text') {
                rehashText();
            } else if (name === 'key' || name === 'hmac') {
                rehashAll();
            } else if (name === 'format' || name === 'expected') {
                this.render();
            }
        });

        this.fileInput.addEventListener('change', () => this.selectFile(this.fileInput.files[0]));
        root.querySelector('[data-hg-action="cancel"]').addEventListener('click', () => this.controller?.abort());
        root.querySelectorAll('[data-hg-mode]').forEach((tab) => {
            tab.addEventListener('click', () => this.selectMode(tab.dataset.hgMode));
        });

        ['dragenter', 'dragover'].forEach((type) => {
            this.dropzone.addEventListener(type, (event) => {
                event.preventDefault();
                this.dropzone.classList.add('is-dragover');
            });
        });

        ['dragleave', 'drop'].forEach((type) => {
            this.dropzone.addEventListener(type, () => this.dropzone.classList.remove('is-dragover'));
        });

        this.dropzone.addEventListener('drop', (event) => {
            event.preventDefault();
            this.selectFile(event.dataTransfer.files[0]);
        });

        this.render();
    }

    selectMode(mode) {
        this.mode = mode;

        this.root.querySelectorAll('[data-hg-mode]').forEach((tab) => {
            const active = tab.dataset.hgMode === mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        this.root.querySelectorAll('[data-hg-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.hgPanel !== mode;
        });

        this.render();
    }

    selectFile(file) {
        if (!file) {
            return;
        }

        this.file = file;
        this.root.querySelector('[data-hg-file-info]').hidden = false;
        this.root.querySelector('[data-hg-file-name]').textContent = `${file.name} · ${formatBytes(file.size, this.locale)}`;
        this.hashFile();
    }

    key() {
        const elements = this.form.elements;

        return elements.namedItem('hmac').checked ? encoder.encode(elements.namedItem('key').value) : null;
    }

    hash() {
        this.hashText();

        if (this.file) {
            this.hashFile();
        }
    }

    async hashText() {
        const text = this.form.elements.namedItem('text').value;
        const run = ++this.run;

        if (text === '') {
            this.results.text = null;
            this.render();

            return;
        }

        const bytes = encoder.encode(text);
        const key = this.key();
        const digests = await hashBytes(bytes, key);

        // Langsame Berechnung überholt von einer neueren Eingabe: verwerfen
        if (run === this.run) {
            this.results.text = { digests, hmac: !!key, size: bytes.length };
            this.render();
        }
    }

    async hashFile() {
        const file = this.file;
        const key = this.key();

        // Läuft noch eine Berechnung (andere Datei, neuer Schlüssel), wird sie abgebrochen
        this.controller?.abort();
        const controller = new AbortController();
        this.controller = controller;
        this.results.file = { reading: 0 };
        this.render();

        try {
            const { digests, shaSkipped } = await hashFile(file, {
                key,
                signal: controller.signal,
                onProgress: (read) => {
                    if (this.controller === controller) {
                        this.results.file = { reading: read };
                        this.render();
                    }
                },
            });

            if (this.controller !== controller) {
                return;
            }

            this.results.file = { digests, hmac: !!key, shaSkipped, tooLarge: file.size > SHA_LIMIT };
        } catch (error) {
            if (this.controller !== controller) {
                return;
            }

            this.results.file = { error: error.name === 'AbortError' ? 'cancelled' : 'error_read' };
        }

        this.controller = null;
        this.render();
    }

    render() {
        const result = this.results[this.mode];
        const format = this.form.elements.namedItem('format').value;
        const reading = result && 'reading' in result;

        this.root.querySelector('[data-hg-progress-wrap]').hidden = !(this.mode === 'file' && reading);
        this.list.hidden = !result?.digests;

        if (reading) {
            this.renderProgress(result.reading);
        } else if (result?.error) {
            this.status.textContent = this.i18n[result.error];
        } else if (!result) {
            this.status.textContent = this.i18n[`empty_${this.mode}`];
        } else {
            this.status.textContent = this.mode === 'text'
                ? this.i18n.text_bytes.replace('%bytes%', new Intl.NumberFormat(this.locale).format(result.size))
                : '';
        }

        const comparison = result?.digests ? compareExpected(this.form.elements.namedItem('expected').value, result.digests) : null;
        this.renderComparison(comparison, result?.hmac);
        this.renderList(result?.digests ? result : null, format, comparison?.matches ?? []);
    }

    renderProgress(read) {
        const total = this.file.size;
        const percent = total > 0 ? Math.floor((read / total) * 100) : 100;

        this.progress.setAttribute('aria-valuenow', String(percent));
        this.progress.firstElementChild.style.width = `${percent}%`;

        // Nach dem Lesen rechnet Web Crypto noch an SHA – ohne Fortschrittsanzeige
        this.status.textContent = read >= total && total <= SHA_LIMIT
            ? this.i18n.computing
            : this.i18n.reading.replace('%read%', formatBytes(read, this.locale)).replace('%total%', formatBytes(total, this.locale));
    }

    renderComparison(comparison, hmac) {
        const label = (id) => this.label(id, hmac);
        let text = '';
        let state = '';

        if (comparison?.matches.length) {
            text = this.i18n.compare_match.replace('%algorithm%', comparison.matches.map(label).join(', '));
            state = 'is-ok';
        } else if (comparison?.sameLength.length) {
            text = this.i18n.compare_mismatch_length.replace('%algorithm%', comparison.sameLength.map(label).join(', '));
            state = 'is-error';
        } else if (comparison) {
            text = this.i18n.compare_mismatch;
            state = 'is-error';
        }

        this.compare.hidden = text === '';
        this.compare.textContent = text;
        this.compare.className = `hg-compare ${state}`;
    }

    label(id, hmac) {
        const { label } = ALGORITHMS.find((algorithm) => algorithm.id === id);

        return hmac ? `HMAC-${label}` : label;
    }

    renderList(result, format, matches) {
        if (!result) {
            this.list.replaceChildren();

            return;
        }

        const rows = ALGORITHMS
            .filter(({ hmac }) => !result.hmac || hmac !== false)
            .map(({ id, weak }) => {
                const digest = result.digests.get(id);
                const value = digest ? formatDigest(digest, format) : '';
                const item = document.createElement('li');
                const name = document.createElement('span');
                const output = document.createElement('code');
                const button = document.createElement('button');

                item.className = 'hg-result';
                item.classList.toggle('is-match', matches.includes(id));
                name.className = 'hg-result__name';
                name.textContent = this.label(id, result.hmac);
                output.className = 'hg-result__value';
                button.type = 'button';
                button.className = 'btn btn-sm btn-outline-primary hg-result__copy';
                button.textContent = this.i18n.copy;

                // Als HMAC sind MD5 und SHA-1 weiterhin unbedenklich, die Warnung gilt nur dem einfachen Hash
                if (weak && !result.hmac) {
                    name.append(this.badge(this.i18n.weak, 'hg-badge--weak'));
                }

                if (matches.includes(id)) {
                    name.append(this.badge(this.i18n.match, 'hg-badge--match'));
                }

                if (digest) {
                    output.textContent = value;
                    button.addEventListener('click', () => copyToClipboard(button, value, this.i18n.copied));
                } else {
                    output.textContent = this.i18n[result.tooLarge ? 'too_large' : 'no_memory'];
                    output.classList.add('is-empty');
                    button.disabled = true;
                }

                button.setAttribute('aria-label', `${button.textContent}: ${name.firstChild.textContent}`);
                item.append(name, output, button);

                return item;
            });

        this.list.replaceChildren(...rows);
    }

    badge(text, modifier) {
        const badge = document.createElement('span');
        badge.className = `hg-badge ${modifier}`;
        badge.textContent = text;

        return badge;
    }
}

document.querySelectorAll('[data-hash-generator]').forEach((root) => new HashGenerator(root));
