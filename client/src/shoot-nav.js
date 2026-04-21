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
    refresh();
  });
  bus.on(EVENTS.REFRESH, refresh);
}

async function refresh() {
  if (!navEl) return;
  if (!currentSource) { hide(); return; }

  let ctx;
  try {
    const res = await fetch(`/api/shoot-context?source=${encodeURIComponent(currentSource)}`);
    if (!res.ok) { hide(); return; }
    ctx = await res.json();
  } catch {
    hide();
    return;
  }

  if (!ctx.insideShoot) { hide(); return; }
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

  const confirmed = await confirmEmptyRejects(rejectSibling.count, rejectSibling.path);
  if (!confirmed) return;

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

  if (window.shelf && window.shelf.trashFiles) {
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
  } else {
    bus.emit(EVENTS.TOAST, {
      message: 'Empty Rejects requires the desktop app',
      type: 'error',
    });
    return;
  }

  bus.emit(EVENTS.REFRESH);
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
    p2.style.cssText = 'color:var(--ink-faint);font-size:11px;margin-top:10px';
    p2.textContent = path;
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

    const close = (v) => { overlay.classList.remove('active'); resolve(v); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  });
}
