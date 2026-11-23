/* Language default. Runs before the page is drawn so there is no flash of the wrong language.
   External file (not inline) because the content policy forbids inline scripts.

   Which language a visitor prefers: the language they last chose with a switch (mes-lang), else the
   first English or Malay entry in the browser's language list, else English.

   - Home page: only the bare English address "/" ever moves, and only to "/ms/". "/ms/" and every
     other address open exactly as written, so a shared link is never flipped.
   - Page-not-found: the page holds every view; this script chooses one (address prefix, then the
     preference above). Without scripts no choice is made and the page shows a language chooser. */
(function () {
  try {
    var root = document.documentElement;
    var path = location.pathname;

    var saved = null;
    try {
      saved = localStorage.getItem('mes-lang');
    } catch (e) {
      /* storage blocked: fall back to the browser's language */
    }
    if (saved !== 'en' && saved !== 'ms') saved = null;

    var wanted = saved;
    if (!wanted) {
      var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
      wanted = 'en';
      for (var i = 0; i < list.length; i++) {
        var primary = String(list[i] || '').toLowerCase().split('-')[0];
        if (primary === 'ms') {
          wanted = 'ms';
          break;
        }
        if (primary === 'en') break;
      }
    }

    if (root.hasAttribute('data-notfound')) {
      var view = /^\/ms(\/|$)/.test(path) ? 'ms' : wanted;
      root.setAttribute('data-nf', view);
      root.setAttribute('lang', view);
    } else if (path === '/' && wanted === 'ms') {
      location.replace('/ms/' + location.search + location.hash);
    }
  } catch (e) {
    /* anything unexpected: leave the page as it is */
  }
})();
