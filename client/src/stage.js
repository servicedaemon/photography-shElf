// Client-side stage tracking (CULL / HEROES / FINAL)

import { bus, EVENTS } from './events.js';

let currentStage = 'CULL';

export function initStage() {
  bus.on(EVENTS.MODE_CHANGED, ({ stage }) => {
    const newStage = stage || 'CULL';
    if (newStage !== currentStage) {
      currentStage = newStage;
      bus.emit(EVENTS.STAGE_CHANGED, { stage: currentStage });
    }
  });
}

export function getStage() {
  return currentStage;
}
