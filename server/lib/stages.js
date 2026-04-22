// Flat sort-output pattern: "Keeps - 04-2026 - Name/" etc.
const KEEPS_DATED_RE = /^Keeps\s*-\s*\d{2}-\d{4}\s*-\s*.+$/i;
const FAV_DATED_RE = /^Favorites\s*-\s*\d{2}-\d{4}\s*-\s*.+$/i;

// Manual basename that handles both / and \ separators. Node's path.basename
// respects only the active platform's separator, which breaks when we want a
// test (or any code) to reason about paths from another OS.
function basenameAnySep(p) {
  const trimmed = p.replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

export function detectStage(sourcePath) {
  if (!sourcePath || typeof sourcePath !== 'string') return 'CULL';

  const basename = basenameAnySep(sourcePath);
  const lc = basename.toLowerCase();

  // FINAL: already-curated favorites folders (any capitalization) and
  // post-edit "edited" folders. Also matches the dated sort-output variant.
  if (lc === 'favorites' || lc === 'edited') return 'FINAL';
  if (FAV_DATED_RE.test(basename)) return 'FINAL';

  // HEROES: reviewing keeps. Handles both the inline shoot sub-folder layout
  // (".../Shoot Name/keeps") and the dated sort-output variant.
  if (lc === 'keeps') return 'HEROES';
  if (KEEPS_DATED_RE.test(basename)) return 'HEROES';

  // Everything else (unsorted/, rejects/, bare shoot roots, arbitrary folders) = CULL
  return 'CULL';
}
