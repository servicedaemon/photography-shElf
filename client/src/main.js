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
import { initShootNav } from './shoot-nav.js';

// App state
let mode = 'idle'; // idle, loading, card
let source = '';
let headerElfHandle = null;
let elfResetTimer = null;

// Human-readable label for the stage pill's hover tooltip.
function stageTooltip(stage) {
  switch (stage) {
    case 'CULL':
      return 'CULL — first pass. Decide keep / favorite / reject on every photo. Press K, F, X, U to mark.';
    case 'HEROES':
      return 'HEROES — second pass. Pick the best shots from your keeps with F, then Promote to Favorites.';
    case 'FINAL':
      return 'FINAL — your favorite shots, ready for editing. Convert to DNG and open in Lightroom.';
    default:
      return stage;
  }
}

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
  initShootNav((folderPath) => loadSource(folderPath));

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
    // Reactive header elf: favorite → sparkle, reject → brief confused pose
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
    // Used only to gate the "Deselect All" button — the visible counts moved
    // to the action bar and the shoot-nav chip row.
    let total = 0;
    for (const i of images) {
      const s = i.status || 'unmarked';
      if (s === 'keep' || s === 'favorite' || s === 'reject') total++;
    }
    const hasMarks = total > 0;

    header.innerHTML = `
      <div class="elf-corner" id="header-elf"></div>
      <h1>Shelf</h1>
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
  // Dismiss any open modal so a stuck overlay can't leak through
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('active');
  // Clear grid state so stale data doesn't leak into the welcome screen
  // (spacebar would otherwise open the lightbox against a previous shoot).
  setGridData([], '', '', 'idle');
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

  getRecentShoots().then((list) => {
    const el = document.getElementById('recent-shoots');
    if (!el || list.length === 0) return;
    el.innerHTML = `
      <h3 style="margin-top:32px;color:var(--tan);font-size:14px">Recent shoots</h3>
      ${list
        .map(
          (p) => `
        <button class="folder-btn recent-btn" data-path="${p}" style="max-width:600px;margin:4px auto;display:block;text-align:left">
          ${p.split(/[/\\]/).slice(-2).join('/')}
        </button>
      `,
        )
        .join('')}
    `;
    el.querySelectorAll('.recent-btn').forEach((btn) => {
      btn.addEventListener('click', () => openRecentShoot(btn.dataset.path));
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

// Shown when a folder loaded successfully but contained zero images.
// Stays in 'card' mode so the header (Exit Shoot, stage pill) and the
// shoot folder navigator remain visible.
function showEmptyFolderState() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('app-empty');
  empty.classList.remove('visible');
  grid.style.display = '';
  grid.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'empty-folder-msg';
  const elfHost = document.createElement('div');
  elfHost.className = 'empty-folder-elf';
  msg.appendChild(elfHost);
  const h = document.createElement('h3');
  h.textContent = 'Nothing here yet';
  msg.appendChild(h);
  const p = document.createElement('p');
  p.textContent =
    'This folder has no image files. Use the shoot navigator above to jump to another folder, or Exit Shoot to start over.';
  msg.appendChild(p);
  grid.appendChild(msg);
  createElf(elfHost, 'sleeping', 6);
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
      listing.rootImageCount > 0 || listing.shoots.length > 0 || listing.otherFolders.length > 0;

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

    // Case 2: single shoot — bypass picker and load the shoot's best entry,
    // but only when that entry is a real path (not an empty shoot).
    if (shoots.length === 1 && other.length === 0 && listing.rootImageCount === 0) {
      const entry = bestShootEntry(shoots[0]);
      if (entry) {
        await loadSource(entry);
        return;
      }
      // Fall through to picker so the user can see the empty shoot and decide
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

// Open a recent shoot: use /api/list-dir on the parent to resolve the
// shoot's best populated sub-folder, so recents reliably land somewhere
// useful instead of a stale sub-folder path that may have been sorted away.
async function openRecentShoot(shootPath) {
  try {
    // Ask the server for the shoot's structure. list-dir walks a parent
    // and returns shoot groupings — use the shoot root's parent.
    const parent = shootPath.split(/[/\\]/).slice(0, -1).join('/');
    const res = await fetch(`/api/list-dir?path=${encodeURIComponent(parent)}`);
    if (!res.ok) {
      // Fall back to loading the shoot root directly (empty-folder state ok)
      await loadSource(shootPath);
      return;
    }
    const data = await res.json();
    // Find the matching shoot in the listing
    const match = (data.shoots || []).find(
      (s) => s.path === shootPath || s.name === shootPath.split(/[/\\]/).pop(),
    );
    if (match) {
      await loadSource(bestShootEntry(match));
    } else {
      await loadSource(shootPath);
    }
  } catch {
    await loadSource(shootPath);
  }
}

// Walk a shoot's sub-folders in workflow-priority order and pick the first
// one that has images. Used by the picker, smart auto-load, and recent-shoots
// click so the user lands on a populated folder instead of an empty root.
//
// Priority: unsorted first (so returning to an in-progress cull resumes
// where the work is), then keeps, then curated piles. Matches the workflow:
// you're usually coming back to keep culling, not to re-review keeps.
function bestShootEntry(shoot) {
  const folders = shoot.folders || {};
  const order = ['unsorted', 'keeps', 'favorites', 'edited', 'rejects'];
  for (const key of order) {
    if (folders[key] && folders[key].count > 0) return folders[key].path;
  }
  if (shoot.rootCount > 0 && shoot.path) return shoot.path;
  // Nothing populated — fall through to the shoot root itself when we have
  // it; else to any known sub-folder path (even if empty); else null which
  // callers will guard against.
  if (shoot.path) return shoot.path;
  const firstFolder = Object.values(folders).find((f) => f && f.path);
  return firstFolder ? firstFolder.path : null;
}

// Normalize a path to its shoot root: if the basename is a known shoot
// sub-folder (keeps, unsorted, etc.), strip it. Otherwise return as-is.
function shootRootOf(p) {
  if (!p) return p;
  const trimmed = p.replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/);
  const base = parts[parts.length - 1].toLowerCase();
  const SUBS = ['unsorted', 'keeps', 'rejects', 'favorites', 'edited'];
  if (SUBS.includes(base)) {
    parts.pop();
    return parts.join('/') || trimmed;
  }
  return trimmed;
}

function showShootPicker(listing) {
  const overlay = document.getElementById('modal-overlay');
  const dirName = listing.path.split(/[/\\]/).pop() || listing.path;

  let html = `<div class="modal"><h2>${dirName}</h2>`;

  // Shoots — one row per shoot, clicks to the shoot's best entry point.
  // Users navigate between sub-folders (unsorted/keeps/favorites/etc.) via
  // the in-app shoot folder navigator, so the picker surfaces the SHOOT,
  // not its individual sub-folders.
  if (listing.shoots.length > 0) {
    for (const shoot of listing.shoots) {
      const folders = shoot.folders || {};
      const dateLabel = shoot.date ? ` <span class="shoot-date">${shoot.date}</span>` : '';
      const targetPath = bestShootEntry(shoot);
      if (!targetPath) continue; // empty shoot with no known folder path — skip in picker

      // Tally a summary across sub-folders so the user sees the shoot's shape
      // without the picker visually exploding into five tiny chips.
      const parts = [];
      for (const key of ['unsorted', 'keeps', 'favorites', 'rejects', 'edited']) {
        if (folders[key] && folders[key].count > 0) {
          parts.push(`${folders[key].count} ${key}`);
        }
      }
      if (shoot.rootCount > 0) parts.push(`${shoot.rootCount} loose`);
      const summary = parts.length ? parts.join(' · ') : 'empty';

      html += `<button class="folder-btn shoot-picker-btn" data-dir="${targetPath}">`;
      html += `<span class="shoot-picker-name">${shoot.name}${dateLabel}</span>`;
      html += `<span class="shoot-picker-summary">${summary}</span>`;
      html += `</button>`;
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

  html +=
    '<div class="modal-buttons"><button class="btn btn-muted" id="modal-cancel">Cancel</button></div></div>';
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
      const dirName = dir.split(/[/\\]/).pop();
      html += `<button class="folder-btn" data-dir="${dir}">${drive.name} / ${dirName}</button>`;
    }
  }

  html +=
    '<div class="modal-buttons"><button class="btn btn-muted" id="modal-cancel">Cancel</button></div></div>';
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
  grid.innerHTML =
    '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px;gap:16px;grid-column:1/-1"><div id="loading-elf"></div><p style="color:var(--tan)">Loading images...</p></div>';
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
    // Store the shoot ROOT, not the specific sub-folder. When the user
    // later clicks a recent shoot, the picker logic resolves to the best
    // populated sub-folder automatically.
    pushRecentShoot(shootRootOf(source)).catch(() => {});

    if (images.length === 0) {
      // Stay in card mode so the header (Exit Shoot, stage pill) and shoot
      // nav (sibling folder chips) remain available — just show an empty
      // message in the grid area instead of bouncing to welcome.
      showEmptyFolderState();
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
  const markedTotal = keeps + favs + rejects;

  if (markedTotal === 0 && unsorted === 0) {
    showToast('Nothing to sort', 'error');
    return;
  }

  // Detect whether the user is inside an existing shoot. If so, the default
  // action is "sort in place" (route marks into the shoot's sibling folders).
  // If not, the default is a new dated bundle in ~/Pictures/sorted/.
  let shootContext = null;
  try {
    const ctxRes = await fetch(`/api/shoot-context?source=${encodeURIComponent(source)}`);
    if (ctxRes.ok) {
      const ctx = await ctxRes.json();
      if (ctx.insideShoot) shootContext = ctx;
    }
  } catch {
    /* fall through */
  }

  // Unified sort modal with a "Save to a new dated shoot folder" checkbox.
  // Default: unchecked when inside a shoot (sort in place), checked when
  // starting fresh from a camera card / loose folder.
  const decision = await showSortModal({
    counts: { keeps, favs, rejects, unsorted, markedTotal, total: images.length },
    shootContext,
  });
  if (!decision) return;

  if (decision.mode === 'in-place') {
    await doSortInPlace(shootContext);
  } else {
    await doSortNewBundle(decision.name);
  }
}

// The unified sort dialog. Returns { mode: 'in-place' } | { mode: 'new', name }
// | null (cancelled).
function showSortModal({ counts, shootContext }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const { keeps, favs, rejects, unsorted, markedTotal } = counts;
    const insideShoot = !!shootContext;

    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

    const modal = document.createElement('div');
    modal.className = 'modal';

    const h = document.createElement('h2');
    h.textContent = 'Sort to Folders';
    modal.appendChild(h);

    // Summary line — what we're about to sort
    const summary = document.createElement('p');
    const parts = [];
    if (keeps) parts.push(`${keeps} keeps`);
    if (favs) parts.push(`${favs} favorites`);
    if (rejects) parts.push(`${rejects} rejects`);
    if (unsorted) parts.push(`${unsorted} unsorted`);
    summary.textContent = parts.join(' · ') || '0 marked';
    modal.appendChild(summary);

    // Explainer describing the action that WILL happen — sits above the
    // checkbox so it reads as context, not as "what checking the box enables"
    const explainer = document.createElement('p');
    explainer.className = 'sort-explainer';
    modal.appendChild(explainer);

    // Checkbox — toggles between in-place vs new-bundle.
    // When NOT inside a shoot, there's no "in place" target, so we force
    // the checkbox on and disable it (new-bundle is the only valid mode).
    const checkRow = document.createElement('label');
    checkRow.className = 'sort-check-row';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.id = 'sort-new-shoot';
    check.checked = !insideShoot; // default ON for loose folders / card imports
    if (!insideShoot) check.disabled = true;
    const checkLabel = document.createElement('span');
    checkLabel.textContent = 'Create as a new dated shoot instead';
    checkRow.append(check, checkLabel);
    if (!insideShoot) checkRow.classList.add('is-disabled');
    modal.appendChild(checkRow);

    // Name input — appears below the checkbox, only when checked
    const nameWrap = document.createElement('div');
    nameWrap.className = 'sort-name-wrap';
    const nameInput = document.createElement('input');
    nameInput.className = 'modal-input';
    nameInput.placeholder = 'Shoot name';
    nameInput.autocomplete = 'off';
    nameWrap.appendChild(nameInput);
    modal.appendChild(nameWrap);

    function updateMode() {
      const newShoot = check.checked;
      nameWrap.style.display = newShoot ? '' : 'none';
      if (newShoot) {
        explainer.textContent = `Creates a new dated bundle — Keeps / Favorites / Rejects / Unsorted folders in ~/Pictures/sorted/ using the shoot name below.`;
      } else {
        // shootContext is guaranteed to exist here: the checkbox is disabled
        // when shootContext is null, so this branch can't run. Belt-and-suspenders.
        const name = shootContext?.shootName || 'the current shoot';
        explainer.textContent = `Routes marked images into "${name}"'s existing folders. Unmarked photos stay in place.`;
      }
    }
    check.addEventListener('change', updateMode);
    updateMode();
    if (check.checked) setTimeout(() => nameInput.focus(), 0);

    const btns = document.createElement('div');
    btns.className = 'modal-buttons';
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-muted';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.className = 'btn btn-primary';
    confirm.textContent = 'Sort';
    btns.append(cancel, confirm);
    modal.appendChild(btns);

    overlay.appendChild(modal);
    overlay.classList.add('active');

    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      } else if (e.key === 'Enter' && document.activeElement !== nameInput) {
        // Enter anywhere except inside the name field triggers confirm
        e.preventDefault();
        onConfirm();
      }
    };
    const close = (v) => {
      document.removeEventListener('keydown', keyHandler);
      overlay.classList.remove('active');
      resolve(v);
    };

    function onConfirm() {
      if (check.checked) {
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.focus();
          return; // don't close — user needs to supply a name
        }
        close({ mode: 'new', name });
      } else {
        if (markedTotal === 0) {
          // Sort in place with no marks = no-op. Warn instead of proceeding.
          cancel.click();
          showToast(
            'Nothing marked to sort in place. Press K / F / X first, or check "new shoot".',
            'error',
          );
          return;
        }
        close({ mode: 'in-place' });
      }
    }

    cancel.addEventListener('click', () => close(null));
    confirm.addEventListener('click', onConfirm);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    document.addEventListener('keydown', keyHandler);
  });
}

async function doSortInPlace(ctx) {
  try {
    const res = await fetch('/api/sort-in-place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Sort failed', 'error');
      return;
    }

    const moved = data.moved || {};
    const totalMoved =
      (moved.keep || 0) + (moved.favorite || 0) + (moved.reject || 0) + (moved.unsorted || 0);
    const resultParts = [];
    if (moved.keep) resultParts.push(`${moved.keep} → keeps`);
    if (moved.favorite) resultParts.push(`${moved.favorite} → Favorites`);
    if (moved.reject) resultParts.push(`${moved.reject} → rejects`);
    if (moved.unsorted) resultParts.push(`${moved.unsorted} → unsorted`);
    showToast(`Sorted ${totalMoved} into "${ctx.shootName}": ${resultParts.join(', ')}`, 'success');

    if (data.errors && data.errors.length) {
      showToast(`${data.errors.length} files had errors`, 'error');
    }
    if (window.shelf && window.shelf.showNotification) {
      window.shelf.showNotification(
        'Sorted in place',
        `${totalMoved} images into ${ctx.shootName}`,
      );
    }

    // Refresh the grid so stale marks clear and the user sees what's left.
    bus.emit(EVENTS.REFRESH);
  } catch (e) {
    showToast('Sort failed: ' + e.message, 'error');
  }
}

async function doSortNewBundle(name) {
  try {
    const res = await fetch('/api/sort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, source }),
    });
    const data = await res.json();
    if (data.errors) showToast(`${data.errors.length} files had errors`, 'error');

    // Compute the keeps folder path for the Pick Heroes bridge button
    const now = new Date();
    const dateStr = String(now.getMonth() + 1).padStart(2, '0') + '-' + now.getFullYear();
    const safeName = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    const sortDir = config.sortDir || '';
    const keepsPath = sortDir ? `${sortDir}/Keeps - ${dateStr} - ${safeName}` : null;

    // Refresh the source grid so marks clear (source is now empty for the
    // sorted items — everything was moved out).
    bus.emit(EVENTS.REFRESH);

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
  mDiv.className = 'modal';
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
        // Use the hint the server sends — it's OS-aware.
        showToast(data.hint || data.error || 'dnglab is not installed', 'error');
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
      window.shelf.showNotification(
        'DNG conversion complete',
        `Converted ${data.converted} images`,
      );
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
  const favoritesPath = /[/\\]Favorites$/.test(source) ? source : source + '/Favorites';

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

    // Server tells us what it actually opened — Lightroom on macOS, the file
    // manager on Windows/Linux. Phrase the toast accordingly.
    const msg =
      data.opened === 'lightroom'
        ? 'Opening Favorites in Lightroom...'
        : 'Opened Favorites — drag into your editor from here.';
    showToast(msg, 'success');
  } catch (e) {
    showToast('Failed to open Lightroom: ' + e.message, 'error');
  }
}

async function handlePromoteFavorites() {
  const images = getImages();
  const favs = images.filter((i) => (i.status || 'unmarked') === 'favorite');

  if (favs.length === 0) {
    showToast('No favorites marked', 'error');
    return;
  }

  const confirmed = await showConfirmModal(
    'Promote Favorites',
    `Move ${favs.length} favorite image${favs.length !== 1 ? 's' : ''} into the Favorites subfolder?`,
  );
  if (!confirmed) return;

  // Snapshot source so we can bail if the user navigated away mid-request.
  const initialSource = source;
  const folderName = initialSource.split(/[/\\]/).pop();

  try {
    await Promise.all(
      favs.map((img) =>
        fetch(`/api/folder/${encodeURIComponent(folderName)}/mark`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: img.filename, status: 'favorite' }),
        }),
      ),
    );

    const res = await fetch(`/api/folder/${encodeURIComponent(folderName)}/save-favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();

    // User exited the shoot or loaded a different one while we were working.
    // Swallow the result rather than showing a stuck bridge against wrong state.
    if (source !== initialSource) return;

    showToast(`Promoted ${data.moved} image${data.moved !== 1 ? 's' : ''} to Favorites`, 'success');
    if (window.shelf && window.shelf.showNotification) {
      window.shelf.showNotification('Promoted to Favorites', `Moved ${data.moved} heroes`);
    }
    showPromoteBridge(data.moved, folderName);
  } catch (e) {
    if (source !== initialSource) return;
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
    showToast(
      `Moved ${data.moved} image${data.moved !== 1 ? 's' : ''} to ${dest.newShootName || dest.existingPath?.split(/[/\\]/).pop() || 'shoot'}`,
      'success',
    );
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
    const siblingList = siblings
      .map(
        (s) => `
      <button class="folder-btn sibling-btn" data-path="${s.path}">${s.name}</button>
    `,
      )
      .join('');

    overlay.innerHTML = `
      <div class="modal">
        <h2>Move ${count} to Shoot</h2>
        <p>Files will land in the destination\u2019s <code>unsorted/</code> folder.</p>
        ${
          siblings.length > 0
            ? `
          <h3 style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--ink-dim);margin:14px 0 6px">Existing shoots</h3>
          ${siblingList}
        `
            : ''
        }
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

    overlay.querySelectorAll('.sibling-btn').forEach((btn) => {
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
  if (moved.favorite) parts.push(`${moved.favorite} favorites`);
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

    document
      .getElementById('modal-confirm')
      .addEventListener('click', () => close(input.value.trim() || null));
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

    // Define keyboard handler first so we can remove it from close().
    // Previously if the modal was dismissed via overlay click, this handler
    // leaked and every subsequent Escape press hit a stale listener.
    const keyHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        close(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      }
    };
    const close = (value) => {
      document.removeEventListener('keydown', keyHandler);
      overlay.classList.remove('active');
      resolve(value);
    };
    document.addEventListener('keydown', keyHandler);

    document.getElementById('modal-confirm').addEventListener('click', () => close(true));
    document.getElementById('modal-cancel').addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
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

    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    };
    const close = (value) => {
      document.removeEventListener('keydown', keyHandler);
      overlay.classList.remove('active');
      resolve(value);
    };
    document.addEventListener('keydown', keyHandler);

    document.getElementById('modal-option-a').addEventListener('click', () => close(true));
    document.getElementById('modal-option-b').addEventListener('click', () => close(false));
    document.getElementById('modal-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
  });
}
