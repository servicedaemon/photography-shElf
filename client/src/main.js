// Shelf — main entry point

import { bus, EVENTS } from './events.js';
import { initGrid, setGridData, getImages, getStacks } from './grid.js';
import { initLightbox } from './lightbox.js';
import { initSelection, deselectAll, getSelectedFilenames, clearSelection } from './selection.js';
import { initKeyboard } from './keyboard.js';
import { initFilters } from './filters.js';
import { initSidebar } from './sidebar.js';
import { initActions } from './actions.js';
import { initUndo, showToast } from './undo.js';
import { initStage } from './stage.js';
import { createElf } from './elf.js';
import { setThumbSize, setTheme, getTheme } from './theme.js';
import { initMarkQueue } from './mark-queue.js';
import { initIngest, pushRecentShoot, getRecentShoots } from './ingest.js';
import { initHints } from './hints.js';
import { initShootNav } from './shoot-nav.js';

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
document.addEventListener('DOMContentLoaded', async () => {
  // Apply persisted theme FIRST so the first render uses the right palette.
  await loadSavedTheme();

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

  // Mark sync failed (network error or non-2xx response). The UI was already
  // updated optimistically — we have to refresh from server to get back in sync.
  // Better to flicker than to silently leave the user thinking marks were saved.
  bus.on(EVENTS.MARK_ROLLBACK, () => {
    showToast('Mark sync failed — restoring from disk', 'error');
    refresh();
  });

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

  // Confirmation toast after the user picks a new library root via the
  // File menu. The actual /api/config write happens in the main process.
  window.addEventListener('shelf:library-root-changed', (e) => {
    const p = e.detail?.path;
    if (p) showToast(`Library root: ${p}`, 'success');
  });
});

// --- Header ---

// Segmented theme toggle HTML. Three glyph-only buttons: D (dark), G (grey),
// L (light). The active one is highlighted; clicks cycle the theme.
function themeToggleHtml() {
  const current = getTheme();
  const mk = (t, label, title) =>
    `<button class="tt-btn${t === current ? ' active' : ''}" data-theme="${t}" title="${title}">${label}</button>`;
  return `
    <div class="theme-toggle" role="group" aria-label="Theme">
      ${mk('dark', 'D', 'Dark — default darkroom')}
      ${mk('grey', 'G', 'Grey — neutral 18% mid-tone (best for white-heavy photos)')}
      ${mk('light', 'L', 'Light — warm off-white')}
    </div>
  `;
}

function renderHeader() {
  const header = document.getElementById('header');

  if (mode === 'idle' || mode === 'loading') {
    header.innerHTML = `
      <div class="elf-corner" id="header-elf"></div>
      <h1>Shelf</h1>
      <div class="header-spacer"></div>
      ${themeToggleHtml()}
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

    // Stack stats: e.g. "8 stacks · 25 frames". Only shown when there's at
    // least one stack in the shoot — silent at-a-glance scale indicator.
    const stacks = getStacks();
    let stackStatsHtml = '';
    if (stacks.length > 0) {
      const frames = stacks.reduce((s, g) => s + g.length, 0);
      stackStatsHtml = `<div class="stack-stats" title="Photos taken within 5 seconds of each other, clustered into stacks.\nS: toggle current · Shift+S: all\nShift+mark: apply to whole stack">${stacks.length} ${stacks.length === 1 ? 'stack' : 'stacks'} · ${frames} frames</div>`;
    }

    header.innerHTML = `
      <div class="elf-corner" id="header-elf"></div>
      <h1>Shelf</h1>
      ${stackStatsHtml}
      <div class="header-spacer"></div>
      <div class="thumb-slider">
        <label>Size</label>
        <input type="range" min="150" max="500" value="280" id="thumb-slider">
      </div>
      ${themeToggleHtml()}
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

  // Theme toggle — instant swap, persist to server config
  document.querySelectorAll('.theme-toggle .tt-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });
}

async function applyTheme(theme) {
  setTheme(theme);
  // Re-render header to update the active pill state
  renderHeader();
  // Persist. Fire-and-forget; a transient network error shouldn't roll back
  // the visible theme swap — user will see the change, it just won't persist.
  try {
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    });
  } catch {
    // ignored — visible theme stays applied this session
  }
}

// Apply the user's saved theme as early as possible — before first render.
async function loadSavedTheme() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    if (config && config.theme) setTheme(config.theme);
  } catch {
    // config unreachable — stay on default dark
  }
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
    <div class="welcome-flow" aria-label="Workflow overview">
      <div class="welcome-flow-step">
        <span class="welcome-flow-key">CULL</span>
        <span class="welcome-flow-desc">Mark every photo</span>
      </div>
      <span class="welcome-flow-arrow">→</span>
      <div class="welcome-flow-step">
        <span class="welcome-flow-key">HEROES</span>
        <span class="welcome-flow-desc">Pick your best</span>
      </div>
      <span class="welcome-flow-arrow">→</span>
      <div class="welcome-flow-step">
        <span class="welcome-flow-key">FINAL</span>
        <span class="welcome-flow-desc">Convert + hand off</span>
      </div>
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
// Mirrors the server-side `normalizeSubfolderRole` matcher: trims
// whitespace, accepts singular/plural and common abbreviations, so
// hand-renamed folders like "Favorites " or "fav" still resolve.
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
function shootRootOf(p) {
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
    const stacks = Array.isArray(data) ? [] : data.stacks || data.bursts || [];

    mode = 'card';
    bus.emit(EVENTS.MODE_CHANGED, { newMode: 'card', newSource: source, newFolder: '', stage });
    setGridData(images, source, '', 'card', stacks);
    renderHeader();
    // Store the shoot ROOT, not the specific sub-folder. When the user
    // later clicks a recent shoot, the picker logic resolves to the best
    // populated sub-folder automatically.
    pushRecentShoot(shootRootOf(source)).catch(() => {});

    // First time a user loads a shoot with stacks, nudge them about the S key.
    // Persisted in localStorage so the hint appears once ever, not per-shoot.
    if (stacks.length > 0 && !localStorage.getItem('shelf-stacks-hint-seen')) {
      setTimeout(() => {
        showToast(
          `${stacks.length} stack${stacks.length === 1 ? '' : 's'} detected — press S to expand`,
        );
        localStorage.setItem('shelf-stacks-hint-seen', '1');
      }, 800);
    }

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
  // If not, the default is a new shoot folder under the configured library
  // root.
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

  // Read the configured library root so the modal can show where files
  // will actually land.
  let libraryRoot = '';
  try {
    const cfgRes = await fetch('/api/config');
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      libraryRoot = cfg.libraryRoot || '';
    }
  } catch {
    /* fall through */
  }

  // Unified sort modal with a "Save to a new shoot folder" checkbox.
  // Default: unchecked when inside a shoot (sort in place), checked when
  // starting fresh from a camera card / loose folder.
  const decision = await showSortModal({
    counts: { keeps, favs, rejects, unsorted, markedTotal, total: images.length },
    shootContext,
    libraryRoot,
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
function showSortModal({ counts, shootContext, libraryRoot }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const { keeps, favs, rejects, unsorted, markedTotal } = counts;
    const insideShoot = !!shootContext;
    const libraryRootDisplay = libraryRoot || '(default location)';

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
    checkLabel.textContent = 'Create as a new shoot instead';
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
        explainer.textContent = `Creates a new shoot folder under ${libraryRootDisplay} with unsorted/keeps/favorites/rejects subfolders. Change the location in File → Set Library Root…`;
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

// Sort progress modal. The Escape key handler lives in module scope so
// hideSortProgressModal can detach it on BOTH paths — user-dismiss AND
// normal completion — preventing a leaked document listener that would
// otherwise fire on the next Escape press anywhere.
let sortProgressKeyHandler = null;
// Set true when the user dismissed the modal mid-sort. The stream consumer
// reads this on completion to decide between "show bridge" (still watching)
// and "silent refresh + toast" (already moved on).
let sortProgressDismissed = false;

function showSortProgressModal() {
  const overlay = document.getElementById('modal-overlay');
  sortProgressDismissed = false;
  // textContent-equivalent: only literal HTML in the template, no
  // interpolated user data.
  overlay.innerHTML = `
    <div class="modal sort-progress-modal" style="text-align:center">
      <h2>Sorting…</h2>
      <p class="sort-progress-count" id="sort-progress-count">Preparing</p>
      <progress class="sort-progress-bar" id="sort-progress-bar" value="0" max="100"></progress>
      <p class="sort-progress-hint">You can press <kbd>Esc</kbd> — sorting will finish in the background.</p>
    </div>
  `;
  overlay.classList.add('active');

  // Detach any previously-attached handler before adding a new one. Belt
  // and suspenders against double-attach if showSortProgressModal somehow
  // gets called twice.
  if (sortProgressKeyHandler) {
    document.removeEventListener('keydown', sortProgressKeyHandler);
    sortProgressKeyHandler = null;
  }

  sortProgressKeyHandler = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      sortProgressDismissed = true;
      hideSortProgressModal();
      showToast('Sort continues in the background — done when grid refreshes.', 'success');
    }
  };
  document.addEventListener('keydown', sortProgressKeyHandler);
}

function updateSortProgressModal(processed, total) {
  const overlay = document.getElementById('modal-overlay');
  const bar = overlay.querySelector('#sort-progress-bar');
  const count = overlay.querySelector('#sort-progress-count');
  if (!bar || !count) return; // modal was dismissed
  bar.value = total > 0 ? Math.round((processed / total) * 100) : 0;
  bar.max = 100;
  count.textContent = `${processed} of ${total}`;
}

function hideSortProgressModal() {
  const overlay = document.getElementById('modal-overlay');
  // Detach the keydown listener on every hide path — both user-dismiss
  // (Escape) and normal completion (stream ended → bridge transition).
  // Without this, a stale handler would fire on next Escape anywhere,
  // re-running hideSortProgressModal + the toast in the wrong context.
  if (sortProgressKeyHandler) {
    document.removeEventListener('keydown', sortProgressKeyHandler);
    sortProgressKeyHandler = null;
  }
  overlay.classList.remove('active');
  overlay.innerHTML = '';
}

function sortProgressModalOpen() {
  const overlay = document.getElementById('modal-overlay');
  return !!overlay.querySelector('.sort-progress-modal');
}

async function doSortNewBundle(name) {
  // Show the progress modal IMMEDIATELY so the user sees something
  // happening on click — not after the first SSE byte arrives.
  showSortProgressModal();

  try {
    const res = await fetch('/api/sort?stream=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, source }),
    });
    if (!res.ok) {
      // Non-2xx fell through before any SSE event — read the body and toast.
      const body = await res.text().catch(() => res.statusText);
      hideSortProgressModal();
      showToast('Sort failed: ' + body, 'error');
      return;
    }

    const data = await consumeSortStream(res);
    if (!data) {
      // Stream ended without `done` — the sort either failed mid-way or
      // the connection died. The modal is still showing (if not dismissed);
      // hide it and toast.
      hideSortProgressModal();
      showToast('Sort interrupted — check the destination folder.', 'error');
      return;
    }

    if (data.errors) showToast(`${data.errors.length} files had errors`, 'error');

    const keepsPath = data.keepsDir || null;
    const total = Object.values(data.moved).reduce((a, b) => a + b, 0);

    // Refresh the source grid so marks clear (source is now empty for the
    // sorted items — everything was moved out).
    bus.emit(EVENTS.REFRESH);

    // If the user dismissed the progress modal mid-sort, they explicitly
    // opted out of the modal flow — popping a bridge on top of whatever
    // they're doing now would be jarring. Silent refresh + a calm toast
    // is better. The bridge stays for users who watched it through.
    // Detach the progress modal's keydown listener whichever path we take
    // next — both the bridge transition and the silent-success path need
    // to clear it so a later Escape doesn't fire the leftover handler.
    if (sortProgressKeyHandler) {
      document.removeEventListener('keydown', sortProgressKeyHandler);
      sortProgressKeyHandler = null;
    }

    if (sortProgressDismissed) {
      sortProgressDismissed = false;
      showToast(`Sort complete — ${total} images sorted.`, 'success');
    } else {
      // Transition the existing modal in-place to the bridge — no flicker.
      showSortBridge(data.moved, keepsPath, { renamed: data.renamed });
    }

    if (window.shelf && window.shelf.showNotification) {
      window.shelf.showNotification('Sort complete', `Sorted ${total} images`);
    }
  } catch (e) {
    hideSortProgressModal();
    showToast('Sort failed: ' + e.message, 'error');
  }
}

// Consume the SSE stream from /api/sort?stream=1. Updates the progress
// modal as `data: {processed,total}` ticks arrive (rAF-throttled so the
// bar animates smoothly), returns the final result on `event: done`.
// If the user dismissed the modal mid-sort, returns null and lets the
// server finish in the background — partial cleanup of in-flight file
// moves is risky, so we don't attempt cancellation in v1.3.4.
async function consumeSortStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastTick = null; // {processed, total}
  let rafQueued = false;

  const flushTick = () => {
    rafQueued = false;
    if (lastTick) updateSortProgressModal(lastTick.processed, lastTick.total);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by blank lines. Parse complete messages
    // out of the buffer; leave any partial trailing message for the next
    // chunk.
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const message = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      let event = 'message';
      let dataLine = '';
      for (const line of message.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataLine = line.slice(6);
      }
      if (!dataLine) continue;
      let payload;
      try {
        payload = JSON.parse(dataLine);
      } catch {
        continue;
      }

      if (event === 'done') {
        return payload;
      }
      // Per-file progress tick — coalesce via rAF so the bar animates
      // smoothly even on a 500-file sort.
      lastTick = payload;
      if (!rafQueued && sortProgressModalOpen()) {
        rafQueued = true;
        requestAnimationFrame(flushTick);
      }
    }
  }
  // Stream ended without `done` — treat as failure
  return null;
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
        // Server replies with a platform-specific hint. Surface it as a real
        // modal with a copy-to-clipboard install command, not a generic toast —
        // this is the most common first-run failure for new CR3/ARW/NEF users.
        await showDnglabMissingModal(data.hint || data.error);
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
  // Resolve the favorites folder via shoot-context so the actual on-disk
  // name (could be "Favorites ", "favorite", "favs", etc.) is used. Falls
  // back to source itself when we're already inside the favorites folder
  // (the server detects this via currentSub === 'favorites').
  let favoritesPath = source;
  try {
    const ctx = await fetch(
      `/api/shoot-context?source=${encodeURIComponent(source)}`,
    ).then((r) => (r.ok ? r.json() : null));
    if (ctx?.insideShoot) {
      if (ctx.currentSub === 'favorites') {
        favoritesPath = source;
      } else if (ctx.siblings?.favorites?.path) {
        favoritesPath = ctx.siblings.favorites.path;
      } else {
        // Shoot exists but no favorites sibling yet — fall back to legacy
        // construction so the open still attempts a sensible path.
        favoritesPath = source + '/Favorites';
      }
    } else {
      favoritesPath = source + '/Favorites';
    }
  } catch {
    favoritesPath = source + '/Favorites';
  }

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
  // Passing the absolute source path to /api/folder-mark + /api/promote-favorites
  // works for both nested (`<shoot>/keeps/`) and flat (`Keeps - MM-YYYY - Name/`)
  // layouts — the leaf-name split that worked under flat-only is gone.
  const initialSource = source;

  try {
    // Surface non-2xx responses as throws so the catch below shows a real
    // error toast — fetch() only throws on network failure, not status.
    await Promise.all(
      favs.map(async (img) => {
        const r = await fetch(`/api/folder-mark`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: initialSource, filename: img.filename, status: 'favorite' }),
        });
        if (!r.ok) throw new Error(`mark ${img.filename} failed (${r.status})`);
      }),
    );

    const res = await fetch(`/api/promote-favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: initialSource }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`promote failed (${res.status}): ${errText}`);
    }
    const data = await res.json();

    // User exited the shoot or loaded a different one while we were working.
    // Swallow the result rather than showing a stuck bridge against wrong state.
    if (source !== initialSource) return;

    showToast(`Promoted ${data.moved} image${data.moved !== 1 ? 's' : ''} to Favorites`, 'success');
    if (window.shelf && window.shelf.showNotification) {
      window.shelf.showNotification('Promoted to Favorites', `Moved ${data.moved} heroes`);
    }
    // showPromoteBridge expects a folder display label — derive it from source.
    const displayName = initialSource.split(/[/\\]/).slice(-2).join('/');
    showPromoteBridge(data.moved, displayName);
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

function showSortBridge(moved, keepsPath, opts = {}) {
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
      <p class="bridge-note" id="bridge-renamed-note" hidden></p>
      <div class="modal-buttons">
        <button class="btn btn-muted" id="bridge-done">Done</button>
        <button class="btn btn-muted" id="bridge-new">Start New Shoot</button>
        ${keepsPath ? `<button class="btn btn-primary" id="bridge-heroes">Pick Heroes</button>` : ''}
      </div>
    </div>
  `;
  // If filenames collided in the destination (multi-camera shoots typically
  // produce IMG_1234.CR3 from BOTH bodies), uniqueDest auto-renamed them
  // with a -2/-3 suffix. Surface the count via textContent (not HTML) so
  // even if a future caller passes weird data the message is still safe.
  const renamedCount = Array.isArray(opts.renamed) ? opts.renamed.length : 0;
  if (renamedCount > 0) {
    const note = overlay.querySelector('#bridge-renamed-note');
    if (note) {
      note.textContent = `${renamedCount} filename${renamedCount === 1 ? '' : 's'} renamed (duplicate names from another card)`;
      note.hidden = false;
    }
  }
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

function showPromoteBridge(count, _folderName) {
  // _folderName is reserved for future use by the bridge UI but not currently
  // displayed — kept in the signature so callers don't need to change later.
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
  document.getElementById('bridge-open-favorites').addEventListener('click', async () => {
    close();
    // Resolve the actual favorites sibling via shoot-context so we open
    // the user's on-disk variant (e.g. "Favorites " with a trailing space)
    // rather than a hardcoded "/Favorites" path that may not exist.
    let favPath = source + '/Favorites';
    try {
      const ctx = await fetch(
        `/api/shoot-context?source=${encodeURIComponent(source)}`,
      ).then((r) => (r.ok ? r.json() : null));
      if (ctx?.insideShoot && ctx.siblings?.favorites?.path) {
        favPath = ctx.siblings.favorites.path;
      }
    } catch {
      /* fall through with legacy construction */
    }
    loadSource(favPath);
  });
}

// --- Refresh (after undo, or after a mark-sync rollback) ---

async function refresh() {
  if (mode !== 'card' || !source) return;
  try {
    const res = await fetch(`/api/images?source=${encodeURIComponent(source)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const images = Array.isArray(data) ? data : data.images;
    const stacks = Array.isArray(data) ? [] : data.stacks || data.bursts || [];
    setGridData(images, source, '', 'card', stacks);
    renderHeader();
  } catch {
    // Refresh failed too. Critical to surface this — a silent failure here
    // leaves the user thinking marks were saved when neither write nor
    // restore actually worked. The grid stays optimistic; toast warns.
    showToast('Could not reload from server — grid may be out of sync', 'error');
  }
}

// --- Styled modals ---

// dnglab is the bundled-as-recommendation CLI for converting RAW → DNG.
// When it's missing, the conversion route returns 501 with a platform-aware
// hint. Surface that as an actionable modal with a copy-to-clipboard command
// rather than a buried error toast — this is the most common first-run wall.
function showDnglabMissingModal(hint) {
  return new Promise((resolve) => {
    // Detect platform via userAgent — Electron doesn't expose process.platform
    // to the renderer cleanly. Coarse but reliable enough.
    const ua = navigator.userAgent;
    const isMac = /Mac|iPad|iPhone/.test(ua);
    const isWin = /Win/.test(ua);

    let cmd;
    let pkgManager;
    if (isMac) {
      cmd = 'brew install dnglab';
      pkgManager = 'Homebrew';
    } else if (isWin) {
      cmd = 'choco install dnglab';
      pkgManager = 'Chocolatey';
    } else {
      cmd = '';
      pkgManager = null;
    }

    const cmdHtml = cmd
      ? `<div class="install-cmd-row">
           <code class="install-cmd">${cmd}</code>
           <button class="btn btn-muted" id="copy-cmd" title="Copy to clipboard">Copy</button>
         </div>
         <p class="install-note">If you don't have ${pkgManager} yet, you can also download a binary from
         <a href="https://github.com/dnglab/dnglab/releases" id="dnglab-link">dnglab releases</a>
         and put it on your PATH.</p>`
      : `<p class="install-note">Download a binary from
         <a href="https://github.com/dnglab/dnglab/releases" id="dnglab-link">dnglab releases</a>
         and put it on your PATH.</p>`;

    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `
      <div class="modal">
        <h2>DNG conversion needs a helper tool</h2>
        <p>Shelf uses <b>dnglab</b> to convert RAW (CR3/ARW/NEF/etc.) into Adobe DNG. It's a one-time install — once it's on your machine, Convert to DNG just works.</p>
        ${cmdHtml}
        <p class="install-note install-note-dim">${hint || 'After installing, click Convert to DNG again.'}</p>
        <div class="modal-buttons">
          <button class="btn btn-primary" id="dnglab-close">Got it</button>
        </div>
      </div>
    `;
    overlay.classList.add('active');

    const keyHandler = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        close();
      }
    };
    const close = () => {
      document.removeEventListener('keydown', keyHandler);
      overlay.classList.remove('active');
      resolve();
    };
    document.addEventListener('keydown', keyHandler);

    document.getElementById('dnglab-close').addEventListener('click', close);

    // External link: window.open is intercepted by electron/main.js's
    // setWindowOpenHandler and routed to shell.openExternal — no extra API needed.
    const linkEl = document.getElementById('dnglab-link');
    if (linkEl) {
      linkEl.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(linkEl.href, '_blank');
      });
    }

    // Copy command to clipboard with visual confirmation
    const copyBtn = document.getElementById('copy-cmd');
    if (copyBtn && cmd) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(cmd);
          const original = copyBtn.textContent;
          copyBtn.textContent = 'Copied ✓';
          setTimeout(() => {
            copyBtn.textContent = original;
          }, 1500);
        } catch {
          // clipboard API can fail under file:// — silent fallback
        }
      });
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
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
