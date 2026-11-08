(() => {
  const key = 'yzb-theme';
  const system = matchMedia('(prefers-color-scheme: light)');
  const options = ['auto', 'light', 'dark'];

  function apply() {
    const saved = localStorage.getItem(key);
    const preference = options.includes(saved) ? saved : 'auto';
    const theme = preference === 'auto' ? (system.matches ? 'light' : 'dark') : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    for (const button of document.querySelectorAll('[data-theme-option]')) {
      const selected = button.dataset.themeOption === preference;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  apply();
  system.addEventListener('change', apply);
  addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
    for (const button of document.querySelectorAll('[data-theme-option]')) {
      button.addEventListener('click', () => {
        localStorage.setItem(key, button.dataset.themeOption);
        apply();
      });
    }
    apply();
  });
})();
