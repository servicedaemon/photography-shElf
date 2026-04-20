// Unified ingest: drag-drop folders, smart auto-load, recent shoots

import { bus, EVENTS } from './events.js';

let onFolderDropped = null;

export function initIngest(handleFolderDropped) {
  onFolderDropped = handleFolderDropped;

  const app = document.body;

  app.addEventListener('dragover', (e) => {
    e.preventDefault();
    app.classList.add('drag-over');
  });

  app.addEventListener('dragleave', (e) => {
    // Only remove if we left the window entirely
    if (e.target === app || !app.contains(e.relatedTarget)) {
      app.classList.remove('drag-over');
    }
  });

  app.addEventListener('drop', async (e) => {
    e.preventDefault();
    app.classList.remove('drag-over');

    const items = Array.from(e.dataTransfer.items || []);
    for (const item of items) {
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry && entry.isDirectory) {
        // Get the absolute path from the file
        const file = item.getAsFile();
        if (file && file.path) {
          // Electron provides file.path; in browser we only have the name
          onFolderDropped(file.path);
          return;
        }
        // Fallback: ask user to use Select Directory (browser restriction)
        bus.emit(EVENTS.TOAST, {
          message: 'Drag-drop only works in the desktop app. Use "New Shoot" instead.',
          type: 'error',
        });
        return;
      }
    }
  });
}

export async function pushRecentShoot(p) {
  try {
    await fetch('/api/recent-shoots/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p }),
    });
  } catch {
    // non-fatal
  }
}

export async function getRecentShoots() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    return Array.isArray(cfg.recentShoots) ? cfg.recentShoots : [];
  } catch {
    return [];
  }
}
