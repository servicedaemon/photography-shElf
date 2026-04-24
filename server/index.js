import express from 'express';
import cors from 'cors';
import { exiftool } from 'exiftool-vendored';
import sharp from 'sharp';
import { imageRoutes } from './routes/images.js';
import { sortingRoutes } from './routes/sorting.js';
import { metadataRoutes } from './routes/metadata.js';
import { configRoutes } from './routes/config.js';
import { convertRoutes } from './routes/convert.js';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = parseInt(process.env.PORT || '3457');

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', async (_req, res) => {
  const checks = { express: true, sharp: false, exiftool: false };
  try {
    // Verify sharp works
    await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#000' },
    })
      .jpeg()
      .toBuffer();
    checks.sharp = true;
  } catch (e) {
    console.error('sharp check failed:', e.message);
  }
  try {
    // Verify exiftool spawns
    const version = await exiftool.version();
    checks.exiftool = true;
    checks.exiftoolVersion = version;
  } catch (e) {
    console.error('exiftool check failed:', e.message);
  }

  const ok = checks.sharp && checks.exiftool;
  res.status(ok ? 200 : 503).json({ ok, checks });
});

// Mount route modules
app.use('/api', imageRoutes);
app.use('/api', sortingRoutes);
app.use('/api', metadataRoutes);
app.use('/api', configRoutes);
app.use('/api', convertRoutes);

// In production (packaged Electron), serve the Vite-built static files + SPA fallback.
if (process.env.NODE_ENV === 'production') {
  const distPath =
    process.env.SHELF_DIST_PATH ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  app.use(express.static(distPath));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log('');
  console.log('  Shelf server running at http://localhost:' + PORT);
  console.log('');
});

// Graceful shutdown — close exiftool process
process.on('SIGINT', async () => {
  await exiftool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await exiftool.end();
  process.exit(0);
});
