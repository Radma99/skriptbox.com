import { copyToClipboard, readI18n } from '../shared/utils.js';
import { VARIANTS, connectionUrl, decode, encode, perLine } from './encoding.js';
import './url-encoder.scss';

// Unsichtbare Zeichen in der Liste der kodierten Zeichen sichtbar machen
const VISIBLE = { ' ': '␣', '\n': '↵', '\r': '␍', '\t': '⇥' };

class UrlEncoder {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.mode = 'encode';
        this.form = root.querySelector('[data-ue-form]');
        this.connection = root.querySelector('[data-ue-connection]');
        this.output = root.querySelector('[data-ue-output]');
        this.connectionOutput = root.querySelector('[data-ue-connection-output]');
        this.problems = root.querySelector('[data-ue-problems]');
        this.result = '';
        this.connectionResult = '';

        this.form.addEventListener('input', () => this.render());
        this.form.addEventListener('submit', (event) => event.preventDefault());
        this.connection.addEventListener('input', () => this.renderConnection());
        this.connection.addEventListener('submit', (event) => event.preventDefault());

        root.querySelectorAll('[data-ue-mode]').forEach((tab) => {
            tab.addEventListener('click', () => this.selectMode(tab.dataset.ueMode));
        });
        root.querySelector('[data-ue-action="copy"]').addEventListener('click', (event) => {
            copyToClipboard(event.currentTarget, this.result, this.i18n.copied);
        });
        root.querySelector('[data-ue-action="copy-connection"]').addEventListener('click', (event) => {
            copyToClipboard(event.currentTarget, this.connectionResult, this.i18n.copied);
        });

        this.render();
        this.renderConnection();
    }

    selectMode(mode) {
        const input = this.form.elements.namedItem('input');

        // Beim Wechsel zwischen Kodieren und Dekodieren wird das Ergebnis zur neuen Eingabe
        if ((this.mode === 'encode' && mode === 'decode') || (this.mode === 'decode' && mode === 'encode')) {
            input.value = this.result;
        }

        this.mode = mode;

        this.root.querySelectorAll('[data-ue-mode]').forEach((tab) => {
            const active = tab.dataset.ueMode === mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        this.root.querySelector('[data-ue-panel="text"]').hidden = mode === 'connection';
        this.root.querySelector('[data-ue-panel="connection"]').hidden = mode !== 'connection';
        this.root.querySelectorAll('[data-ue-options]').forEach((options) => {
            options.hidden = options.dataset.ueOptions !== mode;
        });
        this.root.querySelector('[data-ue-input-label]').textContent = this.i18n[`input_${mode}`] ?? '';

        if (mode !== 'connection') {
            this.render();
        }
    }

    options() {
        const value = (name) => this.form.elements.namedItem(name);

        return {
            input: value('input').value,
            variant: value('variant').value,
            lowercase: value('lowercase').checked,
            plusAsSpace: value('plusAsSpace').checked,
            perLine: value('perLine').checked,
        };
    }

    render() {
        const options = this.options();
        const lines = options.perLine ? options.input.split(/\r?\n/) : [options.input];
        const problems = new Set();
        const encoded = new Map();

        // Häufigster Fehler bei Passwörtern: Leerzeichen oder Zeilenumbruch beim Kopieren mit erwischt
        if (lines.some((line) => line !== line.trim())) {
            problems.add('whitespace');
        }

        const convert = (text) => {
            if (this.mode === 'decode') {
                const result = decode(text, options);
                result.problems.forEach((problem) => problems.add(problem));

                return result.text;
            }

            const result = encode(text, options);
            result.encoded.forEach(({ char, code }) => encoded.set(char, code));

            return result.text;
        };

        this.result = options.perLine ? perLine(options.input, convert).join('') : convert(options.input);
        this.output.textContent = this.result || this.i18n.empty;
        this.output.classList.toggle('is-empty', !this.result);
        this.root.querySelector('[data-ue-action="copy"]').disabled = !this.result;

        this.renderProblems([...problems]);
        this.renderDetails(options.variant, options.input !== '' && this.mode === 'encode' ? encoded : new Map());
    }

    renderProblems(problems) {
        this.problems.hidden = problems.length === 0;
        this.problems.replaceChildren(...problems.map((problem) => {
            const item = document.createElement('li');
            item.textContent = this.i18n[`problem_${problem}`];

            return item;
        }));
    }

    // Kodierte Zeichen (z. B. @ → %40) und passende Funktionen in PHP, Python und JavaScript
    renderDetails(variant, encoded) {
        const code = this.mode === 'encode' ? VARIANTS[variant]?.code ?? [] : [];
        const chars = this.root.querySelector('[data-ue-chars]');
        const list = this.root.querySelector('[data-ue-code]');

        chars.replaceChildren(...Array.from(encoded, ([char, value]) => {
            const item = document.createElement('li');
            const original = document.createElement('span');
            const result = document.createElement('code');
            original.textContent = VISIBLE[char] ?? char;
            result.textContent = value;
            item.append(original, result);

            return item;
        }));

        list.replaceChildren(...code.flatMap(([language, snippet]) => {
            const term = document.createElement('dt');
            const definition = document.createElement('dd');
            const value = document.createElement('code');
            term.textContent = language;
            value.textContent = snippet;
            definition.append(value);

            return [term, definition];
        }));

        this.root.querySelector('[data-ue-chars-section]').hidden = encoded.size === 0;
        this.root.querySelector('[data-ue-code-section]').hidden = code.length === 0;
        this.root.querySelector('[data-ue-details]').hidden = encoded.size === 0 && code.length === 0;
    }

    renderConnection() {
        const value = (name) => this.connection.elements.namedItem(name).value.trim();
        const fields = {
            scheme: value('scheme'),
            user: this.connection.elements.namedItem('user').value,
            password: this.connection.elements.namedItem('password').value,
            host: value('host'),
            port: value('port'),
            path: value('path'),
            query: value('query'),
        };

        this.connectionResult = fields.scheme !== '' && fields.host !== '' ? connectionUrl(fields) : '';
        this.connectionOutput.textContent = this.connectionResult || this.i18n.empty_connection;
        this.connectionOutput.classList.toggle('is-empty', !this.connectionResult);
        this.root.querySelector('[data-ue-action="copy-connection"]').disabled = !this.connectionResult;
    }
}

document.querySelectorAll('[data-url-encoder]').forEach((root) => new UrlEncoder(root));
