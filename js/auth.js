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
    } else {
        const btn = document.createElement('button');
        btn.className = 'btn-google btn-google-header';
        btn.innerHTML = '<svg class="google-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" fill="currentColor"/></svg> Se connecter';
        btn.addEventListener('click', signIn);
        area.appendChild(btn);
    }

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
