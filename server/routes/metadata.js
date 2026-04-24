import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { exiftool } from 'exiftool-vendored';
import { invalidateCache } from '../lib/thumbnails.js';

export const metadataRoutes = Router();

const VALID_FILENAME = /^[\w][\w. -]*\.(cr3|cr2|arw|nef|raf|dng|jpg|jpeg|tif|tiff)$/i;

function validateFilename(f) {
  return VALID_FILENAME.test(f) && !f.includes('..');
}

// exiftool returns a string for single-value tags, an array for multi-value.
// Normalize to array for predictable client consumption.
function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// exiftool-vendored returns date tags as ExifDateTime objects, not strings.
// Coerce via String() so the client can render them directly — toString()
// produces "YYYY:MM:DD HH:MM:SS±ZZ:ZZ".
export function formatDateTime(v) {
  return v == null ? null : typeof v === 'string' ? v : String(v);
}

// Read EXIF metadata for a single file
metadataRoutes.get('/metadata/:filename', async (req, res) => {
  const { filename } = req.params;
  const source = req.query.source;

  if (!validateFilename(filename) || !source) {
    return res.status(400).send('Bad request');
  }

  const filePath = path.join(path.resolve(source), filename);
  if (!filePath.startsWith(path.resolve(source))) {
    return res.status(400).send('Bad path');
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  try {
    const tags = await exiftool.read(filePath);
    res.json({
      camera: {
        make: tags.Make,
        model: tags.Model,
        lens: tags.LensModel || tags.Lens,
        serial: tags.SerialNumber,
      },
      exposure: {
        shutterSpeed: tags.ShutterSpeed || tags.ExposureTime,
        aperture: tags.Aperture || tags.FNumber,
        iso: tags.ISO,
        focalLength: tags.FocalLength,
        exposureComp: tags.ExposureCompensation,
        meteringMode: tags.MeteringMode,
        whiteBalance: tags.WhiteBalance,
      },
      file: {
        filename: tags.FileName,
        fileSize: tags.FileSize,
        imageWidth: tags.ImageWidth,
        imageHeight: tags.ImageHeight,
        dateTime: formatDateTime(tags.DateTimeOriginal || tags.CreateDate),
        colorSpace: tags.ColorSpace,
      },
      tags: {
        // exiftool returns a string when a tag has a single value, array when
        // multiple. Always coerce to array for consistent client consumption.
        keywords: toArray(tags.Keywords),
        subject: toArray(tags.Subject),
        title: tags.Title,
        description: tags.Description || tags.ImageDescription,
        rating: tags.Rating,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read metadata: ' + e.message });
  }
});

// Sanitize tag values — strip shell metacharacters
function sanitize(v) {
  if (typeof v === 'string') return v.replace(/[;&|`$(){}[\]<>\\]/g, '');
  if (Array.isArray(v)) return v.map(sanitize);
  return v;
}

// Bulk write tags to files.
//
// Accepts legacy API shape: { Keywords: [...] } REPLACE,
// { 'Keywords+': [...] } ADD, { 'Keywords-': [...] } REMOVE.
//
// Under the hood we ALWAYS read current keywords, compute the merged set,
// and write back with plain `Keywords: [...]`. Why: `Keywords+` append
// silently no-ops on CR3 files (exiftool quirk — the append path writes to
// XMP/IPTC which doesn't merge back into the CR3 container). Read-merge-
// write works across all formats uniformly.
async function mergeKeywords(filePath, addKeywords, removeKeywords) {
  const tags = await exiftool.read(filePath);
  // exiftool returns string for single keyword, array for multiple, undefined if none
  let current = tags.Keywords;
  if (current == null) current = [];
  else if (!Array.isArray(current)) current = [current];

  // Remove first (so re-adding a removed tag in the same call works predictably)
  let next = removeKeywords.length > 0 ? current.filter((k) => !removeKeywords.includes(k)) : [...current];
  // Add (dedupe)
  for (const k of addKeywords) {
    if (!next.includes(k)) next.push(k);
  }
  return next;
}

metadataRoutes.post('/metadata/tag', async (req, res) => {
  const { filenames, source, tags } = req.body;

  if (!Array.isArray(filenames) || !source || !tags) {
    return res.status(400).json({ error: 'filenames, source, and tags required' });
  }

  if (!filenames.every(validateFilename)) {
    return res.status(400).json({ error: 'Invalid filename in list' });
  }

  // Parse the tags payload into keyword add/remove sets plus non-keyword tags.
  const addKeywords = Array.isArray(tags['Keywords+'])
    ? tags['Keywords+'].map(sanitize).filter((s) => typeof s === 'string' && s.length > 0)
    : [];
  const removeKeywords = Array.isArray(tags['Keywords-'])
    ? tags['Keywords-'].map(sanitize).filter((s) => typeof s === 'string' && s.length > 0)
    : [];
  const replaceKeywords = Array.isArray(tags.Keywords) ? tags.Keywords.map(sanitize) : null;

  // Non-keyword tags (Title, Description, Rating, etc.) pass through as-is.
  const otherTags = {};
  for (const [k, v] of Object.entries(tags)) {
    if (k === 'Keywords' || k === 'Keywords+' || k === 'Keywords-') continue;
    otherTags[k] = sanitize(v);
  }

  const basePath = path.resolve(source);
  const results = [];

  for (const filename of filenames) {
    const filePath = path.join(basePath, filename);
    if (!filePath.startsWith(basePath)) {
      results.push({ filename, ok: false, error: 'Bad path' });
      continue;
    }
    try {
      const writeTags = { ...otherTags };

      if (replaceKeywords !== null) {
        // Explicit replace — honor as given
        writeTags.Keywords = replaceKeywords;
      } else if (addKeywords.length > 0 || removeKeywords.length > 0) {
        // Read-merge-write, uniform across all formats (CR3 safe).
        writeTags.Keywords = await mergeKeywords(filePath, addKeywords, removeKeywords);
      }

      if (Object.keys(writeTags).length > 0) {
        await exiftool.write(filePath, writeTags, { writeArgs: ['-overwrite_original'] });
      }
      results.push({ filename, ok: true });
    } catch (e) {
      results.push({ filename, ok: false, error: e.message });
    }
  }

  res.json({ results });
});

// Rotate image via EXIF orientation
metadataRoutes.post('/rotate', async (req, res) => {
  const { filename, source, direction } = req.body;

  if (!validateFilename(filename) || !source || !['cw', 'ccw'].includes(direction)) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const filePath = path.join(path.resolve(source), filename);
  if (!filePath.startsWith(path.resolve(source))) {
    return res.status(400).json({ error: 'Bad path' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const tags = await exiftool.read(filePath);
    const currentOrientation = tags.Orientation || 1;

    // Orientation rotation map
    const cwMap = { 1: 6, 6: 3, 3: 8, 8: 1, 2: 7, 7: 4, 4: 5, 5: 2 };
    const ccwMap = { 1: 8, 8: 3, 3: 6, 6: 1, 2: 5, 5: 4, 4: 7, 7: 2 };
    const map = direction === 'cw' ? cwMap : ccwMap;

    const orientNum = typeof currentOrientation === 'number' ? currentOrientation : 1;
    const newOrientation = map[orientNum] || 1;

    // Invalidate cached thumbs BEFORE writing — cache key uses mtime,
    // so we must delete the old cache entry before the file changes
    invalidateCache(filePath);

    await exiftool.write(
      filePath,
      { Orientation: newOrientation },
      { writeArgs: ['-overwrite_original', '-n'] },
    );

    res.json({ ok: true, orientation: newOrientation });
  } catch (e) {
    res.status(500).json({ error: 'Rotation failed: ' + e.message });
  }
});
