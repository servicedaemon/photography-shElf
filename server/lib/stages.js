import fs from 'fs';
import path from 'path';

// Flat sort-output pattern: "Keeps - 04-2026 - Name/" etc.
const KEEPS_DATED_RE = /^Keeps\s*-\s*\d{2}-\d{4}\s*-\s*.+$/i;
const FAV_DATED_RE = /^Favorites\s*-\s*\d{2}-\d{4}\s*-\s*.+$/i;

// Aliases mapping any reasonable folder-name variant → canonical role.
// Forgiving on case, trailing whitespace, and singular vs. plural so that
// hand-renamed shoots from the wild (e.g. "Favorites " with a trailing
// space, or singular "Keep") still register as the right pile.
const SUBFOLDER_ALIASES = {
  unsorted: ['unsorted', 'unmarked'],
  keeps: ['keep', 'keeps'],
  rejects: ['reject', 'rejects'],
  favorites: ['favorite', 'favorites', 'fav', 'favs'],
  edited: ['edit', 'edits', 'edited'],
};

// Map any folder name to its canonical role, or null if it doesn't look
// like a shoot subfolder. Trims whitespace and lowercases before matching.
export function normalizeSubfolderRole(rawName) {
  if (typeof rawName !== 'string') return null;
  const trimmed = rawName.toLowerCase().trim();
  for (const [canonical, aliases] of Object.entries(SUBFOLDER_ALIASES)) {
    if (aliases.includes(trimmed)) return canonical;
  }
  return null;
}

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
  // First try the forgiving role normalizer — handles "Favorites ", "favs",
  // "edit", etc. Only certain roles imply a stage on their own (favorites
  // and edited are FINAL; keeps without a dated wrapper is ambiguous and
  // falls through to the regex/aggregate logic).
  const role = normalizeSubfolderRole(basename);
  if (role === 'favorites' || role === 'edited') return 'FINAL';
  if (FAV_DATED_RE.test(basename)) return 'FINAL';
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

  // Figure out the shoot root: either sourcePath itself, or its parent if
  // sourcePath is a known shoot sub-folder (any spelling/case/trim).
  let shootRoot;
  if (normalizeSubfolderRole(basename) !== null) {
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
    const role = normalizeSubfolderRole(e.name);
    if (role) subs[role] = path.join(shootRoot, e.name);
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
