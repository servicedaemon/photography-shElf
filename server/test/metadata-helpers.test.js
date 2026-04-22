import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateTime } from '../routes/metadata.js';

test('formatDateTime: null → null', () => {
  assert.equal(formatDateTime(null), null);
});

test('formatDateTime: undefined → null', () => {
  assert.equal(formatDateTime(undefined), null);
});

test('formatDateTime: string passes through unchanged', () => {
  assert.equal(formatDateTime('2026:04:22 14:30:00'), '2026:04:22 14:30:00');
});

test('formatDateTime: ExifDateTime-like object → uses toString()', () => {
  // exiftool-vendored returns an ExifDateTime instance with a custom toString()
  // that produces the photographer-idiomatic "YYYY:MM:DD HH:MM:SS±ZZ:ZZ" format.
  const exifDateTime = {
    year: 2026,
    month: 4,
    day: 22,
    hour: 14,
    minute: 30,
    second: 0,
    toString() {
      return '2026:04:22 14:30:00-07:00';
    },
  };
  assert.equal(formatDateTime(exifDateTime), '2026:04:22 14:30:00-07:00');
});
