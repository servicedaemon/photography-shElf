// EXIF orientation transitions.
//
// EXIF Orientation is an enum of 8 values combining rotation + mirroring:
//   1 = no rotation, no flip
//   2 = horizontal flip
//   3 = 180° rotation
//   4 = vertical flip
//   5 = 90° CW + horizontal flip
//   6 = 90° CW
//   7 = 90° CCW + horizontal flip
//   8 = 90° CCW
//
// Rotating clockwise advances 1 → 6 → 3 → 8 → 1, with the flipped variants
// (2, 7, 4, 5) cycling among themselves. CCW is the reverse.

const CW_MAP = { 1: 6, 6: 3, 3: 8, 8: 1, 2: 7, 7: 4, 4: 5, 5: 2 };
const CCW_MAP = { 1: 8, 8: 3, 3: 6, 6: 1, 2: 5, 5: 4, 4: 7, 7: 2 };

// Compute the next Orientation value given a current one and a rotation
// direction ('cw' | 'ccw'). Returns 1 (identity) for any unknown current
// value — safe default for files with malformed Orientation.
export function nextOrientation(current, direction) {
  const map = direction === 'cw' ? CW_MAP : CCW_MAP;
  const num = typeof current === 'number' ? current : 1;
  return map[num] || 1;
}
