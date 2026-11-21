import { copyToClipboard, readI18n } from '../shared/utils.js';
import { generate, LIMITS, toHtml, toText } from './generator.js';
import './lorem-ipsum.scss';

class LoremIpsum {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.form = root.querySelector('[data-li-form]');
        this.output = root.querySelector('[data-li-output]');
        this.stats = root.querySelector('[data-li-stats]');
        this.countInput = this.form.elements.namedItem('count');
        this.number = new Intl.NumberFormat(document.documentElement.lang || 'de');
        this.paragraphs = [];

        this.form.addEventListener('input', (event) => {
            if (event.target.name === 'unit' || event.target.name === 'count') {
                this.applyLimit();
            }

            this.render(event.target.name !== 'format');
        });
        this.form.addEventListener('submit', (event) => event.preventDefault());

        root.querySelector('[data-li-action="generate"]').addEventListener('click', () => this.render(true));
        root.querySelector('[data-li-action="copy"]').addEventListener('click', (event) => {
            copyToClipboard(event.currentTarget, this.output.textContent, this.i18n.copied);
        });

        this.applyLimit();
        this.render(true);
    }

    options() {
        const elements = this.form.elements;

        return {
            unit: elements.namedItem('unit').value,
            count: parseInt(this.countInput.value, 10) || 1,
            classicStart: elements.namedItem('classicStart').checked,
            format: elements.namedItem('format').value,
        };
    }

    applyLimit() {
        const max = LIMITS[this.options().unit];
        this.countInput.max = max;

        if (parseInt(this.countInput.value, 10) > max) {
            this.countInput.value = max;
        }
    }

    // regenerate = false: nur das Format wechseln, Text bleibt gleich
    render(regenerate) {
        const options = this.options();

        if (regenerate) {
            this.paragraphs = generate(options);
        }

        const text = toText(this.paragraphs);
        this.output.textContent = options.format === 'html' ? toHtml(this.paragraphs) : text;
        this.output.classList.toggle('is-code', options.format === 'html');

        const words = text.split(/\s+/).filter(Boolean).length;
        this.stats.textContent = (this.paragraphs.length > 1 ? this.i18n.stats : this.i18n.statsSingle)
            .replace('%paragraphs%', this.number.format(this.paragraphs.length))
            .replace('%words%', this.number.format(words))
            .replace('%characters%', this.number.format(text.length));
    }
}

document.querySelectorAll('[data-lorem-ipsum]').forEach((root) => new LoremIpsum(root));
