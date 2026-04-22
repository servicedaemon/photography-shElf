const KEEPS_RE = /^Keeps\s*-\s*\d{2}-\d{4}\s*-\s*.+$/i;
const FAV_FOLDER_RE = /^Favorites\s*-\s*\d{2}-\d{4}\s*-\s*.+$/i;

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

  if (basename === 'Favorites') return 'FINAL';
  if (FAV_FOLDER_RE.test(basename)) return 'FINAL';
  if (KEEPS_RE.test(basename)) return 'HEROES';

  return 'CULL';
}
