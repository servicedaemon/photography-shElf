import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectStage } from '../lib/stages.js';

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
  } finally { cleanup(); }
});

test('inline shoot: keeps populated → HEROES (stage stays HEROES across sub-folders)', () => {
  const { shoot, cleanup } = makeShoot('keeps-pop', { unsorted: 2, keeps: 5 });
  try {
    assert.equal(detectStage(shoot), 'HEROES');
    assert.equal(detectStage(path.join(shoot, 'unsorted')), 'HEROES');
    assert.equal(detectStage(path.join(shoot, 'keeps')), 'HEROES');
    assert.equal(detectStage(path.join(shoot, 'rejects')), 'HEROES');
  } finally { cleanup(); }
});

test('inline shoot: favorites populated → FINAL (regardless of current sub-folder)', () => {
  const { shoot, cleanup } = makeShoot('fav-pop', { keeps: 5, favorites: 2 });
  try {
    assert.equal(detectStage(shoot), 'FINAL');
    assert.equal(detectStage(path.join(shoot, 'unsorted')), 'FINAL');
    assert.equal(detectStage(path.join(shoot, 'keeps')), 'FINAL');
    assert.equal(detectStage(path.join(shoot, 'favorites')), 'FINAL');
    assert.equal(detectStage(path.join(shoot, 'rejects')), 'FINAL');
  } finally { cleanup(); }
});

test('inline shoot: edited populated → FINAL', () => {
  const { shoot, cleanup } = makeShoot('edited-pop', { edited: 1 });
  try {
    assert.equal(detectStage(shoot), 'FINAL');
  } finally { cleanup(); }
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
