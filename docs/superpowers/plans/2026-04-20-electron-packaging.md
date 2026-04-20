# Shelf Electron Packaging + E2E Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Shelf as a cross-platform Electron desktop app with the pixel elf icon, and add Playwright E2E tests covering critical regressions.

**Architecture:** Electron main process spawns the existing Express server as a child process, picks a free port, loads a BrowserWindow at that port (dev: Vite at 5173). electron-builder produces `.dmg` and `.exe`. Playwright runs against dev-mode Electron.

**Tech Stack:** Electron, electron-builder, @playwright/test, get-port, sharp (for icon rasterization).

**Spec:** `docs/superpowers/specs/2026-04-20-electron-packaging-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `electron/main.js` | Create | App lifecycle, BrowserWindow, spawn server |
| `electron/preload.js` | Create | Expose `window.shelf` bridge API |
| `electron/server-process.js` | Create | Child process wrapper for Express |
| `electron/window-state.js` | Create | Save/restore window bounds, display validation |
| `electron/menu.js` | Create | Native menu (platform-aware) |
| `electron/ipc.js` | Create | IPC handlers: pick-folder |
| `electron/notifications.js` | Create | Native notifications + progress bar |
| `electron/icon/source.png` | Generated | 1024x1024 elf icon (by build-icon.mjs) |
| `scripts/build-icon.mjs` | Create | Rasterize favicon.svg → source.png |
| `server/index.js` | Modify | Serve `dist/` in production, honor SHELF_DIST_PATH |
| `server/routes/convert.js` | Modify | Hardcoded dnglab PATH candidates |
| `client/src/ingest.js` | Modify | Expose pickFolder via window.shelf IPC |
| `client/src/main.js` | Modify | Try window.shelf.pickFolder first |
| `package.json` | Modify | Add deps, scripts, electron-builder config |
| `playwright.config.js` | Create | Playwright Electron configuration |
| `test/helpers.js` | Create | `launchApp()`, mock helpers |
| `test/fixtures/` | Create | Tiny DNG fixtures for tests |
| `test/e2e/*.spec.js` | Create | 6 E2E tests |
| `start.command` | Delete | Dead launcher |
| `start.bat` | Delete | Dead launcher |

---

## Task 1: Install Dependencies

**Files:** `package.json` (modify)

- [ ] **Step 1: Install runtime and dev deps**

```bash
cd ~/projects/elf/photography-shelf
npm install --save-dev electron@33 electron-builder@25 @playwright/test@1.49 get-port@7
```

- [ ] **Step 2: Verify versions**

```bash
cd ~/projects/elf/photography-shelf && node -p "const p = require('./package.json'); ({electron: p.devDependencies.electron, builder: p.devDependencies['electron-builder'], playwright: p.devDependencies['@playwright/test']})"
```
Expected: All three printed with versions starting `^33`, `^25`, `^1.49`.

- [ ] **Step 3: Add scripts to package.json**

In `package.json`, update the `"scripts"` block to add Electron and test scripts. After the existing scripts, add:

```json
    "electron:dev": "concurrently -n server,vite,electron -c blue,magenta,cyan \"node server/index.js\" \"vite\" \"wait-on http://localhost:5173 && electron electron/main.js\"",
    "electron:build": "npm run build && electron-builder",
    "build": "vite build",
    "test": "playwright test"
```

Install `wait-on` too:
```bash
cd ~/projects/elf/photography-shelf && npm install --save-dev wait-on@8
```

- [ ] **Step 4: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add package.json package-lock.json
git commit -m "feat: add electron, electron-builder, playwright, wait-on dev deps"
```

---

## Task 2: Icon Generation

**Files:**
- Create: `scripts/build-icon.mjs`
- Create: `electron/icon/source.png` (generated)

- [ ] **Step 1: Create the rasterization script**

Create `scripts/build-icon.mjs`:

```js
// Rasterize client/public/favicon.svg to a 1024x1024 PNG for Electron icon generation.
// Uses nearest-neighbor scaling to preserve the pixel-art aesthetic.

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVG_PATH = path.join(__dirname, '..', 'client', 'public', 'favicon.svg');
const OUT_DIR = path.join(__dirname, '..', 'electron', 'icon');
const OUT_PATH = path.join(OUT_DIR, 'source.png');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const svg = fs.readFileSync(SVG_PATH);

  // The SVG is 28x24. Render to 1024 square with padding for a dock-friendly icon.
  // Use density to get crisp pixels, then scale with nearest-neighbor.
  const INNER = 800;   // elf pixels area
  const PAD = (1024 - INNER) / 2;

  const elf = await sharp(svg, { density: 600 })
    .resize(INNER, INNER, { kernel: 'nearest', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Create 1024x1024 canvas with rounded square background
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
       <rect width="1024" height="1024" rx="180" ry="180" fill="#1e1e2e"/>
     </svg>`
  );

  await sharp(bg)
    .composite([{ input: elf, top: Math.round(PAD), left: Math.round(PAD) }])
    .png()
    .toFile(OUT_PATH);

  console.log('Icon written to', OUT_PATH);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it and verify the icon**

```bash
cd ~/projects/elf/photography-shelf && node scripts/build-icon.mjs
```
Expected: `Icon written to .../electron/icon/source.png`

Verify with:
```bash
cd ~/projects/elf/photography-shelf && file electron/icon/source.png
```
Expected: `PNG image data, 1024 x 1024, 8-bit/color RGBA, non-interlaced`

- [ ] **Step 3: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add scripts/build-icon.mjs electron/icon/source.png
git commit -m "feat: add icon build script (pixel elf → 1024 PNG)"
```

---

## Task 3: Server Production Mode + dnglab PATH Fix

**Files:**
- Modify: `server/index.js`
- Modify: `server/routes/convert.js`

- [ ] **Step 1: Update server/index.js to serve dist/ in production**

In `server/index.js`, add imports if not present:

```js
import path from 'path';
import { fileURLToPath } from 'url';
```

Replace the file after the imports to add production static serving. After the route mounts and before `app.listen`, add:

```js
// In production, serve the Vite-built static files (and SPA fallback)
if (process.env.NODE_ENV === 'production') {
  const distPath = process.env.SHELF_DIST_PATH
    || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  app.use(express.static(distPath));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
```

The `SHELF_DIST_PATH` env var lets the Electron main process tell the server where `dist/` actually lives inside the packaged app (relative paths break inside asar).

- [ ] **Step 2: Update server/routes/convert.js with hardcoded dnglab candidates**

Replace the `findDnglab` function in `server/routes/convert.js`:

```js
const DNGLAB_CANDIDATES = [
  '/opt/homebrew/bin/dnglab',     // macOS Apple Silicon
  '/usr/local/bin/dnglab',        // macOS Intel
  '/usr/bin/dnglab',              // Linux-style
  'C:\\ProgramData\\chocolatey\\bin\\dnglab.exe', // Windows Chocolatey
];

async function findDnglab() {
  for (const p of DNGLAB_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  // Last resort: try `which` (dev mode only, inherits shell PATH)
  try {
    const { stdout } = await execFileAsync('which', ['dnglab']);
    const p = stdout.trim();
    return p || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Verify current dev still works**

```bash
cd ~/projects/elf/photography-shelf && pm stop shelf && pm start shelf && sleep 3 && curl -s http://localhost:23714/api/health
```
Expected: `{"ok":true,...}`

Test has-convertible still works:
```bash
FAVS="/Users/ava/media/photography/2026-03 - Kat x Tsuki/keeps/Favorites"
curl -s "http://localhost:23714/api/has-convertible?source=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$FAVS'))")"
```
Expected: `{"hasConvertible":false,"count":0}` (or similar — endpoint functional)

- [ ] **Step 4: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add server/index.js server/routes/convert.js
git commit -m "feat: server production static serving + dnglab PATH candidates"
```

---

## Task 4: Electron server-process.js

**Files:**
- Create: `electron/server-process.js`

- [ ] **Step 1: Create the child-process wrapper**

Create `electron/server-process.js`:

```js
// Spawns the Express server as a child process with a free port.
// Forwards logs and handles lifecycle.

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, '..', 'server', 'index.js');

let serverProcess = null;

export function startServer({ port, distPath }) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
    };
    if (distPath) env.SHELF_DIST_PATH = distPath;

    serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const onStdout = (data) => {
      const s = data.toString();
      process.stdout.write(`[server] ${s}`);
      if (!resolved && s.includes('Shelf server running')) {
        resolved = true;
        resolve();
      }
    };
    const onStderr = (data) => {
      process.stderr.write(`[server err] ${data.toString()}`);
    };

    serverProcess.stdout.on('data', onStdout);
    serverProcess.stderr.on('data', onStderr);

    serverProcess.on('error', (err) => {
      if (!resolved) reject(err);
    });
    serverProcess.on('exit', (code) => {
      if (!resolved) reject(new Error(`Server exited with code ${code} before ready`));
      serverProcess = null;
    });

    // Safety timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(); // Assume it started even without the log line
      }
    }, 5000);
  });
}

export function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    // Force kill after 2s if still alive
    setTimeout(() => {
      if (serverProcess) serverProcess.kill('SIGKILL');
    }, 2000);
    serverProcess = null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add electron/server-process.js
git commit -m "feat: electron server-process wrapper (spawn, lifecycle)"
```

---

## Task 5: Electron window-state.js

**Files:**
- Create: `electron/window-state.js`

- [ ] **Step 1: Create window state utility**

Create `electron/window-state.js`:

```js
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
      bounds.x >= x - 50 && bounds.x < x + width - 100 &&
      bounds.y >= y - 50 && bounds.y < y + height - 100
    ) return true;
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
```

- [ ] **Step 2: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add electron/window-state.js
git commit -m "feat: window state save/restore with display validation"
```

---

## Task 6: Electron main.js + preload.js + ipc.js

**Files:**
- Create: `electron/main.js`
- Create: `electron/preload.js`
- Create: `electron/ipc.js`

- [ ] **Step 1: Create preload.js**

Create `electron/preload.js`:

```js
// Preload script — exposes a minimal, safe API to the renderer.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shelf', {
  isElectron: true,
  pickFolder: () => ipcRenderer.invoke('shelf:pick-folder'),
  showNotification: (title, body) => ipcRenderer.invoke('shelf:notification', { title, body }),
  setProgress: (fraction) => ipcRenderer.invoke('shelf:progress', fraction),
});
```

- [ ] **Step 2: Create ipc.js**

Create `electron/ipc.js`:

```js
// IPC handlers wired from the preload bridge.

import { ipcMain, dialog, Notification, BrowserWindow } from 'electron';

export function registerIpc(getMainWindow) {
  ipcMain.handle('shelf:pick-folder', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select a photo folder',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { path: null, cancelled: true };
    }
    return { path: result.filePaths[0] };
  });

  ipcMain.handle('shelf:notification', async (_evt, { title, body }) => {
    const win = getMainWindow();
    // Only notify when the app is unfocused
    if (win && win.isFocused()) return { shown: false };
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
      return { shown: true };
    }
    return { shown: false };
  });

  ipcMain.handle('shelf:progress', async (_evt, fraction) => {
    const win = getMainWindow();
    if (win) win.setProgressBar(fraction);
    return { ok: true };
  });
}
```

- [ ] **Step 3: Create main.js**

Create `electron/main.js`:

```js
// Electron main process — spawns server, creates window, wires menu + IPC.

import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import getPort from 'get-port';
import { startServer, stopServer } from './server-process.js';
import { loadBounds, saveBounds } from './window-state.js';
import { registerIpc } from './ipc.js';
import { buildMenu } from './menu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow = null;
let serverPort = null;

async function createWindow() {
  // Figure out which port to use
  if (isDev) {
    // In dev, the existing npm run dev starts Express on env PORT (pm assigns 23714)
    serverPort = parseInt(process.env.SHELF_SERVER_PORT || '23714');
  } else {
    // In packaged mode, pick a free port and spawn the server
    serverPort = await getPort();
    const distPath = path.join(app.getAppPath(), 'dist');
    await startServer({ port: serverPort, distPath });
  }

  const bounds = await loadBounds(serverPort);

  mainWindow = new BrowserWindow({
    ...bounds,
    title: 'Shelf',
    backgroundColor: '#1e1e2e',
    icon: path.join(__dirname, 'icon', 'source.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In dev, load Vite's URL (5173). In packaged, load the server directly.
  const url = isDev ? 'http://localhost:5173' : `http://localhost:${serverPort}`;
  mainWindow.loadURL(url);

  // External links open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Save bounds on close
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const b = mainWindow.getBounds();
      saveBounds(serverPort, b).catch(() => {});
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  registerIpc(() => mainWindow);
  buildMenu({ mainWindow, isDev, serverPort });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopServer();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  stopServer();
});
```

- [ ] **Step 4: Test dev launch**

First ensure pm has Shelf server running on 23714:
```bash
pm status | grep -i shelf
```
If not alive, `pm start shelf`.

Then launch Electron directly against the existing dev server:
```bash
cd ~/projects/elf/photography-shelf && SHELF_SERVER_PORT=23714 npx electron electron/main.js &
sleep 5
```
Expected: an Electron window opens showing the Shelf welcome screen. (You may need to wait for Vite to be ready — if it shows an error page, that's fine for this task, we're verifying the window opens.)

Kill the Electron process:
```bash
pkill -f 'electron/main.js' || true
```

- [ ] **Step 5: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add electron/main.js electron/preload.js electron/ipc.js
git commit -m "feat: electron main process, preload bridge, IPC handlers"
```

---

## Task 7: Electron menu.js

**Files:**
- Create: `electron/menu.js`

- [ ] **Step 1: Create platform-aware menu**

Create `electron/menu.js`:

```js
// Native menu with platform-specific branches.

import { Menu, app, BrowserWindow, dialog } from 'electron';

const isMac = process.platform === 'darwin';

async function openFolder(mainWindow, serverPort) {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Open Folder',
  });
  if (result.canceled || result.filePaths.length === 0) return;
  // Tell the renderer to load this folder via the same ingest flow as drag-drop
  mainWindow.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('shelf:load-folder', { detail: { path: ${JSON.stringify(result.filePaths[0])} } }))`
  );
}

async function fetchRecentShoots(serverPort) {
  try {
    const res = await fetch(`http://localhost:${serverPort}/api/config`);
    const cfg = await res.json();
    return Array.isArray(cfg.recentShoots) ? cfg.recentShoots : [];
  } catch {
    return [];
  }
}

function recentSubmenu(recent, mainWindow) {
  if (recent.length === 0) {
    return [{ label: 'No Recent Shoots', enabled: false }];
  }
  return recent.map(p => ({
    label: p.split('/').slice(-2).join('/'),
    click: () => {
      mainWindow.webContents.executeJavaScript(
        `window.dispatchEvent(new CustomEvent('shelf:load-folder', { detail: { path: ${JSON.stringify(p)} } }))`
      );
    },
  }));
}

export async function buildMenu({ mainWindow, isDev, serverPort }) {
  const recent = await fetchRecentShoots(serverPort);

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Shoot', accelerator: isMac ? 'Cmd+O' : 'Ctrl+O', click: () => openFolder(mainWindow, serverPort) },
        { label: 'Open Recent', submenu: recentSubmenu(recent, mainWindow) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: isMac ? 'Cmd+Z' : 'Ctrl+Z', click: () => {
          mainWindow.webContents.executeJavaScript(
            `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, ctrlKey: true, bubbles: true }))`
          );
        }},
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(isDev ? [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
        ] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'Shift+/', click: () => {
          mainWindow.webContents.executeJavaScript(
            `document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`
          );
        }},
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
```

- [ ] **Step 2: Add renderer-side load-folder handler**

In `client/src/main.js`, inside `DOMContentLoaded`, add:

```js
  // Electron menu → renderer bridge for "Open Folder" / "Open Recent"
  window.addEventListener('shelf:load-folder', (e) => {
    if (e.detail && e.detail.path) loadSource(e.detail.path);
  });
```

- [ ] **Step 3: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add electron/menu.js client/src/main.js
git commit -m "feat: native menu with File/Edit/View/Window/Help + recent shoots"
```

---

## Task 8: Client — window.shelf.pickFolder + Notification/Progress

**Files:**
- Modify: `client/src/main.js`
- Modify: `client/src/ingest.js`

- [ ] **Step 1: Update selectDirectory to try window.shelf.pickFolder first**

In `client/src/main.js`, find the `selectDirectory` function. Update the top to try the Electron IPC path first:

```js
async function selectDirectory() {
  try {
    let data;
    if (window.shelf && window.shelf.pickFolder) {
      data = await window.shelf.pickFolder();
    } else {
      const res = await fetch('/api/pick-folder', { method: 'POST' });
      data = await res.json();
    }
    // ... rest of function unchanged
```

The rest of `selectDirectory` (handling `data.path`, list-dir call, picker modal) stays the same.

- [ ] **Step 2: Wire native notifications to handleSort/handleConvert/handlePromoteFavorites**

In `client/src/main.js`, in the `handleSort` function's success path (after the `showSortBridge` call), add:

```js
    if (window.shelf && window.shelf.showNotification) {
      window.shelf.showNotification('Sort complete', `Sorted ${Object.values(data.moved).reduce((a,b) => a+b, 0)} images`);
    }
```

Same pattern in `handleConvert` success path (after the toast), add:

```js
    if (window.shelf && window.shelf.showNotification) {
      window.shelf.showNotification('DNG conversion complete', `Converted ${data.converted} images`);
    }
```

Same in `handlePromoteFavorites` success path (after the toast/bridge), add:

```js
    if (window.shelf && window.shelf.showNotification) {
      window.shelf.showNotification('Promoted to Favorites', `Moved ${data.moved} heroes`);
    }
```

- [ ] **Step 3: Wire progress bar during DNG conversion**

In `handleConvert` in main.js, the function currently does a single POST and shows an indeterminate modal. The progress indicator can't be real-time without a streaming API, but we can still indicate "in progress" and "done":

Before the `fetch('/api/convert', ...)` call, add:
```js
    if (window.shelf && window.shelf.setProgress) window.shelf.setProgress(2); // indeterminate (macOS shows pulse)
```

In the success path after the toast, and in the catch block, add:
```js
    if (window.shelf && window.shelf.setProgress) window.shelf.setProgress(-1); // clear
```

- [ ] **Step 4: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add client/src/main.js
git commit -m "feat: renderer uses window.shelf bridge for folder picker, notifications, progress"
```

---

## Task 9: Delete Dead Launchers

**Files:**
- Delete: `start.command`
- Delete: `start.bat`

- [ ] **Step 1: Delete the launcher files**

```bash
cd ~/projects/elf/photography-shelf
rm -f start.command start.bat
```

- [ ] **Step 2: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add -A
git commit -m "chore: remove dead start.command and start.bat launchers"
```

---

## Task 10: electron-builder Config

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add main, build config, and asarUnpack to package.json**

In `package.json`, add a `"main"` field at the top level:

```json
  "main": "electron/main.js",
```

Then add a `"build"` block (electron-builder config) at the top level:

```json
  "build": {
    "appId": "com.elf.shelf",
    "productName": "Shelf",
    "icon": "electron/icon/source.png",
    "asar": true,
    "asarUnpack": [
      "node_modules/sharp/**",
      "node_modules/@img/**",
      "node_modules/exiftool-vendored/**",
      "node_modules/exiftool-vendored.pl/**",
      "node_modules/exiftool-vendored.exe/**"
    ],
    "files": [
      "electron/**/*",
      "server/**/*",
      "!server/test/**",
      "dist/**/*",
      "package.json",
      "node_modules/**/*"
    ],
    "directories": {
      "output": "dist-electron"
    },
    "mac": {
      "category": "public.app-category.photography",
      "target": ["dmg"],
      "icon": "electron/icon/source.png"
    },
    "win": {
      "target": ["nsis"],
      "icon": "electron/icon/source.png"
    },
    "dmg": {
      "contents": [
        { "x": 130, "y": 220 },
        { "x": 410, "y": 220, "type": "link", "path": "/Applications" }
      ]
    }
  }
```

- [ ] **Step 2: Verify the package.json is valid JSON**

```bash
cd ~/projects/elf/photography-shelf && node -e "JSON.parse(require('fs').readFileSync('package.json'))"
```
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add package.json
git commit -m "feat: electron-builder config with asarUnpack for native deps"
```

---

## Task 11: First Packaged Build Smoke Test

This is a verification step for everything above.

- [ ] **Step 1: Build the client assets**

```bash
cd ~/projects/elf/photography-shelf && npm run build 2>&1 | tail -20
```
Expected: Vite builds into `dist/`, no errors.

- [ ] **Step 2: Run the packaged build**

```bash
cd ~/projects/elf/photography-shelf && npx electron-builder --mac --dir 2>&1 | tail -30
```

`--dir` skips the DMG step and just produces the .app bundle. Faster for iterating. Expected: completes with a `.app` at `dist-electron/mac-arm64/Shelf.app` (or similar path).

- [ ] **Step 3: Launch the packaged app and verify**

```bash
open dist-electron/mac-arm64/Shelf.app
sleep 4
```

Expected: The app launches, shows a window with the welcome screen. Server is running inside the app (check with `lsof -i -P -n | grep LISTEN | grep Shelf` to see the server port).

If the window is blank, check the logs:
```bash
cat ~/Library/Logs/Shelf/*.log 2>/dev/null | tail -40
```

Common failure: asar unpacking missed a native dep. Fix by adding to the `asarUnpack` list.

- [ ] **Step 4: Kill it and commit any fixes**

```bash
pkill -x Shelf || true
cd ~/projects/elf/photography-shelf
git add -A
git commit -m "fix: packaged build issues found during smoke test" --allow-empty
```

---

## Task 12: Playwright Config + Helpers + Fixtures

**Files:**
- Create: `playwright.config.js`
- Create: `test/helpers.js`
- Create: `test/fixtures/unsorted/` with 3 tiny DNG files

- [ ] **Step 1: Create playwright.config.js**

Create `playwright.config.js`:

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30000,
  fullyParallel: false,       // Electron tests should run sequentially
  workers: 1,
  reporter: 'list',
  use: {
    actionTimeout: 10000,
  },
});
```

- [ ] **Step 2: Create test/helpers.js**

Create `test/helpers.js`:

```js
import { _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(__dirname, '..');
export const FIXTURES = path.join(__dirname, 'fixtures');

// Launch Electron in dev mode against an existing server
export async function launchApp({ serverPort = 23714 } = {}) {
  const app = await electron.launch({
    args: [path.join(REPO_ROOT, 'electron', 'main.js')],
    env: {
      ...process.env,
      SHELF_SERVER_PORT: String(serverPort),
    },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

// Programmatically load a folder into the app (skips native picker)
export async function loadFolder(window, folderPath) {
  await window.evaluate((p) => {
    window.dispatchEvent(new CustomEvent('shelf:load-folder', { detail: { path: p } }));
  }, folderPath);
  // Wait for the grid to render
  await window.waitForSelector('.card', { timeout: 10000 });
}
```

- [ ] **Step 3: Create fixture DNGs**

Use the already-converted DNG files from the Kat x Tsuki Favorites folder as the basis. Copy 3 of them into the fixtures dir (these are small enough and work with sharp + exiftool):

```bash
mkdir -p ~/projects/elf/photography-shelf/test/fixtures/unsorted
mkdir -p ~/projects/elf/photography-shelf/test/fixtures/heroes-keeps
mkdir -p ~/projects/elf/photography-shelf/test/fixtures/final-favorites

SRC="/Users/ava/media/photography/2026-03 - Kat x Tsuki/keeps/Favorites"
ls "$SRC" | grep DNG | head -3 | while read f; do
  cp "$SRC/$f" ~/projects/elf/photography-shelf/test/fixtures/unsorted/
done
ls ~/projects/elf/photography-shelf/test/fixtures/unsorted/
```

Expected: 3 DNG files copied.

- [ ] **Step 4: Gitignore fixtures (they're binary and large)**

Add to `.gitignore` (create if not present):

```
test/fixtures/**
dist/
dist-electron/
node_modules/
~/.shelf/
```

- [ ] **Step 5: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add playwright.config.js test/helpers.js .gitignore
git commit -m "test: playwright config + electron launch helpers + fixture gitignore"
```

---

## Task 13: Playwright Tests — Launch + Marking

**Files:**
- Create: `test/e2e/launch.spec.js`
- Create: `test/e2e/marking.spec.js`

- [ ] **Step 1: Create launch.spec.js**

Create `test/e2e/launch.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { launchApp } from '../helpers.js';

test('app launches with welcome screen and help button', async () => {
  const { app, window } = await launchApp();

  // Welcome screen visible
  await expect(window.locator('#app-empty')).toBeVisible();
  await expect(window.locator('h2', { hasText: 'Welcome to Shelf' })).toBeVisible();

  // Help button in the corner
  await expect(window.locator('#help-button')).toBeVisible();

  await app.close();
});
```

- [ ] **Step 2: Create marking.spec.js**

Create `test/e2e/marking.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { launchApp, loadFolder, FIXTURES } from '../helpers.js';
import path from 'path';

test('P key marks image as keep', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'unsorted'));

  // Focus the first card
  await window.click('.card[data-index="0"]');

  // Press P
  await window.keyboard.press('p');

  // First card should now have keep status
  const card = window.locator('.card[data-index="0"]');
  await expect(card.locator('.badge')).toHaveText(/keep/i);

  await app.close();
});

test('F key marks image as favorite', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'unsorted'));

  await window.click('.card[data-index="0"]');
  await window.keyboard.press('f');

  await expect(window.locator('.card[data-index="0"] .badge')).toHaveText(/favorite/i);

  await app.close();
});

test('X key marks image as reject', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'unsorted'));

  await window.click('.card[data-index="0"]');
  await window.keyboard.press('x');

  await expect(window.locator('.card[data-index="0"] .badge')).toHaveText(/reject/i);

  await app.close();
});
```

- [ ] **Step 3: Run tests**

Make sure pm-managed Shelf server is running:
```bash
pm status | grep -i shelf
```

Run tests:
```bash
cd ~/projects/elf/photography-shelf && npx playwright test test/e2e/launch.spec.js test/e2e/marking.spec.js 2>&1 | tail -30
```
Expected: 4/4 tests pass.

- [ ] **Step 4: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add test/e2e/launch.spec.js test/e2e/marking.spec.js
git commit -m "test: playwright tests for app launch and P/F/X marking"
```

---

## Task 14: Playwright Tests — Stages + Rotation

**Files:**
- Create: `test/e2e/stages.spec.js`
- Create: `test/e2e/rotation.spec.js`

- [ ] **Step 1: Set up HEROES and FINAL fixtures**

```bash
# Create a HEROES-stage fixture: Keeps - MM-YYYY - Test/
mkdir -p "$HOME/projects/elf/photography-shelf/test/fixtures/Keeps - 04-2026 - Test"
SRC="/Users/ava/media/photography/2026-03 - Kat x Tsuki/keeps/Favorites"
ls "$SRC" | grep DNG | head -3 | while read f; do
  cp "$SRC/$f" "$HOME/projects/elf/photography-shelf/test/fixtures/Keeps - 04-2026 - Test/"
done

# FINAL-stage: a Favorites subfolder
mkdir -p "$HOME/projects/elf/photography-shelf/test/fixtures/Keeps - 04-2026 - Test/Favorites"
ls "$SRC" | grep DNG | head -2 | while read f; do
  cp "$SRC/$f" "$HOME/projects/elf/photography-shelf/test/fixtures/Keeps - 04-2026 - Test/Favorites/"
done

ls "$HOME/projects/elf/photography-shelf/test/fixtures/Keeps - 04-2026 - Test/"
```

- [ ] **Step 2: Create stages.spec.js**

Create `test/e2e/stages.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { launchApp, loadFolder, FIXTURES } from '../helpers.js';
import path from 'path';

test('CULL stage detected for unsorted folder', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'unsorted'));
  await expect(window.locator('.stage-pill')).toHaveText(/CULL/);
  await app.close();
});

test('HEROES stage detected for Keeps - MM-YYYY folder', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'Keeps - 04-2026 - Test'));
  await expect(window.locator('.stage-pill')).toHaveText(/HEROES/);
  await app.close();
});

test('FINAL stage detected for Favorites subfolder', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'Keeps - 04-2026 - Test', 'Favorites'));
  await expect(window.locator('.stage-pill')).toHaveText(/FINAL/);
  await app.close();
});
```

- [ ] **Step 3: Create rotation.spec.js**

Create `test/e2e/rotation.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { launchApp, loadFolder, FIXTURES } from '../helpers.js';
import path from 'path';

test('Option+Right rotates image and refreshes thumbnail', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'unsorted'));

  // Intercept rotate API calls
  let rotateCalled = false;
  window.on('request', (req) => {
    if (req.url().includes('/api/rotate') && req.method() === 'POST') {
      rotateCalled = true;
    }
  });

  // Click first card, note the thumbnail src, rotate, verify src changed
  await window.click('.card[data-index="0"]');
  const initialSrc = await window.locator('.card[data-index="0"] img').getAttribute('src');

  await window.keyboard.press('Alt+ArrowRight');
  await window.waitForTimeout(500); // give the API call time to fire

  expect(rotateCalled).toBe(true);

  const newSrc = await window.locator('.card[data-index="0"] img').getAttribute('src');
  expect(newSrc).not.toBe(initialSrc); // bust param was appended

  await app.close();
});
```

- [ ] **Step 4: Run tests**

```bash
cd ~/projects/elf/photography-shelf && npx playwright test test/e2e/stages.spec.js test/e2e/rotation.spec.js 2>&1 | tail -30
```
Expected: 4/4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add test/e2e/stages.spec.js test/e2e/rotation.spec.js
git commit -m "test: stage detection + rotation regression tests"
```

---

## Task 15: Playwright Test — Lightroom Handoff

**Files:**
- Create: `test/e2e/lightroom.spec.js`

- [ ] **Step 1: Create lightroom.spec.js**

Create `test/e2e/lightroom.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { launchApp, loadFolder, FIXTURES } from '../helpers.js';
import path from 'path';

test('Edit in Lightroom button triggers open-in-lightroom API', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'Keeps - 04-2026 - Test', 'Favorites'));

  // Wait for action bar to be visible with Edit in Lightroom button
  const button = window.locator('#action-open-editor');
  await expect(button).toBeVisible({ timeout: 5000 });

  // Intercept the API call — we verify it fires, not that Lightroom actually opens
  const requestPromise = window.waitForRequest(req =>
    req.url().includes('/api/open-in-lightroom') && req.method() === 'POST'
  );

  await button.click();
  const req = await requestPromise;

  const body = req.postDataJSON();
  expect(body.source).toContain('Favorites');

  await app.close();
});
```

- [ ] **Step 2: Run the test**

```bash
cd ~/projects/elf/photography-shelf && npx playwright test test/e2e/lightroom.spec.js 2>&1 | tail -15
```
Expected: 1/1 pass.

NOTE: This test will actually open Lightroom. To avoid that, you can either accept it (Lightroom opens, test still passes because the API call fired), or run the test with a mock — but keep it simple and accept the Lightroom launch.

- [ ] **Step 3: Commit**

```bash
cd ~/projects/elf/photography-shelf
git add test/e2e/lightroom.spec.js
git commit -m "test: lightroom handoff triggers open-in-lightroom API"
```

---

## Task 16: Final Build + DMG

- [ ] **Step 1: Full DMG build**

```bash
cd ~/projects/elf/photography-shelf && npm run build && npx electron-builder --mac 2>&1 | tail -20
```

Expected: produces `dist-electron/Shelf-<version>.dmg` (and also the .app).

- [ ] **Step 2: Verify the DMG**

```bash
ls -lh ~/projects/elf/photography-shelf/dist-electron/*.dmg
```

Expected: A DMG file ~150-250MB (Electron binary + node_modules + deps).

- [ ] **Step 3: Mount and smoke test**

```bash
open ~/projects/elf/photography-shelf/dist-electron/Shelf-*.dmg
```

Expected: DMG mounts showing Shelf.app with a link to Applications. User drags Shelf.app into Applications.

Launch from Applications and verify:
- Welcome screen appears
- Stage pill, help button present
- Native menu visible (macOS menu bar)
- Can open a folder via File > New Shoot
- Can mark images with P/F/X
- Can sort to folders
- DNG conversion works (if dnglab installed)
- Edit Favorites in Lightroom works

- [ ] **Step 4: Final commit**

```bash
cd ~/projects/elf/photography-shelf
git add -A
git commit -m "chore: final build verification" --allow-empty
```
