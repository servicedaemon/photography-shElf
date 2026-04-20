// Optimistic marking with debounced batch sync to the server.
// UI updates are applied synchronously. Network requests are coalesced
// into batch calls via a 150ms debounce window.

import { bus, EVENTS } from './events.js';

const DEBOUNCE_MS = 150;
let source = '';
let pending = new Map(); // filename -> status
let timer = null;

export function initMarkQueue() {
  bus.on(EVENTS.MODE_CHANGED, ({ newSource }) => {
    // Flush any pending on source change so marks aren't lost
    flush();
    source = newSource || '';
  });
}

export function enqueueMark(filename, status) {
  pending.set(filename, status);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
}

async function flush() {
  if (pending.size === 0 || !source) return;
  const snapshot = new Map(pending);
  pending = new Map();
  timer = null;

  // Group by status for batch sending
  const groups = new Map();
  for (const [filename, status] of snapshot) {
    if (!groups.has(status)) groups.set(status, []);
    groups.get(status).push(filename);
  }

  try {
    for (const [status, filenames] of groups) {
      if (filenames.length === 1) {
        await fetch('/api/mark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: filenames[0], status, source }),
        });
      } else {
        await fetch('/api/mark-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filenames, status, source }),
        });
      }
    }
  } catch {
    bus.emit(EVENTS.MARK_ROLLBACK, { filenames: Array.from(snapshot.keys()) });
  }
}
