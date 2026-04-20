import path from 'path';
import fs from 'fs';
import os from 'os';

// Config directory
const CONFIG_DIR =
  process.platform === 'win32'
    ? path.join(process.env.APPDATA || os.homedir(), 'shelf')
    : path.join(os.homedir(), '.shelf');

const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const STATE_DIR = path.join(CONFIG_DIR, 'states');

fs.mkdirSync(CONFIG_DIR, { recursive: true });
fs.mkdirSync(STATE_DIR, { recursive: true });

// --- Config ---

let configCache = null;

export function getConfig() {
  if (configCache) return configCache;

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      configCache = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return configCache;
    } catch {
      /* corrupted config, use defaults */
    }
  }

  configCache = {
    sortDir: path.join(os.homedir(), 'Pictures/sorted'),
    thumbSize: 280,
  };
  return configCache;
}

export function setConfig(config) {
  configCache = config;
  atomicWrite(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// --- Per-source sorting state ---

function stateFileFor(source) {
  // Hash the source path to create a unique state file
  const safeName = Buffer.from(source || 'default').toString('base64url').slice(0, 40);
  return path.join(STATE_DIR, `${safeName}.json`);
}

export function getState(source) {
  const file = stateFileFor(source);
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

// Debounced write
const writePending = new Map();

export function setState(source, state) {
  const file = stateFileFor(source);

  // Clear any pending write for this source
  if (writePending.has(source)) {
    clearTimeout(writePending.get(source));
  }

  // Write with a short debounce to batch rapid marks
  writePending.set(
    source,
    setTimeout(() => {
      atomicWrite(file, JSON.stringify(state, null, 2));
      writePending.delete(source);
    }, 100),
  );

  // Also write immediately for first call (ensures no data loss on crash)
  if (!writePending.has(source + '_initial')) {
    atomicWrite(file, JSON.stringify(state, null, 2));
    writePending.set(source + '_initial', true);
    setTimeout(() => writePending.delete(source + '_initial'), 200);
  }
}

// --- Undo stack ---

const undoStack = [];
const MAX_UNDO = 50;

export function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) {
    undoStack.shift();
  }
}

export function popUndo() {
  return undoStack.pop() || null;
}

// --- Atomic file writes ---

function atomicWrite(filePath, data) {
  const tmpFile = filePath + '.tmp';
  fs.writeFileSync(tmpFile, data);
  fs.renameSync(tmpFile, filePath);
}
