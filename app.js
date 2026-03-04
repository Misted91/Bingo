
const firebaseConfig = {
    apiKey: "AIzaSyBQOObCmTNS3d-H8_1hQbpcyTugUhb00aY",
    authDomain: "bingo-c7caf.firebaseapp.com",
    projectId: "bingo-c7caf",
    storageBucket: "bingo-c7caf.firebasestorage.app",
    messagingSenderId: "824394390490",
    appId: "1:824394390490:web:5c068729ab49b0037d7ee3"
};

// ===== INIT =====
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let currentRoomId = null;
let currentRoomCode = null;
let roomListener = null;
let isHost = false;

// ===== AUTH STATE =====
// Handle redirect result first (signInWithRedirect flow)
auth.getRedirectResult().then(result => {
    // result.user is null if no redirect just happened, that's fine
}).catch(e => {
    if (e.code !== 'auth/cancelled-popup-request' && e.code !== 'auth/popup-closed-by-user') {
        showToast('Erreur de connexion : ' + e.message, 'error');
    }
});

auth.onAuthStateChanged(user => {
    currentUser = user;
    renderAuthArea(user);
    if (user) {
        showLobby();
    } else {
        showAuthGate();
    }
});

function renderAuthArea(user) {
    const area = document.getElementById('authArea');
    if (!area) return;
    if (user) {
        area.innerHTML = `
            <div class="user-pill">
                <img src="${user.photoURL || 'https://api.dicebear.com/7.x/initials/svg?seed=' + user.displayName}" alt="avatar">
                <span class="name">${user.displayName}</span>
            </div>
            <button class="btn-signout" onclick="signOut()">
                <i class="fa-solid fa-right-from-bracket"></i> Déconnexion
            </button>
        `;
    } else {
        area.innerHTML = `
            <button class="btn-google" onclick="signIn()">
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google">
                Connexion Google
            </button>
        `;
    }
}

async function signIn() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        // Use redirect instead of popup to avoid COOP/cross-origin issues
        await auth.signInWithRedirect(provider);
    } catch (e) {
        showToast('Erreur de connexion : ' + e.message, 'error');
    }
}

async function signOut() {
    if (roomListener) roomListener();
    currentRoomId = null;
    currentRoomCode = null;
    await auth.signOut();
}

// ===== VIEW MANAGEMENT =====
function showAuthGate() {
    document.getElementById('authGate').style.display = 'block';
    document.getElementById('lobbySection').style.display = 'none';
    document.getElementById('waitingRoom').style.display = 'none';
}

function showLobby() {
    document.getElementById('authGate').style.display = 'none';
    document.getElementById('lobbySection').style.display = 'block';
    document.getElementById('waitingRoom').style.display = 'none';
    // Enable buttons
    document.getElementById('btnCreate').disabled = false;
    document.getElementById('btnCreate').innerHTML = '<i class="fa-solid fa-rocket"></i> Créer la room';
    document.getElementById('btnJoin').disabled = false;
    document.getElementById('btnJoin').innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Rejoindre';
}

function showWaitingRoom() {
    document.getElementById('authGate').style.display = 'none';
    document.getElementById('lobbySection').style.display = 'none';
    document.getElementById('waitingRoom').style.display = 'block';
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
    btn.innerHTML = '<span class="loader"></span> Création...';

    try {
        const code = generateCode();
        const roomRef = db.collection('bingo_rooms').doc();

        await roomRef.set({
            code: code,
            host: currentUser.uid,
            status: 'waiting',
            calledNumbers: [],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Add self as player
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
        document.getElementById('btnStart').style.display = 'inline-flex';
        document.getElementById('waitingMsg').style.display = 'none';
        showWaitingRoom();
        listenToRoom(roomRef.id);
        showToast('Room créée ! Code : ' + code, 'success');
    } catch (e) {
        console.error(e);
        showToast('Erreur : ' + e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rocket"></i> Créer la room';
    }
}

async function joinRoom() {
    if (!currentUser) { showToast('Connecte-toi d\'abord', 'error'); return; }
    const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
    if (code.length !== 6) { showToast('Code invalide (6 caractères)', 'error'); return; }

    const btn = document.getElementById('btnJoin');
    btn.disabled = true;
    btn.innerHTML = '<span class="loader"></span> Connexion...';

    try {
        const snap = await db.collection('bingo_rooms').where('code', '==', code).limit(1).get();
        if (snap.empty) {
            showToast('Room introuvable. Vérifie le code.', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Rejoindre';
            return;
        }

        const roomDoc = snap.docs[0];
        const room = roomDoc.data();

        if (room.status === 'finished') {
            showToast('Cette partie est terminée.', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Rejoindre';
            return;
        }

        if (room.status === 'playing') {
            showToast('La partie est déjà commencée !', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Rejoindre';
            return;
        }

        // Check player count
        const playersSnap = await roomDoc.ref.collection('players').get();
        if (playersSnap.size >= 8) {
            showToast('La room est pleine (max 8 joueurs).', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Rejoindre';
            return;
        }

        // Add player
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
        document.getElementById('btnStart').style.display = isHost ? 'inline-flex' : 'none';
        document.getElementById('waitingMsg').textContent = isHost ? '' : 'En attente que l\'hôte lance la partie...';
        showWaitingRoom();
        listenToRoom(roomDoc.id);
        showToast('Room rejointe !', 'success');
    } catch (e) {
        console.error(e);
        showToast('Erreur : ' + e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Rejoindre';
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

            // If game started, go to game page
            if (room.status === 'playing') {
                window.location.href = 'game.html?room=' + roomId;
            }

            // Update players list
            const playersSnap = await db.collection('bingo_rooms').doc(roomId).collection('players').get();
            renderPlayers(playersSnap.docs, room.host);
        });
}

function renderPlayers(playerDocs, hostId) {
    const list = document.getElementById('playersList');
    const count = document.getElementById('playerCount');
    if (!list) return;
    list.innerHTML = '';
    count.textContent = playerDocs.length;

    playerDocs.forEach(doc => {
        const p = doc.data();
        const isThisHost = doc.id === hostId;
        const li = document.createElement('li');
        li.className = 'player-item';
        li.innerHTML = `
            <img src="${p.photoURL || 'https://api.dicebear.com/7.x/initials/svg?seed=' + p.name}" alt="">
            <span class="player-name">${p.name}${doc.id === currentUser?.uid ? ' (toi)' : ''}</span>
            ${isThisHost ? '<span class="host-badge"><i class="fa-solid fa-crown"></i> Hôte</span>' : ''}
        `;
        list.appendChild(li);
    });

    // Update start button: need at least 1 player
    const startBtn = document.getElementById('btnStart');
    if (startBtn && startBtn.style.display !== 'none') {
        startBtn.disabled = playerDocs.length < 1;
    }
}

async function startGame() {
    if (!currentRoomId) return;
    const btn = document.getElementById('btnStart');
    btn.disabled = true;
    btn.innerHTML = '<span class="loader"></span> Lancement...';
    try {
        await db.collection('bingo_rooms').doc(currentRoomId).update({ status: 'playing' });
        // Listener will redirect everyone
    } catch (e) {
        showToast('Erreur : ' + e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-play"></i> Lancer la partie';
    }
}

async function leaveRoom() {
    if (!currentRoomId || !currentUser) { leaveRoomLocal(); return; }
    try {
        // Remove player from room
        await db.collection('bingo_rooms').doc(currentRoomId)
            .collection('players').doc(currentUser.uid).delete();

        // If host leaves, delete room
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
    showLobby();
}

function copyCode() {
    if (!currentRoomCode) return;
    navigator.clipboard.writeText(currentRoomCode).then(() => {
        showToast('Code copié !', 'success');
    });
}

// ===== BINGO GRID GENERATION (flat 1D arrays for Firestore) =====
function generateBingoGrid() {
    // B:1-15, I:16-30, N:31-45, G:46-60, O:61-75
    const ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
    // Build column-by-column, store in flat row-major order
    const cols = [];
    for (let col = 0; col < 5; col++) {
        const [min, max] = ranges[col];
        cols.push(shuffle(range(min, max)).slice(0, 5));
    }
    // Flatten to 1D row-major: index = row*5 + col
    const flat = [];
    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
            flat.push(cols[col][row]);
        }
    }
    // Free space center (index 12 = row2, col2)
    flat[12] = 0;
    return flat;
}

function generateDefaultMarked() {
    const m = new Array(25).fill(false);
    m[12] = true; // center FREE space
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
