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
let claimingInProgress = false;
let myClaimedBingos = [];   // keys like "line-0-1" already claimed by this player
let myBingoCount = 0;
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
            document.getElementById('statusRoomCode').textContent = roomSettings.hideCode ? (roomSettings.roomName || '••••••••') : (roomSettings.roomName || room.code);

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

        // Restore claimed bingos from player doc
        myClaimedBingos = player.claimedBingos || [];
        myBingoCount = player.bingoCount || 0;

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

        document.getElementById('statusRoomCode').textContent = roomSettings.hideCode ? (roomSettings.roomName || '••••••••') : (roomSettings.roomName || room.code);
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

// ===== GAME MUTE/UNMUTE/KICK/BAN =====
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

async function gameKickPlayer(playerId, playerName) {
    if (!roomId || !isHost) return;
    try {
        await db.collection('bingo_rooms').doc(roomId)
            .collection('players').doc(playerId).delete();
        showToast(playerName + ' a été expulsé', 'success');
    } catch (e) {
        console.error('gameKickPlayer error:', e);
        showToast('Erreur lors de l\'expulsion', 'error');
    }
}

async function gameBanPlayer(playerId, playerName) {
    if (!roomId || !isHost) return;
    try {
        await db.collection('bingo_rooms').doc(roomId).update({
            bannedUsers: firebase.firestore.FieldValue.arrayUnion(playerId)
        });
        // Persist in localStorage
        const bans = JSON.parse(localStorage.getItem('bingo_bans') || '[]');
        if (!bans.find(b => b.uid === playerId)) {
            bans.push({ uid: playerId, name: playerName });
            localStorage.setItem('bingo_bans', JSON.stringify(bans));
        }
        await db.collection('bingo_rooms').doc(roomId)
            .collection('players').doc(playerId).delete();
        showToast(playerName + ' a été banni', 'success');
    } catch (e) {
        console.error('gameBanPlayer error:', e);
        showToast('Erreur lors du bannissement', 'error');
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
        roomHostId = room.host;
        if (isHost !== wasHost) {
            applyGameHostUI();
        }

        // Update settings in real-time (e.g. chat toggle)
        if (room.settings) {
            roomSettings = room.settings;
            document.getElementById('statusRoomCode').textContent = roomSettings.hideCode ? (roomSettings.roomName || '••••••••') : (roomSettings.roomName || room.code);
            applyGameChatVisibility();
            // Sync max message length to input
            const chatInput = document.getElementById('chatInput');
            if (chatInput && roomSettings.maxMessageLength) {
                chatInput.maxLength = roomSettings.maxMessageLength;
            }
        }

        // Update patterns progress
        renderPatternsProgress(room.completedPatterns || []);

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
            const pendingId = room.pendingBingo.uid + ':' + (room.pendingBingo.key || '');
            if (isHost && pendingBingoShownFor !== pendingId) {
                pendingBingoShownFor = pendingId;
                const panel = document.getElementById('pendingBingoPanel');
                if (panel) {
                    panel.classList.remove('hidden');
                    const pType = room.pendingBingo.patternType || '';
                    document.getElementById('pendingBingoMsg').textContent = room.pendingBingo.name + ' réclame un Bingo (' + (patternLabels[pType] || pType) + ') !';
                    document.getElementById('btnApproveBingo').onclick = () => approveBingo(room.pendingBingo.uid, room.pendingBingo.name);
                }
            } else if (!isHost && room.pendingBingo.uid !== currentUser?.uid && pendingBingoShownFor !== pendingId) {
                pendingBingoShownFor = pendingId;
                showToast(room.pendingBingo.name + ' réclame un Bingo !', 'info');
            }
        } else if (pendingBingoShownFor) {
            const wasPendingId = pendingBingoShownFor;
            pendingBingoShownFor = null;
            const panel = document.getElementById('pendingBingoPanel');
            if (panel) panel.classList.add('hidden');
            // If I was the one who claimed and game isn't finished, my bingo was rejected
            const wasPendingUid = wasPendingId.split(':')[0];
            if (!isHost && room.status !== 'finished' && wasPendingUid === currentUser?.uid) {
                // Reload my claimed bingos from Firestore
                try {
                    const mySnap = await db.collection('bingo_rooms').doc(roomId)
                        .collection('players').doc(currentUser.uid).get();
                    if (mySnap.exists) {
                        const myData = mySnap.data();
                        myClaimedBingos = myData.claimedBingos || [];
                        myBingoCount = myData.bingoCount || 0;
                    }
                } catch(e) { /* ignore */ }
                showToast('Ton Bingo a été rejeté. Tu peux réessayer !', 'error');
                updateBingoButton();
            }
        }

        if (room.status === 'finished') {
            handleGameFinished(room);
        }
    });
}

let gameHostLeftTimeout = null;

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

            // If all players left, schedule room cleanup
            if (snap.docs.length === 0) {
                setTimeout(async () => {
                    try {
                        const roomSnap = await db.collection('bingo_rooms').doc(roomId).get();
                        if (!roomSnap.exists) return;
                        const playersCheck = await db.collection('bingo_rooms').doc(roomId).collection('players').get();
                        if (playersCheck.empty) {
                            const batch = db.batch();
                            const msgsSnap = await db.collection('bingo_rooms').doc(roomId).collection('messages').get();
                            msgsSnap.docs.forEach(d => batch.delete(d.ref));
                            const typSnap = await db.collection('bingo_rooms').doc(roomId).collection('typing').get();
                            typSnap.docs.forEach(d => batch.delete(d.ref));
                            batch.delete(db.collection('bingo_rooms').doc(roomId));
                            await batch.commit();
                        }
                    } catch (e) { console.error('game cleanup error:', e); }
                }, 60000);
            }

            // Host left detection
            if (roomHostId && !snap.docs.find(d => d.id === roomHostId)) {
                handleGameHostLeft(snap.docs);
            } else {
                if (gameHostLeftTimeout) { clearTimeout(gameHostLeftTimeout); gameHostLeftTimeout = null; }
            }

            renderPlayersStatus(snap.docs);
        });
}

async function handleGameHostLeft(playerDocs) {
    if (gameHostLeftTimeout) return;
    gameHostLeftTimeout = setTimeout(async () => {
        try {
            const roomSnap = await db.collection('bingo_rooms').doc(roomId).get();
            if (!roomSnap.exists) return;
            const room = roomSnap.data();
            const playersSnap = await db.collection('bingo_rooms').doc(roomId).collection('players').get();
            if (playersSnap.empty) return;
            const hostStillGone = !playersSnap.docs.find(d => d.id === room.host);
            if (!hostStillGone) return;

            const sorted = playersSnap.docs
                .map(d => ({ id: d.id, data: d.data() }))
                .sort((a, b) => {
                    const tA = a.data.joinedAt ? (a.data.joinedAt.toMillis ? a.data.joinedAt.toMillis() : a.data.joinedAt) : 0;
                    const tB = b.data.joinedAt ? (b.data.joinedAt.toMillis ? b.data.joinedAt.toMillis() : b.data.joinedAt) : 0;
                    return tA - tB;
                });
            const newHost = sorted[0];
            if (newHost) {
                await db.collection('bingo_rooms').doc(roomId).update({
                    host: newHost.id,
                    hostName: newHost.data.name,
                    hostLeftAt: null
                });
                roomHostId = newHost.id;
                showToast(newHost.data.name + ' est devenu l\'hôte !', 'info');
            }
        } catch (e) {
            console.error('handleGameHostLeft error:', e);
        }
        gameHostLeftTimeout = null;
    }, 60000);
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
function checkBingoForGrid(marked, patterns) {
    const m = marked;
    const size = roomSettings.gridSize || 5;
    const enabled = patterns || ['line', 'column', 'diagonal'];
    const results = [];

    if (enabled.includes('line')) {
        for (let r = 0; r < size; r++) {
            let full = true;
            for (let c = 0; c < size; c++) { if (!m[r * size + c]) { full = false; break; } }
            if (full) results.push({ type: 'line', index: r });
        }
    }

    if (enabled.includes('column')) {
        for (let c = 0; c < size; c++) {
            let full = true;
            for (let r = 0; r < size; r++) { if (!m[r * size + c]) { full = false; break; } }
            if (full) results.push({ type: 'column', index: c });
        }
    }

    if (enabled.includes('diagonal')) {
        let d1 = true, d2 = true;
        for (let i = 0; i < size; i++) {
            if (!m[i * size + i]) d1 = false;
            if (!m[i * size + (size - 1 - i)]) d2 = false;
        }
        if (d1) results.push({ type: 'diagonal', index: 0 });
        if (d2) results.push({ type: 'diagonal', index: 1 });
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

function checkBingo() {
    const count = Math.min(myGrids.length, roomSettings.gridCount || 1);
    const unclaimed = [];
    for (let g = 0; g < count; g++) {
        const results = checkBingoForGrid(myMarkedGrids[g], roomSettings.patterns);
        for (const r of results) {
            const key = r.type + '-' + r.index + '-' + g;
            if (!myClaimedBingos.includes(key)) {
                unclaimed.push({ ...r, gridIndex: g, key: key });
            }
        }
    }
    return unclaimed;
}

function updateBingoButton() {
    const unclaimed = checkBingo();
    const btn = document.getElementById('btnBingo');
    // Clear previous winning highlights
    document.querySelectorAll('.bingo-cell.winning').forEach(el => el.classList.remove('winning'));
    if (unclaimed.length > 0 && !claimingInProgress) {
        btn.classList.remove('hidden');
        highlightWinningCells(unclaimed[0]);
    } else {
        btn.classList.add('hidden');
    }
}

function highlightWinningCells(bingo) {
    const size = roomSettings.gridSize || 5;
    const g = bingo.gridIndex !== undefined ? bingo.gridIndex : 0;
    const cells = [];
    if (bingo.type === 'line') {
        for (let c = 0; c < size; c++) cells.push('cell-' + g + '-' + bingo.index + '-' + c);
    } else if (bingo.type === 'column') {
        for (let r = 0; r < size; r++) cells.push('cell-' + g + '-' + r + '-' + bingo.index);
    } else if (bingo.type === 'diagonal') {
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
    if (claimingInProgress) return;
    const unclaimed = checkBingo();
    if (unclaimed.length === 0) {
        showToast('Pas encore de Bingo...', 'error');
        return;
    }
    claimingInProgress = true;
    document.getElementById('btnBingo').classList.add('hidden');

    const bingo = unclaimed[0];

    try {
        myClaimedBingos.push(bingo.key);
        myBingoCount++;

        // Update player doc
        await db.collection('bingo_rooms').doc(roomId)
            .collection('players').doc(currentUser.uid)
            .update({
                hasBingo: true,
                bingoCount: myBingoCount,
                claimedBingos: myClaimedBingos
            });

        const patternType = bingo.type;

        if (roomSettings.bingoValidation === 'manual') {
            await db.collection('bingo_rooms').doc(roomId).update({
                pendingBingo: { uid: currentUser.uid, name: currentUser.displayName, patternType: patternType, key: bingo.key }
            });
            showToast('Bingo réclamé ! En attente de validation...', 'info');
        } else {
            // Auto validation: add pattern type to completedPatterns and check if game is over
            await processNewBingo(patternType, currentUser.uid, currentUser.displayName);
        }
    } catch (e) {
        console.error('claimBingo error:', e);
        showToast('Erreur lors du Bingo', 'error');
        // Rollback local state
        myClaimedBingos.pop();
        myBingoCount--;
    }

    claimingInProgress = false;
    updateBingoButton();
}

async function processNewBingo(patternType, claimerUid, claimerName) {
    const roomRef = db.collection('bingo_rooms').doc(roomId);

    // Use arrayUnion for safe concurrent updates
    await roomRef.update({
        completedPatterns: firebase.firestore.FieldValue.arrayUnion(patternType)
    });

    // Re-read to check if all patterns are now complete
    const roomSnap = await roomRef.get();
    const room = roomSnap.data();
    const completedPatterns = room.completedPatterns || [];
    const enabledPatterns = roomSettings.patterns || ['line', 'column', 'diagonal'];
    const allCompleted = enabledPatterns.every(p => completedPatterns.includes(p));

    if (allCompleted && room.status !== 'finished') {
        // Game over — determine winner(s) with most bingos
        const playersSnap = await roomRef.collection('players').get();
        let maxCount = 0;
        const players = [];
        playersSnap.docs.forEach(doc => {
            const p = doc.data();
            const count = p.bingoCount || 0;
            players.push({ uid: doc.id, name: p.name, count: count });
            if (count > maxCount) maxCount = count;
        });
        const winners = players.filter(p => p.count === maxCount && maxCount > 0);

        await roomRef.update({
            status: 'finished',
            winners: winners
        });
    } else if (!allCompleted) {
        showToast('🎉 BINGO ! (' + (patternLabels[patternType] || patternType) + ') — La partie continue...', 'success');
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

const patternLabels = {
    line: 'Ligne', column: 'Colonne', diagonal: 'Diagonale',
    corners: 'Coins', xPattern: 'X', fullCard: 'Carton plein'
};

function renderPatternsProgress(completedPatterns) {
    const container = document.getElementById('patternsProgress');
    if (!container) return;
    const enabled = roomSettings.patterns || ['line', 'column', 'diagonal'];
    const completed = completedPatterns || [];
    container.textContent = '';
    enabled.forEach(p => {
        const item = document.createElement('div');
        item.className = 'pattern-item' + (completed.includes(p) ? ' completed' : '');
        const icon = completed.includes(p) ? '✅' : '⬜';
        item.textContent = icon + ' ' + (patternLabels[p] || p);
        container.appendChild(item);
    });
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

        if (p.bingoCount > 0) {
            const bingoSpan = document.createElement('span');
            bingoSpan.className = 'ps-bingo';
            bingoSpan.textContent = p.bingoCount + ' BINGO' + (p.bingoCount > 1 ? 'S' : '');
            div.appendChild(bingoSpan);
        }

        // Host actions
        if (isHost && !isMe) {
            const actions = document.createElement('div');
            actions.className = 'player-actions';

            // Mute/unmute
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
            actions.appendChild(muteBtn);

            // Kick
            const kickBtn = document.createElement('button');
            kickBtn.className = 'player-action-btn kick-btn';
            kickBtn.title = 'Expulser';
            kickBtn.innerHTML = '<i data-lucide="user-x"></i>';
            kickBtn.addEventListener('click', () => {
                showConfirmModal('Expulser ' + p.name + ' de la partie ?', () => gameKickPlayer(doc.id, p.name));
            });
            actions.appendChild(kickBtn);

            // Ban
            const banBtn = document.createElement('button');
            banBtn.className = 'player-action-btn ban-btn';
            banBtn.title = 'Bannir';
            banBtn.innerHTML = '<i data-lucide="ban"></i>';
            banBtn.addEventListener('click', () => {
                showConfirmModal('Bannir ' + p.name + ' ?', () => gameBanPlayer(doc.id, p.name));
            });
            actions.appendChild(banBtn);

            div.appendChild(actions);
        }

        container.appendChild(div);
    });

    lucide.createIcons();
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

    if (winners.length === 0) {
        title.textContent = 'Partie terminée !';
        sub.textContent = 'Aucun gagnant.';
    } else if (winners.length === 1) {
        const w = winners[0];
        const isMe = currentUser && w.uid === currentUser.uid;
        if (isMe) {
            title.textContent = '';
            title.append('🎊 BINGO ! ');
            const winSpan = document.createElement('span');
            winSpan.textContent = 'Tu as gagné !';
            title.appendChild(winSpan);
            sub.textContent = 'Félicitations ! ' + w.count + ' bingo' + (w.count > 1 ? 's' : '') + ' réussi' + (w.count > 1 ? 's' : '') + ' !';
            launchConfetti();
        } else {
            title.textContent = 'Partie terminée !';
            sub.textContent = (w.name || 'Un joueur') + ' gagne avec ' + w.count + ' bingo' + (w.count > 1 ? 's' : '') + ' ! 🎉';
        }
    } else {
        // Multiple winners (tie)
        const isMe = currentUser && winners.some(w => w.uid === currentUser.uid);
        const names = winners.map(w => w.name).join(', ');
        const count = winners[0].count;
        if (isMe) {
            title.textContent = '';
            title.append('🎊 Égalité ! ');
            const winSpan = document.createElement('span');
            winSpan.textContent = 'Tu fais partie des gagnants !';
            title.appendChild(winSpan);
            sub.textContent = names + ' — ' + count + ' bingo' + (count > 1 ? 's' : '') + ' chacun !';
            launchConfetti();
        } else {
            title.textContent = 'Partie terminée — Égalité !';
            sub.textContent = names + ' gagnent avec ' + count + ' bingo' + (count > 1 ? 's' : '') + ' chacun ! 🎉';
        }
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
async function approveBingo(uid, name) {
    try {
        const roomSnap = await db.collection('bingo_rooms').doc(roomId).get();
        const room = roomSnap.data();
        const patternType = room.pendingBingo?.patternType;

        // Clear pending first
        await db.collection('bingo_rooms').doc(roomId).update({
            pendingBingo: firebase.firestore.FieldValue.delete()
        });

        if (patternType) {
            await processNewBingo(patternType, uid, name);
        }
    } catch(e) {
        console.error('approveBingo error:', e);
        showToast('Erreur lors de la validation', 'error');
    }
}

async function rejectBingo() {
    try {
        const roomSnap = await db.collection('bingo_rooms').doc(roomId).get();
        const room = roomSnap.data();
        const pendingKey = room.pendingBingo?.key;
        const pendingUid = room.pendingBingo?.uid;

        await db.collection('bingo_rooms').doc(roomId).update({
            pendingBingo: firebase.firestore.FieldValue.delete()
        });

        // Rollback the player's claim
        if (pendingUid && pendingKey) {
            const playerRef = db.collection('bingo_rooms').doc(roomId).collection('players').doc(pendingUid);
            const playerSnap = await playerRef.get();
            if (playerSnap.exists) {
                const p = playerSnap.data();
                const claimed = (p.claimedBingos || []).filter(k => k !== pendingKey);
                const count = Math.max(0, (p.bingoCount || 1) - 1);
                await playerRef.update({ claimedBingos: claimed, bingoCount: count, hasBingo: claimed.length > 0 });
            }
        }
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
