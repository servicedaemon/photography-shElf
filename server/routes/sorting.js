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
