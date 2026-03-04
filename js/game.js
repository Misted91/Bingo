/**
 * Game module — bingo grid, number drawing, win detection, real-time sync
 */

// ===== STATE =====
let currentUser = null;
let roomId = null;
let isHost = false;
let myGrid = [];
let myMarked = [];
let calledNumbers = [];
let roomListener = null;
let playersListener = null;
let bingoAlreadyClaimed = false;
let isDrawing = false;

// ===== INIT =====
const params = new URLSearchParams(window.location.search);
roomId = params.get('room');

if (!roomId) {
    window.location.href = './index.html';
}

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();

    document.getElementById('btnQuitGame').addEventListener('click', (e) => {
        if (!confirmLeave()) e.preventDefault();
    });
    document.getElementById('btnDraw').addEventListener('click', drawNumber);
    document.getElementById('btnDrawSidebar').addEventListener('click', drawNumber);
    document.getElementById('btnBingo').addEventListener('click', claimBingo);
});

auth.onAuthStateChanged(user => {
    currentUser = user;
    renderHeaderAuth(user);
    if (user) {
        initGame();
    } else {
        window.location.href = './index.html';
    }
});

async function initGame() {
    try {
        const roomSnap = await db.collection('bingo_rooms').doc(roomId).get();
        if (!roomSnap.exists) {
            showToast('Room introuvable', 'error');
            setTimeout(() => window.location.href = './index.html', 2000);
            return;
        }
        const room = roomSnap.data();
        isHost = room.host === currentUser.uid;

        const playerSnap = await db.collection('bingo_rooms').doc(roomId)
            .collection('players').doc(currentUser.uid).get();

        if (!playerSnap.exists) {
            showToast('Tu n\'es plus dans cette room', 'error');
            setTimeout(() => window.location.href = './index.html', 2000);
            return;
        }

        const player = playerSnap.data();
        myGrid = player.grid;
        myMarked = player.marked;
        calledNumbers = room.calledNumbers || [];

        document.getElementById('statusRoomCode').textContent = room.code;
        if (isHost) {
            document.getElementById('hostPanel').classList.remove('hidden');
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
        setTimeout(() => window.location.href = './index.html', 2000);
    }
}

function showGameContainer() {
    document.getElementById('pageLoader').classList.add('hidden');
    document.getElementById('gameContainer').classList.remove('hidden');
    lucide.createIcons();
}

// ===== REAL-TIME LISTENERS =====
function listenToRoom() {
    roomListener = db.collection('bingo_rooms').doc(roomId).onSnapshot(snap => {
        if (!snap.exists) {
            showToast('La room a été fermée.', 'error');
            setTimeout(() => window.location.href = './index.html', 2000);
            return;
        }
        const room = snap.data();
        const newCalled = room.calledNumbers || [];

        if (newCalled.length > calledNumbers.length) {
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
    grid.textContent = '';

    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const cell = document.createElement('div');
            cell.className = 'bingo-cell';
            cell.id = 'cell-' + r + '-' + c;
            const idx = r * 5 + c;
            const num = myGrid[idx];
            const isCenter = (r === 2 && c === 2);
            const isCalled = num !== 0 && calledNumbers.includes(num);
            const isMarked = myMarked[idx];

            if (isCenter) {
                cell.classList.add('free');
                cell.textContent = 'FREE';
            } else {
                cell.textContent = num;
                if (isMarked) {
                    cell.classList.add('marked');
                } else if (isCalled) {
                    cell.classList.add('called');
                    cell.addEventListener('click', () => markCell(r, c));
                } else {
                    cell.addEventListener('click', () => markCell(r, c));
                }
            }
            grid.appendChild(cell);
        }
    }
}

function highlightGridCalled() {
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const cell = document.getElementById('cell-' + r + '-' + c);
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
                const cell = document.getElementById('cell-' + r + '-' + c);
                if (cell) {
                    cell.classList.add('called', 'cell-pulse');
                    setTimeout(() => cell.classList.remove('cell-pulse'), 1500);
                }
            }
        }
    }
}

async function markCell(r, c) {
    const idx = r * 5 + c;
    const num = myGrid[idx];
    if (num === 0) return;
    if (myMarked[idx]) return;
    if (!calledNumbers.includes(num)) {
        showToast('Ce numéro n\'a pas encore été tiré !', 'error');
        return;
    }

    myMarked[idx] = true;
    const cell = document.getElementById('cell-' + r + '-' + c);
    cell.classList.remove('called');
    cell.classList.add('marked');

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
    const m = myMarked;
    for (let r = 0; r < 5; r++) {
        if (m[r * 5] && m[r * 5 + 1] && m[r * 5 + 2] && m[r * 5 + 3] && m[r * 5 + 4]) return { type: 'row', index: r };
    }
    for (let c = 0; c < 5; c++) {
        if (m[c] && m[5 + c] && m[10 + c] && m[15 + c] && m[20 + c]) return { type: 'col', index: c };
    }
    if (m[0] && m[6] && m[12] && m[18] && m[24]) return { type: 'diag', index: 0 };
    if (m[4] && m[8] && m[12] && m[16] && m[20]) return { type: 'diag', index: 1 };
    return null;
}

function updateBingoButton() {
    const bingo = checkBingo();
    const btn = document.getElementById('btnBingo');
    if (bingo && !bingoAlreadyClaimed) {
        btn.classList.remove('hidden');
        highlightWinningCells(bingo);
    }
}

function highlightWinningCells(bingo) {
    const cells = [];
    if (bingo.type === 'row') {
        for (let c = 0; c < 5; c++) cells.push('cell-' + bingo.index + '-' + c);
    } else if (bingo.type === 'col') {
        for (let r = 0; r < 5; r++) cells.push('cell-' + r + '-' + bingo.index);
    } else if (bingo.type === 'diag') {
        if (bingo.index === 0) for (let i = 0; i < 5; i++) cells.push('cell-' + i + '-' + i);
        else for (let i = 0; i < 5; i++) cells.push('cell-' + i + '-' + (4 - i));
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
    document.getElementById('btnBingo').classList.add('hidden');

    try {
        await db.collection('bingo_rooms').doc(roomId)
            .collection('players').doc(currentUser.uid)
            .update({ hasBingo: true });

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
    const btn = document.getElementById('btnDrawSidebar');
    if (btn) {
        btn.disabled = true;
        setButtonLoading(btn, 'Tirage...');
    }

    try {
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
        const btnRestore = document.getElementById('btnDrawSidebar');
        if (btnRestore) {
            btnRestore.disabled = false;
            setButtonContent(btnRestore, 'dices', 'Tirer un numéro');
        }
    }
}

// ===== UI UPDATES =====
function animateNewNumber(num) {
    const category = getBingoCategory(num);
    const el = document.getElementById('currentNumber');
    const catEl = document.getElementById('currentCategory');

    el.classList.remove('animate-pop');
    el.offsetHeight; // reflow
    el.classList.add('animate-pop');
    el.textContent = num;
    catEl.textContent = category + ' · ' + num;

    showToast('Numéro tiré : ' + category + ' ' + num, 'info');
}

function renderCalledNumbers() {
    const list = document.getElementById('calledList');
    list.textContent = '';
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

function renderPlayersStatus(playerDocs) {
    const container = document.getElementById('playersStatus');
    container.textContent = '';

    playerDocs.forEach(doc => {
        const p = doc.data();
        const div = document.createElement('div');
        div.className = 'player-status-item';

        const img = document.createElement('img');
        img.src = p.photoURL || 'https://api.dicebear.com/7.x/initials/svg?seed=' + p.name;
        img.alt = '';
        div.appendChild(img);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'ps-name';
        nameSpan.textContent = p.name + (doc.id === currentUser?.uid ? ' 👤' : '');
        div.appendChild(nameSpan);

        if (p.hasBingo) {
            const bingoSpan = document.createElement('span');
            bingoSpan.className = 'ps-bingo';
            bingoSpan.textContent = 'BINGO!';
            div.appendChild(bingoSpan);
        }

        container.appendChild(div);
    });
}

function handleGameFinished(room) {
    const overlay = document.getElementById('winner-overlay');
    const title = document.getElementById('winnerTitle');
    const sub = document.getElementById('winnerSubtitle');

    if (room.winner === currentUser.uid) {
        title.textContent = '';
        title.append('🎊 BINGO ! ');
        const winSpan = document.createElement('span');
        winSpan.textContent = 'Tu as gagné !';
        title.appendChild(winSpan);
        sub.textContent = 'Félicitations, tu es le premier à faire Bingo !';
        launchConfetti();
    } else {
        title.textContent = 'Partie terminée !';
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
            piece.style.setProperty('--confetti-left', Math.random() * 100 + 'vw');
            piece.style.setProperty('--confetti-bg', colors[Math.floor(Math.random() * colors.length)]);
            piece.style.setProperty('--confetti-duration', (2 + Math.random() * 3) + 's');
            piece.style.setProperty('--confetti-rotation', Math.random() * 360 + 'deg');
            document.body.appendChild(piece);
            setTimeout(() => piece.remove(), 5000);
        }, i * 40);
    }
}

// ===== AUTH HEADER =====
function renderHeaderAuth(user) {
    const area = document.getElementById('authArea');
    if (!area) return;
    area.textContent = '';

    if (user) {
        const pill = document.createElement('div');
        pill.className = 'user-pill';

        const img = document.createElement('img');
        img.src = user.photoURL || 'https://api.dicebear.com/7.x/initials/svg?seed=' + user.displayName;
        img.alt = 'avatar';
        pill.appendChild(img);

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = user.displayName;
        pill.appendChild(name);

        area.appendChild(pill);
    }
}

function confirmLeave() {
    return confirm('Quitter la partie en cours ?');
}
