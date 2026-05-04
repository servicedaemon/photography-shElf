# Windows QA Handoff — Shelf v1.0.0

**For:** a Claude Code (or engineer) on a Windows machine  
**Goal:** verify Shelf runs correctly on a real Windows install

## Context

Shelf is a macOS-first Electron app with Windows support just added. It has not yet been launched on a real Windows box. This doc is a step-by-step protocol for running that first-launch QA. It should take 20-30 minutes.

## Before you begin

On the Windows test machine you will need:
- **Windows 10 or 11** (x64)
- **~200MB** of free disk for install + test fixtures
- A folder with at least **5 image files** (JPG, DNG, or Canon/Nikon raw). If you don't have camera raws, any JPGs work for basic testing.
- **Optional**: Chocolatey installed (for testing DNG conversion end-to-end) — skip if you're not testing DNG flow.

## Download the installer

Option A: From the GitHub Release (after it's published):
- https://github.com/servicedaemon/photography-shElf/releases/latest
- Download `Shelf-Setup-1.0.0.exe`

Option B: From the CI artifact (no release needed):
```powershell
gh run download 24760358446 --repo servicedaemon/photography-shElf --name shelf-windows-x64 --dir C:\temp\shelf
```

## The protocol

### 1. Install
- [ ] Double-click `Shelf-Setup-1.0.0.exe`
- [ ] Windows SmartScreen warning appears (blue screen, "Windows protected your PC"). Click **More info** → **Run anyway**.
- [ ] NSIS installer runs. Accept defaults.
- [ ] Confirm a Shelf shortcut appears in Start Menu and on the Desktop.

**Expected:** Installer completes without error. App is installed under `%LOCALAPPDATA%\Programs\Shelf\` (per-user install) or `C:\Program Files\Shelf\` (all-users).

### 2. First launch
- [ ] Launch Shelf from Start Menu or Desktop shortcut.
- [ ] The app window opens within ~5 seconds.
- [ ] Welcome screen is visible: big pixel elf, "Welcome to Shelf" title.
- [ ] The `?` help button appears in the bottom-right corner.

**If it doesn't launch:** something in `electron/main.js`, `electron/server-process.js`, or the spawned server failed. Check Event Viewer → Windows Logs → Application for errors from `Shelf.exe`.

### 3. Server health (open DevTools)
- [ ] Open DevTools: **View menu → Toggle DevTools** (or `Ctrl+Shift+I`).
- [ ] Go to the **Network** tab.
- [ ] In the Console tab, paste:
  ```js
  fetch('/api/health').then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)))
  ```
- [ ] Expected output:
  ```json
  { "ok": true, "checks": { "express": true, "sharp": true, "exiftool": true, "exiftoolVersion": "..." } }
  ```

**If `sharp: false`:** the sharp native module failed to load. Look for VC++ redistributable errors. Windows may need Microsoft Visual C++ 2015-2022 Redistributable (x64).

**If `exiftool: false`:** the exiftool binary failed to spawn. Windows Defender may be quarantining the bundled `exiftool.exe`. Add `%TEMP%\exiftool-vendored*` to Defender exclusions.

### 4. Open a folder
- [ ] Menu: **File → New Shoot**.
- [ ] Select a folder with at least 5 image files.
- [ ] The grid should populate with thumbnails within 30 seconds.

**Expected:** Thumbnails render. Stage pill shows `CULL` (or `PICKS`/`FINAL` depending on folder name).

**If thumbnails are stuck as skeletons:** see step 3 failure modes. Run the health check again to see which module failed.

### 5. Marking
- [ ] Click the first thumbnail — it should get a blue "keep" border.
- [ ] Press `K` on the next image — should mark keep and auto-advance.
- [ ] Press `F` — favorite (amber).
- [ ] Press `X` — reject (rose, desaturated thumbnail).
- [ ] Press `U` — unmark.

**Expected:** Each mark shows a brief "pulse" animation on the card.

### 6. Sort to Folders
- [ ] Mark a few images various ways. Click **Sort to Folders** in the action bar.
- [ ] Enter a shoot name (e.g. "Windows Test").
- [ ] Confirm.
- [ ] Bridge card appears: "Sorted N images".
- [ ] Check on disk: `C:\Users\<you>\Pictures\sorted\Keeps - MM-YYYY - Windows Test\` should exist with your keep files.

**Expected:** Folders created under `%USERPROFILE%\Pictures\sorted\`. Files moved from the source.

**If it crashes with 500 error:** likely `os.homedir()` fallback didn't work. Check server logs.

### 7. Sort in Place + shoot navigator
- [ ] From the bridge card, click **Pick Heroes**.
- [ ] The app navigates to the new Keeps folder. Stage pill shows **PICKS**.
- [ ] A chip row appears above the grid showing `Unsorted / Keeps / Favorites / Rejects / Edited` with counts.
- [ ] Click a chip — navigates to that folder.
- [ ] Click the active chip — no-op.

### 8. Empty Rejects
- [ ] Mark some as reject. Click Sort to Folders → Pick Heroes.
- [ ] In the shoot nav, an "Empty Rejects" chip appears on the right with a count.
- [ ] Click it → confirmation modal shows count.
- [ ] Confirm → files move to Recycle Bin (not hard deleted).
- [ ] Open Recycle Bin, verify they're there.

**Expected:** Files in Recycle Bin. Shoot nav updates. Count reflects reality.

### 9. Convert to DNG (optional)
- [ ] If you have raw files, click **Convert to DNG** from a FINAL-stage folder.
- [ ] If dnglab isn't installed, you should see a toast: "Install via Chocolatey: choco install dnglab..." (not "cargo install").
- [ ] If dnglab IS installed (via `choco install dnglab`), the conversion should run.

**If toast says "cargo install":** the platform-specific hint fix didn't land. Report it.

### 10. Edit in Lightroom
- [ ] From a Favorites folder, click **Edit in Lightroom**.
- [ ] On Windows: File Explorer should open pointed at the Favorites folder. (Lightroom itself does NOT auto-launch — this is a documented Windows limitation.)

### 11. Window state persistence
- [ ] Resize the window to something unusual (e.g. 1200×700, dragged to right half of screen).
- [ ] Close the app.
- [ ] Relaunch.
- [ ] Window reopens at the same size and position.

**Config should be at:** `%APPDATA%\shelf\config.json`. Verify with:
```powershell
Get-Content "$env:APPDATA\shelf\config.json"
```

### 12. Keyboard shortcuts
- [ ] Press `?` — shortcuts overlay appears.
- [ ] Press `Esc` — overlay closes.
- [ ] Press `Space` with an image selected — lightbox opens.
- [ ] Press `Space` again — lightbox closes with a fade animation.
- [ ] `Ctrl+Z` — undoes last mark (toast appears).

### 13. Drag-drop (bonus)
- [ ] Drag a folder from File Explorer onto the Shelf window.
- [ ] Expected: overlay appears briefly, folder loads.

## Report back

Fill in:

```
Platform: Windows <10/11>, build <XX>
Shelf version: 1.0.0
Steps passed: NN/13

FAILED steps (if any):
  - Step X: <what happened>

Notes:
  - <anything unusual>
```

Post this to the GitHub repo as an issue: https://github.com/servicedaemon/photography-shElf/issues

## Known limitations (not bugs)

- "Edit in Lightroom" opens Explorer, not Lightroom (step 10)
- App is unsigned; SmartScreen warns on first launch (step 1)
- dnglab must be installed separately (`choco install dnglab`)
- No auto-updater yet

## Debugging tips for the tester

- **DevTools**: `Ctrl+Shift+I` while the app is focused
- **Server logs**: the Electron main process writes server stdout/stderr to the console. With DevTools closed, you won't see them. To see them: launch from PowerShell via `& "C:\Users\<you>\AppData\Local\Programs\Shelf\Shelf.exe"`.
- **App data**: `%APPDATA%\shelf\` for config, `%TEMP%\shelf-thumbs\` for thumbnail cache
- **Uninstall**: Settings → Apps → Shelf → Uninstall
