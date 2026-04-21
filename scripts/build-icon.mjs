// Rasterize the Shelf icon SVG (pixel elf peeking over a camera) to a
// 1024x1024 PNG for Electron/macOS/Windows icon generation.
//
// Uses nearest-neighbor scaling to preserve the pixel-art aesthetic.
// Adds a subtle amber "safelight" radial glow behind the pixel art
// so the final icon feels warm/darkroom at dock size.

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVG_PATH = path.join(__dirname, '..', 'electron', 'icon', 'shelf-icon.svg');
const OUT_DIR = path.join(__dirname, '..', 'electron', 'icon');
const OUT_PATH = path.join(OUT_DIR, 'source.png');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const svg = fs.readFileSync(SVG_PATH);

  // Render the pixel art at high density, then nearest-neighbor scale into
  // the inner box. INNER at 860 leaves an 82px margin on a 1024 canvas.
  const INNER = 860;
  const PAD = (1024 - INNER) / 2;

  const art = await sharp(svg, { density: 600 })
    .resize(INNER, INNER, {
      kernel: 'nearest',
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  // Background: Catppuccin-ish deep surface with a rounded square frame,
  // plus a soft amber radial "safelight" halo behind the camera's lens.
  // The halo sits lower in the frame so it reads as coming from the lens.
  const bg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
      <defs>
        <radialGradient id="safelight" cx="50%" cy="60%" r="55%">
          <stop offset="0%" stop-color="#e0a82e" stop-opacity="0.22"/>
          <stop offset="45%" stop-color="#d4a843" stop-opacity="0.06"/>
          <stop offset="100%" stop-color="#0a0a0c" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="frame" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1e1e2e"/>
          <stop offset="100%" stop-color="#11111b"/>
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="196" ry="196" fill="url(#frame)"/>
      <rect width="1024" height="1024" rx="196" ry="196" fill="url(#safelight)"/>
      <rect x="3" y="3" width="1018" height="1018" rx="194" ry="194"
            fill="none" stroke="#2a2a32" stroke-width="2" opacity="0.6"/>
    </svg>
  `);

  await sharp(bg)
    .composite([{ input: art, top: Math.round(PAD), left: Math.round(PAD) }])
    .png()
    .toFile(OUT_PATH);

  console.log('Icon written to', OUT_PATH);
}

main().catch((e) => { console.error(e); process.exit(1); });
