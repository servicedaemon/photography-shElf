# Shelf UX Redesign

**Date:** 2026-04-08
**Status:** Approved pending review

## Problem

The current Shelf workflow, while functional, has friction points that compound across a culling session:

- Ingest requires 3 clicks + 2 modals before images load
- The P-key cycles through 3 states, forcing users to count presses
- No stage indicator — user can't tell if they're culling or picking heroes
- After sort, app dumps user back to welcome screen with no bridge to the next stage
- Duplicate buttons in header and action bar (Sort to Folders, Edit in Lightroom)
- Keyboard shortcuts and advanced features are invisible
- Every single mark fires a network request (can back up during rapid culling)
- The second-pass "Promote to Favorites" flow has backend support but no UI button

## Goals (from first principles)

1. **Weightless start.** One click from app open to looking at photos.
2. **Match the speed of the decision.** Each mark is one keystroke, one key per decision.
3. **Always know where you are.** Explicit stage indicator + progress count.
4. **Bridge between stages.** After one stage completes, the next action is obvious and one click away.
5. **Progressive depth.** Core culling is surfaced; metadata/tags/rotation are available but not in the way.
6. **Forgiving.** Optimistic UI, reliable undo, batch operations.

## Non-goals

- Rewriting the marking backend (existing `/api/mark`, `/api/sort`, `/folder/:folder/*` endpoints stay)
- Changing file layout conventions (existing `Keeps - MM-YYYY - Name/` structure stays)
- Building color labels, star ratings, or compare view (separate future spec)
- Changing the DNG conversion or Lightroom integration (both work, leave alone)

## Design

### 1. Stage concept (CULL / HEROES / FINAL)

The app tracks an explicit "stage" based on the current source path:

- **CULL** — viewing a loose folder of raw images (pre-sort, or sort's `unsorted/`). Actions: mark images, Sort to Folders.
- **HEROES** — viewing a `Keeps - MM-YYYY - Name/` folder. Actions: mark favorites (heroes), Promote to Favorites.
- **FINAL** — viewing a `Favorites/` subfolder inside a Keeps folder, or a `Favorites - MM-YYYY - Name/` folder. Actions: Convert to DNG, Edit in Lightroom.

The stage is detected from the source path (no user input needed). Header displays the stage as a pill: `[ CULL ]` with a subtle color.

### 2. Input model: dedicated keys

Replace the cycling P key with three dedicated keys that also auto-advance:

| Key | Action | Stages |
|---|---|---|
| **P** | Mark Keep + advance | CULL |
| **F** | Mark Favorite/Hero + advance | CULL, HEROES |
| **X** | Mark Reject + advance | CULL, HEROES |
| **U** | Unmark + advance | All |

Mouse:
- **Click** — toggle Keep on/off
- **Double-click** — promote to Favorite
- **Cmd+click** — toggle Reject
- **Shift+click** — range Keep
- **Shift+Cmd+click** — range Reject
- **Option+click** — peek lightbox (existing)

Behavior differences by stage:
- In CULL, F means "spark" (will be sorted to `Favorites - MM-YYYY/`).
- In HEROES, F means "promote to hero" (will move to `Favorites/` subfolder).
- In FINAL, marking is disabled by default (the viewer is for editing handoff, not sorting). Press any of P/F/X in FINAL triggers a toast: "This is the final selection. Go back to pick more."

### 3. Ingest simplification

Three paths:

1. **Drag a folder onto the window** → detect structure and load.
2. **New Shoot button in header** → native folder picker. If the picked folder has exactly one obvious destination (either a single images folder, or a shoot with a single `unsorted/` subfolder), load it directly. Only show the shoot-list modal if there are genuinely multiple sub-folders to choose between.
3. **Recent Shoots** in header dropdown (last 10 opened paths persisted in `~/.shelf/config.json`).

Auto-detect: when the app launches, check for connected camera drives. If found, show a small non-blocking toast: "Canon card detected — open?" with a button.

### 4. Post-sort bridge

Replace the current "dump to welcome screen" behavior. After `/api/sort` completes, the modal becomes a result card:

```
Sorted 238 images
  84 keeps · 12 sparks · 32 rejects · 110 unsorted

  [ Pick Heroes from Keeps ]   [ Start New Shoot ]   [ Done ]
```

"Pick Heroes" auto-navigates to the new `Keeps - MM-YYYY - Name/` folder (HEROES stage).
"Start New Shoot" opens the native folder picker.
"Done" closes back to the welcome screen.

The same pattern applies after `/folder/:folder/save-favorites`:

```
Promoted 12 images to Favorites
  
  [ Open Favorites ]   [ Keep Reviewing ]   [ Done ]
```

### 5. Action bar consolidation

Remove duplicate action buttons from the header. Header keeps only:
- Stage indicator pill
- Progress stats (always visible when in CULL/HEROES/FINAL)
- Thumbnail size slider
- `New Shoot`, `Scan Card`, `Recent`, `Settings` (dropdown menu)

The floating action bar shows context-aware buttons:

| Stage | Condition | Buttons |
|---|---|---|
| CULL | marks exist | Sort to Folders |
| HEROES | marks exist | Promote to Favorites |
| FINAL | raw files exist | Convert to DNG |
| FINAL | Favorites folder exists | Edit in Lightroom |
| Any | conversion in progress | (progress indicator replaces buttons) |

### 6. Progressive depth hints

- Persistent `?` button in the bottom-right corner of the window, always visible. Opens the existing shortcuts overlay.
- First-run coach marks: on first load of any folder, a one-time overlay briefly shows: *"P to keep · F to favorite · X to reject · Space to preview"*. Dismisses on any keypress or after 3 seconds.
- Small hint strip at the bottom of the screen during CULL/HEROES (when sidebar closed): a subtle row of `P keep · F fav · X reject · Space preview · ? more`. Toggleable from settings (default on).

### 7. Optimistic marking + batched sync

Client updates the grid state and emits events instantly. Network sync happens via a debounced queue (150ms window). Rapid keystrokes coalesce into batch API calls to `/api/mark-batch` instead of firing individual `/api/mark` requests. If a request fails, show a single error toast and roll back affected images.

Implementation: introduce a `markQueue` module on the client that:
- Holds pending marks in a map keyed by filename
- On each mark, updates UI immediately
- Starts/resets a debounce timer on each new mark
- On timer fire, groups by status and sends batched requests
- On error, emits `EVENTS.MARK_ROLLBACK` with affected filenames

### 8. Promote to Favorites UI

The existing `POST /folder/:folder/save-favorites` backend endpoint becomes reachable via a "Promote to Favorites" button in the action bar during HEROES stage (marks exist). Modal flow mirrors Sort to Folders: confirmation showing count, then the post-sort bridge card.

### 9. Undo polish

Existing undo backend stays. Fix the toast text:
- Single mark: `Undid mark (IMG_1414.CR3)`
- Batch mark: `Undid range (40 images)`
- Rotation: `Undid rotation (IMG_1414.CR3)` (new; currently no undo for rotation — out of scope for this spec)

### 10. Window/state persistence (Electron prep)

Save these to `~/.shelf/config.json` on change:
- `recentShoots`: array of last 10 opened paths
- `windowBounds`: `{x, y, width, height}` (set only in Electron shell)
- `hintStripVisible`: boolean for the bottom hint strip
- `defaultSource`: already exists, keep

## Files to Create/Modify

### Server

- `server/lib/stages.js` (new) — exports `detectStage(sourcePath)` returning `'CULL' | 'HEROES' | 'FINAL'`. Detection rules: path ends with `/Favorites` or matches `^Favorites - \d{2}-\d{4} -` → FINAL; path matches `^Keeps - \d{2}-\d{4} -` → HEROES; otherwise CULL.
- `server/routes/images.js` (modify) — return `stage` field in folder metadata responses.
- `server/routes/config.js` (modify) — add `recentShoots` to the allowed config keys.

### Client

- `client/src/stage.js` (new) — tracks current stage, exports `getStage()`, listens to `MODE_CHANGED`, emits `STAGE_CHANGED`.
- `client/src/mark-queue.js` (new) — optimistic marking with debounced batch sync.
- `client/src/ingest.js` (new) — unified ingest: drag-drop, smart folder detection, recent shoots.
- `client/src/main.js` (modify) — wire up new ingest, replace sort completion flow with bridge card, remove redundant header action buttons.
- `client/src/actions.js` (modify) — context-aware buttons based on stage, add Promote to Favorites.
- `client/src/keyboard.js` (modify) — replace P cycle with P/F/X/U dedicated keys. Keep existing single-purpose shortcuts.
- `client/src/selection.js` (modify) — simplify click model (click = keep toggle, dblclick = favorite, cmd+click = reject).
- `client/src/hints.js` (new) — persistent `?` button, first-run coach marks, bottom hint strip.
- `client/src/grid.js` (modify) — add drag-drop handling, update click handler.
- `client/src/events.js` (modify) — add `STAGE_CHANGED`, `MARK_ROLLBACK`.

## Out of Scope (Future Work)

- Electron desktop packaging — separate spec
- Star ratings (1-5)
- Color labels (Lightroom-style)
- Side-by-side compare view
- Smart filters (ISO, lens, focal length)
- Batch rename with EXIF tokens
- Face grouping
- Watch folders
- Export presets

## Risk & Mitigation

- **Risk:** changing keybindings will break muscle memory. **Mitigation:** keep P working (as Keep). Add F and X as new keys. U replaces the "third press = unmark" behavior. Show coach marks on first load after update.
- **Risk:** optimistic sync could leave client/server out of sync on network failure. **Mitigation:** on error, roll back affected images and show a single persistent toast with "retry" option.
- **Risk:** auto-detect stage from path might misfire on folders that happen to match `Keeps - MM-YYYY -` by coincidence. **Mitigation:** the detection regex is strict and matches the existing sort-output pattern. Loose folders named similarly are rare; if needed, the stage can be overridden via a dropdown in the header.
