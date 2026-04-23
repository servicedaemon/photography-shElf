// Spike: compare ML embedding similarity vs timestamp-based heuristic clustering
// for photo culling. Is ML worth the complexity, or does EXIF timestamp
// clustering solve most of the problem for free?
//
// Run: node scripts/spike-similarity.mjs

import { pipeline, env } from '@huggingface/transformers';
import { exiftool } from 'exiftool-vendored';
import { readdirSync } from 'fs';

env.allowLocalModels = false;
env.allowRemoteModels = true;

const JPEG_DIR = '/tmp/shelf-spike/jpegs';
const CR3_DIR = '/tmp/shelf-spike/photos';

const FILES = readdirSync(JPEG_DIR)
  .filter((f) => f.endsWith('.jpg'))
  .sort();

// Ground-truth labels based on filename conventions we set when staging photos
function groundTruth(a, b) {
  // Same burst: same "01-burst-A-*", "04-burst-B-*", or "05-burst-C-*" prefix
  const aBurst = a.match(/^(\d+-burst-[A-C])/);
  const bBurst = b.match(/^(\d+-burst-[A-C])/);
  if (aBurst && bBurst && aBurst[1] === bBurst[1]) return 'burst';

  // Same shoot inferred from EXIF session (we'll fill this from timestamps)
  return null; // resolved by timestamp analysis
}

function cosine(a, b) {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Fetch EXIF timestamps once and convert to ms-since-epoch
async function getTimestamps() {
  const ts = {};
  for (const f of FILES) {
    const cr3 = CR3_DIR + '/' + f.replace('.jpg', '.CR3');
    const tags = await exiftool.read(cr3);
    const dt = new Date(tags.DateTimeOriginal);
    const ss = parseInt(tags.SubSecTimeOriginal || '0', 10);
    ts[f] = dt.getTime() + ss * 10; // SubSec is hundredths, convert to ms
  }
  return ts;
}

// Heuristic: cluster photos if taken within `gapSec` of each other
// (chain clustering — photo A and B cluster, B and C cluster → all three cluster)
function timestampClusters(ts, gapSec) {
  const files = [...FILES].sort((a, b) => ts[a] - ts[b]);
  const clusters = [];
  let current = [files[0]];
  for (let i = 1; i < files.length; i++) {
    const dt = (ts[files[i]] - ts[files[i - 1]]) / 1000;
    if (dt <= gapSec) {
      current.push(files[i]);
    } else {
      clusters.push(current);
      current = [files[i]];
    }
  }
  clusters.push(current);
  return clusters;
}

// Embed all files with a model, measuring timings
async function embedWithModel(modelId) {
  console.log(`\n[${modelId}] loading...`);
  const loadStart = Date.now();
  const extractor = await pipeline('image-feature-extraction', modelId, { quantized: true });
  const loadMs = Date.now() - loadStart;
  console.log(`[${modelId}] loaded in ${loadMs}ms`);

  const embeddings = {};
  const embedTimes = [];
  for (const file of FILES) {
    const t0 = Date.now();
    const output = await extractor(`${JPEG_DIR}/${file}`);
    const embMs = Date.now() - t0;
    embedTimes.push(embMs);

    const dims = output.dims;
    const flat = output.data || output.tolist().flat();
    let vec;
    if (dims.length === 3) {
      vec = Array.from(flat.slice(0, dims[2])); // CLS token
    } else {
      vec = Array.from(flat);
    }
    embeddings[file] = vec;
  }
  const sumEmb = embedTimes.reduce((a, b) => a + b, 0);
  const meanEmb = sumEmb / embedTimes.length;
  const maxEmb = Math.max(...embedTimes);
  console.log(
    `[${modelId}] embed: ${sumEmb}ms total, ${meanEmb.toFixed(0)}ms mean/photo, ${maxEmb}ms max`,
  );

  return { embeddings, loadMs, sumEmb, meanEmb, maxEmb, dims: embeddings[FILES[0]].length };
}

// Cluster by ML similarity: single-pass, compare to each existing cluster's first member
function mlClusters(embeddings, threshold) {
  const files = [...FILES].sort();
  const clusters = [];
  for (const f of files) {
    let joined = false;
    for (const c of clusters) {
      if (cosine(embeddings[c[0]], embeddings[f]) >= threshold) {
        c.push(f);
        joined = true;
        break;
      }
    }
    if (!joined) clusters.push([f]);
  }
  return clusters;
}

// Score a clustering against ground-truth bursts
// Returns: precision (of cluster pairs, how many are real bursts),
//          recall (of real burst pairs, how many did we catch)
function score(clusters, name) {
  const realBurstPairs = new Set();
  const predictedPairs = new Set();

  // Real burst pairs: any two files that share the same burst prefix
  for (let i = 0; i < FILES.length; i++) {
    for (let j = i + 1; j < FILES.length; j++) {
      if (groundTruth(FILES[i], FILES[j]) === 'burst') {
        realBurstPairs.add(FILES[i] + '|' + FILES[j]);
      }
    }
  }

  // Predicted pairs: any two files in the same cluster (that has >1 member)
  for (const c of clusters) {
    if (c.length < 2) continue;
    for (let i = 0; i < c.length; i++) {
      for (let j = i + 1; j < c.length; j++) {
        const key = [c[i], c[j]].sort().join('|');
        predictedPairs.add(key);
      }
    }
  }

  const truePositive = [...predictedPairs].filter((p) => realBurstPairs.has(p)).length;
  const falsePositive = predictedPairs.size - truePositive;
  const falseNegative = realBurstPairs.size - truePositive;

  const precision = predictedPairs.size > 0 ? truePositive / predictedPairs.size : 1;
  const recall = realBurstPairs.size > 0 ? truePositive / realBurstPairs.size : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const nonSingleton = clusters.filter((c) => c.length > 1).length;
  console.log(`  ${name.padEnd(40)} clusters: ${nonSingleton}  TP: ${truePositive}  FP: ${falsePositive}  FN: ${falseNegative}  P: ${precision.toFixed(2)}  R: ${recall.toFixed(2)}  F1: ${f1.toFixed(2)}`);

  return { name, precision, recall, f1, truePositive, falsePositive, falseNegative, clusters };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('EXPANDED SIMILARITY SPIKE — test set of ' + FILES.length + ' photos');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\nTest set:');
  for (const f of FILES) console.log('  ' + f);

  // Ground truth: count real burst pairs
  let realPairs = 0;
  for (let i = 0; i < FILES.length; i++) {
    for (let j = i + 1; j < FILES.length; j++) {
      if (groundTruth(FILES[i], FILES[j]) === 'burst') realPairs++;
    }
  }
  console.log(`\nReal burst pairs (ground truth): ${realPairs}`);

  // --- Timestamp baseline ---
  console.log('\n── TIMESTAMP BASELINE ─────────────────────────────────────────');
  const ts = await getTimestamps();
  const tsResults = [];
  for (const gap of [2, 5, 10, 30, 60]) {
    const clusters = timestampClusters(ts, gap);
    const r = score(clusters, `timestamp gap ≤ ${gap}s`);
    tsResults.push(r);
  }

  // --- ML models ---
  const modelResults = [];
  const modelIds = [
    'Xenova/dinov2-small',
    // Uncomment to test base (slower, bigger):
    // 'Xenova/dinov2-base',
  ];

  for (const modelId of modelIds) {
    console.log(`\n── ML: ${modelId} ──────────────────────────────────────────`);
    try {
      const { embeddings, loadMs, meanEmb, maxEmb, dims } = await embedWithModel(modelId);
      console.log(`  dims: ${dims}`);
      console.log(`  load: ${loadMs}ms, per-photo: ${meanEmb.toFixed(0)}ms mean / ${maxEmb}ms max`);
      // Project perf: 400-photo shoot embed time
      const est400 = (meanEmb * 400) / 1000;
      console.log(`  est. 400-photo embed time (serial): ${est400.toFixed(1)}s`);

      // Test multiple thresholds
      console.log('\n  clustering results at various thresholds:');
      for (const t of [0.70, 0.75, 0.8, 0.85, 0.9, 0.95]) {
        const clusters = mlClusters(embeddings, t);
        const r = score(clusters, `dinov2 @${t}`);
        modelResults.push({ ...r, loadMs, meanEmb, maxEmb, threshold: t, model: modelId });
      }
    } catch (err) {
      console.log(`  FAILED: ${err.message}`);
    }
  }

  // --- Final verdict ---
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('VERDICT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\nBest-F1 timestamp config:');
  const bestTs = tsResults.sort((a, b) => b.f1 - a.f1)[0];
  console.log(
    `  ${bestTs.name}: P=${bestTs.precision.toFixed(2)} R=${bestTs.recall.toFixed(2)} F1=${bestTs.f1.toFixed(2)}`,
  );
  console.log('\nBest-F1 ML config:');
  const bestMl = modelResults.sort((a, b) => b.f1 - a.f1)[0];
  if (bestMl) {
    console.log(
      `  ${bestMl.name}: P=${bestMl.precision.toFixed(2)} R=${bestMl.recall.toFixed(2)} F1=${bestMl.f1.toFixed(2)}, ${bestMl.meanEmb.toFixed(0)}ms/photo`,
    );
  }

  console.log('\nFirst-principles question: does ML beat free timestamp clustering?');
  if (bestMl && bestTs) {
    if (bestMl.f1 > bestTs.f1 + 0.05) {
      console.log(`  → Yes, ML worth the complexity: ML F1 ${bestMl.f1.toFixed(2)} vs timestamp F1 ${bestTs.f1.toFixed(2)}`);
    } else if (bestTs.f1 > bestMl.f1) {
      console.log(`  → No. Timestamp clustering beats ML (${bestTs.f1.toFixed(2)} vs ${bestMl.f1.toFixed(2)}). Ship timestamp-based first.`);
    } else {
      console.log(`  → Roughly equal on THIS test set. ML may add value for retake cases not represented here.`);
    }
  }

  await exiftool.end();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
