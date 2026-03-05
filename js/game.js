/**
 * Game module — bingo grid, number drawing, win detection, real-time sync
 */

// ===== STATE =====
let currentUser = null;
let roomId = null;
let isHost = false;
let myGrids = [];         // array of grid arrays (multi-grid support)
let myMarkedGrids = [];   // array of marked arrays
let calledNumbers = [];
let roomSettings = { drawMode: 'manual', drawInterval: 10, gridCount: 1, patterns: ['line', 'column', 'diagonal'], calledAnimations: true, bingoValidation: 'auto' };
let roomListener = null;
let playersListener = null;
let bingoAlreadyClaimed = false;
let isDrawing = false;
let countdownInterval = null;
let autoDrawCountdown = 0;
let pendingBingoShownFor = null;

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
        e.preventDefault();
        showConfirmModal('Quitter la partie en cours ?', () => {
            window.location.href = './index.html';
        });
    });
    document.getElementById('btnDraw').addEventListener('click', drawNumber);
    document.getElementById('btnDrawSidebar').addEventListener('click', drawNumber);
    document.getElementById('btnBingo').addEventListener('click', claimBingo);

    const rejectBtn = document.getElementById('btnRejectBingo');
    if (rejectBtn) rejectBtn.addEventListener('click', rejectBingo);

    initRgpdModal();
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
        roomSettings = room.settings || roomSettings;

        const playerSnap = await db.collection('bingo_rooms').doc(roomId)
            .collection('players').doc(currentUser.uid).get();

        if (!playerSnap.exists) {
            showToast('Tu n\'es plus dans cette room', 'error');
            setTimeout(() => window.location.href = './index.html', 2000);
            return;
        }

        const player = playerSnap.data();
        calledNumbers = room.calledNumbers || [];

        // Load grids — support new multi-grid format and old single-grid format
        if (player.grids && player.grids.length > 0) {
            myGrids = player.grids;
            myMarkedGrids = (player.markedGrids && player.markedGrids.length > 0)
                ? player.markedGrids
                : player.grids.map(() => generateDefaultMarked());
        } else {
            myGrids = [player.grid];
            myMarkedGrids = [player.marked || generateDefaultMarked()];
        }

        // Ensure we have enough grids for the configured gridCount
        const needed = roomSettings.gridCount || 1;
        while (myGrids.length < needed) {
            myGrids.push(generateBingoGrid());
            myMarkedGrids.push(generateDefaultMarked());
        }

        // Persist grids if we had to generate new ones
        if (myGrids.length > (player.grids ? player.grids.length : 1)) {
            await db.collection('bingo_rooms').doc(roomId)
                .collection('players').doc(currentUser.uid)
                .update({ grids: myGrids, markedGrids: myMarkedGrids });
        }

        document.getElementById('statusRoomCode').textContent = room.code;
        sessionStorage.setItem('bingo_session', JSON.stringify({ roomId, roomCode: room.code }));

        if (isHost) {
            document.getElementById('hostPanel').classList.remove('hidden');
            if (roomSettings.drawMode === 'auto') {
                document.getElementById('btnDrawSidebar').classList.add('hidden');
                document.getElementById('btnDraw').classList.add('hidden');
                document.getElementById('autoDrawInfo').classList.remove('hidden');
                startAutoDrawTimer();
            } else {
                document.getElementById('btnDraw').classList.remove('hidden');
            }
        }

        renderAllGrids();
        renderCalledNumbers();
        updateCalledCount();
        showGameContainer();
        listenToRoom();
        listenToPlayers();
        initGameChat();
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

// ===== AUTO-DRAW TIMER =====
function startAutoDrawTimer() {
    if (!isHost || roomSettings.drawMode !== 'auto') return;
    stopAutoDrawTimer();
    autoDrawCountdown = roomSettings.drawInterval;
    updateAutoDrawDisplay();
    countdownInterval = setInterval(() => {
        autoDrawCountdown--;
        updateAutoDrawDisplay();
        if (autoDrawCountdown <= 0) {
            autoDrawCountdown = roomSettings.drawInterval;
            drawNumber();
        }
    }, 1000);
}

function stopAutoDrawTimer() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
}

function updateAutoDrawDisplay() {
    const el = document.getElementById('autoDrawCountdown');
    if (el) el.textContent = autoDrawCountdown + 's';
}

// ===== REAL-TIME LISTENERS =====
function listenToRoom() {
    roomListener = db.collection('bingo_rooms').doc(roomId).onSnapshot(snap => {
        if (!snap.exists) {
            showToast('La room a été fermée.', 'error');
            sessionStorage.removeItem('bingo_session');
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

        // Handle pendingBingo
        if (room.pendingBingo) {
            if (isHost && pendingBingoShownFor !== room.pendingBingo.uid) {
                pendingBingoShownFor = room.pendingBingo.uid;
                const panel = document.getElementById('pendingBingoPanel');
                if (panel) {
                    panel.classList.remove('hidden');
                    document.getElementById('pendingBingoMsg').textContent = room.pendingBingo.name + ' réclame un Bingo !';
                    document.getElementById('btnApproveBingo').onclick = () => approveBingo(room.pendingBingo.uid, room.pendingBingo.name);
                }
            } else if (!isHost && room.pendingBingo.uid !== currentUser?.uid && pendingBingoShownFor !== room.pendingBingo.uid) {
                pendingBingoShownFor = room.pendingBingo.uid;
                showToast(room.pendingBingo.name + ' réclame un Bingo !', 'info');
            }
        } else if (pendingBingoShownFor) {
            const wasPending = pendingBingoShownFor;
            pendingBingoShownFor = null;
            const panel = document.getElementById('pendingBingoPanel');
            if (panel) panel.classList.add('hidden');
            // If I was the one who claimed and game isn't finished, my bingo was rejected
            if (bingoAlreadyClaimed && !isHost && room.status !== 'finished' && wasPending === currentUser?.uid) {
                bingoAlreadyClaimed = false;
                showToast('Ton Bingo a été rejeté. Tu peux réessayer !', 'error');
                updateBingoButton();
            }
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

// ===== GRID RENDERING (MULTI-GRID) =====
function renderAllGrids() {
    const container = document.getElementById('bingoGridsContainer');
    container.textContent = '';

    const count = Math.min(myGrids.length, roomSettings.gridCount || 1);
    for (let g = 0; g < count; g++) {
        const board = document.createElement('div');
        board.className = 'bingo-board';
        board.dataset.gridIndex = g;

        if (count > 1) {
            const label = document.createElement('div');
            label.className = 'bingo-board-label';
            label.textContent = 'Grille ' + (g + 1);
            board.appendChild(label);
        }

        const headerRow = document.createElement('div');
        headerRow.className = 'bingo-header-row';
        ['B', 'I', 'N', 'G', 'O'].forEach(l => {
            const letter = document.createElement('div');
            letter.className = 'bingo-letter';
            letter.textContent = l;
            headerRow.appendChild(letter);
        });
        board.appendChild(headerRow);

        const gridEl = document.createElement('div');
        gridEl.className = 'bingo-grid';
        gridEl.id = 'bingoGrid-' + g;

        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                const cell = document.createElement('div');
                cell.className = 'bingo-cell';
                cell.id = 'cell-' + g + '-' + r + '-' + c;
                const idx = r * 5 + c;
                const num = myGrids[g][idx];
                const isCenter = (r === 2 && c === 2);
                const isCalled = num !== 0 && calledNumbers.includes(num);
                const isMarked = myMarkedGrids[g][idx];

                if (isCenter) {
                    cell.classList.add('free');
                    cell.textContent = 'FREE';
                } else {
                    cell.textContent = num;
                    if (isMarked) {
                        cell.classList.add('marked');
                    } else if (isCalled) {
                        cell.classList.add('called');
                        cell.addEventListener('click', () => markCell(g, r, c));
                    } else {
                        cell.addEventListener('click', () => markCell(g, r, c));
                    }
                }
                gridEl.appendChild(cell);
            }
        }
        board.appendChild(gridEl);
        container.appendChild(board);
    }
}

function highlightGridCalled() {
    const count = Math.min(myGrids.length, roomSettings.gridCount || 1);
    for (let g = 0; g < count; g++) {
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                const cell = document.getElementById('cell-' + g + '-' + r + '-' + c);
                if (!cell) continue;
                const idx = r * 5 + c;
                const num = myGrids[g][idx];
                if (num !== 0 && calledNumbers.includes(num) && !myMarkedGrids[g][idx]) {
                    cell.classList.add('called');
                }
            }
        }
    }
}

function checkAutoMark(number) {
    const count = Math.min(myGrids.length, roomSettings.gridCount || 1);
    for (let g = 0; g < count; g++) {
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                const idx = r * 5 + c;
                if (myGrids[g][idx] === number && !myMarkedGrids[g][idx]) {
                    const cell = document.getElementById('cell-' + g + '-' + r + '-' + c);
                    if (cell && roomSettings.calledAnimations !== false) {
                        cell.classList.add('called', 'cell-pulse');
                        setTimeout(() => cell.classList.remove('cell-pulse'), 1500);
                    } else if (cell) {
                        cell.classList.add('called');
                    }
                }
            }
        }
    }
}

async function markCell(gridIndex, r, c) {
    const idx = r * 5 + c;
    const num = myGrids[gridIndex][idx];
    if (num === 0) return;
    if (myMarkedGrids[gridIndex][idx]) return;
    if (!calledNumbers.includes(num)) {
        showToast('Ce numéro n\'a pas encore été tiré !', 'error');
        return;
    }

    myMarkedGrids[gridIndex][idx] = true;
    const cell = document.getElementById('cell-' + gridIndex + '-' + r + '-' + c);
    cell.classList.remove('called');
    cell.classList.add('marked');

    try {
        await db.collection('bingo_rooms').doc(roomId)
            .collection('players').doc(currentUser.uid)
            .update({ markedGrids: myMarkedGrids });
    } catch (e) {
        console.error('markCell error:', e);
    }

    updateBingoButton();
}

// ===== BINGO DETECTION =====
function checkBingoForGrid(marked, patterns) {
    const m = marked;
    const enabled = patterns || ['line', 'column', 'diagonal'];

    if (enabled.includes('line')) {
        for (let r = 0; r < 5; r++) {
            if (m[r * 5] && m[r * 5 + 1] && m[r * 5 + 2] && m[r * 5 + 3] && m[r * 5 + 4])
                return { type: 'row', index: r };
        }
    }

    if (enabled.includes('column')) {
        for (let c = 0; c < 5; c++) {
            if (m[c] && m[5 + c] && m[10 + c] && m[15 + c] && m[20 + c])
                return { type: 'col', index: c };
        }
    }

    if (enabled.includes('diagonal')) {
        if (m[0] && m[6] && m[12] && m[18] && m[24]) return { type: 'diag', index: 0 };
        if (m[4] && m[8] && m[12] && m[16] && m[20]) return { type: 'diag', index: 1 };
    }

    if (enabled.includes('corners')) {
        if (m[0] && m[4] && m[20] && m[24]) return { type: 'corners', index: 0 };
    }

    if (enabled.includes('xPattern')) {
        if (m[0] && m[6] && m[12] && m[18] && m[24] &&
            m[4] && m[8] && m[16] && m[20])
            return { type: 'xPattern', index: 0 };
    }

    if (enabled.includes('fullCard')) {
        if (m.every(Boolean)) return { type: 'fullCard', index: 0 };
    }

    return null;
}

function checkBingo() {
    const count = Math.min(myGrids.length, roomSettings.gridCount || 1);
    for (let g = 0; g < count; g++) {
        const result = checkBingoForGrid(myMarkedGrids[g], roomSettings.patterns);
        if (result) return { ...result, gridIndex: g };
    }
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
    const g = bingo.gridIndex !== undefined ? bingo.gridIndex : 0;
    const cells = [];
    if (bingo.type === 'row') {
        for (let c = 0; c < 5; c++) cells.push('cell-' + g + '-' + bingo.index + '-' + c);
    } else if (bingo.type === 'col') {
        for (let r = 0; r < 5; r++) cells.push('cell-' + g + '-' + r + '-' + bingo.index);
    } else if (bingo.type === 'diag') {
        if (bingo.index === 0) for (let i = 0; i < 5; i++) cells.push('cell-' + g + '-' + i + '-' + i);
        else for (let i = 0; i < 5; i++) cells.push('cell-' + g + '-' + i + '-' + (4 - i));
    } else if (bingo.type === 'corners') {
        ['0-0', '0-4', '4-0', '4-4'].forEach(pos => cells.push('cell-' + g + '-' + pos));
    } else if (bingo.type === 'xPattern') {
        for (let i = 0; i < 5; i++) {
            cells.push('cell-' + g + '-' + i + '-' + i);
            cells.push('cell-' + g + '-' + i + '-' + (4 - i));
        }
    } else if (bingo.type === 'fullCard') {
        for (let r = 0; r < 5; r++)
            for (let c = 0; c < 5; c++)
                cells.push('cell-' + g + '-' + r + '-' + c);
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

        if (roomSettings.bingoValidation === 'manual') {
            await db.collection('bingo_rooms').doc(roomId).update({
                pendingBingo: { uid: currentUser.uid, name: currentUser.displayName }
            });
            showToast('Bingo réclamé ! En attente de validation...', 'info');
        } else {
            await db.collection('bingo_rooms').doc(roomId).update({
                status: 'finished',
                winner: currentUser.uid,
                winnerName: currentUser.displayName
            });
        }
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
        stopAutoDrawTimer();
        return;
    }

    isDrawing = true;
    const btn = document.getElementById('btnDrawSidebar');
    if (btn && roomSettings.drawMode !== 'auto') {
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
        if (btnRestore && roomSettings.drawMode !== 'auto') {
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
    stopAutoDrawTimer();
    sessionStorage.removeItem('bingo_session');

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

// ===== BINGO APPROVE / REJECT (host) =====
async function approveBingo(uid, name) {
    try {
        await db.collection('bingo_rooms').doc(roomId).update({
            status: 'finished',
            winner: uid,
            winnerName: name,
            pendingBingo: firebase.firestore.FieldValue.delete()
        });
    } catch(e) {
        console.error('approveBingo error:', e);
        showToast('Erreur lors de la validation', 'error');
    }
}

async function rejectBingo() {
    try {
        await db.collection('bingo_rooms').doc(roomId).update({
            pendingBingo: firebase.firestore.FieldValue.delete()
        });
    } catch(e) {
        console.error('rejectBingo error:', e);
        showToast('Erreur lors du rejet', 'error');
    }
}

// ===== GAME CHAT =====
function initGameChat() {
    const messagesEl = document.getElementById('chatMessages');
    if (!messagesEl) return;

    db.collection('bingo_rooms').doc(roomId)
        .collection('messages')
        .orderBy('sentAt', 'asc')
        .limitToLast(50)
        .onSnapshot(snap => {
            snap.docChanges().forEach(change => {
                if (change.type === 'added') {
                    appendGameChatMessage(change.doc.data(), messagesEl);
                }
            });
            messagesEl.scrollTop = messagesEl.scrollHeight;
        });

    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    if (btn) btn.addEventListener('click', sendGameChatMessage);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendGameChatMessage(); } });
}

async function sendGameChatMessage() {
    if (!roomId || !currentUser) return;
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
        await db.collection('bingo_rooms').doc(roomId).collection('messages').add({
            uid: currentUser.uid,
            author: currentUser.displayName,
            text,
            sentAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch(e) { console.error('Error sending game chat message:', e); }
}

function appendGameChatMessage(data, container) {
    if (!data.text) return;
    const div = document.createElement('div');
    div.className = 'chat-msg' + (data.uid === currentUser?.uid ? ' my-msg' : '');
    const author = document.createElement('span');
    author.className = 'chat-author';
    author.textContent = data.author || 'Anonyme';
    div.appendChild(author);
    div.append(data.text);
    container.appendChild(div);
}
