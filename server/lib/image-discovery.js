// Helpers for finding image-bearing folders inside arbitrary trees.
// Used by:
//   - `server/lib/drives.js` to surface camera cards that don't follow the
//     strict /Volumes/<X>/DCIM/<subdir>/ layout (drones, action cams,
//     hand-organized cards).
//   - `server/routes/config.js` `/api/list-dir` to surface nested image
//     folders when the user points the picker at a card root that has
//     `DCIM/100EOS5D/IMG_*.CR3` instead of loose images.
//
// Pre-v1.5.1 both code paths assumed strict layouts and a "giant folder
// full of photos" two levels deep would render as an empty listing.

import fs from 'fs';
import path from 'path';

export const IMAGE_RE = /\.(cr3|cr2|arw|nef|raf|dng|jpg|jpeg|tif|tiff)$/i;

// Skip Apple's volume metadata trees — they never contain photos and
// walking them on a 64GB card adds noticeable scan latency.
const SKIP_DIRS = new Set(['.Spotlight-V100', '.fseventsd', '.Trashes']);

export function countImages(dir) {
  try {
    let n = 0;
    for (const f of fs.readdirSync(dir)) {
      if (IMAGE_RE.test(f)) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

export function hasImages(dir) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (IMAGE_RE.test(f)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

// Walk a folder up to `maxDepth` levels below `rootPath`, collecting every
// directory that directly contains image files. If a directory has images,
// its own children are NOT walked (we surface the image-bearing folder as
// a single pickable unit instead of recursing into JPG previews, etc.).
//
// Depth semantics: `rootPath` itself is depth 0. A direct child is depth 1.
// `maxDepth=2` therefore allows finding image folders at the root's children
// and grandchildren — enough to catch the `DCIM/100EOS5D/` pattern when
// called with the card root, or just `DCIM/100EOS5D/` when called with the
// DCIM folder directly.
//
// Returns an array of { path, relName, imageCount }. `relName` is built
// from `rootName + '/' + childPath` so callers can show users a friendly
// "DCIM/100EOS5D" label without re-deriving the path.
export function findImageFolders(rootPath, rootName, maxDepth) {
  const results = [];

  // `depth` is the depth of `dirPath` relative to `rootPath` — its
  // CHILDREN sit at depth + 1, which is what we check against maxDepth.
  function walk(dirPath, relName, depth) {
    if (depth >= maxDepth) return; // no point reading children we can't descend into
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const childPath = path.join(dirPath, e.name);
      const childRel = relName ? `${relName}/${e.name}` : e.name;
      const count = countImages(childPath);
      if (count > 0) {
        results.push({ path: childPath, relName: childRel, imageCount: count });
      } else {
        walk(childPath, childRel, depth + 1);
      }
    }
  }

  walk(rootPath, rootName, 0);
  return results;
}
