// CSS custom property management

export function setThumbSize(size) {
  document.documentElement.style.setProperty('--thumb-size', size + 'px');
}

export function getThumbSize() {
  const val = getComputedStyle(document.documentElement).getPropertyValue('--thumb-size');
  return parseInt(val) || 280;
}

// Theme switching — one of 'dark' | 'grey' | 'light'. Dark is the default
// (no data-theme attribute), grey/light are set via [data-theme] on <html>
// which overrides the :root CSS vars in base.css.
const VALID_THEMES = ['dark', 'grey', 'light'];

export function setTheme(theme) {
  if (!VALID_THEMES.includes(theme)) theme = 'dark';
  if (theme === 'dark') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export function getTheme() {
  return document.documentElement.dataset.theme || 'dark';
}
