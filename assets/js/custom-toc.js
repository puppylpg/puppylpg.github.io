(function () {
  'use strict';

  // Chirpy v7 bundles tocbot via Rollup; tocbot.init() is called internally.
  // We use tocbot.refresh() in a setTimeout to override after the internal init runs.
  function initCustomToc() {
    if (typeof tocbot === 'undefined' || !document.getElementById('toc')) {
      return;
    }
    setTimeout(function () {
      tocbot.refresh({
        tocSelector: '#toc',
        contentSelector: '.content',
        ignoreSelector: '[data-toc-skip]',
        headingSelector: 'h1, h2, h3',
        orderedList: false,
        scrollSmooth: false,
        collapseDepth: 3
      });
    }, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCustomToc);
  } else {
    initCustomToc();
  }
})();
