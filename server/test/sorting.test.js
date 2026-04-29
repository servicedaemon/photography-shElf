// Tests for the pure helpers exported from server/routes/sorting.js.
//
// Full integration tests for /api/sort would need a real Express harness +
// fixture filesystem; those are tracked separately. This file covers the
// collision-handling logic that determines new shoot file destinations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uniqueDest } from '../routes/sorting.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-test-'));
}

test('uniqueDest: returns the plain join when no collision exists', () => {
  const dir = makeTmpDir();
  try {
    const p = uniqueDest(dir, 'IMG_1234.CR3');
    assert.equal(p, path.join(dir, 'IMG_1234.CR3'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uniqueDest: appends -2 when the original exists', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'IMG_1234.CR3'), '');
    const p = uniqueDest(dir, 'IMG_1234.CR3');
    assert.equal(p, path.join(dir, 'IMG_1234-2.CR3'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uniqueDest: walks past existing -2/-3 to the next free slot', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'pic.jpg'), '');
    fs.writeFileSync(path.join(dir, 'pic-2.jpg'), '');
    fs.writeFileSync(path.join(dir, 'pic-3.jpg'), '');
    const p = uniqueDest(dir, 'pic.jpg');
    assert.equal(p, path.join(dir, 'pic-4.jpg'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uniqueDest: handles filenames without extensions', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'README'), '');
    const p = uniqueDest(dir, 'README');
    assert.equal(p, path.join(dir, 'README-2'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uniqueDest: handles multi-dot filenames (extension is the last segment)', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'archive.tar.gz'), '');
    const p = uniqueDest(dir, 'archive.tar.gz');
    assert.equal(p, path.join(dir, 'archive.tar-2.gz'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uniqueDest: preserves original case in the suffix path', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'Photo.JPEG'), '');
    const p = uniqueDest(dir, 'Photo.JPEG');
    assert.equal(p, path.join(dir, 'Photo-2.JPEG'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Layout-detection helper sanity checks ----
//
// The /api/promote-favorites endpoint walks `path.basename(source)` plus the
// existence of peer status subfolders to decide nested vs flat. These tests
// exercise the same logic at the filesystem level so a future refactor that
// extracts the heuristic still has coverage.

function looksLikeNestedShootKeeps(sourcePath) {
  if (path.basename(sourcePath).toLowerCase() !== 'keeps') return false;
  const parent = path.dirname(sourcePath);
  if (!fs.existsSync(parent)) return false;
  return (
    fs.existsSync(path.join(parent, 'favorites')) ||
    fs.existsSync(path.join(parent, 'rejects')) ||
    fs.existsSync(path.join(parent, 'unsorted'))
  );
}

test('layout detection: nested when keeps/ has peer favorites/rejects/unsorted', () => {
  const root = makeTmpDir();
  try {
    const shoot = path.join(root, 'My Shoot');
    fs.mkdirSync(path.join(shoot, 'keeps'), { recursive: true });
    fs.mkdirSync(path.join(shoot, 'rejects'), { recursive: true });
    assert.equal(looksLikeNestedShootKeeps(path.join(shoot, 'keeps')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('layout detection: NOT nested when standalone keeps/ has no peers', () => {
  const root = makeTmpDir();
  try {
    const standalone = path.join(root, 'keeps');
    fs.mkdirSync(standalone, { recursive: true });
    assert.equal(looksLikeNestedShootKeeps(standalone), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('layout detection: NOT nested when leaf is not exactly "keeps"', () => {
  const root = makeTmpDir();
  try {
    // A flat-layout shoot folder name should NOT register as nested
    const flat = path.join(root, 'Keeps - 04-2026 - Test');
    fs.mkdirSync(flat, { recursive: true });
    assert.equal(looksLikeNestedShootKeeps(flat), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('layout detection: case-insensitive match on "keeps"', () => {
  const root = makeTmpDir();
  try {
    const shoot = path.join(root, 'Camera Roll');
    fs.mkdirSync(path.join(shoot, 'KEEPS'), { recursive: true });
    fs.mkdirSync(path.join(shoot, 'unsorted'), { recursive: true });
    assert.equal(looksLikeNestedShootKeeps(path.join(shoot, 'KEEPS')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
