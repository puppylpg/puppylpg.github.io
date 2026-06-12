/*
 * Chirpy 在 webfont 加载完成前就初始化 mermaid，导致 label 按 fallback
 * 字体测宽偏小，字体换上后文字被 foreignObject 裁掉。这里关掉
 * startOnLoad，等 document.fonts.ready 后再渲染，让测量和显示用同一套字体。
 */
(function () {
  if (typeof mermaid === 'undefined' || typeof mermaid.initialize !== 'function') return;

  var originalInitialize = mermaid.initialize.bind(mermaid);

  mermaid.initialize = function (config) {
    config = config || {};
    config.startOnLoad = false;
    return originalInitialize(config);
  };

  /*
   * 站点固定暗色主题，mermaid 暗色主题的文字是浅色；而文章里常用浅色填充
   * 高亮节点（style X fill:#fff3bf 等），浅底浅字几乎不可读。渲染完成后
   * 按节点填充色亮度，把浅色节点的文字换成深色。
   */
  function fixLabelContrast() {
    document.querySelectorAll('.mermaid .node, .mermaid .cluster').forEach(function (node) {
      var shape = node.querySelector('rect, polygon, circle, ellipse, path');
      if (!shape) return;
      var m = getComputedStyle(shape).fill.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
      if (!m) return;
      var luminance = 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3];
      if (luminance < 160) return;
      node.querySelectorAll('.nodeLabel, .label, text, tspan, p, span').forEach(function (label) {
        label.style.color = '#1f2937';
        label.style.fill = '#1f2937';
      });
    });
  }

  /*
   * 等字体就绪再渲染；但 webfont 源（Google Fonts）可能很慢甚至挂起，
   * 不能让图表渲染被它劫持：最多等 2.5 秒就先渲染，此时若字体后到导致
   * 个别 label 测宽略小，由 CSS 的 foreignObject overflow: visible 兜底。
   */
  function renderWhenReady() {
    var fontsReady = (document.fonts && document.fonts.ready) || Promise.resolve();
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 2500); });
    Promise.race([fontsReady, timeout]).then(function () {
      if (!document.querySelector('.mermaid')) return;
      mermaid.run().catch(console.error).then(fixLabelContrast);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderWhenReady);
  } else {
    renderWhenReady();
  }
})();
