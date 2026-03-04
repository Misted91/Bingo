/**
 * Bingo utilities — grid generation, shuffle, range, letter helpers
 * Shared by lobby (grid gen) and game (letter helpers)
 */

function generateBingoGrid() {
    const ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
    const cols = [];
    for (let col = 0; col < 5; col++) {
        const [min, max] = ranges[col];
        cols.push(shuffle(range(min, max)).slice(0, 5));
    }
    const flat = [];
    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
            flat.push(cols[col][row]);
        }
    }
    flat[12] = 0; // FREE center
    return flat;
}

function generateDefaultMarked() {
    const m = new Array(25).fill(false);
    m[12] = true;
    return m;
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

function getBingoLetter(n) {
    if (n <= 15) return 'B';
    if (n <= 30) return 'I';
    if (n <= 45) return 'N';
    if (n <= 60) return 'G';
    return 'O';
}

function getBingoCategory(n) {
    const letters = ['B', 'I', 'N', 'G', 'O'];
    return letters[Math.floor((n - 1) / 15)];
}
