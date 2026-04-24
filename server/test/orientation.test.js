import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextOrientation } from '../lib/orientation.js';

// EXIF Orientation values:
//   1: no rotation, no flip       2: horizontal flip
//   3: 180° rotation              4: vertical flip
//   5: 90° CW + horizontal flip   6: 90° CW
//   7: 90° CCW + horizontal flip  8: 90° CCW

// Forward CW cycle through the unflipped values: 1 → 6 → 3 → 8 → 1
test('CW: 1 → 6 → 3 → 8 → 1 (unflipped cycle)', () => {
  assert.equal(nextOrientation(1, 'cw'), 6);
  assert.equal(nextOrientation(6, 'cw'), 3);
  assert.equal(nextOrientation(3, 'cw'), 8);
  assert.equal(nextOrientation(8, 'cw'), 1);
});

// CCW is the inverse: 1 → 8 → 3 → 6 → 1
test('CCW: 1 → 8 → 3 → 6 → 1 (unflipped cycle)', () => {
  assert.equal(nextOrientation(1, 'ccw'), 8);
  assert.equal(nextOrientation(8, 'ccw'), 3);
  assert.equal(nextOrientation(3, 'ccw'), 6);
  assert.equal(nextOrientation(6, 'ccw'), 1);
});

// Flipped values cycle among themselves
test('CW preserves flip parity: 2 → 7 → 4 → 5 → 2', () => {
  assert.equal(nextOrientation(2, 'cw'), 7);
  assert.equal(nextOrientation(7, 'cw'), 4);
  assert.equal(nextOrientation(4, 'cw'), 5);
  assert.equal(nextOrientation(5, 'cw'), 2);
});

test('CCW preserves flip parity: 2 → 5 → 4 → 7 → 2', () => {
  assert.equal(nextOrientation(2, 'ccw'), 5);
  assert.equal(nextOrientation(5, 'ccw'), 4);
  assert.equal(nextOrientation(4, 'ccw'), 7);
  assert.equal(nextOrientation(7, 'ccw'), 2);
});

test('CW four times returns to start (full circle)', () => {
  for (const start of [1, 2, 3, 4, 5, 6, 7, 8]) {
    let cur = start;
    for (let i = 0; i < 4; i++) cur = nextOrientation(cur, 'cw');
    assert.equal(cur, start, `start=${start} did not return after 4 CW`);
  }
});

test('CW then CCW is identity (round-trip)', () => {
  for (const start of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const cw = nextOrientation(start, 'cw');
    const back = nextOrientation(cw, 'ccw');
    assert.equal(back, start, `start=${start} did not survive CW+CCW`);
  }
});

test('undefined / non-numeric current value defaults to 1 (identity)', () => {
  assert.equal(nextOrientation(undefined, 'cw'), 6);
  assert.equal(nextOrientation(null, 'cw'), 6);
  assert.equal(nextOrientation('not a number', 'cw'), 6);
});

test('out-of-range numeric value falls back to 1', () => {
  assert.equal(nextOrientation(99, 'cw'), 1);
  assert.equal(nextOrientation(0, 'cw'), 1);
});
