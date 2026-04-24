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
  getStackIndices,
  getStackSpanForIndex,
} from './grid.js';
import { enqueueMark } from './mark-queue.js';

let selectionAnchor = -1; // first shift+click
let selectionRange = null; // { start, end } inclusive, or null

export function initSelection() {
  bus.on(EVENTS.SELECT, handleSelect);
  bus.on('select:favorite', ({ index }) => toggleFavorite(index));
  bus.on(EVENTS.MODE_CHANGED, () => {
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

// Same as advanceToNextUnmarked but starts from the END of the current stack.
// Used after Shift+mark on a stack member — jump past the whole group.
function advancePastStack(stackEndIndex) {
  const images = getImages();
  for (let i = stackEndIndex + 1; i < images.length; i++) {
    const s = images[i].status || 'unmarked';
    if (s === 'unmarked') {
      setSelectedIndex(i);
      return;
    }
  }
  if (stackEndIndex + 1 < images.length) {
    setSelectedIndex(stackEndIndex + 1);
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

// Mark the whole stack containing the currently-focused card, then advance
// past the stack to the next unmarked photo. Called for Shift+K/F/X/U.
//
// Design note: Shift+mark is the EXPLICIT "extend to stack" gesture and
// triggers regardless of whether the stack is collapsed or expanded. This
// is intentionally different from plain rotate/tag (which operate on the
// focused frame, falling through to "whole stack" only on collapsed covers
// because the cover is the only visible frame). The modifier key is the
// unambiguous way to say "treat this as a group action" — matching how
// photographers think of it: Shift = batch.
//
// Falls back to markCurrent if focused card isn't in a stack.
export function markCurrentStack(status) {
  const images = getImages();
  let index = getSelectedIndex();
  if (index < 0) index = 0;
  if (index >= images.length) return;

  const span = getStackSpanForIndex(index);
  if (!span) {
    // Not in a stack — behave as a normal mark
    markCurrent(status);
    return;
  }

  // Apply to every member of the stack (indices may not all be contiguous,
  // so use getStackIndices in addition to the span for the advance target).
  const indices = getStackIndices(span.stackId);
  for (const i of indices) {
    updateCardStatus(i, status);
    enqueueMark(images[i].filename, status);
  }
  bus.emit(EVENTS.BATCH_MARKED, { start: span.start, end: span.end, status });

  // Auto-advance past the last member of the span to the next unmarked photo
  advancePastStack(span.end);
}

export function keepAndAdvance() {
  if (selectionRange) {
    markSelection('keep');
    return;
  }
  markCurrent('keep');
}
export function favoriteAndAdvance() {
  if (selectionRange) {
    markSelection('favorite');
    return;
  }
  markCurrent('favorite');
}
export function rejectAndAdvance() {
  if (selectionRange) {
    markSelection('reject');
    return;
  }
  markCurrent('reject');
}
export function unmarkAndAdvance() {
  if (selectionRange) {
    markSelection('unmarked');
    return;
  }
  markCurrent('unmarked');
}

// Shift+mark variants: when focused card is in a stack, mark the whole stack
// and advance past it. Otherwise same as normal mark.
export function keepStackAndAdvance() {
  if (selectionRange) {
    markSelection('keep');
    return;
  }
  markCurrentStack('keep');
}
export function favoriteStackAndAdvance() {
  if (selectionRange) {
    markSelection('favorite');
    return;
  }
  markCurrentStack('favorite');
}
export function rejectStackAndAdvance() {
  if (selectionRange) {
    markSelection('reject');
    return;
  }
  markCurrentStack('reject');
}
export function unmarkStackAndAdvance() {
  if (selectionRange) {
    markSelection('unmarked');
    return;
  }
  markCurrentStack('unmarked');
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
