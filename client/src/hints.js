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
  coach.innerHTML = `
    <div class="coach-marks-inner">
      <strong>K</strong> keep &middot;
      <strong>F</strong> favorite &middot;
      <strong>X</strong> reject &middot;
      <strong>Space</strong> preview &middot;
      <strong>?</strong> more
    </div>
  `;
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
