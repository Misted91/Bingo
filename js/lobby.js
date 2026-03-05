/**
 * Lobby module — room creation, joining, waiting room, event listeners
 */

let currentRoomId = null;
let currentRoomCode = null;
let roomListener = null;
let isHost = false;

// Default game settings
let settingsData = {
    drawMode: 'manual',
    drawInterval: 10,
    gridCount: 1,
    patterns: ['line', 'column', 'diagonal']
};

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();

    document.getElementById('btnGoogleGate').addEventListener('click', signIn);
    document.getElementById('btnCreate').addEventListener('click', createRoom);
    document.getElementById('btnJoin').addEventListener('click', joinRoom);
    document.getElementById('btnLeaveRoom').addEventListener('click', (e) => {
        e.preventDefault();
        leaveRoom();
    });
    document.getElementById('btnCopyCode').addEventListener('click', copyCode);
    document.getElementById('btnStart').addEventListener('click', startGame);
    document.getElementById('roomCodeInput').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
    });

    initSettingsUI();
});

// ===== SETTINGS UI =====
function initSettingsUI() {
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

    // Patterns
    if (settings.patterns) {
        document.querySelectorAll('#patternsGrid input[name="pattern"]').forEach(cb => {
            cb.checked = settings.patterns.includes(cb.value);
        });
    }
}

function updateSettingsSummary(settings) {
    const content = document.getElementById('summaryContent');
    if (!content || !settings) return;

    const drawModeText = settings.drawMode === 'auto'
        ? `Automatique (${settings.drawInterval}s)`
        : 'Manuel';
    const patternNames = {
        line: 'Ligne', column: 'Colonne', diagonal: 'Diagonale',
        corners: '4 Coins', fullCard: 'Carton plein', xPattern: 'Croix (X)'
    };
    const patternsText = (settings.patterns || []).map(p => patternNames[p] || p).join(', ');

    content.innerHTML = `
        <div class="summary-item"><span>Mode de tirage</span><strong>${drawModeText}</strong></div>
        <div class="summary-item"><span>Grilles par joueur</span><strong>${settings.gridCount}</strong></div>
        <div class="summary-item"><span>Patterns gagnants</span><strong>${patternsText || '-'}</strong></div>
    `;
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
            status: 'waiting',
            calledNumbers: [],
            settings: { ...settingsData },
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await roomRef.collection('players').doc(currentUser.uid).set({
            name: currentUser.displayName,
            photoURL: currentUser.photoURL || '',
            grid: generateBingoGrid(),
            marked: generateDefaultMarked(),
            hasBingo: false,
            joinedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        currentRoomId = roomRef.id;
        currentRoomCode = code;
        isHost = true;

        document.getElementById('displayedCode').textContent = code;
        document.getElementById('btnStart').classList.remove('hidden');
        document.getElementById('waitingMsg').classList.add('hidden');
        document.getElementById('settingsPanel').classList.remove('hidden');
        document.getElementById('settingsSummary').classList.add('hidden');
        showWaitingRoom();
        listenToRoom(roomRef.id);
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

        await roomDoc.ref.collection('players').doc(currentUser.uid).set({
            name: currentUser.displayName,
            photoURL: currentUser.photoURL || '',
            grid: generateBingoGrid(),
            marked: generateDefaultMarked(),
            hasBingo: false,
            joinedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        currentRoomId = roomDoc.id;
        currentRoomCode = code;
        isHost = room.host === currentUser.uid;

        document.getElementById('displayedCode').textContent = code;

        const btnStart = document.getElementById('btnStart');
        if (isHost) {
            btnStart.classList.remove('hidden');
            document.getElementById('settingsPanel').classList.remove('hidden');
            document.getElementById('settingsSummary').classList.add('hidden');
            if (room.settings) applySettingsToUI(room.settings);
        } else {
            btnStart.classList.add('hidden');
            document.getElementById('settingsPanel').classList.add('hidden');
            document.getElementById('settingsSummary').classList.remove('hidden');
            updateSettingsSummary(room.settings || settingsData);
        }

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

    roomListener = db.collection('bingo_rooms').doc(roomId)
        .onSnapshot(async (snap) => {
            if (!snap.exists) {
                showToast('La room a été supprimée.', 'error');
                leaveRoomLocal();
                return;
            }
            const room = snap.data();

            if (room.status === 'playing') {
                window.location.href = './game.html?room=' + roomId;
            }

            // Update settings summary for non-hosts
            if (!isHost && room.settings) {
                updateSettingsSummary(room.settings);
            }

            const playersSnap = await db.collection('bingo_rooms').doc(roomId).collection('players').get();
            renderPlayers(playersSnap.docs, room.host);
        });
}

function renderPlayers(playerDocs, hostId) {
    const list = document.getElementById('playersList');
    const count = document.getElementById('playerCount');
    if (!list) return;
    list.textContent = '';
    count.textContent = playerDocs.length;

    playerDocs.forEach(doc => {
        const p = doc.data();
        const isThisHost = doc.id === hostId;

        const li = document.createElement('li');
        li.className = 'player-item';

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
    try {
        await db.collection('bingo_rooms').doc(currentRoomId)
            .collection('players').doc(currentUser.uid).delete();

        const roomSnap = await db.collection('bingo_rooms').doc(currentRoomId).get();
        if (roomSnap.exists && roomSnap.data().host === currentUser.uid) {
            await db.collection('bingo_rooms').doc(currentRoomId).delete();
        }
    } catch (e) {
        console.error('leaveRoom error:', e);
    }
    leaveRoomLocal();
}

function leaveRoomLocal() {
    if (roomListener) { roomListener(); roomListener = null; }
    currentRoomId = null;
    currentRoomCode = null;
    isHost = false;
    document.getElementById('settingsPanel').classList.add('hidden');
    document.getElementById('settingsSummary').classList.add('hidden');
    showLobby();
}

function copyCode() {
    if (!currentRoomCode) return;
    navigator.clipboard.writeText(currentRoomCode).then(() => {
        showToast('Code copié !', 'success');
    });
}
