import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { getState, setState, pushUndo, popUndo, getConfig } from '../lib/state.js';

export const sortingRoutes = Router();

const VALID_FILENAME = /^[\w][\w. -]*\.(cr3|cr2|arw|nef|raf|dng|jpg|jpeg|tif|tiff)$/i;

function validateFilename(f) {
  return VALID_FILENAME.test(f) && !f.includes('..');
}

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

// Sort to folders — move files off camera card
sortingRoutes.post('/sort', async (req, res) => {
  const { name, source } = req.body;
  if (!name || !source) {
    return res.status(400).json({ error: 'Name and source required' });
  }

  // Sanitize folder name
  const safeName = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  if (!safeName) return res.status(400).json({ error: 'Invalid name' });

  const config = getConfig();
  const sortDir = config.sortDir || path.join(process.env.HOME, 'Pictures/sorted');

  const now = new Date();
  const dateStr = String(now.getMonth() + 1).padStart(2, '0') + '-' + now.getFullYear();
  const keepDir = path.join(sortDir, `Keeps - ${dateStr} - ${safeName}`);
  const favDir = path.join(sortDir, `Favorites - ${dateStr} - ${safeName}`);
  const rejectDir = path.join(sortDir, `Rejects - ${dateStr} - ${safeName}`);
  const unsortedDir = path.join(sortDir, `Unsorted - ${dateStr} - ${safeName}`);

  fs.mkdirSync(keepDir, { recursive: true });
  fs.mkdirSync(favDir, { recursive: true });
  fs.mkdirSync(rejectDir, { recursive: true });
  fs.mkdirSync(unsortedDir, { recursive: true });

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
    if (status === 'favorite') destDir = favDir;
    else if (status === 'keep') destDir = keepDir;
    else if (status === 'reject') destDir = rejectDir;
    else destDir = unsortedDir;

    const dest = path.join(destDir, filename);
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
  res.json({ moved, errors: errors.length > 0 ? errors : undefined });
});

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

// List keep folders for review mode
sortingRoutes.get('/keep-folders', (req, res) => {
  const config = getConfig();
  const sortDir = config.sortDir || path.join(process.env.HOME, 'Pictures/sorted');

  if (!fs.existsSync(sortDir)) return res.json([]);

  try {
    const folders = fs
      .readdirSync(sortDir)
      .filter(
        (f) => f.startsWith('Keeps -') && fs.statSync(path.join(sortDir, f)).isDirectory(),
      )
      .sort()
      .reverse();
    res.json(folders);
  } catch {
    res.json([]);
  }
});

// Mark favorite in a review folder
sortingRoutes.post('/folder/:folder/mark', (req, res) => {
  const config = getConfig();
  const sortDir = config.sortDir || path.join(process.env.HOME, 'Pictures/sorted');
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

// Save favorites to subfolder
sortingRoutes.post('/folder/:folder/save-favorites', (req, res) => {
  const config = getConfig();
  const sortDir = config.sortDir || path.join(process.env.HOME, 'Pictures/sorted');
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
    const safeName = String(dest.newShootName).replace(/[^a-zA-Z0-9 _-]/g, '').trim();
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

  // If source is itself a sub-folder like keeps/, parent is the shoot root
  if (!SUBS.includes(base)) {
    return res.json({ insideShoot: false });
  }

  const shootRoot = path.dirname(sourcePath);
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

  if (Object.keys(siblings).length < 2) {
    return res.json({ insideShoot: false });
  }

  res.json({
    insideShoot: true,
    shootRoot,
    shootName: path.basename(shootRoot),
    currentSub: base,
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
  if (!SUBS.includes(base)) {
    return res.status(400).json({ error: 'Source is not a shoot sub-folder' });
  }

  const shootRoot = path.dirname(sourcePath);

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
    files = fs.readdirSync(sourcePath)
      .filter(f => VALID_FILENAME.test(f))
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
    const targetKey = status === 'keep' ? 'keep'
                    : status === 'favorite' ? 'favorite'
                    : status === 'reject' ? 'reject'
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
sortingRoutes.get('/list-folder-files', (req, res) => {
  const folder = req.query.path;
  if (!folder) return res.status(400).json({ error: 'path required' });
  const resolved = path.resolve(folder);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const files = fs.readdirSync(resolved)
      .filter((f) => VALID_FILENAME.test(f))
      .map((f) => path.join(resolved, f));
    res.json({ files });
  } catch {
    res.json({ files: [] });
  }
});
