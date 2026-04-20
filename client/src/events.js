// Pub/sub event bus for decoupled module communication

class EventBus extends EventTarget {
  emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  on(name, handler) {
    const wrapper = (e) => handler(e.detail);
    this.addEventListener(name, wrapper);
    return () => this.removeEventListener(name, wrapper);
  }
}

export const bus = new EventBus();

// Event names
export const EVENTS = {
  // Data
  IMAGES_LOADED: 'images:loaded',
  STATE_CHANGED: 'state:changed',
  IMAGE_MARKED: 'image:marked',
  BATCH_MARKED: 'batch:marked',
  IMAGE_ROTATED: 'image:rotated',
  UNDO: 'undo',

  // Navigation
  SELECT: 'select',
  NAVIGATE: 'navigate',

  // UI
  MODE_CHANGED: 'mode:changed',
  FILTER_CHANGED: 'filter:changed',
  LIGHTBOX_OPEN: 'lightbox:open',
  LIGHTBOX_CLOSE: 'lightbox:close',
  SIDEBAR_TOGGLE: 'sidebar:toggle',
  SHORTCUTS_TOGGLE: 'shortcuts:toggle',
  TOAST: 'toast',

  // Actions
  STAGE_CHANGED: 'stage:changed',
  MARK_ROLLBACK: 'mark:rollback',

  // Actions
  SORT_START: 'sort:start',
  SORT_COMPLETE: 'sort:complete',
  REFRESH: 'refresh',
  CONVERT_START: 'convert:start',
  CONVERT_COMPLETE: 'convert:complete',
};
