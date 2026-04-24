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

// Event names — only what's actually wired.
export const EVENTS = {
  // Data
  STATE_CHANGED: 'state:changed',
  IMAGE_MARKED: 'image:marked',
  BATCH_MARKED: 'batch:marked',
  IMAGE_ROTATED: 'image:rotated',
  UNDO: 'undo',

  // Navigation + selection
  SELECT: 'select',
  SELECTION_CHANGED: 'selection:changed',

  // UI
  MODE_CHANGED: 'mode:changed',
  FILTER_CHANGED: 'filter:changed',
  LIGHTBOX_OPEN: 'lightbox:open',
  LIGHTBOX_CLOSE: 'lightbox:close',
  SIDEBAR_TOGGLE: 'sidebar:toggle',
  TOAST: 'toast',

  // Actions
  STAGE_CHANGED: 'stage:changed',
  MARK_ROLLBACK: 'mark:rollback',
  REFRESH: 'refresh',
  CONVERT_COMPLETE: 'convert:complete',
};
