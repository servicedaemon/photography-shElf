import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IMAGE_RE, countImages, hasImages, findImageFolders } from '../lib/image-discovery.js';

// Helper: write a few image files into a directory so countImages/hasImages
// return non-zero. The actual contents don't matter — only the filename
// extensions are inspected.
function writeImages(dir, names) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) {
    fs.writeFileSync(path.join(dir, name), '');
  }
}

// ─── IMAGE_RE ──────────────────────────────────────────────────────────

test('IMAGE_RE: matches all camera + delivery formats', () => {
  for (const name of [
    'IMG_0001.CR3',
    'IMG_0001.cr3',
    'IMG_0001.CR2',
    'DSC_0001.NEF',
    'DSC_0001.ARW',
    'foo.RAF',
    'bar.dng',
    'pic.JPG',
    'pic.jpeg',
    'scan.tif',
    'scan.tiff',
  ]) {
    assert.ok(IMAGE_RE.test(name), `should match ${name}`);
  }
});

test('IMAGE_RE: rejects sidecars + non-image files', () => {
  for (const name of [
    'IMG_0001.xmp',
    'IMG_0001.XMP',
    'metadata.json',
    'photo.psd',
    'thumb.heic', // not in the set yet — keeps the import surface predictable
    'video.MP4',
    'video.mov',
    'random.txt',
    '.DS_Store',
  ]) {
    assert.ok(!IMAGE_RE.test(name), `should NOT match ${name}`);
  }
});

// ─── countImages / hasImages ───────────────────────────────────────────

test('countImages: counts image files at the surface of a directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-count-'));
  try {
    writeImages(dir, ['a.CR3', 'b.cr3', 'c.JPG', 'notes.txt', '.DS_Store']);
    assert.equal(countImages(dir), 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('countImages: zero for empty / missing dirs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-count-empty-'));
  try {
    assert.equal(countImages(dir), 0);
    assert.equal(countImages(path.join(dir, 'no-such-folder')), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hasImages: short-circuits on first match', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-has-'));
  try {
    assert.equal(hasImages(dir), false);
    writeImages(dir, ['a.CR3']);
    assert.equal(hasImages(dir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── findImageFolders — the real bug fix ──────────────────────────────

// This is the scenario that broke pre-v1.5.1: user points the picker at
// /Volumes/Card/ which has DCIM/100EOS5D/ full of CR3 files. list-dir
// would surface zero folders because DCIM itself has no loose images.
test('findImageFolders: surfaces DCIM camera card layout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-dcim-'));
  try {
    const dcim = path.join(root, 'DCIM');
    const sub = path.join(dcim, '100EOS5D');
    writeImages(sub, ['IMG_0001.CR3', 'IMG_0002.CR3', 'IMG_0003.CR3']);

    const found = findImageFolders(dcim, 'DCIM', 2);
    assert.equal(found.length, 1);
    assert.equal(found[0].relName, 'DCIM/100EOS5D');
    assert.equal(found[0].path, sub);
    assert.equal(found[0].imageCount, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findImageFolders: surfaces multiple camera roll subfolders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-multi-'));
  try {
    const dcim = path.join(root, 'DCIM');
    writeImages(path.join(dcim, '100EOS5D'), ['a.CR3', 'b.CR3']);
    writeImages(path.join(dcim, '101EOS5D'), ['c.CR3']);
    writeImages(path.join(dcim, '102EOS5D'), ['d.CR3', 'e.CR3', 'f.CR3']);

    const found = findImageFolders(dcim, 'DCIM', 2);
    assert.equal(found.length, 3);
    const names = found.map((f) => f.relName).sort();
    assert.deepEqual(names, ['DCIM/100EOS5D', 'DCIM/101EOS5D', 'DCIM/102EOS5D']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findImageFolders: respects maxDepth', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-depth-'));
  try {
    // Three levels deep — should NOT be found with maxDepth=2 from root
    writeImages(path.join(root, 'a', 'b', 'c'), ['IMG.JPG']);

    const shallow = findImageFolders(root, '', 2);
    assert.equal(shallow.length, 0);

    const deep = findImageFolders(root, '', 3);
    assert.equal(deep.length, 1);
    assert.equal(deep[0].relName, 'a/b/c');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findImageFolders: skips Apple metadata trees', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-meta-'));
  try {
    // Apple's volume metadata. If we walked these on a 64GB card,
    // scan latency would noticeably degrade.
    writeImages(path.join(root, '.Spotlight-V100', 'Store'), ['weird.JPG']);
    writeImages(path.join(root, '.fseventsd'), ['junk.JPG']);
    writeImages(path.join(root, '.Trashes'), ['ghost.JPG']);
    writeImages(path.join(root, 'DCIM', '100CANON'), ['real.JPG']);

    const found = findImageFolders(root, '', 3);
    assert.equal(found.length, 1);
    assert.equal(found[0].relName, 'DCIM/100CANON');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findImageFolders: a folder with images is reported as a unit (does not recurse into it)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-unit-'));
  try {
    // The point: an image-bearing folder is a pickable unit. If a user has
    // /Photos/Shoot/ with JPGs AND /Photos/Shoot/jpeg-previews/ with more
    // JPGs, surface just /Photos/Shoot/, not both.
    writeImages(path.join(root, 'Shoot'), ['a.JPG', 'b.JPG']);
    writeImages(path.join(root, 'Shoot', 'jpeg-previews'), ['preview1.JPG']);

    const found = findImageFolders(root, '', 3);
    assert.equal(found.length, 1);
    assert.equal(found[0].relName, 'Shoot');
    assert.equal(found[0].imageCount, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findImageFolders: hidden directories skipped', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-hidden-'));
  try {
    writeImages(path.join(root, '.hidden'), ['a.JPG']);
    writeImages(path.join(root, 'visible'), ['b.JPG']);

    const found = findImageFolders(root, '', 2);
    assert.equal(found.length, 1);
    assert.equal(found[0].relName, 'visible');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findImageFolders: empty root → empty array, not crash', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-empty-'));
  try {
    assert.deepEqual(findImageFolders(root, '', 3), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findImageFolders: rootName "" produces clean relative names', () => {
  // From drives.js — pass empty rootName when the caller doesn't need
  // a prefix ("DCIM/100EOS5D" vs "/DCIM/100EOS5D").
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-rootname-'));
  try {
    writeImages(path.join(root, 'DCIM', '100EOS5D'), ['a.CR3']);

    const found = findImageFolders(root, '', 2);
    assert.equal(found[0].relName, 'DCIM/100EOS5D');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
