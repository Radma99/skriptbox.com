import { copyToClipboard, readI18n } from '../shared/utils.js';
import { snippets } from './snippets.js';
import {
    INT32_MAX, INT32_MIN, convertLines, dayOfYear, formatIso, formatOffset, formatRfc2822, formatRfc3339, formatWall,
    fromMilliseconds, inUnits, isValidTimeZone, isoWeek, localTimeZone, parseDateTimeLocal, parseTimestamp, relativeTime,
    timeZones, toDateTimeLocal, toMilliseconds, zonedFields, zonedToEpoch,
} from './timestamp.js';
import './timestamp-converter.scss';

const UNIT_KEYS = ['s', 'ms', 'us', 'ns'];

// Platzhalter wie %zone% in Übersetzungen ersetzen
function fill(text, values) {
    return Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`%${key}%`, value), text ?? '');
}

class TimestampConverter {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.locale = document.documentElement.lang || 'en';
        this.localZone = localTimeZone();
        this.zone = this.localZone;
        this.mode = 'date';
        this.paused = false;
        this.language = 'PHP';
        this.instant = null;
        this.wallResult = null;
        this.listResult = '';
        this.clockValue = '';
        this.clockMs = '';

        this.forms = {};
        root.querySelectorAll('[data-ts-form]').forEach((form) => {
            this.forms[form.dataset.tsForm] = form;
            form.addEventListener('submit', (event) => event.preventDefault());
        });
        this.clock = root.querySelector('[data-ts-clock]');
        this.clockMsOutput = root.querySelector('[data-ts-clock-ms]');
        this.relative = root.querySelector('[data-ts-relative]');

        this.fillZones();
        this.bindEvents();

        // Startwerte erst im Browser setzen, weil die Seite gecacht wird
        const now = Date.now();
        this.field('date', 'timestamp').value = String(Math.floor(now / 1000));
        this.field('timestamp', 'datetime').value = toDateTimeLocal(zonedFields(now, this.zone));

        this.tick();
        this.renderDate();
        this.renderTimestamp();
        this.renderList();
    }

    field(form, name) {
        return this.forms[form].elements.namedItem(name);
    }

    bindEvents() {
        this.forms.date.addEventListener('input', () => this.renderDate());
        this.forms.timestamp.addEventListener('input', () => this.renderTimestamp());
        this.forms.list.addEventListener('input', () => this.renderList());

        this.root.querySelectorAll('[data-ts-zone]').forEach((select) => {
            select.addEventListener('change', () => this.selectZone(select.value));
        });
        this.root.querySelectorAll('[data-ts-mode]').forEach((tab) => {
            tab.addEventListener('click', () => this.selectMode(tab.dataset.tsMode));
        });

        const action = (name, callback) => this.root.querySelector(`[data-ts-action="${name}"]`).addEventListener('click', callback);

        action('copy-now', (event) => copyToClipboard(event.currentTarget, this.clockValue, this.i18n.copied));
        action('copy-now-ms', (event) => copyToClipboard(event.currentTarget, this.clockMs, this.i18n.copied));
        action('copy-list', (event) => copyToClipboard(event.currentTarget, this.listResult, this.i18n.copied));
        action('pause', (event) => this.togglePause(event.currentTarget));
        action('use-now', () => {
            this.field('date', 'timestamp').value = this.clockValue;
            this.field('date', 'unit').value = 'auto';
            this.selectMode('date');
            this.field('date', 'timestamp').focus();
        });
        action('now', () => {
            this.field('timestamp', 'datetime').value = toDateTimeLocal(zonedFields(Date.now(), this.zone));
            this.renderTimestamp();
        });

        // Kopieren-Buttons in den Ergebnislisten und Code-Schnipseln werden neu erzeugt, daher delegiert
        this.root.addEventListener('click', (event) => {
            const button = event.target.closest('[data-ts-copy]');

            if (button) {
                copyToClipboard(button, button.dataset.tsCopy, this.i18n.copied);
            }
        });
    }

    // Zonen mit aktuellem Offset, z. B. "Asia/Kathmandu (UTC+05:45)"; dieselbe Liste für alle drei Auswahlfelder
    fillZones() {
        const now = Date.now();
        const options = timeZones().map((zone) => {
            const option = document.createElement('option');
            option.value = zone;
            option.textContent = zone === 'UTC' ? 'UTC' : `${zone} (UTC${formatOffset(zonedFields(now, zone).offset)})`;
            option.selected = zone === this.zone;

            return option;
        });

        this.root.querySelectorAll('[data-ts-zone]').forEach((select) => {
            select.replaceChildren(...options.map((option) => option.cloneNode(true)));
            select.value = this.zone;
        });
    }

    selectZone(zone) {
        if (!isValidTimeZone(zone)) {
            return;
        }

        this.zone = zone;
        this.root.querySelectorAll('[data-ts-zone]').forEach((select) => {
            select.value = zone;
        });
        this.renderDate();
        this.renderTimestamp();
        this.renderList();
    }

    selectMode(mode) {
        // Wert mitnehmen: aus dem Timestamp wird das Datum und umgekehrt
        if (this.mode === 'date' && mode === 'timestamp' && this.instant !== null) {
            this.field('timestamp', 'datetime').value = toDateTimeLocal(zonedFields(toMilliseconds(this.instant), this.zone));
            this.renderTimestamp();
        } else if (this.mode === 'timestamp' && mode === 'date' && this.wallResult !== null) {
            this.field('date', 'timestamp').value = String(Math.floor(this.wallResult.ms / 1000));
            this.field('date', 'unit').value = 'auto';
        }

        this.mode = mode;

        this.root.querySelectorAll('[data-ts-mode]').forEach((tab) => {
            const active = tab.dataset.tsMode === mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        this.root.querySelectorAll('[data-ts-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.tsPanel !== mode;
        });
        this.root.querySelector('[data-ts-code-section]').hidden = mode === 'list';

        this.renderDate();
    }

    togglePause(button) {
        this.paused = !this.paused;
        button.textContent = this.paused ? this.i18n.resume : this.i18n.pause;
        button.setAttribute('aria-pressed', this.paused ? 'true' : 'false');
        this.tick();
    }

    // Jeweils kurz nach dem Sekundenwechsel aktualisieren, damit die Anzeige nicht hinterherläuft.
    // Angehalten wird nur die Uhr, die relative Angabe ("vor 5 Sekunden") läuft weiter.
    tick() {
        clearTimeout(this.timer);

        const now = Date.now();

        if (!this.paused) {
            this.clockValue = String(Math.floor(now / 1000));
            this.clockMs = String(now);
            this.clock.textContent = this.clockValue;
            this.clockMsOutput.textContent = this.clockMs;
        }

        this.renderRelative(now);
        this.timer = setTimeout(() => this.tick(), 1000 - (now % 1000) + 5);
    }

    renderRelative(now = Date.now()) {
        const text = this.instant !== null ? relativeTime(toMilliseconds(this.instant), now, this.locale) : '';

        if (this.relative.textContent !== text) {
            this.relative.textContent = text;
        }
    }

    unitLabel(unit) {
        return this.i18n[`unit_${unit}`] ?? unit;
    }

    // Ergebnis oder Fehlermeldung eines Panels anzeigen
    showState(panel, { empty = '', error = false, hints = [] }) {
        const message = this.root.querySelector(`[data-ts-empty="${panel}"]`);
        const list = this.root.querySelector(`[data-ts-hints="${panel}"]`);

        message.textContent = empty;
        message.hidden = empty === '';
        message.classList.toggle('is-error', error);
        this.root.querySelector(`[data-ts-result="${panel}"]`).hidden = empty !== '';

        list.hidden = hints.length === 0;
        list.replaceChildren(...hints.map((hint) => {
            const item = document.createElement('li');
            item.textContent = hint;

            return item;
        }));
    }

    renderDate() {
        const input = this.field('date', 'timestamp').value;
        const unit = this.field('date', 'unit').value;
        const result = parseTimestamp(input, unit);
        const auto = this.root.querySelector('[data-ts-auto]');
        const detected = this.root.querySelector('[data-ts-detected]');

        auto.textContent = result?.detected ? fill(this.i18n.auto_detected, { unit: this.unitLabel(result.detected) }) : this.i18n.auto;
        detected.textContent = result?.detected && unit === 'auto' ? fill(this.i18n.detected, { unit: this.unitLabel(result.detected) }) : '';

        this.instant = result && !result.error ? result.ns : null;
        this.renderRelative();
        this.renderCode();

        if (result === null) {
            this.showState('date', { empty: this.i18n.empty });

            return;
        }
        if (result.error) {
            this.showState('date', { empty: this.i18n[`error_${result.error}`], error: true });

            return;
        }

        const ms = toMilliseconds(result.ns);
        const seconds = inUnits(result.ns).s;
        const hints = [];

        if (seconds > INT32_MAX || seconds < INT32_MIN) {
            hints.push(this.i18n.hint_y2038);
        }
        if (seconds < 0n) {
            hints.push(this.i18n.hint_negative);
        }

        this.showState('date', { hints });
        this.renderZones(ms);

        const fields = zonedFields(ms, this.zone);
        const week = isoWeek(fields);
        const day = dayOfYear(fields);
        const units = inUnits(result.ns);
        const format = (options) => new Intl.DateTimeFormat(this.locale, { timeZone: this.zone, ...options }).format(new Date(ms));

        this.root.querySelector('[data-ts-formats-title]').textContent = fill(this.i18n.formats, { zone: this.zone });
        this.renderFormats('date', [
            ...UNIT_KEYS.map((key) => [this.unitLabel(key), String(units[key])]),
            [this.i18n.label_iso, formatIso(result.ns)],
            [this.i18n.label_rfc3339, formatRfc3339(result.ns, this.zone)],
            [this.i18n.label_rfc2822, formatRfc2822(result.ns, this.zone)],
            [this.i18n.label_readable, format({ dateStyle: 'full', timeStyle: 'long' })],
            [this.i18n.label_weekday, format({ weekday: 'long' })],
            [this.i18n.label_week, fill(this.i18n.week_value, { week: week.week, label: week.label })],
            [this.i18n.label_day_of_year, fill(this.i18n.day_of_year_value, { day: day.day, days: day.days })],
        ]);
    }

    // UTC, eigene Zone und – falls abweichend – die gewählte Zone nebeneinander
    renderZones(ms) {
        const zones = [['UTC', this.i18n.zone_utc], [this.localZone, `${this.i18n.zone_local} · ${this.localZone}`]];

        if (this.zone !== 'UTC' && this.zone !== this.localZone) {
            zones.push([this.zone, this.zone]);
        }
        if (this.localZone === 'UTC') {
            zones.splice(1, 1);
        }

        this.root.querySelector('[data-ts-zones]').replaceChildren(...zones.map(([zone, label]) => {
            const item = document.createElement('div');
            const term = document.createElement('dt');
            const value = document.createElement('dd');
            const offset = document.createElement('span');
            item.className = 'ts-zones__item';
            term.textContent = label;
            value.textContent = new Intl.DateTimeFormat(this.locale, {
                timeZone: zone,
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            }).format(new Date(ms));
            offset.className = 'ts-zones__offset';
            offset.textContent = `UTC${formatOffset(zonedFields(ms, zone).offset, { withSeconds: true })}`;
            value.append(offset);
            item.append(term, value);

            return item;
        }));
    }

    // Liste aus Bezeichnung, Wert und Kopieren-Button; der Button verweist per aria-describedby auf die Bezeichnung
    renderFormats(panel, rows) {
        this.root.querySelector(`[data-ts-formats="${panel}"]`).replaceChildren(...rows.map(([label, text], index) => {
            const row = document.createElement('div');
            const term = document.createElement('dt');
            const value = document.createElement('dd');
            const code = document.createElement('code');
            const button = document.createElement('button');
            const id = `ts-${panel}-label-${index}`;

            row.className = 'ts-formats__row';
            term.id = id;
            term.textContent = label;
            code.textContent = text;
            button.type = 'button';
            button.className = 'btn btn-sm btn-outline-secondary';
            button.textContent = this.i18n.copy;
            button.dataset.tsCopy = text;
            button.setAttribute('aria-describedby', id);
            value.append(code, button);
            row.append(term, value);

            return row;
        }));
    }

    renderTimestamp() {
        const fields = parseDateTimeLocal(this.field('timestamp', 'datetime').value);

        if (fields === null) {
            this.wallResult = null;
            this.renderCode();
            const filled = this.field('timestamp', 'datetime').value !== '';
            this.showState('timestamp', { empty: filled ? this.i18n.error_date : this.i18n.empty_date, error: filled });

            return;
        }

        const result = zonedToEpoch(fields, this.zone);
        const ns = fromMilliseconds(result.ms);
        const hints = [];

        this.wallResult = { ...result, fields };
        this.renderCode();

        if (result.status === 'gap') {
            hints.push(fill(this.i18n.hint_gap, {
                zone: this.zone,
                from: `UTC${formatOffset(result.before)}`,
                to: `UTC${formatOffset(result.after)}`,
                result: formatRfc3339(ns, this.zone),
            }));
        } else if (result.status === 'ambiguous') {
            hints.push(fill(this.i18n.hint_ambiguous, {
                zone: this.zone,
                first: formatRfc3339(fromMilliseconds(result.earlier), this.zone),
                second: formatRfc3339(fromMilliseconds(result.later), this.zone),
                second_timestamp: String(Math.floor(result.later / 1000)),
            }));
        }

        const seconds = inUnits(ns).s;

        if (seconds > INT32_MAX || seconds < INT32_MIN) {
            hints.push(this.i18n.hint_y2038);
        }
        if (seconds < 0n) {
            hints.push(this.i18n.hint_negative);
        }

        this.showState('timestamp', { hints });
        this.renderFormats('timestamp', [
            [this.unitLabel('s'), String(seconds)],
            [this.unitLabel('ms'), String(result.ms)],
            [this.i18n.label_rfc3339, formatRfc3339(ns, this.zone)],
            [this.i18n.label_iso, formatIso(ns)],
        ]);
    }

    // Eine Zeile je Eingabe; angezeigt mit Leerzeichen ausgerichtet, kopiert mit Tabs (passt in Tabellen)
    renderList() {
        const output = this.root.querySelector('[data-ts-list-output]');
        const rows = convertLines(this.field('list', 'list').value).map(({ input, result }) => {
            if (result === null) {
                return [input];
            }
            if (result.error) {
                return [input, this.i18n.list_invalid];
            }

            return [input, formatRfc3339(result.ns, this.zone), formatIso(result.ns), result.unit.replace('us', 'µs')];
        });

        while (rows.length > 0 && rows[rows.length - 1][0] === '') {
            rows.pop();
        }

        const widths = [0, 0, 0];
        rows.forEach((row) => row.slice(0, 3).forEach((cell, index) => {
            widths[index] = Math.max(widths[index], cell.length);
        }));

        this.listResult = rows.map((row) => row.join('\t')).join('\n');
        output.textContent = rows.map((row) => row.map((cell, index) => (index < row.length - 1 ? cell.padEnd(widths[index]) : cell)).join('  ')).join('\n')
            || this.i18n.empty_list;
        output.classList.toggle('is-empty', this.listResult === '');
        this.root.querySelector('[data-ts-action="copy-list"]').disabled = this.listResult === '';
    }

    renderCode() {
        const now = Date.now();
        const seconds = this.instant !== null ? String(inUnits(this.instant).s) : String(Math.floor(now / 1000));
        const wall = this.wallResult ?? { ...zonedToEpoch(zonedFields(now, this.zone), this.zone), fields: zonedFields(now, this.zone) };
        const fields = { ...wall.fields, millisecond: 0 };
        const ms = Math.floor(wall.ms / 1000) * 1000;
        const languages = snippets({
            seconds,
            zone: this.zone,
            wall: formatWall(fields),
            iso: formatRfc3339(fromMilliseconds(ms), this.zone),
            fields,
            locale: this.locale.includes('-') ? this.locale : ({ de: 'de-DE', en: 'en-US' }[this.locale] ?? this.locale),
        });

        this.renderLanguageTabs(languages);

        const current = languages.find(({ language }) => language === this.language) ?? languages[0];
        this.root.querySelector('[data-ts-code]').replaceChildren(...current.snippets.flatMap(([key, code]) => {
            const term = document.createElement('dt');
            const label = document.createElement('span');
            const button = document.createElement('button');
            const definition = document.createElement('dd');
            const pre = document.createElement('pre');
            const id = `ts-code-${key}`;

            label.id = id;
            label.textContent = this.i18n[`code_${key}`];
            button.type = 'button';
            button.className = 'btn btn-sm btn-outline-secondary';
            button.textContent = this.i18n.copy;
            button.dataset.tsCopy = code;
            button.setAttribute('aria-describedby', id);
            term.append(label, button);
            pre.className = 'ts-code__snippet';
            pre.textContent = code;
            definition.append(pre);

            return [term, definition];
        }));
    }

    renderLanguageTabs(languages) {
        const tabs = this.root.querySelector('[data-ts-languages]');

        if (tabs.childElementCount === 0) {
            tabs.replaceChildren(...languages.map(({ language }) => {
                const tab = document.createElement('button');
                tab.type = 'button';
                tab.className = 'tool-tabs__item';
                tab.setAttribute('role', 'tab');
                tab.setAttribute('aria-controls', 'ts-code');
                tab.dataset.tsLanguage = language;
                tab.textContent = language;
                tab.addEventListener('click', () => {
                    this.language = language;
                    this.renderCode();
                });

                return tab;
            }));
        }

        tabs.querySelectorAll('[data-ts-language]').forEach((tab) => {
            const active = tab.dataset.tsLanguage === this.language;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    }
}

document.querySelectorAll('[data-timestamp-converter]').forEach((root) => new TimestampConverter(root));
