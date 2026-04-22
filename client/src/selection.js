// Selection + marking logic
// Click: toggle keep; Cmd+click: toggle reject; Double-click: toggle favorite
// Keys: K=keep, F=favorite, X=reject, U=unmark (each advances to next unmarked)
// Shift+click: create visual range selection; K/F/X/U apply to whole selection

import { bus, EVENTS } from './events.js';
import {
  getImages,
  getSelectedIndex,
  setSelectedIndex,
  updateCardStatus,
} from './grid.js';
import { enqueueMark } from './mark-queue.js';

let lastClickIndex = -1;
let source = '';

let selectionAnchor = -1;  // first shift+click
let selectionRange = null; // { start, end } inclusive, or null

export function initSelection() {
  bus.on(EVENTS.SELECT, handleSelect);
  bus.on('select:favorite', ({ index }) => toggleFavorite(index));
  bus.on(EVENTS.MODE_CHANGED, ({ newSource }) => {
    source = newSource;
    lastClickIndex = -1;
    selectionAnchor = -1;
    if (selectionRange !== null) {
      selectionRange = null;
      bus.emit(EVENTS.SELECTION_CHANGED, { range: null });
    }
  });
}

function handleSelect({ index, meta, shift }) {
  const images = getImages();
  if (index < 0 || index >= images.length) return;

  if (shift) {
    // Shift+click: create/extend visual selection
    if (selectionAnchor < 0) {
      selectionAnchor = index;
      selectionRange = { start: index, end: index };
    } else {
      selectionRange = {
        start: Math.min(selectionAnchor, index),
        end: Math.max(selectionAnchor, index),
      };
    }
    bus.emit(EVENTS.SELECTION_CHANGED, { range: selectionRange });
    setSelectedIndex(index);
    lastClickIndex = index;
    return;
  }

  // Clear selection on non-shift click
  if (selectionRange !== null) {
    selectionAnchor = -1;
    selectionRange = null;
    bus.emit(EVENTS.SELECTION_CHANGED, { range: null });
  }

  const img = images[index];
  const currentStatus = img.status || 'unmarked';
  let newStatus;
  if (meta) {
    newStatus = currentStatus === 'reject' ? 'unmarked' : 'reject';
  } else {
    newStatus = currentStatus === 'keep' ? 'unmarked' : 'keep';
  }
  markSingle(index, newStatus);
  lastClickIndex = index;
  setSelectedIndex(index);
}

export async function markSingle(index, status) {
  const images = getImages();
  const img = images[index];

  updateCardStatus(index, status);
  bus.emit(EVENTS.IMAGE_MARKED, { index, status });

  enqueueMark(img.filename, status);
}

export async function batchMark(start, end, status) {
  const images = getImages();

  for (let i = start; i <= end; i++) {
    updateCardStatus(i, status);
    enqueueMark(images[i].filename, status);
  }

  bus.emit(EVENTS.BATCH_MARKED, { start, end, status });
}

function advanceToNextUnmarked() {
  const images = getImages();
  const index = getSelectedIndex();
  for (let i = index + 1; i < images.length; i++) {
    const s = images[i].status || 'unmarked';
    if (s === 'unmarked') {
      setSelectedIndex(i);
      return;
    }
  }
  if (index + 1 < images.length) {
    setSelectedIndex(index + 1);
  }
}

function markCurrent(status) {
  const images = getImages();
  let index = getSelectedIndex();
  if (index < 0) index = 0;
  if (index >= images.length) return;
  markSingle(index, status);
  advanceToNextUnmarked();
}

export function keepAndAdvance() {
  if (selectionRange) { markSelection('keep'); return; }
  markCurrent('keep');
}
export function favoriteAndAdvance() {
  if (selectionRange) { markSelection('favorite'); return; }
  markCurrent('favorite');
}
export function rejectAndAdvance() {
  if (selectionRange) { markSelection('reject'); return; }
  markCurrent('reject');
}
export function unmarkAndAdvance() {
  if (selectionRange) { markSelection('unmarked'); return; }
  markCurrent('unmarked');
}

export function toggleFavorite(index) {
  const images = getImages();
  if (index < 0 || index >= images.length) return;
  const img = images[index];
  const currentStatus = img.status || 'unmarked';
  const newStatus = currentStatus === 'favorite' ? 'unmarked' : 'favorite';
  markSingle(index, newStatus);
  setSelectedIndex(index);
}

// Deselect all marks
export async function deselectAll() {
  const images = getImages();

  for (let i = 0; i < images.length; i++) {
    if ((images[i].status || 'unmarked') !== 'unmarked') {
      updateCardStatus(i, 'unmarked');
      enqueueMark(images[i].filename, 'unmarked');
    }
  }

  bus.emit(EVENTS.BATCH_MARKED, { start: 0, end: images.length - 1, status: 'unmarked' });
}

// --- Range selection helpers ---

export function getSelectionRange() {
  return selectionRange;
}

export function clearSelection() {
  if (selectionRange !== null) {
    selectionAnchor = -1;
    selectionRange = null;
    bus.emit(EVENTS.SELECTION_CHANGED, { range: null });
  }
}

export function getSelectedFilenames() {
  if (!selectionRange) return [];
  const images = getImages();
  const out = [];
  for (let i = selectionRange.start; i <= selectionRange.end; i++) {
    if (images[i]) out.push(images[i].filename);
  }
  return out;
}

// Mark all images in the current selection with a given status
export async function markSelection(status) {
  if (!selectionRange) return false;
  const { start, end } = selectionRange;
  batchMark(start, end, status);
  return true;
}
