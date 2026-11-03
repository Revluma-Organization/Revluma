(function () {
  if (window.RevlumaTheme) return;
  var choices = ['light', 'dark', 'system'];
  function preference() {
    try {
      var saved = JSON.parse(localStorage.getItem('rv-theme') || 'null');
      var state = saved && saved.state;
      if (state && typeof state === 'object' && !Array.isArray(state)) {
        // Modern preferences record intent; an invalid preference is not a cached colour.
        if (Object.prototype.hasOwnProperty.call(state, 'preference')) {
          return choices.indexOf(state.preference) !== -1 ? state.preference : 'system';
        }
        // Preserve the existing migration for older Zustand choices.
        if (choices.indexOf(state.theme) !== -1) return state.theme;
      }
      // The standalone next-themes cache is not an intentional Zustand choice.
      // Leave it untouched, but do not let it override automatic appearance.
    } catch (_) {}
    return 'system';
  }
  var media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function resolve(value) {
    return value === 'system' ? (media && media.matches ? 'dark' : 'light') : value;
  }
  function apply() {
    var theme = resolve(preference());
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
    document.documentElement.style.colorScheme = theme;
  }
  window.RevlumaTheme = { preference: preference, resolve: resolve };
  apply();
  // After this synchronous bootstrap, next-themes alone owns dashboard classes.
  if (document.documentElement.getAttribute('data-theme-owner') !== 'dashboard') {
    if (media && typeof media.addEventListener === 'function') media.addEventListener('change', apply);
    else if (media && typeof media.addListener === 'function') media.addListener(apply);
    window.addEventListener('storage', function (event) {
      if (event.key === null || event.key === 'rv-theme') apply();
    });
  }
})();
