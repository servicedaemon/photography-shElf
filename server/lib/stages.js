import path from 'path';

const KEEPS_RE = /^Keeps\s*-\s*\d{2}-\d{4}\s*-\s*.+$/i;
const FAV_FOLDER_RE = /^Favorites\s*-\s*\d{2}-\d{4}\s*-\s*.+$/i;

export function detectStage(sourcePath) {
  if (!sourcePath || typeof sourcePath !== 'string') return 'CULL';

  const normalized = sourcePath.replace(/\/+$/, '');
  const basename = path.basename(normalized);

  if (basename === 'Favorites') return 'FINAL';
  if (FAV_FOLDER_RE.test(basename)) return 'FINAL';
  if (KEEPS_RE.test(basename)) return 'HEROES';

  return 'CULL';
}
