// Keyboard shortcuts

import { bus, EVENTS } from './events.js';
import {
  getImages,
  getSelectedIndex,
  setSelectedIndex,
  getGridColumns,
  getSource,
  nextVisibleIndex,
  toggleStackAtCurrent,
  toggleAllStacks,
  promoteCoverAtCurrent,
  jumpToNextStack,
  getStackIndices,
  getStackIdFor,
  isStackCollapsed,
} from './grid.js';
import { getSelectionRange } from './selection.js';
import { showToast } from './undo.js';
import { isLightboxOpen, navigateLightbox, toggleLightbox, toggleZoom } from './lightbox.js';
import {
  keepAndAdvance,
  favoriteAndAdvance,
  rejectAndAdvance,
  unmarkAndAdvance,
  keepStackAndAdvance,
  favoriteStackAndAdvance,
  rejectStackAndAdvance,
  unmarkStackAndAdvance,
  clearSelection,
} from './selection.js';

let shortcutsVisible = false;

export function initKeyboard() {
  document.addEventListener('keydown', handleKeydown);
}

function handleKeydown(e) {
  // Don't capture when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const images = getImages();
  const index = getSelectedIndex();

  switch (e.key) {
    case ' ':
      e.preventDefault();
      // If no image selected, select first one
      if (index < 0 && images.length > 0) {
        setSelectedIndex(0);
      }
      toggleLightbox();
      break;

    case 'Escape':
      clearSelection();
      if (isLightboxOpen()) {
        toggleLightbox();
      } else if (shortcutsVisible) {
        toggleShortcuts();
      } else {
        bus.emit(EVENTS.SIDEBAR_TOGGLE, { open: false });
      }
      break;

    case 'ArrowRight':
      e.preventDefault();
      if (e.altKey) {
        rotateImage('cw');
      } else if (isLightboxOpen()) {
        navigateLightbox(1);
      } else if (index < 0 && images.length > 0) {
        setSelectedIndex(0);
      } else {
        const next = nextVisibleIndex(index, 1);
        if (next !== index) setSelectedIndex(next);
      }
      break;

    case 'ArrowLeft':
      e.preventDefault();
      if (e.altKey) {
        rotateImage('ccw');
      } else if (isLightboxOpen()) {
        navigateLightbox(-1);
      } else {
        const prev = nextVisibleIndex(index, -1);
        if (prev !== index) setSelectedIndex(prev);
      }
      break;

    case 'ArrowDown':
      e.preventDefault();
      if (!isLightboxOpen()) {
        const cols = getGridColumns();
        const next = nextVisibleIndex(index, cols);
        if (next !== index) setSelectedIndex(next);
      }
      break;

    case 'ArrowUp':
      e.preventDefault();
      if (!isLightboxOpen()) {
        const cols = getGridColumns();
        const prev = nextVisibleIndex(index, -cols);
        if (prev !== index) setSelectedIndex(prev);
      }
      break;

    case 'k':
    case 'K':
      e.preventDefault();
      if (e.shiftKey) keepStackAndAdvance();
      else keepAndAdvance();
      break;

    case 'f':
    case 'F':
      e.preventDefault();
      if (e.shiftKey) favoriteStackAndAdvance();
      else favoriteAndAdvance();
      break;

    case 'x':
    case 'X':
      e.preventDefault();
      if (e.shiftKey) rejectStackAndAdvance();
      else rejectAndAdvance();
      break;

    case 'u':
    case 'U':
      e.preventDefault();
      if (e.shiftKey) unmarkStackAndAdvance();
      else unmarkAndAdvance();
      break;

    case 'i':
    case 'I':
      e.preventDefault();
      bus.emit(EVENTS.SIDEBAR_TOGGLE);
      break;

    // Stack operations
    case 's':
    case 'S':
      e.preventDefault();
      if (e.shiftKey) toggleAllStacks();
      else toggleStackAtCurrent();
      break;

    case 'p':
    case 'P':
      e.preventDefault();
      promoteCoverAtCurrent();
      break;

    case 'g':
    case 'G':
      e.preventDefault();
      if (!jumpToNextStack(e.shiftKey ? -1 : 1)) {
        showToast('No stacks in this shoot');
      }
      break;

    case '?':
      e.preventDefault();
      toggleShortcuts();
      break;

    case 'z':
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        bus.emit(EVENTS.UNDO);
      } else if (isLightboxOpen()) {
        // Plain `z` toggles lightbox zoom. Combined with arrow-key navigation
        // inside a stack, lets you compare focus/sharpness across burst
        // siblings at the same magnification without moving your hand to
        // the trackpad. (Cmd/Ctrl+Z above is the global undo.)
        e.preventDefault();
        toggleZoom();
      }
      break;

    default:
      break;
  }
}

// Targets for rotation, given the current selection context:
// - Range selection active → all indices in range
// - Focused card is a collapsed stack cover → all stack member indices
// - Otherwise → just the focused index
function rotationTargets() {
  const images = getImages();
  const index = getSelectedIndex();
  if (index < 0 || index >= images.length) return [];

  const range = getSelectionRange();
  if (range) {
    const out = [];
    for (let i = range.start; i <= range.end; i++) out.push(i);
    return out;
  }

  const filename = images[index].filename;
  const stackId = getStackIdFor(filename);
  if (stackId !== null && isStackCollapsed(stackId)) {
    return getStackIndices(stackId);
  }
  return [index];
}

async function rotateImage(direction) {
  const images = getImages();
  const source = getSource();
  const targets = rotationTargets();
  if (targets.length === 0) return;

  const bust = `&_t=${Date.now()}`;

  // Fire all rotations in parallel — server handles file-level locking per image
  await Promise.all(
    targets.map(async (idx) => {
      const img = images[idx];
      try {
        const res = await fetch('/api/rotate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: img.filename, source, direction }),
        });
        if (!res.ok) return;

        const thumbImg = document.querySelector(`.card[data-index="${idx}"] img`);
        if (thumbImg) thumbImg.src = thumbImg.src.replace(/&_t=\d+/, '') + bust;

        bus.emit(EVENTS.IMAGE_ROTATED, { index: idx, direction });
      } catch {
        /* silently fail this one, continue others */
      }
    }),
  );

  // Refresh lightbox preview if open (only once — the focused card)
  if (isLightboxOpen()) {
    const lbImg = document.getElementById('lb-img');
    if (lbImg) lbImg.src = lbImg.src.replace(/&_t=\d+/, '') + bust;
  }
}

function toggleShortcuts() {
  const existing = document.getElementById('shortcuts-overlay');
  if (existing) {
    existing.remove();
    shortcutsVisible = false;
    return;
  }
  shortcutsVisible = true;
  showShortcutsOverlay();
}

function showShortcutsOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'shortcuts-overlay';
  overlay.id = 'shortcuts-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) toggleShortcuts();
  });

  overlay.innerHTML = `
    <div class="shortcuts-panel">
      <h2>Keyboard Shortcuts</h2>
      <div class="shortcut-group">
        <h3>Marking</h3>
        <div class="shortcut-row"><span class="desc">Keep</span><span class="keys">K</span></div>
        <div class="shortcut-row"><span class="desc">Favorite</span><span class="keys">F</span></div>
        <div class="shortcut-row"><span class="desc">Reject</span><span class="keys">X</span></div>
        <div class="shortcut-row"><span class="desc">Unmark</span><span class="keys">U</span></div>
        <div class="shortcut-row"><span class="desc">Click (toggle keep)</span><span class="keys">Click</span></div>
        <div class="shortcut-row"><span class="desc">Favorite</span><span class="keys">Double\u2011click</span></div>
        <div class="shortcut-row"><span class="desc">Reject</span><span class="keys">\u2318+Click</span></div>
        <div class="shortcut-row"><span class="desc">Range keep</span><span class="keys">Shift+Click</span></div>
        <div class="shortcut-row"><span class="desc">Range reject</span><span class="keys">Shift+\u2318+Click</span></div>
        <div class="shortcut-row"><span class="desc">Undo</span><span class="keys">\u2318+Z</span></div>
      </div>
      <div class="shortcut-group">
        <h3>Stacks <span style="font-size:10px;color:var(--ink-dim);letter-spacing:0.04em;font-weight:400;text-transform:none">(photos shot within 5s of each other)</span></h3>
        <div class="shortcut-row"><span class="desc">Expand / collapse current stack</span><span class="keys">S</span></div>
        <div class="shortcut-row"><span class="desc">Expand / collapse all stacks</span><span class="keys">Shift+S</span></div>
        <div class="shortcut-row"><span class="desc">Promote focused frame to cover</span><span class="keys">P</span></div>
        <div class="shortcut-row"><span class="desc">Jump to next / previous stack</span><span class="keys">G / Shift+G</span></div>
        <div class="shortcut-row"><span class="desc">Mark whole stack (keep/fav/reject/unmark)</span><span class="keys">Shift+K/F/X/U</span></div>
        <div class="shortcut-row"><span class="desc">On collapsed cover, plain K/F/X/U marks the whole stack too</span><span class="keys"></span></div>
      </div>
      <div class="shortcut-group">
        <h3>Navigation</h3>
        <div class="shortcut-row"><span class="desc">Move cursor</span><span class="keys">\u2190 \u2191 \u2192 \u2193</span></div>
        <div class="shortcut-row"><span class="desc">Toggle preview</span><span class="keys">Space</span></div>
        <div class="shortcut-row"><span class="desc">Rotate left</span><span class="keys">\u2325+\u2190</span></div>
        <div class="shortcut-row"><span class="desc">Rotate right</span><span class="keys">\u2325+\u2192</span></div>
      </div>
      <div class="shortcut-group">
        <h3>Panels</h3>
        <div class="shortcut-row"><span class="desc">Toggle sidebar</span><span class="keys">I</span></div>
        <div class="shortcut-row"><span class="desc">This overlay</span><span class="keys">?</span></div>
        <div class="shortcut-row"><span class="desc">Close</span><span class="keys">Esc</span></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}
