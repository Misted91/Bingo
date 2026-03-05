/**
 * Bingo utilities — grid generation, shuffle, range, letter helpers
 * Shared by lobby (grid gen) and game (letter helpers)
 */

const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O', 'S', 'T'];

function generateBingoGrid(size) {
    size = size || 5;
    const cols = [];
    for (let col = 0; col < size; col++) {
        const min = col * 15 + 1;
        const max = col * 15 + 15;
        cols.push(shuffle(range(min, max)).slice(0, size));
    }
    const flat = [];
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            flat.push(cols[col][row]);
        }
    }
    // FREE center for odd sizes
    if (size % 2 === 1) {
        const center = Math.floor(size * size / 2);
        flat[center] = 0;
    }
    return flat;
}

function generateDefaultMarked(size) {
    size = size || 5;
    const m = new Array(size * size).fill(false);
    if (size % 2 === 1) {
        m[Math.floor(size * size / 2)] = true;
    }
    return m;
}

function getMaxNumber(size) {
    return (size || 5) * 15;
}

function range(min, max) {
    const arr = [];
    for (let i = min; i <= max; i++) arr.push(i);
    return arr;
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function getBingoLetter(n, size) {
    const idx = Math.floor((n - 1) / 15);
    return BINGO_LETTERS[idx] || '?';
}

function getBingoCategory(n) {
    const idx = Math.floor((n - 1) / 15);
    return BINGO_LETTERS[idx] || '?';
}

// ===== CHAT FILTER =====
const BANNED_WORDS = [
    // FR
    'merde', 'putain', 'connard', 'connasse', 'encule', 'enculer', 'salope',
    'salaud', 'batard', 'nique', 'niquer', 'ntm', 'ftg', 'fdp',
    'pute', 'bordel', 'pd', 'tg', 'ta gueule', 'ferme ta gueule',
    'enfoire', 'branleur', 'couille', 'couilles', 'bite', 'bites',
    'chier', 'petasse', 'cul', 'bouffon', 'bouffonne', 'abruti',
    'abrutie', 'debile', 'gogol', 'mongol', 'attarde',
    'tare', 'cretin', 'ducon', 'naze', 'tocard',
    // EN
    'fuck', 'fucking', 'shit', 'bitch', 'asshole', 'bastard', 'damn',
    'dick', 'pussy', 'cunt', 'whore', 'slut', 'nigger', 'nigga',
    'retard', 'retarded', 'stfu', 'wtf', 'moron', 'idiot',
    'dumbass', 'jackass', 'motherfucker', 'bullshit'
];

// Leet speak substitution map: normalized char → regex pattern matching all variants
const LEET_MAP = {
    'a': '[a@4àáâãäå]',
    'b': '[b8]',
    'c': '[cç¢(]',
    'e': '[e3éèêë€]',
    'g': '[g96]',
    'i': '[i1!|ïî]',
    'l': '[l1!|]',
    'o': '[o0ôöò]',
    's': '[s$5]',
    't': '[t7+]',
    'u': '[uùûü]',
    'n': '[nñ]'
};

let _bannedRegex = null;
function getBannedRegex() {
    if (!_bannedRegex) {
        const patterns = BANNED_WORDS.map(word => {
            // Build a regex pattern for each word, replacing each char with its leet variants
            let pat = '';
            for (const ch of word) {
                if (ch === ' ') {
                    pat += '\\s+';
                } else {
                    const lower = ch.toLowerCase();
                    pat += LEET_MAP[lower] || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                }
            }
            return pat;
        });
        _bannedRegex = new RegExp('(?:^|\\b|\\s)(' + patterns.join('|') + ')(?:\\b|\\s|$)', 'gi');
    }
    return _bannedRegex;
}

function filterChatMessage(text) {
    return text.replace(getBannedRegex(), (match, group) => {
        // Preserve leading/trailing whitespace from the match, only replace the captured group
        const start = match.indexOf(group);
        const before = match.substring(0, start);
        const after = match.substring(start + group.length);
        return before + '*'.repeat(group.length) + after;
    });
}
