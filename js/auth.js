/**
 * Auth module — lobby page only
 * Handles Google sign-in/out and auth area rendering
 */

let currentUser = null;

auth.onAuthStateChanged(user => {
    currentUser = user;
    renderAuthArea(user);
    if (user) {
        showLobby();
        const saved = sessionStorage.getItem('bingo_session');
        if (saved) {
            try {
                const { roomId: savedRoomId, roomCode } = JSON.parse(saved);
                tryRejoinSession(savedRoomId, roomCode);
            } catch(e) { sessionStorage.removeItem('bingo_session'); }
        }
    } else {
        showAuthGate();
    }
});

function renderAuthArea(user) {
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

        const btn = document.createElement('button');
        btn.className = 'btn-signout';
        btn.addEventListener('click', signOut);
        const icon = document.createElement('i');
        icon.dataset.lucide = 'log-out';
        btn.appendChild(icon);
        btn.append(' Déconnexion');
        area.appendChild(btn);
    }
    /* No header sign-in button when logged out — the auth gate handles it */

    lucide.createIcons();
}

async function signIn() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await auth.signInWithPopup(provider);
    } catch (e) {
        if (e.code !== 'auth/cancelled-popup-request' && e.code !== 'auth/popup-closed-by-user') {
            showToast('Erreur de connexion : ' + e.message, 'error');
        }
    }
}

async function signOut() {
    if (roomListener) roomListener();
    if (typeof chatListener !== 'undefined' && chatListener) chatListener();
    sessionStorage.removeItem('bingo_session');
    currentRoomId = null;
    currentRoomCode = null;
    await auth.signOut();
}
