import { openFullscreen } from '../shared/fullscreen.js';
import { copyToClipboard, debounce, readI18n } from '../shared/utils.js';
import { detectDelimiter, parse, toCsv, toHtml, toMarkdown } from './table.js';
import './table-to-html.scss';

const DELIMITER_NAMES = { '\t': 'Tab', ';': ';', ',': ',', '|': '|' };

class TableToHtml {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.form = root.querySelector('[data-th-form]');
        this.output = root.querySelector('[data-th-output]');
        this.preview = root.querySelector('[data-th-preview]');
        this.info = root.querySelector('[data-th-info]');
        this.result = '';

        this.form.addEventListener('input', debounce(() => this.render(), 120));
        this.form.addEventListener('submit', (event) => event.preventDefault());

        root.querySelector('[data-th-action="example"]').addEventListener('click', () => {
            this.form.elements.namedItem('input').value = this.i18n.example;
            this.render();
        });
        root.querySelector('[data-th-action="copy"]').addEventListener('click', (event) => {
            copyToClipboard(event.currentTarget, this.result, this.i18n.copied);
        });

        root.querySelectorAll('[data-th-fullscreen]').forEach((button) => {
            button.addEventListener('click', () => this.fullscreen(button.dataset.thFullscreen));
        });

        this.render();
    }

    fullscreen(part) {
        const source = part === 'code' ? this.output : this.preview;
        const labels = { close: this.i18n.close, copy: this.i18n.copy, copied: this.i18n.copied };

        openFullscreen({
            title: part === 'code' ? this.i18n.fullscreenCode : this.i18n.fullscreenPreview,
            content: source.cloneNode(true),
            copyText: part === 'code' && this.result ? this.result : undefined,
            labels,
        });
    }

    options() {
        const value = (name) => this.form.elements.namedItem(name);

        return {
            input: value('input').value,
            delimiter: value('delimiter').value,
            format: value('format').value,
            headerRow: value('headerRow').checked,
            headerColumn: value('headerColumn').checked,
            alignNumbers: value('alignNumbers').checked,
            caption: value('caption').value,
            className: value('className').value,
        };
    }

    render() {
        const options = this.options();
        const delimiter = options.delimiter === 'auto' ? detectDelimiter(options.input) : options.delimiter.replace('tab', '\t');
        const rows = parse(options.input, delimiter);
        const html = toHtml(rows, options);

        this.result = {
            html,
            markdown: toMarkdown(rows, options),
            csv: toCsv(rows),
        }[options.format] ?? html;

        this.output.textContent = this.result || this.i18n.empty;
        this.output.classList.toggle('is-empty', !this.result);
        this.root.querySelectorAll('[data-th-action="copy"], [data-th-fullscreen]').forEach((button) => {
            button.disabled = !this.result;
        });

        // Vorschau: Zellinhalte sind maskiert, das HTML enthält also nur eigene Tags
        this.preview.innerHTML = html.replace('<table', '<table data-preview');
        this.preview.querySelector('table')?.classList.add('table', 'table-sm');

        this.info.textContent = rows.length > 0
            ? this.i18n.info
                .replace('%rows%', rows.length)
                .replace('%columns%', rows[0].length)
                .replace('%delimiter%', DELIMITER_NAMES[delimiter] ?? delimiter)
            : '';
    }
}

document.querySelectorAll('[data-table-to-html]').forEach((root) => new TableToHtml(root));
