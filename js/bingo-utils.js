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
