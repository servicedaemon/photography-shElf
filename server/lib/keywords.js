// Keyword merge logic for the tag write path.
//
// exiftool's `Keywords+` append syntax silently no-ops on CR3 files (the
// append writes to XMP/IPTC which doesn't merge back into the CR3 container).
// To work uniformly across DNG/JPEG/TIFF/CR3, we always read current keywords,
// compute the merged set in JS, and write back with plain `Keywords: [...]`.
//
// `mergeKeywords` is the pure-JS half of that pipeline — given the file's
// current keywords (possibly a string for single-value, an array, or
// undefined) plus an add set and a remove set, returns the new keyword list.

// Normalize the messy shapes exiftool returns (string for single, array for
// multiple, undefined when none) into a plain string array.
function normalizeCurrent(current) {
  if (current == null) return [];
  if (Array.isArray(current)) return current.slice();
  return [current];
}

// Compute the new keyword list. Remove first, then add (so re-adding a
// removed tag in the same call is predictable). Adds are deduped against
// the post-removal list — adding a keyword that already exists is a no-op.
export function mergeKeywords(current, addKeywords = [], removeKeywords = []) {
  const base = normalizeCurrent(current);
  const next = removeKeywords.length > 0 ? base.filter((k) => !removeKeywords.includes(k)) : base;
  for (const k of addKeywords) {
    if (!next.includes(k)) next.push(k);
  }
  return next;
}
