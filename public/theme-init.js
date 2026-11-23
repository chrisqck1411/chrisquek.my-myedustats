/* Runs before the page is drawn so there is no flash of the wrong theme.
   External file (not inline) because the content policy forbids inline scripts. */
(function () {
  /* Tells the stylesheet that scripts run, so the chart area is shown only when it can be drawn. */
  document.documentElement.classList.add('js');
  try {
    var saved = localStorage.getItem('mes-theme');
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = saved === 'light' || saved === 'dark' ? saved : dark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    /* storage blocked: the page falls back to the device setting through CSS */
  }
})();
