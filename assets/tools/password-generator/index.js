import { copyToClipboard, readI18n } from '../shared/utils.js';
import * as generator from './generator.js';
import './password-generator.scss';

class PasswordGenerator {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.form = root.querySelector('[data-pw-form]');
        this.output = root.querySelector('[data-pw-output]');
        this.meter = root.querySelector('[data-pw-meter]');
        this.meterLabel = root.querySelector('[data-pw-meter-label]');
        this.error = root.querySelector('[data-pw-error]');
        this.mode = 'password';
        this.value = '';

        root.querySelectorAll('[data-pw-mode]').forEach((tab) => {
            tab.addEventListener('click', () => this.selectMode(tab.dataset.pwMode));
        });

        this.form.addEventListener('input', (event) => {
            this.syncRangeLabels();

            if (event.target.type !== 'text') {
                this.generate();
            }
        });
        this.form.addEventListener('submit', (event) => event.preventDefault());

        root.querySelector('[data-pw-action="generate"]').addEventListener('click', () => this.generate());
        root.querySelector('[data-pw-action="copy"]').addEventListener('click', (event) => {
            if (this.value) {
                copyToClipboard(event.currentTarget, this.value, this.i18n.copied);
            }
        });

        this.syncRangeLabels();
        this.selectMode('password');
    }

    selectMode(mode) {
        this.mode = mode;

        this.root.querySelectorAll('[data-pw-mode]').forEach((tab) => {
            const active = tab.dataset.pwMode === mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        this.root.querySelectorAll('[data-pw-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.pwPanel !== mode;
        });

        this.generate();
    }

    syncRangeLabels() {
        this.root.querySelectorAll('[data-range-value]').forEach((label) => {
            label.textContent = this.form.elements.namedItem(label.dataset.rangeValue).value;
        });
    }

    options() {
        const elements = this.form.elements;

        if (this.mode === 'password') {
            return {
                length: parseInt(elements.namedItem('length').value, 10),
                sets: ['lower', 'upper', 'digits', 'symbols'].filter((name) => elements.namedItem(name).checked),
                avoidAmbiguous: elements.namedItem('avoidAmbiguous').checked,
            };
        }

        return {
            count: parseInt(elements.namedItem('words').value, 10),
            separator: elements.namedItem('separator').value,
            capitalize: elements.namedItem('capitalize').checked,
            addNumber: elements.namedItem('addNumber').checked,
        };
    }

    generate() {
        const options = this.options();
        const isPassword = this.mode === 'password';

        this.value = isPassword ? generator.password(options) : generator.passphrase(options);
        const bits = isPassword ? generator.passwordEntropy(options) : generator.passphraseEntropy(options);

        this.error.hidden = this.value !== '';
        this.output.textContent = this.value || '–';
        this.showStrength(this.value ? bits : 0);
    }

    showStrength(bits) {
        const level = generator.strength(bits);

        this.meter.dataset.level = level;
        this.meter.style.setProperty('--strength', `${Math.min(bits / 128, 1) * 100}%`);
        this.meterLabel.textContent = bits
            ? `${this.i18n[`strength_${level}`]} · ${this.i18n.bits.replace('%bits%', Math.round(bits))}`
            : '';
    }
}

document.querySelectorAll('[data-password-generator]').forEach((root) => new PasswordGenerator(root));
