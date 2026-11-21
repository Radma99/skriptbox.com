import { copyToClipboard, readI18n } from '../shared/utils.js';
import { downloadBlob } from '../shared/zip.js';
import { MAX, NAMESPACES, NIL, createUlid, createV7, formatId, formatList, inspect, normalize, v4, v5 } from './uuid.js';
import './uuid-generator.scss';

const EXTENSIONS = { list: 'txt', json: 'json', sql: 'sql', csv: 'csv' };

class UuidGenerator {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.form = root.querySelector('[data-uid-form]');
        this.output = root.querySelector('[data-uid-output]');
        this.status = root.querySelector('[data-uid-status]');
        this.error = root.querySelector('[data-uid-error]');
        this.check = root.querySelector('[data-uid-check]');
        this.facts = root.querySelector('[data-uid-facts]');
        this.checkStatus = root.querySelector('[data-uid-check-status]');
        // Zähler leben so lange wie die Seite, damit auch mehrere Klicks in derselben Millisekunde aufsteigen
        this.next = { v7: createV7(), ulid: createUlid() };
        this.values = [];
        this.result = '';
        this.run = 0;

        root.querySelectorAll('[data-uid-mode]').forEach((tab) => {
            tab.addEventListener('click', () => this.selectMode(tab.dataset.uidMode));
        });

        // Darstellungsoptionen formatieren die vorhandenen IDs nur neu, alles andere erzeugt neue
        this.form.addEventListener('input', (event) => {
            if (['uppercase', 'noHyphens', 'braces', 'format'].includes(event.target.name)) {
                this.render();
            } else {
                this.generate();
            }
        });
        this.form.addEventListener('submit', (event) => event.preventDefault());
        this.check.addEventListener('input', () => this.inspect());
        this.check.addEventListener('submit', (event) => event.preventDefault());

        root.querySelector('[data-uid-action="generate"]').addEventListener('click', () => this.generate());
        root.querySelector('[data-uid-action="copy"]').addEventListener('click', (event) => {
            copyToClipboard(event.currentTarget, this.result, this.i18n.copied);
        });
        root.querySelector('[data-uid-action="download"]').addEventListener('click', () => this.download());

        this.generate();
        this.inspect();
    }

    selectMode(mode) {
        this.root.querySelectorAll('[data-uid-mode]').forEach((tab) => {
            const active = tab.dataset.uidMode === mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        this.root.querySelectorAll('[data-uid-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.uidPanel !== mode;
        });
    }

    field(name) {
        return this.form.elements.namedItem(name);
    }

    count() {
        const count = parseInt(this.field('count').value, 10);

        return Number.isNaN(count) ? 1 : Math.min(Math.max(count, 1), 1000);
    }

    async generate() {
        const type = this.field('type').value;
        const run = ++this.run;

        this.root.querySelectorAll('[data-uid-show]').forEach((element) => {
            element.hidden = !element.dataset.uidShow.split(' ').includes(type);
        });
        this.root.querySelector('[data-uid-hint]').textContent = this.i18n[`hint_${type}`] ?? '';
        this.field('custom').closest('[data-uid-custom]').hidden = type !== 'v5' || this.field('namespace').value !== 'custom';
        this.error.hidden = true;

        if (type === 'v5') {
            this.values = await this.nameBased();
            // Eine ältere, langsamere Berechnung darf ein neueres Ergebnis nicht überschreiben
            if (run !== this.run) {
                return;
            }
        } else if (type === 'nil' || type === 'max') {
            this.values = [type === 'nil' ? NIL : MAX];
        } else {
            const create = type === 'v4' ? v4 : this.next[type];
            this.values = Array.from({ length: this.count() }, () => create());
        }

        this.render();
    }

    // v5: ein Name pro Zeile ergibt je eine UUID; gleicher Name, gleiche UUID
    async nameBased() {
        const selected = this.field('namespace').value;
        const custom = selected === 'custom' ? inspect(this.field('custom').value) : null;
        const namespace = custom ? custom.canonical : NAMESPACES[selected];
        const names = this.field('names').value.split(/\r?\n/).filter((name) => name !== '').slice(0, 1000);

        // Fehler erst zeigen, wenn etwas eingegeben wurde
        if (custom && custom.type !== 'uuid') {
            if (normalize(this.field('custom').value) !== '') {
                this.showError(this.i18n.error_namespace);
            }

            return [];
        }

        if (!crypto.subtle) {
            this.showError(this.i18n.error_crypto);

            return [];
        }

        return Promise.all(names.map((name) => v5(namespace, name)));
    }

    showError(message) {
        this.error.textContent = message;
        this.error.hidden = false;
    }

    render() {
        const options = {
            uppercase: this.field('uppercase').checked,
            hyphens: !this.field('noHyphens').checked,
            braces: this.field('braces').checked,
        };
        const ids = this.values.map((id) => formatId(id, options));
        const empty = ids.length === 0;

        this.result = empty ? '' : formatList(ids, this.field('format').value);
        this.output.textContent = this.result || this.i18n.empty;
        this.output.classList.toggle('is-empty', empty);
        this.root.querySelector('[data-uid-action="copy"]').disabled = empty;
        this.root.querySelector('[data-uid-action="download"]').disabled = empty;
        this.status.textContent = empty ? '' : this.i18n.generated.replace('%count%', ids.length.toLocaleString(document.documentElement.lang));
    }

    download() {
        const format = this.field('format').value;
        const type = format === 'json' ? 'application/json' : 'text/plain';
        const name = this.field('type').value === 'ulid' ? 'ulids' : 'uuids';

        downloadBlob(new Blob([`${this.result}\n`], { type: `${type};charset=utf-8` }), `${name}.${EXTENSIONS[format]}`);
    }

    inspect() {
        const input = this.check.elements.namedItem('id').value;

        if (normalize(input) === '') {
            this.facts.hidden = true;
            this.checkStatus.hidden = true;

            return;
        }

        const result = inspect(input);
        this.checkStatus.hidden = false;
        this.checkStatus.textContent = result.valid ? this.i18n[`valid_${result.type}`] : this.i18n.invalid;
        this.checkStatus.classList.toggle('is-invalid', !result.valid);
        this.facts.hidden = !result.valid;

        if (result.valid) {
            this.renderFacts(result);
        } else {
            this.facts.replaceChildren();
        }
    }

    renderFacts(result) {
        const rows = [[this.i18n.fact_canonical, result.canonical, true]];

        if (result.type === 'ulid') {
            rows.push([this.i18n.fact_as_uuid, result.uuid, true]);
        } else if (result.special) {
            rows.push([this.i18n.fact_version, this.i18n[`special_${result.special}`]]);
        } else {
            rows.push([this.i18n.fact_variant, this.i18n[`variant_${result.variant}`]]);

            if (result.version !== undefined) {
                rows.push([this.i18n.fact_version, this.i18n[`version_${result.version}`] ?? this.i18n.version_unknown.replace('%version%', result.version)]);
            }
        }

        if (result.date) {
            // dateStyle/timeStyle lassen sich nicht mit Millisekunden kombinieren, daher einzeln
            const local = result.date.toLocaleString(document.documentElement.lang, {
                weekday: 'short',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3,
                timeZoneName: 'short',
            });
            rows.push([this.i18n.fact_utc, result.iso, true], [this.i18n.fact_local, local]);
        }

        if (result.node) {
            rows.push([this.i18n.fact_node, result.node, true]);
        }

        const note = result.type === 'ulid' ? 'ulid' : result.special ?? (result.variant === 'rfc' ? `v${result.version}` : 'variant');

        if (this.i18n[`note_${note}`]) {
            rows.push([this.i18n.fact_note, this.i18n[`note_${note}`]]);
        }

        this.facts.replaceChildren(...rows.flatMap(([label, value, code]) => {
            const term = document.createElement('dt');
            const definition = document.createElement('dd');
            term.textContent = label;
            definition.append(code ? Object.assign(document.createElement('code'), { textContent: value }) : value);

            return [term, definition];
        }));
    }
}

document.querySelectorAll('[data-uuid-generator]').forEach((root) => new UuidGenerator(root));
