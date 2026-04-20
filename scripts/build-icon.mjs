// Rasterize client/public/favicon.svg to a 1024x1024 PNG for Electron icon generation.
// Uses nearest-neighbor scaling to preserve the pixel-art aesthetic.

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVG_PATH = path.join(__dirname, '..', 'client', 'public', 'favicon.svg');
const OUT_DIR = path.join(__dirname, '..', 'electron', 'icon');
const OUT_PATH = path.join(OUT_DIR, 'source.png');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const svg = fs.readFileSync(SVG_PATH);

  // The SVG is 28x24. Render to 1024 square with padding for a dock-friendly icon.
  // Use density to get crisp pixels, then scale with nearest-neighbor.
  const INNER = 800;   // elf pixels area
  const PAD = (1024 - INNER) / 2;

  const elf = await sharp(svg, { density: 600 })
    .resize(INNER, INNER, { kernel: 'nearest', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Create 1024x1024 canvas with rounded square background (Catppuccin Mocha base: #1e1e2e)
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
       <rect width="1024" height="1024" rx="180" ry="180" fill="#1e1e2e"/>
     </svg>`
  );

  await sharp(bg)
    .composite([{ input: elf, top: Math.round(PAD), left: Math.round(PAD) }])
    .png()
    .toFile(OUT_PATH);

  console.log('Icon written to', OUT_PATH);
}

main().catch(e => { console.error(e); process.exit(1); });
