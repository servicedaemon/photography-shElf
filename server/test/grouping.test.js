import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupImages } from '../lib/grouping.js';

test('empty input returns empty array', () => {
  assert.deepEqual(groupImages([]), []);
  assert.deepEqual(groupImages(undefined), []);
  assert.deepEqual(groupImages(null), []);
});

test('singletons return empty array (no groups of size 1)', () => {
  const input = [
    { filename: 'a.jpg', timestamp: 1000 },
    { filename: 'b.jpg', timestamp: 60_000 }, // 59s later, not a burst
    { filename: 'c.jpg', timestamp: 120_000 }, // 60s after b, not a burst
  ];
  assert.deepEqual(groupImages(input, 5000), []);
});

test('two photos within gap form one group', () => {
  const input = [
    { filename: 'a.jpg', timestamp: 1000 },
    { filename: 'b.jpg', timestamp: 3000 }, // 2s later
  ];
  assert.deepEqual(groupImages(input, 5000), [['a.jpg', 'b.jpg']]);
});

test('chain clustering: A-B within gap, B-C within gap → all three group', () => {
  // Total span: 8s. Neither A-C pair within 5s, but chain makes them one group.
  const input = [
    { filename: 'a.jpg', timestamp: 0 },
    { filename: 'b.jpg', timestamp: 4000 },
    { filename: 'c.jpg', timestamp: 8000 },
  ];
  assert.deepEqual(groupImages(input, 5000), [['a.jpg', 'b.jpg', 'c.jpg']]);
});

test('gap breaks chain', () => {
  const input = [
    { filename: 'a.jpg', timestamp: 0 },
    { filename: 'b.jpg', timestamp: 2000 }, // burst with a
    { filename: 'c.jpg', timestamp: 20_000 }, // too far from b, starts new potential group
    { filename: 'd.jpg', timestamp: 22_000 }, // burst with c
  ];
  assert.deepEqual(groupImages(input, 5000), [
    ['a.jpg', 'b.jpg'],
    ['c.jpg', 'd.jpg'],
  ]);
});

test('mixed bursts and singletons', () => {
  const input = [
    { filename: 'solo1.jpg', timestamp: 0 },
    { filename: 'burst1a.jpg', timestamp: 10_000 },
    { filename: 'burst1b.jpg', timestamp: 11_000 },
    { filename: 'burst1c.jpg', timestamp: 12_000 },
    { filename: 'solo2.jpg', timestamp: 50_000 },
  ];
  assert.deepEqual(groupImages(input, 5000), [['burst1a.jpg', 'burst1b.jpg', 'burst1c.jpg']]);
});

test('unsorted input is sorted internally', () => {
  const input = [
    { filename: 'later.jpg', timestamp: 3000 },
    { filename: 'first.jpg', timestamp: 1000 },
    { filename: 'middle.jpg', timestamp: 2000 },
  ];
  // Expect chronological ordering within the group
  assert.deepEqual(groupImages(input, 5000), [['first.jpg', 'middle.jpg', 'later.jpg']]);
});

test('custom gap (1s)', () => {
  const input = [
    { filename: 'a.jpg', timestamp: 0 },
    { filename: 'b.jpg', timestamp: 500 }, // 0.5s — burst
    { filename: 'c.jpg', timestamp: 3000 }, // 2.5s after b — no burst at 1s gap
  ];
  assert.deepEqual(groupImages(input, 1000), [['a.jpg', 'b.jpg']]);
});

test('skips entries with missing or non-numeric timestamp', () => {
  const input = [
    { filename: 'a.jpg', timestamp: 1000 },
    { filename: 'missing.jpg' }, // no timestamp
    { filename: 'b.jpg', timestamp: 2000 },
    { filename: 'nan.jpg', timestamp: NaN },
    { filename: 'string.jpg', timestamp: 'abc' },
  ];
  assert.deepEqual(groupImages(input, 5000), [['a.jpg', 'b.jpg']]);
});

test('exact boundary: photos exactly gapMs apart are included', () => {
  const input = [
    { filename: 'a.jpg', timestamp: 0 },
    { filename: 'b.jpg', timestamp: 5000 }, // exactly at gap
  ];
  assert.deepEqual(groupImages(input, 5000), [['a.jpg', 'b.jpg']]);
});

test('one-ms-past boundary: photos just past gapMs apart are split', () => {
  const input = [
    { filename: 'a.jpg', timestamp: 0 },
    { filename: 'b.jpg', timestamp: 5001 },
  ];
  assert.deepEqual(groupImages(input, 5000), []);
});

test('real-shoot-style data: ava burst IMG_1445/1446/1447', () => {
  // From the actual spike data: 3 frames within 2.3s
  const input = [
    { filename: 'IMG_1445.CR3', timestamp: 1741604325180 }, // 03:18:45.18
    { filename: 'IMG_1446.CR3', timestamp: 1741604325440 }, // 03:18:45.44
    { filename: 'IMG_1447.CR3', timestamp: 1741604327110 }, // 03:18:47.11
    { filename: 'IMG_1418.CR3', timestamp: 1741603305360 }, // 17 min earlier — different pose
  ];
  assert.deepEqual(groupImages(input, 5000), [['IMG_1445.CR3', 'IMG_1446.CR3', 'IMG_1447.CR3']]);
});
