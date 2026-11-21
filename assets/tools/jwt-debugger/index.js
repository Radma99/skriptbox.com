import { openFullscreen } from '../shared/fullscreen.js';
import { copyToClipboard, debounce, readI18n } from '../shared/utils.js';
import { algorithm, decode, example, sign, timing, TIME_CLAIMS, verify } from './jwt.js';
import './jwt-debugger.scss';

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

// JSON mit farbigen Schlüsseln, Texten, Zahlen und Wahrheitswerten
function highlightJson(value) {
    return escapeHtml(JSON.stringify(value, null, 2)).replace(
        /(&quot;(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\&]|&(?!quot;))*&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
        (match, string, colon, literal) => {
            if (string) {
                return colon ? `<span class="json-key">${string}</span>${colon}` : `<span class="json-string">${string}</span>`;
            }

            return `<span class="${literal ? 'json-literal' : 'json-number'}">${match}</span>`;
        },
    );
}

// Token in drei farbige Teile zerlegen (Header · Payload · Signatur)
function highlightToken(token) {
    const parts = token.split('.');

    return parts
        .map((part, index) => `<span class="jwt-part jwt-part--${['header', 'payload', 'signature'][index] ?? 'extra'}">${escapeHtml(part)}</span>`)
        .join('<span class="jwt-dot">.</span>');
}

class JwtDebugger {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.locale = document.documentElement.lang || 'de';
        this.dateFormat = new Intl.DateTimeFormat(this.locale, { dateStyle: 'medium', timeStyle: 'medium' });
        this.relative = new Intl.RelativeTimeFormat(this.locale, { numeric: 'auto' });
        this.decoded = null;
        this.views = { header: 'json', payload: 'json' };
        this.verifyRun = 0;

        this.input = root.querySelector('[data-jwt-input]');
        this.highlight = root.querySelector('[data-jwt-highlight]');
        this.status = root.querySelector('[data-jwt-status]');
        this.keyInput = root.querySelector('[data-jwt-key]');
        this.secretInput = root.querySelector('[data-jwt-secret]');
        this.secretBase64 = root.querySelector('[data-jwt-secret-base64]');
        this.signatureResult = root.querySelector('[data-jwt-signature-result]');

        this.bindDecoder();
        this.bindEncoder();
        this.bindExample();

        root.querySelectorAll('[data-jwt-mode]').forEach((tab) => {
            tab.addEventListener('click', () => this.selectMode(tab.dataset.jwtMode));
        });

        this.renderDecoder();
        this.renderEncoder();
    }

    selectMode(mode) {
        this.root.querySelectorAll('[data-jwt-mode]').forEach((tab) => {
            const active = tab.dataset.jwtMode === mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        this.root.querySelectorAll('[data-jwt-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.jwtPanel !== mode;
        });
    }

    labels() {
        return { close: this.i18n.close, copy: this.i18n.copy, copied: this.i18n.copied };
    }

    // --- Decoder -------------------------------------------------------------------------

    bindDecoder() {
        this.input.addEventListener('input', () => this.renderDecoder());
        this.input.addEventListener('scroll', () => { this.highlight.scrollTop = this.input.scrollTop; });

        const scheduleVerify = debounce(() => this.verifySignature(), 250);
        [this.keyInput, this.secretInput, this.secretBase64].forEach((field) => field.addEventListener('input', scheduleVerify));

        this.root.querySelector('[data-jwt-action="clear"]').addEventListener('click', () => {
            this.input.value = '';
            this.renderDecoder();
            this.input.focus();
        });

        this.root.querySelectorAll('[data-jwt-view]').forEach((button) => {
            button.addEventListener('click', () => {
                const [part, view] = button.dataset.jwtView.split(':');
                this.views[part] = view;
                this.renderPart(part);
            });
        });

        this.root.querySelectorAll('[data-jwt-copy]').forEach((button) => {
            button.addEventListener('click', () => {
                const part = button.dataset.jwtCopy;
                const text = part === 'token' ? this.input.value.trim() : JSON.stringify(this.decoded?.[part] ?? {}, null, 2);
                copyToClipboard(button, text, this.i18n.copied);
            });
        });

        this.root.querySelectorAll('[data-jwt-fullscreen]').forEach((button) => {
            button.addEventListener('click', () => {
                const part = button.dataset.jwtFullscreen;
                const source = this.root.querySelector(`[data-jwt-output="${part}"]`);
                openFullscreen({
                    title: this.i18n[`title_${part}`],
                    content: source.cloneNode(true),
                    copyText: JSON.stringify(this.decoded?.[part] ?? {}, null, 2),
                    labels: this.labels(),
                });
            });
        });
    }

    renderDecoder() {
        const token = this.input.value;
        this.highlight.innerHTML = `${highlightToken(token)}\n`;

        const trimmed = token.trim();
        this.decoded = trimmed ? decode(trimmed) : null;

        this.renderPart('header');
        this.renderPart('payload');
        this.renderStatus();
        this.renderSignatureInput();
        this.verifySignature();
    }

    renderStatus() {
        const items = [];

        if (!this.decoded) {
            this.status.replaceChildren();

            return;
        }

        if (this.decoded.errors.length === 0) {
            items.push(['ok', this.i18n.valid_structure]);
        }

        this.decoded.errors.forEach((code) => items.push(['error', this.i18n[`error_${code}`] ?? code]));
        timing(this.decoded.payload).forEach((code) => items.push(['warning', this.i18n[`timing_${code}`]]));

        if (this.decoded.header?.alg === 'none') {
            items.push(['error', this.i18n.error_alg_none]);
        }

        this.status.replaceChildren(...items.map(([type, text]) => {
            const item = document.createElement('li');
            item.className = `jwt-status__item is-${type}`;
            item.textContent = text;

            return item;
        }));
    }

    renderPart(part) {
        const output = this.root.querySelector(`[data-jwt-output="${part}"]`);
        const value = this.decoded?.[part];

        this.root.querySelectorAll(`[data-jwt-view^="${part}:"]`).forEach((button) => {
            button.classList.toggle('active', button.dataset.jwtView === `${part}:${this.views[part]}`);
        });

        if (!value) {
            output.innerHTML = `<p class="jwt-empty">${escapeHtml(this.i18n.empty)}</p>`;

            return;
        }

        output.innerHTML = this.views[part] === 'claims' ? this.claimsTable(value) : `<pre class="jwt-json">${highlightJson(value)}</pre>`;
    }

    formatTime(seconds) {
        const date = new Date(seconds * 1000);
        const diff = seconds - Date.now() / 1000;
        const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
        const [unit, size] = units.find(([, length]) => Math.abs(diff) >= length) ?? ['second', 1];

        return `${this.dateFormat.format(date)} (${this.relative.format(Math.round(diff / size), unit)})`;
    }

    claimsTable(object) {
        const rows = Object.entries(object).map(([claim, value]) => {
            const isTime = TIME_CLAIMS.includes(claim) && typeof value === 'number';
            const display = isTime ? this.formatTime(value) : (typeof value === 'string' ? value : JSON.stringify(value));
            const description = this.i18n.claims[claim] ?? '';

            return `<tr><th scope="row"><code>${escapeHtml(claim)}</code></th><td>${escapeHtml(display)}${description ? `<span class="jwt-claim-description">${escapeHtml(description)}</span>` : ''}</td></tr>`;
        });

        return `<table class="table table-sm jwt-claims"><tbody>${rows.join('')}</tbody></table>`;
    }

    renderSignatureInput() {
        const alg = this.decoded?.header?.alg;
        const family = alg ? algorithm(alg)?.family : null;

        this.root.querySelector('[data-jwt-alg]').textContent = alg ?? '–';
        this.root.querySelector('[data-jwt-secret-group]').hidden = family !== 'hmac';
        this.root.querySelector('[data-jwt-key-group]').hidden = !family || family === 'hmac';
    }

    async verifySignature() {
        const run = ++this.verifyRun;
        const header = this.decoded?.header;
        const result = this.signatureResult;
        const family = header?.alg ? algorithm(header.alg)?.family : null;
        const keyText = family === 'hmac' ? this.secretInput.value : this.keyInput.value;

        const show = (type, text) => {
            if (run !== this.verifyRun) {
                return;
            }

            result.className = `jwt-signature-result is-${type}`;
            result.textContent = text;
        };

        if (!this.decoded || this.decoded.errors.length > 0) {
            show('neutral', '');

            return;
        }

        if (!family) {
            show('error', header.alg === 'none' ? this.i18n.error_alg_none : this.i18n.error_alg_unsupported.replace('%alg%', header.alg ?? '?'));

            return;
        }

        if (keyText.trim() === '') {
            show('neutral', family === 'hmac' ? this.i18n.signature_enter_secret : this.i18n.signature_enter_key);

            return;
        }

        try {
            const valid = await verify(this.input.value, keyText, { secretBase64: this.secretBase64.checked });
            show(valid ? 'ok' : 'error', valid ? this.i18n.signature_valid : this.i18n.signature_invalid);
        } catch (error) {
            show('error', this.i18n[`error_${error.message}`] ?? this.i18n.error_key_format);
        }
    }

    // --- Encoder -------------------------------------------------------------------------

    bindEncoder() {
        const form = this.root.querySelector('[data-jwt-encoder]');
        this.encoder = form;
        this.encoderOutput = this.root.querySelector('[data-jwt-encoded]');
        this.encoderStatus = this.root.querySelector('[data-jwt-encoder-status]');

        // Algorithmus sofort in den Header übernehmen, nicht verzögert (sonst überholt ihn die nächste Eingabe)
        form.elements.namedItem('alg').addEventListener('input', () => this.syncHeaderAlg());
        form.addEventListener('input', debounce(() => this.renderEncoder(), 200));
        form.addEventListener('submit', (event) => event.preventDefault());

        this.root.querySelectorAll('[data-jwt-time]').forEach((button) => {
            button.addEventListener('click', () => this.setTimeClaim(button.dataset.jwtTime));
        });

        this.root.querySelector('[data-jwt-action="copy-encoded"]').addEventListener('click', (event) => {
            copyToClipboard(event.currentTarget, this.encoded ?? '', this.i18n.copied);
        });

        this.root.querySelector('[data-jwt-action="to-decoder"]').addEventListener('click', () => {
            if (!this.encoded) {
                return;
            }

            const field = (name) => form.elements.namedItem(name);
            const hmac = algorithm(field('alg').value)?.family === 'hmac';
            this.input.value = this.encoded;
            this.secretInput.value = hmac ? field('signSecret').value : '';
            this.secretBase64.checked = hmac && field('signSecretBase64').checked;
            this.keyInput.value = '';
            this.selectMode('decoder');
            this.renderDecoder();
        });
    }

    jsonField(name) {
        return JSON.parse(this.encoder.elements.namedItem(name).value || '{}');
    }

    syncHeaderAlg() {
        try {
            const header = this.jsonField('header');
            header.alg = this.encoder.elements.namedItem('alg').value;
            this.encoder.elements.namedItem('header').value = JSON.stringify(header, null, 2);
        } catch (error) {
            // Ungültiges JSON zeigt renderEncoder als Fehler an
        }
    }

    setTimeClaim(spec) {
        try {
            const payload = this.jsonField('payload');
            const now = Math.floor(Date.now() / 1000);
            const [claim, offset] = spec.split(':');
            payload[claim] = now + Number(offset || 0);
            this.encoder.elements.namedItem('payload').value = JSON.stringify(payload, null, 2);
            this.renderEncoder();
        } catch (error) {
            this.renderEncoder();
        }
    }

    async renderEncoder() {
        const field = (name) => this.encoder.elements.namedItem(name);
        const alg = field('alg').value;
        const family = algorithm(alg)?.family;

        this.root.querySelector('[data-jwt-sign-secret-group]').hidden = family !== 'hmac';
        this.root.querySelector('[data-jwt-sign-key-group]').hidden = family === 'hmac';

        const fail = (message) => {
            this.encoded = null;
            this.encoderOutput.innerHTML = '';
            this.encoderStatus.className = 'jwt-signature-result is-error';
            this.encoderStatus.textContent = message;
        };

        let header;
        let payload;

        try {
            header = this.jsonField('header');
        } catch (error) {
            fail(this.i18n.error_header_json);

            return;
        }

        try {
            payload = this.jsonField('payload');
        } catch (error) {
            fail(this.i18n.error_payload_json);

            return;
        }

        const keyText = family === 'hmac' ? field('signSecret').value : field('signKey').value;

        if (keyText.trim() === '') {
            fail(family === 'hmac' ? this.i18n.signature_enter_secret : this.i18n.encoder_enter_private_key);

            return;
        }

        try {
            this.encoded = await sign({ ...header, alg }, payload, keyText, { secretBase64: field('signSecretBase64').checked });
            this.encoderOutput.innerHTML = highlightToken(this.encoded);
            this.encoderStatus.className = 'jwt-signature-result is-ok';
            this.encoderStatus.textContent = this.i18n.encoder_signed.replace('%alg%', alg);
        } catch (error) {
            fail(this.i18n[`error_${error.message}`] ?? this.i18n.error_key_format);
        }
    }

    // --- Beispiel ------------------------------------------------------------------------

    bindExample() {
        this.root.querySelector('[data-jwt-action="example"]').addEventListener('click', () => this.loadExample());
    }

    async loadExample() {
        const alg = this.root.querySelector('[data-jwt-example-alg]').value;
        const button = this.root.querySelector('[data-jwt-action="example"]');
        button.disabled = true;

        try {
            const result = await example(alg);
            const hmac = algorithm(alg).family === 'hmac';

            // Decoder: Token und Schlüssel zum Prüfen
            this.input.value = result.token;
            this.secretInput.value = hmac ? result.verifyKey : '';
            this.secretBase64.checked = hmac;
            this.keyInput.value = hmac ? '' : result.verifyKey;

            // Encoder: dieselben Daten zum Weiterbearbeiten
            const field = (name) => this.encoder.elements.namedItem(name);
            field('alg').value = alg;
            field('header').value = JSON.stringify(result.header, null, 2);
            field('payload').value = JSON.stringify(result.payload, null, 2);
            field('signSecret').value = hmac ? result.signKey : '';
            field('signSecretBase64').checked = hmac;
            field('signKey').value = hmac ? '' : result.signKey;

            this.renderDecoder();
            this.renderEncoder();
        } catch (error) {
            this.signatureResult.className = 'jwt-signature-result is-error';
            this.signatureResult.textContent = this.i18n.error_alg_browser.replace('%alg%', alg);
        } finally {
            button.disabled = false;
        }
    }
}

document.querySelectorAll('[data-jwt-debugger]').forEach((root) => new JwtDebugger(root));
