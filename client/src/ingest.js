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

// Strip a known shoot sub-folder name (keeps, rejects, etc.) from the basename.
// Mirrors the server-side `normalizeSubfolderRole` matcher: trims whitespace,
// case-insensitive, accepts singular/plural variants. Older versions of Shelf
// pushed sub-folder paths into the recent-shoots list, AND hand-renamed shoots
// from the wild may have folders like "Favorites " (trailing space) — both
// need normalizing so the welcome screen doesn't show duplicate entries.
const SHOOT_SUB_ALIASES = new Set([
  'unsorted',
  'unmarked',
  'keep',
  'keeps',
  'reject',
  'rejects',
  'favorite',
  'favorites',
  'fav',
  'favs',
  'edit',
  'edits',
  'edited',
]);
function normalizeShootPath(p) {
  if (!p) return p;
  const trimmed = p.replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/);
  const base = parts[parts.length - 1].toLowerCase().trim();
  if (SHOOT_SUB_ALIASES.has(base)) {
    parts.pop();
    return parts.join('/') || trimmed;
  }
  return trimmed;
}

export async function getRecentShoots() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    const raw = Array.isArray(cfg.recentShoots) ? cfg.recentShoots : [];
    // Normalize + dedupe in case older entries leaked sub-folder paths.
    // Returns shoot ROOTS only — deduped, original order preserved.
    const seen = new Set();
    const out = [];
    for (const p of raw) {
      const norm = normalizeShootPath(p);
      if (!seen.has(norm)) {
        seen.add(norm);
        out.push(norm);
      }
    }
    return out;
  } catch {
    return [];
  }
}
