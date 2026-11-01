(function () {
  function preference() {
    try {
      var state = JSON.parse(localStorage.getItem('rv-theme') || 'null');
      var value = state && state.state && (state.state.preference || state.state.theme);
      value = value || localStorage.getItem('theme');
      if (['light', 'dark', 'system'].indexOf(value) !== -1) return value;
    } catch (_) {}
    return 'system';
  }
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  function apply() {
    var value = preference();
    var theme = value === 'system' ? (media.matches ? 'dark' : 'light') : value;
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
    document.documentElement.style.colorScheme = theme;
  }
  apply();
  if (location.pathname.indexOf('/dashboard') !== 0) {
    media.addEventListener('change', apply);
    window.addEventListener('storage', apply);
  }
})();
