import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import sharp from 'sharp';
import { exiftool } from 'exiftool-vendored';

const THUMB_DIR = path.join(os.tmpdir(), 'shelf-thumbs');
const THUMB_SIZE = 800;
const PREVIEW_SIZE = 2400;
const MAX_CONCURRENT = 8;

// Ensure thumb dir exists
fs.mkdirSync(THUMB_DIR, { recursive: true });

// Concurrency semaphore
let active = 0;
const queue = [];

function acquire() {
  return new Promise((resolve) => {
    if (active < MAX_CONCURRENT) {
      active++;
      resolve();
    } else {
      queue.push(resolve);
    }
  });
}

function release() {
  active--;
  if (queue.length > 0) {
    active++;
    queue.shift()();
  }
}

// Generate a cache key from file path + mtime
function cacheKey(filePath) {
  const stat = fs.statSync(filePath);
  const hash = crypto
    .createHash('md5')
    .update(filePath + stat.mtimeMs)
    .digest('hex')
    .slice(0, 12);
  return hash;
}

// Extract JPEG from raw file using exiftool, with fallback chain
async function extractJpeg(sourcePath) {
  const methods = ['JpgFromRaw', 'PreviewImage', 'ThumbnailImage'];

  for (const method of methods) {
    try {
      const tmpOut = path.join(THUMB_DIR, `extract_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
      await exiftool.extractJpgFromRaw(sourcePath, tmpOut);
      if (fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 0) {
        return tmpOut;
      }
      // Clean up empty file
      try { fs.unlinkSync(tmpOut); } catch { /* ignore */ }
    } catch {
      // Try next method
    }

    if (method === 'PreviewImage') {
      try {
        const tmpOut = path.join(THUMB_DIR, `preview_extract_${Date.now()}.jpg`);
        await exiftool.extractPreview(sourcePath, tmpOut);
        if (fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 0) {
          return tmpOut;
        }
        try { fs.unlinkSync(tmpOut); } catch { /* ignore */ }
      } catch {
        // Try next
      }
    }

    if (method === 'ThumbnailImage') {
      try {
        const tmpOut = path.join(THUMB_DIR, `thumb_extract_${Date.now()}.jpg`);
        await exiftool.extractThumbnail(sourcePath, tmpOut);
        if (fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 0) {
          return tmpOut;
        }
        try { fs.unlinkSync(tmpOut); } catch { /* ignore */ }
      } catch {
        // All methods failed
      }
    }
  }

  // If all extraction fails, try reading directly with sharp (works for JPEG/TIFF)
  return null;
}

// EXIF orientation → degrees for sharp.rotate()
const ORIENT_TO_DEGREES = { 1: 0, 3: 180, 6: 90, 8: 270 };

async function generateThumbnail(sourcePath, outputPath, maxDim) {
  await acquire();
  try {
    // Try extracting embedded JPEG first (fast path for RAW files)
    const extracted = await extractJpeg(sourcePath);
    const input = extracted || sourcePath;

    // If we extracted a preview JPEG from a RAW/DNG, the embedded JPEG
    // almost always has Orientation=1 (cameras pre-rotate the preview).
    // sharp's argument-less .rotate() reads Orientation from the INPUT file —
    // which is the extracted JPEG, not the DNG — so orientation changes
    // we write to the DNG never show up. Fix: read the DNG's orientation
    // explicitly and pass degrees to sharp.
    let rotateDegrees = null;
    if (extracted && extracted !== sourcePath) {
      try {
        const tags = await exiftool.read(sourcePath);
        const o = typeof tags.Orientation === 'number' ? tags.Orientation : 1;
        rotateDegrees = ORIENT_TO_DEGREES[o] ?? 0;
      } catch {
        rotateDegrees = 0;
      }
    }

    const pipeline = sharp(input);
    if (rotateDegrees !== null) {
      // Rotate by explicit degrees based on the DNG/raw's orientation tag.
      pipeline.rotate(rotateDegrees);
    } else {
      // Input IS the source file (not an extracted preview) — trust its EXIF.
      pipeline.rotate();
    }
    await pipeline
      .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(outputPath);

    // Clean up extracted temp file
    if (extracted && extracted !== sourcePath) {
      try { fs.unlinkSync(extracted); } catch { /* ignore */ }
    }
  } finally {
    release();
  }
}

export async function getThumbnail(sourcePath) {
  const key = cacheKey(sourcePath);
  const cached = path.join(THUMB_DIR, `thumb_${key}.jpg`);

  if (!fs.existsSync(cached)) {
    await generateThumbnail(sourcePath, cached, THUMB_SIZE);
  }

  return cached;
}

export async function getPreview(sourcePath) {
  const key = cacheKey(sourcePath);
  const cached = path.join(THUMB_DIR, `preview_${key}.jpg`);

  if (!fs.existsSync(cached)) {
    await generateThumbnail(sourcePath, cached, PREVIEW_SIZE);
  }

  return cached;
}

// Invalidate cache for a specific file (e.g., after rotation)
export function invalidateCache(sourcePath) {
  try {
    const key = cacheKey(sourcePath);
    const thumb = path.join(THUMB_DIR, `thumb_${key}.jpg`);
    const preview = path.join(THUMB_DIR, `preview_${key}.jpg`);
    if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
    if (fs.existsSync(preview)) fs.unlinkSync(preview);
  } catch {
    // Ignore cache invalidation errors
  }
}
