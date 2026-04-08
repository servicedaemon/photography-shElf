// Shelf — main entry point

import { bus, EVENTS } from './events.js';
import { initGrid, setGridData, getImages } from './grid.js';
import { initLightbox } from './lightbox.js';
import { initSelection, deselectAll } from './selection.js';
import { initKeyboard } from './keyboard.js';
import { initFilters } from './filters.js';
import { initSidebar } from './sidebar.js';
import { initActions } from './actions.js';
import { initUndo, showToast } from './undo.js';
import { createElf } from './elf.js';
import { setThumbSize } from './theme.js';

// App state
let mode = 'idle'; // idle, loading, card
let source = '';

// Init all modules
document.addEventListener('DOMContentLoaded', () => {
  initGrid();
  initLightbox();
  initSelection();
  initKeyboard();
  initFilters();
  initSidebar();
  initActions();
  initUndo();

  renderHeader();
  showEmptyState();

  // Listen for actions
  bus.on('action:sort', handleSort);
  bus.on('action:convert', handleConvert);
  bus.on('action:open-editor', handleOpenEditor);
  bus.on(EVENTS.REFRESH, refresh);

  // Re-render header stats when marks change
  bus.on(EVENTS.IMAGE_MARKED, () => renderHeader());
  bus.on(EVENTS.BATCH_MARKED, () => renderHeader());
});

// --- Header ---

function renderHeader() {
  const header = document.getElementById('header');

  if (mode === 'idle' || mode === 'loading') {
    header.innerHTML = `
      <div class="elf-corner" id="header-elf"></div>
      <h1>Shelf</h1>
      <div class="header-spacer"></div>
      <button class="btn btn-primary" id="btn-scan-camera">Scan for Camera</button>
      <button class="btn btn-gold" id="btn-select-dir">Select Directory</button>
    `;
  } else if (mode === 'card') {
    const images = getImages();
    const keeps = images.filter((i) => (i.status || 'unmarked') === 'keep').length;
    const favs = images.filter((i) => (i.status || 'unmarked') === 'favorite').length;
    const rejects = images.filter((i) => (i.status || 'unmarked') === 'reject').length;
    const unsorted = images.length - keeps - favs - rejects;
    const hasMarks = keeps + favs + rejects > 0;

    header.innerHTML = `
      <div class="elf-corner" id="header-elf"></div>
      <h1>Shelf</h1>
      <span class="stat stat-keep">${keeps} keep</span>
      <span class="stat stat-favorite">${favs} fav</span>
      <span class="stat stat-reject">${rejects} reject</span>
      <span class="stat stat-unsorted">${unsorted} unsorted</span>
      <div class="header-spacer"></div>
      <div class="thumb-slider">
        <label>Size</label>
        <input type="range" min="150" max="500" value="280" id="thumb-slider">
      </div>
      ${hasMarks ? '<button class="btn btn-muted" id="btn-deselect-all">Deselect All</button>' : ''}
      <button class="btn btn-primary" id="btn-sort">Sort to Folders</button>
      <button class="btn btn-muted" id="btn-open-editor">Edit Favorites in Lightroom</button>
      <button class="btn btn-muted" id="btn-scan-camera">Scan for Camera</button>
      <button class="btn btn-gold" id="btn-select-dir">Select Directory</button>
    `;
  }

  // Tiny peeking elf in header
  const elfContainer = document.getElementById('header-elf');
  if (elfContainer) {
    createElf(elfContainer, 'peeking', 3);
  }

  // Bind buttons
  bindHeaderButtons();

  // Thumb slider
  const slider = document.getElementById('thumb-slider');
  if (slider) {
    slider.addEventListener('input', (e) => {
      setThumbSize(parseInt(e.target.value));
    });
  }
}

function bindHeaderButtons() {
  document.getElementById('btn-scan-camera')?.addEventListener('click', scanForCamera);
  document.getElementById('btn-select-dir')?.addEventListener('click', selectDirectory);
  document.getElementById('btn-sort')?.addEventListener('click', handleSort);
  document.getElementById('btn-open-editor')?.addEventListener('click', handleOpenEditor);
  document.getElementById('btn-deselect-all')?.addEventListener('click', async () => {
    await deselectAll();
    renderHeader();
  });
}

// --- Empty state ---

function showEmptyState() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('app-empty');
  grid.innerHTML = '';
  grid.style.display = 'none';
  empty.classList.add('visible');

  empty.innerHTML = `
    <div id="empty-elf"></div>
    <h2>Welcome to Shelf</h2>
    <p>Scan for a connected camera card, or select a directory of shoots.</p>
    <div class="empty-actions">
      <button class="btn btn-primary" id="empty-scan-camera">Scan for Camera</button>
      <button class="btn btn-gold" id="empty-select-dir">Select Directory</button>
    </div>
  `;

  createElf(document.getElementById('empty-elf'), 'idle', 8);

  document.getElementById('empty-scan-camera')?.addEventListener('click', scanForCamera);
  document.getElementById('empty-select-dir')?.addEventListener('click', selectDirectory);
}

function hideEmptyState() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('app-empty');
  grid.style.display = '';
  empty.classList.remove('visible');
}

// --- Scan for camera ---

async function scanForCamera() {
  try {
    const res = await fetch('/api/drives');
    const drives = await res.json();

    if (drives.length === 0) {
      showToast('No camera cards detected. Is one mounted?', 'error');
      return;
    }

    if (drives.length === 1 && drives[0].imageDirs.length === 1) {
      await loadSource(drives[0].imageDirs[0]);
      return;
    }

    // Multiple drives/dirs — show picker
    showDrivePicker(drives);
  } catch (e) {
    showToast('Failed to detect drives: ' + e.message, 'error');
  }
}

// --- Select directory (native OS picker → shoot list) ---

async function selectDirectory() {
  try {
    const res = await fetch('/api/pick-folder', { method: 'POST' });
    const data = await res.json();

    if (!data.path) return; // User cancelled

    // Ask server what's in this directory
    const listRes = await fetch(`/api/list-dir?path=${encodeURIComponent(data.path)}`);
    const listing = await listRes.json();

    const hasContent =
      listing.rootImageCount > 0 ||
      listing.shoots.length > 0 ||
      listing.otherFolders.length > 0;

    if (!hasContent) {
      showToast('No images or shoots found in that directory', 'error');
      return;
    }

    // If just images at root, no shoots or subfolders, load directly
    if (listing.shoots.length === 0 && listing.otherFolders.length === 0 && listing.rootImageCount > 0) {
      await loadSource(listing.path);
      return;
    }

    showShootPicker(listing);
  } catch (e) {
    showToast('Failed to open folder picker: ' + e.message, 'error');
  }
}

function showShootPicker(listing) {
  const overlay = document.getElementById('modal-overlay');
  const dirName = listing.path.split('/').pop() || listing.path;

  let html = `<div class="modal"><h2>${dirName}</h2>`;

  // Shoots
  if (listing.shoots.length > 0) {
    for (const shoot of listing.shoots) {
      const folders = shoot.folders || {};
      const dateLabel = shoot.date ? ` <span class="shoot-date">${shoot.date}</span>` : '';

      html += `<div class="shoot-group">`;
      html += `<div class="shoot-name">${shoot.name}${dateLabel}</div>`;
      html += `<div class="shoot-folders">`;

      const order = ['keeps', 'rejects', 'unsorted', 'edited', 'favorites'];
      for (const key of order) {
        if (!folders[key] || folders[key].count === 0) continue;
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        html += `<button class="folder-btn shoot-folder-btn" data-dir="${folders[key].path}">`;
        html += `${label} <span style="color:var(--text-muted)">${folders[key].count}</span>`;
        html += `</button>`;
      }

      // Loose images at shoot root
      if (shoot.rootCount > 0) {
        html += `<button class="folder-btn shoot-folder-btn" data-dir="${shoot.path}">`;
        html += `All <span style="color:var(--text-muted)">${shoot.rootCount}</span>`;
        html += `</button>`;
      }

      html += `</div></div>`;
    }
  }

  // Other folders with images
  if (listing.otherFolders.length > 0) {
    if (listing.shoots.length > 0) {
      html += `<div class="shoot-name" style="margin-top:12px">Other Folders</div>`;
    }
    for (const folder of listing.otherFolders) {
      html += `<button class="folder-btn" data-dir="${folder.path}">`;
      html += `${folder.name} <span style="float:right;color:var(--text-muted)">${folder.imageCount}</span>`;
      html += `</button>`;
    }
  }

  // Root images
  if (listing.rootImageCount > 0) {
    html += `<button class="folder-btn" data-dir="${listing.path}" style="margin-top:8px">`;
    html += `Loose images <span style="float:right;color:var(--text-muted)">${listing.rootImageCount}</span>`;
    html += `</button>`;
  }

  html += '<div class="modal-buttons"><button class="btn btn-muted" id="modal-cancel">Cancel</button></div></div>';
  overlay.innerHTML = html;
  overlay.classList.add('active');

  overlay.querySelectorAll('[data-dir]').forEach((btn) => {
    btn.addEventListener('click', () => {
      overlay.classList.remove('active');
      loadSource(btn.dataset.dir);
    });
  });

  document.getElementById('modal-cancel')?.addEventListener('click', () => {
    overlay.classList.remove('active');
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
}

function showDrivePicker(drives) {
  const overlay = document.getElementById('modal-overlay');
  let html = '<div class="modal"><h2>Select Camera Source</h2>';

  for (const drive of drives) {
    for (const dir of drive.imageDirs) {
      const dirName = dir.split('/').pop();
      html += `<button class="folder-btn" data-dir="${dir}">${drive.name} / ${dirName}</button>`;
    }
  }

  html += '<div class="modal-buttons"><button class="btn btn-muted" id="modal-cancel">Cancel</button></div></div>';
  overlay.innerHTML = html;
  overlay.classList.add('active');

  overlay.querySelectorAll('.folder-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      overlay.classList.remove('active');
      loadSource(btn.dataset.dir);
    });
  });

  document.getElementById('modal-cancel')?.addEventListener('click', () => {
    overlay.classList.remove('active');
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
}

async function loadSource(dir) {
  mode = 'loading';
  source = dir;
  renderHeader();
  hideEmptyState();

  // Show loading elf
  const grid = document.getElementById('grid');
  grid.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px;gap:16px;grid-column:1/-1"><div id="loading-elf"></div><p style="color:var(--tan)">Loading images...</p></div>';
  createElf(document.getElementById('loading-elf'), 'scribbling', 6);

  try {
    const res = await fetch(`/api/images?source=${encodeURIComponent(dir)}`);
    const images = await res.json();

    mode = 'card';
    bus.emit(EVENTS.MODE_CHANGED, { newMode: 'card', newSource: source, newFolder: '' });
    setGridData(images, source, '', 'card');
    renderHeader();

    if (images.length === 0) {
      showToast('No images found in that directory', 'error');
      showEmptyState();
      mode = 'idle';
      renderHeader();
    }
  } catch (e) {
    showToast('Failed to load images: ' + e.message, 'error');
    mode = 'idle';
    renderHeader();
    showEmptyState();
  }
}

// --- Sort ---

async function handleSort() {
  const images = getImages();
  const keeps = images.filter((i) => (i.status || 'unmarked') === 'keep').length;
  const favs = images.filter((i) => (i.status || 'unmarked') === 'favorite').length;
  const rejects = images.filter((i) => (i.status || 'unmarked') === 'reject').length;
  const unsorted = images.length - keeps - favs - rejects;

  // Name input modal
  const name = await showInputModal(
    'Sort to Folders',
    `This will move all ${images.length} images off the source:\n${keeps} keeps, ${favs} favorites, ${rejects} rejects, ${unsorted} unsorted`,
    'Photoshoot name',
  );
  if (!name) return;

  // Confirmation
  const confirmed = await showConfirmModal(
    'Confirm Sort',
    `Move ${images.length} images to ~/Pictures/sorted/?\n\n${keeps} keeps\n${favs} favorites\n${rejects} rejects\n${unsorted} unsorted\n\nFolder prefix: "${name}"`,
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/sort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, source }),
    });
    const data = await res.json();

    // Show sparkle elf
    const m = data.moved;
    showToast(
      `Sorted! ${m.keep} keeps, ${m.favorite} favs, ${m.reject} rejects, ${m.unsorted} unsorted`,
      'success',
    );

    if (data.errors) {
      showToast(`${data.errors.length} files had errors`, 'error');
    }

    mode = 'idle';
    source = '';
    renderHeader();
    showEmptyState();
  } catch (e) {
    showToast('Sort failed: ' + e.message, 'error');
  }
}

async function handleConvert() {
  // Ask about originals
  const keepOriginals = await showChoiceModal(
    'Convert to DNG',
    'Convert all raw files in this folder to DNG format for Lightroom/Photoshop editing.\n\nKeep original files?',
    'Keep Originals',
    'Remove After Converting',
  );

  if (keepOriginals === null) return; // cancelled

  // Show progress modal
  const overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = `
    <div class="modal">
      <h2>Converting to DNG...</h2>
      <p>This may take a moment. Please wait.</p>
    </div>
  `;
  overlay.classList.add('active');

  try {
    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, keepOriginals }),
    });
    const data = await res.json();

    overlay.classList.remove('active');

    if (!res.ok) {
      if (res.status === 501) {
        showToast('dnglab is not installed. Run: cargo install dnglab', 'error');
      } else {
        showToast(data.error || 'Conversion failed', 'error');
      }
      return;
    }

    const parts = [];
    if (data.converted) parts.push(`${data.converted} converted`);
    if (data.skipped) parts.push(`${data.skipped} skipped`);
    if (data.errors.length) parts.push(`${data.errors.length} errors`);
    showToast(`DNG conversion done: ${parts.join(', ')}`, data.errors.length ? 'error' : 'success');

    // Refresh to show new DNG files
    bus.emit(EVENTS.REFRESH);
    bus.emit(EVENTS.CONVERT_COMPLETE);
  } catch (e) {
    overlay.classList.remove('active');
    showToast('Conversion failed: ' + e.message, 'error');
  }
}

async function handleOpenEditor() {
  // Determine the Favorites folder path
  const favoritesPath = source.endsWith('/Favorites')
    ? source
    : source + '/Favorites';

  try {
    const res = await fetch('/api/open-in-lightroom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: favoritesPath }),
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to open Lightroom', 'error');
      return;
    }

    showToast('Opening Favorites in Lightroom...', 'success');
  } catch (e) {
    showToast('Failed to open Lightroom: ' + e.message, 'error');
  }
}

// --- Refresh (after undo) ---

async function refresh() {
  if (mode === 'card' && source) {
    const res = await fetch(`/api/images?source=${encodeURIComponent(source)}`);
    const images = await res.json();
    setGridData(images, source, '', 'card');
    renderHeader();
  }
}

// --- Styled modals ---

function showInputModal(title, message, placeholder) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `
      <div class="modal">
        <h2>${title}</h2>
        <p>${message.replace(/\n/g, '<br>')}</p>
        <input class="modal-input" id="modal-input" placeholder="${placeholder}" autofocus>
        <div class="modal-buttons">
          <button class="btn btn-muted" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-confirm">Continue</button>
        </div>
      </div>
    `;
    overlay.classList.add('active');

    const input = document.getElementById('modal-input');
    input.focus();

    const close = (value) => {
      overlay.classList.remove('active');
      resolve(value);
    };

    document.getElementById('modal-confirm').addEventListener('click', () => close(input.value.trim() || null));
    document.getElementById('modal-cancel').addEventListener('click', () => close(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value.trim() || null);
      if (e.key === 'Escape') close(null);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
  });
}

function showConfirmModal(title, message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `
      <div class="modal">
        <h2>${title}</h2>
        <p>${message.replace(/\n/g, '<br>')}</p>
        <div class="modal-buttons">
          <button class="btn btn-muted" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-confirm">Confirm</button>
        </div>
      </div>
    `;
    overlay.classList.add('active');

    const close = (value) => {
      overlay.classList.remove('active');
      resolve(value);
    };

    document.getElementById('modal-confirm').addEventListener('click', () => close(true));
    document.getElementById('modal-cancel').addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });

    // Keyboard
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Enter') { close(true); document.removeEventListener('keydown', handler); }
      if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', handler); }
    });
  });
}

function showChoiceModal(title, message, optionA, optionB) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `
      <div class="modal">
        <h2>${title}</h2>
        <p>${message.replace(/\n/g, '<br>')}</p>
        <div class="modal-buttons">
          <button class="btn btn-muted" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-option-a">${optionA}</button>
          <button class="btn btn-gold" id="modal-option-b">${optionB}</button>
        </div>
      </div>
    `;
    overlay.classList.add('active');

    const close = (value) => {
      overlay.classList.remove('active');
      resolve(value);
    };

    document.getElementById('modal-option-a').addEventListener('click', () => close(true));
    document.getElementById('modal-option-b').addEventListener('click', () => close(false));
    document.getElementById('modal-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') { close(null); document.removeEventListener('keydown', handler); }
    });
  });
}
