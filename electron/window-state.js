// Save/restore window bounds via the existing /api/config endpoint.
// Clamps to primary display if saved bounds are off-screen.

import { screen } from 'electron';

const DEFAULTS = { width: 1400, height: 900, x: undefined, y: undefined };

function boundsOnScreen(bounds) {
  if (!bounds || typeof bounds.x !== 'number') return false;
  const displays = screen.getAllDisplays();
  for (const d of displays) {
    const { x, y, width, height } = d.bounds;
    // Require the window's top-left to be within some display
    if (
      bounds.x >= x - 50 &&
      bounds.x < x + width - 100 &&
      bounds.y >= y - 50 &&
      bounds.y < y + height - 100
    )
      return true;
  }
  return false;
}

export async function loadBounds(serverPort) {
  try {
    const res = await fetch(`http://localhost:${serverPort}/api/config`);
    const cfg = await res.json();
    const saved = cfg.windowBounds;
    if (saved && boundsOnScreen(saved)) {
      return { ...DEFAULTS, ...saved };
    }
  } catch {
    // ignore
  }
  return DEFAULTS;
}

export async function saveBounds(serverPort, bounds) {
  try {
    await fetch(`http://localhost:${serverPort}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windowBounds: bounds }),
    });
  } catch {
    // non-fatal
  }
}
