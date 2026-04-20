# Shelf UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Shelf's UX from first principles: explicit stages (CULL/HEROES/FINAL), dedicated marking keys, optimistic sync, consolidated actions, drag-drop ingest, and progressive depth.

**Architecture:** Introduce stage-awareness as first-class state. Split concerns into small focused modules: `stage.js` for stage tracking, `mark-queue.js` for optimistic sync, `ingest.js` for entry flows, `hints.js` for discoverability. Keep all existing backend APIs; only add stage detection and recentShoots persistence.

**Tech Stack:** Vanilla JS ES modules, Express 5, event bus pattern. Node's built-in `node:test` for server logic.

**Spec:** `docs/superpowers/specs/2026-04-08-ux-redesign-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `server/lib/stages.js` | Create | Detect stage from source path (CULL/HEROES/FINAL) |
| `server/routes/images.js` | Modify | Return `stage` field in folder metadata |
| `server/routes/config.js` | Modify | Add `recentShoots` to allowed config keys, add push-recent endpoint |
| `server/test/stages.test.js` | Create | Unit tests for stage detection |
| `client/src/stage.js` | Create | Client-side stage tracking + event |
| `client/src/mark-queue.js` | Create | Debounced batch marking with rollback |
| `client/src/ingest.js` | Create | Drag-drop + smart folder detection + recent shoots |
| `client/src/hints.js` | Create | Persistent `?` button, coach marks, hint strip |
| `client/src/events.js` | Modify | Add STAGE_CHANGED, MARK_ROLLBACK |
| `client/src/selection.js` | Modify | Simplified click model using mark-queue |
| `client/src/keyboard.js` | Modify | P/F/X/U dedicated keys, remove cycling |
| `client/src/actions.js` | Modify | Stage-aware buttons, add Promote to Favorites |
| `client/src/main.js` | Modify | Remove duplicate header buttons, add bridge cards, integrate ingest |
| `client/src/grid.js` | Modify | Drag-drop handling on root container, simplified click |
| `client/styles/` | Modify | Minor styles for stage pill, hint strip, coach marks |

---

## Task 1: Server — Stage Detection Module

**Files:**
- Create: `server/lib/stages.js`
- Create: `server/test/stages.test.js`

- [ ] **Step 1: Write failing test**

Create `server/test/stages.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStage } from '../lib/stages.js';

test('detectStage: Favorites subfolder is FINAL', () => {
  assert.equal(detectStage('/Users/ava/Pictures/sorted/Keeps - 04-2026 - Shoot/Favorites'), 'FINAL');
});

test('detectStage: Favorites - MM-YYYY folder is FINAL', () => {
  assert.equal(detectStage('/Users/ava/Pictures/sorted/Favorites - 04-2026 - Shoot'), 'FINAL');
});

test('detectStage: Keeps - MM-YYYY folder is HEROES', () => {
  assert.equal(detectStage('/Users/ava/Pictures/sorted/Keeps - 04-2026 - Kat x Tsuki'), 'HEROES');
});

test('detectStage: arbitrary folder is CULL', () => {
  assert.equal(detectStage('/Users/ava/media/photography/2026-04 - Shoot/unsorted'), 'CULL');
});

test('detectStage: empty path defaults to CULL', () => {
  assert.equal(detectStage(''), 'CULL');
});

test('detectStage: trailing slash does not break detection', () => {
  assert.equal(detectStage('/some/Keeps - 04-2026 - X/'), 'HEROES');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/projects/elf/photography-shelf && node --test server/test/stages.test.js
```

Expected: FAIL, "Cannot find module ../lib/stages.js"

- [ ] **Step 3: Implement stages.js**

Create `server/lib/stages.js`:

```js
import path from 'path';

const KEEPS_RE = /^Keeps\s*-\s*\d{2}-\d{4}\s*-\s*.+$/i;
const FAV_FOLDER_RE = /^Favorites\s*-\s*\d{2}-\d{4}\s*-\s*.+$/i;

export function detectStage(sourcePath) {
  if (!sourcePath || typeof sourcePath !== 'string') return 'CULL';

  const normalized = sourcePath.replace(/\/+$/, '');
  const basename = path.basename(normalized);

  if (basename === 'Favorites') return 'FINAL';
  if (FAV_FOLDER_RE.test(basename)) return 'FINAL';
  if (KEEPS_RE.test(basename)) return 'HEROES';

  return 'CULL';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/projects/elf/photography-shelf && node --test server/test/stages.test.js
```

Expected: PASS, 6/6 tests

- [ ] **Step 5: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add server/lib/stages.js server/test/stages.test.js
git commit -m "feat: add server-side stage detection (CULL/HEROES/FINAL)"
```

---

## Task 2: Server — Include Stage in API + Recent Shoots

**Files:**
- Modify: `server/routes/images.js` (add stage to `/images` response)
- Modify: `server/routes/config.js` (add `recentShoots` allowlist + `/recent-shoots` endpoints)

- [ ] **Step 1: Add stage field to `/api/images` response**

In `server/routes/images.js`, add import at the top (after line 5):

```js
import { detectStage } from '../lib/stages.js';
```

Replace the `/images` endpoint response (lines 25-40) to include stage:

```js
imageRoutes.get('/images', (req, res) => {
  const source = resolveSource(req.query);
  if (!source || !fs.existsSync(source)) {
    return res.json({ images: [], stage: 'CULL' });
  }
  try {
    const files = fs
      .readdirSync(source)
      .filter((f) => VALID_FILENAME.test(f))
      .sort();
    const state = getState(source);
    const images = files.map((f) => ({ filename: f, status: state[f] || 'unmarked' }));
    res.json({ images, stage: detectStage(source) });
  } catch {
    res.json({ images: [], stage: 'CULL' });
  }
});
```

- [ ] **Step 2: Update client callers for new `/api/images` shape**

Search existing client code for `.json()` handling of `/api/images`:

```bash
cd ~/projects/elf/photography-shelf && grep -n "fetch.*api/images" client/src/*.js
```

In `client/src/main.js`, in the `loadSource` function, change:

```js
    const res = await fetch(`/api/images?source=${encodeURIComponent(dir)}`);
    const images = await res.json();
```

to:

```js
    const res = await fetch(`/api/images?source=${encodeURIComponent(dir)}`);
    const data = await res.json();
    const images = Array.isArray(data) ? data : data.images;
    const stage = Array.isArray(data) ? 'CULL' : data.stage;
```

And update the `setGridData(images, source, '', 'card')` line to pass stage:

```js
    bus.emit(EVENTS.MODE_CHANGED, { newMode: 'card', newSource: source, newFolder: '', stage });
    setGridData(images, source, '', 'card');
```

Same change in the `refresh` function at the bottom of main.js — replace:

```js
    const res = await fetch(`/api/images?source=${encodeURIComponent(source)}`);
    const images = await res.json();
```

with:

```js
    const res = await fetch(`/api/images?source=${encodeURIComponent(source)}`);
    const data = await res.json();
    const images = Array.isArray(data) ? data : data.images;
```

Similarly, update `client/src/actions.js` where it fetches `/api/images` for favorites folder detection. Change:

```js
    const res = await fetch(`/api/images?source=${encodeURIComponent(favPath)}`);
    hasFavoritesFolder = res.ok;
```

to:

```js
    const res = await fetch(`/api/images?source=${encodeURIComponent(favPath)}`);
    hasFavoritesFolder = res.ok;
```

(no change needed — only checks `res.ok`)

- [ ] **Step 3: Add recentShoots to config allowlist**

In `server/routes/config.js`, find the `allowed` array (around line 21) and update:

```js
  const allowed = ['sortDir', 'thumbSize', 'defaultSource', 'recentShoots', 'hintStripVisible', 'windowBounds'];
```

Add a dedicated endpoint for pushing a recent shoot (easier than full config PUT). After the existing config endpoints:

```js
// Push a path onto the recent shoots list (dedup, cap at 10)
configRoutes.post('/recent-shoots/push', (req, res) => {
  const { path: p } = req.body;
  if (!p || typeof p !== 'string') {
    return res.status(400).json({ error: 'path required' });
  }
  const current = getConfig();
  const list = Array.isArray(current.recentShoots) ? current.recentShoots : [];
  const deduped = [p, ...list.filter(x => x !== p)].slice(0, 10);
  current.recentShoots = deduped;
  setConfig(current);
  res.json({ recentShoots: deduped });
});
```

- [ ] **Step 4: Manual verify**

Start the app, call the endpoint:

```bash
curl -s -X POST http://localhost:23714/api/recent-shoots/push \
  -H 'Content-Type: application/json' \
  -d '{"path":"/tmp/testshoot"}' | python3 -m json.tool
```

Expected: `{ "recentShoots": ["/tmp/testshoot"] }`

```bash
curl -s http://localhost:23714/api/config | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('recentShoots'))"
```

Expected: `['/tmp/testshoot']`

- [ ] **Step 5: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add server/routes/images.js server/routes/config.js client/src/main.js
git commit -m "feat: return stage in /api/images and persist recentShoots"
```

---

## Task 3: Client — Stage Tracking Module + Events

**Files:**
- Create: `client/src/stage.js`
- Modify: `client/src/events.js`
- Modify: `client/src/main.js` (pass stage through MODE_CHANGED)

- [ ] **Step 1: Add events**

In `client/src/events.js`, add inside the `EVENTS` object (after `REFRESH`):

```js
  STAGE_CHANGED: 'stage:changed',
  MARK_ROLLBACK: 'mark:rollback',
```

- [ ] **Step 2: Create stage.js**

Create `client/src/stage.js`:

```js
// Client-side stage tracking (CULL / HEROES / FINAL)

import { bus, EVENTS } from './events.js';

let currentStage = 'CULL';

export function initStage() {
  bus.on(EVENTS.MODE_CHANGED, ({ stage }) => {
    const newStage = stage || 'CULL';
    if (newStage !== currentStage) {
      currentStage = newStage;
      bus.emit(EVENTS.STAGE_CHANGED, { stage: currentStage });
    }
  });
}

export function getStage() {
  return currentStage;
}
```

- [ ] **Step 3: Wire initStage into main.js**

In `client/src/main.js`, add import (after the other imports):

```js
import { initStage, getStage } from './stage.js';
```

Call `initStage()` inside the `DOMContentLoaded` handler, right after `initUndo();`:

```js
  initStage();
```

- [ ] **Step 4: Manual verify**

Add temporary console log to verify — in stage.js inside the handler:

```js
    if (newStage !== currentStage) {
      currentStage = newStage;
      console.log('[stage]', currentStage);
      bus.emit(EVENTS.STAGE_CHANGED, { stage: currentStage });
    }
```

Open the app, load the Kat x Tsuki Favorites folder, verify console logs `[stage] FINAL`. Load an unsorted folder, verify `[stage] CULL`. Remove the console.log after verifying.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/events.js client/src/stage.js client/src/main.js
git commit -m "feat: client-side stage tracking module"
```

---

## Task 4: Client — New Keybindings (P/F/X/U)

**Files:**
- Modify: `client/src/selection.js` (add `markKeep`, `markFavorite`, `markReject`, `unmark` + advance helper)
- Modify: `client/src/keyboard.js` (replace P cycle with direct keys, add F/U)

- [ ] **Step 1: Add direct mark functions to selection.js**

In `client/src/selection.js`, replace the existing `cycleAndAdvance` export with a set of direct mark+advance functions. Keep the existing `markSingle` and `batchMark` internals.

Replace this block (the `cycleAndAdvance` function — around lines 94-118):

```js
// Cycle current image and advance to next unmarked (P key)
export function cycleAndAdvance() {
  const images = getImages();
  let index = getSelectedIndex();
  if (index < 0) index = 0;
  if (index >= images.length) return;

  const current = images[index].status || 'unmarked';
  const newStatus = nextInCycle(current === 'reject' ? 'unmarked' : current);
  markSingle(index, newStatus);

  // If we just marked it (not back to unmarked), advance to next unmarked
  if (newStatus !== 'unmarked') {
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
}
```

with direct mark functions:

```js
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
```

Remove the now-unused `CYCLE` array and `nextInCycle` function from selection.js.

Update `handleSelect` to not cycle (click = toggle keep):

Replace the existing `handleSelect` function body (around lines 31-59):

```js
function handleSelect({ index, meta, shift }) {
  const images = getImages();
  if (index < 0 || index >= images.length) return;

  if (shift) {
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
```

Add a new exported function for double-click = favorite:

```js
export function toggleFavorite(index) {
  const images = getImages();
  if (index < 0 || index >= images.length) return;
  const img = images[index];
  const currentStatus = img.status || 'unmarked';
  const newStatus = currentStatus === 'favorite' ? 'unmarked' : 'favorite';
  markSingle(index, newStatus);
  setSelectedIndex(index);
}
```

- [ ] **Step 2: Update keyboard.js for new keys**

In `client/src/keyboard.js`, replace the imports from selection.js:

```js
import { keepAndAdvance, favoriteAndAdvance, rejectAndAdvance, unmarkAndAdvance } from './selection.js';
```

Replace the P/X key handling block (around lines 93-103) with P/F/X/U:

```js
    case 'p':
    case 'P':
      e.preventDefault();
      keepAndAdvance();
      break;

    case 'f':
    case 'F':
      e.preventDefault();
      favoriteAndAdvance();
      break;

    case 'x':
    case 'X':
      e.preventDefault();
      rejectAndAdvance();
      break;

    case 'u':
    case 'U':
      e.preventDefault();
      unmarkAndAdvance();
      break;
```

Update the shortcuts overlay text (inside `showShortcutsOverlay`) — replace the "Sorting" section:

```js
      <div class="shortcut-group">
        <h3>Marking</h3>
        <div class="shortcut-row"><span class="desc">Keep</span><span class="keys">P</span></div>
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
```

- [ ] **Step 3: Update grid.js double-click handler**

In `client/src/grid.js`, after the `click` handler inside `renderGrid`, add a `dblclick` handler:

```js
    card.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      bus.emit('select:favorite', { index: i });
    });
```

In `client/src/selection.js`, add a bus listener inside `initSelection`:

```js
  bus.on('select:favorite', ({ index }) => toggleFavorite(index));
```

- [ ] **Step 4: Manual verify**

Start the app, load a folder with images. Verify:
- P marks image as keep (green badge) and advances
- F marks image as favorite (gold badge) and advances
- X marks image as reject and advances
- U unmarks and advances
- Click toggles keep
- Double-click toggles favorite
- Cmd+click toggles reject
- Shift+click marks range as keep
- Shift+Cmd+click marks range as reject

- [ ] **Step 5: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/selection.js client/src/keyboard.js client/src/grid.js
git commit -m "feat: dedicated P/F/X/U keys replace P cycle; dblclick=favorite"
```

---

## Task 5: Client — Optimistic Marking Queue

**Files:**
- Create: `client/src/mark-queue.js`
- Modify: `client/src/selection.js` (route all marks through the queue)

- [ ] **Step 1: Create mark-queue.js**

Create `client/src/mark-queue.js`:

```js
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
```

- [ ] **Step 2: Wire selection.js to use the queue**

In `client/src/selection.js`, add import:

```js
import { enqueueMark } from './mark-queue.js';
```

Replace the `markSingle` function — update it to use the queue instead of direct fetch:

```js
export async function markSingle(index, status) {
  const images = getImages();
  const img = images[index];

  updateCardStatus(index, status);
  bus.emit(EVENTS.IMAGE_MARKED, { index, status });

  enqueueMark(img.filename, status);
}
```

Update `batchMark` — keep its behavior but also go through the queue. Replace the body:

```js
async function batchMark(start, end, status) {
  const images = getImages();
  const filenames = [];

  for (let i = start; i <= end; i++) {
    filenames.push(images[i].filename);
    updateCardStatus(i, status);
    enqueueMark(images[i].filename, status);
  }

  bus.emit(EVENTS.BATCH_MARKED, { start, end, status });
}
```

- [ ] **Step 3: Initialize the queue in main.js**

In `client/src/main.js`, add import:

```js
import { initMarkQueue } from './mark-queue.js';
```

Call it in the `DOMContentLoaded` handler, after `initSelection()`:

```js
  initMarkQueue();
```

- [ ] **Step 4: Manual verify**

Open the app, load a folder. Open browser DevTools → Network tab. Hold down P to rapidly mark many images. Verify:
- Marks appear instantly in the grid (optimistic)
- Network requests are coalesced — you see fewer `/api/mark-batch` requests than key presses (ideally 1 request per burst)
- Killing the network (DevTools offline mode) and marking still updates UI; reconnecting shows a rollback toast or the mark gets re-queued on next action

- [ ] **Step 5: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/mark-queue.js client/src/selection.js client/src/main.js
git commit -m "feat: optimistic marking with debounced batch sync (150ms)"
```

---

## Task 6: Client — Stage-Aware Action Bar + Promote to Favorites

**Files:**
- Modify: `client/src/actions.js` (stage-based visibility, add Promote to Favorites)
- Modify: `client/src/main.js` (handle `action:promote-favorites`)

- [ ] **Step 1: Rewrite actions.js for stage-awareness**

Replace the full contents of `client/src/actions.js`:

```js
// Floating batch action bar — stage-aware

import { bus, EVENTS } from './events.js';
import { getImages } from './grid.js';
import { getStage } from './stage.js';

let actionsEl = null;
let hasConvertible = false;
let hasFavoritesFolder = false;
let currentSource = '';

export function initActions() {
  actionsEl = document.getElementById('actions');

  bus.on(EVENTS.STATE_CHANGED, updateActions);
  bus.on(EVENTS.IMAGE_MARKED, updateActions);
  bus.on(EVENTS.BATCH_MARKED, updateActions);
  bus.on(EVENTS.STAGE_CHANGED, updateActions);
  bus.on(EVENTS.MODE_CHANGED, ({ newSource }) => {
    currentSource = newSource || '';
    checkConvertible();
    checkFavoritesFolder();
  });
  bus.on(EVENTS.CONVERT_COMPLETE, () => {
    checkConvertible();
    checkFavoritesFolder();
  });
  bus.on(EVENTS.REFRESH, () => {
    checkConvertible();
    checkFavoritesFolder();
  });
}

async function checkConvertible() {
  if (!currentSource) {
    hasConvertible = false;
    updateActions();
    return;
  }
  try {
    const res = await fetch(`/api/has-convertible?source=${encodeURIComponent(currentSource)}`);
    const data = await res.json();
    hasConvertible = data.hasConvertible;
  } catch {
    hasConvertible = false;
  }
  updateActions();
}

async function checkFavoritesFolder() {
  if (!currentSource) {
    hasFavoritesFolder = false;
    return;
  }
  if (currentSource.endsWith('/Favorites')) {
    hasFavoritesFolder = true;
    updateActions();
    return;
  }
  const favPath = currentSource + '/Favorites';
  try {
    const res = await fetch(`/api/images?source=${encodeURIComponent(favPath)}`);
    hasFavoritesFolder = res.ok;
  } catch {
    hasFavoritesFolder = false;
  }
  updateActions();
}

function countMarks(images) {
  let keeps = 0, favs = 0, rejects = 0;
  for (const i of images) {
    const s = i.status || 'unmarked';
    if (s === 'keep') keeps++;
    else if (s === 'favorite') favs++;
    else if (s === 'reject') rejects++;
  }
  return { keeps, favs, rejects, total: keeps + favs + rejects };
}

function updateActions() {
  if (!actionsEl) return;
  const images = getImages();
  const { keeps, favs, rejects, total } = countMarks(images);
  const stage = getStage();

  const buttons = [];

  if (stage === 'CULL' && total > 0) {
    buttons.push(`<button class="btn btn-primary" id="action-sort">Sort to Folders</button>`);
  }

  if (stage === 'HEROES' && favs > 0) {
    buttons.push(`<button class="btn btn-primary" id="action-promote">Promote ${favs} to Favorites</button>`);
  }

  if (stage === 'FINAL' && hasConvertible) {
    buttons.push(`<button class="btn btn-gold" id="action-convert">Convert to DNG</button>`);
  }

  if (stage === 'FINAL' && hasFavoritesFolder) {
    buttons.push(`<button class="btn btn-muted" id="action-open-editor">Edit in Lightroom</button>`);
  }
  // Also allow Lightroom handoff from HEROES if Favorites subfolder exists
  if (stage === 'HEROES' && hasFavoritesFolder) {
    buttons.push(`<button class="btn btn-muted" id="action-open-editor">Edit Favorites in Lightroom</button>`);
  }

  if (buttons.length === 0) {
    actionsEl.classList.remove('visible');
    actionsEl.innerHTML = '';
    return;
  }

  actionsEl.classList.add('visible');

  let countHtml = '';
  if (total > 0) {
    const parts = [];
    if (keeps) parts.push(`${keeps} keep`);
    if (favs) parts.push(`${favs} fav`);
    if (rejects) parts.push(`${rejects} reject`);
    countHtml = `<span class="action-count">${parts.join(', ')}</span>`;
  }

  actionsEl.innerHTML = countHtml + buttons.join('');

  document.getElementById('action-sort')?.addEventListener('click', () => bus.emit('action:sort'));
  document.getElementById('action-promote')?.addEventListener('click', () => bus.emit('action:promote-favorites'));
  document.getElementById('action-convert')?.addEventListener('click', () => bus.emit('action:convert'));
  document.getElementById('action-open-editor')?.addEventListener('click', () => bus.emit('action:open-editor'));
}
```

- [ ] **Step 2: Add handler for Promote to Favorites in main.js**

In `client/src/main.js`, inside the `DOMContentLoaded` handler after the other action listeners:

```js
  bus.on('action:promote-favorites', handlePromoteFavorites);
```

Add the handler function (near `handleConvert` and `handleOpenEditor`):

```js
async function handlePromoteFavorites() {
  const images = getImages();
  const favs = images.filter(i => (i.status || 'unmarked') === 'favorite');

  if (favs.length === 0) {
    showToast('No favorites marked', 'error');
    return;
  }

  const confirmed = await showConfirmModal(
    'Promote Favorites',
    `Move ${favs.length} favorite image${favs.length !== 1 ? 's' : ''} into the Favorites subfolder?`,
  );
  if (!confirmed) return;

  // The current source is a Keeps folder; extract folder name for the API
  const folderName = source.split('/').pop();

  try {
    // First, persist favorites to the .favorites-state.json file (parallel)
    await Promise.all(favs.map(img =>
      fetch(`/api/folder/${encodeURIComponent(folderName)}/mark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: img.filename, status: 'favorite' }),
      })
    ));

    // Then trigger the save-favorites move
    const res = await fetch(`/api/folder/${encodeURIComponent(folderName)}/save-favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();

    showToast(`Promoted ${data.moved} image${data.moved !== 1 ? 's' : ''} to Favorites`, 'success');

    // Show bridge card
    showPromoteBridge(data.moved, folderName);
  } catch (e) {
    showToast('Promote failed: ' + e.message, 'error');
  }
}

function showPromoteBridge(count, folderName) {
  const overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = `
    <div class="modal">
      <h2>Promoted ${count} to Favorites</h2>
      <p>Your heroes are saved in the Favorites subfolder.</p>
      <div class="modal-buttons">
        <button class="btn btn-muted" id="bridge-done">Done</button>
        <button class="btn btn-muted" id="bridge-keep-reviewing">Keep Reviewing</button>
        <button class="btn btn-primary" id="bridge-open-favorites">Open Favorites</button>
      </div>
    </div>
  `;
  overlay.classList.add('active');

  const close = () => overlay.classList.remove('active');

  document.getElementById('bridge-done').addEventListener('click', () => {
    close();
    mode = 'idle';
    source = '';
    renderHeader();
    showEmptyState();
  });
  document.getElementById('bridge-keep-reviewing').addEventListener('click', () => {
    close();
    bus.emit(EVENTS.REFRESH);
  });
  document.getElementById('bridge-open-favorites').addEventListener('click', () => {
    close();
    loadSource(source + '/Favorites');
  });
}
```

- [ ] **Step 3: Manual verify**

Navigate into a Keeps folder, mark a few as favorite with F key, click "Promote N to Favorites" button. Verify:
- Confirmation modal appears
- On confirm: backend moves files to `Favorites/` subfolder
- Bridge card appears with three options
- "Open Favorites" navigates into the new subfolder
- "Keep Reviewing" stays and refreshes (favorites should now be gone from the grid)
- "Done" resets to empty state

- [ ] **Step 4: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/actions.js client/src/main.js
git commit -m "feat: stage-aware action bar + Promote to Favorites flow"
```

---

## Task 7: Client — Post-Sort Bridge Card

**Files:**
- Modify: `client/src/main.js` (replace post-sort reset with bridge card)

- [ ] **Step 1: Replace handleSort to use the bridge**

In `client/src/main.js`, replace the `handleSort` function body. The existing function ends with resetting mode to idle. Change it to show a bridge card instead:

Replace the block starting `try {` through the end of `handleSort`:

```js
  try {
    const res = await fetch('/api/sort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, source }),
    });
    const data = await res.json();

    if (data.errors) {
      showToast(`${data.errors.length} files had errors`, 'error');
    }

    // Compute the keeps folder path to enable "Pick Heroes" bridge button
    const now = new Date();
    const dateStr = String(now.getMonth() + 1).padStart(2, '0') + '-' + now.getFullYear();
    const safeName = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    const sortDir = config.sortDir || '';
    const keepsPath = sortDir ? `${sortDir}/Keeps - ${dateStr} - ${safeName}` : null;

    showSortBridge(data.moved, keepsPath);
  } catch (e) {
    showToast('Sort failed: ' + e.message, 'error');
  }
}

function showSortBridge(moved, keepsPath) {
  const overlay = document.getElementById('modal-overlay');
  const total = Object.values(moved).reduce((a, b) => a + b, 0);
  const parts = [];
  if (moved.keep) parts.push(`${moved.keep} keeps`);
  if (moved.favorite) parts.push(`${moved.favorite} sparks`);
  if (moved.reject) parts.push(`${moved.reject} rejects`);
  if (moved.unsorted) parts.push(`${moved.unsorted} unsorted`);

  overlay.innerHTML = `
    <div class="modal">
      <h2>Sorted ${total} images</h2>
      <p>${parts.join(' · ')}</p>
      <div class="modal-buttons">
        <button class="btn btn-muted" id="bridge-done">Done</button>
        <button class="btn btn-muted" id="bridge-new">Start New Shoot</button>
        ${keepsPath ? `<button class="btn btn-primary" id="bridge-heroes">Pick Heroes</button>` : ''}
      </div>
    </div>
  `;
  overlay.classList.add('active');

  const close = () => overlay.classList.remove('active');

  document.getElementById('bridge-done').addEventListener('click', () => {
    close();
    mode = 'idle';
    source = '';
    renderHeader();
    showEmptyState();
  });
  document.getElementById('bridge-new').addEventListener('click', () => {
    close();
    mode = 'idle';
    source = '';
    renderHeader();
    showEmptyState();
    selectDirectory();
  });
  document.getElementById('bridge-heroes')?.addEventListener('click', () => {
    close();
    loadSource(keepsPath);
  });
}
```

- [ ] **Step 2: Manual verify**

Load a folder with raw images, mark a few as keep/favorite/reject, click "Sort to Folders", enter a name, confirm. Verify:
- After sort completes, a bridge card appears (not the welcome screen)
- "Pick Heroes" button appears if there are keeps
- Clicking "Pick Heroes" navigates into the new Keeps folder (stage indicator should show HEROES)
- "Start New Shoot" opens the folder picker
- "Done" returns to empty state

- [ ] **Step 3: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/main.js
git commit -m "feat: post-sort bridge card replaces immediate reset to welcome"
```

---

## Task 8: Client — Remove Duplicate Header Buttons

**Files:**
- Modify: `client/src/main.js` (strip `renderHeader` of duplicated action buttons)

- [ ] **Step 1: Simplify renderHeader**

In `client/src/main.js`, update the `renderHeader` function's `card` mode branch. Replace it with a cleaner header that has stage pill + stats + navigation only (no action buttons):

```js
  } else if (mode === 'card') {
    const images = getImages();
    const { keeps, favs, rejects, total } = (() => {
      let k = 0, f = 0, r = 0;
      for (const i of images) {
        const s = i.status || 'unmarked';
        if (s === 'keep') k++;
        else if (s === 'favorite') f++;
        else if (s === 'reject') r++;
      }
      return { keeps: k, favs: f, rejects: r, total: k + f + r };
    })();
    const unsorted = images.length - total;
    const hasMarks = total > 0;
    const stage = getStage();

    header.innerHTML = `
      <div class="elf-corner" id="header-elf"></div>
      <h1>Shelf</h1>
      <span class="stage-pill stage-${stage.toLowerCase()}">${stage}</span>
      <span class="stat stat-keep">${keeps} keep</span>
      <span class="stat stat-favorite">${favs} fav</span>
      <span class="stat stat-reject">${rejects} reject</span>
      <span class="stat stat-unsorted">${unsorted} unsorted</span>
      <div class="header-spacer"></div>
      <div class="thumb-slider">
        <label>Size</label>
        <input type="range" min="150" max="500" value="280" id="thumb-slider">
      </div>
      ${hasMarks ? '<button class="btn btn-muted" id="btn-deselect-all">Deselect All</button>' : ''}
      <button class="btn btn-muted" id="btn-scan-camera">Scan Card</button>
      <button class="btn btn-gold" id="btn-select-dir">New Shoot</button>
    `;
  }
```

- [ ] **Step 2: Update bindHeaderButtons**

Since the header no longer has sort/open-editor buttons, simplify `bindHeaderButtons`:

```js
function bindHeaderButtons() {
  document.getElementById('btn-scan-camera')?.addEventListener('click', scanForCamera);
  document.getElementById('btn-select-dir')?.addEventListener('click', selectDirectory);
  document.getElementById('btn-deselect-all')?.addEventListener('click', async () => {
    await deselectAll();
    renderHeader();
  });
}
```

- [ ] **Step 3: Add stage pill styles**

In `client/styles/`, find the main styles file (likely `main.css` or similar). If there's no single file, use `client/styles/layout.css` or create a new `client/styles/stage.css` imported from `client/index.html`.

Check for existing styles:

```bash
ls client/styles/
```

Add to the most appropriate CSS file (or create `client/styles/stage.css` and import it):

```css
.stage-pill {
  display: inline-block;
  padding: 2px 10px;
  margin: 0 10px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  font-family: 'Monaspace Neon', monospace;
}
.stage-pill.stage-cull {
  background: rgba(137, 180, 250, 0.15);
  color: #89b4fa;
  border: 1px solid rgba(137, 180, 250, 0.3);
}
.stage-pill.stage-heroes {
  background: rgba(249, 226, 175, 0.15);
  color: #f9e2af;
  border: 1px solid rgba(249, 226, 175, 0.3);
}
.stage-pill.stage-final {
  background: rgba(166, 227, 161, 0.15);
  color: #a6e3a1;
  border: 1px solid rgba(166, 227, 161, 0.3);
}
```

If you create a new CSS file, import it in `client/index.html`:

```html
<link rel="stylesheet" href="./styles/stage.css">
```

- [ ] **Step 4: Re-render header on stage change**

In main.js, inside `DOMContentLoaded`, add:

```js
  bus.on(EVENTS.STAGE_CHANGED, () => renderHeader());
```

- [ ] **Step 5: Manual verify**

Load folders of different stages and verify:
- Stage pill shows CULL (blue) in unsorted folders
- Stage pill shows HEROES (gold) in `Keeps - MM-YYYY - Name` folders
- Stage pill shows FINAL (green) in `Favorites/` subfolders
- Header no longer has "Sort to Folders" or "Edit Favorites" duplicated — those live only in the floating action bar

- [ ] **Step 6: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/main.js client/styles/ client/index.html
git commit -m "feat: stage pill in header, remove duplicate action buttons"
```

---

## Task 9: Client — Drag-Drop Folder Ingest

**Files:**
- Create: `client/src/ingest.js`
- Modify: `client/src/main.js` (init ingest)
- Modify: `client/src/grid.js` (or app root element) for drop target

- [ ] **Step 1: Create ingest.js**

Create `client/src/ingest.js`:

```js
// Unified ingest: drag-drop folders, smart auto-load, recent shoots

import { bus, EVENTS } from './events.js';

let onFolderDropped = null;

export function initIngest(handleFolderDropped) {
  onFolderDropped = handleFolderDropped;

  const app = document.body;

  app.addEventListener('dragover', (e) => {
    e.preventDefault();
    app.classList.add('drag-over');
  });

  app.addEventListener('dragleave', (e) => {
    // Only remove if we left the window entirely
    if (e.target === app || !app.contains(e.relatedTarget)) {
      app.classList.remove('drag-over');
    }
  });

  app.addEventListener('drop', async (e) => {
    e.preventDefault();
    app.classList.remove('drag-over');

    const items = Array.from(e.dataTransfer.items || []);
    for (const item of items) {
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry && entry.isDirectory) {
        // Get the absolute path from the file
        const file = item.getAsFile();
        if (file && file.path) {
          // Electron provides file.path; in browser we only have the name
          onFolderDropped(file.path);
          return;
        }
        // Fallback: ask user to use Select Directory (browser restriction)
        bus.emit(EVENTS.TOAST, {
          message: 'Drag-drop only works in the desktop app. Use "New Shoot" instead.',
          type: 'error',
        });
        return;
      }
    }
  });
}

export async function pushRecentShoot(p) {
  try {
    await fetch('/api/recent-shoots/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p }),
    });
  } catch {
    // non-fatal
  }
}

export async function getRecentShoots() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    return Array.isArray(cfg.recentShoots) ? cfg.recentShoots : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Wire ingest in main.js**

Add import at the top:

```js
import { initIngest, pushRecentShoot, getRecentShoots } from './ingest.js';
```

Inside `DOMContentLoaded`, add:

```js
  initIngest((folderPath) => {
    loadSource(folderPath);
  });
```

In `loadSource`, after the successful load (after `setGridData(...)`), add:

```js
    pushRecentShoot(source).catch(() => {});
```

- [ ] **Step 3: Add drag-over visual style**

Add to stage.css (or the styles file):

```css
body.drag-over::after {
  content: 'Drop folder to load';
  position: fixed;
  inset: 0;
  background: rgba(30, 30, 46, 0.85);
  color: #f9e2af;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 10000;
  border: 3px dashed #f9e2af;
  font-family: 'Monaspace Neon', monospace;
}
```

- [ ] **Step 4: Manual verify**

- Drag a folder from Finder onto the app window. Verify: drop overlay appears. (Note: in pure browser Vite, `file.path` is undefined, so a toast appears instead telling the user to use New Shoot. In Electron it will actually load.)
- After loading any folder via Select Directory, check `~/.shelf/config.json` for `recentShoots` array updated with the path

```bash
cat ~/.shelf/config.json | python3 -m json.tool | head -20
```

- [ ] **Step 5: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/ingest.js client/src/main.js client/styles/
git commit -m "feat: drag-drop folder ingest + recent shoots persistence"
```

---

## Task 10: Client — Recent Shoots Menu + Smart Folder Detection

**Files:**
- Modify: `client/src/main.js` (add Recent dropdown in header, smart auto-load)

- [ ] **Step 1: Add Recent button to welcome screen**

In `client/src/main.js`, update `showEmptyState` to add a recent-shoots section. Replace the `empty.innerHTML` assignment:

```js
  empty.innerHTML = `
    <div id="empty-elf"></div>
    <h2>Welcome to Shelf</h2>
    <p>Scan a camera card, pick a folder, or drop one in.</p>
    <div class="empty-actions">
      <button class="btn btn-primary" id="empty-scan-camera">Scan Card</button>
      <button class="btn btn-gold" id="empty-select-dir">New Shoot</button>
    </div>
    <div id="recent-shoots"></div>
  `;
```

After the createElf call, render recent shoots:

```js
  getRecentShoots().then(list => {
    const el = document.getElementById('recent-shoots');
    if (!el || list.length === 0) return;
    el.innerHTML = `
      <h3 style="margin-top:32px;color:var(--tan);font-size:14px">Recent shoots</h3>
      ${list.map(p => `
        <button class="folder-btn recent-btn" data-path="${p}" style="max-width:600px;margin:4px auto;display:block;text-align:left">
          ${p.split('/').slice(-2).join('/')}
        </button>
      `).join('')}
    `;
    el.querySelectorAll('.recent-btn').forEach(btn => {
      btn.addEventListener('click', () => loadSource(btn.dataset.path));
    });
  });
```

- [ ] **Step 2: Smart folder auto-load**

Update the `selectDirectory` function in main.js. Current logic only auto-loads if `listing.shoots.length === 0 && listing.otherFolders.length === 0 && listing.rootImageCount > 0`. Extend this to also auto-load when there's exactly one shoot with a single obvious folder:

Replace the auto-load block (around lines 193-196):

```js
    // Smart auto-load: if only one obvious destination, skip the picker
    const shoots = listing.shoots || [];
    const other = listing.otherFolders || [];

    // Case 1: just loose images at root
    if (shoots.length === 0 && other.length === 0 && listing.rootImageCount > 0) {
      await loadSource(listing.path);
      return;
    }

    // Case 2: single shoot with a single non-empty subfolder
    if (shoots.length === 1 && other.length === 0 && listing.rootImageCount === 0) {
      const shoot = shoots[0];
      const nonEmptyFolders = Object.entries(shoot.folders || {})
        .filter(([, f]) => f.count > 0);
      if (nonEmptyFolders.length === 1) {
        await loadSource(nonEmptyFolders[0][1].path);
        return;
      }
    }

    // Case 3: single plain folder with images
    if (shoots.length === 0 && other.length === 1) {
      await loadSource(other[0].path);
      return;
    }
```

- [ ] **Step 3: Manual verify**

- Restart the app
- On welcome screen, verify recent shoots list appears (after you've loaded folders at least once)
- Click a recent shoot → loads directly
- Run Select Directory on a folder containing a single shoot with one populated subfolder → should auto-load, skipping the shoot-list modal

- [ ] **Step 4: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/main.js
git commit -m "feat: recent shoots menu + smarter auto-load (skip modal when obvious)"
```

---

## Task 11: Client — Persistent `?` Button + First-Run Coach Marks

**Files:**
- Create: `client/src/hints.js`
- Modify: `client/src/main.js` (init hints)

- [ ] **Step 1: Create hints.js**

Create `client/src/hints.js`:

```js
// Progressive depth disclosure:
// - Persistent '?' button in the corner (shortcuts overlay)
// - First-run coach marks on first image load

import { bus, EVENTS } from './events.js';

const COACH_KEY = 'shelf.coachMarksSeen.v1';

export function initHints() {
  addHelpButton();
  bus.on(EVENTS.MODE_CHANGED, ({ newMode }) => {
    if (newMode === 'card' && !localStorage.getItem(COACH_KEY)) {
      showCoachMarks();
      localStorage.setItem(COACH_KEY, '1');
    }
  });
}

function addHelpButton() {
  if (document.getElementById('help-button')) return;
  const btn = document.createElement('button');
  btn.id = 'help-button';
  btn.className = 'help-button';
  btn.textContent = '?';
  btn.title = 'Keyboard shortcuts';
  btn.addEventListener('click', () => {
    const event = new KeyboardEvent('keydown', { key: '?' });
    document.dispatchEvent(event);
  });
  document.body.appendChild(btn);
}

function showCoachMarks() {
  const coach = document.createElement('div');
  coach.className = 'coach-marks';
  coach.innerHTML = `
    <div class="coach-marks-inner">
      <strong>P</strong> keep &middot;
      <strong>F</strong> favorite &middot;
      <strong>X</strong> reject &middot;
      <strong>Space</strong> preview &middot;
      <strong>?</strong> more
    </div>
  `;
  document.body.appendChild(coach);

  const dismiss = () => {
    coach.classList.add('fade-out');
    setTimeout(() => coach.remove(), 500);
    document.removeEventListener('keydown', dismissOnKey);
  };
  const dismissOnKey = () => dismiss();
  document.addEventListener('keydown', dismissOnKey);
  setTimeout(dismiss, 5000);
}
```

- [ ] **Step 2: Add CSS for hints**

Add to the stage.css (or styles file):

```css
.help-button {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(180, 190, 254, 0.15);
  color: #b4befe;
  border: 1px solid rgba(180, 190, 254, 0.3);
  font-size: 18px;
  font-weight: bold;
  cursor: pointer;
  z-index: 500;
  transition: all 0.2s;
}
.help-button:hover {
  background: rgba(180, 190, 254, 0.3);
  transform: scale(1.05);
}

.coach-marks {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(30, 30, 46, 0.95);
  border: 1px solid rgba(249, 226, 175, 0.3);
  color: #cdd6f4;
  padding: 12px 24px;
  border-radius: 24px;
  font-size: 13px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.5);
  z-index: 1000;
  opacity: 1;
  transition: opacity 0.5s;
  pointer-events: none;
}
.coach-marks.fade-out { opacity: 0; }
.coach-marks strong { color: #f9e2af; margin: 0 2px; }
```

- [ ] **Step 3: Init in main.js**

Add import:

```js
import { initHints } from './hints.js';
```

Call inside `DOMContentLoaded`:

```js
  initHints();
```

- [ ] **Step 4: Manual verify**

- Clear localStorage: `localStorage.removeItem('shelf.coachMarksSeen.v1')` in browser console
- Reload the app
- Load a folder → coach marks appear at bottom for 5 seconds or until any keypress
- The `?` button appears in the bottom-right corner on all screens
- Click the `?` button → shortcuts overlay appears

- [ ] **Step 5: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/hints.js client/src/main.js client/styles/
git commit -m "feat: persistent help button + first-run coach marks"
```

---

## Task 12: Verification Pass

- [ ] **Step 1: Restart app and walk through full workflow**

```bash
pm start shelf
open http://localhost:5173/
```

- [ ] **Step 2: Full-journey sanity check**

From welcome screen, go through the complete workflow and tick each:

- Drop or select a folder of CR3s → loads into CULL, stage pill shows "CULL"
- Coach marks appear briefly on first load
- Press P/F/X/U on images → marks apply instantly, advance to next unmarked
- Click toggles keep, double-click toggles favorite, Cmd+click toggles reject
- Shift+click range works
- Option+click peeks lightbox
- Option+Arrow rotates selected image (visible change after thumbnail regenerates)
- Space toggles full lightbox
- Cmd+Z undoes last mark
- Action bar shows "Sort to Folders"; header has no duplicate button
- Click Sort to Folders → name modal → confirm → bridge card appears
- Click "Pick Heroes" → auto-navigates to new Keeps folder, stage pill shows "HEROES"
- Mark heroes with F key
- Action bar shows "Promote N to Favorites"
- Click Promote → confirmation → bridge card → "Open Favorites" → stage pill shows "FINAL"
- Action bar shows "Convert to DNG" (if raw files) and "Edit in Lightroom"
- `?` button visible in corner throughout

- [ ] **Step 3: Commit any final fixes**

```bash
cd ~/projects/elf/photography-shelf
git add -A
git commit -m "fix: polish from end-to-end verification" || true
```
