// Lightbox — spacebar toggle, full-window preview with marking

import { bus, EVENTS } from './events.js';
import { getImages, setSelectedIndex, previewUrl, getStackIdFor } from './grid.js';
import { markSingle } from './selection.js';

let lightboxEl = null;
let isOpen = false;
let currentIndex = -1;
let isZoomed = false;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let imgOffset = { x: 0, y: 0 };

const CYCLE = ['unmarked', 'keep', 'favorite'];

export function initLightbox() {
  lightboxEl = document.getElementById('lightbox');

  bus.on(EVENTS.LIGHTBOX_OPEN, ({ index }) => openLightbox(index));
  bus.on(EVENTS.LIGHTBOX_CLOSE, () => closeLightbox());

  // Re-render lightbox when marks change (from keyboard shortcuts)
  bus.on(EVENTS.IMAGE_MARKED, ({ index }) => {
    if (isOpen && index === currentIndex) renderLightbox();
  });

  // Reset lightbox state on source change (including Exit Shoot → idle)
  bus.on(EVENTS.MODE_CHANGED, () => {
    currentIndex = -1;
    isOpen = false;
    isZoomed = false;
    if (lightboxEl) lightboxEl.classList.remove('active', 'closing');
  });

  document.addEventListener('mousemove', handleDrag);
  document.addEventListener('mouseup', handleDragEnd);
}

function thumbUrl(filename) {
  return previewUrl(filename).replace('/preview/', '/thumb/');
}

function openLightbox(index) {
  const images = getImages();
  if (index < 0 || index >= images.length) return;

  currentIndex = index;
  isOpen = true;
  isZoomed = false;
  setSelectedIndex(index);

  renderLightbox();
  lightboxEl.classList.add('active');
}

function closeLightbox() {
  if (!lightboxEl.classList.contains('active')) return;
  isOpen = false;
  isZoomed = false;
  // Play exit animation before removing 'active' (which display:none-s it).
  lightboxEl.classList.add('closing');
  const onEnd = () => {
    lightboxEl.classList.remove('active', 'closing');
    lightboxEl.removeEventListener('animationend', onEnd);
  };
  lightboxEl.addEventListener('animationend', onEnd);
}

export function toggleLightbox() {
  if (isOpen) {
    closeLightbox();
  } else {
    const images = getImages();
    // Use current grid selection
    const idx = Math.max(0, currentIndex);
    if (images.length > 0) openLightbox(idx >= images.length ? 0 : idx);
  }
}

export function isLightboxOpen() {
  return isOpen;
}

export function navigateLightbox(delta) {
  const images = getImages();
  const newIndex = currentIndex + delta;
  if (newIndex < 0 || newIndex >= images.length) return;
  currentIndex = newIndex;
  setSelectedIndex(newIndex);
  isZoomed = false;
  renderLightbox();
}

function cycleStatus(index) {
  const images = getImages();
  const img = images[index];
  const current = img.status || 'unmarked';
  const clean = current === 'reject' ? 'unmarked' : current;
  const newStatus = CYCLE[(CYCLE.indexOf(clean) + 1) % CYCLE.length];
  markSingle(index, newStatus);
  renderLightbox();
}

function rejectStatus(index) {
  const images = getImages();
  const img = images[index];
  const current = img.status || 'unmarked';
  const newStatus = current === 'reject' ? 'unmarked' : 'reject';
  markSingle(index, newStatus);
  renderLightbox();
}

function renderLightbox() {
  const images = getImages();
  const img = images[currentIndex];
  if (!img) return;

  const status = img.status || 'unmarked';

  // Status badge
  const statusHtml =
    status !== 'unmarked' ? `<div class="lb-status ${status}">${status}</div>` : '';

  // Main image
  const pUrl = previewUrl(img.filename);
  const tUrl = thumbUrl(img.filename);

  // Bottom bar with marking controls
  const statusButtons = ['keep', 'favorite', 'reject']
    .map((s) => {
      const active = status === s ? ' active' : '';
      return `<button class="lb-mark-btn lb-mark-${s}${active}" data-status="${s}">${s}</button>`;
    })
    .join('');

  // Build filmstrip. Highlight siblings in the current stack so the user can
  // spot which nearby frames are part of the same burst while scrolling.
  const currentStackId = getStackIdFor(img.filename);
  let filmstripHtml = '<div class="filmstrip">';
  images.forEach((fi, i) => {
    const fStatus = fi.status || 'unmarked';
    const active = i === currentIndex ? ' active' : '';
    const statusClass = fStatus !== 'unmarked' ? ` ${fStatus}` : '';
    const fStackId = getStackIdFor(fi.filename);
    const siblingClass =
      currentStackId !== null && fStackId === currentStackId ? ' filmstrip-stack-sibling' : '';
    const fThumb = thumbUrl(fi.filename);
    filmstripHtml += `<img class="filmstrip-thumb${active}${statusClass}${siblingClass}" data-index="${i}" src="${fThumb}" alt="">`;
  });
  filmstripHtml += '</div>';

  lightboxEl.innerHTML = `
    ${statusHtml}
    <div class="lb-image-container">
      <img id="lb-img" src="${tUrl}" alt="" draggable="false">
    </div>
    <div class="lb-bottom-bar">
      <div class="lb-info">${img.filename} (${currentIndex + 1}/${images.length})</div>
      <div class="lb-marks">${statusButtons}</div>
    </div>
    ${filmstripHtml}
  `;

  // Progressive load: crossfade from thumb to full preview
  const lbImg = document.getElementById('lb-img');
  const hiRes = new Image();
  hiRes.onload = () => {
    if (isOpen && currentIndex === images.indexOf(img)) {
      // Fade out, swap src, fade in — smooth instead of a pop
      lbImg.style.transition = 'opacity 0.22s ease';
      lbImg.style.opacity = '0';
      setTimeout(() => {
        lbImg.src = hiRes.src;
        // Reflow then fade back in
        requestAnimationFrame(() => {
          lbImg.style.opacity = '1';
        });
      }, 120);
    }
  };
  hiRes.src = pUrl;

  // Click on image = cycle status
  lbImg.addEventListener('click', (e) => {
    if (isZoomed) return;
    if (e.metaKey) {
      rejectStatus(currentIndex);
    } else {
      cycleStatus(currentIndex);
    }
  });

  // Double-click to zoom
  lbImg.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (isZoomed) {
      lbImg.classList.remove('zoomed');
      lbImg.style.transform = '';
      isZoomed = false;
    } else {
      lbImg.classList.add('zoomed');
      isZoomed = true;
      imgOffset = { x: 0, y: 0 };
    }
  });

  // Drag to pan when zoomed
  lbImg.addEventListener('mousedown', (e) => {
    if (!isZoomed) return;
    isDragging = true;
    dragStart = { x: e.clientX - imgOffset.x, y: e.clientY - imgOffset.y };
    lbImg.classList.add('dragging');
    e.preventDefault();
  });

  // Scroll-wheel zoom
  const container = lightboxEl.querySelector('.lb-image-container');
  if (container) {
    container.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.deltaY < 0 && !isZoomed) {
          lbImg.classList.add('zoomed');
          isZoomed = true;
          imgOffset = { x: 0, y: 0 };
        } else if (e.deltaY > 0 && isZoomed) {
          lbImg.classList.remove('zoomed');
          lbImg.style.transform = '';
          isZoomed = false;
        }
      },
      { passive: false },
    );
  }

  // Mark buttons
  lightboxEl.querySelectorAll('.lb-mark-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetStatus = btn.dataset.status;
      const current = images[currentIndex].status || 'unmarked';
      const newStatus = current === targetStatus ? 'unmarked' : targetStatus;
      markSingle(currentIndex, newStatus);
      renderLightbox();
    });
  });

  // Filmstrip click
  const filmstrip = lightboxEl.querySelector('.filmstrip');
  if (filmstrip) {
    filmstrip.addEventListener('click', (e) => {
      const thumb = e.target.closest('.filmstrip-thumb');
      if (thumb) {
        const i = parseInt(thumb.dataset.index);
        currentIndex = i;
        setSelectedIndex(i);
        isZoomed = false;
        renderLightbox();
      }
    });

    // Scroll filmstrip to center current
    const activeThumb = filmstrip.querySelector('.filmstrip-thumb.active');
    if (activeThumb) {
      activeThumb.scrollIntoView({ inline: 'center', behavior: 'smooth' });
    }
  }
}

function handleDrag(e) {
  if (!isDragging || !isZoomed) return;
  const lbImg = document.getElementById('lb-img');
  if (!lbImg) return;
  imgOffset = {
    x: e.clientX - dragStart.x,
    y: e.clientY - dragStart.y,
  };
  lbImg.style.transform = `translate(${imgOffset.x}px, ${imgOffset.y}px)`;
}

function handleDragEnd() {
  isDragging = false;
  const lbImg = document.getElementById('lb-img');
  if (lbImg) lbImg.classList.remove('dragging');
}
