import { copyToClipboard, debounce, readI18n } from '../shared/utils.js';
import { downloadBlob } from '../shared/zip.js';
import {
    apacheConfig, createHash, generatePassword, identify, isAbsolutePath, nginxConfig, parseLine, problems, verify,
} from './htpasswd.js';
import './htpasswd-generator.scss';

const CANCELLED = 'cancelled';

// Problem, nach dem die Zeile nicht in die Datei kommt
const BLOCKING = ['user_empty', 'user_invalid', 'user_long'];

/**
 * Führt Hash-Aufträge im Web Worker aus. Ein neuer Auftrag bricht den laufenden ab, indem der Worker beendet wird –
 * bei Kosten 14 wäre Warten sonst spürbar. Lässt sich der Worker nicht laden, rechnet die Seite selbst.
 */
class Hasher {
    constructor() {
        this.worker = null;
        this.pending = null;
        this.fallback = typeof Worker === 'undefined';
        this.counter = 0;
    }

    start() {
        try {
            this.worker = new Worker(new URL('./worker.js', import.meta.url));
        } catch (error) {
            this.fallback = true;

            return;
        }

        this.worker.addEventListener('message', ({ data }) => {
            const job = this.pending;

            if (!job || data.id !== job.id) {
                return;
            }

            if ('progress' in data) {
                job.onProgress(data.progress);
            } else {
                this.pending = null;
                data.error ? job.reject(new Error(data.error)) : job.resolve(data.result);
            }
        });

        // Z. B. von einer Content-Security-Policy blockiert: offenen Auftrag direkt auf der Seite rechnen
        this.worker.addEventListener('error', (event) => {
            event.preventDefault();
            this.fallback = true;
            this.worker.terminate();
            this.worker = null;

            const job = this.pending;
            this.pending = null;

            if (job) {
                this.local(job.message).then(job.resolve, job.reject);
            }
        });
    }

    local(message) {
        // Kurz warten, damit die Oberfläche "rechnet …" noch anzeigen kann
        return new Promise((resolve) => setTimeout(resolve, 30)).then(() => (message.type === 'verify'
            ? verify(message.hash, message.password)
            : createHash(message.password, message)));
    }

    run(message, onProgress = () => {}) {
        this.cancel();

        if (!this.fallback && !this.worker) {
            this.start();
        }

        if (this.fallback) {
            return this.local(message);
        }

        return new Promise((resolve, reject) => {
            const id = ++this.counter;
            this.pending = { id, message, resolve, reject, onProgress };
            this.worker.postMessage({ id, ...message });
        });
    }

    cancel() {
        if (!this.pending) {
            return;
        }

        this.pending.reject(new Error(CANCELLED));
        this.pending = null;
        this.worker.terminate();
        this.worker = null;
    }
}

class HtpasswdGenerator {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.form = root.querySelector('[data-hp-form]');
        this.users = root.querySelector('[data-hp-users]');
        this.template = root.querySelector('[data-hp-row-template]');
        this.output = root.querySelector('[data-hp-output]');
        this.config = root.querySelector('[data-hp-config]');
        this.verifyForm = root.querySelector('[data-hp-verify]');
        this.hasher = new Hasher();
        this.verifier = new Hasher();
        // Fertige Hashes je Zeile, damit eine Namensänderung nicht neu rechnet und der Salt stabil bleibt
        this.cache = new WeakMap();
        this.generation = 0;
        this.verification = 0;
        this.rowCount = 0;
        this.result = '';

        const render = debounce(() => this.render(), 300);
        this.form.addEventListener('input', (event) => {
            if (event.target.name === 'cost') {
                root.querySelector('[data-hp-cost-value]').textContent = event.target.value;
            }

            render();
        });
        this.form.addEventListener('submit', (event) => event.preventDefault());
        this.form.addEventListener('click', (event) => this.handleRowAction(event));

        this.config.addEventListener('input', () => this.renderConfig());
        this.config.addEventListener('submit', (event) => event.preventDefault());

        const renderVerify = debounce(() => this.renderVerify(), 300);
        this.verifyForm.addEventListener('input', renderVerify);
        this.verifyForm.addEventListener('submit', (event) => event.preventDefault());

        root.querySelectorAll('[data-hp-mode]').forEach((tab) => {
            tab.addEventListener('click', () => this.selectMode(tab.dataset.hpMode));
        });
        root.querySelector('[data-hp-action="copy"]').addEventListener('click', (event) => {
            copyToClipboard(event.currentTarget, this.result, this.i18n.copied);
        });
        root.querySelector('[data-hp-action="download"]').addEventListener('click', () => {
            downloadBlob(new Blob([this.result], { type: 'text/plain' }), '.htpasswd');
        });
        ['apache', 'nginx'].forEach((server) => {
            root.querySelector(`[data-hp-action="copy-${server}"]`).addEventListener('click', (event) => {
                copyToClipboard(event.currentTarget, root.querySelector(`[data-hp-${server}]`).textContent, this.i18n.copied);
            });
        });

        this.addRow();
        this.render();
        this.renderConfig();
        this.renderVerify();
    }

    selectMode(mode) {
        this.root.querySelectorAll('[data-hp-mode]').forEach((tab) => {
            const active = tab.dataset.hpMode === mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        this.root.querySelectorAll('[data-hp-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.hpPanel !== mode;
        });
    }

    addRow() {
        const row = this.template.content.firstElementChild.cloneNode(true);
        const id = `hp-row-${++this.rowCount}`;

        // Eindeutige IDs je Zeile, damit jede Beschriftung zu ihrem Feld gehört
        ['user', 'password'].forEach((name) => {
            row.querySelector(`[name="${name}"]`).id = `${id}-${name}`;
            row.querySelector(`[data-hp-label="${name}"]`).htmlFor = `${id}-${name}`;
        });

        this.users.append(row);
        this.updateRemoveButtons();

        return row;
    }

    handleRowAction(event) {
        const button = event.target.closest('[data-hp-action]');
        const action = button?.dataset.hpAction;

        if (action === 'add') {
            this.addRow().querySelector('[name="user"]').focus();
        } else if (action === 'generate') {
            const input = button.closest('[data-hp-user]').querySelector('[name="password"]');
            input.value = generatePassword();
            input.select();
        } else if (action === 'remove') {
            const row = button.closest('[data-hp-user]');
            const next = row.nextElementSibling ?? row.previousElementSibling;
            row.remove();
            next?.querySelector('[name="user"]').focus();
            this.updateRemoveButtons();
        } else {
            return;
        }

        this.render();
    }

    updateRemoveButtons() {
        const buttons = this.users.querySelectorAll('[data-hp-action="remove"]');
        buttons.forEach((button) => {
            button.disabled = buttons.length === 1;
        });
    }

    settings() {
        return {
            algorithm: this.form.elements.namedItem('algorithm').value,
            cost: Number(this.form.elements.namedItem('cost').value),
        };
    }

    async render() {
        const generation = ++this.generation;
        const { algorithm, cost } = this.settings();
        const rows = Array.from(this.users.querySelectorAll('[data-hp-user]'), (element) => ({
            element,
            user: element.querySelector('[name="user"]').value,
            password: element.querySelector('[name="password"]').value,
        }));

        this.root.querySelector('[data-hp-cost-field]').hidden = algorithm !== 'bcrypt';
        this.root.querySelectorAll('[data-hp-hint]').forEach((hint) => {
            hint.hidden = hint.dataset.hpHint !== algorithm;
        });

        // Leere Zeilen stillschweigend überspringen, sonst Hinweise sammeln
        const seen = new Set();
        const messages = [];
        const valid = rows.filter((row, index) => {
            if (row.user === '' && row.password === '') {
                return false;
            }

            const found = problems(row, algorithm);

            if (seen.has(row.user) && !found.includes('user_empty')) {
                found.push('user_duplicate');
            }

            seen.add(row.user);
            found.forEach((problem) => {
                const prefix = rows.length > 1 ? `${this.i18n.problem_row.replace('%number%', index + 1)} ` : '';
                messages.push(prefix + this.i18n[`problem_${problem}`].replace('%user%', row.user));
            });

            return !found.some((problem) => BLOCKING.includes(problem));
        });

        this.renderProblems(messages);

        const key = (row) => `${algorithm}|${algorithm === 'bcrypt' ? cost : ''}|${row.password}`;
        const todo = valid.filter((row) => this.cache.get(row.element)?.key !== key(row));

        // Ein noch laufender Auftrag gehört zu einer veralteten Eingabe
        this.hasher.cancel();
        this.setBusy(todo.length > 0);

        if (todo.length > 0) {
            for (const [index, row] of todo.entries()) {
                let hash;

                try {
                    hash = await this.hasher.run({ type: 'hash', password: row.password, algorithm, cost }, (share) => {
                        this.setProgress((index + share) / todo.length);
                    });
                } catch (error) {
                    if (error.message !== CANCELLED && generation === this.generation) {
                        this.setBusy(false);
                        this.announce(this.i18n.failed);
                    }

                    return;
                }

                if (generation !== this.generation) {
                    return;
                }

                this.cache.set(row.element, { key: key(row), hash });
                this.setProgress((index + 1) / todo.length);
            }

            this.setBusy(false);
        }

        const lines = valid.map((row) => `${row.user}:${this.cache.get(row.element).hash}`);
        this.result = lines.length > 0 ? `${lines.join('\n')}\n` : '';
        this.output.textContent = lines.length > 0 ? lines.join('\n') : this.i18n.empty;
        this.output.classList.toggle('is-empty', lines.length === 0);
        this.root.querySelector('[data-hp-action="copy"]').disabled = lines.length === 0;
        this.root.querySelector('[data-hp-action="download"]').disabled = lines.length === 0;

        if (todo.length > 0) {
            this.announce(this.i18n.done.replace('%count%', lines.length));
        }
    }

    setBusy(busy) {
        const status = this.root.querySelector('[data-hp-status]');
        clearTimeout(this.busyTimer);
        this.output.classList.toggle('is-busy', busy);
        this.output.setAttribute('aria-busy', busy ? 'true' : 'false');
        ['copy', 'download'].forEach((action) => {
            this.root.querySelector(`[data-hp-action="${action}"]`).disabled = busy;
        });

        if (!busy) {
            status.hidden = true;

            return;
        }

        // Fortschritt erst zeigen, wenn es wirklich dauert – sonst flackert der Balken bei jeder Eingabe
        this.setProgress(0);
        this.busyTimer = setTimeout(() => {
            status.hidden = false;
            this.announce(this.i18n.busy);
        }, 150);
    }

    setProgress(share, selector = '[data-hp-progress]') {
        const progress = this.root.querySelector(selector);
        const percent = Math.round(share * 100);
        progress.setAttribute('aria-valuenow', percent);
        progress.firstElementChild.style.width = `${percent}%`;
    }

    announce(text) {
        this.root.querySelector('[data-hp-announce]').textContent = text;
    }

    renderProblems(messages) {
        const list = this.root.querySelector('[data-hp-problems]');
        list.hidden = messages.length === 0;
        list.replaceChildren(...messages.map((message) => {
            const item = document.createElement('li');
            item.textContent = message;

            return item;
        }));
    }

    renderConfig() {
        const realmInput = this.config.elements.namedItem('realm');
        const fileInput = this.config.elements.namedItem('file');
        const options = {
            realm: realmInput.value.trim() || realmInput.defaultValue,
            file: fileInput.value.trim() || fileInput.defaultValue,
        };

        // Relative Pfade lösen Apache (ServerRoot) und nginx (Konfigurationsordner) unterschiedlich auf
        fileInput.classList.toggle('is-invalid', !isAbsolutePath(options.file));
        this.root.querySelector('[data-hp-apache]').textContent = apacheConfig(options);
        this.root.querySelector('[data-hp-nginx]').textContent = nginxConfig(options);
    }

    async renderVerify() {
        const verification = ++this.verification;
        const verdict = this.root.querySelector('[data-hp-verdict]');
        const status = this.root.querySelector('[data-hp-verify-status]');
        const password = this.verifyForm.elements.namedItem('password').value;
        const { user, hash } = parseLine(this.verifyForm.elements.namedItem('line').value);
        const type = identify(hash);
        const show = (state, text) => {
            verdict.className = `hp-verdict mt-4${state ? ` is-${state}` : ''}`;
            verdict.textContent = text;
        };

        this.verifier.cancel();
        clearTimeout(this.verifyTimer);
        status.hidden = true;

        if (hash === '') {
            show('', this.i18n.verify_empty);

            return;
        }

        if (!type) {
            show('unknown', this.i18n.verify_unknown);

            return;
        }

        this.setProgress(0, '[data-hp-verify-progress]');
        this.verifyTimer = setTimeout(() => {
            // Nur bcrypt rechnet lange genug für einen Fortschrittsbalken
            status.hidden = type.algorithm !== 'bcrypt';
            show('', this.i18n.verify_busy);
        }, 150);

        let match;

        try {
            match = await this.verifier.run({ type: 'verify', hash, password }, (share) => {
                this.setProgress(share, '[data-hp-verify-progress]');
            });
        } catch (error) {
            if (error.message !== CANCELLED && verification === this.verification) {
                clearTimeout(this.verifyTimer);
                status.hidden = true;
                show('unknown', this.i18n.failed);
            }

            return;
        }

        if (verification !== this.verification) {
            return;
        }

        clearTimeout(this.verifyTimer);
        status.hidden = true;

        const name = this.i18n[`name_${type.algorithm}`].replace('%cost%', type.cost);
        const subject = user !== '' ? `${this.i18n.verify_user.replace('%user%', user)} ` : '';
        show(match ? 'match' : 'mismatch', `${subject}${match ? this.i18n.verify_match : this.i18n.verify_mismatch} (${name})`);
    }
}

document.querySelectorAll('[data-htpasswd-generator]').forEach((root) => new HtpasswdGenerator(root));
