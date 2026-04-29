import { Router } from 'express';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getState, setState, pushUndo, popUndo, getConfig } from '../lib/state.js';
import { validateFilename, VALID_FILENAME } from '../lib/validate.js';

export const sortingRoutes = Router();

// Mark a single image
sortingRoutes.post('/mark', (req, res) => {
  const { filename, status, source } = req.body;
  if (!filename || !validateFilename(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const state = getState(source);
  const previousStatus = state[filename] || 'unmarked';

  pushUndo({
    action: 'mark',
    filenames: [filename],
    previousStatuses: { [filename]: previousStatus },
    newStatus: status,
    source,
  });

  if (status === 'unmarked') {
    delete state[filename];
  } else {
    state[filename] = status;
  }
  setState(source, state);
  res.json({ ok: true });
});

// Batch mark (for shift-ranges)
sortingRoutes.post('/mark-batch', (req, res) => {
  const { filenames, status, source } = req.body;
  if (!Array.isArray(filenames) || !filenames.every(validateFilename)) {
    return res.status(400).json({ error: 'Invalid filenames' });
  }

  const state = getState(source);
  const previousStatuses = {};
  for (const f of filenames) {
    previousStatuses[f] = state[f] || 'unmarked';
  }

  pushUndo({
    action: 'mark-batch',
    filenames,
    previousStatuses,
    newStatus: status,
    source,
  });

  for (const f of filenames) {
    if (status === 'unmarked') {
      delete state[f];
    } else {
      state[f] = status;
    }
  }
  setState(source, state);
  res.json({ ok: true });
});

// Sort to folders — move files off camera card.
//
// Layout (v1.3+): nested per-shoot under the configured library root.
//   <libraryRoot>/<shootName>/{unsorted,keeps,favorites,rejects}/
//
// If a shoot folder with the same name already exists, files merge into
// the existing piles. Filename collisions get a `-2`, `-3`, … suffix
// before the extension so nothing overwrites silently.
sortingRoutes.post('/sort', async (req, res) => {
  const { name, source } = req.body;
  if (!name || !source) {
    return res.status(400).json({ error: 'Name and source required' });
  }

  // Sanitize folder name: allow alphanumerics, space, underscore, dash.
  // Collapse runs of whitespace/dashes that creep in from copy-paste.
  const safeName = name
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/-{2,}/g, '-')
    .trim();
  if (!safeName) return res.status(400).json({ error: 'Invalid name' });

  const config = getConfig();
  const libraryRoot =
    config.libraryRoot || path.join(os.homedir(), 'Pictures', 'Shelf');

  const shootDir = path.join(libraryRoot, safeName);
  const unsortedDir = path.join(shootDir, 'unsorted');
  const keepsDir = path.join(shootDir, 'keeps');
  const favoritesDir = path.join(shootDir, 'favorites');
  const rejectsDir = path.join(shootDir, 'rejects');

  try {
    fs.mkdirSync(unsortedDir, { recursive: true });
    fs.mkdirSync(keepsDir, { recursive: true });
    fs.mkdirSync(favoritesDir, { recursive: true });
    fs.mkdirSync(rejectsDir, { recursive: true });
  } catch (e) {
    return res
      .status(500)
      .json({ error: `Cannot create shoot folders under ${libraryRoot}: ${e.message}` });
  }

  const state = getState(source);
  const sourcePath = path.resolve(source);

  let files;
  try {
    files = fs
      .readdirSync(sourcePath)
      .filter((f) => VALID_FILENAME.test(f))
      .sort();
  } catch {
    return res.status(400).json({ error: 'Cannot read source directory' });
  }

  const moved = { keep: 0, favorite: 0, reject: 0, unsorted: 0 };
  const errors = [];

  for (const filename of files) {
    const src = path.join(sourcePath, filename);
    if (!fs.existsSync(src)) continue;

    const status = state[filename] || 'unmarked';
    let destDir;
    if (status === 'favorite') destDir = favoritesDir;
    else if (status === 'keep') destDir = keepsDir;
    else if (status === 'reject') destDir = rejectsDir;
    else destDir = unsortedDir;

    const dest = uniqueDest(destDir, filename);
    try {
      // Copy-then-delete for cross-volume safety
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
      moved[status === 'unmarked' ? 'unsorted' : status]++;
    } catch (e) {
      errors.push({ filename, error: e.message });
    }
  }

  // Clear state for this source
  setState(source, {});
  res.json({
    moved,
    shootDir,
    unsortedDir,
    keepsDir,
    favoritesDir,
    rejectsDir,
    errors: errors.length > 0 ? errors : undefined,
  });
});

// Pure helper: pick a destination path that doesn't already exist by
// appending `-2`, `-3`, … before the extension. Exposed for tests.
export function uniqueDest(dir, filename) {
  const candidate = path.join(dir, filename);
  if (!fs.existsSync(candidate)) return candidate;

  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  for (let n = 2; n < 10000; n++) {
    const next = path.join(dir, `${stem}-${n}${ext}`);
    if (!fs.existsSync(next)) return next;
  }
  // Fall through if 10000 collisions exist — astonishing, just overwrite.
  return candidate;
}

// Undo last action
sortingRoutes.post('/undo', (req, res) => {
  const entry = popUndo();
  if (!entry) {
    return res.json({ ok: false, message: 'Nothing to undo' });
  }

  const state = getState(entry.source);
  for (const [filename, prevStatus] of Object.entries(entry.previousStatuses)) {
    if (prevStatus === 'unmarked') {
      delete state[filename];
    } else {
      state[filename] = prevStatus;
    }
  }
  setState(entry.source, state);

  res.json({
    ok: true,
    restored: Object.keys(entry.previousStatuses).length,
    action: entry.action,
  });
});

// Mark favorite in a review folder
sortingRoutes.post('/folder/:folder/mark', (req, res) => {
  const config = getConfig();
  const sortDir = config.libraryRoot || path.join(os.homedir(), 'Pictures', 'Shelf');
  const folderPath = path.join(sortDir, req.params.folder);

  if (!folderPath.startsWith(sortDir) || !fs.existsSync(folderPath)) {
    return res.status(404).send('Not found');
  }

  const stateFile = path.join(folderPath, '.favorites-state.json');
  let favState = {};
  if (fs.existsSync(stateFile)) {
    try {
      favState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      /* ignore */
    }
  }

  const { filename, status } = req.body;
  if (!filename || !validateFilename(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  if (status === 'unmarked') {
    delete favState[filename];
  } else {
    favState[filename] = status;
  }

  // Atomic write
  const tmpFile = stateFile + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(favState, null, 2));
  fs.renameSync(tmpFile, stateFile);

  res.json({ ok: true });
});

// Promote favorites: takes a full source path (works for both flat and
// nested layouts). Reads .favorites-state.json from `source`, moves every
// file marked 'favorite' into the appropriate target:
//   - Nested layout: `source` is `<shoot>/keeps/` → target is `<shoot>/favorites/`
//   - Flat layout (or fallback): target is `<source>/Favorites/` (sub-sub)
//
// The source-validation rule is: source must be a real directory. We
// don't restrict it to libraryRoot because legacy flat-layout shoots
// may have been moved out of it.
sortingRoutes.post('/promote-favorites', (req, res) => {
  const { source } = req.body || {};
  if (!source) return res.status(400).json({ error: 'source required' });

  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    return res.status(404).json({ error: 'source is not a directory' });
  }

  const cfg = getConfig();
  const libraryRoot = path.resolve(
    cfg.libraryRoot || path.join(os.homedir(), 'Pictures', 'Shelf'),
  );
  if (!sourcePath.startsWith(libraryRoot)) {
    return res
      .status(403)
      .json({ error: 'source must be inside the configured library root' });
  }

  // Layout detection: nested only when `source` is `<shoot>/keeps/` AND
  // the parent looks like a real shoot folder (has at least one of the
  // peer status subfolders we'd expect). Avoids false-positive nesting
  // when someone happens to drop photos into a folder named "keeps".
  const parent = path.dirname(sourcePath);
  const leaf = path.basename(sourcePath).toLowerCase();
  const looksNested =
    leaf === 'keeps' &&
    fs.existsSync(parent) &&
    (fs.existsSync(path.join(parent, 'favorites')) ||
      fs.existsSync(path.join(parent, 'rejects')) ||
      fs.existsSync(path.join(parent, 'unsorted')));

  let favDir;
  if (looksNested) {
    // Peer favorites folder under the shoot
    favDir = path.join(parent, 'favorites');
  } else {
    // Flat (legacy): Favorites/ subfolder inside the source
    favDir = path.join(sourcePath, 'Favorites');
  }
  fs.mkdirSync(favDir, { recursive: true });

  const stateFile = path.join(sourcePath, '.favorites-state.json');
  let favState = {};
  if (fs.existsSync(stateFile)) {
    try {
      favState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      /* corrupt — treat as empty */
    }
  }

  let moved = 0;
  const errors = [];

  for (const [filename, status] of Object.entries(favState)) {
    if (status !== 'favorite') continue;
    if (!validateFilename(filename)) continue;
    const src = path.join(sourcePath, filename);
    const dest = uniqueDest(favDir, filename);
    try {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
        moved++;
      }
    } catch (e) {
      errors.push({ filename, error: e.message });
    }
  }

  // Clear favorites state
  try {
    const tmpFile = stateFile + '.tmp';
    fs.writeFileSync(tmpFile, '{}');
    fs.renameSync(tmpFile, stateFile);
  } catch {
    /* state file might not exist if no favorites were marked — fine */
  }

  res.json({ moved, favDir, errors: errors.length > 0 ? errors : undefined });
});

// In-folder favorite-status mark: works for any source path (nested or flat).
// Body: { source, filename, status }. State persists in .favorites-state.json
// next to the photos. Source must be inside the configured libraryRoot
// to keep path-traversal contained — the legacy `/folder/:folder/mark`
// route enforces the same containment via `startsWith(sortDir)`.
sortingRoutes.post('/folder-mark', (req, res) => {
  const { source, filename, status } = req.body || {};
  if (!source) return res.status(400).json({ error: 'source required' });

  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    return res.status(404).json({ error: 'source is not a directory' });
  }

  const cfg = getConfig();
  const libraryRoot = path.resolve(
    cfg.libraryRoot || path.join(os.homedir(), 'Pictures', 'Shelf'),
  );
  if (!sourcePath.startsWith(libraryRoot)) {
    return res
      .status(403)
      .json({ error: 'source must be inside the configured library root' });
  }

  if (!filename || !validateFilename(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const stateFile = path.join(sourcePath, '.favorites-state.json');
  let favState = {};
  if (fs.existsSync(stateFile)) {
    try {
      favState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      /* corrupt — start fresh */
    }
  }

  if (status === 'unmarked') {
    delete favState[filename];
  } else {
    favState[filename] = status;
  }

  const tmpFile = stateFile + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(favState, null, 2));
  fs.renameSync(tmpFile, stateFile);

  res.json({ ok: true });
});

// Save favorites to subfolder
sortingRoutes.post('/folder/:folder/save-favorites', (req, res) => {
  const config = getConfig();
  const sortDir = config.libraryRoot || path.join(os.homedir(), 'Pictures', 'Shelf');
  const folderPath = path.join(sortDir, req.params.folder);

  if (!folderPath.startsWith(sortDir) || !fs.existsSync(folderPath)) {
    return res.status(404).send('Not found');
  }

  const stateFile = path.join(folderPath, '.favorites-state.json');
  let favState = {};
  if (fs.existsSync(stateFile)) {
    try {
      favState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      /* ignore */
    }
  }

  const favDir = path.join(folderPath, 'Favorites');
  fs.mkdirSync(favDir, { recursive: true });

  let moved = 0;
  const errors = [];

  for (const [filename, status] of Object.entries(favState)) {
    if (status !== 'favorite') continue;
    const src = path.join(folderPath, filename);
    const dest = path.join(favDir, filename);
    try {
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
        moved++;
      }
    } catch (e) {
      errors.push({ filename, error: e.message });
    }
  }

  // Clear favorites state
  const tmpFile = stateFile + '.tmp';
  fs.writeFileSync(tmpFile, '{}');
  fs.renameSync(tmpFile, stateFile);

  res.json({ moved, errors: errors.length > 0 ? errors : undefined });
});

// GET /api/sibling-shoots?source=/path/to/current/folder
// Returns sibling folders that look like shoots (have an unsorted/ subfolder or match shoot pattern),
// plus the parent dir itself as context. Used by the Move-to-Shoot modal.
sortingRoutes.get('/sibling-shoots', (req, res) => {
  const source = req.query.source;
  if (!source) return res.status(400).json({ error: 'source required' });

  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Not found' });

  // Walk up to the parent. If current source is ".../YYYY-MM - Shoot/keeps", climb to the
  // photography root (grandparent) so we list peer shoots. Also track the current shoot root
  // so it is excluded from siblings.
  let parent = path.dirname(sourcePath);
  let shootRoot = sourcePath;
  const base = path.basename(sourcePath);
  if (['keeps', 'unsorted', 'favorites', 'rejects', 'edited'].includes(base.toLowerCase())) {
    shootRoot = parent;
    parent = path.dirname(parent);
  }

  let entries;
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return res.status(500).json({ error: 'Cannot read parent directory' });
  }

  const siblings = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const p = path.join(parent, entry.name);
    if (p === sourcePath || p === shootRoot) continue; // skip self + current shoot root
    siblings.push({ name: entry.name, path: p });
  }

  res.json({ parent, shootRoot, siblings });
});

// POST /api/move-to-shoot
// Body: { source: "/path/to/source", filenames: [...], dest: { existingPath?: string, newShootName?: string } }
// Moves the selected filenames from source into <dest>/unsorted/, creating folders as needed.
// When newShootName is provided, creates <parent>/<newShootName>/unsorted/ (parent is the source's grandparent if source is a sub-folder, else the source's parent).
sortingRoutes.post('/move-to-shoot', async (req, res) => {
  const { source, filenames, dest } = req.body || {};
  if (!source || !Array.isArray(filenames) || filenames.length === 0 || !dest) {
    return res.status(400).json({ error: 'source, filenames, and dest required' });
  }
  if (!filenames.every(validateFilename)) {
    return res.status(400).json({ error: 'Invalid filename in list' });
  }

  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    return res.status(404).json({ error: 'Source not found' });
  }

  // Resolve the destination folder
  let destFolder;
  if (dest.existingPath) {
    destFolder = path.resolve(dest.existingPath);
    if (!fs.existsSync(destFolder) || !fs.statSync(destFolder).isDirectory()) {
      return res.status(404).json({ error: 'Destination folder not found' });
    }
  } else if (dest.newShootName) {
    const safeName = String(dest.newShootName)
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .trim();
    if (!safeName) return res.status(400).json({ error: 'Invalid new shoot name' });

    // Parent for new shoot: if source is inside a sub-folder (keeps/unsorted/etc), use the grandparent
    let parent = path.dirname(sourcePath);
    const base = path.basename(sourcePath);
    if (['keeps', 'unsorted', 'favorites', 'rejects', 'edited'].includes(base.toLowerCase())) {
      parent = path.dirname(parent);
    }
    destFolder = path.join(parent, safeName);
    fs.mkdirSync(destFolder, { recursive: true });
  } else {
    return res.status(400).json({ error: 'dest must have existingPath or newShootName' });
  }

  // Final target is <destFolder>/unsorted/
  const unsortedDir = path.join(destFolder, 'unsorted');
  fs.mkdirSync(unsortedDir, { recursive: true });

  // Move files
  const state = getState(sourcePath);
  let moved = 0;
  const errors = [];
  for (const filename of filenames) {
    const src = path.join(sourcePath, filename);
    const tgt = path.join(unsortedDir, filename);
    try {
      if (!fs.existsSync(src)) {
        errors.push({ filename, error: 'source file missing' });
        continue;
      }
      if (fs.existsSync(tgt)) {
        errors.push({ filename, error: 'destination already has a file with this name' });
        continue;
      }
      fs.copyFileSync(src, tgt);
      fs.unlinkSync(src);
      // Clear any marking state for this file in the source
      if (state[filename] !== undefined) {
        delete state[filename];
      }
      moved++;
    } catch (e) {
      errors.push({ filename, error: e.message });
    }
  }
  setState(sourcePath, state);

  res.json({ moved, destFolder, unsortedDir, errors: errors.length > 0 ? errors : [] });
});

// GET /api/shoot-context?source=/path
// Detects whether the source is inside an existing shoot (its parent folder
// has standard sibling sub-folders like keeps/, rejects/, unsorted/, Favorites/).
// If yes, returns the parent shoot's path + existing sibling folders —
// used by the client to offer "sort in place" instead of creating a new bundle.
sortingRoutes.get('/shoot-context', (req, res) => {
  const source = req.query.source;
  if (!source) return res.status(400).json({ error: 'source required' });
  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Not found' });

  const base = path.basename(sourcePath).toLowerCase();
  const SUBS = ['keeps', 'rejects', 'unsorted', 'favorites', 'edited'];

  // Figure out the shoot root: either sourcePath itself (if sourcePath IS a
  // shoot root containing SUBS folders), or its parent (if sourcePath is a
  // known sub-folder of a shoot).
  let shootRoot;
  let currentSub = base;
  if (SUBS.includes(base)) {
    shootRoot = path.dirname(sourcePath);
  } else {
    // Check if sourcePath itself is a shoot (has any SUB folders as children)
    try {
      const children = fs.readdirSync(sourcePath, { withFileTypes: true });
      const hasShootSubs = children.some(
        (c) => c.isDirectory() && SUBS.includes(c.name.toLowerCase()),
      );
      if (hasShootSubs) {
        shootRoot = sourcePath;
        currentSub = null; // at the shoot root itself, not in a specific sub
      } else {
        return res.json({ insideShoot: false });
      }
    } catch {
      return res.json({ insideShoot: false });
    }
  }
  // Confirm parent has at least one other sort-sibling
  let entries;
  try {
    entries = fs.readdirSync(shootRoot, { withFileTypes: true });
  } catch {
    return res.json({ insideShoot: false });
  }

  const siblings = {};
  function countImages(dirPath) {
    try {
      return fs.readdirSync(dirPath).filter((f) => VALID_FILENAME.test(f)).length;
    } catch {
      return 0;
    }
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const lc = e.name.toLowerCase();
    if (SUBS.includes(lc)) {
      const p = path.join(shootRoot, e.name);
      siblings[lc] = { path: p, count: countImages(p) };
    }
  }

  // Any recognized sub-folder means this is a shoot.
  if (Object.keys(siblings).length === 0) {
    return res.json({ insideShoot: false });
  }

  res.json({
    insideShoot: true,
    shootRoot,
    shootName: path.basename(shootRoot),
    currentSub,
    siblings, // { keeps: {path, count}, rejects: {path, count}, ... }
  });
});

// POST /api/sort-in-place
// Body: { source }
// Uses the marking state on `source` to move files into the shoot's existing
// keeps/, rejects/, Favorites/, unsorted/ sibling folders. Does NOT create a
// new dated bundle. Existing folder-name casing is preserved; missing folders
// are created with canonical casing (Favorites uppercase, others lowercase).
sortingRoutes.post('/sort-in-place', (req, res) => {
  const { source } = req.body || {};
  if (!source) return res.status(400).json({ error: 'source required' });
  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    return res.status(404).json({ error: 'Source not found' });
  }

  const base = path.basename(sourcePath).toLowerCase();
  const SUBS = ['keeps', 'rejects', 'unsorted', 'favorites', 'edited'];

  // Source may be either a shoot sub-folder, or the shoot root itself.
  let shootRoot;
  if (SUBS.includes(base)) {
    shootRoot = path.dirname(sourcePath);
  } else {
    // Is sourcePath itself a shoot root? (has any SUB child folders)
    try {
      const children = fs.readdirSync(sourcePath, { withFileTypes: true });
      const hasShootSubs = children.some(
        (c) => c.isDirectory() && SUBS.includes(c.name.toLowerCase()),
      );
      if (hasShootSubs) {
        shootRoot = sourcePath;
      } else {
        return res.status(400).json({ error: 'Source is not a shoot sub-folder or shoot root' });
      }
    } catch {
      return res.status(400).json({ error: 'Cannot read source' });
    }
  }

  // Figure out existing sibling folders (preserve casing), compute targets
  function findOrMakeSub(lcName, preferredCase) {
    const entries = fs.readdirSync(shootRoot, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name.toLowerCase() === lcName) {
        return path.join(shootRoot, e.name);
      }
    }
    const p = path.join(shootRoot, preferredCase);
    fs.mkdirSync(p, { recursive: true });
    return p;
  }

  const targets = {
    keep: findOrMakeSub('keeps', 'keeps'),
    favorite: findOrMakeSub('favorites', 'Favorites'),
    reject: findOrMakeSub('rejects', 'rejects'),
    unsorted: findOrMakeSub('unsorted', 'unsorted'),
  };

  const state = getState(sourcePath);
  let files;
  try {
    files = fs
      .readdirSync(sourcePath)
      .filter((f) => VALID_FILENAME.test(f))
      .sort();
  } catch {
    return res.status(500).json({ error: 'Cannot read source' });
  }

  const moved = { keep: 0, favorite: 0, reject: 0, unsorted: 0 };
  const errors = [];

  for (const filename of files) {
    const src = path.join(sourcePath, filename);
    if (!fs.existsSync(src)) continue;

    const status = state[filename] || 'unmarked';

    // If unmarked, skip UNLESS the source itself is not the unsorted folder
    // (e.g., sort-in-place from keeps/ — an unmarked file there stays).
    // If we're currently in the unsorted folder, unmarked files stay too.
    // So: only MOVE files with a non-unmarked status. Unmarked stays put.
    if (status === 'unmarked') continue;

    // If target is the same folder we're in, that's a no-op
    const targetKey =
      status === 'keep'
        ? 'keep'
        : status === 'favorite'
          ? 'favorite'
          : status === 'reject'
            ? 'reject'
            : 'unsorted';
    const targetDir = targets[targetKey];
    if (path.resolve(targetDir) === sourcePath) continue;

    const dest = path.join(targetDir, filename);
    try {
      if (fs.existsSync(dest)) {
        errors.push({ filename, error: 'destination already has a file with this name' });
        continue;
      }
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
      delete state[filename];
      moved[targetKey]++;
    } catch (e) {
      errors.push({ filename, error: e.message });
    }
  }

  setState(sourcePath, state);
  res.json({
    moved,
    shootRoot,
    shootName: path.basename(shootRoot),
    errors: errors.length > 0 ? errors : [],
  });
});

// GET /api/list-folder-files?path=/path
// Returns absolute filesystem paths of all image files in a folder.
// Used by the client to pass paths to Electron's trash IPC for "Empty Rejects".
// Scoped: path must be a known shoot sub-folder (keeps/rejects/unsorted/favorites/edited)
// whose parent also contains at least one other shoot sub-folder. This prevents
// arbitrary-directory enumeration while still working for every real shoot layout.
sortingRoutes.get('/list-folder-files', (req, res) => {
  const folder = req.query.path;
  if (!folder) return res.status(400).json({ error: 'path required' });
  const resolved = path.resolve(folder);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(404).json({ error: 'Not found' });
  }

  const ALLOWED_SUBS = ['keeps', 'rejects', 'unsorted', 'favorites', 'edited'];
  const base = path.basename(resolved).toLowerCase();
  if (!ALLOWED_SUBS.includes(base)) {
    return res.status(403).json({ error: 'Path is not a recognized shoot sub-folder' });
  }
  // Require at least one sibling also matches an allowed sub-folder name.
  const parent = path.dirname(resolved);
  let hasSibling = false;
  try {
    for (const e of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const lc = e.name.toLowerCase();
      if (lc !== base && ALLOWED_SUBS.includes(lc)) {
        hasSibling = true;
        break;
      }
    }
  } catch {
    /* fall through to reject */
  }
  if (!hasSibling) {
    return res.status(403).json({ error: 'Folder has no shoot siblings' });
  }

  try {
    const files = fs
      .readdirSync(resolved)
      .filter((f) => VALID_FILENAME.test(f))
      .map((f) => path.join(resolved, f));
    res.json({ files });
  } catch {
    res.json({ files: [] });
  }
});
