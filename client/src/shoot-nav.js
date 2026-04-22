// Shoot folder navigator — renders a strip of folder chips (keeps / favorites /
// rejects / unsorted / edited) when the user is inside a shoot's sub-folder,
// so they can jump between folders without going back to the welcome screen.
//
// Hosts the "Empty Rejects" action — moves reject-folder images to the system
// Trash via Electron IPC. Falls back gracefully in a pure-browser preview.
//
// Built entirely via DOM methods (no innerHTML with interpolated values) to
// avoid any chance of injection via folder names.

import { bus, EVENTS } from './events.js';

let navEl = null;
let currentSource = '';
let loadSourceFn = null;
let currentCtx = null;      // cached last shoot-context response
let inFlightAbort = null;   // cancels previous fetch on rapid refresh
let refreshTimer = null;    // debounce

const FOLDER_ORDER = ['unsorted', 'keeps', 'favorites', 'rejects', 'edited'];
const FOLDER_LABEL = {
  unsorted: 'Unsorted',
  keeps: 'Keeps',
  favorites: 'Favorites',
  rejects: 'Rejects',
  edited: 'Edited',
};

export function initShootNav(onLoadSource) {
  navEl = document.getElementById('shoot-nav');
  loadSourceFn = onLoadSource;

  bus.on(EVENTS.MODE_CHANGED, ({ newSource }) => {
    currentSource = newSource || '';
    scheduleRefresh();
  });
  bus.on(EVENTS.REFRESH, scheduleRefresh);
}

// Debounced to avoid the double-fetch when MODE_CHANGED + REFRESH fire together.
function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 120);
}

async function refresh() {
  if (!navEl) return;
  if (!currentSource) { hide(); return; }

  // Cancel any in-flight request so we don't race each other.
  if (inFlightAbort) inFlightAbort.abort();
  inFlightAbort = new AbortController();
  const signal = inFlightAbort.signal;

  let ctx;
  try {
    const res = await fetch(`/api/shoot-context?source=${encodeURIComponent(currentSource)}`, { signal });
    if (!res.ok) { hide(); return; }
    ctx = await res.json();
  } catch (e) {
    if (e.name !== 'AbortError') hide();
    return;
  }

  if (!ctx.insideShoot) { hide(); return; }
  currentCtx = ctx;
  render(ctx);
}

function hide() {
  if (!navEl) return;
  navEl.classList.remove('visible');
  while (navEl.firstChild) navEl.removeChild(navEl.firstChild);
}

function render(ctx) {
  const { shootName, currentSub, siblings } = ctx;
  const rejectCount = siblings.rejects?.count || 0;

  while (navEl.firstChild) navEl.removeChild(navEl.firstChild);

  const inner = document.createElement('div');
  inner.className = 'shoot-nav-inner';

  const title = document.createElement('span');
  title.className = 'shoot-nav-title';
  title.title = shootName;
  title.textContent = shootName;
  inner.appendChild(title);

  const chipsRow = document.createElement('div');
  chipsRow.className = 'shoot-nav-chips';

  for (const k of FOLDER_ORDER) {
    const s = siblings[k];
    if (!s) continue;
    const btn = document.createElement('button');
    btn.className = 'shoot-chip';
    if (k === currentSub) btn.classList.add('active');

    const label = document.createElement('span');
    label.className = 'shoot-chip-label';
    label.textContent = FOLDER_LABEL[k];
    const count = document.createElement('span');
    count.className = 'shoot-chip-count';
    count.textContent = String(s.count);

    btn.append(label, count);
    btn.addEventListener('click', () => {
      // No-op if user clicks the already-active chip
      if (k === currentSub) return;
      if (loadSourceFn) loadSourceFn(s.path);
    });
    chipsRow.appendChild(btn);
  }
  inner.appendChild(chipsRow);

  const spacer = document.createElement('div');
  spacer.className = 'shoot-nav-spacer';
  inner.appendChild(spacer);

  if (rejectCount > 0) {
    const empty = document.createElement('button');
    empty.className = 'shoot-chip shoot-chip-danger';
    empty.id = 'shoot-empty-rejects';
    empty.title = 'Move all reject photos to the Trash';
    empty.textContent = 'Empty Rejects ';
    const c = document.createElement('span');
    c.className = 'shoot-chip-count';
    c.textContent = String(rejectCount);
    empty.appendChild(c);
    empty.addEventListener('click', () => emptyRejects(siblings.rejects));
    inner.appendChild(empty);
  }

  navEl.appendChild(inner);
  navEl.classList.add('visible');
}

async function emptyRejects(rejectSibling) {
  if (!rejectSibling) return;

  // Fetch live file list FIRST so confirmation shows the real count, not a
  // potentially stale cached one.
  let files;
  try {
    const res = await fetch(`/api/list-folder-files?path=${encodeURIComponent(rejectSibling.path)}`);
    const data = await res.json();
    files = data.files || [];
  } catch {
    bus.emit(EVENTS.TOAST, { message: 'Could not list reject files', type: 'error' });
    return;
  }

  if (files.length === 0) {
    bus.emit(EVENTS.TOAST, { message: 'Rejects folder is already empty', type: 'error' });
    return;
  }

  const confirmed = await confirmEmptyRejects(files.length, rejectSibling.path);
  if (!confirmed) return;

  if (!(window.shelf && window.shelf.trashFiles)) {
    bus.emit(EVENTS.TOAST, {
      message: 'Empty Rejects requires the desktop app',
      type: 'error',
    });
    return;
  }

  // Track whether we're currently viewing the rejects folder so we can
  // gracefully jump elsewhere after emptying.
  const wasViewingRejects = currentSource === rejectSibling.path;

  const result = await window.shelf.trashFiles(files);
  bus.emit(EVENTS.TOAST, {
    message: `Moved ${result.trashed} reject${result.trashed !== 1 ? 's' : ''} to Trash`,
    type: 'success',
  });
  if (result.errors && result.errors.length) {
    bus.emit(EVENTS.TOAST, {
      message: `${result.errors.length} files could not be trashed`,
      type: 'error',
    });
  }

  // If user was inside the rejects folder, auto-nav somewhere else so the
  // grid doesn't end up on a now-empty view (and the action bar stays sane).
  if (wasViewingRejects && loadSourceFn && currentCtx && currentCtx.siblings) {
    const fallback =
      currentCtx.siblings.unsorted?.path ||
      currentCtx.siblings.keeps?.path ||
      currentCtx.siblings.favorites?.path ||
      currentCtx.shootRoot;
    if (fallback) {
      loadSourceFn(fallback);
      return; // loadSource triggers its own MODE_CHANGED + refresh
    }
  }

  bus.emit(EVENTS.REFRESH);
}

// Truncate an absolute path to a friendlier form (~/... when inside $HOME).
function friendlyPath(p) {
  // Electron exposes process.env to the renderer. Support both HOME (macOS/Linux)
  // and USERPROFILE (Windows). In a pure browser these are undefined.
  const env = (typeof process !== 'undefined' && process.env) || {};
  const home = env.HOME || env.USERPROFILE || '';
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  const parts = p.split(/[/\\]/);
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p;
}

function confirmEmptyRejects(count, path) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.textAlign = 'center';

    const h = document.createElement('h2');
    h.textContent = 'Empty Rejects?';
    modal.appendChild(h);

    const p1 = document.createElement('p');
    p1.append(
      'This will move ',
      Object.assign(document.createElement('strong'), { textContent: String(count) }),
      ` photo${count !== 1 ? 's' : ''} from the rejects folder to your system Trash. You can restore them from Trash until you empty it.`,
    );
    modal.appendChild(p1);

    const p2 = document.createElement('p');
    p2.style.cssText = 'color:var(--ink-faint);font-size:11px;margin-top:10px;font-family:var(--font-mono)';
    p2.textContent = friendlyPath(path);
    modal.appendChild(p2);

    const btns = document.createElement('div');
    btns.className = 'modal-buttons';

    const cancel = document.createElement('button');
    cancel.className = 'btn btn-muted';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close(false));

    const confirm = document.createElement('button');
    confirm.className = 'btn btn-danger';
    confirm.textContent = 'Move to Trash';
    confirm.addEventListener('click', () => close(true));

    btns.append(cancel, confirm);
    modal.appendChild(btns);
    overlay.appendChild(modal);
    overlay.classList.add('active');
    // Default focus on Cancel so accidental Enter-presses don't trash
    cancel.focus();

    // Keyboard: Enter confirms (only when Trash button is focused via Tab),
    // Escape always cancels. This matches the behavior of showConfirmModal.
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Enter' && document.activeElement === confirm) {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener('keydown', onKey);

    const close = (v) => {
      document.removeEventListener('keydown', onKey);
      overlay.classList.remove('active');
      resolve(v);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  });
}
