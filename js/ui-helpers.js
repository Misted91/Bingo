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
    const iconNames = { success: 'circle-check', error: 'circle-x', info: 'info' };
    t.textContent = '';
    const iconEl = document.createElement('i');
    iconEl.dataset.lucide = iconNames[type] || 'info';
    iconEl.style.width = '1em';
    iconEl.style.height = '1em';
    iconEl.style.verticalAlign = 'middle';
    iconEl.style.flexShrink = '0';
    t.appendChild(iconEl);
    t.append(' ' + msg);
    lucide.createIcons();
    t.className = 'show ' + type;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => t.classList.remove('show'), 3500);
}

function showConfirmModal(msg, onOk, onCancel) {
    const overlay = document.getElementById('confirmModal');
    const msgEl = document.getElementById('confirmModalMsg');
    const okBtn = document.getElementById('confirmModalOk');
    const cancelBtn = document.getElementById('confirmModalCancel');
    if (!overlay) {
        // Fallback to native confirm when modal is not in the page
        if (onOk && confirm(msg)) onOk();
        else if (onCancel) onCancel();
        return;
    }
    msgEl.textContent = msg;
    overlay.classList.remove('hidden');
    const close = () => overlay.classList.add('hidden');
    okBtn.onclick = () => { close(); if (onOk) onOk(); };
    cancelBtn.onclick = () => { close(); if (onCancel) onCancel(); };
    overlay.onclick = (e) => { if (e.target === overlay) { close(); if (onCancel) onCancel(); } };
}

function initRgpdModal() {
    const link = document.getElementById('rgpdLink');
    const modal = document.getElementById('rgpdModal');
    const closeBtn = document.getElementById('rgpdModalClose');
    if (!link || !modal) return;
    link.addEventListener('click', (e) => { e.preventDefault(); modal.classList.remove('hidden'); });
    if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
}
