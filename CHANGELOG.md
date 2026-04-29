# Changelog

All notable changes to Shelf will be documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [1.3.0] — 2026-04-28

Two features for real culling work: zoom that survives stack navigation, and a settable library root so new shoots land where you actually keep your photos.

### Added

- **Zoom persists across stack siblings.** Open a burst, double-click (or press `Z`) to zoom into the subject's eyes, then arrow through the burst — the zoom stays put so you can compare focus and sharpness frame-by-frame at the same magnification. Zoom resets when you cross a stack boundary or navigate to a non-stack image, since that's where the comparison frame of reference ends.
- **`Z` keybinding for lightbox zoom.** Plain `Z` (no modifier) toggles zoom when the lightbox is open. `Cmd/Ctrl+Z` is still global undo.
- **Settable library root.** `File → Set Library Root…` opens a folder picker and persists your choice. Every new shoot you sort goes into that root.
- **`/api/promote-favorites` and `/api/folder-mark`** — path-based replacements for the legacy `/folder/:folder/*` routes. They work for both nested and flat layouts and require the source to be inside the configured library root (path-traversal containment). The legacy routes still exist for back-compat with anyone in mid-flight.

### Changed

- **Nested per-shoot layout for new sorts.** Sorting now creates `<libraryRoot>/<shoot name>/{unsorted, keeps, favorites, rejects}/` instead of the flat `<sortDir>/{Keeps, Favorites, Rejects, Unsorted} - MM-YYYY - <name>/` siblings. Shoots are now self-contained folders that read naturally in Finder and match the convention every external photo workflow already uses.
- **Default library root is now `~/Pictures/Shelf/`** for fresh installs (was `~/Pictures/sorted/`). Reads naturally to a stranger; lives in the standard macOS Pictures dir.
- **Existing configs migrate automatically.** On first launch of v1.3.0, your old `sortDir` value is moved to `libraryRoot` so nothing breaks. The migration is a one-time write; the new key sticks from then on.
- **Filename collisions get a numeric suffix** (`IMG_1234-2.CR3`, `-3`, …) instead of overwriting silently.
- **Sort modal explainer reads the actual library root** and points to the menu item for changing it. The "dated" wording is gone — folder names no longer carry a `MM-YYYY` prefix.

### Fixed

- **`handlePromoteFavorites` works under nested layout.** The old code extracted just the leaf basename of the source path and passed it to `/api/folder/:folder/*`, which silently 404'd for `<shoot>/keeps/` because the leaf was just `keeps`. The new path-based endpoints handle both layouts and detect nested-vs-flat by checking peer subfolders.
- **Layout detection is conservative.** Standalone folders named "keeps" without peer status subfolders are no longer false-positive routed as nested shoots. Requires a sibling `favorites/`, `rejects/`, or `unsorted/` to trust the nested heuristic.
- **`/api/folder-mark` and `/api/promote-favorites` reject sources outside the library root** with a 403, consistent with the legacy `/folder/:folder/*` containment check.
- **Promote-favorites surfaces non-2xx responses** as toasted errors. Was: `fetch().then(r => r.json())` swallowed 4xx/5xx silently.

### Under the hood

- 10 new unit tests in `server/test/sorting.test.js` covering `uniqueDest` collision handling and layout detection edge cases. 67 total server tests.
- `server/lib/state.js` migration writes through `atomicWrite` directly inside `getConfig()` — single round-trip, cache + disk consistent before any concurrent caller can race it.
- Lint baseline still 0 warnings, 0 errors.

### Known follow-ups (not blocking)

- `setState` debounce in `server/lib/state.js` can lose marks under sub-100ms rapid sequential `/api/mark` calls. Real culling is keystroke-paced (>100ms between marks) so this isn't user-visible, but worth tightening.
- Display label in `showPromoteBridge` for flat-layout sources reads slightly oddly ("photography/Keeps - 04-2026 - Name"); fine for nested. Cosmetic.
- Legacy `/folder/:folder/*` endpoints can be deleted in a future version after a deprecation window.

## [1.2.3] — 2026-04-26

Stack interaction polish + lightbox filmstrip rewrite. Hover the collapsed-stack badge to learn the hotkey. The cover acts like the stack on every action. The filmstrip stays put when you navigate.

### Changed

- **Plain `K` / `F` / `X` / `U` on a collapsed-stack cover now marks the whole stack.** Matches what rotate (`⌥←`/`⌥→`) and tag already do — when only the cover is visible, "what you see is what you affect." `Shift+K/F/X/U` still always marks the whole stack regardless of collapse state. Closes a documented inconsistency in the original mark design (the `markCurrentStack` design note explicitly noted plain mark was the odd one out).

### Added

- **Hover tooltip on collapsed-stack badges** — hover the `◈N` badge on a collapsed cover to see the expand hotkey (`S TO EXPAND`). Glass background, amber hairline, mono uppercase — matches the coach-marks aesthetic. Only appears on collapsed covers; expanded stacks keep the existing native-title fallback.

### Fixed

- **Lightbox filmstrip no longer jumps to the start on every navigation.** Pressing arrow keys in the lightbox used to snap the bottom thumbnail bar to scrollLeft=0, then smooth-scroll back to the new active thumb — looking like the filmstrip was "reloading" on every key press. Root cause: `renderLightbox()` was rebuilding the entire `lightboxEl.innerHTML` on every navigation, replacing the filmstrip DOM and resetting its scroll. Refactored into `buildLightboxShell()` (one-time per shoot) + `updateLightboxFrame()` (lightweight per-navigation: just toggles classes on existing thumbs, swaps the main image src, updates info text). Filmstrip scroll position is now preserved between navigations, no thumbnail re-fetch flicker, and a `frameId` counter guards against stale hi-res preloads firing after rapid navigation.
- **Release artifact filenames now consistent across releases.** v1.2.2 shipped `Shelf.Setup.1.2.2.exe` (periods between words) and `photography-shelf_1.2.2_amd64.deb` (verbose package-name prefix) due to electron-builder's defaults. Added explicit `nsis.artifactName` and `deb.artifactName` overrides so v1.2.3+ ships clean `Shelf-Setup-1.2.3.exe` and `shelf_1.2.3_amd64.deb` like v1.2.1 did.

### CI

- macOS x64 (Intel) build dropped from the release matrix in v1.2.2 — five consecutive releases never produced an Intel artifact and the `macos-13` runner queue was unreliable. Apple Silicon Mac users still get a native build; Intel Mac users can run the arm64 DMG via Rosetta 2.

## [1.2.2] — 2026-04-25

Visual hotfix: welcome-screen workflow chips now render on a single row at every viewport width.

### Fixed

- **Welcome workflow chips wrapping to multiple rows** — even at full screen, the `CULL → HEROES → FINAL` row was breaking onto separate lines. Root cause: container had `max-width: 720px; flex-wrap: wrap` plus chips had `min-width: 160px`, and the long descriptions ("Convert to DNG, hand off to Lightroom") pushed the row past 720px no matter how wide the viewport was. The viewport never got a vote — the inner constraint forced wrap.
- Chips now use `flex: 1 1 0; min-width: 0` so they share whatever horizontal space is available equally and shrink uniformly. Container is `flex-wrap: nowrap` to forbid wrapping. Descriptions tightened to "Mark every photo" / "Pick your best" / "Convert + hand off" to fit comfortably down to ~600px viewports.
- `text-overflow: ellipsis` on the description span now correctly works as a fallback at extreme narrow viewports — needs `display: block` + `width: 100%` on a span for the clip to actually fire (sonnet review catch).

## [1.2.1] — 2026-04-24

Pre-public-launch polish pass. No new features — fewer rough edges, cleaner code, more tests, friendlier first-run.

### Fixed

- **MARK_ROLLBACK was emitted but never handled** — when the mark queue's network flush failed, the UI was already optimistically updated and the failure was silent, leaving the grid out of sync with disk. Now refreshes from server on flush failure with an explicit toast. Also catches non-2xx responses (fetch only throws on network errors).
- **DNG-not-installed UX** is now an actionable modal with platform-detected install command, copy-to-clipboard button, and a link to dnglab releases — not a buried error toast. The most common first-run wall is now friendly.
- **Recent-shoots leak** — older versions sometimes pushed sub-folder paths (`shoot/keeps`, `shoot/Favorites`) into the recent list. `getRecentShoots()` now normalizes + dedupes on load so legacy entries are cleaned up automatically.
- **Latent bug in `sorting.js`** — `VALID_FILENAME` was used in four places but never imported. Code paths hitting those filters would have thrown at runtime. Now imported from the canonical `lib/validate.js`.

### Polished

- **First-run discoverability**:
  - Welcome screen shows a `CULL → HEROES → FINAL` workflow chip row so new users have orientation before they touch anything.
  - Coach marks now include `Shift+K stack` — the v1.2.0 headline feature was previously invisible during onboarding.
  - The `?` help button gets a subtle amber pulse for the first session per machine, fading after first click. Returning users don't see it.
  - README leads the macOS install section with a clear "you'll see a security dialog" callout. The `xattr` workaround is collapsed into a `<details>` block so it doesn't scare normal users.

### Under the hood

- Lint baseline: **0 errors, 0 warnings** (was 7 warnings + 4 errors).
- Removed dead code: 6 unused event constants, `getStage` import, `stageTooltip` ghost function, `showInputModal` complete-but-dead modal, vestigial `lastClickIndex` + `source` in selection.js, `getStacks` import in keyboard.js.
- Extracted to testable libs: `server/lib/orientation.js` (EXIF Orientation transition map) and `server/lib/keywords.js` (read-merge-write logic for the CR3 tag fix). Both come with full unit tests.
- 57 server tests pass (was 37). 20 new tests cover orientation cycle invariants and keyword merge edge cases.
- Prettier formatting applied across 22 files — repo opens cleanly for new contributors.

## [1.2.0] — 2026-04-24

Stacks — full-featured burst grouping. v1.1.0 shipped the detection + badge; v1.2.0 is the full interaction set.

### New

- **Rename burst → stack.** "Stack" is the generalizable concept — time-clustered bursts are one detection strategy, HDR brackets and manual groupings can populate the same structure in v1.3+.
- **Collapse / expand** — `S` toggles the current stack, `Shift+S` toggles all. Stacks default to collapsed on load (scannability win — 2000-photo wedding becomes 400 stacks + singletons).
- **Promote cover frame** — `P` on any frame promotes it to be the stack's cover when collapsed. Session-only; resets per-launch.
- **Jump between stacks** — `G` / `Shift+G` navigates next/previous stack's cover. Toasts "No stacks in this shoot" when there aren't any.
- **Group mark + auto-advance past stack** — `Shift+K/F/X/U` marks every frame in the focused stack and advances to the first unmarked photo AFTER the stack. An N-frame burst cull = 1 keypress.
- **Batch rotate + batch tag** — Option+Arrow rotation and sidebar tagging both compose with the current selection. Range active → applies to range. Collapsed stack cover focused → applies to whole stack. Else → single focused photo. Tag sidebar shows amber "TAG APPLIES TO THIS STACK (5)" helper.
- **Lightbox stack siblings** — when viewing any stack member in the lightbox, filmstrip thumbnails belonging to the same stack get an amber underline. See adjacent burst frames at a glance.
- **Header stats** — "N stacks · M frames" shows next to SHELF when at least one stack exists. Hover for shortcut summary.
- **First-run hint** — one-time toast on first shoot load with stacks: "N stacks detected — press S to expand."

### Fixed (pre-existing CR3 tag bug, surfaced by batch)

- The `/api/metadata/tag` endpoint previously used exiftool's `Keywords+` append syntax, which silently no-ops on CR3 files (exiftool writes the append to XMP/IPTC which doesn't merge back into the CR3 container). Server now does read-merge-write internally — reads current keywords, computes the merged set, writes with plain `Keywords: [...]`. Works uniformly across DNG/JPEG/TIFF/CR3. Legacy API shape (`Keywords`, `Keywords+`, `Keywords-`) still accepted.

### Under the hood

- Unified selection model: single / range / stack as three shapes of "the current selection." Batch operations (mark, rotate, tag) each read the context and act accordingly. Range selection wins over stack when both apply (explicit user intent beats implicit stack membership).
- Arrow keys skip hidden (collapsed-stack non-cover) cards via `nextVisibleIndex` — navigation feels natural with collapsed stacks.
- New `grid.js` exports: `getStacks`, `getStackIdFor`, `getStackSize`, `getStackMembers`, `getStackIndices`, `getStackSpanForIndex`, `isStackCollapsed`, `coverFilenameFor`, `isImageVisible`, `nextVisibleIndex`, `jumpToNextStack`, `toggleStackAtCurrent`, `toggleAllStacks`, `promoteCoverAtCurrent`.
- Shortcuts overlay (`?` key) now includes a dedicated "Stacks" section documenting every new keybinding.
- 37/37 server tests pass (no regressions).

### Deferred to v1.3+

- Manual stacks (user groups arbitrary photos) — needs `.shelf/stacks.json` disk persistence + new UX
- HDR bracket / focus-stack auto-detection via exposure/focus EXIF clustering
- Persistent cover frame across sessions
- Sharpness-based "best pick" indicator (wrong too often on portraits to ship)

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
