# Changelog

All notable changes to Shelf will be documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

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
