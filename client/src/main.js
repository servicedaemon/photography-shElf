// Shelf — main entry point

import { bus, EVENTS } from './events.js';
import { initGrid, setGridData, getImages } from './grid.js';
import { initLightbox } from './lightbox.js';
import { initSelection, deselectAll, getSelectedFilenames, clearSelection } from './selection.js';
import { initKeyboard } from './keyboard.js';
import { initFilters } from './filters.js';
import { initSidebar } from './sidebar.js';
import { initActions } from './actions.js';
import { initUndo, showToast } from './undo.js';
import { initStage, getStage } from './stage.js';
import { createElf } from './elf.js';
import { setThumbSize } from './theme.js';
import { initMarkQueue } from './mark-queue.js';
import { initIngest, pushRecentShoot, getRecentShoots } from './ingest.js';
import { initHints } from './hints.js';

// App state
let mode = 'idle'; // idle, loading, card
let source = '';
let headerElfHandle = null;
let elfResetTimer = null;

// Briefly switch the header elf's pose, then return to its baseline.
function flashElfPose(pose, duration = 1400, baseline = 'peeking') {
  if (!headerElfHandle) return;
  headerElfHandle.setPose(pose);
  if (elfResetTimer) clearTimeout(elfResetTimer);
  elfResetTimer = setTimeout(() => {
    headerElfHandle?.setPose(baseline);
  }, duration);
}

// Init all modules
document.addEventListener('DOMContentLoaded', () => {
  initGrid();
  initLightbox();
  initSelection();
  initMarkQueue();
  initKeyboard();
  initFilters();
  initSidebar();
  initActions();
  initUndo();
  initStage();
  initHints();

  initIngest((folderPath) => {
    loadSource(folderPath);
  });

  renderHeader();
  showEmptyState();

  // Listen for actions
  bus.on('action:sort', handleSort);
  bus.on('action:convert', handleConvert);
  bus.on('action:open-editor', handleOpenEditor);
  bus.on('action:promote-favorites', handlePromoteFavorites);
  bus.on('action:move-to-shoot', handleMoveToShoot);
  bus.on(EVENTS.REFRESH, refresh);

  // Re-render header stats when marks change
  bus.on(EVENTS.IMAGE_MARKED, ({ status }) => {
    renderHeader();
    // Reactive header elf: favorite sparks joy, reject a confused moment
    if (status === 'favorite') flashElfPose('sparkle', 900);
    else if (status === 'reject') flashElfPose('confused', 700);
  });
  bus.on(EVENTS.BATCH_MARKED, ({ status }) => {
    renderHeader();
    if (status === 'favorite') flashElfPose('sparkle', 1100);
  });
  bus.on(EVENTS.STAGE_CHANGED, () => renderHeader());

  // Electron menu → renderer bridge for "Open Folder" / "Open Recent"
  window.addEventListener('shelf:load-folder', (e) => {
    if (e.detail && e.detail.path) loadSource(e.detail.path);
  });
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
    let keeps = 0, favs = 0, rejects = 0;
    for (const i of images) {
      const s = i.status || 'unmarked';
      if (s === 'keep') keeps++;
      else if (s === 'favorite') favs++;
      else if (s === 'reject') rejects++;
    }
    const total = keeps + favs + rejects;
    const unsorted = images.length - total;
    const hasMarks = total > 0;
    const stage = getStage();

    header.innerHTML = `
      <div class="elf-corner" id="header-elf"></div>
      <h1>Shelf</h1>
      <span class="stage-pill stage-${stage.toLowerCase()}">${stage}</span>
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
      <button class="btn btn-muted" id="btn-exit-shoot" title="Close this shoot and return to the welcome screen">Exit Shoot</button>
      <button class="btn btn-muted" id="btn-scan-camera">Scan Card</button>
      <button class="btn btn-gold" id="btn-select-dir">New Shoot</button>
    `;
  }

  // Tiny reactive elf in header — reacts to events during the cull
  const elfContainer = document.getElementById('header-elf');
  if (elfContainer) {
    headerElfHandle = createElf(elfContainer, 'peeking', 3);
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
  document.getElementById('btn-deselect-all')?.addEventListener('click', async () => {
    await deselectAll();
    renderHeader();
  });
  document.getElementById('btn-exit-shoot')?.addEventListener('click', exitShoot);
}

function exitShoot() {
  mode = 'idle';
  source = '';
  bus.emit(EVENTS.MODE_CHANGED, { newMode: 'idle', newSource: '', newFolder: '', stage: 'CULL' });
  renderHeader();
  showEmptyState();
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
    <p>Scan a camera card, pick a folder, or drop one in.</p>
    <div class="empty-actions">
      <button class="btn btn-primary" id="empty-scan-camera">Scan Card</button>
      <button class="btn btn-gold" id="empty-select-dir">New Shoot</button>
    </div>
    <div id="recent-shoots"></div>
  `;

  createElf(document.getElementById('empty-elf'), 'idle', 8);

  getRecentShoots().then(list => {
    const el = document.getElementById('recent-shoots');
    if (!el || list.length === 0) return;
    el.innerHTML = `
      <h3 style="margin-top:32px;color:var(--tan);font-size:14px">Recent shoots</h3>
      ${list.map(p => `
        <button class="folder-btn recent-btn" data-path="${p}" style="max-width:600px;margin:4px auto;display:block;text-align:left">
          ${p.split('/').slice(-2).join('/')}
        </button>
      `).join('')}
    `;
    el.querySelectorAll('.recent-btn').forEach(btn => {
      btn.addEventListener('click', () => loadSource(btn.dataset.path));
    });
  });

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
    let data;
    if (window.shelf && window.shelf.pickFolder) {
      data = await window.shelf.pickFolder();
    } else {
      const res = await fetch('/api/pick-folder', { method: 'POST' });
      data = await res.json();
    }

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

    // Smart auto-load: if only one obvious destination, skip the picker
    const shoots = listing.shoots || [];
    const other = listing.otherFolders || [];

    // Case 1: just loose images at root
    if (shoots.length === 0 && other.length === 0 && listing.rootImageCount > 0) {
      await loadSource(listing.path);
      return;
    }

    // Case 2: single shoot with a single non-empty subfolder
    if (shoots.length === 1 && other.length === 0 && listing.rootImageCount === 0) {
      const shoot = shoots[0];
      const nonEmptyFolders = Object.entries(shoot.folders || {})
        .filter(([, f]) => f.count > 0);
      if (nonEmptyFolders.length === 1) {
        await loadSource(nonEmptyFolders[0][1].path);
        return;
      }
    }

    // Case 3: single plain folder with images
    if (shoots.length === 0 && other.length === 1) {
      await loadSource(other[0].path);
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
    const data = await res.json();
    const images = Array.isArray(data) ? data : data.images;
    const stage = Array.isArray(data) ? 'CULL' : data.stage;

    mode = 'card';
    bus.emit(EVENTS.MODE_CHANGED, { newMode: 'card', newSource: source, newFolder: '', stage });
    setGridData(images, source, '', 'card');
    renderHeader();
    pushRecentShoot(source).catch(() => {});

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

    if (data.errors) {
      showToast(`${data.errors.length} files had errors`, 'error');
    }

    // Compute the keeps folder path to enable "Pick Heroes" bridge button
    const now = new Date();
    const dateStr = String(now.getMonth() + 1).padStart(2, '0') + '-' + now.getFullYear();
    const safeName = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    const sortDir = config.sortDir || '';
    const keepsPath = sortDir ? `${sortDir}/Keeps - ${dateStr} - ${safeName}` : null;

    showSortBridge(data.moved, keepsPath);
    if (window.shelf && window.shelf.showNotification) {
      const total = Object.values(data.moved).reduce((a, b) => a + b, 0);
      window.shelf.showNotification('Sort complete', `Sorted ${total} images`);
    }
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

  // Show progress modal with an active elf (built via DOM methods, no innerHTML)
  const overlay = document.getElementById('modal-overlay');
  while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  const mDiv = document.createElement('div');
  mDiv.className = 'modal modal-narrow';
  mDiv.style.textAlign = 'center';
  const elfHost = document.createElement('div');
  elfHost.id = 'convert-elf';
  elfHost.style.cssText = 'display:flex;justify-content:center;margin-bottom:14px';
  const h2 = document.createElement('h2');
  h2.textContent = 'Converting to DNG';
  const p = document.createElement('p');
  p.textContent = 'Wrapping your raws for Lightroom. One moment.';
  mDiv.append(elfHost, h2, p);
  overlay.appendChild(mDiv);
  overlay.classList.add('active');
  createElf(elfHost, 'scribbling', 6);

  try {
    if (window.shelf && window.shelf.setProgress) window.shelf.setProgress(2);
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
    if (window.shelf && window.shelf.setProgress) window.shelf.setProgress(-1);
    if (window.shelf && window.shelf.showNotification) {
      window.shelf.showNotification('DNG conversion complete', `Converted ${data.converted} images`);
    }

    // Refresh to show new DNG files
    bus.emit(EVENTS.REFRESH);
    bus.emit(EVENTS.CONVERT_COMPLETE);
  } catch (e) {
    overlay.classList.remove('active');
    if (window.shelf && window.shelf.setProgress) window.shelf.setProgress(-1);
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

async function handlePromoteFavorites() {
  const images = getImages();
  const favs = images.filter(i => (i.status || 'unmarked') === 'favorite');

  if (favs.length === 0) {
    showToast('No favorites marked', 'error');
    return;
  }

  const confirmed = await showConfirmModal(
    'Promote Favorites',
    `Move ${favs.length} favorite image${favs.length !== 1 ? 's' : ''} into the Favorites subfolder?`,
  );
  if (!confirmed) return;

  // The current source is a Keeps folder; extract folder name for the API
  const folderName = source.split('/').pop();

  try {
    // First, persist favorites to the .favorites-state.json file (parallel)
    await Promise.all(favs.map(img =>
      fetch(`/api/folder/${encodeURIComponent(folderName)}/mark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: img.filename, status: 'favorite' }),
      })
    ));

    // Then trigger the save-favorites move
    const res = await fetch(`/api/folder/${encodeURIComponent(folderName)}/save-favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();

    showToast(`Promoted ${data.moved} image${data.moved !== 1 ? 's' : ''} to Favorites`, 'success');
    if (window.shelf && window.shelf.showNotification) {
      window.shelf.showNotification('Promoted to Favorites', `Moved ${data.moved} heroes`);
    }

    // Show bridge card
    showPromoteBridge(data.moved, folderName);
  } catch (e) {
    showToast('Promote failed: ' + e.message, 'error');
  }
}

async function handleMoveToShoot() {
  const filenames = getSelectedFilenames();
  if (filenames.length === 0) {
    showToast('Nothing selected', 'error');
    return;
  }

  // Fetch sibling shoots
  let siblings = [];
  try {
    const res = await fetch(`/api/sibling-shoots?source=${encodeURIComponent(source)}`);
    if (res.ok) {
      const data = await res.json();
      siblings = data.siblings || [];
    }
  } catch {
    // proceed with empty list
  }

  const dest = await showMoveToShootModal(filenames.length, siblings);
  if (!dest) return;

  try {
    const res = await fetch('/api/move-to-shoot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, filenames, dest }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Move failed', 'error');
      return;
    }
    showToast(`Moved ${data.moved} image${data.moved !== 1 ? 's' : ''} to ${dest.newShootName || dest.existingPath?.split('/').pop() || 'shoot'}`, 'success');
    if (data.errors && data.errors.length) {
      showToast(`${data.errors.length} files had errors`, 'error');
    }
    clearSelection();
    bus.emit(EVENTS.REFRESH);
  } catch (e) {
    showToast('Move failed: ' + e.message, 'error');
  }
}

function showMoveToShootModal(count, siblings) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const siblingList = siblings.map(s => `
      <button class="folder-btn sibling-btn" data-path="${s.path}">${s.name}</button>
    `).join('');

    overlay.innerHTML = `
      <div class="modal">
        <h2>Move ${count} to Shoot</h2>
        <p>Files will land in the destination\u2019s <code>unsorted/</code> folder.</p>
        ${siblings.length > 0 ? `
          <h3 style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--ink-dim);margin:14px 0 6px">Existing shoots</h3>
          ${siblingList}
        ` : ''}
        <h3 style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--ink-dim);margin:14px 0 6px">Or create new</h3>
        <input class="modal-input" id="move-newshoot" placeholder="New shoot name" autofocus>
        <div class="modal-buttons">
          <button class="btn btn-muted" id="move-cancel">Cancel</button>
          <button class="btn btn-primary" id="move-confirm-new">Create &amp; Move</button>
        </div>
      </div>
    `;
    overlay.classList.add('active');

    const close = (value) => {
      overlay.classList.remove('active');
      resolve(value);
    };

    overlay.querySelectorAll('.sibling-btn').forEach(btn => {
      btn.addEventListener('click', () => close({ existingPath: btn.dataset.path }));
    });
    document.getElementById('move-confirm-new').addEventListener('click', () => {
      const input = document.getElementById('move-newshoot');
      const name = input.value.trim();
      if (!name) return;
      close({ newShootName: name });
    });
    document.getElementById('move-cancel').addEventListener('click', () => close(null));

    const input = document.getElementById('move-newshoot');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) close({ newShootName: input.value.trim() });
      if (e.key === 'Escape') close(null);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
  });
}

function showSortBridge(moved, keepsPath) {
  const overlay = document.getElementById('modal-overlay');
  const total = Object.values(moved).reduce((a, b) => a + b, 0);
  const parts = [];
  if (moved.keep) parts.push(`${moved.keep} keeps`);
  if (moved.favorite) parts.push(`${moved.favorite} sparks`);
  if (moved.reject) parts.push(`${moved.reject} rejects`);
  if (moved.unsorted) parts.push(`${moved.unsorted} unsorted`);

  overlay.innerHTML = `
    <div class="modal" style="text-align:center">
      <div class="bridge-elf-host" style="display:flex;justify-content:center;margin-bottom:14px"></div>
      <h2>Sorted ${total} images</h2>
      <p>${parts.join(' · ')}</p>
      <div class="modal-buttons">
        <button class="btn btn-muted" id="bridge-done">Done</button>
        <button class="btn btn-muted" id="bridge-new">Start New Shoot</button>
        ${keepsPath ? `<button class="btn btn-primary" id="bridge-heroes">Pick Heroes</button>` : ''}
      </div>
    </div>
  `;
  overlay.classList.add('active');
  const sortElf = overlay.querySelector('.bridge-elf-host');
  if (sortElf) createElf(sortElf, 'sparkle', 6);

  const close = () => overlay.classList.remove('active');

  document.getElementById('bridge-done').addEventListener('click', () => {
    close();
    mode = 'idle';
    source = '';
    renderHeader();
    showEmptyState();
  });
  document.getElementById('bridge-new').addEventListener('click', () => {
    close();
    mode = 'idle';
    source = '';
    renderHeader();
    showEmptyState();
    selectDirectory();
  });
  document.getElementById('bridge-heroes')?.addEventListener('click', () => {
    close();
    loadSource(keepsPath);
  });
}

function showPromoteBridge(count, folderName) {
  const overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = `
    <div class="modal" style="text-align:center">
      <div class="bridge-elf-host" style="display:flex;justify-content:center;margin-bottom:14px"></div>
      <h2>Promoted ${count} to Favorites</h2>
      <p>Your heroes are saved in the Favorites subfolder.</p>
      <div class="modal-buttons">
        <button class="btn btn-muted" id="bridge-done">Done</button>
        <button class="btn btn-muted" id="bridge-keep-reviewing">Keep Reviewing</button>
        <button class="btn btn-primary" id="bridge-open-favorites">Open Favorites</button>
      </div>
    </div>
  `;
  overlay.classList.add('active');
  const promoteElf = overlay.querySelector('.bridge-elf-host');
  if (promoteElf) createElf(promoteElf, 'waving', 6);

  const close = () => overlay.classList.remove('active');

  document.getElementById('bridge-done').addEventListener('click', () => {
    close();
    mode = 'idle';
    source = '';
    renderHeader();
    showEmptyState();
  });
  document.getElementById('bridge-keep-reviewing').addEventListener('click', () => {
    close();
    bus.emit(EVENTS.REFRESH);
  });
  document.getElementById('bridge-open-favorites').addEventListener('click', () => {
    close();
    loadSource(source + '/Favorites');
  });
}

// --- Refresh (after undo) ---

async function refresh() {
  if (mode === 'card' && source) {
    const res = await fetch(`/api/images?source=${encodeURIComponent(source)}`);
    const data = await res.json();
    const images = Array.isArray(data) ? data : data.images;
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
