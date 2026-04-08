// Virtualized thumbnail grid

import { bus, EVENTS } from './events.js';

let images = [];
let source = '';
let folder = '';
let mode = 'card';
let activeFilters = new Set(['all']);
let selectedIndex = -1;
let gridEl = null;
let observer = null;

export function initGrid() {
  gridEl = document.getElementById('grid');
}

export function setGridData(newImages, newSource, newFolder, newMode) {
  images = newImages;
  source = newSource;
  folder = newFolder;
  mode = newMode;
  selectedIndex = -1;
  renderGrid();
}

export function getImages() {
  return images;
}

export function getSource() {
  return source;
}

export function getSelectedIndex() {
  return selectedIndex;
}

export function setSelectedIndex(i) {
  // Deselect old
  if (selectedIndex >= 0) {
    const oldCard = gridEl.querySelector(`.card[data-index="${selectedIndex}"]`);
    if (oldCard) oldCard.classList.remove('selected');
  }
  selectedIndex = i;
  // Select new
  if (selectedIndex >= 0) {
    const newCard = gridEl.querySelector(`.card[data-index="${selectedIndex}"]`);
    if (newCard) {
      newCard.classList.add('selected');
      newCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

export function updateCardStatus(index, status) {
  if (index < 0 || index >= images.length) return;
  images[index].status = status;

  const card = gridEl.querySelector(`.card[data-index="${index}"]`);
  if (!card) return;

  // Update CSS classes
  card.classList.remove('keep', 'reject', 'favorite', 'unmarked');
  if (status !== 'unmarked') {
    card.classList.add(status);
  }

  // Update badge
  let badge = card.querySelector('.badge');
  if (status !== 'unmarked') {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'badge';
      card.appendChild(badge);
    }
    badge.textContent = status;
  } else if (badge) {
    badge.remove();
  }

  // Apply filter visibility
  applyFilterToCard(card, index);
}

export function setFilters(filters) {
  activeFilters = filters;
  applyFilters();
}

function applyFilters() {
  const cards = gridEl.querySelectorAll('.card');
  cards.forEach((card) => {
    const index = parseInt(card.dataset.index);
    applyFilterToCard(card, index);
  });
}

function applyFilterToCard(card, index) {
  if (activeFilters.has('all')) {
    card.style.display = '';
    return;
  }
  const status = images[index]?.status || 'unmarked';
  card.style.display = activeFilters.has(status) ? '' : 'none';
}

function thumbUrl(filename) {
  if (folder) {
    return `/api/folder/${encodeURIComponent(folder)}/thumb/${encodeURIComponent(filename)}`;
  }
  return `/api/thumb/${encodeURIComponent(filename)}?source=${encodeURIComponent(source)}`;
}

export function previewUrl(filename) {
  if (folder) {
    return `/api/folder/${encodeURIComponent(folder)}/preview/${encodeURIComponent(filename)}`;
  }
  return `/api/preview/${encodeURIComponent(filename)}?source=${encodeURIComponent(source)}`;
}

export function getGridColumns() {
  if (!gridEl) return 1;
  const style = getComputedStyle(gridEl);
  const cols = style.getPropertyValue('grid-template-columns').split(' ').length;
  return cols || 1;
}

function renderGrid() {
  if (!gridEl) return;
  gridEl.innerHTML = '';

  // Disconnect old observer
  if (observer) observer.disconnect();

  // Create IntersectionObserver for lazy loading
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const card = entry.target;
          const img = card.querySelector('img');
          if (img && img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
            // Remove skeleton
            const skeleton = card.querySelector('.skeleton');
            if (skeleton) {
              img.onload = () => skeleton.remove();
            }
          }
          observer.unobserve(card);
        }
      }
    },
    { rootMargin: '200px' },
  );

  const fragment = document.createDocumentFragment();

  images.forEach((img, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.index = i;

    const status = img.status || 'unmarked';
    if (status !== 'unmarked') card.classList.add(status);
    if (i === selectedIndex) card.classList.add('selected');

    // Skeleton placeholder
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton';
    card.appendChild(skeleton);

    // Image (lazy loaded)
    const imgEl = document.createElement('img');
    imgEl.dataset.src = thumbUrl(img.filename);
    imgEl.draggable = false;
    imgEl.alt = img.filename;
    card.appendChild(imgEl);

    // Label
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = img.filename;
    card.appendChild(label);

    // Badge
    if (status !== 'unmarked') {
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = status;
      card.appendChild(badge);
    }

    // Click handler
    card.addEventListener('click', (e) => {
      e.preventDefault();
      if (e.ctrlKey && !e.metaKey && !e.shiftKey) {
        // Ctrl+click: open lightbox preview
        bus.emit(EVENTS.LIGHTBOX_OPEN, { index: i });
        return;
      }
      bus.emit(EVENTS.SELECT, { index: i, meta: e.metaKey, shift: e.shiftKey });
    });

    // Apply filter
    applyFilterToCard(card, i);

    fragment.appendChild(card);
    observer.observe(card);
  });

  gridEl.appendChild(fragment);

  bus.emit(EVENTS.STATE_CHANGED, { images, mode });
}
