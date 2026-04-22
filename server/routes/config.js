import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { getConfig, setConfig } from '../lib/state.js';
import { detectCameraDrives } from '../lib/drives.js';
import { pickFolder, openFolderInLightroom } from '../lib/platform.js';

export const configRoutes = Router();

// Get current config
configRoutes.get('/config', (_req, res) => {
  res.json(getConfig());
});

// Update config
configRoutes.put('/config', (req, res) => {
  const current = getConfig();
  const updates = req.body;

  // Only allow known config keys
  const allowed = [
    'sortDir',
    'thumbSize',
    'defaultSource',
    'recentShoots',
    'hintStripVisible',
    'windowBounds',
  ];
  for (const key of Object.keys(updates)) {
    if (allowed.includes(key)) {
      current[key] = updates[key];
    }
  }

  setConfig(current);
  res.json(current);
});

// Push a path onto the recent shoots list (dedup, cap at 10)
configRoutes.post('/recent-shoots/push', (req, res) => {
  const { path: p } = req.body;
  if (!p || typeof p !== 'string') {
    return res.status(400).json({ error: 'path required' });
  }
  const current = getConfig();
  const list = Array.isArray(current.recentShoots) ? current.recentShoots : [];
  const deduped = [p, ...list.filter((x) => x !== p)].slice(0, 10);
  current.recentShoots = deduped;
  setConfig(current);
  res.json({ recentShoots: deduped });
});

// Detect connected camera drives
configRoutes.get('/drives', async (_req, res) => {
  try {
    const drives = await detectCameraDrives();
    res.json(drives);
  } catch (e) {
    res.status(500).json({ error: 'Drive detection failed: ' + e.message });
  }
});

// Native OS folder picker
configRoutes.post('/pick-folder', async (_req, res) => {
  try {
    const folderPath = await pickFolder();
    if (folderPath) {
      res.json({ path: folderPath });
    } else {
      res.json({ path: null, cancelled: true });
    }
  } catch (e) {
    res.status(500).json({ error: 'Folder picker failed: ' + e.message });
  }
});

// Scan a directory for shoots and image folders.
// Recognizes two layouts:
//   1. "YYYY-MM - Name/" with keeps/rejects/unsorted/edited subfolders inside
//   2. "Keeps - MM-YYYY - Name" / "Rejects - ..." siblings (sort output)
configRoutes.get('/list-dir', (req, res) => {
  const dir = req.query.path;
  if (!dir) return res.status(400).json({ error: 'path required' });

  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(404).json({ error: 'Directory not found' });
  }

  const IMAGE_RE = /\.(cr3|cr2|arw|nef|raf|dng|jpg|jpeg|tif|tiff)$/i;
  const SORT_FOLDER_RE = /^(Keeps|Favorites|Rejects|Unsorted)\s*-\s*(\d{2}-\d{4})\s*-\s*(.+)$/i;
  const SORT_SUBFOLDER_NAMES = ['keeps', 'rejects', 'unsorted', 'edited', 'favorites'];

  function countImages(dirPath) {
    try {
      return fs.readdirSync(dirPath).filter((f) => IMAGE_RE.test(f)).length;
    } catch {
      return 0;
    }
  }

  let rootImageCount = 0;
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const shoots = [];
  const sortGrouped = new Map();
  const otherFolders = [];

  for (const entry of entries) {
    if (entry.isFile() && IMAGE_RE.test(entry.name)) {
      rootImageCount++;
    }
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const subPath = path.join(resolved, entry.name);

    // Check for "Keeps/Rejects/Unsorted - MM-YYYY - Name" pattern
    const sortMatch = entry.name.match(SORT_FOLDER_RE);
    if (sortMatch) {
      const [, type, date, name] = sortMatch;
      const key = `${date} - ${name}`;
      if (!sortGrouped.has(key)) {
        sortGrouped.set(key, { date, name, folders: {} });
      }
      sortGrouped.get(key).folders[type.toLowerCase()] = {
        path: subPath,
        count: countImages(subPath),
      };
      continue;
    }

    // Check if this folder contains keeps/rejects/unsorted subfolders (shoot directory)
    let subEntries;
    try {
      subEntries = fs.readdirSync(subPath, { withFileTypes: true });
    } catch {
      continue;
    }

    const subDirs = subEntries.filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase());

    const hasSortSubs = SORT_SUBFOLDER_NAMES.some((s) => subDirs.includes(s));

    if (hasSortSubs) {
      // It's a shoot folder like "2026-03 - Kat x Tsuki"
      const folders = {};
      for (const sub of subEntries) {
        if (!sub.isDirectory()) continue;
        const lc = sub.name.toLowerCase();
        if (SORT_SUBFOLDER_NAMES.includes(lc)) {
          const folderPath = path.join(subPath, sub.name);
          folders[lc] = { path: folderPath, count: countImages(folderPath) };
        }
      }
      // Also count loose images at root of shoot folder
      const rootCount = countImages(subPath);
      shoots.push({ name: entry.name, path: subPath, folders, rootCount });
    } else {
      // Plain folder — check if it has images
      const count = countImages(subPath);
      if (count > 0) {
        otherFolders.push({ name: entry.name, path: subPath, imageCount: count });
      }
    }
  }

  // Convert sort-grouped folders into shoots too
  for (const [, group] of sortGrouped) {
    shoots.push({
      name: group.name,
      date: group.date,
      path: null,
      folders: group.folders,
      rootCount: 0,
    });
  }

  // Sort shoots by name descending (newest dated names first)
  shoots.sort((a, b) => b.name.localeCompare(a.name));

  res.json({ path: resolved, rootImageCount, shoots, otherFolders });
});

// Open favorites folder in Lightroom
configRoutes.post('/open-in-lightroom', async (req, res) => {
  const { source } = req.body;
  if (!source) {
    return res.status(400).json({ error: 'source is required' });
  }

  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(404).json({ error: 'Folder not found' });
  }

  try {
    const opened = await openFolderInLightroom(resolved);
    res.json({ ok: true, opened });
  } catch (e) {
    res.status(500).json({ error: 'Failed to open Lightroom: ' + e.message });
  }
});
