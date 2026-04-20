// Undo + toast notification system

import { bus, EVENTS } from './events.js';

let toastsEl = null;

export function initUndo() {
  toastsEl = document.getElementById('toasts');

  bus.on(EVENTS.UNDO, handleUndo);
}

async function handleUndo() {
  try {
    const res = await fetch('/api/undo', { method: 'POST' });
    const data = await res.json();

    if (data.ok) {
      showToast(`Undid ${data.action} (${data.restored} image${data.restored !== 1 ? 's' : ''})`, 'undo');
      bus.emit(EVENTS.REFRESH);
    } else {
      showToast('Nothing to undo', 'error');
    }
  } catch {
    showToast('Undo failed', 'error');
  }
}

export function showToast(message, type = 'success') {
  if (!toastsEl) toastsEl = document.getElementById('toasts');
  if (!toastsEl) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  toastsEl.appendChild(toast);

  // Auto-dismiss
  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}
