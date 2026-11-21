import { debounce, formatBytes, readI18n } from '../shared/utils.js';
import { convert, outputName } from './convert.js';
import './image-converter.scss';

const DOWNLOAD_GAP = 400;

class ImageConverter {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.locale = document.documentElement.lang || 'de';
        this.form = root.querySelector('[data-ic-form]');
        this.input = root.querySelector('[data-ic-input]');
        this.dropzone = root.querySelector('[data-ic-dropzone]');
        this.list = root.querySelector('[data-ic-list]');
        this.summary = root.querySelector('[data-ic-summary]');
        this.toolbar = root.querySelector('[data-ic-toolbar]');
        this.quality = this.form.elements.namedItem('quality');
        this.items = [];
        this.run = 0;

        this.input.addEventListener('change', () => this.add(this.input.files));
        this.bindDropzone();

        const scheduleConvert = debounce(() => this.convertAll(), 250);
        this.form.addEventListener('input', () => {
            this.syncOptions();
            scheduleConvert();
        });
        this.form.addEventListener('submit', (event) => event.preventDefault());

        root.querySelector('[data-ic-action="download-all"]').addEventListener('click', () => this.downloadAll());
        root.querySelector('[data-ic-action="clear"]').addEventListener('click', () => this.clear());

        this.syncOptions();
        this.render();
    }

    bindDropzone() {
        ['dragenter', 'dragover'].forEach((type) => {
            this.dropzone.addEventListener(type, (event) => {
                event.preventDefault();
                this.dropzone.classList.add('is-dragover');
            });
        });

        ['dragleave', 'drop'].forEach((type) => {
            this.dropzone.addEventListener(type, () => this.dropzone.classList.remove('is-dragover'));
        });

        this.dropzone.addEventListener('drop', (event) => {
            event.preventDefault();
            this.add(event.dataTransfer.files);
        });
    }

    options() {
        const value = (name) => this.form.elements.namedItem(name).value;

        return {
            format: value('format'),
            quality: parseInt(value('quality'), 10) / 100,
            maxWidth: parseInt(value('maxWidth'), 10) || 0,
            maxHeight: parseInt(value('maxHeight'), 10) || 0,
        };
    }

    syncOptions() {
        const { format } = this.options();
        const isPng = format === 'image/png';

        this.quality.disabled = isPng;
        this.root.querySelector('[data-range-value="quality"]').textContent = isPng ? '–' : `${this.quality.value} %`;
    }

    add(fileList) {
        const files = [...fileList].filter((file) => file.type.startsWith('image/'));

        files.forEach((file) => {
            this.items.push({ id: crypto.randomUUID(), file, result: null, error: null, url: null });
        });

        this.input.value = '';
        this.convertAll();
    }

    async convertAll() {
        const run = ++this.run;
        const options = this.options();

        this.items.forEach((item) => { item.pending = true; });
        this.render();

        for (const item of this.items) {
            try {
                const result = await convert(item.file, options);

                // Optionen wurden inzwischen geändert, dieser Durchlauf ist überholt
                if (run !== this.run) {
                    return;
                }

                this.setResult(item, result, null);
            } catch (error) {
                if (run !== this.run) {
                    return;
                }

                this.setResult(item, null, error.message === 'unsupported-format' ? this.i18n.unsupportedFormat : this.i18n.readError);
            }

            this.render();
        }
    }

    setResult(item, result, error) {
        if (item.url) {
            URL.revokeObjectURL(item.url);
        }

        item.pending = false;
        item.result = result;
        item.error = error;
        item.url = result ? URL.createObjectURL(result.blob) : null;
        item.name = result ? outputName(item.file.name, result.type) : null;
    }

    remove(id) {
        const item = this.items.find((entry) => entry.id === id);

        if (item?.url) {
            URL.revokeObjectURL(item.url);
        }

        this.items = this.items.filter((entry) => entry.id !== id);
        this.render();
    }

    clear() {
        this.items.forEach((item) => item.url && URL.revokeObjectURL(item.url));
        this.items = [];
        this.run += 1;
        this.render();
    }

    download(item) {
        const link = document.createElement('a');
        link.href = item.url;
        link.download = item.name;
        link.click();
    }

    // Ohne ZIP-Bibliothek: Dateien nacheinander herunterladen
    async downloadAll() {
        const ready = this.items.filter((item) => item.result);

        for (const item of ready) {
            this.download(item);
            await new Promise((resolve) => { setTimeout(resolve, DOWNLOAD_GAP); });
        }
    }

    render() {
        const hasItems = this.items.length > 0;
        this.toolbar.hidden = !hasItems;
        this.list.replaceChildren(...this.items.map((item) => this.renderItem(item)));
        this.renderSummary();
    }

    renderSummary() {
        const done = this.items.filter((item) => item.result);

        if (done.length === 0) {
            this.summary.textContent = '';

            return;
        }

        const before = done.reduce((sum, item) => sum + item.file.size, 0);
        const after = done.reduce((sum, item) => sum + item.result.blob.size, 0);

        this.summary.textContent = (done.length === 1 ? this.i18n.summaryOne : this.i18n.summary)
            .replace('%count%', done.length)
            .replace('%before%', formatBytes(before, this.locale))
            .replace('%after%', formatBytes(after, this.locale))
            .replace('%change%', this.change(before, after));
    }

    change(before, after) {
        const percent = Math.round((1 - after / before) * 100);

        return percent >= 0
            ? this.i18n.smaller.replace('%percent%', percent)
            : this.i18n.larger.replace('%percent%', Math.abs(percent));
    }

    renderItem(item) {
        const element = document.createElement('li');
        element.className = 'ic-item';

        const preview = document.createElement('div');
        preview.className = 'ic-item__preview';

        if (item.url) {
            const image = document.createElement('img');
            image.src = item.url;
            image.alt = '';
            preview.append(image);
        }

        const info = document.createElement('div');
        info.className = 'ic-item__info';

        const name = document.createElement('p');
        name.className = 'ic-item__name';
        name.textContent = item.name || item.file.name;
        info.append(name);

        const details = document.createElement('p');
        details.className = 'ic-item__details';

        if (item.error) {
            details.classList.add('text-danger');
            details.textContent = item.error;
        } else if (item.pending || !item.result) {
            details.textContent = this.i18n.processing;
        } else {
            const { result } = item;
            details.textContent = `${result.original.width} × ${result.original.height} → ${result.width} × ${result.height} px · `
                + `${formatBytes(item.file.size, this.locale)} → ${formatBytes(result.blob.size, this.locale)} `
                + `(${this.change(item.file.size, result.blob.size)})`;
        }

        info.append(details);

        const actions = document.createElement('div');
        actions.className = 'ic-item__actions';

        const download = document.createElement('button');
        download.type = 'button';
        download.className = 'btn btn-sm btn-primary';
        download.textContent = this.i18n.download;
        download.disabled = !item.result || item.pending;
        download.addEventListener('click', () => this.download(item));

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-sm btn-outline-secondary';
        remove.textContent = this.i18n.remove;
        remove.addEventListener('click', () => this.remove(item.id));

        actions.append(download, remove);
        element.append(preview, info, actions);

        return element;
    }
}

document.querySelectorAll('[data-image-converter]').forEach((root) => new ImageConverter(root));
