import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exifToTimestamp } from '../lib/exif-cache.js';

// Regression tests for the EXIF-to-timestamp parser. The SubSecTimeOriginal
// formula had a silent bug (assumed 2-digit encoding, naive × 10) that split
// or merged bursts on cameras that emit 1- or 3-digit fractional seconds.

test('null / undefined input returns null', () => {
  assert.equal(exifToTimestamp(null), null);
  assert.equal(exifToTimestamp(undefined), null);
  assert.equal(exifToTimestamp({}), null);
});

test('missing DateTimeOriginal returns null', () => {
  assert.equal(exifToTimestamp({ SubSecTimeOriginal: '18' }), null);
});

test('DateTimeOriginal without SubSec returns whole-second timestamp', () => {
  const t = exifToTimestamp({ DateTimeOriginal: '2026-03-10T03:18:45-08:00' });
  assert.equal(t, new Date('2026-03-10T03:18:45-08:00').getTime());
});

test('2-digit SubSec "18" = 180ms', () => {
  const base = new Date('2026-03-10T03:18:45-08:00').getTime();
  const t = exifToTimestamp({
    DateTimeOriginal: '2026-03-10T03:18:45-08:00',
    SubSecTimeOriginal: '18',
  });
  assert.equal(t - base, 180);
});

test('1-digit SubSec "5" = 500ms (NOT 50ms — this was the bug)', () => {
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  const t = exifToTimestamp({
    DateTimeOriginal: '2026-01-01T00:00:00Z',
    SubSecTimeOriginal: '5',
  });
  assert.equal(t - base, 500);
});

test('3-digit SubSec "440" = 440ms (NOT 4400ms — this was the bug)', () => {
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  const t = exifToTimestamp({
    DateTimeOriginal: '2026-01-01T00:00:00Z',
    SubSecTimeOriginal: '440',
  });
  assert.equal(t - base, 440);
});

test('numeric (non-string) SubSec works', () => {
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  const t = exifToTimestamp({
    DateTimeOriginal: '2026-01-01T00:00:00Z',
    SubSecTimeOriginal: 44,
  });
  assert.equal(t - base, 440);
});

test('empty string SubSec returns whole-second timestamp', () => {
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  const t = exifToTimestamp({
    DateTimeOriginal: '2026-01-01T00:00:00Z',
    SubSecTimeOriginal: '',
  });
  assert.equal(t, base);
});

test('non-numeric SubSec is treated as zero', () => {
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  const t = exifToTimestamp({
    DateTimeOriginal: '2026-01-01T00:00:00Z',
    SubSecTimeOriginal: 'abc',
  });
  assert.equal(t, base);
});

test('invalid DateTimeOriginal returns null', () => {
  assert.equal(exifToTimestamp({ DateTimeOriginal: 'not a date', SubSecTimeOriginal: '18' }), null);
});

test('real Ava burst: IMG_1445/1446 stay 260ms apart after parsing', () => {
  // From the actual spike — frames 0.26s apart, burst-confirmed.
  const t1 = exifToTimestamp({
    DateTimeOriginal: '2026-03-10T03:18:45-08:00',
    SubSecTimeOriginal: '18',
  });
  const t2 = exifToTimestamp({
    DateTimeOriginal: '2026-03-10T03:18:45-08:00',
    SubSecTimeOriginal: '44',
  });
  assert.equal(t2 - t1, 260);
});
