// Floating batch action bar — buttons appear based on what's actually
// possible right now (marks present, convertible files, favorites folder
// exists). Pre-v1.4.1 this gated on detected workflow stage, which
// turned out to be prescriptive once users knew the flow.

import { bus, EVENTS } from './events.js';
import { getImages } from './grid.js';
import { getSelectionRange, clearSelection } from './selection.js';

let actionsEl = null;
let hasConvertible = false;
let hasFavoritesFolder = false;
let currentSource = '';

export function initActions() {
  actionsEl = document.getElementById('actions');

  bus.on(EVENTS.STATE_CHANGED, updateActions);
  bus.on(EVENTS.IMAGE_MARKED, updateActions);
  bus.on(EVENTS.BATCH_MARKED, updateActions);
  bus.on(EVENTS.SELECTION_CHANGED, updateActions);
  bus.on(EVENTS.MODE_CHANGED, ({ newSource }) => {
    currentSource = newSource || '';
    checkConvertible();
    checkFavoritesFolder();
  });
  bus.on(EVENTS.CONVERT_COMPLETE, () => {
    checkConvertible();
    checkFavoritesFolder();
  });
  bus.on(EVENTS.REFRESH, () => {
    checkConvertible();
    checkFavoritesFolder();
  });
}

async function checkConvertible() {
  if (!currentSource) {
    hasConvertible = false;
    updateActions();
    return;
  }
  try {
    const res = await fetch(`/api/has-convertible?source=${encodeURIComponent(currentSource)}`);
    const data = await res.json();
    hasConvertible = data.hasConvertible;
  } catch {
    hasConvertible = false;
  }
  updateActions();
}

async function checkFavoritesFolder() {
  if (!currentSource) {
    hasFavoritesFolder = false;
    return;
  }
  // Use the server's shoot-context to find the actual favorites sibling
  // path (the server normalizes "Favorites ", "favorite", "favs" all to
  // the canonical 'favorites' role). Constructing `source + '/Favorites'`
  // client-side would miss any non-canonical on-disk spelling.
  try {
    const res = await fetch(`/api/shoot-context?source=${encodeURIComponent(currentSource)}`);
    if (!res.ok) {
      hasFavoritesFolder = false;
      updateActions();
      return;
    }
    const ctx = await res.json();
    hasFavoritesFolder = !!(
      ctx.insideShoot &&
      ctx.siblings?.favorites &&
      ctx.siblings.favorites.count > 0
    );
  } catch {
    hasFavoritesFolder = false;
    updateActions();
    return;
  }
  updateActions();
}

function countMarks(images) {
  let keeps = 0,
    favs = 0,
    rejects = 0;
  for (const i of images) {
    const s = i.status || 'unmarked';
    if (s === 'keep') keeps++;
    else if (s === 'favorite') favs++;
    else if (s === 'reject') rejects++;
  }
  return { keeps, favs, rejects, total: keeps + favs + rejects };
}

// Show actions based on the PRESENT state of this folder, not on a
// detected workflow stage. Pre-1.4.1 the action bar gated each button
// behind CULL/PICKS/FINAL \u2014 that worked when stages were teaching
// scaffolding but became prescriptive once users knew the flow. The
// welcome screen still teaches the workflow; the action bar just
// surfaces whatever's actionable right now.
function updateActions() {
  if (!actionsEl) return;
  const images = getImages();
  const { keeps, favs, rejects, total } = countMarks(images);

  const selRange = getSelectionRange();
  const selCount = selRange ? selRange.end - selRange.start + 1 : 0;

  const buttons = [];
  let countHtml = '';

  if (selCount > 0) {
    countHtml = `<span class="action-count">${selCount} selected</span>`;
    buttons.push(
      `<button class="btn btn-primary" id="action-move-to-shoot">Move to Shoot\u2026</button>`,
    );
    buttons.push(`<button class="btn btn-muted" id="action-clear-selection">Clear</button>`);
  } else {
    // Sort to Folders \u2014 any marks to route. Works equally well from a
    // card, an unsorted folder, or a keeps folder mid-cull.
    if (total > 0) {
      buttons.push(`<button class="btn btn-primary" id="action-sort">Sort to Folders</button>`);
    }
    // (Promote to Favorites button retired in v1.4.1 \u2014 Sort already
    // handles favorite-mark routing identically. The Promote endpoint
    // and its sibling .favorites-state.json system were duplicating
    // the per-source mark state with no behavioural difference.)
    // Convert to DNG \u2014 only if there are unconverted raws in the
    // current folder. The check is server-driven; it doesn't care
    // about workflow stage.
    if (hasConvertible) {
      buttons.push(`<button class="btn btn-gold" id="action-convert">Convert to DNG</button>`);
    }
    // Edit in Lightroom \u2014 opens the Favorites folder for the current
    // shoot. Available whenever a Favorites sibling exists, regardless
    // of which sub-folder is currently being viewed.
    if (hasFavoritesFolder) {
      buttons.push(
        `<button class="btn btn-muted" id="action-open-editor">Edit Favorites in Lightroom</button>`,
      );
    }
    if (total > 0) {
      const parts = [];
      if (keeps) parts.push(`${keeps} keep`);
      if (favs) parts.push(`${favs} fav`);
      if (rejects) parts.push(`${rejects} reject`);
      countHtml = `<span class="action-count">${parts.join(', ')}</span>`;
    }
  }

  if (buttons.length === 0) {
    actionsEl.classList.remove('visible');
    actionsEl.innerHTML = '';
    return;
  }

  actionsEl.classList.add('visible');
  actionsEl.innerHTML = countHtml + buttons.join('');

  document
    .getElementById('action-move-to-shoot')
    ?.addEventListener('click', () => bus.emit('action:move-to-shoot'));
  document
    .getElementById('action-clear-selection')
    ?.addEventListener('click', () => clearSelection());
  document.getElementById('action-sort')?.addEventListener('click', () => bus.emit('action:sort'));
  document
    .getElementById('action-convert')
    ?.addEventListener('click', () => bus.emit('action:convert'));
  document
    .getElementById('action-open-editor')
    ?.addEventListener('click', () => bus.emit('action:open-editor'));
}
