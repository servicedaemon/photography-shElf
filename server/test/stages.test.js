import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStage } from '../lib/stages.js';

test('detectStage: Favorites subfolder is FINAL', () => {
  assert.equal(detectStage('/Users/ava/Pictures/sorted/Keeps - 04-2026 - Shoot/Favorites'), 'FINAL');
});

test('detectStage: Favorites - MM-YYYY folder is FINAL', () => {
  assert.equal(detectStage('/Users/ava/Pictures/sorted/Favorites - 04-2026 - Shoot'), 'FINAL');
});

test('detectStage: Keeps - MM-YYYY folder is HEROES', () => {
  assert.equal(detectStage('/Users/ava/Pictures/sorted/Keeps - 04-2026 - Kat x Tsuki'), 'HEROES');
});

test('detectStage: arbitrary folder is CULL', () => {
  assert.equal(detectStage('/Users/ava/media/photography/2026-04 - Shoot/unsorted'), 'CULL');
});

test('detectStage: empty path defaults to CULL', () => {
  assert.equal(detectStage(''), 'CULL');
});

test('detectStage: trailing slash does not break detection', () => {
  assert.equal(detectStage('/some/Keeps - 04-2026 - X/'), 'HEROES');
});
