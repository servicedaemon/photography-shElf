// Filter pills — status filtering

import { bus, EVENTS } from './events.js';
import { getImages, setFilters } from './grid.js';

let filtersEl = null;
let activeFilters = new Set(['all']);

export function initFilters() {
  filtersEl = document.getElementById('filters');

  bus.on(EVENTS.STATE_CHANGED, () => renderFilters());
  bus.on(EVENTS.IMAGE_MARKED, () => renderFilters());
  bus.on(EVENTS.BATCH_MARKED, () => renderFilters());
  // When switching shoots (or exiting), reset to 'all' so a stale filter
  // doesn't hide everything in the new folder.
  bus.on(EVENTS.MODE_CHANGED, () => {
    activeFilters = new Set(['all']);
    setFilters(activeFilters);
  });
}

function getCounts() {
  const images = getImages();
  const counts = { all: images.length, keep: 0, reject: 0, unmarked: 0, favorite: 0 };
  for (const img of images) {
    const s = img.status || 'unmarked';
    counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}

function getVisibleCount() {
  if (activeFilters.has('all')) return getCounts().all;
  const images = getImages();
  let count = 0;
  for (const img of images) {
    const s = img.status || 'unmarked';
    if (activeFilters.has(s)) count++;
  }
  return count;
}

function renderFilters() {
  if (!filtersEl) return;
  const counts = getCounts();

  const pills = ['all', 'keep', 'favorite', 'reject', 'unmarked'];

  const pillLabels = {
    all: 'All',
    keep: 'Keep',
    reject: 'Reject',
    unmarked: 'Unsorted',
    favorite: 'Favorite',
  };

  let html = '';
  for (const key of pills) {
    const active = activeFilters.has(key) ? ' active' : '';
    html += `<button class="filter-pill${active}" data-filter="${key}">`;
    html += `${pillLabels[key]} <span class="filter-count">${counts[key] || 0}</span>`;
    html += `</button>`;
  }

  const visible = getVisibleCount();
  const total = counts.all;
  if (!activeFilters.has('all') && visible !== total) {
    html += `<span class="filter-showing">Showing ${visible} of ${total}</span>`;
  }

  filtersEl.innerHTML = html;

  // Click handlers
  filtersEl.querySelectorAll('.filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const filter = pill.dataset.filter;

      if (filter === 'all') {
        activeFilters = new Set(['all']);
      } else {
        activeFilters.delete('all');
        if (activeFilters.has(filter)) {
          activeFilters.delete(filter);
          if (activeFilters.size === 0) activeFilters.add('all');
        } else {
          activeFilters.add(filter);
        }
      }

      setFilters(activeFilters);
      renderFilters();
      bus.emit(EVENTS.FILTER_CHANGED, { filters: activeFilters });
    });
  });
}
