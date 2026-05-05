// Virtualized thumbnail grid

import { bus, EVENTS } from './events.js';

let images = [];
let source = '';
let folder = '';
let mode = 'card';
let activeFilters = new Set(['all']);
let selectedIndex = -1;
let gridEl = null;
// observer dropped in v1.5.0 — we now eager-load all thumbnails on
// shoot open (see renderGrid). The IntersectionObserver was preventing
// hidden stack members from preloading; removing it fixes the
// "wave of loads on first uncollapse" UX issue.
let currentSelectionRange = null; // tracked via SELECTION_CHANGED event

// Stack grouping: array of arrays of filenames (each inner array = one stack of ≥2 frames).
// Derived lookup: filename → stackId (index into stacks[]) and stackId → size.
let stacks = [];
let stackIdByFilename = new Map();
let stackSizeById = [];

// Per-session stack state (not persisted): collapsed status + chosen cover frame.
// Defaults: all collapsed on load, cover = first member of the stack.
let collapsedStackIds = new Set();
let coverByStackId = new Map(); // stackId → filename

export function initGrid() {
  gridEl = document.getElementById('grid');

  // v1.5.0: re-render on grid resize so jagged-grid spans stay accurate
  // when the user drags the window edge or changes the thumb-size slider
  // (which alters --thumb-size → grid-template-columns → column count).
  // ResizeObserver batches to one fire per layout frame, much cheaper
  // than a `resize` listener firing on every drag pixel.
  if (typeof ResizeObserver !== 'undefined') {
    let resizeQueued = false;
    new ResizeObserver(() => {
      if (resizeQueued || !images || images.length === 0) return;
      resizeQueued = true;
      requestAnimationFrame(() => {
        resizeQueued = false;
        renderGrid();
      });
    }).observe(gridEl);
  }

  bus.on(EVENTS.SELECTION_CHANGED, (detail) => {
    // `range` is only present when shift-click range selection changes;
    // pure focus-index emits from setSelectedIndex don't carry it.
    if (!('range' in detail)) return;
    const { range } = detail;
    currentSelectionRange = range;
    const cards = gridEl?.querySelectorAll('.card') || [];
    cards.forEach((card, i) => {
      if (range && i >= range.start && i <= range.end) {
        card.classList.add('selection');
      } else {
        card.classList.remove('selection');
      }
    });
  });
}

export function setGridData(newImages, newSource, newFolder, newMode, newStacks = []) {
  images = newImages;
  source = newSource;
  folder = newFolder;
  mode = newMode;
  selectedIndex = -1;

  // Rebuild stack lookups from the server-supplied groups
  stacks = Array.isArray(newStacks) ? newStacks : [];
  stackIdByFilename = new Map();
  stackSizeById = [];
  stacks.forEach((group, id) => {
    stackSizeById[id] = group.length;
    for (const fn of group) stackIdByFilename.set(fn, id);
  });

  // Default: all stacks collapsed on load — scannability win at any scale.
  // Cover defaults to first member (unchanged from the group's natural order).
  collapsedStackIds = new Set(stacks.map((_, id) => id));
  coverByStackId = new Map();

  renderGrid();
}

// Exposed for consumers that need to know stack membership
export function getStacks() {
  return stacks;
}

export function getStackIdFor(filename) {
  const id = stackIdByFilename.get(filename);
  return id !== undefined ? id : null;
}

export function getStackSize(stackId) {
  return stackSizeById[stackId] || 0;
}

export function getStackMembers(stackId) {
  return stacks[stackId] || [];
}

// Returns {start, end, stackId} for the stack containing images[index], or null
// if the image at that index isn't in a stack. Walks outward from index to find
// the contiguous range of same-stackId images.
// Robust to non-contiguous stacks (rare, but possible if filenames sort oddly).
export function getStackSpanForIndex(index) {
  if (index < 0 || index >= images.length) return null;
  const stackId = stackIdByFilename.get(images[index].filename);
  if (stackId === undefined) return null;

  let start = index;
  while (start > 0 && stackIdByFilename.get(images[start - 1].filename) === stackId) start--;
  let end = index;
  while (end < images.length - 1 && stackIdByFilename.get(images[end + 1].filename) === stackId)
    end++;
  return { start, end, stackId };
}

// All image indices belonging to a given stackId (may not be contiguous).
export function getStackIndices(stackId) {
  const out = [];
  for (let i = 0; i < images.length; i++) {
    if (stackIdByFilename.get(images[i].filename) === stackId) out.push(i);
  }
  return out;
}

// Collapse / expand state management

export function isStackCollapsed(stackId) {
  return collapsedStackIds.has(stackId);
}

export function coverFilenameFor(stackId) {
  return coverByStackId.get(stackId) ?? (stacks[stackId] && stacks[stackId][0]) ?? null;
}

// A card is visible if: not in a stack, OR its stack is expanded, OR it's the cover.
export function isImageVisible(filename) {
  const stackId = stackIdByFilename.get(filename);
  if (stackId === undefined) return true;
  if (!collapsedStackIds.has(stackId)) return true;
  return filename === coverFilenameFor(stackId);
}

// Toggle collapse for the stack containing the currently-focused card.
export function toggleStackAtCurrent() {
  const img = images[selectedIndex];
  if (!img) return false;
  const stackId = stackIdByFilename.get(img.filename);
  if (stackId === undefined) return false;
  if (collapsedStackIds.has(stackId)) collapsedStackIds.delete(stackId);
  else collapsedStackIds.add(stackId);
  const collapsed = collapsedStackIds.has(stackId);
  // If collapsing and focus isn't on the cover, move focus to the cover so it stays visible
  if (collapsed) {
    const cover = coverFilenameFor(stackId);
    const coverIndex = images.findIndex((i) => i.filename === cover);
    if (coverIndex >= 0) selectedIndex = coverIndex;
  }
  renderGrid();
  bus.emit(EVENTS.STACK_TOGGLED, { stackId, collapsed, scope: 'one' });
  return true;
}

// Toggle all stacks: if any are expanded → collapse all. Otherwise expand all.
export function toggleAllStacks() {
  const anyExpanded = stacks.some((_, id) => !collapsedStackIds.has(id));
  if (anyExpanded) {
    collapsedStackIds = new Set(stacks.map((_, id) => id));
    // Move selection to visible card if current is now hidden
    if (selectedIndex >= 0 && !isImageVisible(images[selectedIndex].filename)) {
      const stackId = stackIdByFilename.get(images[selectedIndex].filename);
      const cover = coverFilenameFor(stackId);
      const coverIndex = images.findIndex((i) => i.filename === cover);
      if (coverIndex >= 0) selectedIndex = coverIndex;
    }
  } else {
    collapsedStackIds = new Set();
  }
  renderGrid();
  bus.emit(EVENTS.STACK_TOGGLED, { stackId: null, collapsed: anyExpanded, scope: 'all' });
}

// Promote the currently-focused image to be the cover of its stack.
// Takes effect immediately: if the stack is collapsed, the new cover replaces
// the old one. No-op if focused card isn't in a stack.
export function promoteCoverAtCurrent() {
  const img = images[selectedIndex];
  if (!img) return false;
  const stackId = stackIdByFilename.get(img.filename);
  if (stackId === undefined) return false;
  coverByStackId.set(stackId, img.filename);
  renderGrid();
  bus.emit(EVENTS.COVER_PROMOTED, { stackId, filename: img.filename });
  return true;
}

// Find the next/previous VISIBLE image index (collapsed-stack members are
// skipped). `step` is +1 for forward, -1 for backward, ±cols for up/down.
export function nextVisibleIndex(fromIndex, step) {
  if (images.length === 0) return fromIndex;
  const dir = step > 0 ? 1 : -1;
  const mag = Math.abs(step);
  let i = fromIndex;
  let moved = 0;
  while (moved < mag) {
    i += dir;
    if (i < 0 || i >= images.length) return fromIndex; // hit edge
    if (isImageVisible(images[i].filename)) moved++;
  }
  return i;
}

// Jump to the next/previous stack's representative (cover) card.
export function jumpToNextStack(direction = 1) {
  // Returns false when there are no stacks — caller decides how to surface it
  // (e.g. toast). Silent no-op would look broken in help-less keyboard mode.
  if (stacks.length === 0) return false;
  const current = images[selectedIndex]?.filename;
  const currentStackId = current !== undefined ? stackIdByFilename.get(current) : undefined;

  // Build ordered list of (stackId, cover-index-in-images)
  const coverList = stacks
    .map((_, id) => {
      const cover = coverFilenameFor(id);
      const idx = images.findIndex((i) => i.filename === cover);
      return { id, idx };
    })
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  if (coverList.length === 0) return;

  let targetIdx = -1;
  if (currentStackId === undefined) {
    // Not in a stack — jump to first one ahead of current position
    if (direction > 0) {
      targetIdx = coverList.find((c) => c.idx > selectedIndex)?.idx ?? coverList[0].idx;
    } else {
      const behind = coverList.filter((c) => c.idx < selectedIndex);
      targetIdx = behind[behind.length - 1]?.idx ?? coverList[coverList.length - 1].idx;
    }
  } else {
    const pos = coverList.findIndex((c) => c.id === currentStackId);
    const next = direction > 0 ? pos + 1 : pos - 1;
    if (next >= 0 && next < coverList.length) targetIdx = coverList[next].idx;
    else targetIdx = coverList[(next + coverList.length) % coverList.length].idx; // wrap
  }

  if (targetIdx >= 0) setSelectedIndex(targetIdx);
  return true;
}

export function getImages() {
  return images;
}

export function getSource() {
  return source;
}

export function getSelectedIndex() {
  return selectedIndex;
}

export function setSelectedIndex(i) {
  if (selectedIndex === i) return; // no-op when already selected
  // Deselect old
  if (selectedIndex >= 0) {
    const oldCard = gridEl?.querySelector(`.card[data-index="${selectedIndex}"]`);
    if (oldCard) oldCard.classList.remove('selected');
  }
  selectedIndex = i;
  // Select new
  if (selectedIndex >= 0) {
    const newCard = gridEl?.querySelector(`.card[data-index="${selectedIndex}"]`);
    if (newCard) {
      newCard.classList.add('selected');
      newCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  // Tell the lightbox (and any other listener) that focus moved. Without
  // this, K/F/X in the lightbox would mark + advance the GRID selection
  // but leave the lightbox stuck on the old image — the desync that made
  // the in-lightbox cull feel like nothing was happening.
  bus.emit(EVENTS.SELECTION_CHANGED, { selectedIndex });
}

export function updateCardStatus(index, status) {
  if (index < 0 || index >= images.length) return;
  images[index].status = status;

  const card = gridEl.querySelector(`.card[data-index="${index}"]`);
  if (!card) return;

  // Update CSS classes
  card.classList.remove('keep', 'reject', 'favorite', 'unmarked');
  if (status !== 'unmarked') {
    card.classList.add(status);
  }

  // Update badge
  let badge = card.querySelector('.badge');
  if (status !== 'unmarked') {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'badge';
      card.appendChild(badge);
    }
    badge.textContent = status;
  } else if (badge) {
    badge.remove();
  }

  // Mark-flash: tiny pop confirmation on every mark
  card.classList.remove('mark-flash');
  // Force reflow so the animation restarts even on rapid consecutive marks
  void card.offsetWidth;
  card.classList.add('mark-flash');

  // Apply filter visibility
  applyFilterToCard(card, index);
}

export function setFilters(filters) {
  activeFilters = filters;
  applyFilters();
}

function applyFilters() {
  const cards = gridEl.querySelectorAll('.card');
  cards.forEach((card) => {
    const index = parseInt(card.dataset.index);
    applyFilterToCard(card, index);
  });
}

function applyFilterToCard(card, index) {
  if (activeFilters.has('all')) {
    card.style.display = '';
    return;
  }
  const status = images[index]?.status || 'unmarked';
  card.style.display = activeFilters.has(status) ? '' : 'none';
}

function thumbUrl(filename) {
  if (folder) {
    return `/api/folder/${encodeURIComponent(folder)}/thumb/${encodeURIComponent(filename)}`;
  }
  return `/api/thumb/${encodeURIComponent(filename)}?source=${encodeURIComponent(source)}`;
}

export function previewUrl(filename) {
  if (folder) {
    return `/api/folder/${encodeURIComponent(folder)}/preview/${encodeURIComponent(filename)}`;
  }
  return `/api/preview/${encodeURIComponent(filename)}?source=${encodeURIComponent(source)}`;
}

export function getGridColumns() {
  if (!gridEl) return 1;
  const style = getComputedStyle(gridEl);
  const cols = style.getPropertyValue('grid-template-columns').split(' ').length;
  return cols || 1;
}

function renderGrid() {
  if (!gridEl) return;
  gridEl.replaceChildren();

  // v1.5.0: eager-load all thumbnails on shoot open. The IntersectionObserver
  // was a holdover from when shoots could be 1000s of images and lazy
  // loading mattered for memory; in practice ~50KB/thumb × 500 = 25MB
  // and the server's 8-concurrent semaphore in lib/thumbnails.js provides
  // the right backpressure. Removing the observer also fixes the
  // "wave of loads on first stack expand" — hidden cards (display:none)
  // never fired the observer, so expanding queued a fresh batch. With
  // src set directly, the browser pre-loads regardless of visibility.

  const fragment = document.createDocumentFragment();

  // Compute the column track width so each card can set its grid-row
  // span proportional to its aspect ratio. clientWidth INCLUDES padding,
  // so we subtract paddingLeft/Right before dividing into cols. Otherwise
  // spans run ~17% too tall and the image (object-fit: cover) crops to
  // fill the inflated card.
  const gridStyle = getComputedStyle(gridEl);
  const cssColGap = parseFloat(gridStyle.columnGap) || 8;
  const padLeft = parseFloat(gridStyle.paddingLeft) || 0;
  const padRight = parseFloat(gridStyle.paddingRight) || 0;
  const cols = Math.max(1, getGridColumns());
  const usableWidth = (gridEl.clientWidth || 1200) - padLeft - padRight;
  const colWidth = (usableWidth - cssColGap * (cols - 1)) / cols;
  // grid-auto-rows: 1px → row span N means N pixels of card height.
  // Card height = colWidth × (h/w) for the image's natural ratio.
  const rowSpanFor = (img) => {
    const w = img.width || 3;
    const h = img.height || 2;
    return Math.max(1, Math.round((colWidth * h) / w));
  };

  images.forEach((img, i) => {
    const card = document.createElement('div');
    card.className = 'card card-entering';
    card.dataset.index = i;
    // Stagger entry animation — cap at index 60 so a huge shoot doesn't
    // take forever to finish appearing.
    card.style.setProperty('--enter-i', Math.min(i, 60));

    // Jagged-grid row span: card height in 1px row units, derived from
    // the image's natural aspect ratio supplied by /api/images. With
    // grid-auto-rows: 1px in CSS, span N === N pixels tall.
    const span = rowSpanFor(img);
    card.style.gridRowEnd = `span ${span}`;

    const status = img.status || 'unmarked';
    if (status !== 'unmarked') card.classList.add(status);
    if (i === selectedIndex) card.classList.add('selected');

    if (
      currentSelectionRange &&
      i >= currentSelectionRange.start &&
      i <= currentSelectionRange.end
    ) {
      card.classList.add('selection');
    }

    // Skeleton placeholder fills the card via `inset: 0` (card height is
    // already correct from the grid-row span). Removes itself when the
    // thumbnail's onload fires below.
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton';
    card.appendChild(skeleton);

    // Image — eager-loaded (no data-src indirection). The browser
    // handles parallelism; the server's 8-concurrent semaphore caps CPU.
    // alt="" (decorative) because the label below already shows the filename.
    const imgEl = document.createElement('img');
    imgEl.src = thumbUrl(img.filename);
    imgEl.draggable = false;
    imgEl.alt = '';
    imgEl.onload = () => skeleton.remove();
    card.appendChild(imgEl);

    // Label
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = img.filename;
    card.appendChild(label);

    // Status badge (keep/favorite/reject)
    if (status !== 'unmarked') {
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = status;
      card.appendChild(badge);
    }

    // Stack badge — photos within 5s of each other share a stackId.
    // Hovering one card highlights all siblings via .stack-sibling class.
    const stackId = stackIdByFilename.get(img.filename);
    if (stackId !== undefined) {
      card.dataset.stackId = String(stackId);
      const size = stackSizeById[stackId];
      const collapsed = collapsedStackIds.has(stackId);
      const isCover = img.filename === coverFilenameFor(stackId);

      // Hide non-cover members of collapsed stacks. The card stays in the DOM
      // (so indices and IntersectionObserver keep working); CSS hides it.
      if (collapsed && !isCover) card.classList.add('stack-hidden');
      // Covers of collapsed stacks get the layered-edge visual treatment.
      if (collapsed && isCover) card.classList.add('stack-cover-collapsed');

      const stackBadge = document.createElement('div');
      stackBadge.className = 'stack-badge';
      stackBadge.textContent = `◈${size}`;
      // Collapsed covers get a visual hover tooltip via CSS (.stack-badge::after);
      // for non-cover/expanded badges the native title is the fallback affordance.
      if (!(collapsed && isCover)) {
        stackBadge.title =
          `${size} photos in this stack (within 5 seconds).\n` +
          'S: expand/collapse • Shift+S: all\n' +
          'Shift+K / F / X: mark whole stack • P: promote cover';
      }
      card.appendChild(stackBadge);

      card.addEventListener('mouseenter', () => {
        gridEl
          .querySelectorAll(`.card[data-stack-id="${stackId}"]`)
          .forEach((c) => c.classList.add('stack-sibling'));
      });
      card.addEventListener('mouseleave', () => {
        gridEl
          .querySelectorAll('.card.stack-sibling')
          .forEach((c) => c.classList.remove('stack-sibling'));
      });
    }

    // Click handler
    card.addEventListener('click', (e) => {
      e.preventDefault();
      if (e.altKey) return; // handled by mousedown peek
      bus.emit(EVENTS.SELECT, { index: i, meta: e.metaKey, shift: e.shiftKey });
    });

    // Double-click: toggle favorite
    card.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      bus.emit('select:favorite', { index: i });
    });

    // Option+click peek: show lightbox on press, close on release
    card.addEventListener('mousedown', (e) => {
      if (e.altKey && !e.metaKey && !e.shiftKey && e.button === 0) {
        e.preventDefault();
        bus.emit(EVENTS.LIGHTBOX_OPEN, { index: i });
        const closeOnUp = () => {
          bus.emit(EVENTS.LIGHTBOX_CLOSE);
          document.removeEventListener('mouseup', closeOnUp);
        };
        document.removeEventListener('mouseup', closeOnUp);
        document.addEventListener('mouseup', closeOnUp);
      }
    });

    // Apply filter
    applyFilterToCard(card, i);

    fragment.appendChild(card);
  });

  gridEl.appendChild(fragment);

  bus.emit(EVENTS.STATE_CHANGED, { images, mode });
}
