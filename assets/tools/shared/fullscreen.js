/**
 * Vollbild-Overlay auf Basis von <dialog>: Esc, Klick neben den Inhalt oder "Schließen" beenden es.
 * Der Inhalt wird beim Öffnen kopiert, das Original im Tool bleibt unverändert.
 */
import { copyToClipboard } from './utils.js';

let dialog;

function build(labels) {
    dialog = document.createElement('dialog');
    dialog.className = 'fullscreen-dialog';
    dialog.innerHTML = `
        <div class="fullscreen-dialog__head">
            <h2 class="fullscreen-dialog__title"></h2>
            <div class="fullscreen-dialog__actions">
                <button type="button" class="btn btn-sm btn-primary" data-fullscreen-copy hidden></button>
                <button type="button" class="btn btn-sm btn-outline-secondary" data-fullscreen-close></button>
            </div>
        </div>
        <div class="fullscreen-dialog__body"></div>`;

    dialog.querySelector('[data-fullscreen-close]').addEventListener('click', () => dialog.close());

    // Klick auf den abgedunkelten Rand schließt
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) {
            dialog.close();
        }
    });

    dialog.addEventListener('close', () => {
        document.documentElement.classList.remove('has-fullscreen-dialog');
        dialog.querySelector('.fullscreen-dialog__body').replaceChildren();
    });

    document.body.append(dialog);

    return labels;
}

/**
 * @param {{title: string, content: Node, copyText?: string, labels: {close: string, copy: string, copied: string}}} options
 */
export function openFullscreen({ title, content, copyText, labels }) {
    if (!dialog) {
        build(labels);
    }

    dialog.querySelector('.fullscreen-dialog__title').textContent = title;
    dialog.querySelector('[data-fullscreen-close]').textContent = labels.close;
    dialog.querySelector('.fullscreen-dialog__body').replaceChildren(content);

    const copyButton = dialog.querySelector('[data-fullscreen-copy]');
    copyButton.hidden = !copyText;
    copyButton.textContent = labels.copy;
    copyButton.onclick = () => copyToClipboard(copyButton, copyText, labels.copied);

    document.documentElement.classList.add('has-fullscreen-dialog');
    dialog.showModal();
}
