import { copyToClipboard, debounce, readI18n } from '../shared/utils.js';
import {
    apcaContrast, contrastRatio, fromHash, parseColor, passes, suggest, toHash, toHex, truncate, visibleColors,
} from './contrast.js';
import './contrast-checker.scss';

const css = ({ r, g, b, a }) => `rgb(${r} ${g} ${b} / ${a})`;

class ContrastChecker {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.locale = document.documentElement.lang || undefined;
        this.colors = {};

        ['fg', 'bg'].forEach((key) => {
            this.colors[key] = parseColor(this.input(key).value);

            this.input(key).addEventListener('input', () => this.readInput(key));
            this.picker(key).addEventListener('input', () => {
                // Der Farbwähler kennt keine Transparenz; vorhandenes Alpha bleibt erhalten
                const color = { ...parseColor(this.picker(key).value), a: this.colors[key].a };
                this.setColor(key, color);
            });
        });

        root.querySelector('[data-cc-form]').addEventListener('submit', (event) => event.preventDefault());
        root.querySelector('[data-cc-action="swap"]').addEventListener('click', () => this.swap());
        root.querySelector('[data-cc-action="share"]').addEventListener('click', (event) => {
            this.writeHash();
            copyToClipboard(event.currentTarget, window.location.href, this.i18n.copied);
        });
        root.querySelectorAll('[data-cc-suggestion]').forEach((item) => {
            item.querySelector('[data-cc-apply]').addEventListener('click', () => {
                if (item.suggestion) {
                    this.setColor(item.dataset.ccSuggestion, item.suggestion);
                }
            });
        });
        root.querySelectorAll('[data-cc-check]').forEach((item) => {
            const min = this.ratio(Number(item.dataset.ccMin), item.dataset.ccMin.includes('.') ? 1 : 0);
            item.querySelector('[data-cc-check-min]').textContent = this.i18n.min.replace('%ratio%', min);
        });

        // Ansagen für Screenreader erst, wenn der Farbwähler zur Ruhe kommt
        this.announce = debounce((text) => {
            this.root.querySelector('[data-cc-summary]').textContent = text;
        }, 600);
        this.updateHash = debounce(() => this.writeHash(), 300);

        window.addEventListener('hashchange', () => this.readHash());

        if (!this.readHash()) {
            this.render();
        }
    }

    input(key) {
        return this.root.querySelector(`[data-cc-input="${key}"]`);
    }

    picker(key) {
        return this.root.querySelector(`[data-cc-picker="${key}"]`);
    }

    // Ergebnisse immer mit zwei Stellen (4,50:1), Schwellen kurz (4,5:1)
    ratio(value, digits = 2) {
        const number = new Intl.NumberFormat(this.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });

        return `${number.format(value)}:1`;
    }

    // Ungültige Eingaben markieren, das letzte gültige Ergebnis bleibt stehen
    readInput(key) {
        const color = parseColor(this.input(key).value);
        const error = this.root.querySelector(`[data-cc-error="${key}"]`);
        const invalid = color === null && this.input(key).value.trim() !== '';

        this.input(key).classList.toggle('is-invalid', invalid);
        this.input(key).setAttribute('aria-invalid', invalid ? 'true' : 'false');
        error.hidden = !invalid;

        if (color) {
            this.colors[key] = color;
            this.picker(key).value = toHex({ ...color, a: 1 });
            this.render();
        }
    }

    setColor(key, color) {
        this.input(key).value = toHex(color);
        this.readInput(key);
    }

    swap() {
        const { fg, bg } = this.colors;
        const texts = [this.input('fg').value, this.input('bg').value];

        this.colors = { fg: bg, bg: fg };
        // Eingaben wie "navy" oder "rgb(…)" bleiben beim Tauschen so stehen, wie sie getippt wurden
        this.input('fg').value = texts[1];
        this.input('bg').value = texts[0];
        ['fg', 'bg'].forEach((key) => this.readInput(key));
    }

    readHash() {
        const { fg, bg } = fromHash(window.location.hash);

        if (!fg && !bg) {
            return false;
        }

        [['fg', fg], ['bg', bg]].forEach(([key, color]) => {
            if (color) {
                this.input(key).value = toHex(color);
                this.readInput(key);
            }
        });

        return true;
    }

    // replaceState statt location.hash: kein neuer Verlaufseintrag pro Farbänderung
    writeHash() {
        const hash = `#${toHash(this.colors.fg, this.colors.bg)}`;

        if (window.location.hash !== hash) {
            window.history.replaceState(null, '', hash);
        }
    }

    render() {
        const { fg, bg } = this.colors;
        const ratio = contrastRatio(fg, bg);
        const visible = visibleColors(fg, bg);
        let passed = 0;

        this.root.querySelector('[data-cc-ratio]').textContent = this.ratio(truncate(ratio));

        const checks = this.root.querySelectorAll('[data-cc-check]');
        checks.forEach((item) => {
            const ok = passes(ratio, Number(item.dataset.ccMin));
            const status = item.querySelector('[data-cc-status]');
            passed += ok ? 1 : 0;
            status.textContent = `${ok ? '✓' : '✗'} ${ok ? this.i18n.pass : this.i18n.fail}`;
            status.classList.toggle('is-pass', ok);
            status.classList.toggle('is-fail', !ok);
        });

        const lc = apcaContrast(fg, bg);
        this.root.querySelector('[data-cc-apca]').textContent = `Lc ${new Intl.NumberFormat(this.locale, {
            maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: 'exceptZero',
        }).format(lc)}`;

        this.renderHints(fg, bg, visible);
        this.renderPreview(fg, bg);
        this.renderSuggestions();

        this.announce(this.i18n.summary
            .replace('%ratio%', this.ratio(truncate(ratio)))
            .replace('%passed%', passed)
            .replace('%total%', checks.length));
        this.updateHash();
    }

    renderHints(fg, bg, visible) {
        const hints = [];

        if (bg.a < 1) {
            hints.push(this.i18n.alpha_bg.replace('%color%', toHex(visible.bg)));
        }
        if (fg.a < 1) {
            hints.push(this.i18n.alpha_fg.replace('%color%', toHex(visible.fg)));
        }

        const list = this.root.querySelector('[data-cc-hints]');
        list.hidden = hints.length === 0;
        list.replaceChildren(...hints.map((text) => {
            const item = document.createElement('li');
            item.textContent = text;

            return item;
        }));
    }

    // Die Vorschau liegt wie die Prüfung auf weißem Grund, Transparenz rechnet der Browser selbst
    renderPreview(fg, bg) {
        const preview = this.root.querySelector('[data-cc-preview]');
        const button = this.root.querySelector('[data-cc-preview-button]');

        preview.style.backgroundColor = css(bg);
        preview.style.color = css(fg);
        button.style.backgroundColor = css(fg);
        button.style.color = css(visibleColors(fg, bg).bg);
    }

    renderSuggestions() {
        this.root.querySelectorAll('[data-cc-suggestion]').forEach((item) => {
            const target = item.dataset.ccSuggestion;
            const min = Number(item.dataset.ccLevel);
            const result = suggest(this.colors.fg, this.colors.bg, min, target);
            const colors = { ...this.colors, ...(result ? { [target]: result.color } : {}) };
            const swatch = item.querySelector('[data-cc-swatch]');
            const apply = item.querySelector('[data-cc-apply]');
            let text = this.i18n.unreachable;

            if (result?.met) {
                text = `✓ ${this.i18n.met}`;
            } else if (result) {
                text = `${toHex(result.color)} · ${this.ratio(truncate(result.ratio))}`;
            }

            item.suggestion = result && !result.met ? result.color : null;
            item.classList.toggle('is-muted', !item.suggestion);
            item.querySelector('[data-cc-suggestion-text]').textContent = text;
            apply.hidden = !item.suggestion;

            if (item.suggestion) {
                apply.setAttribute('aria-label', this.i18n.apply_label
                    .replace('%color%', toHex(item.suggestion))
                    .replace('%target%', this.i18n[`target_${target}`]));
            }

            swatch.style.backgroundColor = css(colors.bg);
            swatch.style.color = css(colors.fg);
        });
    }
}

document.querySelectorAll('[data-contrast-checker]').forEach((root) => new ContrastChecker(root));
