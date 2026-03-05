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
let hostLeftTimeout = null;
let lastMessageTime = 0;

// Default game settings
const DEFAULT_SETTINGS = {
    drawMode: 'manual',
    drawInterval: 10,
    gridSize: 5,
    gridCount: 1,
    patterns: ['line', 'column', 'diagonal'],
    calledAnimations: true,
    bingoValidation: 'auto',
    visibility: 'private',
    hideCode: true,
    chatEnabled: true,
    chatFilter: false,
    slowMode: 0,
    maxMessageLength: 200,
    mutedUsers: []
};

function loadSavedSettings() {
    try {
        const saved = localStorage.getItem('bingo_settings');
        if (saved) {
            const parsed = JSON.parse(saved);
            // Merge saved values into defaults (handles new fields added later)
            return { ...DEFAULT_SETTINGS, ...parsed, mutedUsers: [] };
        }
    } catch (e) { console.warn('Failed to load saved settings:', e); }
    return { ...DEFAULT_SETTINGS };
}

function persistSettings() {
    try {
        // Don't persist mutedUsers (per-room, not reusable)
        const toSave = { ...settingsData };
        delete toSave.mutedUsers;
        localStorage.setItem('bingo_settings', JSON.stringify(toSave));
    } catch (e) { console.warn('Failed to save settings:', e); }
}

let settingsData = loadSavedSettings();

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

    document.getElementById('logoHome').addEventListener('click', (e) => {
        e.preventDefault();
        if (currentRoomId) {
            showConfirmModal('Quitter la room en cours ?', () => {
                leaveRoom();
            });
        } else {
            window.location.href = './index.html';
        }
    });

    initSettingsUI();
    applySettingsToUI(settingsData);
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

    // Chat filter toggle
    document.getElementById('chatFilterToggle').addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        document.querySelectorAll('#chatFilterToggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settingsData.chatFilter = btn.dataset.value === 'true';
        saveSettings();
    });

    // Slow mode slider
    document.getElementById('slowModeRange').addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        settingsData.slowMode = val;
        document.getElementById('slowModeValue').textContent = val === 0 ? 'Désactivé' : val + 's';
        saveSettings();
    });

    // Max message length slider
    document.getElementById('maxMsgLengthRange').addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        settingsData.maxMessageLength = val;
        document.getElementById('maxMsgLengthValue').textContent = val + ' car.';
        const chatInput = document.getElementById('chatInput');
        if (chatInput) chatInput.maxLength = val;
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
    persistSettings();
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

    // Chat filter
    if (settings.chatFilter !== undefined) {
        document.querySelectorAll('#chatFilterToggle .toggle-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.value === String(settings.chatFilter));
        });
    }

    // Slow mode
    if (settings.slowMode !== undefined) {
        document.getElementById('slowModeRange').value = settings.slowMode;
        document.getElementById('slowModeValue').textContent = settings.slowMode === 0 ? 'Désactivé' : settings.slowMode + 's';
    }

    // Max message length
    if (settings.maxMessageLength !== undefined) {
        document.getElementById('maxMsgLengthRange').value = settings.maxMessageLength;
        document.getElementById('maxMsgLengthValue').textContent = settings.maxMessageLength + ' car.';
        const chatInput = document.getElementById('chatInput');
        if (chatInput) chatInput.maxLength = settings.maxMessageLength;
    }

    // Muted users (update player rendering)
    if (settings.mutedUsers !== undefined) {
        settingsData.mutedUsers = settings.mutedUsers || [];
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
    // Syllable-based code: easy to say aloud and type (e.g. BAKO-METU)
    const consonants = 'BDFGKLMNPRSTVZ';
    const vowels = 'AEIOU';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += consonants[Math.floor(Math.random() * consonants.length)];
        code += vowels[Math.floor(Math.random() * vowels.length)];
    }
    return code; // 8 chars, e.g. BAKOMETU
}

function formatCode(code) {
    // Display as BAKO-METU for readability
    if (code.length === 8) return code.slice(0, 4) + '-' + code.slice(4);
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
            bannedUsers: [],
            hostLeftAt: null,
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

        document.getElementById('displayedCode').textContent = formatCode(code);
        document.getElementById('waitingMsg').classList.add('hidden');
        document.getElementById('settingsPanel').classList.remove('hidden');
        document.getElementById('settingsPanel').classList.remove('settings-disabled');
        applyCodeVisibility();
        showWaitingRoom();
        listenToRoom(roomRef.id);
        initChat(roomRef.id);
        showToast('Room créée ! Code : ' + formatCode(code), 'success');
    } catch (e) {
        console.error(e);
        showToast('Erreur : ' + e.message, 'error');
        btn.disabled = false;
        setButtonContent(btn, 'rocket', 'Créer la room');
    }
}

async function joinRoom() {
    if (!currentUser) { showToast('Connecte-toi d\'abord', 'error'); return; }
    const code = document.getElementById('roomCodeInput').value.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 8) { showToast('Code invalide (8 lettres)', 'error'); return; }

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

        // Check if user is banned from this room
        if (room.bannedUsers && room.bannedUsers.includes(currentUser.uid)) {
            showToast('Tu as été banni de cette room.', 'error');
            btn.disabled = false;
            setButtonContent(btn, 'log-in', 'Rejoindre');
            return;
        }

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

        document.getElementById('displayedCode').textContent = formatCode(code);

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

            // Detect if current user got banned
            if (room.bannedUsers && room.bannedUsers.includes(currentUser?.uid)) {
                showToast('Tu as été banni de cette room.', 'error');
                leaveRoomLocal();
                return;
            }

            // Update host status dynamically
            const wasHost = isHost;
            isHost = room.host === currentUser?.uid;
            if (isHost !== wasHost) {
                applyHostUI();
            }

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

            // Detect if current user was kicked (no longer in players list)
            if (currentUser && snap.docs.length > 0 && !snap.docs.find(d => d.id === currentUser.uid)) {
                showToast('Tu as été expulsé de la room.', 'error');
                leaveRoomLocal();
                return;
            }

            // If all players left, schedule cleanup
            if (snap.docs.length === 0) {
                scheduleRoomCleanup(roomId);
            }

            // Host left detection: if host not in players, schedule auto-transfer
            if (cachedHost && !snap.docs.find(d => d.id === cachedHost)) {
                handleHostLeft(roomId, snap.docs);
            } else {
                // Host is present, clear any pending transfer
                if (hostLeftTimeout) { clearTimeout(hostLeftTimeout); hostLeftTimeout = null; }
            }
        });
}

function applyHostUI() {
    const btnStart = document.getElementById('btnStart');
    const settingsPanel = document.getElementById('settingsPanel');
    const waitingMsg = document.getElementById('waitingMsg');
    if (isHost) {
        if (btnStart) btnStart.classList.remove('hidden');
        if (settingsPanel) settingsPanel.classList.remove('settings-disabled');
        if (waitingMsg) { waitingMsg.textContent = ''; waitingMsg.classList.add('hidden'); }
    } else {
        if (btnStart) btnStart.classList.add('hidden');
        if (settingsPanel) settingsPanel.classList.add('settings-disabled');
        if (waitingMsg) { waitingMsg.textContent = 'En attente que l\'hôte lance la partie...'; waitingMsg.classList.remove('hidden'); }
    }
}

async function handleHostLeft(roomId, playerDocs) {
    if (hostLeftTimeout) return; // Already scheduled
    // Wait 60 seconds, then transfer host to the oldest player remaining
    hostLeftTimeout = setTimeout(async () => {
        try {
            const roomSnap = await db.collection('bingo_rooms').doc(roomId).get();
            if (!roomSnap.exists) return;
            const room = roomSnap.data();
            // Re-check if host came back
            const playersSnap = await db.collection('bingo_rooms').doc(roomId).collection('players').get();
            if (playersSnap.empty) return;
            const hostStillGone = !playersSnap.docs.find(d => d.id === room.host);
            if (!hostStillGone) return;

            // Find next host by joinedAt
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
                showToast(newHost.data.name + ' est devenu l\'hôte !', 'info');
            }
        } catch (e) {
            console.error('handleHostLeft error:', e);
        }
        hostLeftTimeout = null;
    }, 60000);
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
        const isMe = doc.id === currentUser?.uid;

        const li = document.createElement('li');
        li.className = 'player-item' + (isNew ? ' player-animate' : '');

        const img = document.createElement('img');
        img.src = p.photoURL || 'https://api.dicebear.com/7.x/initials/svg?seed=' + p.name;
        img.alt = '';
        li.appendChild(img);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'player-name';
        nameSpan.textContent = p.name + (isMe ? ' (toi)' : '');
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

        // Muted badge
        if ((settingsData.mutedUsers || []).includes(doc.id)) {
            const muteBadge = document.createElement('span');
            muteBadge.className = 'muted-badge';
            const muteIcon = document.createElement('i');
            muteIcon.dataset.lucide = 'mic-off';
            muteBadge.appendChild(muteIcon);
            li.appendChild(muteBadge);
        }

        // Host actions on other players
        if (isHost && !isMe) {
            const actions = document.createElement('div');
            actions.className = 'player-actions';

            // Transfer host button
            const transferBtn = document.createElement('button');
            transferBtn.className = 'player-action-btn transfer-btn';
            transferBtn.title = 'Transférer le rôle d\'hôte';
            transferBtn.innerHTML = '<i data-lucide="crown"></i>';
            transferBtn.addEventListener('click', () => {
                showConfirmModal('Transférer le rôle d\'hôte à ' + p.name + ' ?', () => transferHost(doc.id, p.name));
            });
            actions.appendChild(transferBtn);

            // Kick button
            const kickBtn = document.createElement('button');
            kickBtn.className = 'player-action-btn kick-btn';
            kickBtn.title = 'Expulser';
            kickBtn.innerHTML = '<i data-lucide="user-x"></i>';
            kickBtn.addEventListener('click', () => {
                showConfirmModal('Expulser ' + p.name + ' de la room ?', () => kickPlayer(doc.id, p.name));
            });
            actions.appendChild(kickBtn);

            // Mute chat button
            const isMuted = (settingsData.mutedUsers || []).includes(doc.id);
            const muteBtn = document.createElement('button');
            muteBtn.className = 'player-action-btn mute-btn' + (isMuted ? ' active' : '');
            muteBtn.title = isMuted ? 'Rétablir le chat' : 'Rendre muet (chat)';
            muteBtn.innerHTML = isMuted ? '<i data-lucide="mic-off"></i>' : '<i data-lucide="mic"></i>';
            muteBtn.addEventListener('click', () => {
                if (isMuted) {
                    unmutePlayer(doc.id, p.name);
                } else {
                    showConfirmModal('Rendre ' + p.name + ' muet dans le chat ?', () => mutePlayer(doc.id, p.name));
                }
            });
            actions.appendChild(muteBtn);

            // Ban button
            const banBtn = document.createElement('button');
            banBtn.className = 'player-action-btn ban-btn';
            banBtn.title = 'Bannir';
            banBtn.innerHTML = '<i data-lucide="ban"></i>';
            banBtn.addEventListener('click', () => {
                showConfirmModal('Bannir ' + p.name + ' ? Il ne pourra plus rejoindre cette room.', () => banPlayer(doc.id, p.name));
            });
            actions.appendChild(banBtn);

            li.appendChild(actions);
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

// ===== HOST / KICK / BAN ACTIONS =====
async function transferHost(playerId, playerName) {
    if (!currentRoomId || !isHost) return;
    try {
        await db.collection('bingo_rooms').doc(currentRoomId).update({
            host: playerId,
            hostName: playerName,
            hostLeftAt: null
        });
        showToast('Rôle d\'hôte transféré à ' + playerName, 'success');
    } catch (e) {
        console.error('transferHost error:', e);
        showToast('Erreur lors du transfert', 'error');
    }
}

async function kickPlayer(playerId, playerName) {
    if (!currentRoomId || !isHost) return;
    try {
        await db.collection('bingo_rooms').doc(currentRoomId)
            .collection('players').doc(playerId).delete();
        showToast(playerName + ' a été expulsé', 'success');
    } catch (e) {
        console.error('kickPlayer error:', e);
        showToast('Erreur lors de l\'expulsion', 'error');
    }
}

async function banPlayer(playerId, playerName) {
    if (!currentRoomId || !isHost) return;
    try {
        // Add to ban list
        await db.collection('bingo_rooms').doc(currentRoomId).update({
            bannedUsers: firebase.firestore.FieldValue.arrayUnion(playerId)
        });
        // Then remove from players
        await db.collection('bingo_rooms').doc(currentRoomId)
            .collection('players').doc(playerId).delete();
        showToast(playerName + ' a été banni', 'success');
    } catch (e) {
        console.error('banPlayer error:', e);
        showToast('Erreur lors du bannissement', 'error');
    }
}

async function mutePlayer(playerId, playerName) {
    if (!currentRoomId || !isHost) return;
    try {
        const mutedUsers = [...(settingsData.mutedUsers || [])];
        if (!mutedUsers.includes(playerId)) mutedUsers.push(playerId);
        settingsData.mutedUsers = mutedUsers;
        await db.collection('bingo_rooms').doc(currentRoomId).update({ 'settings.mutedUsers': mutedUsers });
        showToast(playerName + ' est muet dans le chat', 'success');
    } catch (e) {
        console.error('mutePlayer error:', e);
        showToast('Erreur lors du mute', 'error');
    }
}

async function unmutePlayer(playerId, playerName) {
    if (!currentRoomId || !isHost) return;
    try {
        const mutedUsers = (settingsData.mutedUsers || []).filter(id => id !== playerId);
        settingsData.mutedUsers = mutedUsers;
        await db.collection('bingo_rooms').doc(currentRoomId).update({ 'settings.mutedUsers': mutedUsers });
        showToast(playerName + ' peut à nouveau parler', 'success');
    } catch (e) {
        console.error('unmutePlayer error:', e);
        showToast('Erreur lors du unmute', 'error');
    }
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
    const wasHost = isHost;
    try {
        await db.collection('bingo_rooms').doc(currentRoomId)
            .collection('players').doc(currentUser.uid).delete();

        // If room is empty, delete it immediately (while we still have auth)
        const remainingSnap = await db.collection('bingo_rooms').doc(roomIdToClean).collection('players').get();
        if (remainingSnap.empty) {
            await deleteRoomAndSubcollections(roomIdToClean);
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
    if (hostLeftTimeout) { clearTimeout(hostLeftTimeout); hostLeftTimeout = null; }
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

    let hasVisible = false;
    docs.forEach(doc => {
        const room = doc.data();

        // Async check: skip and clean up rooms with no players
        db.collection('bingo_rooms').doc(doc.id).collection('players').get().then(pSnap => {
            if (pSnap.empty) {
                scheduleRoomCleanup(doc.id);
                const existing = container.querySelector(`[data-room-id="${doc.id}"]`);
                if (existing) existing.remove();
                // Show "no rooms" if none left
                if (!container.querySelector('.public-room-card')) {
                    if (noMsg) noMsg.classList.remove('hidden');
                }
                return;
            }
        }).catch(() => {});

        hasVisible = true;
        const card = document.createElement('div');
        card.className = 'public-room-card';
        card.dataset.roomId = doc.id;

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
async function scheduleRoomCleanup(roomId) {
    try {
        const roomSnap = await db.collection('bingo_rooms').doc(roomId).get();
        if (!roomSnap.exists) return;
        const playersSnap = await db.collection('bingo_rooms').doc(roomId).collection('players').get();
        if (playersSnap.empty) {
            await deleteRoomAndSubcollections(roomId);
        }
    } catch (e) {
        // Silently fail — permissions may be insufficient if user left the room
    }
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
        document.getElementById('displayedCode').textContent = formatCode(savedCode);
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
    const chatSubSettings = document.getElementById('chatSubSettings');
    if (settingsData.chatEnabled) {
        if (chatPanel) chatPanel.classList.remove('hidden');
        if (chatDisabledMsg) chatDisabledMsg.classList.add('hidden');
        if (chatSubSettings) chatSubSettings.classList.remove('hidden');
    } else {
        if (chatPanel) chatPanel.classList.add('hidden');
        if (chatDisabledMsg) chatDisabledMsg.classList.remove('hidden');
        if (chatSubSettings) chatSubSettings.classList.add('hidden');
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
    let text = input.value.trim();
    if (!text) return;

    // Check if muted
    if ((settingsData.mutedUsers || []).includes(currentUser.uid)) {
        showToast('Vous êtes muet dans cette room', 'error');
        return;
    }

    // Slow mode enforcement
    if (settingsData.slowMode > 0) {
        const elapsed = (Date.now() - lastMessageTime) / 1000;
        const remaining = Math.ceil(settingsData.slowMode - elapsed);
        if (remaining > 0) {
            showToast('Mode lent : attendez ' + remaining + 's', 'error');
            return;
        }
    }

    // Max length enforcement
    const maxLen = settingsData.maxMessageLength || 200;
    if (text.length > maxLen) {
        text = text.substring(0, maxLen);
    }

    input.value = '';
    // Apply chat filter if enabled
    if (settingsData.chatFilter) {
        text = filterChatMessage(text);
    }
    // Clear typing indicator on send
    if (typingDocRef) typingDocRef.delete().catch(() => {});
    clearTimeout(typingTimeout);

    lastMessageTime = Date.now();
    updateSlowModeUI();

    try {
        await db.collection('bingo_rooms').doc(currentRoomId).collection('messages').add({
            uid: currentUser.uid,
            author: currentUser.displayName,
            text,
            sentAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch(e) { console.error('Error sending chat message:', e); }
}

function updateSlowModeUI() {
    if (!settingsData.slowMode || settingsData.slowMode <= 0) return;
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    if (!input || !btn) return;

    input.disabled = true;
    btn.disabled = true;
    let remaining = settingsData.slowMode;
    input.placeholder = 'Mode lent : ' + remaining + 's...';

    const interval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(interval);
            input.disabled = false;
            btn.disabled = false;
            input.placeholder = 'Écrire un message...';
        } else {
            input.placeholder = 'Mode lent : ' + remaining + 's...';
        }
    }, 1000);
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
