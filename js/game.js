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
let myClaimedPatterns = [];  // pattern keys already claimed by this player
let gameTypingTimeout = null;
let gameTypingDocRef = null;
let isDrawing = false;
let countdownInterval = null;
let autoDrawCountdown = 0;
let pendingBingoShownFor = null;
let lastGameMessageTime = 0;
let isSpectator = false;
let spectatedPlayerId = null;
let spectatedPlayerListener = null;
let roomHostId = null;
let gameInitialized = false;

// ===== INIT =====
const params = new URLSearchParams(window.location.search);
roomId = params.get('room');
const roomCodeParam = params.get('code');

if (!roomId && !roomCodeParam) {
    window.location.href = './index.html';
}

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();

    document.getElementById('btnQuitGame').addEventListener('click', (e) => {
        e.preventDefault();
        showConfirmModal('Quitter la partie en cours ?', () => quitGame());
    });
    document.getElementById('logoHome').addEventListener('click', (e) => {
        e.preventDefault();
        showConfirmModal('Quitter la partie en cours ?', () => quitGame());
    });
    document.getElementById('btnDraw').addEventListener('click', drawNumber);
    document.getElementById('btnDrawSidebar').addEventListener('click', drawNumber);
    document.getElementById('btnBingo').addEventListener('click', claimBingo);

    const rejectBtn = document.getElementById('btnRejectBingo');
    if (rejectBtn) rejectBtn.addEventListener('click', rejectBingo);

    initRgpdModal();
});

auth.onAuthStateChanged(async (user) => {
    currentUser = user;
    renderHeaderAuth(user);
    if (!gameInitialized) {
        gameInitialized = true;
        initGame();
    }
});

async function initGame() {
    try {
        // Resolve room from code if needed
        if (!roomId && roomCodeParam) {
            const codeSnap = await db.collection('bingo_rooms')
                .where('code', '==', roomCodeParam.toUpperCase().replace(/[^A-Z]/g, ''))
                .limit(1).get();
            if (codeSnap.empty) {
                showToast('Room introuvable', 'error');
                setTimeout(() => window.location.href = './index.html', 2000);
                return;
            }
            roomId = codeSnap.docs[0].id;
            history.replaceState(null, '', './game.html?room=' + roomId);
        }

        const roomSnap = await db.collection('bingo_rooms').doc(roomId).get();
        if (!roomSnap.exists) {
            showToast('Room introuvable', 'error');
            setTimeout(() => window.location.href = './index.html', 2000);
            return;
        }
        const room = roomSnap.data();
        roomHostId = room.host;
        isHost = currentUser ? room.host === currentUser.uid : false;
        roomSettings = room.settings || roomSettings;

        // Check if user is a player in this room
        let playerSnap = null;
        if (currentUser && !currentUser.isAnonymous) {
            playerSnap = await db.collection('bingo_rooms').doc(roomId)
                .collection('players').doc(currentUser.uid).get();
        }

        if (!playerSnap || !playerSnap.exists) {
            // Enter spectator mode
            isSpectator = true;
            isHost = false;
            calledNumbers = room.calledNumbers || [];
            document.getElementById('statusRoomCode').textContent = room.code;

            const spectatorBanner = document.getElementById('spectatorBanner');
            if (spectatorBanner) spectatorBanner.classList.remove('hidden');

            document.getElementById('bingoGridsContainer').innerHTML =
                '<div class="spectator-placeholder"><i data-lucide="eye"></i><p>Mode Spectateur</p><span>Cliquez sur un joueur pour voir sa grille</span></div>';

            document.getElementById('btnBingo').classList.add('hidden');
            document.getElementById('btnDraw').classList.add('hidden');
            document.getElementById('hostPanel').classList.add('hidden');

            renderCalledNumbers();
            updateCalledCount();
            showGameContainer();
            listenToRoom();
            listenToPlayers();
            initGameChat();

            // Disable chat input for non-authenticated spectators
            if (!currentUser) {
                const chatInputRow = document.querySelector('#chatPanel .chat-input-row');
                if (chatInputRow) {
                    chatInputRow.innerHTML = '<p class="chat-spectator-msg"><i data-lucide="lock"></i> Connectez-vous pour chatter</p>';
                }
            }

            // Default: spectate the host
            spectatePlayer(roomHostId);

            lucide.createIcons();
            return;
        }

        const player = playerSnap.data();
        calledNumbers = room.calledNumbers || [];

        // Load grids — support map format and legacy single-grid
        const gs = roomSettings.gridSize || 5;
        if (player.gridsMap && Object.keys(player.gridsMap).length > 0) {
            const keys = Object.keys(player.gridsMap).sort();
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

        // Persist grids as maps (keys prefixed to avoid Firestore treating object as array)
        const gridsMapCount = player.gridsMap ? Object.keys(player.gridsMap).length : 0;
        if (myGrids.length > gridsMapCount || !player.gridsMap) {
            const gridsMap = {};
            const markedMap = {};
            myGrids.forEach((g, i) => { gridsMap['g' + i] = g; });
            myMarkedGrids.forEach((m, i) => { markedMap['g' + i] = m; });
            const updateData = { gridsMap, markedMap };
            // Remove legacy nested array fields
            if (player.grids) updateData.grids = firebase.firestore.FieldValue.delete();
            if (player.markedGrids) updateData.markedGrids = firebase.firestore.FieldValue.delete();
            await db.collection('bingo_rooms').doc(roomId)
                .collection('players').doc(currentUser.uid)
                .update(updateData);
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

// ===== QUIT GAME =====
async function quitGame() {
    sessionStorage.removeItem('bingo_session');
    if (roomListener) { roomListener(); roomListener = null; }
    if (playersListener) { playersListener(); playersListener = null; }
    if (spectatedPlayerListener) { spectatedPlayerListener(); spectatedPlayerListener = null; }
    stopAutoDrawTimer();
    if (gameTypingDocRef) { gameTypingDocRef.delete().catch(() => {}); gameTypingDocRef = null; }

    if (currentUser && !isSpectator && !currentUser.isAnonymous) {
        try {
            await db.collection('bingo_rooms').doc(roomId)
                .collection('players').doc(currentUser.uid).delete();
        } catch(e) { /* ignore */ }
    }

    window.location.href = './index.html';
}

// ===== GAME MUTE/UNMUTE =====
async function gameMutePlayer(playerId, playerName) {
    if (!roomId || !isHost) return;
    try {
        const mutedUsers = [...(roomSettings.mutedUsers || [])];
        if (!mutedUsers.includes(playerId)) mutedUsers.push(playerId);
        roomSettings.mutedUsers = mutedUsers;
        await db.collection('bingo_rooms').doc(roomId).update({ 'settings.mutedUsers': mutedUsers });
        showToast(playerName + ' est muet dans le chat', 'success');
    } catch (e) {
        console.error('gameMutePlayer error:', e);
        showToast('Erreur lors du mute', 'error');
    }
}

async function gameUnmutePlayer(playerId, playerName) {
    if (!roomId || !isHost) return;
    try {
        const mutedUsers = (roomSettings.mutedUsers || []).filter(id => id !== playerId);
        roomSettings.mutedUsers = mutedUsers;
        await db.collection('bingo_rooms').doc(roomId).update({ 'settings.mutedUsers': mutedUsers });
        showToast(playerName + ' peut à nouveau parler', 'success');
    } catch (e) {
        console.error('gameUnmutePlayer error:', e);
        showToast('Erreur lors du unmute', 'error');
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
            if (isSpectator) {
                // Re-render spectated player grid with updated called numbers
                if (spectatedPlayerId) {
                    const specSnap = document.querySelector('#bingoGridsContainer .bingo-board');
                    if (specSnap) {
                        // Trigger re-render by re-fetching spectated player
                        db.collection('bingo_rooms').doc(roomId)
                            .collection('players').doc(spectatedPlayerId).get()
                            .then(s => { if (s.exists) renderSpectatorGrid(s.data()); });
                    }
                }
            } else {
                highlightGridCalled();
                checkAutoMark(latest);
                updateBingoButton();
            }
        }

        // Handle pendingBingo
        if (room.pendingBingo) {
            if (isHost && pendingBingoShownFor !== room.pendingBingo.uid) {
                pendingBingoShownFor = room.pendingBingo.uid;
                const panel = document.getElementById('pendingBingoPanel');
                if (panel) {
                    panel.classList.remove('hidden');
                    const pLabel = room.pendingBingo.patternLabel || 'Bingo';
                    document.getElementById('pendingBingoMsg').textContent = room.pendingBingo.name + ' réclame un Bingo (' + pLabel + ') !';
                    document.getElementById('btnApproveBingo').onclick = () => approveBingo(room.pendingBingo.uid, room.pendingBingo.name, room.pendingBingo.patternKey, room.pendingBingo.patternLabel);
                }
            } else if (!isHost && room.pendingBingo.uid !== currentUser?.uid && pendingBingoShownFor !== room.pendingBingo.uid) {
                pendingBingoShownFor = room.pendingBingo.uid;
                const pLabel = room.pendingBingo.patternLabel || 'Bingo';
                showToast(room.pendingBingo.name + ' réclame un Bingo (' + pLabel + ') !', 'info');
            }
        } else if (pendingBingoShownFor) {
            const wasPending = pendingBingoShownFor;
            pendingBingoShownFor = null;
            const panel = document.getElementById('pendingBingoPanel');
            if (panel) panel.classList.add('hidden');
            if (bingoAlreadyClaimed && !isHost && room.status !== 'finished' && wasPending === currentUser?.uid) {
                bingoAlreadyClaimed = false;
                showToast('Ton Bingo a été rejeté. Tu peux réessayer !', 'error');
                updateBingoButton();
            }
        }

        // Handle claimedBingos — notify new claims, sync local state, check if all patterns done
        const claimed = room.claimedBingos || [];
        handleClaimedBingosUpdate(claimed, room);

        if (room.status === 'finished') {
            handleGameFinished(room);
        }
    });
}

function listenToPlayers() {
    playersListener = db.collection('bingo_rooms').doc(roomId)
        .collection('players').onSnapshot(snap => {
            // Detect kick: current user no longer in players (skip for spectators)
            if (!isSpectator) {
                const ids = snap.docs.map(d => d.id);
                if (currentUser && !ids.includes(currentUser.uid)) {
                    showToast('Tu as été expulsé de la partie.', 'error');
                    sessionStorage.removeItem('bingo_session');
                    setTimeout(() => window.location.href = './index.html', 2000);
                    return;
                }
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
    container.dataset.gridCount = count;
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
        myMarkedGrids.forEach((m, i) => { markedMap['g' + i] = m; });
        await db.collection('bingo_rooms').doc(roomId)
            .collection('players').doc(currentUser.uid)
            .update({ markedMap });
    } catch (e) {
        console.error('markCell error:', e);
    }

    updateBingoButton();
}

// ===== BINGO DETECTION =====
// Maps internal result types to the pattern keys used in settings
const PATTERN_TYPE_MAP = { 'row': 'line', 'col': 'column', 'diag': 'diagonal', 'corners': 'corners', 'xPattern': 'xPattern', 'fullCard': 'fullCard' };
const PATTERN_LABEL = { 'line': 'Ligne', 'column': 'Colonne', 'diagonal': 'Diagonale', 'corners': 'Coins', 'xPattern': 'X', 'fullCard': 'Grille complète' };

function findAllBingosForGrid(marked, patterns) {
    const m = marked;
    const size = roomSettings.gridSize || 5;
    const enabled = patterns || ['line', 'column', 'diagonal'];
    const results = [];

    if (enabled.includes('line')) {
        for (let r = 0; r < size; r++) {
            let full = true;
            for (let c = 0; c < size; c++) { if (!m[r * size + c]) { full = false; break; } }
            if (full) { results.push({ type: 'row', index: r }); break; }
        }
    }

    if (enabled.includes('column')) {
        for (let c = 0; c < size; c++) {
            let full = true;
            for (let r = 0; r < size; r++) { if (!m[r * size + c]) { full = false; break; } }
            if (full) { results.push({ type: 'col', index: c }); break; }
        }
    }

    if (enabled.includes('diagonal')) {
        let d1 = true, d2 = true;
        for (let i = 0; i < size; i++) {
            if (!m[i * size + i]) d1 = false;
            if (!m[i * size + (size - 1 - i)]) d2 = false;
        }
        if (d1) results.push({ type: 'diag', index: 0 });
        else if (d2) results.push({ type: 'diag', index: 1 });
    }

    if (enabled.includes('corners')) {
        if (m[0] && m[size - 1] && m[(size - 1) * size] && m[size * size - 1])
            results.push({ type: 'corners', index: 0 });
    }

    if (enabled.includes('xPattern')) {
        let ok = true;
        for (let i = 0; i < size; i++) {
            if (!m[i * size + i] || !m[i * size + (size - 1 - i)]) { ok = false; break; }
        }
        if (ok) results.push({ type: 'xPattern', index: 0 });
    }

    if (enabled.includes('fullCard')) {
        if (m.every(Boolean)) results.push({ type: 'fullCard', index: 0 });
    }

    return results;
}

// Legacy single-check (used for highlighting)
function checkBingoForGrid(marked, patterns) {
    const results = findAllBingosForGrid(marked, patterns);
    return results.length > 0 ? results[0] : null;
}

// Find all new (unclaimed) bingos across all grids
function findNewBingos() {
    const count = Math.min(myGrids.length, roomSettings.gridCount || 1);
    const newBingos = [];
    for (let g = 0; g < count; g++) {
        const results = findAllBingosForGrid(myMarkedGrids[g], roomSettings.patterns);
        for (const r of results) {
            const patternKey = PATTERN_TYPE_MAP[r.type];
            if (!myClaimedPatterns.includes(patternKey)) {
                newBingos.push({ ...r, gridIndex: g, patternKey });
            }
        }
    }
    return newBingos;
}

function checkBingo() {
    const newBingos = findNewBingos();
    return newBingos.length > 0 ? newBingos[0] : null;
}

function updateBingoButton() {
    const bingo = checkBingo();
    const btn = document.getElementById('btnBingo');
    if (bingo && !bingoAlreadyClaimed) {
        btn.classList.remove('hidden');
        highlightWinningCells(bingo);
    } else {
        btn.classList.add('hidden');
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

    const patternKey = bingo.patternKey || PATTERN_TYPE_MAP[bingo.type];
    const patternLabel = PATTERN_LABEL[patternKey] || patternKey;

    try {
        if (roomSettings.bingoValidation === 'manual') {
            await db.collection('bingo_rooms').doc(roomId).update({
                pendingBingo: { uid: currentUser.uid, name: currentUser.displayName, patternKey, patternLabel }
            });
            showToast('Bingo (' + patternLabel + ') réclamé ! En attente de validation...', 'info');
        } else {
            // Auto-validate: record the bingo directly
            await db.collection('bingo_rooms').doc(roomId).update({
                claimedBingos: firebase.firestore.FieldValue.arrayUnion({
                    uid: currentUser.uid,
                    name: currentUser.displayName,
                    patternKey: patternKey,
                    patternLabel: patternLabel,
                    timestamp: Date.now()
                })
            });
            myClaimedPatterns.push(patternKey);
            bingoAlreadyClaimed = false; // allow claiming more patterns
            updateBingoButton();
        }
    } catch (e) {
        console.error('claimBingo error:', e);
        showToast('Erreur lors du Bingo', 'error');
        bingoAlreadyClaimed = false;
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
        const isMe = doc.id === currentUser?.uid;
        const div = document.createElement('div');
        div.className = 'player-status-item';
        div.dataset.playerId = doc.id;

        // Highlight currently spectated player
        if (isSpectator && spectatedPlayerId === doc.id) {
            div.classList.add('spectated');
        }

        const img = document.createElement('img');
        img.src = p.photoURL || 'https://api.dicebear.com/7.x/initials/svg?seed=' + p.name;
        img.alt = '';
        div.appendChild(img);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'ps-name';
        nameSpan.textContent = p.name + (isMe ? ' 👤' : '');

        // Make player name clickable for spectators
        if (isSpectator) {
            nameSpan.classList.add('ps-name-clickable');
            nameSpan.addEventListener('click', () => spectatePlayer(doc.id));
        }

        div.appendChild(nameSpan);

        // Muted badge
        if ((roomSettings.mutedUsers || []).includes(doc.id)) {
            const muteBadge = document.createElement('span');
            muteBadge.className = 'muted-badge';
            muteBadge.title = 'Muet';
            const muteIcon = document.createElement('i');
            muteIcon.dataset.lucide = 'mic-off';
            muteBadge.appendChild(muteIcon);
            div.appendChild(muteBadge);
        }

        if (p.hasBingo) {
            const bingoSpan = document.createElement('span');
            bingoSpan.className = 'ps-bingo';
            bingoSpan.textContent = 'BINGO!';
            div.appendChild(bingoSpan);
        }

        // Host actions: mute/unmute
        if (isHost && !isMe) {
            const isMuted = (roomSettings.mutedUsers || []).includes(doc.id);
            const muteBtn = document.createElement('button');
            muteBtn.className = 'player-action-btn mute-btn' + (isMuted ? ' active' : '');
            muteBtn.title = isMuted ? 'Rétablir le chat' : 'Rendre muet';
            muteBtn.innerHTML = isMuted ? '<i data-lucide="mic-off"></i>' : '<i data-lucide="mic"></i>';
            muteBtn.addEventListener('click', () => {
                if (isMuted) {
                    gameUnmutePlayer(doc.id, p.name);
                } else {
                    showConfirmModal('Rendre ' + p.name + ' muet dans le chat ?', () => gameMutePlayer(doc.id, p.name));
                }
            });
            div.appendChild(muteBtn);
        }

        container.appendChild(div);
    });

    lucide.createIcons();
}

// ===== CLAIMED BINGOS HANDLING =====
let lastClaimedCount = 0;

function handleClaimedBingosUpdate(claimed, room) {
    // Notify new claims since last update
    if (claimed.length > lastClaimedCount) {
        for (let i = lastClaimedCount; i < claimed.length; i++) {
            const c = claimed[i];
            if (c.uid !== currentUser?.uid) {
                showToast(c.name + ' a fait un Bingo (' + c.patternLabel + ') !', 'info');
            }
        }
    }
    lastClaimedCount = claimed.length;

    // Sync local claimed patterns for current user
    if (currentUser) {
        myClaimedPatterns = claimed
            .filter(c => c.uid === currentUser.uid)
            .map(c => c.patternKey);
        bingoAlreadyClaimed = false;
        updateBingoButton();
    }

    // Check if all enabled pattern types have been claimed → end game (host only)
    if (isHost && room.status === 'playing' && claimed.length > 0) {
        const enabledPatterns = roomSettings.patterns || ['line', 'column', 'diagonal'];
        const claimedTypes = new Set(claimed.map(c => c.patternKey));
        const allDone = enabledPatterns.every(p => claimedTypes.has(p));
        if (allDone) {
            finishGameWithScores(claimed);
        }
    }
}

async function finishGameWithScores(claimed) {
    // Count bingos per player
    const scores = {};
    for (const c of claimed) {
        if (!scores[c.uid]) scores[c.uid] = { uid: c.uid, name: c.name, count: 0 };
        scores[c.uid].count++;
    }
    const sorted = Object.values(scores).sort((a, b) => b.count - a.count);
    const maxCount = sorted[0].count;
    const winners = sorted.filter(s => s.count === maxCount);

    try {
        await db.collection('bingo_rooms').doc(roomId).update({
            status: 'finished',
            winners: winners.map(w => ({ uid: w.uid, name: w.name, count: w.count })),
            winnerName: winners.map(w => w.name).join(', ')
        });
    } catch (e) {
        console.error('finishGameWithScores error:', e);
    }
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

    const winners = room.winners || [];
    const claimed = room.claimedBingos || [];

    if (winners.length > 0) {
        const isWinner = currentUser && winners.some(w => w.uid === currentUser.uid);
        const winnerNames = winners.map(w => w.name);
        const winnerCount = winners[0].count;

        if (isWinner) {
            title.textContent = '';
            title.append('🎊 BINGO ! ');
            const winSpan = document.createElement('span');
            winSpan.textContent = 'Tu as gagné !';
            title.appendChild(winSpan);
            if (winners.length > 1) {
                sub.textContent = 'Égalité avec ' + winnerNames.filter(n => n !== currentUser.displayName).join(', ') + ' — ' + winnerCount + ' bingo(s) chacun !';
            } else {
                sub.textContent = 'Félicitations, tu as le plus de bingos (' + winnerCount + ') !';
            }
            launchConfetti();
        } else {
            title.textContent = 'Partie terminée !';
            if (winners.length > 1) {
                sub.textContent = 'Égalité ! ' + winnerNames.join(' & ') + ' avec ' + winnerCount + ' bingo(s) chacun ! 🎉';
            } else {
                sub.textContent = winnerNames[0] + ' gagne avec ' + winnerCount + ' bingo(s) ! 🎉';
            }
        }

        // Show scoreboard summary
        if (claimed.length > 0) {
            const scores = {};
            for (const c of claimed) {
                if (!scores[c.uid]) scores[c.uid] = { name: c.name, count: 0 };
                scores[c.uid].count++;
            }
            const sorted = Object.entries(scores).sort((a, b) => b[1].count - a[1].count);
            const scoreList = sorted.map(([, s], i) => (i + 1) + '. ' + s.name + ' — ' + s.count + ' bingo(s)').join('\n');
            const scoreEl = document.createElement('p');
            scoreEl.style.cssText = 'white-space:pre-line;font-size:0.9rem;color:var(--text-muted);margin-bottom:16px;';
            scoreEl.textContent = scoreList;
            sub.after(scoreEl);
        }
    } else if (currentUser && room.winner === currentUser.uid) {
        // Legacy fallback (single winner)
        title.textContent = '';
        title.append('🎊 BINGO ! ');
        const winSpan = document.createElement('span');
        winSpan.textContent = 'Tu as gagné !';
        title.appendChild(winSpan);
        sub.textContent = 'Félicitations !';
        launchConfetti();
    } else {
        title.textContent = 'Partie terminée !';
        sub.textContent = (room.winnerName || 'Un joueur') + ' a gagné ! 🎉';
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

    if (user && !user.isAnonymous) {
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
    } else if ((user && user.isAnonymous) || isSpectator) {
        const pill = document.createElement('div');
        pill.className = 'user-pill';
        const icon = document.createElement('i');
        icon.dataset.lucide = 'eye';
        pill.appendChild(icon);
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = 'Spectateur';
        pill.appendChild(name);
        area.appendChild(pill);
        lucide.createIcons();
    }
}

// ===== BINGO APPROVE / REJECT (host) =====
async function approveBingo(uid, name, patternKey, patternLabel) {
    try {
        await db.collection('bingo_rooms').doc(roomId).update({
            claimedBingos: firebase.firestore.FieldValue.arrayUnion({
                uid: uid,
                name: name,
                patternKey: patternKey,
                patternLabel: patternLabel || patternKey,
                timestamp: Date.now()
            }),
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

    if (currentUser && !currentUser.isAnonymous) {
        gameTypingDocRef = db.collection('bingo_rooms').doc(roomId)
            .collection('typing').doc(currentUser.uid);
    }

    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    if (btn) btn.addEventListener('click', sendGameChatMessage);
    if (input) {
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendGameChatMessage(); } });
        input.addEventListener('input', onGameChatTyping);
    }
}

function onGameChatTyping() {
    if (!gameTypingDocRef || !currentUser || currentUser.isAnonymous) return;
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
    if (!roomId || !currentUser || currentUser.isAnonymous) return;
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

// ===== SPECTATOR GRID VIEWING =====
function spectatePlayer(playerId) {
    if (!playerId || !roomId) return;

    // Clean up previous listener
    if (spectatedPlayerListener) {
        spectatedPlayerListener();
        spectatedPlayerListener = null;
    }

    spectatedPlayerId = playerId;

    // Highlight active player in sidebar
    document.querySelectorAll('.player-status-item').forEach(el => {
        el.classList.toggle('spectated', el.dataset.playerId === playerId);
    });

    // Listen to spectated player's data in real-time
    spectatedPlayerListener = db.collection('bingo_rooms').doc(roomId)
        .collection('players').doc(playerId)
        .onSnapshot(snap => {
            if (!snap.exists) {
                document.getElementById('bingoGridsContainer').innerHTML =
                    '<div class="spectator-placeholder"><i data-lucide="eye"></i><p>Joueur déconnecté</p></div>';
                lucide.createIcons();
                return;
            }
            const data = snap.data();
            renderSpectatorGrid(data);
        }, err => {
            console.error('spectatePlayer listener error:', err);
        });
}

function renderSpectatorGrid(playerData) {
    const container = document.getElementById('bingoGridsContainer');
    container.textContent = '';

    const gridsMap = playerData.gridsMap || {};
    const markedMap = playerData.markedMap || {};
    const size = roomSettings.gridSize || 5;
    const count = roomSettings.gridCount || 1;
    container.dataset.gridCount = count;
    const letters = BINGO_LETTERS.slice(0, size);
    const hasCenter = size % 2 === 1;
    const centerR = Math.floor(size / 2);
    const centerC = Math.floor(size / 2);

    // Player name label
    const label = document.createElement('div');
    label.className = 'spectator-grid-label';
    label.innerHTML = '<i data-lucide="eye"></i> Grille de <strong>' + (playerData.name || 'Joueur') + '</strong>';
    container.appendChild(label);

    for (let g = 0; g < count; g++) {
        const grid = gridsMap['g' + g] || [];
        const marked = markedMap['g' + g] || [];
        if (grid.length === 0) continue;

        const board = document.createElement('div');
        board.className = 'bingo-board';

        if (count > 1) {
            const gridLabel = document.createElement('div');
            gridLabel.className = 'bingo-board-label';
            gridLabel.textContent = 'Grille ' + (g + 1);
            board.appendChild(gridLabel);
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
        gridEl.style.gridTemplateColumns = 'repeat(' + size + ', 1fr)';

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const cell = document.createElement('div');
                cell.className = 'bingo-cell spectator-cell';
                const idx = r * size + c;
                const num = grid[idx];
                const isCenter = hasCenter && r === centerR && c === centerC;
                const isCalled = num !== 0 && calledNumbers.includes(num);
                const isMarked = marked[idx];

                if (isCenter) {
                    cell.classList.add('free');
                    cell.textContent = 'FREE';
                } else {
                    cell.textContent = num;
                    if (isMarked) {
                        cell.classList.add('marked');
                    } else if (isCalled) {
                        cell.classList.add('called');
                    }
                }
                gridEl.appendChild(cell);
            }
        }
        board.appendChild(gridEl);
        container.appendChild(board);
    }

    lucide.createIcons();
}
