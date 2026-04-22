import fs from 'fs';
import path from 'path';

// Flat sort-output pattern: "Keeps - 04-2026 - Name/" etc.
const KEEPS_DATED_RE = /^Keeps\s*-\s*\d{2}-\d{4}\s*-\s*.+$/i;
const FAV_DATED_RE = /^Favorites\s*-\s*\d{2}-\d{4}\s*-\s*.+$/i;

const SHOOT_SUBFOLDERS = ['unsorted', 'keeps', 'rejects', 'favorites', 'edited'];
const IMAGE_RE = /\.(cr3|cr2|arw|nef|raf|dng|jpg|jpeg|tif|tiff)$/i;

// Manual basename that handles both / and \ separators.
function basenameAnySep(p) {
  const trimmed = p.replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

function folderHasImages(dirPath) {
  try {
    return fs.readdirSync(dirPath).some((f) => IMAGE_RE.test(f));
  } catch {
    return false;
  }
}

// Pure path-based stage detection. Used for flat sort-output layouts
// ("Keeps - 04-2026 - Name/") where the stage is obvious from the name.
// Returns null if the path doesn't match any dated pattern.
function detectStageFromPath(basename) {
  const lc = basename.toLowerCase();
  if (lc === 'favorites' || FAV_DATED_RE.test(basename) || lc === 'edited') return 'FINAL';
  if (KEEPS_DATED_RE.test(basename)) return 'HEROES';
  return null;
}

// Shoot-aggregate stage detection. When source is inside a shoot (either at
// the shoot root, or in one of its sub-folders like unsorted/keeps/rejects),
// determine the stage from the SHOOT'S overall state rather than whichever
// sub-folder is currently being viewed — because users can toggle between
// sub-folders via the shoot nav, so the stage label should describe the
// shoot's workflow phase, not the current click target.
//
// Rules (inline shoot layout):
//   Favorites/ or edited/ has files          → FINAL
//   keeps/ has files (and no FINAL content)  → HEROES
//   otherwise                                → CULL
//
// Returns null if sourcePath isn't recognizably inside a shoot.
function detectStageFromShoot(sourcePath) {
  const basename = basenameAnySep(sourcePath);
  const lc = basename.toLowerCase();

  // Figure out the shoot root: either sourcePath itself, or its parent if
  // sourcePath is a known shoot sub-folder.
  let shootRoot;
  if (SHOOT_SUBFOLDERS.includes(lc)) {
    shootRoot = path.dirname(sourcePath.replace(/[/\\]+$/, ''));
  } else {
    shootRoot = sourcePath;
  }

  // Verify shootRoot exists and has shoot sub-folders
  let entries;
  try {
    entries = fs.readdirSync(shootRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const subs = {};
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const n = e.name.toLowerCase();
    if (SHOOT_SUBFOLDERS.includes(n)) subs[n] = path.join(shootRoot, e.name);
  }
  // Need at least one recognized sub-folder for this to be a shoot
  if (Object.keys(subs).length === 0) return null;

  // FINAL if any curated pile has content
  if (subs.favorites && folderHasImages(subs.favorites)) return 'FINAL';
  if (subs.edited && folderHasImages(subs.edited)) return 'FINAL';
  // HEROES if keeps has been populated
  if (subs.keeps && folderHasImages(subs.keeps)) return 'HEROES';
  // Otherwise still culling
  return 'CULL';
}

export function detectStage(sourcePath) {
  if (!sourcePath || typeof sourcePath !== 'string') return 'CULL';

  const basename = basenameAnySep(sourcePath);

  // Flat sort-output folders (e.g. "Keeps - 04-2026 - X") — stage is obvious
  // from the name alone, no fs access needed.
  const flat = detectStageFromPath(basename);
  if (flat) return flat;

  // Inline shoot layout — aggregate from the shoot's overall state.
  const shoot = detectStageFromShoot(sourcePath);
  if (shoot) return shoot;

  return 'CULL';
}
