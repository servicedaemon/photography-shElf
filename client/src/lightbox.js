// Lightbox — spacebar toggle, full-window preview with marking

import { bus, EVENTS } from './events.js';
import {
  getImages,
  setSelectedIndex,
  getSelectedIndex,
  previewUrl,
  getStackIdFor,
  getStackMembers,
  coverFilenameFor,
  isStackCollapsed,
} from './grid.js';
import { markSingle } from './selection.js';

let lightboxEl = null;
let isOpen = false;
let currentIndex = -1;
let isZoomed = false;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let imgOffset = { x: 0, y: 0 };

// Incremented on every frame update; used to guard async hi-res loads against
// stale onloads firing after the user has navigated past the requested image.
let frameId = 0;

// The currently-pending hi-res preload. We keep a reference so we can null
// out its onload + src when the user navigates past it — otherwise an
// in-flight Image holds its decoded preview (~2-4MB for CR3) until the
// network response completes, which led to OOM crashes after ~200+ rapid
// navigations through a large shoot.
let pendingHiRes = null;

const CYCLE = ['unmarked', 'keep', 'favorite'];
const STATUS_CLASSES = ['keep', 'favorite', 'reject'];

export function initLightbox() {
  lightboxEl = document.getElementById('lightbox');

  bus.on(EVENTS.LIGHTBOX_OPEN, ({ index }) => openLightbox(index));
  bus.on(EVENTS.LIGHTBOX_CLOSE, () => closeLightbox());

  // Re-render lightbox when marks change (from keyboard shortcuts)
  bus.on(EVENTS.IMAGE_MARKED, ({ index }) => {
    if (isOpen && index === currentIndex) updateLightboxFrame();
  });

  // Sync lightbox.currentIndex with grid.selectedIndex. Without this, K/F/X
  // in the lightbox would advance the grid selection but leave the lightbox
  // stuck on the old image — the user would see no change and think marking
  // was broken (item 8 in the v1.3.2 feedback dump).
  bus.on(EVENTS.SELECTION_CHANGED, (detail) => {
    if (!isOpen) return;
    if (typeof detail.selectedIndex !== 'number') return;
    if (detail.selectedIndex === currentIndex) return; // already in sync
    const images = getImages();
    if (detail.selectedIndex < 0 || detail.selectedIndex >= images.length) return;
    // Reset zoom unless we're staying inside the same stack — same rule as
    // arrow-key nav (preserves zoom across burst siblings).
    if (!isInSameStack(currentIndex, detail.selectedIndex)) {
      isZoomed = false;
      imgOffset = { x: 0, y: 0 };
    }
    currentIndex = detail.selectedIndex;
    updateLightboxFrame();
  });

  // Stack feedback: when S / Shift+S / P fire while the lightbox is open,
  // refresh the badge (state may have changed) and pulse it so the user
  // gets visible confirmation that the keypress did something.
  bus.on(EVENTS.STACK_TOGGLED, () => {
    if (isOpen) {
      updateLightboxFrame();
      pulseBadge();
    }
  });
  bus.on(EVENTS.COVER_PROMOTED, () => {
    if (isOpen) {
      updateLightboxFrame();
      pulseBadge();
    }
  });

  // Reset lightbox state on source change (including Exit Shoot → idle).
  // Empty the DOM so the next openLightbox builds a fresh shell against the
  // new image set instead of reusing a stale filmstrip.
  bus.on(EVENTS.MODE_CHANGED, () => {
    currentIndex = -1;
    isOpen = false;
    isZoomed = false;
    isDragging = false;
    cancelPendingHiRes();
    if (lightboxEl) {
      lightboxEl.classList.remove('active', 'closing');
      lightboxEl.replaceChildren();
    }
  });

  document.addEventListener('mousemove', handleDrag);
  document.addEventListener('mouseup', handleDragEnd);
}

function thumbUrl(filename) {
  return previewUrl(filename).replace('/preview/', '/thumb/');
}

function openLightbox(index) {
  const images = getImages();
  if (index < 0 || index >= images.length) return;

  currentIndex = index;
  isOpen = true;
  isZoomed = false;
  setSelectedIndex(index);

  renderLightbox();
  lightboxEl.classList.add('active');
}

function closeLightbox() {
  if (!lightboxEl.classList.contains('active')) return;
  isOpen = false;
  isZoomed = false;
  cancelPendingHiRes();
  // Play exit animation before removing 'active' (which display:none-s it).
  lightboxEl.classList.add('closing');
  const onEnd = () => {
    lightboxEl.classList.remove('active', 'closing');
    lightboxEl.removeEventListener('animationend', onEnd);
  };
  lightboxEl.addEventListener('animationend', onEnd);
}

export function toggleLightbox() {
  if (isOpen) {
    closeLightbox();
  } else {
    const images = getImages();
    if (images.length === 0) return;
    // Open at the GRID's selected index — not the lightbox's last
    // currentIndex, which can be stale after MODE_CHANGED or just out of
    // sync if the user clicked a card before pressing space.
    const gridIdx = getSelectedIndex();
    const safeIdx = gridIdx >= 0 && gridIdx < images.length ? gridIdx : 0;
    openLightbox(safeIdx);
  }
}

export function isLightboxOpen() {
  return isOpen;
}

// True when both indices belong to the same stack (and stackId is non-null).
// Used to preserve zoom state across burst-frame navigation: zoom in once
// on the subject, then arrow through the stack to compare focus/sharpness
// at the same magnification.
function isInSameStack(idxA, idxB) {
  const images = getImages();
  const a = images[idxA];
  const b = images[idxB];
  if (!a || !b) return false;
  const sa = getStackIdFor(a.filename);
  const sb = getStackIdFor(b.filename);
  return sa !== null && sa === sb;
}

export function navigateLightbox(delta) {
  const images = getImages();
  const newIndex = currentIndex + delta;
  if (newIndex < 0 || newIndex >= images.length) return;

  // Reset zoom unless we're staying inside the same stack — burst-frame
  // comparison wants the same magnification + pan position across siblings.
  if (!isInSameStack(currentIndex, newIndex)) {
    isZoomed = false;
    imgOffset = { x: 0, y: 0 };
  }

  currentIndex = newIndex;
  setSelectedIndex(newIndex);
  updateLightboxFrame();
}

// Public toggle for the `z` keyboard shortcut. Mirrors what the dblclick
// handler does. No-op when the lightbox is closed.
export function toggleZoom() {
  if (!isOpen) return;
  const lbImg = document.getElementById('lb-img');
  if (!lbImg) return;
  if (isZoomed) {
    isZoomed = false;
    imgOffset = { x: 0, y: 0 };
    lbImg.classList.remove('zoomed');
    lbImg.style.transform = '';
  } else {
    isZoomed = true;
    imgOffset = { x: 0, y: 0 };
    lbImg.classList.add('zoomed');
    lbImg.style.transform = '';
  }
}

function cycleStatus(index) {
  const images = getImages();
  const img = images[index];
  const current = img.status || 'unmarked';
  const clean = current === 'reject' ? 'unmarked' : current;
  const newStatus = CYCLE[(CYCLE.indexOf(clean) + 1) % CYCLE.length];
  markSingle(index, newStatus);
  updateLightboxFrame();
}

function rejectStatus(index) {
  const images = getImages();
  const img = images[index];
  const current = img.status || 'unmarked';
  const newStatus = current === 'reject' ? 'unmarked' : 'reject';
  markSingle(index, newStatus);
  updateLightboxFrame();
}

// Dispatcher: build the shell once per shoot, then update only the per-frame
// pieces on every navigation/mark. Keeping the filmstrip DOM stable preserves
// scroll position and avoids reloading thumbnail <img>s on every key press.
function renderLightbox() {
  const images = getImages();
  const img = images[currentIndex];
  if (!img) return;

  const filmstrip = lightboxEl.querySelector('.filmstrip');
  if (!filmstrip || filmstrip.children.length !== images.length) {
    buildLightboxShell(images);
  }
  updateLightboxFrame();
}

// One-time DOM build per shoot. Constructs the structural elements and
// attaches all event listeners. Called only when the image set changes
// (open after MODE_CHANGED clears the DOM, or first open).
function buildLightboxShell(images) {
  // Build filmstrip thumbs (positions don't change within a shoot; only
  // their classes do, so we render them once here). Each thumb is wrapped
  // so we can overlay a cover-frame indicator dot via the wrapper class.
  let filmstripHtml = '<div class="filmstrip">';
  images.forEach((fi, i) => {
    const fThumb = thumbUrl(fi.filename);
    filmstripHtml +=
      `<div class="filmstrip-thumb-wrap">` +
      `<img class="filmstrip-thumb" data-index="${i}" src="${fThumb}" alt="">` +
      `<span class="lb-cover-dot" aria-hidden="true"></span>` +
      `</div>`;
  });
  filmstripHtml += '</div>';

  // Static structural HTML — image src, info text, status badge, button
  // active states are all set by updateLightboxFrame.
  const shellHtml = `
    <div class="lb-status-slot"></div>
    <div class="lb-image-container">
      <img id="lb-img" alt="" draggable="false">
    </div>
    <div class="lb-bottom-bar">
      <div class="lb-info"></div>
      <div class="lb-marks">
        <button class="lb-mark-btn lb-mark-keep" data-status="keep">keep</button>
        <button class="lb-mark-btn lb-mark-favorite" data-status="favorite">favorite</button>
        <button class="lb-mark-btn lb-mark-reject" data-status="reject">reject</button>
      </div>
    </div>
    ${filmstripHtml}
  `;
  lightboxEl.innerHTML = shellHtml;

  attachShellListeners();
}

function attachShellListeners() {
  const lbImg = document.getElementById('lb-img');
  if (!lbImg) return;

  // Click on image = cycle status (or reject with cmd/ctrl)
  lbImg.addEventListener('click', (e) => {
    if (isZoomed) return;
    if (e.metaKey) {
      rejectStatus(currentIndex);
    } else {
      cycleStatus(currentIndex);
    }
  });

  // Double-click to zoom
  lbImg.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (isZoomed) {
      lbImg.classList.remove('zoomed');
      lbImg.style.transform = '';
      isZoomed = false;
    } else {
      lbImg.classList.add('zoomed');
      isZoomed = true;
      imgOffset = { x: 0, y: 0 };
    }
  });

  // Drag to pan when zoomed
  lbImg.addEventListener('mousedown', (e) => {
    if (!isZoomed) return;
    isDragging = true;
    dragStart = { x: e.clientX - imgOffset.x, y: e.clientY - imgOffset.y };
    lbImg.classList.add('dragging');
    e.preventDefault();
  });

  // Scroll-wheel zoom
  const container = lightboxEl.querySelector('.lb-image-container');
  if (container) {
    container.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.deltaY < 0 && !isZoomed) {
          lbImg.classList.add('zoomed');
          isZoomed = true;
          imgOffset = { x: 0, y: 0 };
        } else if (e.deltaY > 0 && isZoomed) {
          lbImg.classList.remove('zoomed');
          lbImg.style.transform = '';
          isZoomed = false;
        }
      },
      { passive: false },
    );
  }

  // Mark buttons (delegation via direct binding — the buttons exist for the
  // life of the shell)
  lightboxEl.querySelectorAll('.lb-mark-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const images = getImages();
      const targetStatus = btn.dataset.status;
      const current = images[currentIndex]?.status || 'unmarked';
      const newStatus = current === targetStatus ? 'unmarked' : targetStatus;
      markSingle(currentIndex, newStatus);
      updateLightboxFrame();
    });
  });

  // Filmstrip — single delegated listener; survives navigation since we
  // never rebuild the filmstrip DOM
  const filmstrip = lightboxEl.querySelector('.filmstrip');
  if (filmstrip) {
    filmstrip.addEventListener('click', (e) => {
      const thumb = e.target.closest('.filmstrip-thumb');
      if (thumb) {
        const i = parseInt(thumb.dataset.index);
        // Same stack-aware zoom preservation as navigateLightbox: clicking
        // a sibling thumb inside the current stack keeps zoom; clicking a
        // thumb outside resets it.
        if (!isInSameStack(currentIndex, i)) {
          isZoomed = false;
          imgOffset = { x: 0, y: 0 };
        }
        currentIndex = i;
        setSelectedIndex(i);
        updateLightboxFrame();
      }
    });
  }
}

// Per-frame state sync: image, info text, status badge, mark-button active
// classes, filmstrip thumb classes, scroll into view. Does NOT touch the
// filmstrip's children — its scroll position is preserved.
function updateLightboxFrame() {
  const images = getImages();
  const img = images[currentIndex];
  if (!img) return;

  const myFrameId = ++frameId;
  const status = img.status || 'unmarked';
  const currentStackId = getStackIdFor(img.filename);

  // Status badge slot — vertically stacks the status pill (when present)
  // and the stack badge (when current image is part of a burst). The slot
  // itself is `display: flex; flex-direction: column` so order is determined
  // by appendChild call order: status first, stack second.
  const slot = lightboxEl.querySelector('.lb-status-slot');
  if (slot) {
    slot.replaceChildren();
    if (status !== 'unmarked') {
      const badge = document.createElement('div');
      badge.className = `lb-status ${status}`;
      badge.textContent = status;
      slot.appendChild(badge);
    }
    if (currentStackId !== null) {
      const members = getStackMembers(currentStackId);
      const collapsed = isStackCollapsed(currentStackId);
      const stackBadge = document.createElement('div');
      stackBadge.className = collapsed
        ? 'lb-stack-badge lb-stack-badge-collapsed'
        : 'lb-stack-badge';
      // Make the collapse state visible (not just hover-tooltip) so users
      // know whether plain K will mark the whole stack (collapsed) or just
      // the current frame (expanded). Lock icon when collapsed, open glyph
      // otherwise — both show the size.
      stackBadge.textContent = collapsed
        ? `◈ ${members.length} ▾`
        : `◈ ${members.length} ▴`;
      stackBadge.title = collapsed
        ? `Burst of ${members.length} (collapsed) — S to expand, P to set cover. Plain K/F/X marks the whole stack.`
        : `Burst of ${members.length} (expanded) — S to collapse, P to set cover. Plain K/F/X marks just this frame.`;
      slot.appendChild(stackBadge);
    }
  }

  // Info text — append "burst N/M" suffix when the current image is part
  // of a stack so position-in-burst is visible alongside position-in-shoot.
  // Uses getStackMembers (server's group order = capture order) for the
  // burst index, anchored to filename rather than images[] index.
  const info = lightboxEl.querySelector('.lb-info');
  if (info) {
    if (currentStackId !== null) {
      const members = getStackMembers(currentStackId);
      const pos = members.indexOf(img.filename) + 1;
      info.textContent = `${img.filename} (${currentIndex + 1}/${images.length} · burst ${pos}/${members.length})`;
    } else {
      info.textContent = `${img.filename} (${currentIndex + 1}/${images.length})`;
    }
  }

  // Mark button active states
  lightboxEl.querySelectorAll('.lb-mark-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.status === status);
  });

  // Image: set thumb src instantly, preload preview and crossfade in. The
  // frameId guard discards stale onloads if the user has navigated past
  // this image during the preview load. Zoom state (`isZoomed` + `imgOffset`)
  // is the single source of truth — the caller decides whether to reset it
  // before navigation; we just reflect that state here.
  const lbImg = document.getElementById('lb-img');
  if (lbImg) {
    lbImg.style.transition = '';
    lbImg.style.opacity = '1';
    if (isZoomed) {
      lbImg.classList.add('zoomed');
      lbImg.style.transform = imgOffset.x || imgOffset.y
        ? `translate(${imgOffset.x}px, ${imgOffset.y}px)`
        : '';
    } else {
      lbImg.classList.remove('zoomed');
      lbImg.style.transform = '';
    }
    lbImg.src = thumbUrl(img.filename);

    // Cancel the previous in-flight hi-res preload before starting a new one.
    // Without this, rapid navigation through ~200 photos pile up as many
    // concurrent in-flight Images, each holding a multi-MB CR3 preview, which
    // crashed the renderer at ~80% through a 250-photo cull.
    cancelPendingHiRes();
    const hiRes = new Image();
    pendingHiRes = hiRes;
    hiRes.onload = () => {
      if (!isOpen || frameId !== myFrameId) {
        // Stale — release the reference so it can be GC'd.
        if (pendingHiRes === hiRes) pendingHiRes = null;
        return;
      }
      lbImg.style.transition = 'opacity 0.22s ease';
      lbImg.style.opacity = '0';
      setTimeout(() => {
        if (frameId !== myFrameId) return;
        lbImg.src = hiRes.src;
        requestAnimationFrame(() => {
          if (frameId !== myFrameId) return;
          lbImg.style.opacity = '1';
        });
      }, 120);
    };
    hiRes.src = previewUrl(img.filename);
  }

  // Filmstrip thumb classes — toggle in place. No DOM replacement, so the
  // filmstrip's scrollLeft is preserved between navigations. The cover-dot
  // overlay sits on the wrapper (.filmstrip-thumb-wrap.is-cover) and only
  // shows for the cover frame WITHIN the current stack — not every stack's
  // cover, which would be visual noise.
  const thumbs = lightboxEl.querySelectorAll('.filmstrip-thumb');
  thumbs.forEach((thumb, i) => {
    const fi = images[i];
    if (!fi) return;
    const fStatus = fi.status || 'unmarked';
    const fStackId = getStackIdFor(fi.filename);
    const inCurrentStack = currentStackId !== null && fStackId === currentStackId;
    thumb.classList.toggle('active', i === currentIndex);
    STATUS_CLASSES.forEach((s) => thumb.classList.toggle(s, fStatus === s));
    thumb.classList.toggle('filmstrip-stack-sibling', inCurrentStack);
    const wrap = thumb.parentElement; // .filmstrip-thumb-wrap
    if (wrap) {
      const isCover =
        inCurrentStack && coverFilenameFor(fStackId) === fi.filename;
      wrap.classList.toggle('is-cover', isCover);
    }
  });

  // Smooth-scroll the active thumb into view. With stable DOM, this is a
  // small movement when navigating one-by-one; only large on first open.
  const activeThumb = lightboxEl.querySelector('.filmstrip-thumb.active');
  if (activeThumb) {
    activeThumb.scrollIntoView({ inline: 'center', behavior: 'smooth' });
  }
}

// Cancel any in-flight hi-res preload and free its decoded-image memory.
// Called from close, mode change, and updateLightboxFrame's start-of-loop.
function cancelPendingHiRes() {
  if (pendingHiRes) {
    pendingHiRes.onload = null;
    pendingHiRes.onerror = null;
    pendingHiRes.src = '';
    pendingHiRes = null;
  }
}

// Restart the badge pulse animation. Called when the user fires a stack
// key (S / Shift+S / P) while the lightbox is open — the underlying state
// changes silently, so this gives visible confirmation. Mirrors the grid's
// mark-flash pattern: remove class, force reflow via offsetWidth, re-add.
function pulseBadge() {
  const badge = lightboxEl?.querySelector('.lb-stack-badge');
  if (!badge) return;
  badge.classList.remove('lb-stack-pulse');
  void badge.offsetWidth;
  badge.classList.add('lb-stack-pulse');
}

function handleDrag(e) {
  if (!isDragging || !isZoomed) return;
  const lbImg = document.getElementById('lb-img');
  if (!lbImg) return;
  imgOffset = {
    x: e.clientX - dragStart.x,
    y: e.clientY - dragStart.y,
  };
  lbImg.style.transform = `translate(${imgOffset.x}px, ${imgOffset.y}px)`;
}

function handleDragEnd() {
  isDragging = false;
  const lbImg = document.getElementById('lb-img');
  if (lbImg) lbImg.classList.remove('dragging');
}
