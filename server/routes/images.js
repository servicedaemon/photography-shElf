import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { getThumbnail, getPreview } from '../lib/thumbnails.js';
import { getConfig, getState } from '../lib/state.js';
import { detectStage } from '../lib/stages.js';

export const imageRoutes = Router();

const VALID_FILENAME = /^[\w][\w. -]*\.(cr3|cr2|arw|nef|raf|dng|jpg|jpeg|tif|tiff)$/i;

function validateFilename(f) {
  return VALID_FILENAME.test(f) && !f.includes('..');
}

function resolveSource(query) {
  const source = query?.source;
  if (!source) return null;
  const resolved = path.resolve(source);
  // Basic safety: no going above common mount points
  if (resolved.includes('..')) return null;
  return resolved;
}

// List images from a source directory
imageRoutes.get('/images', (req, res) => {
  const source = resolveSource(req.query);
  if (!source || !fs.existsSync(source)) {
    return res.json({ images: [], stage: 'CULL' });
  }
  try {
    const files = fs
      .readdirSync(source)
      .filter((f) => VALID_FILENAME.test(f))
      .sort();
    const state = getState(source);
    const images = files.map((f) => ({ filename: f, status: state[f] || 'unmarked' }));
    res.json({ images, stage: detectStage(source) });
  } catch {
    res.json({ images: [], stage: 'CULL' });
  }
});

// Serve thumbnail
imageRoutes.get('/thumb/:filename', async (req, res) => {
  const { filename } = req.params;
  const source = resolveSource(req.query);
  if (!validateFilename(filename) || !source) {
    return res.status(400).send('Bad request');
  }
  const sourcePath = path.join(source, filename);
  if (!sourcePath.startsWith(source)) return res.status(400).send('Bad path');

  try {
    const thumbPath = await getThumbnail(sourcePath);
    res.sendFile(thumbPath);
  } catch (e) {
    res.status(500).send('Thumbnail generation failed: ' + e.message);
  }
});

// Serve preview (larger)
imageRoutes.get('/preview/:filename', async (req, res) => {
  const { filename } = req.params;
  const source = resolveSource(req.query);
  if (!validateFilename(filename) || !source) {
    return res.status(400).send('Bad request');
  }
  const sourcePath = path.join(source, filename);
  if (!sourcePath.startsWith(source)) return res.status(400).send('Bad path');

  try {
    const previewPath = await getPreview(sourcePath);
    res.sendFile(previewPath);
  } catch (e) {
    res.status(500).send('Preview generation failed: ' + e.message);
  }
});

// Folder-specific thumbnail and preview endpoints
imageRoutes.get('/folder/:folder/images', (req, res) => {
  const config = getConfig();
  const sortDir = config.sortDir;
  if (!sortDir) return res.json([]);

  const folderPath = path.join(sortDir, req.params.folder);
  if (!folderPath.startsWith(sortDir) || !fs.existsSync(folderPath)) {
    return res.status(404).send('Not found');
  }

  try {
    const files = fs
      .readdirSync(folderPath)
      .filter((f) => VALID_FILENAME.test(f))
      .sort();

    // Load favorites state if exists
    const stateFile = path.join(folderPath, '.favorites-state.json');
    let favState = {};
    if (fs.existsSync(stateFile)) {
      try {
        favState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      } catch {
        /* ignore corrupt state */
      }
    }

    res.json(files.map((f) => ({ filename: f, status: favState[f] || 'unmarked' })));
  } catch {
    res.json([]);
  }
});

imageRoutes.get('/folder/:folder/thumb/:filename', async (req, res) => {
  const { folder, filename } = req.params;
  if (!validateFilename(filename)) return res.status(400).send('Bad filename');

  const config = getConfig();
  const sortDir = config.sortDir;
  if (!sortDir) return res.status(400).send('No sort directory configured');

  const folderPath = path.join(sortDir, folder);
  if (!folderPath.startsWith(sortDir) || !fs.existsSync(folderPath)) {
    return res.status(404).send('Not found');
  }

  const sourcePath = path.join(folderPath, filename);
  if (!sourcePath.startsWith(folderPath)) return res.status(400).send('Bad path');

  try {
    const thumbPath = await getThumbnail(sourcePath);
    res.sendFile(thumbPath);
  } catch (e) {
    res.status(500).send('Thumbnail generation failed: ' + e.message);
  }
});

imageRoutes.get('/folder/:folder/preview/:filename', async (req, res) => {
  const { folder, filename } = req.params;
  if (!validateFilename(filename)) return res.status(400).send('Bad filename');

  const config = getConfig();
  const sortDir = config.sortDir;
  if (!sortDir) return res.status(400).send('No sort directory configured');

  const folderPath = path.join(sortDir, folder);
  if (!folderPath.startsWith(sortDir) || !fs.existsSync(folderPath)) {
    return res.status(404).send('Not found');
  }

  const sourcePath = path.join(folderPath, filename);
  if (!sourcePath.startsWith(folderPath)) return res.status(400).send('Bad path');

  try {
    const previewPath = await getPreview(sourcePath);
    res.sendFile(previewPath);
  } catch (e) {
    res.status(500).send('Preview generation failed: ' + e.message);
  }
});
