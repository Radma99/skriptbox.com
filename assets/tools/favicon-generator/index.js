import { copyToClipboard, debounce, readI18n } from '../shared/utils.js';
import { createZip, downloadBlob } from '../shared/zip.js';
import { createIco } from './ico.js';
import { canvasToPng, htmlSnippet, manifest, renderIcon, textToSvg } from './render.js';
import './favicon-generator.scss';

const PREVIEW_SIZES = [16, 32, 48, 180];

class FaviconGenerator {
    constructor(root) {
        this.root = root;
        this.i18n = readI18n(root);
        this.form = root.querySelector('[data-fg-form]');
        this.previews = root.querySelector('[data-fg-previews]');
        this.tabIcon = root.querySelector('[data-fg-tab-icon]');
        this.code = root.querySelector('[data-fg-code]');
        this.error = root.querySelector('[data-fg-error]');
        this.image = null;
        this.svgSource = null;
        this.mode = 'text';

        root.querySelectorAll('[data-fg-mode]').forEach((tab) => {
            tab.addEventListener('click', () => this.selectMode(tab.dataset.fgMode));
        });

        const scheduleRender = debounce(() => this.render(), 80);
        this.form.addEventListener('input', (event) => {
            if (event.target.name !== 'file') {
                scheduleRender();
            }
        });
        this.form.addEventListener('submit', (event) => event.preventDefault());
        this.form.elements.namedItem('file').addEventListener('change', (event) => this.loadImage(event.target.files[0]));

        root.querySelector('[data-fg-action="zip"]').addEventListener('click', () => this.downloadZip());
        root.querySelector('[data-fg-action="copy"]').addEventListener('click', (event) => {
            copyToClipboard(event.currentTarget, this.code.textContent, this.i18n.copied);
        });

        // Inter ist erst nach dem Laden der Schrift im Canvas verfügbar
        document.fonts.load('700 64px "Inter Variable"').finally(() => this.selectMode('text'));
    }

    selectMode(mode) {
        this.mode = mode;

        this.root.querySelectorAll('[data-fg-mode]').forEach((tab) => {
            const active = tab.dataset.fgMode === mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        this.root.querySelectorAll('[data-fg-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.fgPanel !== mode;
        });

        this.render();
    }

    async loadImage(file) {
        this.error.hidden = true;

        if (!file) {
            return;
        }

        try {
            // SVG-Logos werden zusätzlich unverändert als icon.svg übernommen
            this.svgSource = file.type === 'image/svg+xml' ? await file.text() : null;

            const url = URL.createObjectURL(file);
            const image = new Image();
            image.src = url;
            await image.decode();

            // SVGs ohne feste Größe auf eine gut skalierbare Größe bringen
            if (!image.naturalWidth) {
                image.width = 512;
                image.height = 512;
            }

            this.image = image;
            this.render();
        } catch (error) {
            this.image = null;
            this.error.textContent = this.i18n.readError;
            this.error.hidden = false;
        }
    }

    options() {
        const value = (name) => this.form.elements.namedItem(name);

        return {
            mode: this.mode,
            text: value('text').value,
            font: value('font').value,
            weight: value('weight').value,
            color: value('color').value,
            background: value('background').value,
            transparent: value('transparent').checked,
            shape: value('shape').value,
            textScale: parseInt(value('textScale').value, 10) / 100,
            padding: parseInt(value('padding').value, 10) / 100,
            name: value('name').value.trim() || 'Website',
            image: this.image,
        };
    }

    hasSvg(options) {
        return options.mode === 'text' || Boolean(this.svgSource);
    }

    render() {
        const options = this.options();
        const ready = options.mode === 'text' || options.image;

        this.root.querySelector('[data-fg-action="zip"]').disabled = !ready;
        this.root.querySelector('[data-range-value="textScale"]').textContent = `${Math.round(options.textScale * 100)} %`;
        this.root.querySelector('[data-range-value="padding"]').textContent = `${Math.round(options.padding * 100)} %`;

        this.previews.replaceChildren(...PREVIEW_SIZES.map((size) => {
            const figure = document.createElement('figure');
            figure.className = 'fg-preview';

            if (ready) {
                const canvas = renderIcon(size * 2, options, size === 180);
                canvas.style.width = `${Math.min(size, 96)}px`;
                canvas.style.height = `${Math.min(size, 96)}px`;
                figure.append(canvas);
            }

            const caption = document.createElement('figcaption');
            caption.textContent = size === 180 ? `${size} px (Apple)` : `${size} px`;
            figure.append(caption);

            return figure;
        }));

        if (ready) {
            this.tabIcon.src = renderIcon(64, options).toDataURL('image/png');
        }

        this.code.textContent = htmlSnippet(this.hasSvg(options));
    }

    async downloadZip() {
        const options = this.options();
        const png = (size, opaque = false) => canvasToPng(renderIcon(size, options, opaque));
        const icoImages = await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await png(size) })));

        const files = [
            { name: 'favicon.ico', data: createIco(icoImages) },
            { name: 'apple-touch-icon.png', data: await png(180, true) },
            { name: 'icon-192.png', data: await png(192) },
            { name: 'icon-512.png', data: await png(512) },
            { name: 'site.webmanifest', data: manifest(options.name, options.transparent ? '#ffffff' : options.background, options.background) },
            { name: 'favicon-code.html', data: `${htmlSnippet(this.hasSvg(options))}\n` },
        ];

        if (options.mode === 'text') {
            files.splice(1, 0, { name: 'icon.svg', data: textToSvg(options) });
        } else if (this.svgSource) {
            files.splice(1, 0, { name: 'icon.svg', data: this.svgSource });
        }

        downloadBlob(await createZip(files), 'favicons.zip');
    }
}

document.querySelectorAll('[data-favicon-generator]').forEach((root) => new FaviconGenerator(root));
