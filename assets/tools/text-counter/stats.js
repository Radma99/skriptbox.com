/**
 * Kennzahlen eines Textes. Zählt mit Intl.Segmenter, damit Umlaute, Emoji und
 * zusammengesetzte Zeichen als ein Zeichen gelten.
 */

const WORDS_PER_MINUTE_READING = 230;
const WORDS_PER_MINUTE_SPEAKING = 130;

// Häufige Füllwörter, die in der Wortliste nicht auftauchen sollen
const STOPWORDS = new Set(`
aber alle allem allen aller alles als also am an ander andere anderen auch auf aus bei beim bin bis bist da dadurch daher dafür
damit dann darauf darum das dass dein deine dem den denn der des dessen deshalb die dies diese diesem diesen dieser dieses doch
dort du durch ein eine einem einen einer eines einige er es etwas euch euer für gegen gewesen hab habe haben hat hatte hätte
hier hin hinter ich ihm ihn ihnen ihr ihre im in indem ins ist jede jedem jeden jeder jedes jetzt kann kein keine können
könnte machen man manche mehr mein meine mit muss musste nach nicht nichts noch nun nur ob oder ohne sehr sein seine sich sie
sind so solche soll sollte sondern sonst über um und uns unser unter viel vom von vor wann war waren warum was weil weiter
welche wenn wer werde werden wie wieder will wir wird wo wurde würde zu zum zur zwar zwischen
a about after all also an and any are as at be been but by can could did do does for from had has have he her his how i if in
into is it its just me more most my no not of on one only or other our out so some than that the their them then there these
they this to up us was we were what when which who will with would you your
`.trim().split(/\s+/));

export const LIMITS = [
    { key: 'google_title', max: 60 },
    { key: 'meta_description', max: 160 },
    { key: 'sms', max: 160 },
    { key: 'x_post', max: 280 },
    { key: 'instagram', max: 2200 },
    { key: 'linkedin', max: 3000 },
];

const segmenters = new Map();

function segmenter(locale, granularity) {
    const key = `${locale}:${granularity}`;

    if (!segmenters.has(key)) {
        segmenters.set(key, new Intl.Segmenter(locale, { granularity }));
    }

    return segmenters.get(key);
}

export function analyze(text, locale = 'de') {
    const graphemes = [...segmenter(locale, 'grapheme').segment(text)].map((part) => part.segment);
    const words = [...segmenter(locale, 'word').segment(text)]
        .filter((part) => part.isWordLike)
        .map((part) => part.segment);
    const sentences = [...segmenter(locale, 'sentence').segment(text)]
        .filter((part) => part.segment.trim() !== '');

    return {
        characters: graphemes.length,
        charactersNoSpaces: graphemes.filter((char) => !/^\s+$/.test(char)).length,
        words: words.length,
        sentences: sentences.length,
        paragraphs: text.split(/\n\s*\n/).filter((part) => part.trim() !== '').length,
        lines: text === '' ? 0 : text.split(/\r?\n/).length,
        readingMinutes: words.length / WORDS_PER_MINUTE_READING,
        speakingMinutes: words.length / WORDS_PER_MINUTE_SPEAKING,
        topWords: topWords(words, locale),
    };
}

function topWords(words, locale, limit = 10) {
    const counts = new Map();
    let total = 0;

    for (const word of words) {
        const normalized = word.toLocaleLowerCase(locale);

        if (normalized.length < 3 || STOPWORDS.has(normalized) || /^\d+$/.test(normalized)) {
            continue;
        }

        counts.set(normalized, (counts.get(normalized) || 0) + 1);
        total += 1;
    }

    return [...counts.entries()]
        .filter(([, count]) => count > 1)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], locale))
        .slice(0, limit)
        .map(([word, count]) => ({ word, count, share: count / total }));
}
