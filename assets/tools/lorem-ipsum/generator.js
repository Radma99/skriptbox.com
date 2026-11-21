/**
 * Blindtext-Generator. Wortschatz aus dem klassischen "Lorem ipsum"
 * (abgeleitet aus Ciceros "De finibus bonorum et malorum", gemeinfrei).
 * Reine Funktionen ohne DOM; Zufall muss hier nicht kryptografisch sein.
 */

export const CLASSIC_START = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit';

const WORDS = `
a ac accumsan ad adipiscing aenean aliquam aliquet amet ante aptent arcu at auctor augue bibendum blandit class commodo
condimentum congue consectetur consequat conubia convallis cras cubilia curabitur curae cursus dapibus diam dictum dictumst
dignissim dis dolor donec dui duis efficitur egestas eget eleifend elementum elit enim erat eros est et etiam eu euismod ex
facilisi facilisis fames faucibus felis fermentum feugiat finibus fringilla fusce gravida habitant habitasse hac hendrerit
himenaeos iaculis id imperdiet in inceptos integer interdum ipsum justo lacinia lacus laoreet lectus leo libero ligula litora
lobortis lorem luctus maecenas magna magnis malesuada massa mattis mauris maximus metus mi molestie mollis montes morbi mus nam
nascetur natoque nec neque netus nibh nisi nisl non nostra nulla nullam nunc odio orci ornare parturient pellentesque penatibus
per pharetra phasellus placerat platea porta porttitor posuere potenti praesent pretium primis proin pulvinar purus quam quis
quisque rhoncus ridiculus risus rutrum sagittis sapien scelerisque sed sem semper senectus sit sociosqu sodales sollicitudin
suscipit suspendisse taciti tellus tempor tempus tincidunt torquent tortor tristique turpis ullamcorper ultrices ultricies urna
ut varius vehicula vel velit venenatis vestibulum vitae vivamus viverra volutpat vulputate
`.trim().split(/\s+/);

export const LIMITS = {
    paragraphs: 50,
    sentences: 300,
    words: 5000,
    characters: 50000,
};

function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function pick() {
    return WORDS[randomInt(0, WORDS.length - 1)];
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

// 6–14 Wörter, gelegentlich mit Komma, wie ein natürlicher Satz
function sentence(wordCount = randomInt(6, 14)) {
    const words = Array.from({ length: wordCount }, pick);

    if (wordCount > 8 && Math.random() < 0.5) {
        const position = randomInt(3, wordCount - 3);
        words[position] += ',';
    }

    return `${capitalize(words.join(' '))}.`;
}

function sentences(count) {
    return Array.from({ length: count }, () => sentence());
}

// Den ersten Satz mit dem bekannten Anfang ersetzen
function withClassicStart(list) {
    if (list.length > 0) {
        list[0] = `${CLASSIC_START}. ${list[0]}`;
    }

    return list;
}

function words(count, classicStart) {
    const start = classicStart ? CLASSIC_START.replace(',', '').toLowerCase().split(' ') : [];
    const list = [...start.slice(0, count)];

    while (list.length < count) {
        list.push(pick());
    }

    return `${capitalize(list.join(' '))}.`;
}

// Text mit genau "count" Zeichen, endet auf einen Punkt.
// Wird Wort für Wort aufgebaut; das letzte Wort wird bei Bedarf gekürzt.
function characters(count, classicStart) {
    if (count === 1) {
        return '.';
    }

    const bodyLength = count - 1;
    const queue = classicStart ? CLASSIC_START.split(' ') : [];
    let body = '';
    let sentenceLength = 0;
    let sentenceTarget = randomInt(6, 14);

    while (body.length < bodyLength) {
        let word = queue.length > 0 ? queue.shift() : pick();

        if (sentenceLength === 0) {
            word = capitalize(word);
        }

        const separator = body === '' ? '' : ' ';
        const remaining = bodyLength - body.length - separator.length;

        if (remaining <= 0) {
            // Genau ein Zeichen fehlt: an das letzte Wort einen Buchstaben anhängen
            body += word.charAt(0).toLowerCase();
            break;
        }

        body += separator + word.slice(0, remaining);
        sentenceLength += 1;

        // Satzende einfügen, wenn danach noch Platz für mindestens ein weiteres Wort ist
        if (sentenceLength >= sentenceTarget && body.length + 3 < bodyLength && !body.endsWith(',')) {
            body += '.';
            sentenceLength = 0;
            sentenceTarget = randomInt(6, 14);
        }
    }

    // Satzzeichen direkt vor dem Schlusspunkt vermeiden
    body = body.replace(/[.,]$/, (mark) => (body.length > 1 ? 'a' : mark));

    return `${body}.`;
}

/**
 * @param {{unit: string, count: number, classicStart: boolean}} options
 * @returns {string[]} Absätze
 */
export function generate({ unit, count, classicStart }) {
    const amount = Math.max(1, Math.min(count || 1, LIMITS[unit] ?? 1));

    if (unit === 'paragraphs') {
        const paragraphs = Array.from({ length: amount }, () => sentences(randomInt(4, 8)));

        if (classicStart) {
            withClassicStart(paragraphs[0]);
        }

        return paragraphs.map((list) => list.join(' '));
    }

    if (unit === 'sentences') {
        const list = sentences(amount);

        // Bei "Sätzen" zählt der klassische Anfang als erster Satz
        if (classicStart) {
            list[0] = `${CLASSIC_START}.`;
        }

        return [list.join(' ')];
    }

    if (unit === 'words') {
        return [words(amount, classicStart)];
    }

    return [characters(amount, classicStart)];
}

export function toHtml(paragraphs) {
    return paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('\n');
}

export function toText(paragraphs) {
    return paragraphs.join('\n\n');
}
