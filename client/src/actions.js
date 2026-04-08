// Floating batch action bar

import { bus, EVENTS } from './events.js';
import { getImages } from './grid.js';

let actionsEl = null;
let hasConvertible = false;
let hasFavoritesFolder = false;
let currentSource = '';

export function initActions() {
  actionsEl = document.getElementById('actions');

  bus.on(EVENTS.STATE_CHANGED, () => updateActions());
  bus.on(EVENTS.IMAGE_MARKED, () => updateActions());
  bus.on(EVENTS.BATCH_MARKED, () => updateActions());
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
  // If we ARE in the Favorites folder, show the button
  if (currentSource.endsWith('/Favorites')) {
    hasFavoritesFolder = true;
    updateActions();
    return;
  }
  // Check if a Favorites subfolder exists by listing the directory
  const favPath = currentSource + '/Favorites';
  try {
    const res = await fetch(`/api/images?source=${encodeURIComponent(favPath)}`);
    hasFavoritesFolder = res.ok;
  } catch {
    hasFavoritesFolder = false;
  }
  updateActions();
}

function updateActions() {
  if (!actionsEl) return;
  const images = getImages();

  const keeps = images.filter((i) => (i.status || 'unmarked') === 'keep').length;
  const favs = images.filter((i) => (i.status || 'unmarked') === 'favorite').length;
  const rejects = images.filter((i) => (i.status || 'unmarked') === 'reject').length;
  const count = keeps + favs + rejects;

  const showBar = count > 0 || hasConvertible || hasFavoritesFolder;

  if (showBar) {
    actionsEl.classList.add('visible');
    let html = '';

    if (count > 0) {
      const parts = [];
      if (keeps) parts.push(`${keeps} keeps`);
      if (favs) parts.push(`${favs} favs`);
      if (rejects) parts.push(`${rejects} rejects`);
      html += `<span class="action-count">${parts.join(', ')}</span>`;
      html += `<button class="btn btn-primary" id="action-sort">Sort to Folders</button>`;
    }

    if (hasConvertible) {
      html += `<button class="btn btn-gold" id="action-convert">Convert to DNG</button>`;
    }

    if (hasFavoritesFolder) {
      html += `<button class="btn btn-muted" id="action-open-editor">Edit Favorites in Lightroom</button>`;
    }

    actionsEl.innerHTML = html;

    document.getElementById('action-sort')?.addEventListener('click', () => {
      bus.emit('action:sort');
    });
    document.getElementById('action-convert')?.addEventListener('click', () => {
      bus.emit('action:convert');
    });
    document.getElementById('action-open-editor')?.addEventListener('click', () => {
      bus.emit('action:open-editor');
    });
  } else {
    actionsEl.classList.remove('visible');
  }
}
