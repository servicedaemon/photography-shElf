// EXIF timestamp batch-read with per-folder caching.
//
// Reads DateTimeOriginal + SubSecTimeOriginal for a list of files in a folder,
// returns a { filename: timestampMs } map. Results cache keyed by folder path
// + mtime — any change to the folder (file add/remove/mark) busts the cache.
//
// NOTE on concurrency: two concurrent cold-cache reads for the same folder
// will both fire Promise.all EXIF reads and both write the same data —
// benign since results are identical for the same mtime. No mutex.

import path from 'path';
import fs from 'fs';
import { exiftool } from 'exiftool-vendored';

const cache = new Map(); // folderPath → { mtime, timestamps }

// Convert an exiftool-vendored tag object to a ms-since-epoch timestamp, or
// null if the photo has no usable capture time.
// Exported for testing — the SubSec parsing has caused silent bugs before.
export function exifToTimestamp(tags) {
  if (!tags) return null;
  const dt = tags.DateTimeOriginal ? new Date(tags.DateTimeOriginal) : null;
  if (!dt || Number.isNaN(dt.getTime())) return null;

  // SubSecTimeOriginal is a fractional-second suffix in decimal notation:
  // "5" = 0.5s = 500ms, "37" = 0.37s = 370ms, "440" = 0.440s = 440ms.
  // The naive `parseInt(ss) * 10` formula (which assumes 2-digit encoding)
  // silently corrupts timestamps on cameras that emit 1- or 3-digit values.
  const ssRaw = tags.SubSecTimeOriginal;
  if (ssRaw == null || ssRaw === '') return dt.getTime();
  const ssMs = Math.round(parseFloat('0.' + String(ssRaw)) * 1000);
  return dt.getTime() + (Number.isFinite(ssMs) ? ssMs : 0);
}

export async function readTimestamps(folderPath, filenames) {
  if (!Array.isArray(filenames) || filenames.length === 0) return {};

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(folderPath).mtimeMs;
  } catch {
    return {};
  }

  const cached = cache.get(folderPath);
  if (cached && cached.mtime === mtimeMs) {
    const out = {};
    for (const f of filenames) {
      if (cached.timestamps[f] != null) out[f] = cached.timestamps[f];
    }
    return out;
  }

  // Parallel reads — exiftool-vendored keeps a persistent process that
  // internally serializes, so this won't overload the child. Worst case
  // we wait for a 400-photo folder: sequential would be ~4s, the internal
  // queue gives us a bit of pipelining.
  const results = await Promise.all(
    filenames.map(async (f) => {
      try {
        const tags = await exiftool.read(path.join(folderPath, f));
        return [f, exifToTimestamp(tags)];
      } catch {
        return [f, null];
      }
    }),
  );

  const timestamps = {};
  for (const [f, ts] of results) {
    if (ts != null) timestamps[f] = ts;
  }

  cache.set(folderPath, { mtime: mtimeMs, timestamps });
  return timestamps;
}

// For tests / cache busting
export function clearTimestampCache() {
  cache.clear();
}
