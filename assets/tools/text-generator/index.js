import { copyToClipboard, readI18n } from '../shared/utils.js';
import { countWords, format, generate, LIMITS } from './generator.js';
import './text-generator.scss';

// Diese Felder ändern nur die Darstellung, nicht den Text
const DISPLAY_FIELDS = ['format', 'mark'];

class TextGenerator {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.form = root.querySelector('[data-tg-form]');
        this.countInput = this.form.elements.namedItem('count');
        this.number = new Intl.NumberFormat(document.documentElement.lang || 'de');
        this.result = null;
        this.blocks = {};

        this.form.addEventListener('input', (event) => {
            if (['unit', 'count'].includes(event.target.name)) {
                this.applyLimit();
            }

            this.render(!DISPLAY_FIELDS.includes(event.target.name));
        });
        this.form.addEventListener('submit', (event) => event.preventDefault());

        root.querySelector('[data-tg-action="generate"]').addEventListener('click', () => this.render(true));
        root.querySelectorAll('[data-tg-copy]').forEach((button) => {
            button.addEventListener('click', () => copyToClipboard(button, this.blocks[button.dataset.tgCopy], this.i18n.copied));
        });

        this.applyLimit();
        this.render(true);
    }

    options() {
        const value = (name) => this.form.elements.namedItem(name);

        return {
            language: value('language').value,
            topic: value('topic').value,
            unit: value('unit').value,
            count: parseInt(this.countInput.value, 10) || 1,
            html: value('format').value === 'html',
            mark: value('mark').checked,
        };
    }

    applyLimit() {
        const max = LIMITS[this.options().unit];
        this.countInput.max = max;

        if (parseInt(this.countInput.value, 10) > max) {
            this.countInput.value = max;
        }
    }

    render(regenerate) {
        const options = this.options();

        if (regenerate || !this.result) {
            this.result = generate(options);
        }

        this.blocks = format(this.result, options);

        ['headline', 'teaser', 'text'].forEach((key) => {
            const element = this.root.querySelector(`[data-tg-output="${key}"]`);
            element.textContent = this.blocks[key];
            element.classList.toggle('is-code', options.html);
        });

        this.root.querySelector('[data-tg-stats]').textContent = this.i18n.stats
            .replace('%words%', this.number.format(countWords(this.result.paragraphs)))
            .replace('%characters%', this.number.format(this.result.paragraphs.join('\n\n').length));
    }
}

document.querySelectorAll('[data-text-generator]').forEach((root) => new TextGenerator(root));
