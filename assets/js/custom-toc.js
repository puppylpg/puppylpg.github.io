(function () {
  'use strict';

  function initCustomToc() {
    if (typeof tocbot === 'undefined' || !document.getElementById('toc')) {
      return;
    }

    tocbot.destroy();
    tocbot.init({
      tocSelector: '#toc',
      contentSelector: '.content',
      ignoreSelector: '[data-toc-skip]',
      headingSelector: 'h1, h2, h3',
      orderedList: false,
      scrollSmooth: false,
      collapseDepth: 3
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCustomToc);
  } else {
    initCustomToc();
  }
})();
