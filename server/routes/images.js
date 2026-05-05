import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { getThumbnail, getPreview } from '../lib/thumbnails.js';
import { getConfig, getState } from '../lib/state.js';
import { detectStage } from '../lib/stages.js';
import { readTimestamps } from '../lib/exif-cache.js';
import { groupImages } from '../lib/grouping.js';
import { VALID_FILENAME, validateFilename } from '../lib/validate.js';

export const imageRoutes = Router();

const STACK_GAP_MS = 5000; // photos within 5s of each other cluster into a stack

function resolveSource(query) {
  const source = query?.source;
  if (!source) return null;
  const resolved = path.resolve(source);
  // Basic safety: no going above common mount points
  if (resolved.includes('..')) return null;
  return resolved;
}

// List images from a source directory
imageRoutes.get('/images', async (req, res) => {
  const source = resolveSource(req.query);
  if (!source || !fs.existsSync(source)) {
    return res.json({ images: [], stage: 'CULL', stacks: [] });
  }
  try {
    const files = fs
      .readdirSync(source)
      .filter((f) => VALID_FILENAME.test(f))
      .sort();
    const state = getState(source);

    // Read each file's natural dimensions via the cached thumbnail (sharp
    // metadata read on a cached JPEG is near-free; cold cache pays one
    // resize per file but that work was about to happen anyway when the
    // grid loaded thumbnails). Dimensions feed the v1.5+ jagged-grid
    // layout — each card spans rows in proportion to its aspect ratio.
    // Falls back to 3:2 on any failure so legacy images still render.
    const dimensions = await Promise.all(
      files.map(async (f) => {
        try {
          const thumbPath = await getThumbnail(path.join(source, f));
          const meta = await sharp(thumbPath).metadata();
          return { width: meta.width || 3, height: meta.height || 2 };
        } catch {
          return { width: 3, height: 2 };
        }
      }),
    );

    const images = files.map((f, i) => ({
      filename: f,
      status: state[f] || 'unmarked',
      width: dimensions[i].width,
      height: dimensions[i].height,
    }));

    // Compute stacks (time-clustered groups) from EXIF timestamps. Graceful
    // if EXIF read fails — the grid just shows no stack badges rather than erroring.
    let stacks = [];
    try {
      const timestamps = await readTimestamps(source, files);
      const withTs = files
        .filter((f) => timestamps[f] != null)
        .map((f) => ({ filename: f, timestamp: timestamps[f] }));
      stacks = groupImages(withTs, STACK_GAP_MS);
    } catch {
      // EXIF read failed — ship the image list without stacks
    }

    res.json({ images, stage: detectStage(source), stacks });
  } catch {
    res.json({ images: [], stage: 'CULL', stacks: [] });
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
imageRoutes.get('/folder/:folder/images', async (req, res) => {
  const config = getConfig();
  const sortDir = config.libraryRoot;
  if (!sortDir) return res.json({ images: [], stacks: [] });

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

    // Same dimension prefetch as /api/images so the legacy flat-folder
    // route also feeds the jagged-grid layout. Cached on disk after first
    // request — subsequent reads are essentially free.
    const dimensions = await Promise.all(
      files.map(async (f) => {
        try {
          const thumbPath = await getThumbnail(path.join(folderPath, f));
          const meta = await sharp(thumbPath).metadata();
          return { width: meta.width || 3, height: meta.height || 2 };
        } catch {
          return { width: 3, height: 2 };
        }
      }),
    );

    const images = files.map((f, i) => ({
      filename: f,
      status: favState[f] || 'unmarked',
      width: dimensions[i].width,
      height: dimensions[i].height,
    }));

    let stacks = [];
    try {
      const timestamps = await readTimestamps(folderPath, files);
      const withTs = files
        .filter((f) => timestamps[f] != null)
        .map((f) => ({ filename: f, timestamp: timestamps[f] }));
      stacks = groupImages(withTs, STACK_GAP_MS);
    } catch {
      // graceful fallback
    }

    res.json({ images, stacks });
  } catch {
    res.json({ images: [], stacks: [] });
  }
});

imageRoutes.get('/folder/:folder/thumb/:filename', async (req, res) => {
  const { folder, filename } = req.params;
  if (!validateFilename(filename)) return res.status(400).send('Bad filename');

  const config = getConfig();
  const sortDir = config.libraryRoot;
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
  const sortDir = config.libraryRoot;
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
