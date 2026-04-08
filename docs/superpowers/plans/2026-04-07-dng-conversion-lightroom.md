# DNG Conversion + Open in Lightroom — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add batch CR3→DNG conversion via dnglab and an "Edit Favorites in Lightroom" button to Shelf.

**Architecture:** New server route file `server/routes/convert.js` handles the conversion endpoint (shells out to `dnglab`) and a new `openFavoritesInLightroom` function in `server/lib/platform.js` handles the Lightroom launch. Client changes are in `actions.js` (new button + conversion modal) and `main.js` (rewire the open-editor handler + add convert handler).

**Tech Stack:** Node.js `child_process.execFile` → `dnglab` CLI, Express routes, vanilla JS client

**Spec:** `docs/superpowers/specs/2026-04-07-dng-conversion-lightroom-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/routes/convert.js` | Create | `POST /api/convert` endpoint — validates input, checks for dnglab, runs conversions, handles originals |
| `server/lib/platform.js` | Modify | Add `openFolderInLightroom(folderPath)` function |
| `server/index.js` | Modify | Import and mount `convertRoutes` |
| `client/src/actions.js` | Modify | Add "Convert to DNG" button, visibility logic for both buttons |
| `client/src/main.js` | Modify | Add `handleConvert()` flow with modal, rewire `handleOpenEditor()` to open Favorites in Lightroom |
| `client/src/events.js` | Modify | Add `CONVERT_START` and `CONVERT_COMPLETE` events |

---

### Task 1: Install dnglab

- [ ] **Step 1: Check if cargo is available and install dnglab**

```bash
# If cargo is available:
cargo install dnglab

# If cargo is not available, install via Homebrew tap or download binary:
# Check https://github.com/nicschumann/dnglab/releases for macOS binary
# Or install Rust first: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

- [ ] **Step 2: Verify dnglab works**

```bash
dnglab --version
# Expected: dnglab <version number>

# Test with a real CR3 file:
dnglab convert ~/media/photography/2026-03\ -\ Kat\ x\ Tsuki/keeps/Favorites/IMG_1414.CR3 /tmp/test-convert/IMG_1414.DNG
# Expected: converts successfully, /tmp/test-convert/IMG_1414.DNG exists
```

- [ ] **Step 3: Clean up test file**

```bash
rm -rf /tmp/test-convert
```

---

### Task 2: Server — Conversion Route

**Files:**
- Create: `server/routes/convert.js`
- Modify: `server/index.js` (lines 6, 47 — add import and mount)

- [ ] **Step 1: Create `server/routes/convert.js` with the conversion endpoint**

```js
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const convertRoutes = Router();

const RAW_EXTENSIONS = /\.(cr3|cr2|arw|nef|raf)$/i;

// Check if dnglab is available
async function findDnglab() {
  try {
    const { stdout } = await execFileAsync('which', ['dnglab']);
    return stdout.trim();
  } catch {
    return null;
  }
}

// POST /api/convert
// Body: { source: "/path/to/folder", keepOriginals: true|false }
convertRoutes.post('/convert', async (req, res) => {
  const { source, keepOriginals } = req.body;

  if (!source) {
    return res.status(400).json({ error: 'source is required' });
  }

  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    return res.status(404).json({ error: 'Source directory not found' });
  }

  // Check dnglab is installed
  const dnglabPath = await findDnglab();
  if (!dnglabPath) {
    return res.status(501).json({
      error: 'dnglab is not installed',
      hint: 'Install with: cargo install dnglab',
    });
  }

  // Find convertible raw files
  let rawFiles;
  try {
    rawFiles = fs.readdirSync(sourcePath)
      .filter(f => RAW_EXTENSIONS.test(f) && !f.includes('..'))
      .sort();
  } catch {
    return res.status(400).json({ error: 'Cannot read source directory' });
  }

  if (rawFiles.length === 0) {
    return res.json({ total: 0, converted: 0, skipped: 0, errors: [] });
  }

  let converted = 0;
  let skipped = 0;
  const errors = [];

  // Create originals subfolder if keeping
  const originalsDir = path.join(sourcePath, 'originals');
  if (keepOriginals) {
    fs.mkdirSync(originalsDir, { recursive: true });
  }

  for (const filename of rawFiles) {
    const baseName = filename.replace(RAW_EXTENSIONS, '');
    const dngName = baseName + '.DNG';
    const srcFile = path.join(sourcePath, filename);
    const dngFile = path.join(sourcePath, dngName);

    // Skip if DNG already exists
    if (fs.existsSync(dngFile)) {
      skipped++;
      continue;
    }

    try {
      await execFileAsync(dnglabPath, ['convert', srcFile, dngFile], {
        timeout: 60000,
      });

      // Handle originals
      if (keepOriginals) {
        fs.renameSync(srcFile, path.join(originalsDir, filename));
      } else {
        fs.unlinkSync(srcFile);
      }

      converted++;
    } catch (e) {
      errors.push({ filename, error: e.message });
    }
  }

  res.json({
    total: rawFiles.length,
    converted,
    skipped,
    errors: errors.length > 0 ? errors : [],
  });
});

// GET /api/has-convertible?source=/path
// Quick check if a folder has raw files that could be converted
convertRoutes.get('/has-convertible', (req, res) => {
  const source = req.query.source;
  if (!source) return res.json({ hasConvertible: false, count: 0 });

  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    return res.json({ hasConvertible: false, count: 0 });
  }

  try {
    const count = fs.readdirSync(sourcePath)
      .filter(f => RAW_EXTENSIONS.test(f))
      .length;
    res.json({ hasConvertible: count > 0, count });
  } catch {
    res.json({ hasConvertible: false, count: 0 });
  }
});
```

- [ ] **Step 2: Mount the convert routes in `server/index.js`**

Add import at line 6 (after the other route imports):

```js
import { convertRoutes } from './routes/convert.js';
```

Add mount at line 47 (after the other `app.use` lines):

```js
app.use('/api', convertRoutes);
```

- [ ] **Step 3: Test the endpoint manually**

Start the server and test with curl:

```bash
cd ~/projects/elf/photography-shelf && npm run server &

# Test dnglab check
curl -s http://localhost:3457/api/has-convertible?source=$(printf '%s' "$HOME/media/photography/2026-03 - Kat x Tsuki/keeps/Favorites" | jq -sRr @uri) | jq .
# Expected: { "hasConvertible": true, "count": <number> }

# Kill the server
kill %1
```

- [ ] **Step 4: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add server/routes/convert.js server/index.js
git commit -m "feat: add DNG conversion server endpoint via dnglab"
```

---

### Task 3: Server — Open Favorites in Lightroom

**Files:**
- Modify: `server/lib/platform.js` (add new function after `openInEditor`)
- Modify: `server/routes/config.js` (add new endpoint)

- [ ] **Step 1: Add `openFolderInLightroom` to `server/lib/platform.js`**

Add this function after the existing `openInEditor` function (after line 82):

```js
export async function openFolderInLightroom(folderPath) {
  const resolved = path.resolve(folderPath);

  if (process.platform === 'darwin') {
    await new Promise((resolve, reject) => {
      execFile(
        'open',
        ['-a', 'Adobe Lightroom CC', resolved],
        (err) => (err ? reject(err) : resolve()),
      );
    });
  } else {
    // Windows/Linux: try to open with default app
    await open(resolved);
  }
}
```

- [ ] **Step 2: Add the endpoint in `server/routes/config.js`**

Add import for the new function at line 6:

```js
import { openInEditor, pickFolder, openFolderInLightroom } from '../lib/platform.js';
```

Add new endpoint after the existing `/open-editor` route (after line 177):

```js
// Open favorites folder in Lightroom
configRoutes.post('/open-in-lightroom', async (req, res) => {
  const { source } = req.body;
  if (!source) {
    return res.status(400).json({ error: 'source is required' });
  }

  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(404).json({ error: 'Folder not found' });
  }

  try {
    await openFolderInLightroom(resolved);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to open Lightroom: ' + e.message });
  }
});
```

- [ ] **Step 3: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add server/lib/platform.js server/routes/config.js
git commit -m "feat: add open-in-lightroom server endpoint"
```

---

### Task 4: Client — Add Events

**Files:**
- Modify: `client/src/events.js` (lines 39-43 — add new events to EVENTS object)

- [ ] **Step 1: Add convert events to `client/src/events.js`**

Add these two lines inside the `EVENTS` object, after the `REFRESH` line (line 43):

```js
  CONVERT_START: 'convert:start',
  CONVERT_COMPLETE: 'convert:complete',
```

- [ ] **Step 2: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/events.js
git commit -m "feat: add convert events to event bus"
```

---

### Task 5: Client — Convert to DNG Flow

**Files:**
- Modify: `client/src/main.js` (add `handleConvert` function, wire up bus event)

- [ ] **Step 1: Add the `handleConvert` function to `client/src/main.js`**

Add the bus listener in the `DOMContentLoaded` handler, after line 35 (`bus.on('action:open-editor', handleOpenEditor);`):

```js
  bus.on('action:convert', handleConvert);
```

Add the `handleConvert` function after the `handleSort` function (after line 393):

```js
async function handleConvert() {
  // Ask about originals
  const keepOriginals = await showChoiceModal(
    'Convert to DNG',
    'Convert all raw files in this folder to DNG format for Lightroom/Photoshop editing.\n\nKeep original files?',
    'Keep Originals',
    'Remove After Converting',
  );

  if (keepOriginals === null) return; // cancelled

  // Show progress modal
  const overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = `
    <div class="modal">
      <h2>Converting to DNG...</h2>
      <p>This may take a moment. Please wait.</p>
    </div>
  `;
  overlay.classList.add('active');

  try {
    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, keepOriginals }),
    });
    const data = await res.json();

    overlay.classList.remove('active');

    if (!res.ok) {
      if (res.status === 501) {
        showToast('dnglab is not installed. Run: cargo install dnglab', 'error');
      } else {
        showToast(data.error || 'Conversion failed', 'error');
      }
      return;
    }

    const parts = [];
    if (data.converted) parts.push(`${data.converted} converted`);
    if (data.skipped) parts.push(`${data.skipped} skipped`);
    if (data.errors.length) parts.push(`${data.errors.length} errors`);
    showToast(`DNG conversion done: ${parts.join(', ')}`, data.errors.length ? 'error' : 'success');

    // Refresh to show new DNG files
    bus.emit(EVENTS.REFRESH);
  } catch (e) {
    overlay.classList.remove('active');
    showToast('Conversion failed: ' + e.message, 'error');
  }
}
```

- [ ] **Step 2: Add the `showChoiceModal` helper to `client/src/main.js`**

Add after the `showConfirmModal` function (after line 508):

```js
function showChoiceModal(title, message, optionA, optionB) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `
      <div class="modal">
        <h2>${title}</h2>
        <p>${message.replace(/\n/g, '<br>')}</p>
        <div class="modal-buttons">
          <button class="btn btn-muted" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-option-a">${optionA}</button>
          <button class="btn btn-gold" id="modal-option-b">${optionB}</button>
        </div>
      </div>
    `;
    overlay.classList.add('active');

    const close = (value) => {
      overlay.classList.remove('active');
      resolve(value);
    };

    document.getElementById('modal-option-a').addEventListener('click', () => close(true));
    document.getElementById('modal-option-b').addEventListener('click', () => close(false));
    document.getElementById('modal-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') { close(null); document.removeEventListener('keydown', handler); }
    });
  });
}
```

- [ ] **Step 3: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/main.js
git commit -m "feat: add convert-to-DNG flow with choice modal"
```

---

### Task 6: Client — Rewire Open Editor to Open Favorites in Lightroom

**Files:**
- Modify: `client/src/main.js` (replace `handleOpenEditor` function, lines 396-425)

- [ ] **Step 1: Replace the `handleOpenEditor` function in `client/src/main.js`**

Replace the existing `handleOpenEditor` function (lines 396-425) with:

```js
async function handleOpenEditor() {
  // Determine the Favorites folder path
  const favoritesPath = source.endsWith('/Favorites')
    ? source
    : source + '/Favorites';

  try {
    const res = await fetch('/api/open-in-lightroom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: favoritesPath }),
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to open Lightroom', 'error');
      return;
    }

    showToast('Opening Favorites in Lightroom...', 'success');
  } catch (e) {
    showToast('Failed to open Lightroom: ' + e.message, 'error');
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/main.js
git commit -m "feat: rewire open-editor to open Favorites in Lightroom CC"
```

---

### Task 7: Client — Action Bar Buttons and Visibility

**Files:**
- Modify: `client/src/actions.js` (full rewrite of `updateActions`)
- Modify: `client/src/main.js` (update header button text, lines 78-79)

- [ ] **Step 1: Update `client/src/actions.js` to add Convert button and control visibility**

Replace the full contents of `client/src/actions.js`:

```js
// Floating batch action bar

import { bus, EVENTS } from './events.js';
import { getImages } from './grid.js';

let actionsEl = null;
let hasConvertible = false;
let hasFavoritesFolder = false;
let currentSource = '';

export function initActions() {
  actionsEl = document.getElementById('actions');

  bus.on(EVENTS.STATE_CHANGED, () => updateActions());
  bus.on(EVENTS.IMAGE_MARKED, () => updateActions());
  bus.on(EVENTS.BATCH_MARKED, () => updateActions());
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
  // If we ARE in the Favorites folder, show the button
  if (currentSource.endsWith('/Favorites')) {
    hasFavoritesFolder = true;
    updateActions();
    return;
  }
  // Check if a Favorites subfolder exists by listing the directory
  const favPath = currentSource + '/Favorites';
  try {
    const res = await fetch(`/api/images?source=${encodeURIComponent(favPath)}`);
    hasFavoritesFolder = res.ok;
  } catch {
    hasFavoritesFolder = false;
  }
  updateActions();
}

function updateActions() {
  if (!actionsEl) return;
  const images = getImages();

  const keeps = images.filter((i) => (i.status || 'unmarked') === 'keep').length;
  const favs = images.filter((i) => (i.status || 'unmarked') === 'favorite').length;
  const rejects = images.filter((i) => (i.status || 'unmarked') === 'reject').length;
  const count = keeps + favs + rejects;

  const showBar = count > 0 || hasConvertible || hasFavoritesFolder;

  if (showBar) {
    actionsEl.classList.add('visible');
    let html = '';

    if (count > 0) {
      const parts = [];
      if (keeps) parts.push(`${keeps} keeps`);
      if (favs) parts.push(`${favs} favs`);
      if (rejects) parts.push(`${rejects} rejects`);
      html += `<span class="action-count">${parts.join(', ')}</span>`;
      html += `<button class="btn btn-primary" id="action-sort">Sort to Folders</button>`;
    }

    if (hasConvertible) {
      html += `<button class="btn btn-gold" id="action-convert">Convert to DNG</button>`;
    }

    if (hasFavoritesFolder) {
      html += `<button class="btn btn-muted" id="action-open-editor">Edit Favorites in Lightroom</button>`;
    }

    actionsEl.innerHTML = html;

    document.getElementById('action-sort')?.addEventListener('click', () => {
      bus.emit('action:sort');
    });
    document.getElementById('action-convert')?.addEventListener('click', () => {
      bus.emit('action:convert');
    });
    document.getElementById('action-open-editor')?.addEventListener('click', () => {
      bus.emit('action:open-editor');
    });
  } else {
    actionsEl.classList.remove('visible');
  }
}
```

- [ ] **Step 2: Update header button text in `client/src/main.js`**

In the `renderHeader` function, find line 78:

```js
      <button class="btn btn-muted" id="btn-open-editor">Open in Editor</button>
```

Replace with:

```js
      <button class="btn btn-muted" id="btn-open-editor">Edit Favorites in Lightroom</button>
```

- [ ] **Step 3: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/actions.js client/src/main.js
git commit -m "feat: action bar with Convert to DNG and Edit Favorites in Lightroom buttons"
```

---

### Task 8: Emit CONVERT_COMPLETE After Conversion

**Files:**
- Modify: `client/src/main.js` (inside `handleConvert`, after the REFRESH emit)

- [ ] **Step 1: Add CONVERT_COMPLETE emit in `handleConvert`**

In the `handleConvert` function, after `bus.emit(EVENTS.REFRESH);`, add:

```js
    bus.emit(EVENTS.CONVERT_COMPLETE);
```

- [ ] **Step 2: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/main.js
git commit -m "feat: emit CONVERT_COMPLETE after DNG conversion"
```

---

### Task 9: Invalidate Thumbnail Cache After Conversion

**Files:**
- Modify: `server/routes/convert.js` (add cache cleanup after conversion loop)

- [ ] **Step 1: Read the thumbnail cache directory from `server/lib/thumbnails.js`**

Check how thumbnails are cached so we know what to invalidate. The cache is at `/tmp/shelf-thumbs/` with filenames based on source path hashes.

- [ ] **Step 2: Add cache invalidation to the convert endpoint**

In `server/routes/convert.js`, add this import at the top:

```js
import os from 'os';
```

After the conversion loop completes (before `res.json(...)`), add:

```js
  // Invalidate thumbnail cache for converted files
  const thumbDir = path.join(os.tmpdir(), 'shelf-thumbs');
  if (converted > 0 && fs.existsSync(thumbDir)) {
    try {
      const thumbFiles = fs.readdirSync(thumbDir);
      for (const tf of thumbFiles) {
        // Remove any cached thumbnails for this source directory
        // Thumbnails are regenerated on next request
        const tfPath = path.join(thumbDir, tf);
        try { fs.unlinkSync(tfPath); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
```

- [ ] **Step 3: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add server/routes/convert.js
git commit -m "feat: invalidate thumbnail cache after DNG conversion"
```

---

### Task 10: End-to-End Manual Test

- [ ] **Step 1: Start the app**

```bash
cd ~/projects/elf/photography-shelf && npm run dev
```

- [ ] **Step 2: Open in browser, navigate to the Kat x Tsuki shoot's `keeps/Favorites` folder**

Open `http://localhost:5173`, click "Select Directory", navigate to `~/media/photography/2026-03 - Kat x Tsuki`, click into `keeps` → `Favorites`.

- [ ] **Step 3: Verify "Convert to DNG" button appears in the action bar**

The gold "Convert to DNG" button should be visible since the folder contains .CR3 files.

- [ ] **Step 4: Click "Convert to DNG", choose "Keep Originals", verify conversion**

- Modal should ask about keeping originals
- Progress modal should appear
- After completion, toast should report results
- Grid should refresh showing .DNG files
- `originals/` subfolder should contain the original .CR3 files

- [ ] **Step 5: Verify "Edit Favorites in Lightroom" button appears and works**

Click the button — Lightroom CC should open with the Favorites folder.

- [ ] **Step 6: Verify "Convert to DNG" button disappears after all files are converted**

Since all raw files are now DNG (and originals are in a subfolder), the convert button should no longer appear.

- [ ] **Step 7: Commit any fixes needed**

```bash
cd ~/projects/elf/photography-shelf
git add -A
git commit -m "fix: address issues found during manual testing"
```
