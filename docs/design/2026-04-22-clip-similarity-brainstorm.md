# CLIP Similarity Grouping — Design Brainstorm

**Status:** ✅ Ava-reviewed 2026-04-23. Decisions locked below. Ready for implementation plan.
**Date:** 2026-04-22 (drafted) / 2026-04-23 (decisions)
**Goal:** Cluster near-duplicate photos so culling a 12-frame burst becomes one decision instead of twelve.

## Decisions (Ava, 2026-04-23)

1. **`.shelf/embeddings.bin` at the shoot folder root** — matches the "filesystem is the database" philosophy. Travels with the shoot, survives reinstalls. No central DB.
2. **Bundle the 28MB MobileCLIP-S0 model into the app** — no first-run download dance. DMG / EXE / AppImage / deb each grow by ~28MB, which is fine.
3. **Tooltip popup when groups detected, user opts in — not auto-on.** When embedding completes and ≥2 clusters of ≥2 photos exist, show an ambient tooltip: *"Found N groups of similar photos — switch to Group Mode?"* User clicks to enter Group Mode or dismisses. No forced layout change.
4. **Fixed 0.95 threshold for MVP.** Same-pose bursts only. Revisit after real use.
5. **Progress pill in header; elf unchanged.** A small fading-in pill like `Grouping: 145/400` appears when embedding starts and fades out when done. One sparkle animation on completion. The pixel elf stays reactive to marking actions, not background tasks.

## Three candidate approaches

**A. onnxruntime-node in Express + sidecar embeddings (recommended).**
Run MobileCLIP-S0 (INT8, ~28MB) via `onnxruntime-node` in the existing Express server. Background-embed on shoot load, gated by the same 8-concurrent semaphore as thumbnails. Results cached in `<shoot>/.shelf/embeddings.bin`. Renderer gets clusters from `/api/embeddings/groups?threshold=0.95`. Same architectural pattern as `server/lib/thumbnails.js` — compute once, cache per shoot, filesystem is the database.

**B. WASM with a hand-trained tiny NN.**
Skip CLIP entirely; hand-train a ~3MB bespoke CNN on "photographic similarity" and run in a WASM worker. Zero native deps but quality ceiling is much lower — wouldn't catch "these three are all good candidates for this look" subtlety. Not recommended.

**C. Perceptual hashing (pHash/dHash), no ML.**
Hash the 800px thumbnails `sharp` already produces; cluster by Hamming distance. ~2ms/photo, zero new deps. Catches identical bursts but misses "same vibe, different framing." Good proof-of-concept, bad long-term answer for posed/studio work.

## Recommendation: Approach A

- Same pattern as `thumbnails.js` — semaphore-gated concurrency, hash-keyed cache, generate-once
- MobileCLIP-S0 is Apple-trained on photographic data, 28MB quantized adds less than a second DMG icon
- 400 photos embed in ~60-90s on M-series; user marks the first 80 while the rest finish
- `.shelf/embeddings.bin` is portable with the shoot folder — survives reinstalls
- `onnxruntime-node` is the same class of native-module problem `sharp` already is. No new build-pipeline risk.

## MVP scope (v1.1.0)

Ships:
- Bundled MobileCLIP-S0 INT8, loaded by `onnxruntime-node` in server
- Background embedding on shoot load, 8 concurrent, resumes on reopen
- `.shelf/embeddings.bin` sidecar + progress endpoint
- Fixed threshold 0.95 (same-pose bursts)
- "Group Mode" toggle in header — replaces flat grid with grouped strips
- Per-photo marking still individual (no propagation)
- Keyboard nav wraps within strip, advances to next group

Does NOT ship:
- User-tunable threshold slider
- "Pick best automatically"
- Group-level batch marks ("mark all as reject")
- Model upgrade path in settings
- Windows/Linux CI validation (macOS first, others follow)

## Performance budget

Hard targets for a 400-photo shoot on M-series Mac:
- Embedding all 400 photos (8 concurrent workers): **under 90s**
- Clustering (160K cosine comparisons): **under 200ms**
- Toggle-to-grouped-grid render: **under 100ms** (embeddings already cached)
- Resume on reopen (re-embed only new photos after adding 10): **under 5s**

On slower machines, UI never blocks — flat grid stays usable while embedding runs in background with a progress pill.

## Open questions for Ava

1. **`.shelf/` location** — at the shoot folder root (idiomatic "filesystem is the database") or in `~/.shelf/shoots/<hash>/` (survives renames)? Shoot-root is my pick.

2. **App size** — bundling MobileCLIP-S0 adds ~28MB to every platform DMG/EXE/AppImage. Acceptable, or do you want download-on-first-use despite the worse first-run?

3. **Group Mode entry point** — persistent header toggle, keyboard shortcut (`G`?), or auto-activate when >3 groups of >2 photos detected? Auto is "magical" but could feel intrusive.

4. **Threshold** — 0.95 catches same-pose bursts. 0.90 also catches "these three are candidates for this look." Ship 0.95 first and iterate, or tune against your real shoots before deciding?

5. **Elf during embedding** — currently reactive to marking actions. Multi-minute ambient work is a new UX territory. Does she hold a magnifying glass? Blink slowly? Design this explicitly before implementation, not bolted on after.

## Next step

Ava reviews this, answers the open questions, then we write a concrete implementation plan with file-level changes. No code until green-light.
