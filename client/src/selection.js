// Selection + marking logic
// Click: toggle keep; Cmd+click: toggle reject; Double-click: toggle favorite
// Keys: P=keep, F=favorite, X=reject, U=unmark (each advances to next unmarked)

import { bus, EVENTS } from './events.js';
import {
  getImages,
  getSelectedIndex,
  setSelectedIndex,
  updateCardStatus,
} from './grid.js';

let lastClickIndex = -1;
let source = '';

export function initSelection() {
  bus.on(EVENTS.SELECT, handleSelect);
  bus.on('select:favorite', ({ index }) => toggleFavorite(index));
  bus.on(EVENTS.MODE_CHANGED, ({ newSource }) => {
    source = newSource;
    lastClickIndex = -1;
  });
}

function handleSelect({ index, meta, shift }) {
  const images = getImages();
  if (index < 0 || index >= images.length) return;

  if (shift) {
    // Range selection
    const start = Math.min(lastClickIndex >= 0 ? lastClickIndex : index, index);
    const end = Math.max(lastClickIndex >= 0 ? lastClickIndex : index, index);
    const status = meta ? 'reject' : 'keep';
    batchMark(start, end, status);
  } else {
    const img = images[index];
    const currentStatus = img.status || 'unmarked';
    let newStatus;

    if (meta) {
      // Cmd+click: toggle reject
      newStatus = currentStatus === 'reject' ? 'unmarked' : 'reject';
    } else {
      // Click: toggle keep on/off (no cycle)
      newStatus = currentStatus === 'keep' ? 'unmarked' : 'keep';
    }

    markSingle(index, newStatus);
  }

  lastClickIndex = index;
  setSelectedIndex(index);
}

export async function markSingle(index, status) {
  const images = getImages();
  const img = images[index];

  updateCardStatus(index, status);
  bus.emit(EVENTS.IMAGE_MARKED, { index, status });

  const body = { filename: img.filename, status, source };
  await fetch('/api/mark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function batchMark(start, end, status) {
  const images = getImages();
  const filenames = [];

  for (let i = start; i <= end; i++) {
    filenames.push(images[i].filename);
    updateCardStatus(i, status);
  }

  bus.emit(EVENTS.BATCH_MARKED, { start, end, status });

  await fetch('/api/mark-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filenames, status, source }),
  });
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

export function keepAndAdvance() { markCurrent('keep'); }
export function favoriteAndAdvance() { markCurrent('favorite'); }
export function unmarkAndAdvance() { markCurrent('unmarked'); }

export function toggleFavorite(index) {
  const images = getImages();
  if (index < 0 || index >= images.length) return;
  const img = images[index];
  const currentStatus = img.status || 'unmarked';
  const newStatus = currentStatus === 'favorite' ? 'unmarked' : 'favorite';
  markSingle(index, newStatus);
  setSelectedIndex(index);
}

// Mark reject and advance (X key)
export function rejectAndAdvance() {
  const images = getImages();
  let index = getSelectedIndex();
  if (index < 0) index = 0;
  if (index >= images.length) return;

  markSingle(index, 'reject');

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

// Deselect all
export async function deselectAll() {
  const images = getImages();
  const filenames = [];

  for (let i = 0; i < images.length; i++) {
    if ((images[i].status || 'unmarked') !== 'unmarked') {
      filenames.push(images[i].filename);
      updateCardStatus(i, 'unmarked');
    }
  }

  if (filenames.length === 0) return;

  bus.emit(EVENTS.BATCH_MARKED, { start: 0, end: images.length - 1, status: 'unmarked' });

  await fetch('/api/mark-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filenames, status: 'unmarked', source }),
  });
}
