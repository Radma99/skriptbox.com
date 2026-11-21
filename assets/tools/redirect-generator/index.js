import { copyToClipboard, debounce, readI18n } from '../shared/utils.js';
import { downloadBlob } from '../shared/zip.js';
import { analyze, parse, toApache, toCsv, toNginx } from './redirects.js';
import './redirect-generator.scss';

const FORMATS = {
    apache: { build: toApache, file: 'weiterleitungen.htaccess.txt', type: 'text/plain' },
    nginx: { build: toNginx, file: 'weiterleitungen.nginx.conf', type: 'text/plain' },
    csv: { build: toCsv, file: 'weiterleitungen.csv', type: 'text/csv' },
};

class RedirectGenerator {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.form = root.querySelector('[data-rg-form]');
        this.output = root.querySelector('[data-rg-output]');
        this.problems = root.querySelector('[data-rg-problems]');
        this.summary = root.querySelector('[data-rg-summary]');
        this.result = '';

        this.form.addEventListener('input', debounce(() => this.render(), 150));
        this.form.addEventListener('submit', (event) => event.preventDefault());

        root.querySelector('[data-rg-action="example"]').addEventListener('click', () => {
            this.form.elements.namedItem('input').value = this.i18n.example;
            this.render();
        });
        root.querySelector('[data-rg-action="copy"]').addEventListener('click', (event) => {
            copyToClipboard(event.currentTarget, this.result, this.i18n.copied);
        });
        root.querySelector('[data-rg-action="download"]').addEventListener('click', () => {
            const format = FORMATS[this.options().format];
            downloadBlob(new Blob([this.result], { type: `${format.type};charset=utf-8` }), format.file);
        });

        this.render();
    }

    options() {
        const value = (name) => this.form.elements.namedItem(name);

        return {
            input: value('input').value,
            domain: value('domain').value,
            format: value('format').value,
            status: parseInt(value('status').value, 10),
            resolveChains: value('resolveChains').checked,
            ignoreCase: value('ignoreCase').checked,
            ignoreTrailingSlash: value('ignoreTrailingSlash').checked,
        };
    }

    render() {
        const options = this.options();
        const { rules, problems } = analyze(parse(options.input), options);

        this.result = rules.length > 0 ? FORMATS[options.format].build(rules, options) : '';
        this.output.textContent = this.result || this.i18n.empty;
        this.output.classList.toggle('is-empty', !this.result);
        this.root.querySelectorAll('[data-rg-action="copy"], [data-rg-action="download"]').forEach((button) => {
            button.disabled = !this.result;
        });

        this.summary.textContent = this.i18n.summary.replace('%count%', rules.length);
        this.renderProblems(problems);
    }

    renderProblems(problems) {
        this.problems.hidden = problems.length === 0;

        // Hinweise (Kette aufgelöst) und Fehler (Regel fehlt) getrennt darstellen
        this.problems.replaceChildren(...problems
            .sort((a, b) => a.line - b.line)
            .map((problem) => {
                const item = document.createElement('li');
                item.className = problem.type === 'chain_resolved' ? 'is-info' : 'is-warning';
                item.textContent = `${this.i18n.line} ${problem.line}: ${this.i18n[`problem_${problem.type}`]}${problem.detail ? ` – ${problem.detail}` : ''}`;

                return item;
            }));
    }
}

document.querySelectorAll('[data-redirect-generator]').forEach((root) => new RedirectGenerator(root));
