/**
 * Shared UI helpers — used by both lobby and game pages
 */

function setButtonContent(btn, iconName, text) {
    btn.textContent = '';
    const icon = document.createElement('i');
    icon.dataset.lucide = iconName;
    btn.appendChild(icon);
    btn.append(' ' + text);
    lucide.createIcons();
}

function setButtonLoading(btn, text) {
    btn.textContent = '';
    const loader = document.createElement('span');
    loader.className = 'loader';
    btn.appendChild(loader);
    btn.append(' ' + text);
}

let toastTimeout;
function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    t.textContent = '';
    const iconSpan = document.createElement('span');
    iconSpan.textContent = icons[type] || 'ℹ️';
    t.appendChild(iconSpan);
    t.append(' ' + msg);
    t.className = 'show ' + type;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => t.classList.remove('show'), 3500);
}
