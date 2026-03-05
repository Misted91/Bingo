/**
 * Lobby module — room creation, joining, waiting room, event listeners
 */

let currentRoomId = null;
let currentRoomCode = null;
let roomListener = null;
let playersListener = null;
let publicRoomsListener = null;
let isHost = false;
let knownPlayerIds = new Set();
let codeHidden = true;
let typingTimeout = null;
let typingDocRef = null;

// Default game settings
let settingsData = {
    drawMode: 'manual',
    drawInterval: 10,
    gridSize: 5,
    gridCount: 1,
    patterns: ['line', 'column', 'diagonal'],
    calledAnimations: true,
    bingoValidation: 'auto',
    visibility: 'private',
    hideCode: true,
    chatEnabled: true
};

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();

    document.getElementById('btnCreate').addEventListener('click', createRoom);
    document.getElementById('btnJoin').addEventListener('click', joinRoom);
    document.getElementById('btnLeaveRoom').addEventListener('click', (e) => {
        e.preventDefault();
        leaveRoom();
    });
    document.getElementById('btnCopyCode').addEventListener('click', copyCode);
    document.getElementById('btnToggleCode').addEventListener('click', toggleCodeVisibility);
    document.getElementById('btnStart').addEventListener('click', startGame);
    document.getElementById('roomCodeInput').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
    });

    initSettingsUI();
    initRgpdModal();
    listenToPublicRooms();
});

// ===== SETTINGS UI =====
function initSettingsUI() {
    // Room visibility toggle
    document.getElementById('roomVisibilityToggle').addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        document.querySelectorAll('#roomVisibilityToggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settingsData.visibility = btn.dataset.value;
        saveSettings();
    });

    // Hide code toggle
    document.getElementById('hideCodeToggle').addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        document.querySelectorAll('#hideCodeToggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settingsData.hideCode = btn.dataset.value === 'true';
        applyCodeVisibility();
        saveSettings();
    });

    // Draw mode toggle
    document.getElementById('drawModeToggle').addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        document.querySelectorAll('#drawModeToggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settingsData.drawMode = btn.dataset.value;
        document.getElementById('intervalGroup').classList.toggle('hidden', settingsData.drawMode !== 'auto');
        saveSettings();
    });

    // Draw interval range
    const rangeInput = document.getElementById('drawIntervalRange');
    const rangeValue = document.getElementById('intervalValue');
    rangeInput.addEventListener('input', () => {
        settingsData.drawInterval = parseInt(rangeInput.value);
        rangeValue.textContent = rangeInput.value + 's';
        saveSettings();
    });

    // Grid count buttons
    document.getElementById('gridCountBtns').addEventListener('click', (e) => {
        const btn = e.target.closest('.count-btn');
        if (!btn) return;
        document.querySelectorAll('#gridCountBtns .count-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settingsData.gridCount = parseInt(btn.dataset.count);
        saveSettings();
    });

    // Grid size buttons
    document.getElementById('gridSizeBtns').addEventListener('click', (e) => {
        const btn = e.target.closest('.count-btn');
        if (!btn) return;
        document.querySelectorAll('#gridSizeBtns .count-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settingsData.gridSize = parseInt(btn.dataset.size);
        saveSettings();
    });

    // Win pattern checkboxes
    document.getElementById('patternsGrid').addEventListener('change', () => {
        const checked = [...document.querySelectorAll('#patternsGrid input[name="pattern"]:checked')]
            .map(cb => cb.value);
        // Require at least one pattern selected
        if (checked.length > 0) {
            settingsData.patterns = checked;
            saveSettings();
        } else {
            // Revert the unchecked box to prevent empty selection
            const lastChecked = settingsData.patterns[0];
            const cb = document.querySelector(`#patternsGrid input[value="${lastChecked}"]`);
            if (cb) cb.checked = true;
        }
    });

    // Called animations toggle
    document.getElementById('calledAnimToggle').addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        document.querySelectorAll('#calledAnimToggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settingsData.calledAnimations = btn.dataset.value === 'true';
        saveSettings();
    });

    // Bingo validation toggle
    document.getElementById('bingoValidationToggle').addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        document.querySelectorAll('#bingoValidationToggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settingsData.bingoValidation = btn.dataset.value;
        saveSettings();
    });

    // Chat enabled toggle
    document.getElementById('chatEnabledToggle').addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        document.querySelectorAll('#chatEnabledToggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settingsData.chatEnabled = btn.dataset.value === 'true';
        applyChatVisibility();
        saveSettings();
    });

    renderPatternMinis();
}

function renderPatternMinis() {
    // Patterns: which of 25 cells (row-major) are lit
    const patternCells = {
        line:     Array.from({length: 25}, (_, i) => i >= 5 && i < 10),   // row 1
        column:   Array.from({length: 25}, (_, i) => i % 5 === 0),         // col 0
        diagonal: Array.from({length: 25}, (_, i) => i % 6 === 0),         // main diag
        corners:  Array.from({length: 25}, (_, i) => [0,4,20,24].includes(i)),
        fullCard: Array.from({length: 25}, () => true),
        xPattern: Array.from({length: 25}, (_, i) => [0, 4, 6, 8, 12, 16, 18, 20, 24].includes(i))
    };
    document.querySelectorAll('.pattern-mini').forEach(el => {
        const type = el.dataset.pattern;
        const lit = patternCells[type] || [];
        el.textContent = '';
        for (let i = 0; i < 25; i++) {
            const cell = document.createElement('div');
            cell.className = 'pm-cell' + (lit[i] ? ' pm-lit' : '');
            el.appendChild(cell);
        }
    });
}

async function saveSettings() {
    if (!currentRoomId || !isHost) return;
    try {
        await db.collection('bingo_rooms').doc(currentRoomId).update({ settings: settingsData });
    } catch (e) {
        console.error('saveSettings error:', e);
    }
}

function applySettingsToUI(settings) {
    if (!settings) return;
    settingsData = { ...settingsData, ...settings };

    // Room visibility
    if (settings.visibility) {
        document.querySelectorAll('#roomVisibilityToggle .toggle-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.value === settings.visibility);
        });
    }

    // Hide code
    if (settings.hideCode !== undefined) {
        document.querySelectorAll('#hideCodeToggle .toggle-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.value === String(settings.hideCode));
        });
        applyCodeVisibility();
    }

    // Draw mode
    document.querySelectorAll('#drawModeToggle .toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.value === settings.drawMode);
    });
    document.getElementById('intervalGroup').classList.toggle('hidden', settings.drawMode !== 'auto');

    // Draw interval
    if (settings.drawInterval) {
        document.getElementById('drawIntervalRange').value = settings.drawInterval;
        document.getElementById('intervalValue').textContent = settings.drawInterval + 's';
    }

    // Grid count
    document.querySelectorAll('#gridCountBtns .count-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.count) === settings.gridCount);
    });

    // Grid size
    if (settings.gridSize) {
        document.querySelectorAll('#gridSizeBtns .count-btn').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.size) === settings.gridSize);
        });
    }

    // Patterns
    if (settings.patterns) {
        document.querySelectorAll('#patternsGrid input[name="pattern"]').forEach(cb => {
            cb.checked = settings.patterns.includes(cb.value);
        });
    }

    // Called animations
    if (settings.calledAnimations !== undefined) {
        document.querySelectorAll('#calledAnimToggle .toggle-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.value === String(settings.calledAnimations));
        });
    }

    // Bingo validation
    if (settings.bingoValidation) {
        document.querySelectorAll('#bingoValidationToggle .toggle-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.value === settings.bingoValidation);
        });
    }

    // Chat enabled
    if (settings.chatEnabled !== undefined) {
        document.querySelectorAll('#chatEnabledToggle .toggle-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.value === String(settings.chatEnabled));
        });
        applyChatVisibility();
    }
}

// ===== VIEW MANAGEMENT =====
function showAuthGate() {
    document.getElementById('authGate').classList.remove('hidden');
    document.getElementById('lobbySection').classList.add('hidden');
    document.getElementById('waitingRoom').classList.add('hidden');
}

function showLobby() {
    document.getElementById('authGate').classList.add('hidden');
    document.getElementById('lobbySection').classList.remove('hidden');
    document.getElementById('waitingRoom').classList.add('hidden');

    const btnCreate = document.getElementById('btnCreate');
    btnCreate.disabled = false;
    setButtonContent(btnCreate, 'rocket', 'Créer la room');

    const btnJoin = document.getElementById('btnJoin');
    btnJoin.disabled = false;
    setButtonContent(btnJoin, 'log-in', 'Rejoindre');
}

function showWaitingRoom() {
    document.getElementById('authGate').classList.add('hidden');
    document.getElementById('lobbySection').classList.add('hidden');
    document.getElementById('waitingRoom').classList.remove('hidden');
}

// ===== ROOM MANAGEMENT =====

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

async function createRoom() {
    if (!currentUser) { showToast('Connecte-toi d\'abord', 'error'); return; }
    const btn = document.getElementById('btnCreate');
    btn.disabled = true;
    setButtonLoading(btn, 'Création...');

    try {
        const code = generateCode();
        const roomRef = db.collection('bingo_rooms').doc();

        await roomRef.set({
            code: code,
            host: currentUser.uid,
            hostName: currentUser.displayName,
            status: 'waiting',
            calledNumbers: [],
            settings: { ...settingsData },
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        const gs = settingsData.gridSize || 5;
        await roomRef.collection('players').doc(currentUser.uid).set({
            name: currentUser.displayName,
            photoURL: currentUser.photoURL || '',
            grid: generateBingoGrid(gs),
            marked: generateDefaultMarked(gs),
            hasBingo: false,
            joinedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        currentRoomId = roomRef.id;
        currentRoomCode = code;
        isHost = true;

        sessionStorage.setItem('bingo_session', JSON.stringify({ roomId: currentRoomId, roomCode: currentRoomCode }));

        document.getElementById('displayedCode').textContent = code;
        document.getElementById('btnStart').classList.remove('hidden');
        document.getElementById('waitingMsg').classList.add('hidden');
        document.getElementById('settingsPanel').classList.remove('hidden');
        document.getElementById('settingsPanel').classList.remove('settings-disabled');
        applyCodeVisibility();
        showWaitingRoom();
        listenToRoom(roomRef.id);
        initChat(roomRef.id);
        showToast('Room créée ! Code : ' + code, 'success');
    } catch (e) {
        console.error(e);
        showToast('Erreur : ' + e.message, 'error');
        btn.disabled = false;
        setButtonContent(btn, 'rocket', 'Créer la room');
    }
}

async function joinRoom() {
    if (!currentUser) { showToast('Connecte-toi d\'abord', 'error'); return; }
    const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
    if (code.length !== 6) { showToast('Code invalide (6 caractères)', 'error'); return; }

    const btn = document.getElementById('btnJoin');
    btn.disabled = true;
    setButtonLoading(btn, 'Connexion...');

    try {
        const snap = await db.collection('bingo_rooms').where('code', '==', code).limit(1).get();
        if (snap.empty) {
            showToast('Room introuvable. Vérifie le code.', 'error');
            btn.disabled = false;
            setButtonContent(btn, 'log-in', 'Rejoindre');
            return;
        }

        const roomDoc = snap.docs[0];
        const room = roomDoc.data();

        if (room.status === 'finished') {
            showToast('Cette partie est terminée.', 'error');
            btn.disabled = false;
            setButtonContent(btn, 'log-in', 'Rejoindre');
            return;
        }

        if (room.status === 'playing') {
            showToast('La partie est déjà commencée !', 'error');
            btn.disabled = false;
            setButtonContent(btn, 'log-in', 'Rejoindre');
            return;
        }

        const playersSnap = await roomDoc.ref.collection('players').get();
        if (playersSnap.size >= 8) {
            showToast('La room est pleine (max 8 joueurs).', 'error');
            btn.disabled = false;
            setButtonContent(btn, 'log-in', 'Rejoindre');
            return;
        }

        const gs = (room.settings && room.settings.gridSize) || 5;
        await roomDoc.ref.collection('players').doc(currentUser.uid).set({
            name: currentUser.displayName,
            photoURL: currentUser.photoURL || '',
            grid: generateBingoGrid(gs),
            marked: generateDefaultMarked(gs),
            hasBingo: false,
            joinedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        currentRoomId = roomDoc.id;
        currentRoomCode = code;
        isHost = room.host === currentUser.uid;

        sessionStorage.setItem('bingo_session', JSON.stringify({ roomId: currentRoomId, roomCode: currentRoomCode }));

        document.getElementById('displayedCode').textContent = code;

        const btnStart = document.getElementById('btnStart');
        document.getElementById('settingsPanel').classList.remove('hidden');
        if (isHost) {
            btnStart.classList.remove('hidden');
            document.getElementById('settingsPanel').classList.remove('settings-disabled');
            if (room.settings) applySettingsToUI(room.settings);
        } else {
            btnStart.classList.add('hidden');
            document.getElementById('settingsPanel').classList.add('settings-disabled');
            if (room.settings) applySettingsToUI(room.settings);
        }
        applyCodeVisibility();

        const waitingMsg = document.getElementById('waitingMsg');
        if (isHost) {
            waitingMsg.textContent = '';
            waitingMsg.classList.add('hidden');
        } else {
            waitingMsg.textContent = 'En attente que l\'hôte lance la partie...';
            waitingMsg.classList.remove('hidden');
        }

        showWaitingRoom();
        listenToRoom(roomDoc.id);
        initChat(roomDoc.id);
        showToast('Room rejointe !', 'success');
    } catch (e) {
        console.error(e);
        showToast('Erreur : ' + e.message, 'error');
        btn.disabled = false;
        setButtonContent(btn, 'log-in', 'Rejoindre');
    }
}

function listenToRoom(roomId) {
    if (roomListener) roomListener();
    if (playersListener) playersListener();

    let cachedHost = null;

    roomListener = db.collection('bingo_rooms').doc(roomId)
        .onSnapshot((snap) => {
            if (!snap.exists) {
                showToast('La room a été supprimée.', 'error');
                leaveRoomLocal();
                return;
            }
            const room = snap.data();
            cachedHost = room.host;

            if (room.status === 'playing') {
                window.location.href = './game.html?room=' + roomId;
            }

            // Schedule cleanup when game finishes
            if (room.status === 'finished') {
                scheduleRoomCleanup(roomId);
            }

            // Update settings UI for non-hosts in real-time
            if (!isHost && room.settings) {
                applySettingsToUI(room.settings);
            }
        });

    // Real-time listener on players subcollection
    playersListener = db.collection('bingo_rooms').doc(roomId).collection('players')
        .onSnapshot((snap) => {
            renderPlayers(snap.docs, cachedHost);
            // If all players left, schedule cleanup (any remaining client handles it)
            if (snap.docs.length === 0) {
                scheduleRoomCleanup(roomId);
            }
        });
}

function renderPlayers(playerDocs, hostId) {
    const list = document.getElementById('playersList');
    const count = document.getElementById('playerCount');
    if (!list) return;
    list.textContent = '';
    count.textContent = playerDocs.length;

    const currentIds = new Set(playerDocs.map(d => d.id));

    playerDocs.forEach(doc => {
        const p = doc.data();
        const isThisHost = doc.id === hostId;
        const isNew = !knownPlayerIds.has(doc.id);

        const li = document.createElement('li');
        li.className = 'player-item' + (isNew ? ' player-animate' : '');

        const img = document.createElement('img');
        img.src = p.photoURL || 'https://api.dicebear.com/7.x/initials/svg?seed=' + p.name;
        img.alt = '';
        li.appendChild(img);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'player-name';
        nameSpan.textContent = p.name + (doc.id === currentUser?.uid ? ' (toi)' : '');
        li.appendChild(nameSpan);

        if (isThisHost) {
            const badge = document.createElement('span');
            badge.className = 'host-badge';
            const crownIcon = document.createElement('i');
            crownIcon.dataset.lucide = 'crown';
            badge.appendChild(crownIcon);
            badge.append(' Hôte');
            li.appendChild(badge);
        }

        list.appendChild(li);
    });

    knownPlayerIds = currentIds;

    const startBtn = document.getElementById('btnStart');
    if (startBtn && !startBtn.classList.contains('hidden')) {
        startBtn.disabled = playerDocs.length < 1;
    }

    lucide.createIcons();
}

async function startGame() {
    if (!currentRoomId) return;
    const btn = document.getElementById('btnStart');
    btn.disabled = true;
    setButtonLoading(btn, 'Lancement...');
    try {
        await db.collection('bingo_rooms').doc(currentRoomId).update({ status: 'playing' });
    } catch (e) {
        showToast('Erreur : ' + e.message, 'error');
        btn.disabled = false;
        setButtonContent(btn, 'play', 'Lancer la partie');
    }
}

async function leaveRoom() {
    if (!currentRoomId || !currentUser) { leaveRoomLocal(); return; }
    const roomIdToClean = currentRoomId;
    try {
        await db.collection('bingo_rooms').doc(currentRoomId)
            .collection('players').doc(currentUser.uid).delete();

        // Check if room is now empty — schedule cleanup regardless of host status
        const remainingSnap = await db.collection('bingo_rooms').doc(roomIdToClean).collection('players').get();
        if (remainingSnap.empty) {
            scheduleRoomCleanup(roomIdToClean);
        }
    } catch (e) {
        console.error('leaveRoom error:', e);
    }
    leaveRoomLocal();
}

function leaveRoomLocal() {
    if (roomListener) { roomListener(); roomListener = null; }
    if (playersListener) { playersListener(); playersListener = null; }
    if (chatListener) { chatListener(); chatListener = null; }
    if (typingListener) { typingListener(); typingListener = null; }
    if (typingDocRef) { typingDocRef.delete().catch(() => {}); typingDocRef = null; }
    knownPlayerIds = new Set();
    sessionStorage.removeItem('bingo_session');
    currentRoomId = null;
    currentRoomCode = null;
    isHost = false;
    document.getElementById('settingsPanel').classList.add('hidden');
    document.getElementById('settingsPanel').classList.remove('settings-disabled');
    showLobby();
}

function copyCode() {
    if (!currentRoomCode) return;
    navigator.clipboard.writeText(currentRoomCode).then(() => {
        showToast('Code copié !', 'success');
    });
}

// ===== CODE VISIBILITY =====
function toggleCodeVisibility() {
    codeHidden = !codeHidden;
    applyCodeDisplay();
}

function applyCodeVisibility() {
    codeHidden = settingsData.hideCode;
    applyCodeDisplay();
}

function applyCodeDisplay() {
    const codeEl = document.getElementById('displayedCode');
    const icon = document.getElementById('toggleCodeIcon');
    if (!codeEl) return;
    if (codeHidden) {
        codeEl.textContent = '••••••';
        codeEl.classList.add('code-masked');
        if (icon) icon.dataset.lucide = 'eye-off';
    } else {
        codeEl.textContent = currentRoomCode || '------';
        codeEl.classList.remove('code-masked');
        if (icon) icon.dataset.lucide = 'eye';
    }
    lucide.createIcons();
}

// ===== PUBLIC ROOMS =====
function listenToPublicRooms() {
    if (publicRoomsListener) publicRoomsListener();
    publicRoomsListener = db.collection('bingo_rooms')
        .where('settings.visibility', '==', 'public')
        .where('status', '==', 'waiting')
        .onSnapshot(snap => {
            renderPublicRooms(snap.docs);
        });
}

function renderPublicRooms(docs) {
    const container = document.getElementById('publicRoomsList');
    const noMsg = document.getElementById('noRoomsMsg');
    if (!container) return;

    // Remove old room cards (keep noMsg)
    container.querySelectorAll('.public-room-card').forEach(el => el.remove());

    if (docs.length === 0) {
        if (noMsg) noMsg.classList.remove('hidden');
        return;
    }
    if (noMsg) noMsg.classList.add('hidden');

    docs.forEach(doc => {
        const room = doc.data();
        const card = document.createElement('div');
        card.className = 'public-room-card';

        const info = document.createElement('div');
        info.className = 'public-room-info';

        const hostName = document.createElement('span');
        hostName.className = 'public-room-host';
        hostName.textContent = room.hostName || 'Hôte inconnu';
        info.appendChild(hostName);

        const code = document.createElement('span');
        code.className = 'public-room-code';
        code.textContent = room.code;
        info.appendChild(code);

        card.appendChild(info);

        const joinBtn = document.createElement('button');
        joinBtn.className = 'btn btn-accent btn-sm';
        joinBtn.innerHTML = '<i data-lucide=\"log-in\"></i> Rejoindre';
        joinBtn.addEventListener('click', () => joinPublicRoom(doc.id, room.code));
        card.appendChild(joinBtn);

        container.appendChild(card);
    });

    lucide.createIcons();
}

async function joinPublicRoom(roomId, code) {
    if (!currentUser) { showToast('Connecte-toi d\'abord', 'error'); return; }
    // Set the code and trigger normal join flow
    document.getElementById('roomCodeInput').value = code;
    joinRoom();
}

// ===== AUTO-CLEANUP =====
function scheduleRoomCleanup(roomId) {
    setTimeout(async () => {
        try {
            const roomSnap = await db.collection('bingo_rooms').doc(roomId).get();
            if (!roomSnap.exists) return;
            const room = roomSnap.data();
            // Delete if finished, or if room is empty
            const playersSnap = await db.collection('bingo_rooms').doc(roomId).collection('players').get();
            if (room.status === 'finished' || playersSnap.empty) {
                await deleteRoomAndSubcollections(roomId);
            }
        } catch (e) {
            console.error('Auto-cleanup error:', e);
        }
    }, 60000); // 1 minute
}

async function deleteRoomAndSubcollections(roomId) {
    try {
        const batch = db.batch();
        const playersSnap = await db.collection('bingo_rooms').doc(roomId).collection('players').get();
        playersSnap.docs.forEach(doc => batch.delete(doc.ref));
        const messagesSnap = await db.collection('bingo_rooms').doc(roomId).collection('messages').get();
        messagesSnap.docs.forEach(doc => batch.delete(doc.ref));
        const typingSnap = await db.collection('bingo_rooms').doc(roomId).collection('typing').get();
        typingSnap.docs.forEach(doc => batch.delete(doc.ref));
        batch.delete(db.collection('bingo_rooms').doc(roomId));
        await batch.commit();
    } catch (e) {
        console.error('deleteRoomAndSubcollections error:', e);
    }
}

// ===== SESSION REJOIN =====
async function tryRejoinSession(savedRoomId, savedCode) {
    if (!currentUser) return;
    try {
        const roomSnap = await db.collection('bingo_rooms').doc(savedRoomId).get();
        if (!roomSnap.exists) { sessionStorage.removeItem('bingo_session'); return; }
        const room = roomSnap.data();
        if (room.status === 'finished') { sessionStorage.removeItem('bingo_session'); return; }
        const playerSnap = await db.collection('bingo_rooms').doc(savedRoomId)
            .collection('players').doc(currentUser.uid).get();
        if (!playerSnap.exists) { sessionStorage.removeItem('bingo_session'); return; }
        if (room.status === 'playing') {
            window.location.href = './game.html?room=' + savedRoomId;
            return;
        }
        // Restore waiting room state
        currentRoomId = savedRoomId;
        currentRoomCode = savedCode;
        isHost = room.host === currentUser.uid;
        document.getElementById('displayedCode').textContent = savedCode;
        document.getElementById('settingsPanel').classList.remove('hidden');
        if (isHost) {
            document.getElementById('btnStart').classList.remove('hidden');
            document.getElementById('settingsPanel').classList.remove('settings-disabled');
            if (room.settings) applySettingsToUI(room.settings);
        } else {
            document.getElementById('btnStart').classList.add('hidden');
            document.getElementById('settingsPanel').classList.add('settings-disabled');
            if (room.settings) applySettingsToUI(room.settings);
        }
        applyCodeVisibility();
        const waitingMsg = document.getElementById('waitingMsg');
        if (isHost) { waitingMsg.textContent = ''; waitingMsg.classList.add('hidden'); }
        else { waitingMsg.textContent = 'En attente que l\'hôte lance la partie...'; waitingMsg.classList.remove('hidden'); }
        showWaitingRoom();
        listenToRoom(savedRoomId);
        initChat(savedRoomId);
        showToast('Session restaurée !', 'success');
    } catch(e) {
        console.error('tryRejoinSession error:', e);
        sessionStorage.removeItem('bingo_session');
    }
}

// ===== CHAT =====
let chatListener = null;
let typingListener = null;

function applyChatVisibility() {
    const chatPanel = document.getElementById('chatPanel');
    const chatDisabledMsg = document.getElementById('chatDisabledMsg');
    if (settingsData.chatEnabled) {
        if (chatPanel) chatPanel.classList.remove('hidden');
        if (chatDisabledMsg) chatDisabledMsg.classList.add('hidden');
    } else {
        if (chatPanel) chatPanel.classList.add('hidden');
        if (chatDisabledMsg) chatDisabledMsg.classList.remove('hidden');
    }
    lucide.createIcons();
}

function initChat(roomId) {
    if (chatListener) chatListener();
    if (typingListener) typingListener();
    const messagesEl = document.getElementById('chatMessages');
    if (!messagesEl) return;

    applyChatVisibility();

    chatListener = db.collection('bingo_rooms').doc(roomId)
        .collection('messages')
        .orderBy('sentAt', 'asc')
        .limitToLast(50)
        .onSnapshot(snap => {
            snap.docChanges().forEach(change => {
                if (change.type === 'added') {
                    appendChatMessage(change.doc.data(), messagesEl);
                }
            });
            messagesEl.scrollTop = messagesEl.scrollHeight;
        });

    // Typing indicator — listen to all typing docs
    typingListener = db.collection('bingo_rooms').doc(roomId)
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

    // Typing doc ref for current user
    typingDocRef = db.collection('bingo_rooms').doc(roomId)
        .collection('typing').doc(currentUser?.uid);

    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    if (btn) btn.addEventListener('click', sendChatMessage);
    if (input) {
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); } });
        input.addEventListener('input', onChatTyping);
    }
}

function onChatTyping() {
    if (!typingDocRef || !currentUser) return;
    typingDocRef.set({
        name: currentUser.displayName,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        if (typingDocRef) typingDocRef.delete().catch(() => {});
    }, 3000);
}

async function sendChatMessage() {
    if (!currentRoomId || !currentUser) return;
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    // Clear typing indicator on send
    if (typingDocRef) typingDocRef.delete().catch(() => {});
    clearTimeout(typingTimeout);
    try {
        await db.collection('bingo_rooms').doc(currentRoomId).collection('messages').add({
            uid: currentUser.uid,
            author: currentUser.displayName,
            text,
            sentAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch(e) { console.error('Error sending chat message:', e); }
}

function appendChatMessage(data, container) {
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
