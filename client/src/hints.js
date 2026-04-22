// Progressive depth disclosure:
// - Persistent '?' button in the corner (shortcuts overlay)
// - First-run coach marks on first image load

import { bus, EVENTS } from './events.js';

const COACH_KEY = 'shelf.coachMarksSeen.v1';

export function initHints() {
  addHelpButton();
  bus.on(EVENTS.MODE_CHANGED, ({ newMode }) => {
    if (newMode === 'card' && !localStorage.getItem(COACH_KEY)) {
      showCoachMarks();
      localStorage.setItem(COACH_KEY, '1');
    }
  });
}

function addHelpButton() {
  if (document.getElementById('help-button')) return;
  const btn = document.createElement('button');
  btn.id = 'help-button';
  btn.className = 'help-button';
  btn.textContent = '?';
  btn.title = 'Keyboard shortcuts';
  btn.addEventListener('click', () => {
    const event = new KeyboardEvent('keydown', { key: '?' });
    document.dispatchEvent(event);
  });
  document.body.appendChild(btn);
}

function showCoachMarks() {
  const coach = document.createElement('div');
  coach.className = 'coach-marks';
  const hints = [
    ['K', 'keep'],
    ['F', 'favorite'],
    ['X', 'reject'],
    ['Space', 'preview'],
    ['?', 'more'],
  ];
  hints.forEach(([key, label], i) => {
    const k = document.createElement('strong');
    k.textContent = key;
    coach.appendChild(k);
    coach.appendChild(document.createTextNode(' ' + label));
    if (i < hints.length - 1) coach.appendChild(document.createTextNode(' \u00B7 '));
  });
  document.body.appendChild(coach);

  const dismiss = () => {
    coach.classList.add('fade-out');
    setTimeout(() => coach.remove(), 500);
    document.removeEventListener('keydown', dismissOnKey);
  };
  const dismissOnKey = () => dismiss();
  document.addEventListener('keydown', dismissOnKey);
  setTimeout(dismiss, 8500);
}
