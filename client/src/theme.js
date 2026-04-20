// CSS custom property management

export function setThumbSize(size) {
  document.documentElement.style.setProperty('--thumb-size', size + 'px');
}

export function getThumbSize() {
  const val = getComputedStyle(document.documentElement).getPropertyValue('--thumb-size');
  return parseInt(val) || 280;
}
