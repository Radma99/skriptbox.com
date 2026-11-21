/**
 * Lesbarer Blindtext aus handgeschriebenen Sätzen je Thema und Sprache.
 * Ergebnis ist immer Überschrift + Teaser + Text. Reine Funktionen ohne DOM.
 */
import de from './texts/de.js';
import en from './texts/en.js';

const LANGUAGES = { de, en };

export const LIMITS = {
    paragraphs: 20,
    sentences: 100,
    words: 2000,
};

function randomItem(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function shuffle(list) {
    const result = [...list];

    for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
}

// Liefert Sätze in zufälliger Reihenfolge; erst wenn alle verwendet sind, beginnt eine neue Runde
function sentenceSource(sentences) {
    let queue = [];
    let last = null;

    return () => {
        if (queue.length === 0) {
            queue = shuffle(sentences);

            // Kein Satz direkt zweimal hintereinander über die Rundengrenze hinweg
            if (queue[0] === last && queue.length > 1) {
                queue.push(queue.shift());
            }
        }

        last = queue.shift();

        return last;
    };
}

function wordCount(text) {
    return text.split(/\s+/).filter(Boolean).length;
}

function group(sentences, size) {
    const paragraphs = [];

    for (let i = 0; i < sentences.length; i += size) {
        paragraphs.push(sentences.slice(i, i + size).join(' '));
    }

    return paragraphs;
}

function sentencesForWords(next, target) {
    const sentences = [];
    let total = 0;

    while (total < target) {
        const sentence = next();
        const words = sentence.split(/\s+/);

        if (total + words.length <= target) {
            sentences.push(sentence);
            total += words.length;
        } else {
            // Letzten Satz auf die genaue Wortzahl kürzen und sauber beenden
            const cut = words.slice(0, target - total).join(' ').replace(/[\s,;:–„“"”'’(-]+$/u, '');
            sentences.push(`${cut}.`);
            total = target;
        }
    }

    return sentences;
}

/**
 * @param {{language: string, topic: string, unit: string, count: number}} options
 * @returns {{headline: string, teaser: string, paragraphs: string[], marker: string}}
 */
export function generate({ language, topic, unit, count }) {
    const texts = LANGUAGES[language] ?? de;
    const pool = texts.topics[topic] ?? texts.topics.general;
    const amount = Math.max(1, Math.min(count || 1, LIMITS[unit] ?? 1));
    const next = sentenceSource(pool.sentences);
    let paragraphs;

    if (unit === 'paragraphs') {
        paragraphs = Array.from({ length: amount }, () => {
            const size = 3 + Math.floor(Math.random() * 3);

            return Array.from({ length: size }, next).join(' ');
        });
    } else if (unit === 'sentences') {
        paragraphs = group(Array.from({ length: amount }, next), 4);
    } else {
        paragraphs = group(sentencesForWords(next, amount), 4);
    }

    return {
        headline: randomItem(pool.headlines),
        teaser: randomItem(pool.teasers),
        paragraphs,
        marker: texts.marker,
    };
}

const escapeHtml = (text) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

/**
 * Die drei Blöcke als Text oder HTML, optional mit Blindtext-Markierung.
 * @returns {{headline: string, teaser: string, text: string, all: string}}
 */
export function format(result, { html = false, mark = false }) {
    const comment = `<!-- ${result.marker} -->`;
    const suffix = (text) => (mark ? `${text} ${result.marker}` : text);
    const prefix = (block) => (mark ? `${comment}\n${block}` : block);

    const blocks = html
        ? {
            headline: prefix(`<h2>${escapeHtml(result.headline)}</h2>`),
            teaser: prefix(`<p class="lead">${escapeHtml(result.teaser)}</p>`),
            text: prefix(result.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n')),
        }
        : {
            headline: suffix(result.headline),
            teaser: suffix(result.teaser),
            text: suffix(result.paragraphs.join('\n\n')),
        };

    return { ...blocks, all: [blocks.headline, blocks.teaser, blocks.text].join(html ? '\n' : '\n\n') };
}

export function countWords(paragraphs) {
    return wordCount(paragraphs.join(' '));
}
