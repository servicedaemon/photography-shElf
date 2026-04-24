export const VALID_FILENAME = /^[\w][\w. -]*\.(cr3|cr2|arw|nef|raf|dng|jpg|jpeg|tif|tiff)$/i;

export function validateFilename(f) {
  return VALID_FILENAME.test(f) && !f.includes('..');
}
