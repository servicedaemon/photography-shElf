# Burst Grouping — v1.1.0 Implementation Plan

**Status:** Ready to implement. Pivoted from ML-based similarity after spike showed timestamps tie ML on Ava's real shoots.
**Companion docs:**

- [CLIP brainstorm](2026-04-22-clip-similarity-brainstorm.md) — original ML exploration
- [CLIP implementation plan v2](2026-04-23-clip-implementation-plan.md) — the plan we pivoted AWAY from
- `scripts/spike-similarity.mjs` — the experiment that caused the pivot

## One-line summary

When EXIF `DateTimeOriginal` puts photos within 5 seconds of each other, show a burst badge and highlight the cluster on hover. Zero ML, zero new dependencies, zero inference time.

## Why timestamp, not ML

Spike on 14 real photos from 4 of Ava's shoots (3 confirmed same-pose bursts via sub-second EXIF timestamps):

| Approach              | F1       | Cost                    |
| --------------------- | -------- | ----------------------- |
| **Timestamp ≤5s gap** | **1.00** | 0ms, no deps            |
| DINOv2-small @ 0.80   | 1.00     | 111ms/photo, 22MB model |
| CLIP ViT-B/32 @ best  | 0.88     | 111ms/photo, 32MB model |

Timestamps win on accuracy (tied) + cost (free) + ship time (1 session vs 3-4).

The 5% case timestamps miss is **retake detection** (same setup, long gap). Not in Ava's confirmed workflow. Deferred to v1.2.0+ behind a clean `groupImages()` seam — if retake friction ever surfaces during real culling, ML is a drop-in replacement.

## Implementation

### Server

**1. `server/lib/grouping.js` (new)**

```js
// Pure function: take an array of {filename, timestamp} and return cluster groups.
// timestamp is ms-since-epoch (already read by caller).
// Photos within gapMs of each other (chain-clustered) go in the same group.
export function groupImages(imagesWithTimestamps, gapMs = 5000) {
  const sorted = [...imagesWithTimestamps].sort((a, b) => a.timestamp - b.timestamp);
  const groups = [];
  let current = [];
  for (const img of sorted) {
    if (current.length === 0) {
      current.push(img);
      continue;
    }
    const lastTs = current[current.length - 1].timestamp;
    if (img.timestamp - lastTs <= gapMs) {
      current.push(img);
    } else {
      if (current.length > 1) groups.push(current.map((i) => i.filename));
      current = [img];
    }
  }
  if (current.length > 1) groups.push(current.map((i) => i.filename));
  return groups;
}
```

Returns only groups with ≥2 members (singletons aren't bursts, no UI signal needed).

**2. `server/lib/exif-cache.js` (new or add to thumbnails.js)**

Batch EXIF read via `exiftool-vendored`. Keyed by (folder path + folder mtime). Returns `{filename: timestampMs}` map.

```js
const cache = new Map(); // key: folderPath, value: { mtime, timestamps }

export async function readTimestamps(folderPath, filenames) {
  const stat = fs.statSync(folderPath);
  const mtimeMs = stat.mtimeMs;

  const cached = cache.get(folderPath);
  if (cached && cached.mtime === mtimeMs) {
    // Filter cache to only the requested files (in case of stale extras)
    const out = {};
    for (const f of filenames) {
      if (cached.timestamps[f] != null) out[f] = cached.timestamps[f];
    }
    return out;
  }

  const timestamps = {};
  // exiftool-vendored reads one at a time but keeps a persistent process —
  // batch via Promise.all with a semaphore for concurrency (reuse thumbnails.js pattern)
  // ... actually sequential is fine for this, EXIF reads are <10ms each
  for (const f of filenames) {
    try {
      const tags = await exiftool.read(path.join(folderPath, f));
      const dt = tags.DateTimeOriginal ? new Date(tags.DateTimeOriginal) : null;
      if (dt) {
        const ss = parseInt(tags.SubSecTimeOriginal || '0', 10);
        timestamps[f] = dt.getTime() + ss * 10; // SubSec is hundredths → ms
      }
    } catch {
      // missing EXIF — file excluded from burst grouping
    }
  }

  cache.set(folderPath, { mtime: mtimeMs, timestamps });
  return timestamps;
}
```

Invalidation: cache key includes folder mtime, so any file change (mark, rename, delete) flips mtime and busts the cache.

**3. `server/routes/images.js` — wire timestamps into the response**

```js
imageRoutes.get('/images', async (req, res) => {
  const source = resolveSource(req.query);
  if (!source || !fs.existsSync(source)) {
    return res.json({ images: [], stage: 'CULL', bursts: [] });
  }
  try {
    const files = fs.readdirSync(source).filter(VALID_FILENAME.test.bind(VALID_FILENAME)).sort();
    const state = getState(source);
    const images = files.map((f) => ({ filename: f, status: state[f] || 'unmarked' }));

    // Batch EXIF + cluster
    const timestamps = await readTimestamps(source, files);
    const withTs = files
      .filter((f) => timestamps[f] != null)
      .map((f) => ({ filename: f, timestamp: timestamps[f] }));
    const bursts = groupImages(withTs, 5000); // 5s default

    res.json({ images, stage: detectStage(source), bursts });
  } catch {
    res.json({ images: [], stage: 'CULL', bursts: [] });
  }
});
```

Apply same to `/folder/:folder/images`.

### Client

**4. `client/src/grid.js` — render burst badges**

Store `bursts` in grid state. Build a per-card lookup `{filename → burstId}`. When rendering each card:

```js
const burstId = burstByFilename[img.filename];
if (burstId != null) {
  const burstSize = burstSizes[burstId];
  const badge = document.createElement('div');
  badge.className = 'burst-badge';
  badge.textContent = `◈${burstSize}`;
  badge.title = `${burstSize} photos taken within 5 seconds`;
  card.dataset.burstId = burstId;
  card.appendChild(badge);
}
```

**5. `client/styles/grid.css` — badge + hover-cluster highlight**

```css
.card .burst-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 7px;
  border-radius: 2px;
  background: rgba(224, 168, 46, 0.92);
  color: var(--badge-text);
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  z-index: 3;
  backdrop-filter: blur(6px);
}

/* When hovering a burst card, highlight all siblings in the same burst */
.card[data-burst-id]:hover ~ .card[data-burst-id] {
  /* TODO: JS handles this */
}
```

Hover-highlight in JS — use `mouseenter`/`mouseleave` on burst cards:

```js
card.addEventListener('mouseenter', () => {
  if (burstId == null) return;
  document
    .querySelectorAll(`.card[data-burst-id="${burstId}"]`)
    .forEach((c) => c.classList.add('burst-sibling'));
});
card.addEventListener('mouseleave', () => {
  document
    .querySelectorAll('.card.burst-sibling')
    .forEach((c) => c.classList.remove('burst-sibling'));
});
```

```css
.card.burst-sibling {
  box-shadow: 0 0 0 2px rgba(224, 168, 46, 0.45);
}
```

### Tests

`server/test/grouping.test.js`:

- Empty array → empty groups
- All singletons → empty groups (no groups of size 1 returned)
- 2 photos 1s apart → 1 group of 2
- 3 photos 1s + 10s + 1s (first pair burst, last isolated) → 1 group
- 3 photos chain-clustered (0-4s, 4-8s total 8s) → 1 group of 3 (chaining works)
- Unsorted input → correctly sorted + grouped
- Custom gap (1s) overrides default

## Out of scope for v1.1.0

- Keyboard shortcut to jump between bursts (maybe v1.1.1 if Ava wants)
- Visual similarity via ML (deferred to v1.2.0+ only if proven needed)
- Group-level batch operations (mark all as reject)
- Cross-camera burst detection (needs `(SerialNumber, timestamp)` grouping)
- User-configurable gap threshold

## Ship criteria

- `groupImages` unit tests pass
- Badge renders on confirmed burst frames in the live app
- Hover highlights all sibling cards in the same burst
- No regression: grid still works when timestamps are missing / unreadable
- Full app still builds + runs on macOS, ships on arm64 DMG first

## Rename to-do

Branch name `burst-grouping` reflects reality. Delete after merge. The `clip-similarity` name was from the exploration phase.
