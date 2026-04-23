# CLIP Similarity Grouping — Implementation Plan for v1.1.0

**Status:** Plan complete + pressure-tested. Awaiting implementation kickoff.
**Date:** 2026-04-23
**Companion doc:** [2026-04-22-clip-similarity-brainstorm.md](2026-04-22-clip-similarity-brainstorm.md) — decisions locked there.
**Revision history:** Drafted by sonnet · pressure-tested by Opus + sonnet together · six real bugs fixed in round 1 (model source was fabricated, preprocessing normalization was wrong, input size was 224 vs actual 256, binary-rewrite was too aggressive, extractJpeg temp leak, S0-vs-S2 decision was pre-made instead of bench-driven). Applied fixes inline.

## Pre-commit-1 verification (do these BEFORE writing any code)

1. **Locate the actual ONNX file.** `apple/mobileclip` on HuggingFace has PyTorch weights only — no INT8 ONNX. Check `Xenova/mobileclip` first (community, Apache-2.0). Record exact filename and input tensor shape (read from ONNX metadata via `onnxruntime`). If no suitable pre-converted file exists, fall back: PyTorch export via Apple's official repo + `onnxruntime.quantization` INT8 post-training.
2. **Confirm input size and preprocessing from the actual ONNX file's input tensor spec.** MobileCLIP expects 256×256 (not 224×224) and OpenAI CLIP normalization: mean = (0.48145466, 0.4578275, 0.40821073), std = (0.26862954, 0.26130258, 0.27577711). Don't trust this plan — read the tensor shape from the model at commit-1 time.
3. **Confirm license** of whatever community ONNX we land on.

Nothing gets committed in commit 1 until all three are confirmed.

## One-sentence summary

Add `onnxruntime-node` + bundled MobileCLIP-S0 INT8 (~28MB), mirror the `server/lib/thumbnails.js` semaphore pattern for per-shoot embedding into `<shoot>/.shelf/embeddings.bin`, cluster at fixed 0.95 cosine threshold, expose via SSE for progress, and render a horizontal-strip "Group Mode" layout when the user opts in via a post-embed tooltip.

## Commit sequence (6 commits, each independently reviewable)

| # | Commit | What it proves |
|---|---|---|
| 1 | **Scaffolding** — add `onnxruntime-node@1.21.0`, drop model into `electron/models/`, wire `asarUnpack` | Model file resolves at runtime in both dev and packaged builds |
| 2 | **Server lib** — `embeddings.js` with `loadModel`, `embedImage`, `clusterEmbeddings`, binary format + semaphore | Unit tests pass; bench script shows <90s for 400 photos on M-series |
| 3 | **Server routes** — `embeddings.js` with `/ensure`, `/status`, `/stream` (SSE), `/groups` | curl-driven manual test of SSE progress events |
| 4 | **Event bus + client module** — `group-mode.js`, pill DOM, SSE wiring, `loadSource` integration | Pill appears during embed, fires sparkle on complete |
| 5 | **CSS + grouped grid layout** — `group-mode.css`, `renderGroupedGrid`, Group Mode button | Playwright E2E: load fixture → pill → click Group Mode → strips render |
| 6 | **Keyboard nav + polish** — group-aware nav, group-ready tooltip, v1.1.0 version bump | Ship |

## Hard performance budget

- Embed 400 photos (M-series, 8 concurrent workers): **<90s**
- Cluster 400 embeddings (cosine similarity matrix): **<200ms**
- Group Mode toggle → rendered: **<100ms**
- Resume on reopen (10 new photos): **<5s**

## Key risks to watch

1. **Native module per-arch** — `onnxruntime-node` ships separate prebuilds for darwin-arm64, darwin-x64, win32-x64, linux-x64. `npm install` on the CI runner picks up the right one. Universal macOS builds are deferred out of scope.
2. **Model load time on first open** — ~500ms cold on M2. Lazy-load on first `/ensure` call, NOT at server start.
3. **Sharp RAW decoding** — prefer the embedded-JPEG extraction path from `thumbnails.js`; fall back to libvips direct only if that fails. `extractJpeg` returns a temp file path and must be `unlink`ed in a `finally` after use.
4. **Silent preprocessing bug** — the biggest risk. If input size or normalization is wrong, embeddings look plausible but clusters at 0.95 threshold are meaningless. Read the ONNX's input tensor spec, don't guess.
5. **Model file in git** — direct commit (no LFS). 28-55MB is acceptable for a personal-tool repo.
6. **S0 vs S2 quality** — S0 may not discriminate well enough for Ava's subtle studio-shot bursts. Decision deferred to commit 2 bench validation.

## Out of scope (explicitly)

User-adjustable threshold slider · Pick-best-automatically · Group-level batch ops · Multiple model choices · Elf gets new poses · Cross-shoot grouping · Universal macOS binary

## Full plan detail

---

### 1. Dependency additions

Add to `package.json` `"dependencies"`: `"onnxruntime-node": "1.21.0"`. Ships prebuilt native binaries for darwin-arm64, darwin-x64, win32-x64, linux-x64.

### 2. Model sourcing (REVISED)

**Source:** MobileCLIP-S0 ONNX INT8 export. Exact file + provenance must be verified before commit 1 — see pre-commit verification above. Likely candidates in order: `Xenova/mobileclip` on HuggingFace (community, Apache-2.0), or self-converted export from Apple's official `ml-mobileclip` PyTorch weights + `onnxruntime.quantization`. License: Apple MIT inherited.

**S0 vs S2 is bench-driven, not pre-decided.** Default: ship S0 (~28MB). In commit 2, run the bench script on one of Ava's real test shoots and hand-verify that known same-pose bursts cluster correctly at 0.95. If S0 produces split clusters on obvious bursts, swap to S2 (~55MB) before commit 3. The 27MB delta is rounding-error on a 180MB DMG; quality matters more than size for this feature.

**git-LFS: NO. Direct commit.** Personal-tool repo, 28-55MB is acceptable, LFS adds clone-time friction that isn't worth the savings.

**Repo location:** `electron/models/mobileclip-s0-int8.onnx` (or `-s2-int8.onnx`).

**Build config:** add `"electron/models/**/*"` to `asarUnpack`. The existing `"electron/**/*"` in `files` already covers it. Resolve at runtime with the standard asar-unpacked pattern:

```js
const modelPath = path.join(app.getAppPath(), 'electron/models/mobileclip-s0-int8.onnx')
  .replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
```

Pass to Express via `SHELF_MODEL_PATH` env var in `electron/server-process.js`.

### 3. Server module — `server/lib/embeddings.js`

Mirror `thumbnails.js` exactly. Module-scope semaphore with `MAX_CONCURRENT = 8`, `active` counter, `queue`, `acquire()` / `release()`.

**`loadModel()`** — lazy singleton. Dynamic import `onnxruntime-node`, create `InferenceSession` with `executionProviders: ['cpu']` and `graphOptimizationLevel: 'all'`.

**`embedImage(filePath)`** — returns `Float32Array(512)`. REVISED preprocessing:

1. Acquire semaphore.
2. `const extracted = await extractJpeg(filePath)` (exported from `thumbnails.js` — needs to be added to its exports in commit 1/2). Wrap steps 3-7 in `try { ... } finally { if (extracted) fs.unlinkSync(extracted); }` to avoid temp-file leak.
3. `sharp(extracted || filePath).resize(256, 256, { fit: 'fill' }).raw().toBuffer()` — **256×256** is MobileCLIP's native input size. Confirm from ONNX input tensor spec at verification time.
4. uint8 → float32 with **OpenAI CLIP normalization per channel**: `(pixel / 255 - mean[c]) / std[c]` where `mean = [0.48145466, 0.4578275, 0.40821073]`, `std = [0.26862954, 0.26130258, 0.27577711]`. MobileCLIP inherits this normalization. **Skipping normalization produces plausible-looking but uncalibrated embeddings — the 0.95 threshold becomes meaningless.**
5. Transpose HWC → CHW, build NCHW tensor `[1, 3, 256, 256]`.
6. `session.run({ input: tensor })`, output key is `output`.
7. L2-normalize in-place. Release semaphore. Return `Float32Array(512)`.

**`ensureEmbeddings(shootPath, progressCallback)`:** REVISED to batch writes.

1. Read `.shelf/embeddings.bin` header, parse JSON index, identify missing filenames.
2. For each missing image: `embedImage` with semaphore, **accumulate in-memory**, call `progressCallback({done, total})`.
3. **Flush to disk every 20 completions (and on final completion)** via `atomicWrite`. A per-image rewrite on a 400-photo shoot = ~160MB of I/O (bad on SD cards / NAS); batching to every-20 reduces this 20× with acceptable crash loss (up to 19 embeddings, auto-recomputed on reopen since `ensureEmbeddings` is idempotent).
4. On per-image error: log warn, skip, continue.
5. After all done: call `clusterEmbeddings`, cache in module Map keyed by `shootPath`.

**`clusterEmbeddings(embeddings, threshold = 0.95)`** — REVISED to single-pass, no centroid drift:
- Walk filenames in sorted order (stable, reproducible).
- For each image: cosine similarity (dot product of L2-normalized vectors) against **each existing cluster's FIRST member** (index 0), not a running centroid. Join first cluster where similarity ≥ threshold, else start new cluster.
- Why no centroid update: at 0.95 threshold with studio bursts, centroid drift is mild (members typically 0.97-0.99 similar to anchor), but drift can still misclassify frames 18-20 of a long burst as a separate cluster. Single-pass fixed-anchor is predictable, simpler, and easier to unit-test.
- Sort clusters by `members.length` desc, singletons to end.
- Returns `[{members: [filenames]}]`. (No centroid in the return — we don't need it downstream.)

### 4. Binary file format — `.shelf/embeddings.bin`

```
Bytes 0-3:   uint32 LE — length of JSON header (N)
Bytes 4 to 4+N-1: UTF-8 JSON string
Bytes 4+N onward: packed Float32 embeddings, 512 floats × 4 bytes = 2048 B per image
```

Header JSON:
```json
{
  "version": 1,
  "dims": 512,
  "entries": {
    "IMG_0001.DNG": { "offset": 0, "embedded": true },
    "IMG_0002.DNG": { "offset": 2048, "embedded": true }
  }
}
```

Offset is from start of embedding body (after header). Full-file rewrite on every update via `atomicWrite` from `state.js` pattern — tmp file + rename.

`.shelf/` creation: `fs.mkdirSync(path.join(shootPath, '.shelf'), { recursive: true })`. On permission error: in-memory fallback, log warn, grouping works this session only.

### 5. Server routes — `server/routes/embeddings.js`

**SSE transport decision:** use Server-Sent Events for progress. One connection, server pushes events, no client-side polling timers. Four lines of Express boilerplate. Rationale beats short-polling at 1s × 90s = 90 round-trips.

- `GET /api/embeddings/stream?source=...` — `text/event-stream`, calls `ensureEmbeddings` with progress callback pushing `data: {"done":N,"total":M}\n\n`. Final message includes `groups: K`. Guarded by module-scope `activeJobs` Set so concurrent requests for same shoot share one job.
- `GET /api/embeddings/status?source=...` — reads `.shelf/embeddings.bin` header only, returns `{embedded, total, groups}`.
- `GET /api/embeddings/groups?source=...&threshold=0.95` — returns `{clusters, singletons}`. Uses cache, recomputes from disk on app restart.
- `POST /api/embeddings/ensure?source=...` — non-blocking kick-off via `setImmediate`. Returns `{started: true}` or `{running: true}`.

Mount in `server/index.js` alongside other route imports.

### 6. Client module — `client/src/group-mode.js`

Single module. Imports `bus`, `EVENTS`, `setGridData`, `getImages`, `getSource`.

**Progress pill:** on `POST /ensure` success, inject `<div id="embed-pill">Grouping: 0/N</div>` into header. Open `EventSource('/api/embeddings/stream?source=...')`. Update pill text on each message. On completion: fade out pill, fire one `sparkle` elf pose (reuse existing `IMAGE_MARKED favorite` event), remove pill after 1.4s.

**Tooltip notification:** when SSE completes with ≥2 clusters of ≥2 members: render `<div class="group-ready-toast">N groups found — click to enter Group Mode</div>` with click handler calling `enterGroupMode()`.

**Group Mode toggle:** header button appears once groups are available. `enterGroupMode()` fetches `/api/embeddings/groups`, calls `renderGroupedGrid(clusters, singletons)`. `exitGroupMode()` restores normal via `setGridData(...)`.

**`renderGroupedGrid(clusters, singletons)`:** override `#grid` display to block. For each cluster, render `<div class="cluster-strip">` with label + horizontal row of cards (reuse card factory from `grid.js`, must export `thumbUrl`). Singletons strip at bottom. One shared IntersectionObserver for lazy-loading thumbs.

**Keyboard nav in Group Mode:** override `EVENTS.NAVIGATE` to advance within strip, then to next strip at boundary. Wrap. Gated by `EVENTS.GROUP_MODE_TOGGLED`.

**`loadSource()` integration in `main.js`:** after images load, fire-and-forget `POST /api/embeddings/ensure`. Open SSE, show pill.

### 7. CSS — `client/styles/group-mode.css` (new file, import in base.css)

```css
.embed-pill {
  font-size: 11px; font-family: var(--font-mono);
  background: var(--bg-elevated); color: var(--tan);
  padding: 3px 10px; border-radius: 99px;
  border: 1px solid var(--hairline);
  animation: pill-in 0.3s var(--ease-out);
}
.embed-pill.fading { animation: pill-out 0.4s var(--ease-out) forwards; }
@keyframes pill-in { from {opacity:0; transform:translateY(-4px);} to {opacity:1; transform:none;} }
@keyframes pill-out { to {opacity:0; transform:translateY(-4px);} }

#grid.group-mode { display: block; }
.cluster-strip { margin-bottom: 32px; }
.cluster-label {
  font-size: 10px; font-family: var(--font-mono); text-transform: uppercase;
  letter-spacing: 0.15em; color: var(--ink-dim);
  padding: 0 4px 8px;
}
.cluster-row {
  display: flex; gap: 8px; overflow-x: auto; padding-bottom: 8px;
}
.cluster-row .card {
  flex: 0 0 var(--thumb-size);
  height: calc(var(--thumb-size) * 0.667);
}

.group-ready-toast {
  position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
  background: var(--bg-elevated); border: 1px solid var(--amber);
  color: var(--ink); padding: 10px 18px; border-radius: var(--radius);
  cursor: pointer; font-size: 13px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  animation: pill-in 0.3s var(--ease-out);
  z-index: 900;
}
```

### 8. Event bus additions — `client/src/events.js`

```
EMBEDDING_STARTED:   'embedding:started',
EMBEDDING_PROGRESS:  'embedding:progress',
EMBEDDING_COMPLETE:  'embedding:complete',
GROUPS_READY:        'groups:ready',
GROUP_MODE_TOGGLED:  'groupmode:toggled',
```

### 9. Build config

In `package.json` `"build"`:

- `"asarUnpack"` — add `"electron/models/**/*"` to the existing array
- `"files"` — existing `"electron/**/*"` glob already picks up models, no change needed

`onnxruntime-node` native `.node` files live at `node_modules/onnxruntime-node/bin/` — already covered by existing `"node_modules/**/*"` in `asarUnpack`.

### 10. Performance validation — `scripts/bench-embeddings.mjs`

```js
import { ensureEmbeddings } from '../server/lib/embeddings.js';
const shootPath = process.argv[2];
const start = Date.now();
let last = 0;
await ensureEmbeddings(shootPath, ({ done, total }) => {
  if (done - last >= 50 || done === total) {
    console.log(`${done}/${total}  ${((Date.now()-start)/1000).toFixed(1)}s`);
    last = done;
  }
});
console.log(`Total: ${((Date.now()-start)/1000).toFixed(1)}s`);
```

Run against `~/Pictures/test-shoot-400/`. Target <90s.

### 11. Error modes

- **ONNX load fails** → module-scope `modelLoadFailed = true`. `/ensure` returns `{error: 'model_unavailable'}`. Client hides pill + Group Mode button. No crash.
- **Single photo fails** → try/catch in `ensureEmbeddings`, log warn, skip, continue. Retry on reopen.
- **User closes mid-embed** → SSE drops, client `onerror` updates pill to last progress then fades. On reopen, resume from disk.
- **`.shelf/` not writable** → in-memory fallback, single session only, no persistence.

### 12. Tests

- `server/test/embeddings.test.mjs` — `clusterEmbeddings` with synthetic vectors, binary format round-trip, cosine similarity helper
- `server/test/embeddings-route.test.mjs` — supertest integration: POST ensure, poll status, GET groups
- `tests/group-mode.spec.ts` — Playwright E2E: fixture shoot of 10 JPEGs → pill appears + disappears → Group Mode button → strips render → exit

### 13. Commit sequence

1. **Scaffolding** — dep, model file, build config, empty `embeddings.js` with exports
2. **Server lib** — implement embeddings.js, unit tests, bench script
3. **Server routes** — embeddings.js route file, mount in index.js, curl-test SSE
4. **Event bus + client module** — EVENTS constants, group-mode.js, pill wiring
5. **CSS + grouped layout** — group-mode.css, renderGroupedGrid, Group Mode button, E2E test
6. **Keyboard nav + polish** — group nav, tooltip, bump to v1.1.0

### 14. Risks

- Native module per-arch → stay macOS-arm64-first, file universal-binary follow-up
- Cold model load ~500ms → lazy on first `/ensure`, not on server boot
- Sharp RAW decode → prefer `extractJpeg` from thumbnails.js; libvips fallback
- 28MB in git → LFS decision during commit 1

### 15. Out of scope (explicitly)

Threshold slider · pick-best-auto · group-level batch ops · multiple models · elf gets new poses · cross-shoot grouping · embedding export · universal macOS binary

---

### Critical files to touch

- `server/lib/embeddings.js` (new)
- `server/lib/thumbnails.js` (export `extractJpeg`)
- `server/routes/embeddings.js` (new)
- `server/index.js` (mount route)
- `client/src/group-mode.js` (new)
- `client/src/events.js` (add constants)
- `client/src/main.js` (loadSource integration, Group Mode button)
- `client/src/grid.js` (export `thumbUrl`)
- `client/src/keyboard.js` (gate nav on group mode)
- `client/styles/group-mode.css` (new)
- `client/styles/base.css` (import group-mode.css)
- `electron/server-process.js` (SHELF_MODEL_PATH env var)
- `electron/models/mobileclip-s0-int8.onnx` (new asset)
- `package.json` (dep, asarUnpack, files, version)
- `scripts/bench-embeddings.mjs` (new)
- `server/test/embeddings.test.mjs` (new)
- `tests/group-mode.spec.ts` (new)

