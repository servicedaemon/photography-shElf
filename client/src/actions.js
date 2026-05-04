// Floating batch action bar — stage-aware

import { bus, EVENTS } from './events.js';
import { getImages } from './grid.js';
import { getStage } from './stage.js';
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
  bus.on(EVENTS.STAGE_CHANGED, updateActions);
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

function updateActions() {
  if (!actionsEl) return;
  const images = getImages();
  const { keeps, favs, rejects, total } = countMarks(images);
  const stage = getStage();

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
    if (stage === 'CULL' && total > 0) {
      buttons.push(`<button class="btn btn-primary" id="action-sort">Sort to Folders</button>`);
    }
    if (stage === 'PICKS' && favs > 0) {
      buttons.push(
        `<button class="btn btn-primary" id="action-promote">Promote ${favs} to Favorites</button>`,
      );
    }
    if (stage === 'FINAL' && hasConvertible) {
      buttons.push(`<button class="btn btn-gold" id="action-convert">Convert to DNG</button>`);
    }
    if (stage === 'FINAL' && hasFavoritesFolder) {
      buttons.push(
        `<button class="btn btn-muted" id="action-open-editor">Edit in Lightroom</button>`,
      );
    }
    if (stage === 'PICKS' && hasFavoritesFolder) {
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
    .getElementById('action-promote')
    ?.addEventListener('click', () => bus.emit('action:promote-favorites'));
  document
    .getElementById('action-convert')
    ?.addEventListener('click', () => bus.emit('action:convert'));
  document
    .getElementById('action-open-editor')
    ?.addEventListener('click', () => bus.emit('action:open-editor'));
}
