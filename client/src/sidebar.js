// Metadata sidebar

import { bus, EVENTS } from './events.js';
import { getImages, getSelectedIndex } from './grid.js';

let sidebarEl = null;
let isOpen = false;
let source = '';
let folder = '';

export function initSidebar() {
  sidebarEl = document.getElementById('sidebar');

  bus.on(EVENTS.SIDEBAR_TOGGLE, (detail) => {
    if (detail && detail.open !== undefined) {
      isOpen = detail.open;
    } else {
      isOpen = !isOpen;
    }
    sidebarEl.classList.toggle('open', isOpen);
    if (isOpen) loadMetadata();
  });

  bus.on(EVENTS.SELECT, () => {
    if (isOpen) loadMetadata();
  });

  bus.on(EVENTS.MODE_CHANGED, ({ newSource, newFolder }) => {
    source = newSource;
    folder = newFolder;
  });
}

async function loadMetadata() {
  const images = getImages();
  const index = getSelectedIndex();
  if (index < 0 || index >= images.length) {
    renderEmpty();
    return;
  }

  const img = images[index];
  const sourceParam = folder
    ? `?source=${encodeURIComponent(folder)}`
    : `?source=${encodeURIComponent(source)}`;

  try {
    const res = await fetch(`/api/metadata/${encodeURIComponent(img.filename)}${sourceParam}`);
    if (!res.ok) {
      renderEmpty('Could not load metadata');
      return;
    }
    const data = await res.json();
    renderMetadata(img.filename, data);
  } catch {
    renderEmpty('Failed to load metadata');
  }
}

function renderEmpty(msg = 'Select an image to see metadata') {
  if (!sidebarEl) return;
  sidebarEl.innerHTML = `
    <div class="sidebar-section">
      <h3>Metadata</h3>
      <p style="color: var(--text-muted); font-size: 13px;">${msg}</p>
    </div>
  `;
}

function renderMetadata(filename, data) {
  if (!sidebarEl) return;

  const cameraRows = [
    ['Make', data.camera?.make],
    ['Model', data.camera?.model],
    ['Lens', data.camera?.lens],
  ]
    .filter(([, v]) => v)
    .map(([l, v]) => `<div class="sidebar-row"><span class="label">${l}</span><span class="value">${v}</span></div>`)
    .join('');

  const exposureRows = [
    ['Shutter', data.exposure?.shutterSpeed],
    ['Aperture', data.exposure?.aperture ? `f/${data.exposure.aperture}` : null],
    ['ISO', data.exposure?.iso],
    ['Focal Length', data.exposure?.focalLength],
    ['Exposure Comp', data.exposure?.exposureComp],
    ['Metering', data.exposure?.meteringMode],
    ['White Balance', data.exposure?.whiteBalance],
  ]
    .filter(([, v]) => v != null)
    .map(([l, v]) => `<div class="sidebar-row"><span class="label">${l}</span><span class="value">${v}</span></div>`)
    .join('');

  const fileRows = [
    ['File', filename],
    ['Size', data.file?.fileSize],
    ['Dimensions', data.file?.imageWidth && data.file?.imageHeight ? `${data.file.imageWidth} x ${data.file.imageHeight}` : null],
    ['Date', data.file?.dateTime],
    ['Color Space', data.file?.colorSpace],
  ]
    .filter(([, v]) => v != null)
    .map(([l, v]) => `<div class="sidebar-row"><span class="label">${l}</span><span class="value">${v}</span></div>`)
    .join('');

  const keywords = data.tags?.keywords || [];
  const tagsHtml = keywords.length > 0
    ? keywords.map((k) => `<span class="tag">${k}<span class="remove-tag" data-tag="${k}">&times;</span></span>`).join('')
    : '<span style="color: var(--text-muted); font-size: 12px;">No tags</span>';

  sidebarEl.innerHTML = `
    <div class="sidebar-section">
      <h3>Camera</h3>
      ${cameraRows || '<div class="sidebar-row"><span class="label" style="color: var(--text-muted)">No camera data</span></div>'}
    </div>
    <div class="sidebar-section">
      <h3>Exposure</h3>
      ${exposureRows || '<div class="sidebar-row"><span class="label" style="color: var(--text-muted)">No exposure data</span></div>'}
    </div>
    <div class="sidebar-section">
      <h3>File Info</h3>
      ${fileRows}
    </div>
    <div class="sidebar-section">
      <h3>Tags</h3>
      <div class="tag-list">${tagsHtml}</div>
      <input class="tag-input" placeholder="Add tag and press Enter" id="tag-input">
    </div>
  `;

  // Tag input handler
  const tagInput = document.getElementById('tag-input');
  if (tagInput) {
    tagInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && tagInput.value.trim()) {
        const tag = tagInput.value.trim();
        await addTag(filename, tag);
        tagInput.value = '';
        loadMetadata();
      }
    });
  }

  // Remove tag handlers
  sidebarEl.querySelectorAll('.remove-tag').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tag = btn.dataset.tag;
      await removeTag(filename, tag);
      loadMetadata();
    });
  });
}

async function addTag(filename, tag) {
  const sourceParam = folder || source;
  await fetch('/api/metadata/tag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filenames: [filename],
      source: sourceParam,
      tags: { Keywords: [tag] },
    }),
  });
}

async function removeTag(filename, tag) {
  const sourceParam = folder || source;
  await fetch('/api/metadata/tag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filenames: [filename],
      source: sourceParam,
      tags: { 'Keywords-': [tag] },
    }),
  });
}
