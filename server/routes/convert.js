import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const convertRoutes = Router();

const RAW_EXTENSIONS = /\.(cr3|cr2|arw|nef|raf)$/i;

// Check if dnglab is available
async function findDnglab() {
  try {
    const { stdout } = await execFileAsync('which', ['dnglab']);
    return stdout.trim();
  } catch {
    return null;
  }
}

// POST /api/convert
// Body: { source: "/path/to/folder", keepOriginals: true|false }
convertRoutes.post('/convert', async (req, res) => {
  const { source, keepOriginals } = req.body;

  if (!source) {
    return res.status(400).json({ error: 'source is required' });
  }

  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    return res.status(404).json({ error: 'Source directory not found' });
  }

  // Check dnglab is installed
  const dnglabPath = await findDnglab();
  if (!dnglabPath) {
    return res.status(501).json({
      error: 'dnglab is not installed',
      hint: 'Install with: cargo install dnglab',
    });
  }

  // Find convertible raw files
  let rawFiles;
  try {
    rawFiles = fs.readdirSync(sourcePath)
      .filter(f => RAW_EXTENSIONS.test(f) && !f.includes('..'))
      .sort();
  } catch {
    return res.status(400).json({ error: 'Cannot read source directory' });
  }

  if (rawFiles.length === 0) {
    return res.json({ total: 0, converted: 0, skipped: 0, errors: [] });
  }

  let converted = 0;
  let skipped = 0;
  const errors = [];

  // Create originals subfolder if keeping
  const originalsDir = path.join(sourcePath, 'originals');
  if (keepOriginals) {
    fs.mkdirSync(originalsDir, { recursive: true });
  }

  for (const filename of rawFiles) {
    const baseName = filename.replace(RAW_EXTENSIONS, '');
    const dngName = baseName + '.DNG';
    const srcFile = path.join(sourcePath, filename);
    const dngFile = path.join(sourcePath, dngName);

    // Skip if DNG already exists
    if (fs.existsSync(dngFile)) {
      skipped++;
      continue;
    }

    try {
      await execFileAsync(dnglabPath, ['convert', srcFile, dngFile], {
        timeout: 60000,
      });

      // Handle originals
      if (keepOriginals) {
        fs.renameSync(srcFile, path.join(originalsDir, filename));
      } else {
        fs.unlinkSync(srcFile);
      }

      converted++;
    } catch (e) {
      errors.push({ filename, error: e.message });
    }
  }

  res.json({
    total: rawFiles.length,
    converted,
    skipped,
    errors: errors.length > 0 ? errors : [],
  });
});

// GET /api/has-convertible?source=/path
// Quick check if a folder has raw files that could be converted
convertRoutes.get('/has-convertible', (req, res) => {
  const source = req.query.source;
  if (!source) return res.json({ hasConvertible: false, count: 0 });

  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    return res.json({ hasConvertible: false, count: 0 });
  }

  try {
    const count = fs.readdirSync(sourcePath)
      .filter(f => RAW_EXTENSIONS.test(f))
      .length;
    res.json({ hasConvertible: count > 0, count });
  } catch {
    res.json({ hasConvertible: false, count: 0 });
  }
});
