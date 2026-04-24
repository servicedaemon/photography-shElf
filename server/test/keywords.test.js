import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeKeywords } from '../lib/keywords.js';

test('null current + add → just the additions', () => {
  assert.deepEqual(mergeKeywords(null, ['a', 'b']), ['a', 'b']);
  assert.deepEqual(mergeKeywords(undefined, ['a']), ['a']);
});

test('string current (single keyword from exiftool) is normalized to array', () => {
  // exiftool returns a string when a file has exactly one keyword
  assert.deepEqual(mergeKeywords('existing', ['new']), ['existing', 'new']);
});

test('array current is preserved + extended', () => {
  assert.deepEqual(mergeKeywords(['a', 'b'], ['c']), ['a', 'b', 'c']);
});

test('add deduplicates against existing', () => {
  assert.deepEqual(mergeKeywords(['portrait', 'studio'], ['portrait', 'new']), [
    'portrait',
    'studio',
    'new',
  ]);
});

test('remove drops a keyword that exists', () => {
  assert.deepEqual(mergeKeywords(['a', 'b', 'c'], [], ['b']), ['a', 'c']);
});

test('remove a keyword that does not exist is a no-op', () => {
  assert.deepEqual(mergeKeywords(['a', 'b'], [], ['z']), ['a', 'b']);
});

test('add and remove in the same call: remove first, then add', () => {
  // Removing 'old' THEN adding 'new' — predictable order
  assert.deepEqual(mergeKeywords(['old', 'shared'], ['new'], ['old']), ['shared', 'new']);
});

test('add the same keyword we just removed: removal wins, then re-add', () => {
  // Sequence: remove 'tag' from ['tag','x'] → ['x']; add 'tag' → ['x','tag']
  assert.deepEqual(mergeKeywords(['tag', 'x'], ['tag'], ['tag']), ['x', 'tag']);
});

test('empty add and remove returns unchanged copy', () => {
  const input = ['a', 'b', 'c'];
  const out = mergeKeywords(input);
  assert.deepEqual(out, input);
  // Should be a copy, not the same reference (so caller can't mutate ours)
  assert.notEqual(out, input);
});

test('multiple removes', () => {
  assert.deepEqual(mergeKeywords(['a', 'b', 'c', 'd'], [], ['a', 'c']), ['b', 'd']);
});

test('multiple adds with internal duplicates are deduped against next', () => {
  // 'shared' appears twice in adds — should land once after dedup
  assert.deepEqual(mergeKeywords([], ['shared', 'shared', 'other']), ['shared', 'other']);
});

test('preserves insertion order: existing first, then adds in their order', () => {
  assert.deepEqual(mergeKeywords(['x', 'y'], ['a', 'b']), ['x', 'y', 'a', 'b']);
});
