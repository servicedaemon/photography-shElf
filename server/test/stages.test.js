import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectStage, normalizeSubfolderRole } from '../lib/stages.js';

// ─── normalizeSubfolderRole — forgiving subfolder matcher ──────────

test('normalizeSubfolderRole: exact canonical names', () => {
  assert.equal(normalizeSubfolderRole('unsorted'), 'unsorted');
  assert.equal(normalizeSubfolderRole('keeps'), 'keeps');
  assert.equal(normalizeSubfolderRole('rejects'), 'rejects');
  assert.equal(normalizeSubfolderRole('favorites'), 'favorites');
  assert.equal(normalizeSubfolderRole('edited'), 'edited');
});

test('normalizeSubfolderRole: case-insensitive', () => {
  assert.equal(normalizeSubfolderRole('Favorites'), 'favorites');
  assert.equal(normalizeSubfolderRole('KEEPS'), 'keeps');
  assert.equal(normalizeSubfolderRole('ReJecTs'), 'rejects');
});

test('normalizeSubfolderRole: trims leading/trailing whitespace', () => {
  // Real case from a hand-renamed shoot — Finder created "Favorites "
  // with a trailing space, which broke recognition pre-v1.3.2.
  assert.equal(normalizeSubfolderRole('Favorites '), 'favorites');
  assert.equal(normalizeSubfolderRole(' keeps'), 'keeps');
  assert.equal(normalizeSubfolderRole('  unsorted  '), 'unsorted');
});

test('normalizeSubfolderRole: singular and plural variants', () => {
  assert.equal(normalizeSubfolderRole('keep'), 'keeps');
  assert.equal(normalizeSubfolderRole('reject'), 'rejects');
  assert.equal(normalizeSubfolderRole('favorite'), 'favorites');
  assert.equal(normalizeSubfolderRole('edit'), 'edited');
});

test('normalizeSubfolderRole: common abbreviations', () => {
  assert.equal(normalizeSubfolderRole('fav'), 'favorites');
  assert.equal(normalizeSubfolderRole('favs'), 'favorites');
  assert.equal(normalizeSubfolderRole('edits'), 'edited');
  assert.equal(normalizeSubfolderRole('unmarked'), 'unsorted');
});

test('normalizeSubfolderRole: returns null for non-matches', () => {
  assert.equal(normalizeSubfolderRole('something_else'), null);
  assert.equal(normalizeSubfolderRole('archive'), null);
  assert.equal(normalizeSubfolderRole(''), null);
  // Multi-word strings aren't substring-matched; only exact-after-trim matches
  // count, so "keep me" or "favorites of last week" won't false-positive.
  assert.equal(normalizeSubfolderRole('keep me'), null);
  assert.equal(normalizeSubfolderRole('favorites of last week'), null);
});

test('normalizeSubfolderRole: handles non-string input safely', () => {
  assert.equal(normalizeSubfolderRole(null), null);
  assert.equal(normalizeSubfolderRole(undefined), null);
  assert.equal(normalizeSubfolderRole(42), null);
});

/* ─── Flat sort-output paths — no fs needed, pure path detection ─── */

test('detectStage: flat Favorites - MM-YYYY - X → FINAL', () => {
  assert.equal(detectStage('/Users/ava/Pictures/sorted/Favorites - 04-2026 - Shoot'), 'FINAL');
});

test('detectStage: flat Keeps - MM-YYYY - X → HEROES', () => {
  assert.equal(detectStage('/Users/ava/Pictures/sorted/Keeps - 04-2026 - Kat x Tsuki'), 'HEROES');
});

test('detectStage: Windows trailing backslash does not break detection', () => {
  assert.equal(detectStage('C:\\Users\\ava\\Keeps - 04-2026 - X\\'), 'HEROES');
});

test('detectStage: empty path → CULL', () => {
  assert.equal(detectStage(''), 'CULL');
});

test('detectStage: non-existent arbitrary folder → CULL', () => {
  assert.equal(detectStage('/does/not/exist/random'), 'CULL');
});

/* ─── Inline shoot — stage is derived from the shoot's overall state ─── */

// Build a scratch fixture tree in os.tmpdir() that simulates different
// shoot states. Each suite creates the tree it needs, asserts, and cleans up.
function makeShoot(name, populate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `shelf-stage-test-${name}-`));
  const shoot = path.join(root, '2026-04 - Fixture');
  fs.mkdirSync(shoot);
  for (const sub of ['unsorted', 'keeps', 'favorites', 'rejects', 'edited']) {
    fs.mkdirSync(path.join(shoot, sub));
  }
  for (const [sub, count] of Object.entries(populate)) {
    for (let i = 0; i < count; i++) {
      fs.writeFileSync(path.join(shoot, sub, `IMG_${i.toString().padStart(4, '0')}.dng`), '');
    }
  }
  return { root, shoot, cleanup: () => fs.rmSync(root, { recursive: true }) };
}

test('inline shoot: only unsorted populated → CULL (from shoot root)', () => {
  const { shoot, cleanup } = makeShoot('unsorted-only', { unsorted: 3 });
  try {
    assert.equal(detectStage(shoot), 'CULL');
    assert.equal(detectStage(path.join(shoot, 'unsorted')), 'CULL');
    assert.equal(detectStage(path.join(shoot, 'keeps')), 'CULL');
    assert.equal(detectStage(path.join(shoot, 'rejects')), 'CULL');
  } finally {
    cleanup();
  }
});

test('inline shoot: keeps populated → HEROES (stage stays HEROES across sub-folders)', () => {
  const { shoot, cleanup } = makeShoot('keeps-pop', { unsorted: 2, keeps: 5 });
  try {
    assert.equal(detectStage(shoot), 'HEROES');
    assert.equal(detectStage(path.join(shoot, 'unsorted')), 'HEROES');
    assert.equal(detectStage(path.join(shoot, 'keeps')), 'HEROES');
    assert.equal(detectStage(path.join(shoot, 'rejects')), 'HEROES');
  } finally {
    cleanup();
  }
});

test('inline shoot: favorites populated → FINAL (regardless of current sub-folder)', () => {
  const { shoot, cleanup } = makeShoot('fav-pop', { keeps: 5, favorites: 2 });
  try {
    assert.equal(detectStage(shoot), 'FINAL');
    assert.equal(detectStage(path.join(shoot, 'unsorted')), 'FINAL');
    assert.equal(detectStage(path.join(shoot, 'keeps')), 'FINAL');
    assert.equal(detectStage(path.join(shoot, 'favorites')), 'FINAL');
    assert.equal(detectStage(path.join(shoot, 'rejects')), 'FINAL');
  } finally {
    cleanup();
  }
});

test('inline shoot: edited populated → FINAL', () => {
  const { shoot, cleanup } = makeShoot('edited-pop', { edited: 1 });
  try {
    assert.equal(detectStage(shoot), 'FINAL');
  } finally {
    cleanup();
  }
});

test('random folder (not inside a shoot) → CULL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-stage-test-'));
  try {
    fs.writeFileSync(path.join(root, 'a.dng'), '');
    assert.equal(detectStage(root), 'CULL');
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

// Regression test for the v1.3.2 fuzzy-matcher fix: a hand-renamed shoot
// with non-canonical sub-folder names (here "Favorites " with a trailing
// space, "Keeps " with trailing space) should still be recognized and
// stage-detected correctly. Mirrors the actual on-disk shape that bit a
// user before the normalizer landed.
test('inline shoot: detects stage via non-canonical "Favorites " (trailing space)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-stage-test-fuzzy-'));
  const shoot = path.join(root, '2026-04 - Fuzzy Fixture');
  fs.mkdirSync(shoot);
  // Subfolders with trailing whitespace + capitals — the wild form the
  // normalizer handles. Note: trailing-space folder names ARE allowed on
  // POSIX filesystems (they're not on Windows); macOS APFS preserves them.
  fs.mkdirSync(path.join(shoot, 'Keeps '));
  fs.mkdirSync(path.join(shoot, 'Favorites '));
  fs.mkdirSync(path.join(shoot, 'Rejects '));
  fs.mkdirSync(path.join(shoot, 'Unsorted'));
  // Populate Favorites — should put us at FINAL
  fs.writeFileSync(path.join(shoot, 'Favorites ', 'IMG_0001.dng'), '');
  try {
    assert.equal(detectStage(shoot), 'FINAL');
    assert.equal(detectStage(path.join(shoot, 'Keeps ')), 'FINAL');
    assert.equal(detectStage(path.join(shoot, 'Unsorted')), 'FINAL');
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test('inline shoot: singular variants ("keep", "favorite") still recognize as a shoot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-stage-test-singular-'));
  const shoot = path.join(root, 'singular shoot');
  fs.mkdirSync(shoot);
  fs.mkdirSync(path.join(shoot, 'keep'));
  fs.mkdirSync(path.join(shoot, 'favorite'));
  fs.mkdirSync(path.join(shoot, 'reject'));
  fs.writeFileSync(path.join(shoot, 'keep', 'IMG_0001.dng'), '');
  try {
    // keeps populated, no favorites/edited → HEROES
    assert.equal(detectStage(shoot), 'HEROES');
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
