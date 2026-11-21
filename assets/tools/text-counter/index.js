import { debounce, readI18n } from '../shared/utils.js';
import { analyze, LIMITS } from './stats.js';
import './text-counter.scss';

class TextCounter {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.locale = document.documentElement.lang || 'de';
        this.input = root.querySelector('[data-tc-input]');
        this.limits = root.querySelector('[data-tc-limits]');
        this.topWords = root.querySelector('[data-tc-top-words]');
        this.number = new Intl.NumberFormat(this.locale);
        this.percent = new Intl.NumberFormat(this.locale, { style: 'percent', maximumFractionDigits: 1 });

        this.renderLimits();
        this.input.addEventListener('input', debounce(() => this.update(), 80));
        root.querySelector('[data-tc-action="clear"]').addEventListener('click', () => {
            this.input.value = '';
            this.input.focus();
            this.update();
        });

        this.update();
    }

    renderLimits() {
        this.limits.innerHTML = LIMITS.map(({ key, max }) => `
            <li class="tc-limit" data-limit="${max}">
                <div class="tc-limit__head">
                    <span>${this.i18n[`limit_${key}`]}</span>
                    <span class="tc-limit__count" data-limit-count></span>
                </div>
                <div class="tc-limit__bar"><span data-limit-bar></span></div>
            </li>`).join('');
    }

    duration(minutes) {
        if (minutes === 0) {
            return '0';
        }

        if (minutes < 1) {
            return this.i18n.seconds.replace('%count%', Math.max(1, Math.round(minutes * 60)));
        }

        return this.i18n.minutes.replace('%count%', this.number.format(Math.round(minutes * 10) / 10));
    }

    update() {
        const stats = analyze(this.input.value, this.locale);

        const values = {
            characters: this.number.format(stats.characters),
            charactersNoSpaces: this.number.format(stats.charactersNoSpaces),
            words: this.number.format(stats.words),
            sentences: this.number.format(stats.sentences),
            paragraphs: this.number.format(stats.paragraphs),
            lines: this.number.format(stats.lines),
            readingTime: this.duration(stats.readingMinutes),
            speakingTime: this.duration(stats.speakingMinutes),
        };

        Object.entries(values).forEach(([key, value]) => {
            this.root.querySelector(`[data-tc-stat="${key}"]`).textContent = value;
        });

        this.limits.querySelectorAll('[data-limit]').forEach((item) => {
            const max = parseInt(item.dataset.limit, 10);
            const over = stats.characters > max;

            item.classList.toggle('is-over', over);
            item.querySelector('[data-limit-count]').textContent = `${this.number.format(stats.characters)} / ${this.number.format(max)}`;
            item.querySelector('[data-limit-bar]').style.width = `${Math.min(stats.characters / max, 1) * 100}%`;
        });

        this.renderTopWords(stats.topWords);
    }

    renderTopWords(words) {
        if (words.length === 0) {
            this.topWords.innerHTML = `<p class="tc-empty">${this.i18n.noTopWords}</p>`;

            return;
        }

        const rows = words.map(({ word, count, share }) => {
            const cell = document.createElement('td');
            cell.textContent = word;

            return `<tr>${cell.outerHTML}<td class="text-end">${this.number.format(count)}</td><td class="text-end">${this.percent.format(share)}</td></tr>`;
        }).join('');

        this.topWords.innerHTML = `
            <table class="table table-sm tc-table">
                <thead><tr><th>${this.i18n.word}</th><th class="text-end">${this.i18n.count}</th><th class="text-end">${this.i18n.share}</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }
}

document.querySelectorAll('[data-text-counter]').forEach((root) => new TextCounter(root));
