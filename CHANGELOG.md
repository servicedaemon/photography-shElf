# Changelog

All notable changes to Shelf will be documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.3] — 2026-04-22

Hotfix for three bugs caught during live culling on a real shoot.

### Fixed
- **"Failed to load metadata" after adding a single tag** — exiftool returns `Keywords` as a string when a tag has one value, an array when multiple. The sidebar's `.map()` crashed on the string. Server now coerces single-value tags to arrays before responding.
- **Adding a second tag wiped the first** — `addTag` was writing `Keywords: [tag]`, which exiftool treats as REPLACE. Switched to the `Keywords+` append-suffix so tags accumulate as expected.
- **"Unable to find application named 'Adobe Lightroom CC'"** — `/Applications/Adobe Lightroom CC/` is the container folder, not the app; the actual app inside is `Adobe Lightroom.app`. `openFolderInLightroom` now targets by bundle ID (`com.adobe.lightroomCC`) with named-app fallbacks, so the handoff works across Lightroom CC and Classic installs.
- **Filename appeared twice on broken thumbnails** — `<img alt="filename">` caused the browser to render the filename inside the broken-image box, on top of the existing label. Switched image alts to `alt=""` (decorative) since filename is conveyed by the label/info region below.

### Under the hood
- Cleaned up unused `VALID_FILENAME` constant in `server/lib/platform.js`
- Added `dist-electron/` to the eslint ignore list (was linting built artifacts)

## [1.0.2] — 2026-04-22

Hotfix for macOS install friction.

### Fixed
- **macOS "Shelf is damaged" error on first launch** — added ad-hoc codesigning in the build (`codesign --force --deep --sign -` via `afterPack` hook). macOS Sequoia was flagging the unsigned downloaded app as damaged, which blocked users from even getting to the right-click-Open bypass. Now the app has a valid ad-hoc signature, so users see the normal "unidentified developer" flow that they can click through.
- README troubleshooting for the rare case where macOS still flags the app: `xattr -cr /Applications/Shelf.app` clears the download-quarantine attribute.

## [1.0.1] — 2026-04-22

First rapid-polish release after real-world use. Everything under the hood works; this is the sweep that makes it feel right.

### New
- **Windows (x64)** installer added to releases — Shelf now ships as a Mac DMG and a Windows NSIS installer from one codebase
- **Shoot folder navigator** — chip row above the grid showing all of a shoot's sub-folders with counts (Unsorted · Keeps · Favorites · Rejects · Edited); click to jump between them without leaving the app
- **Empty Rejects** button — moves reject images to system Trash (recoverable), not hard delete
- **Move to Shoot** — shift+click a range, move photos to another shoot (existing or new) as unsorted
- **Exit Shoot** button in the header — close a shoot without navigating back through sort flows

### Changed
- **Sort to Folders unified into one dialog** with a "Create as a new dated shoot instead" checkbox. Default behavior: inside an existing shoot → sort in place (marks route into the shoot's own folders); loose folder / fresh card → create a new dated bundle
- **Folder picker** now surfaces one row per shoot (with a summary like "12 unsorted · 40 keeps · 8 favorites") rather than exploding every shoot into sub-folder chips
- **Stage detection** now reflects the shoot's overall state, not the specific sub-folder you're viewing — stage stays stable as you toggle between Keeps / Favorites / Rejects via the nav
- **Filter row** labeled "Filter" + color-tinted inactive pills to distinguish from shoot-nav chips
- **Removed redundant header stats row** (per-session per-sub-folder counts conflicted with the filesystem-wide chip counts below)
- `K` is now the "keep" key (was `P`) — more mnemonic

### Fixed
- Rotation on DNG / CR3 files now actually updates the visible thumbnail (was writing EXIF but sharp was reading from the pre-rotated embedded preview)
- Exit Shoot no longer leaks stale grid state (space bar used to open lightbox against the previous shoot)
- Empty folders show a "nothing here yet" state inside the grid, not the welcome screen
- Escape reliably closes modals (handler no longer leaks on overlay-click dismissal)
- Option+click peek preview + Option+Arrow rotate (Cmd+combos were being eaten by the browser / treated as right-click on macOS)
- Inline-shoot stage detection (`keeps/` sub-folder inside `2026-03 - Name/` now detected correctly)
- Cross-platform path handling (forward-slash and backslash both work server-side and in client path operations)

### Under the hood
- Cleanup pass: removed dead CSS selectors from the old picker, tightened stale comments, audited for unused code
- Accessibility: filter group gets `role="group"` + `aria-label`; focus-visible rings throughout
- 13 server tests + 9 Playwright E2E tests, all passing

## [1.0.0] — 2026-04-21

First public release 🌟

### Workflow
- Three-stage model: `CULL` / `HEROES` / `FINAL`, auto-detected from folder path
- Dedicated marking keys: `K` keep, `F` favorite, `X` reject, `U` unmark (auto-advance)
- Range selection via Shift+click + bulk mark via any key
- Drag-and-drop folder ingest, recent-shoots menu on welcome
- Post-sort bridge card with "Pick Heroes" → one-click to heroes stage
- Post-promote bridge card with "Open Favorites"
- Sort in Place — routes leftovers into an existing shoot's sibling folders
- Move to Shoot — send a range to another shoot (new or existing) as `unsorted/`
- Shoot folder navigator chip row with per-folder image counts
- Empty Rejects — moves reject photos to system Trash (recoverable)

### Photography pipeline
- CR3 / CR2 / ARW / NEF / RAF → DNG conversion via `dnglab`
- Optionally move originals to `originals/` subfolder after conversion
- One-click "Edit Favorites in Lightroom" opens Lightroom CC
- EXIF inspector sidebar (camera, lens, exposure, tags)
- EXIF-orientation rotation with Option+Arrow

### Design & feel
- "Darkroom + pixel workshop" aesthetic: deep black + amber safelight
- Archivo Narrow display + JetBrains Mono body
- Pixel elf mascot reacts to events (sparkle on favorite, confused on reject, scribbling during conversion, waving on promote)
- Cards pulse on mark, stagger on folder load
- Cinematic lightbox with crossfade and filmstrip
- First-run coach marks, persistent `?` help button
- Window-state persistence, multi-display clamping

### Packaging
- Electron 33 + electron-builder
- macOS Apple Silicon DMG build
- Native menu (File / Edit / View / Window / Help)
- Native notifications on long operations (when app unfocused)
- Dock progress bar during DNG conversion

### Quality
- 9 Playwright E2E tests (launch, marking, stages, rotation, lightroom handoff)
- Node built-in tests for server stage detection
- Path scoping on file-listing endpoint
- Image-extension validation on trash IPC
- Optimistic marking with debounced batch sync

### Known limitations
- App isn't code-signed — first launch requires right-click → Open
- `Convert to DNG` requires `brew install dnglab` separately
- Windows and Intel Mac builds not yet published (build from source works)
- No auto-updater yet — rebuild or download new releases manually
