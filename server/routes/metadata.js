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

// Bulk write tags to files
metadataRoutes.post('/metadata/tag', async (req, res) => {
  const { filenames, source, tags } = req.body;

  if (!Array.isArray(filenames) || !source || !tags) {
    return res.status(400).json({ error: 'filenames, source, and tags required' });
  }

  if (!filenames.every(validateFilename)) {
    return res.status(400).json({ error: 'Invalid filename in list' });
  }

  // Sanitize tag values — strip shell metacharacters
  const safeTags = {};
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value === 'string') {
      safeTags[key] = value.replace(/[;&|`$(){}[\]<>\\]/g, '');
    } else if (Array.isArray(value)) {
      safeTags[key] = value.map((v) =>
        typeof v === 'string' ? v.replace(/[;&|`$(){}[\]<>\\]/g, '') : v,
      );
    } else {
      safeTags[key] = value;
    }
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
      await exiftool.write(filePath, safeTags, { writeArgs: ['-overwrite_original'] });
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
