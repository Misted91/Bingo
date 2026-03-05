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
let roomSettings = { drawMode: 'manual', drawInterval: 10, gridSize: 5, gridCount: 1, patterns: ['line', 'column', 'diagonal'], calledAnimations: true, bingoValidation: 'auto', chatEnabled: true, chatFilter: false, slowMode: 0, maxMessageLength: 200, mutedUsers: [] };
let roomListener = null;
let playersListener = null;
let bingoAlreadyClaimed = false;
let gameTypingTimeout = null;
let gameTypingDocRef = null;
let isDrawing = false;
let countdownInterval = null;
let autoDrawCountdown = 0;
let pendingBingoShownFor = null;
let lastGameMessageTime = 0;

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
    document.getElementById('logoHome').addEventListener('click', (e) => {
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

        // Load grids — support map format, old arrays, and legacy single-grid
        const gs = roomSettings.gridSize || 5;
        if (player.gridsMap && Object.keys(player.gridsMap).length > 0) {
            const keys = Object.keys(player.gridsMap).sort((a, b) => Number(a) - Number(b));
            myGrids = keys.map(k => player.gridsMap[k]);
            myMarkedGrids = player.markedMap
                ? keys.map(k => player.markedMap[k] || generateDefaultMarked(gs))
                : myGrids.map(() => generateDefaultMarked(gs));
        } else if (player.grid) {
            myGrids = [player.grid];
            myMarkedGrids = [player.marked || generateDefaultMarked(gs)];
        } else {
            myGrids = [generateBingoGrid(gs)];
            myMarkedGrids = [generateDefaultMarked(gs)];
        }

        // Ensure we have enough grids for the configured gridCount
        const needed = roomSettings.gridCount || 1;
        while (myGrids.length < needed) {
            myGrids.push(generateBingoGrid(gs));
            myMarkedGrids.push(generateDefaultMarked(gs));
        }

        // Persist grids as maps (Firestore doesn't support nested arrays)
        const gridsMapCount = player.gridsMap ? Object.keys(player.gridsMap).length : 0;
        if (myGrids.length > gridsMapCount || !player.gridsMap) {
            const gridsMap = {};
            const markedMap = {};
            myGrids.forEach((g, i) => { gridsMap[String(i)] = g; });
            myMarkedGrids.forEach((m, i) => { markedMap[String(i)] = m; });
            await db.collection('bingo_rooms').doc(roomId)
                .collection('players').doc(currentUser.uid)
                .update({ gridsMap, markedMap });
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

        // Detect ban
        if (room.bannedUsers && room.bannedUsers.includes(currentUser?.uid)) {
            showToast('Tu as été banni de cette room.', 'error');
            sessionStorage.removeItem('bingo_session');
            setTimeout(() => window.location.href = './index.html', 2000);
            return;
        }

        // Detect host change
        const wasHost = isHost;
        isHost = room.host === currentUser?.uid;
        if (isHost !== wasHost) {
            applyGameHostUI();
        }

        // Update settings in real-time (e.g. chat toggle)
        if (room.settings) {
            roomSettings = room.settings;
            applyGameChatVisibility();
            // Sync max message length to input
            const chatInput = document.getElementById('chatInput');
            if (chatInput && roomSettings.maxMessageLength) {
                chatInput.maxLength = roomSettings.maxMessageLength;
            }
        }

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
            // Detect kick: current user no longer in players
            const ids = snap.docs.map(d => d.id);
            if (currentUser && !ids.includes(currentUser.uid)) {
                showToast('Tu as été expulsé de la partie.', 'error');
                sessionStorage.removeItem('bingo_session');
                setTimeout(() => window.location.href = './index.html', 2000);
                return;
            }
            renderPlayersStatus(snap.docs);
        });
}

function applyGameHostUI() {
    const hostPanel = document.getElementById('hostPanel');
    const btnDraw = document.getElementById('btnDraw');
    const btnDrawSidebar = document.getElementById('btnDrawSidebar');
    const autoDrawInfo = document.getElementById('autoDrawInfo');

    if (isHost) {
        hostPanel.classList.remove('hidden');
        if (roomSettings.drawMode === 'auto') {
            btnDrawSidebar.classList.add('hidden');
            btnDraw.classList.add('hidden');
            autoDrawInfo.classList.remove('hidden');
            startAutoDrawTimer();
        } else {
            btnDrawSidebar.classList.remove('hidden');
            btnDraw.classList.remove('hidden');
            autoDrawInfo.classList.add('hidden');
            stopAutoDrawTimer();
        }
        showToast('Tu es maintenant l\'hôte de la partie', 'success');
    } else {
        hostPanel.classList.add('hidden');
        btnDraw.classList.add('hidden');
        stopAutoDrawTimer();
    }
    lucide.createIcons();
}

// ===== GRID RENDERING (MULTI-GRID) =====
function renderAllGrids() {
    const container = document.getElementById('bingoGridsContainer');
    container.textContent = '';

    const size = roomSettings.gridSize || 5;
    const count = Math.min(myGrids.length, roomSettings.gridCount || 1);
    const letters = BINGO_LETTERS.slice(0, size);
    const hasCenter = size % 2 === 1;
    const centerR = Math.floor(size / 2);
    const centerC = Math.floor(size / 2);

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
        headerRow.style.gridTemplateColumns = 'repeat(' + size + ', 1fr)';
        letters.forEach(l => {
            const letter = document.createElement('div');
            letter.className = 'bingo-letter';
            letter.textContent = l;
            headerRow.appendChild(letter);
        });
        board.appendChild(headerRow);

        const gridEl = document.createElement('div');
        gridEl.className = 'bingo-grid';
        gridEl.id = 'bingoGrid-' + g;
        gridEl.style.gridTemplateColumns = 'repeat(' + size + ', 1fr)';

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const cell = document.createElement('div');
                cell.className = 'bingo-cell';
                cell.id = 'cell-' + g + '-' + r + '-' + c;
                const idx = r * size + c;
                const num = myGrids[g][idx];
                const isCenter = hasCenter && r === centerR && c === centerC;
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
    const size = roomSettings.gridSize || 5;
    const count = Math.min(myGrids.length, roomSettings.gridCount || 1);
    for (let g = 0; g < count; g++) {
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const cell = document.getElementById('cell-' + g + '-' + r + '-' + c);
                if (!cell) continue;
                const idx = r * size + c;
                const num = myGrids[g][idx];
                if (num !== 0 && calledNumbers.includes(num) && !myMarkedGrids[g][idx]) {
                    cell.classList.add('called');
                }
            }
        }
    }
}

function checkAutoMark(number) {
    const size = roomSettings.gridSize || 5;
    const count = Math.min(myGrids.length, roomSettings.gridCount || 1);
    for (let g = 0; g < count; g++) {
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const idx = r * size + c;
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
    const size = roomSettings.gridSize || 5;
    const idx = r * size + c;
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
        const markedMap = {};
        myMarkedGrids.forEach((m, i) => { markedMap[String(i)] = m; });
        await db.collection('bingo_rooms').doc(roomId)
            .collection('players').doc(currentUser.uid)
            .update({ markedMap });
    } catch (e) {
        console.error('markCell error:', e);
    }

    updateBingoButton();
}

// ===== BINGO DETECTION =====
function checkBingoForGrid(marked, patterns) {
    const m = marked;
    const size = roomSettings.gridSize || 5;
    const enabled = patterns || ['line', 'column', 'diagonal'];

    if (enabled.includes('line')) {
        for (let r = 0; r < size; r++) {
            let full = true;
            for (let c = 0; c < size; c++) { if (!m[r * size + c]) { full = false; break; } }
            if (full) return { type: 'row', index: r };
        }
    }

    if (enabled.includes('column')) {
        for (let c = 0; c < size; c++) {
            let full = true;
            for (let r = 0; r < size; r++) { if (!m[r * size + c]) { full = false; break; } }
            if (full) return { type: 'col', index: c };
        }
    }

    if (enabled.includes('diagonal')) {
        let d1 = true, d2 = true;
        for (let i = 0; i < size; i++) {
            if (!m[i * size + i]) d1 = false;
            if (!m[i * size + (size - 1 - i)]) d2 = false;
        }
        if (d1) return { type: 'diag', index: 0 };
        if (d2) return { type: 'diag', index: 1 };
    }

    if (enabled.includes('corners')) {
        if (m[0] && m[size - 1] && m[(size - 1) * size] && m[size * size - 1])
            return { type: 'corners', index: 0 };
    }

    if (enabled.includes('xPattern')) {
        let ok = true;
        for (let i = 0; i < size; i++) {
            if (!m[i * size + i] || !m[i * size + (size - 1 - i)]) { ok = false; break; }
        }
        if (ok) return { type: 'xPattern', index: 0 };
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
    const size = roomSettings.gridSize || 5;
    const g = bingo.gridIndex !== undefined ? bingo.gridIndex : 0;
    const cells = [];
    if (bingo.type === 'row') {
        for (let c = 0; c < size; c++) cells.push('cell-' + g + '-' + bingo.index + '-' + c);
    } else if (bingo.type === 'col') {
        for (let r = 0; r < size; r++) cells.push('cell-' + g + '-' + r + '-' + bingo.index);
    } else if (bingo.type === 'diag') {
        if (bingo.index === 0) for (let i = 0; i < size; i++) cells.push('cell-' + g + '-' + i + '-' + i);
        else for (let i = 0; i < size; i++) cells.push('cell-' + g + '-' + i + '-' + (size - 1 - i));
    } else if (bingo.type === 'corners') {
        cells.push('cell-' + g + '-0-0', 'cell-' + g + '-0-' + (size-1), 'cell-' + g + '-' + (size-1) + '-0', 'cell-' + g + '-' + (size-1) + '-' + (size-1));
    } else if (bingo.type === 'xPattern') {
        for (let i = 0; i < size; i++) {
            cells.push('cell-' + g + '-' + i + '-' + i);
            cells.push('cell-' + g + '-' + i + '-' + (size - 1 - i));
        }
    } else if (bingo.type === 'fullCard') {
        for (let r = 0; r < size; r++)
            for (let c = 0; c < size; c++)
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
    const maxNum = getMaxNumber(roomSettings.gridSize);
    if (calledNumbers.length >= maxNum) {
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
            number = Math.floor(Math.random() * maxNum) + 1;
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
    const totalEl = document.getElementById('statusTotal');
    if (totalEl) totalEl.textContent = getMaxNumber(roomSettings.gridSize);
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

    // Schedule auto-cleanup after 1 minute (any client triggers it)
    setTimeout(async () => {
        try {
            const snap = await db.collection('bingo_rooms').doc(roomId).get();
            if (snap.exists && snap.data().status === 'finished') {
                const batch = db.batch();
                const playersSnap = await db.collection('bingo_rooms').doc(roomId).collection('players').get();
                playersSnap.docs.forEach(doc => batch.delete(doc.ref));
                const messagesSnap = await db.collection('bingo_rooms').doc(roomId).collection('messages').get();
                messagesSnap.docs.forEach(doc => batch.delete(doc.ref));
                const typingSnap = await db.collection('bingo_rooms').doc(roomId).collection('typing').get();
                typingSnap.docs.forEach(doc => batch.delete(doc.ref));
                batch.delete(db.collection('bingo_rooms').doc(roomId));
                await batch.commit();
            }
        } catch (e) { console.error('Auto-cleanup error:', e); }
    }, 60000);

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
function applyGameChatVisibility() {
    const chatPanel = document.getElementById('chatPanel');
    const chatDisabledMsg = document.getElementById('chatDisabledMsg');
    if (roomSettings.chatEnabled !== false) {
        if (chatPanel) chatPanel.classList.remove('hidden');
        if (chatDisabledMsg) chatDisabledMsg.classList.add('hidden');
    } else {
        if (chatPanel) chatPanel.classList.add('hidden');
        if (chatDisabledMsg) chatDisabledMsg.classList.remove('hidden');
    }
    lucide.createIcons();
}

function initGameChat() {
    const messagesEl = document.getElementById('chatMessages');
    if (!messagesEl) return;

    applyGameChatVisibility();

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

    // Typing indicator listener
    db.collection('bingo_rooms').doc(roomId)
        .collection('typing')
        .onSnapshot(snap => {
            const typingEl = document.getElementById('chatTyping');
            if (!typingEl) return;
            const now = Date.now();
            const names = [];
            snap.docs.forEach(doc => {
                const data = doc.data();
                if (doc.id !== currentUser?.uid && data.timestamp) {
                    const ts = data.timestamp.toMillis ? data.timestamp.toMillis() : data.timestamp;
                    if (now - ts < 4000) {
                        names.push(data.name);
                    }
                }
            });
            if (names.length === 0) {
                typingEl.textContent = '';
                typingEl.classList.remove('visible');
            } else if (names.length === 1) {
                typingEl.textContent = names[0] + ' écrit...';
                typingEl.classList.add('visible');
            } else {
                typingEl.textContent = names.join(', ') + ' écrivent...';
                typingEl.classList.add('visible');
            }
        });

    gameTypingDocRef = db.collection('bingo_rooms').doc(roomId)
        .collection('typing').doc(currentUser?.uid);

    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    if (btn) btn.addEventListener('click', sendGameChatMessage);
    if (input) {
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendGameChatMessage(); } });
        input.addEventListener('input', onGameChatTyping);
    }
}

function onGameChatTyping() {
    if (!gameTypingDocRef || !currentUser) return;
    gameTypingDocRef.set({
        name: currentUser.displayName,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
    clearTimeout(gameTypingTimeout);
    gameTypingTimeout = setTimeout(() => {
        if (gameTypingDocRef) gameTypingDocRef.delete().catch(() => {});
    }, 3000);
}

async function sendGameChatMessage() {
    if (!roomId || !currentUser) return;
    const input = document.getElementById('chatInput');
    let text = input.value.trim();
    if (!text) return;

    // Check if muted
    if ((roomSettings.mutedUsers || []).includes(currentUser.uid)) {
        showToast('Vous êtes muet dans cette room', 'error');
        return;
    }

    // Slow mode enforcement
    if (roomSettings.slowMode > 0) {
        const elapsed = (Date.now() - lastGameMessageTime) / 1000;
        const remaining = Math.ceil(roomSettings.slowMode - elapsed);
        if (remaining > 0) {
            showToast('Mode lent : attendez ' + remaining + 's', 'error');
            return;
        }
    }

    // Max length enforcement
    const maxLen = roomSettings.maxMessageLength || 200;
    if (text.length > maxLen) {
        text = text.substring(0, maxLen);
    }

    input.value = '';
    // Apply chat filter if enabled
    if (roomSettings.chatFilter) {
        text = filterChatMessage(text);
    }
    if (gameTypingDocRef) gameTypingDocRef.delete().catch(() => {});
    clearTimeout(gameTypingTimeout);

    lastGameMessageTime = Date.now();
    updateGameSlowModeUI();

    try {
        await db.collection('bingo_rooms').doc(roomId).collection('messages').add({
            uid: currentUser.uid,
            author: currentUser.displayName,
            text,
            sentAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch(e) { console.error('Error sending game chat message:', e); }
}

function updateGameSlowModeUI() {
    if (!roomSettings.slowMode || roomSettings.slowMode <= 0) return;
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    if (!input || !btn) return;

    input.disabled = true;
    btn.disabled = true;
    let remaining = roomSettings.slowMode;
    input.placeholder = 'Mode lent : ' + remaining + 's...';

    const interval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(interval);
            input.disabled = false;
            btn.disabled = false;
            input.placeholder = 'Message...';
        } else {
            input.placeholder = 'Mode lent : ' + remaining + 's...';
        }
    }, 1000);
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
