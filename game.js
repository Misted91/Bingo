/**
 * BingoOnline - game.js
 * Bingo grid display, number drawing, win detection, real-time sync
 */

// ===== FIREBASE CONFIG =====
const firebaseConfig = {
    apiKey: "AIzaSyBQOObCmTNS3d-H8_1hQbpcyTugUhb00aY",
    authDomain: "bingo-c7caf.firebaseapp.com",
    projectId: "bingo-c7caf",
    storageBucket: "bingo-c7caf.firebasestorage.app",
    messagingSenderId: "824394390490",
    appId: "1:824394390490:web:5c068729ab49b0037d7ee3"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ===== STATE =====
let currentUser = null;
let roomId = null;
let isHost = false;
let myGrid = [];         // flat 1D array of 25 numbers (row-major)
let myMarked = [];       // flat 1D array of 25 booleans
let calledNumbers = [];
let roomListener = null;
let playersListener = null;
let bingoAlreadyClaimed = false;
let allNumbers = shuffle75();
let nextNumberIndex = 0;
let isDrawing = false;

// ===== INIT =====
const params = new URLSearchParams(window.location.search);
roomId = params.get('room');

if (!roomId) {
    window.location.href = 'index.html';
}

auth.onAuthStateChanged(user => {
    currentUser = user;
    renderHeaderAuth(user);
    if (user) {
        initGame();
    } else {
        window.location.href = 'index.html';
    }
});

async function initGame() {
    try {
        const roomSnap = await db.collection('bingo_rooms').doc(roomId).get();
        if (!roomSnap.exists) {
            showToast('Room introuvable', 'error');
            setTimeout(() => window.location.href = 'index.html', 2000);
            return;
        }
        const room = roomSnap.data();
        isHost = room.host === currentUser.uid;

        // Load our player data
        const playerSnap = await db.collection('bingo_rooms').doc(roomId)
            .collection('players').doc(currentUser.uid).get();

        if (!playerSnap.exists) {
            showToast('Tu n\'es plus dans cette room', 'error');
            setTimeout(() => window.location.href = 'index.html', 2000);
            return;
        }

        const player = playerSnap.data();
        myGrid = player.grid;
        myMarked = player.marked;
        calledNumbers = room.calledNumbers || [];
        nextNumberIndex = calledNumbers.length;

        // Setup UI
        document.getElementById('statusRoomCode').textContent = room.code;
        if (isHost) {
            document.getElementById('hostPanel').style.display = 'block';
        }

        renderGrid();
        renderCalledNumbers();
        updateCalledCount();
        showGameContainer();
        listenToRoom();
        listenToPlayers();
    } catch (e) {
        console.error('initGame error:', e);
        showToast('Erreur de chargement', 'error');
        setTimeout(() => window.location.href = 'index.html', 2000);
    }
}

function showGameContainer() {
    document.getElementById('pageLoader').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'block';
}

// ===== REAL-TIME LISTENERS =====
function listenToRoom() {
    roomListener = db.collection('bingo_rooms').doc(roomId).onSnapshot(snap => {
        if (!snap.exists) {
            showToast('La room a été fermée.', 'error');
            setTimeout(() => window.location.href = 'index.html', 2000);
            return;
        }
        const room = snap.data();
        const newCalled = room.calledNumbers || [];

        if (newCalled.length > calledNumbers.length) {
            // New number drawn
            calledNumbers = newCalled;
            const latest = calledNumbers[calledNumbers.length - 1];
            animateNewNumber(latest);
            renderCalledNumbers();
            updateCalledCount();
            highlightGridCalled();
            checkAutoMark(latest);
            updateBingoButton();
        }

        if (room.status === 'finished') {
            handleGameFinished(room);
        }
    });
}

function listenToPlayers() {
    playersListener = db.collection('bingo_rooms').doc(roomId)
        .collection('players').onSnapshot(snap => {
            renderPlayersStatus(snap.docs);
        });
}

// ===== GRID RENDERING =====
function renderGrid() {
    const grid = document.getElementById('bingoGrid');
    grid.innerHTML = '';

    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const cell = document.createElement('div');
            cell.className = 'bingo-cell';
            cell.id = `cell-${r}-${c}`;
            const idx = r * 5 + c;
            const num = myGrid[idx];
            const isCenter = (r === 2 && c === 2);
            const isCalled = num !== 0 && calledNumbers.includes(num);
            const isMarked = myMarked[idx];

            if (isCenter) {
                cell.classList.add('free');
                cell.innerHTML = 'FREE';
            } else {
                cell.textContent = num;
                if (isMarked) cell.classList.add('marked');
                else if (isCalled) {
                    cell.classList.add('called');
                    cell.onclick = () => markCell(r, c);
                } else {
                    cell.onclick = () => markCell(r, c);
                }
            }
            grid.appendChild(cell);
        }
    }
}

function highlightGridCalled() {
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const cell = document.getElementById(`cell-${r}-${c}`);
            if (!cell) continue;
            const idx = r * 5 + c;
            const num = myGrid[idx];
            if (num !== 0 && calledNumbers.includes(num) && !myMarked[idx]) {
                cell.classList.add('called');
            }
        }
    }
}

function checkAutoMark(number) {
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const idx = r * 5 + c;
            if (myGrid[idx] === number && !myMarked[idx]) {
                const cell = document.getElementById(`cell-${r}-${c}`);
                if (cell) {
                    cell.classList.add('called');
                    cell.style.animation = 'winPulse 0.5s ease 3';
                    setTimeout(() => cell.style.animation = '', 1500);
                }
            }
        }
    }
}

async function markCell(r, c) {
    const idx = r * 5 + c;
    const num = myGrid[idx];
    if (num === 0) return; // free
    if (myMarked[idx]) return; // already marked
    if (!calledNumbers.includes(num)) {
        showToast('Ce numéro n\'a pas encore été tiré !', 'error');
        return;
    }

    myMarked[idx] = true;
    const cell = document.getElementById(`cell-${r}-${c}`);
    cell.classList.remove('called');
    cell.classList.add('marked');
    cell.onclick = null;

    // Save to Firestore
    try {
        await db.collection('bingo_rooms').doc(roomId)
            .collection('players').doc(currentUser.uid)
            .update({ marked: myMarked });
    } catch (e) {
        console.error('markCell error:', e);
    }

    updateBingoButton();
}

// ===== BINGO DETECTION =====
function checkBingo() {
    const m = myMarked; // flat 1D, index = r*5+c
    // Check rows
    for (let r = 0; r < 5; r++) {
        if (m[r * 5] && m[r * 5 + 1] && m[r * 5 + 2] && m[r * 5 + 3] && m[r * 5 + 4]) return { type: 'row', index: r };
    }
    // Check columns
    for (let c = 0; c < 5; c++) {
        if (m[c] && m[5 + c] && m[10 + c] && m[15 + c] && m[20 + c]) return { type: 'col', index: c };
    }
    // Check diagonals
    if (m[0] && m[6] && m[12] && m[18] && m[24]) return { type: 'diag', index: 0 };
    if (m[4] && m[8] && m[12] && m[16] && m[20]) return { type: 'diag', index: 1 };
    return null;
}

function updateBingoButton() {
    const bingo = checkBingo();
    const btn = document.getElementById('btnBingo');
    if (bingo && !bingoAlreadyClaimed) {
        btn.style.display = 'inline-flex';
        highlightWinningCells(bingo);
    }
}

function highlightWinningCells(bingo) {
    const cells = [];
    if (bingo.type === 'row') {
        for (let c = 0; c < 5; c++) cells.push(`cell-${bingo.index}-${c}`);
    } else if (bingo.type === 'col') {
        for (let r = 0; r < 5; r++) cells.push(`cell-${r}-${bingo.index}`);
    } else if (bingo.type === 'diag') {
        if (bingo.index === 0) for (let i = 0; i < 5; i++) cells.push(`cell-${i}-${i}`);
        else for (let i = 0; i < 5; i++) cells.push(`cell-${i}-${4 - i}`);
    }
    cells.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('winning');
    });
}

async function claimBingo() {
    if (bingoAlreadyClaimed) return;
    const bingo = checkBingo();
    if (!bingo) {
        showToast('Pas encore de Bingo...', 'error');
        return;
    }
    bingoAlreadyClaimed = true;
    document.getElementById('btnBingo').style.display = 'none';

    try {
        // Update player's hasBingo flag
        await db.collection('bingo_rooms').doc(roomId)
            .collection('players').doc(currentUser.uid)
            .update({ hasBingo: true });

        // Mark room as finished with winner
        await db.collection('bingo_rooms').doc(roomId).update({
            status: 'finished',
            winner: currentUser.uid,
            winnerName: currentUser.displayName
        });
    } catch (e) {
        console.error('claimBingo error:', e);
        showToast('Erreur lors du Bingo', 'error');
    }
}

// ===== NUMBER DRAWING =====
async function drawNumber() {
    if (!isHost || isDrawing) return;
    if (calledNumbers.length >= 75) {
        showToast('Tous les numéros ont été tirés !', 'info');
        return;
    }

    isDrawing = true;
    const btns = ['btnDrawSidebar'];
    btns.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Tirage...'; }
    });

    try {
        // Get a number not yet called
        let number;
        do {
            number = Math.floor(Math.random() * 75) + 1;
        } while (calledNumbers.includes(number));

        await db.collection('bingo_rooms').doc(roomId).update({
            calledNumbers: firebase.firestore.FieldValue.arrayUnion(number)
        });
    } catch (e) {
        console.error('drawNumber error:', e);
        showToast('Erreur de tirage', 'error');
    } finally {
        isDrawing = false;
        ['btnDrawSidebar'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-dice"></i> Tirer un numéro'; }
        });
    }
}

// ===== UI UPDATES =====
function animateNewNumber(num) {
    const category = getBingoCategory(num);
    const el = document.getElementById('currentNumber');
    const catEl = document.getElementById('currentCategory');

    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.style.animation = 'popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    el.textContent = num;
    catEl.textContent = category + ' · ' + num;

    showToast(`Numéro tiré : ${category} ${num}`, 'info');
}

function renderCalledNumbers() {
    const list = document.getElementById('calledList');
    list.innerHTML = '';
    [...calledNumbers].reverse().forEach(n => {
        const badge = document.createElement('span');
        badge.className = 'called-badge';
        badge.textContent = getBingoLetter(n) + n;
        list.appendChild(badge);
    });
}

function updateCalledCount() {
    document.getElementById('statusCount').textContent = calledNumbers.length;
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

function renderPlayersStatus(playerDocs) {
    const container = document.getElementById('playersStatus');
    container.innerHTML = '';
    playerDocs.forEach(doc => {
        const p = doc.data();
        const div = document.createElement('div');
        div.className = 'player-status-item';
        div.innerHTML = `
            <img src="${p.photoURL || 'https://api.dicebear.com/7.x/initials/svg?seed=' + p.name}" alt="">
            <span class="ps-name">${p.name}${doc.id === currentUser?.uid ? ' 👤' : ''}</span>
            ${p.hasBingo ? '<span class="ps-bingo">BINGO!</span>' : ''}
        `;
        container.appendChild(div);
    });
}

function handleGameFinished(room) {
    const overlay = document.getElementById('winner-overlay');
    const title = document.getElementById('winnerTitle');
    const sub = document.getElementById('winnerSubtitle');

    if (room.winner === currentUser.uid) {
        title.innerHTML = '🎊 BINGO ! <span>Tu as gagné !</span>';
        sub.textContent = 'Félicitations, tu es le premier à faire Bingo !';
        launchConfetti();
    } else {
        title.innerHTML = 'Partie terminée !';
        sub.textContent = (room.winnerName || 'Un joueur') + ' a fait BINGO ! 🎉';
    }

    overlay.classList.add('show');
}

// ===== CONFETTI =====
function launchConfetti() {
    const colors = ['#7c3aed', '#a855f7', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
    for (let i = 0; i < 80; i++) {
        setTimeout(() => {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + 'vw';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.animationDuration = (2 + Math.random() * 3) + 's';
            piece.style.animationDelay = '0s';
            piece.style.transform = `rotate(${Math.random() * 360}deg)`;
            document.body.appendChild(piece);
            setTimeout(() => piece.remove(), 5000);
        }, i * 40);
    }
}

// ===== AUTH HEADER =====
function renderHeaderAuth(user) {
    const area = document.getElementById('authArea');
    if (!area) return;
    if (user) {
        area.innerHTML = `
            <div class="user-pill">
                <img src="${user.photoURL || 'https://api.dicebear.com/7.x/initials/svg?seed=' + user.displayName}" alt="avatar">
                <span class="name">${user.displayName}</span>
            </div>
        `;
    }
}

// ===== HELPERS =====
function shuffle75() {
    const arr = [];
    for (let i = 1; i <= 75; i++) arr.push(i);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function confirmLeave() {
    return confirm('Quitter la partie en cours ?');
}

// ===== TOAST =====
let toastTimeout;
function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    t.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${msg}`;
    t.className = `show ${type}`;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => t.classList.remove('show'), 3500);
}
