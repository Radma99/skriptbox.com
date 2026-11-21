/**
 * Erzeugt Passwörter und Passphrasen mit Web Crypto.
 * Reine Funktionen ohne DOM, damit sie sich einzeln testen lassen.
 */
import { randomInt } from '../shared/utils.js';
import words from './words.js';

export const CHARSETS = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    symbols: '!#$%&*+-=?@^_~.,:;/()[]{}',
};

// Leicht zu verwechseln: Il1|O0o
const AMBIGUOUS = /[Il1O0o|]/g;

function pick(chars) {
    return chars[randomInt(chars.length)];
}

// Fisher-Yates mit kryptografischem Zufall
function shuffle(items) {
    const result = [...items];

    for (let i = result.length - 1; i > 0; i -= 1) {
        const j = randomInt(i + 1);
        [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
}

export function activeSets({ sets, avoidAmbiguous }) {
    return sets
        .map((name) => CHARSETS[name])
        .filter(Boolean)
        .map((chars) => (avoidAmbiguous ? chars.replace(AMBIGUOUS, '') : chars));
}

/**
 * Passwort mit mindestens einem Zeichen aus jeder gewählten Gruppe.
 * Gibt '' zurück, wenn keine Gruppe gewählt ist.
 */
export function password({ length, sets, avoidAmbiguous = false }) {
    const groups = activeSets({ sets, avoidAmbiguous });

    if (groups.length === 0) {
        return '';
    }

    const pool = groups.join('');
    const size = Math.max(length, groups.length);
    const chars = groups.map(pick);

    while (chars.length < size) {
        chars.push(pick(pool));
    }

    return shuffle(chars).join('');
}

export function passphrase({ count, separator = '-', capitalize = true, addNumber = true }) {
    const parts = Array.from({ length: count }, () => {
        const word = words[randomInt(words.length)];

        return capitalize ? word[0].toUpperCase() + word.slice(1) : word;
    });

    if (addNumber) {
        parts.push(String(randomInt(100)));
    }

    return parts.join(separator);
}

// Entropie in Bit, gerechnet auf die Erzeugung (nicht auf das Ergebnis)
export function passwordEntropy({ length, sets, avoidAmbiguous = false }) {
    const pool = activeSets({ sets, avoidAmbiguous }).join('').length;

    return pool > 0 ? length * Math.log2(pool) : 0;
}

export function passphraseEntropy({ count, addNumber = true }) {
    return count * Math.log2(words.length) + (addNumber ? Math.log2(100) : 0);
}

export function strength(bits) {
    if (bits < 50) {
        return 'weak';
    }

    if (bits < 70) {
        return 'medium';
    }

    if (bits < 100) {
        return 'strong';
    }

    return 'very_strong';
}

export const wordCount = words.length;
