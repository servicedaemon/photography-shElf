# Changelog

All notable changes to Shelf will be documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [1.1.0] — 2026-04-23

Burst grouping. One decision per group instead of N.

### New

- **Burst grouping** — photos taken within 5 seconds of each other are detected automatically via EXIF `DateTimeOriginal` + `SubSecTimeOriginal`. Cards in a burst get a `◈N` badge showing the group size. Hover any burst card and all its siblings light up in amber so you can compare the group and pick the best one with one decision.
- **Chain clustering** — if A-B are within 5 seconds and B-C are within 5 seconds, all three cluster together even though A-C may span 8+ seconds. Matches how Canon-style burst mode writes frames.

### How the detection works

Shelf batch-reads EXIF timestamps when you load a shoot (cached per folder until any file changes). A pure `groupImages()` function does the clustering — 12 unit tests cover empty input, singletons, chain clustering, gap breaks, boundary cases, and real-shoot data from a confirmed IMG_1445/1446/1447 burst in one of Ava's sessions.

### Why not ML?

A CLIP-vs-DINOv2-vs-timestamp spike on 14 real photos from 4 shoots found timestamp clustering at 5s gap had **F1 = 1.00** — identical accuracy to DINOv2-small at cosine 0.80, and strictly better than CLIP ViT-B/32 (F1=0.88). Timestamps are free; ML was 111ms/photo and required a 22MB bundled model. Design brainstorm + pressure-test notes are in `docs/design/`. The ML path is still reachable via a clean `groupImages()` seam if retake detection (same setup, long gap) ever surfaces as real friction.

### Under the hood

- `server/lib/grouping.js` — pure clustering function (12 tests)
- `server/lib/exif-cache.js` — batch EXIF read with per-folder mtime cache. Exports `exifToTimestamp()` as a testable pure fn (11 more tests) that correctly handles 1-digit, 2-digit, and 3-digit `SubSecTimeOriginal` values — the naive `parseInt × 10` formula (which would have shipped) would have silently corrupted timestamps on Sony / Nikon cameras that emit different digit counts.
- `/api/images` response extended with a `bursts` field (array of filename arrays, one per group).
- 37 server tests pass.

## [1.0.5] — 2026-04-22

Three-theme system + README visuals.

### New

- **Light + Grey themes** — Shelf now ships three themes instead of dark-only. Toggle in the header cycles `D / G / L`.
  - **Dark** (default) — the original deep-black darkroom, unchanged.
  - **Grey** (new) — neutral 18% mid-tone (≈#787878, the photographer's grey card / Zone V). Exists specifically so bright/white-heavy photos can be judged against a perceptually neutral background rather than pure black or pure white.
  - **Light** (new) — warm off-white with darker ink and desaturated amber. For photos that look right against a light page (portraits, flat lay).
- Theme persists to `~/.shelf/config.json` (or `%APPDATA%\shelf\config.json` on Windows) and restores on launch.
- **Screenshots in README** — hero welcome-screen image plus a 2×2 gallery of grid / lightbox / shoot picker / favorites.

### Under the hood

- Theme system lives in CSS custom properties. `:root` holds dark defaults; `[data-theme='grey']` and `[data-theme='light']` override the surfaces, glass tints, hairlines, and atmospherics. Status hues (keep / favorite / reject) keep the same recognizable colors across all three themes, with only deep-bg tints adjusted for contrast.
- Lightbox stays pure black across all three themes by design (cinematic full-screen photo viewing).
- `.card .badge` now uses `var(--badge-text)` rather than `var(--bg)`, so the on-amber/on-steel badge text stays dark in all themes.
- `openFolderInLightroom()`'s toast fix from v1.0.4 carried forward.

## [1.0.4] — 2026-04-22

Linux support — Shelf now runs on a third platform.

### New

- **Linux builds** — `Shelf-1.0.4.AppImage` (portable, any distro) and `shelf_1.0.4_amd64.deb` (Debian/Ubuntu) ship alongside the existing macOS DMG and Windows NSIS installer.
- **Platform-aware "Edit in Lightroom" toast** — the success toast now reflects what actually opened. On macOS it reads _"Opening Favorites in Lightroom..."_; on Windows/Linux it reads _"Opened Favorites — drag into Lightroom from here."_ (since the OS opens the folder in Explorer / file manager rather than auto-handing it to Lightroom).

### Under the hood

- `openFolderInLightroom()` now returns `'lightroom' | 'filemanager'` so callers can phrase accurate user feedback.
- CI workflow gained a `build-linux` job (`ubuntu-latest` runner, `fakeroot` for .deb packaging). Build matrix is now macOS arm64 + x64, Windows x64, Linux x64.

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
