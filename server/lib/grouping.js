// Stack grouping — cluster photos taken within a short time window.
//
// Takes an array of { filename, timestamp } and returns the filenames
// of each stack (groups with ≥2 members). Uses chain clustering:
// A and B within gap, B and C within gap → A, B, C all in one stack,
// even if A and C are individually more than gap apart.
//
// The detection strategy (time-based) is an implementation detail — a
// "stack" is any group of related frames. Future strategies (HDR brackets,
// focus stacks, manual grouping) can populate the same structure.
//
// Pure function. No I/O. See server/lib/exif-cache.js for the EXIF-reading
// that produces the timestamps this consumes.

export function groupImages(imagesWithTimestamps, gapMs = 5000) {
  if (!Array.isArray(imagesWithTimestamps) || imagesWithTimestamps.length === 0) {
    return [];
  }

  const sorted = [...imagesWithTimestamps]
    .filter((i) => i && typeof i.timestamp === 'number' && Number.isFinite(i.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  const groups = [];
  let current = [];

  for (const img of sorted) {
    if (current.length === 0) {
      current.push(img);
      continue;
    }
    const last = current[current.length - 1];
    if (img.timestamp - last.timestamp <= gapMs) {
      current.push(img);
    } else {
      if (current.length > 1) groups.push(current.map((i) => i.filename));
      current = [img];
    }
  }
  if (current.length > 1) groups.push(current.map((i) => i.filename));

  return groups;
}
