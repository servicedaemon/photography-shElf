# DNG Conversion Tool + Open in Lightroom

**Date**: 2026-04-07
**Status**: Approved

## Problem

CR3 (Canon Raw v3) files from the Kat x Tsuki photoshoot are not recognized as editable media by Adobe Lightroom CC. Lightroom shows "this folder doesn't contain any editable media" when opening a folder of CR3 files. DNG (Adobe's universal raw format) is guaranteed compatible and preserves full raw quality.

## Feature 1: Convert to DNG

### Conversion Engine

- **Tool**: `dnglab` — open-source CLI, purpose-built for raw-to-DNG conversion
- **Install**: `cargo install dnglab` or download binary
- **Command**: `dnglab convert <input.CR3> <output.DNG>`
- **Quality**: Lossless — wraps raw sensor data in DNG container, no re-encoding
- **Supported input formats**: CR3, CR2, ARW, NEF, RAF (matches existing `VALID_FILENAME` regex in sorting.js)

### UI

- **Button**: "Convert to DNG" in the floating action bar
- **Visibility**: Shown when the current folder contains convertible raw files (any of: .cr3, .cr2, .arw, .nef, .raf)
- **Scope**: Batch operation — converts all raw files in the currently viewed folder (including Favorites subfolder if that's the active view)

### User Flow

1. User clicks "Convert to DNG"
2. Modal asks: **"Keep original CR3 files?"** — two buttons: "Keep Originals" / "Remove After Converting"
3. Conversion runs with progress indicator: "Converting 3 of 24..."
4. Per-file behavior on successful conversion:
   - **Keep originals**: Move source file to `originals/` subfolder within the same directory
   - **Remove originals**: Delete source file
5. DNG files written to the same directory with the same base filename (e.g., `IMG_1414.CR3` -> `IMG_1414.DNG`)
6. Thumbnail cache invalidated for converted files so the grid refreshes
7. Toast notification on completion: "Converted 24 files to DNG"

### Error Handling

- **dnglab not installed**: Endpoint returns 501 with message telling the user to install dnglab. UI shows an informative error with install instructions.
- **Single file fails**: Log the error, skip it, continue with remaining files. Report failures in the completion summary.
- **Already converted**: Skip files that already have a corresponding `.DNG` in the target directory.

### Server API

**`POST /api/convert`**

Request body:
```json
{
  "source": "/path/to/folder",
  "keepOriginals": true
}
```

Response (returns when all conversions complete):
```json
{
  "total": 24,
  "converted": 24,
  "skipped": 0,
  "errors": []
}
```

Client shows a modal with indeterminate progress ("Converting to DNG...") while waiting for the response. The server processes files sequentially, then returns the full result.

Implementation: Shell out to `dnglab convert` per file sequentially. Check for `dnglab` binary existence before starting. Create `originals/` subfolder only if keepOriginals is true and there are files to move.

## Feature 2: Edit Favorites in Lightroom

### UI

- **Button**: "Edit Favorites in Lightroom" — replaces the existing "Open Keeps in Editor" button text and wires up the existing `action:open-editor` event
- **Visibility**: Only shown when a `Favorites/` subfolder exists within the current view's directory
- **Location**: Floating action bar, alongside other action buttons

### Behavior

1. User clicks "Edit Favorites in Lightroom"
2. Server endpoint determines the Favorites folder path for the current source
3. Server runs: `open -a "Adobe Lightroom CC" <favorites-folder-path>`
4. Lightroom CC opens and presents the folder contents

### Server API

**`POST /api/open-in-editor`**

Request body:
```json
{
  "source": "/path/to/keeps/Favorites"
}
```

Runs `open -a "Adobe Lightroom CC" <source>` via `child_process.execFile`. Returns success/error.

### Error Handling

- **Lightroom not installed**: Return error with message. UI shows toast.
- **Folder doesn't exist**: Return 404.

## Files to Modify

### Server
- `server/routes/sorting.js` — Add `POST /api/convert` and `POST /api/open-in-editor` endpoints (or create a new `server/routes/convert.js` if sorting.js is getting long)

### Client
- `client/src/actions.js` — Add "Convert to DNG" button, conversion modal with keep/remove choice, progress UI. Rename "Open Keeps in Editor" to "Edit Favorites in Lightroom" and wire up the handler. Adjust button visibility logic.

### Dependencies
- **External**: `dnglab` CLI (user-installed, not an npm dependency)
- **No new npm dependencies** — uses Node's `child_process` to shell out to dnglab and `open`

## Out of Scope

- Per-image conversion (selecting individual files to convert) — this is a batch-all operation
- Converting to formats other than DNG
- Configuring which editor to open (hardcoded to Lightroom CC for now)
- Converting on import/sort (conversion is a separate explicit step)
