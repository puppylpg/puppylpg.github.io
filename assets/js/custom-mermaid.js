/*
 * Chirpy 在 webfont 加载完成前就初始化 mermaid，导致 label 按 fallback
 * 字体测宽偏小，字体换上后文字被 foreignObject 裁掉。这里关掉
 * startOnLoad，等字体就绪后再渲染，让测量和显示用同一套字体。
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

  function mermaidNodes() {
    return Array.prototype.slice.call(document.querySelectorAll('.mermaid'));
  }

  /*
   * 渲染所有 .mermaid 节点。suppressErrors 让单张图的语法错误不会中断整批，
   * 否则一张图抛错会让后面的图全部停在“原始 mermaid 源码”状态。
   */
  function render() {
    var nodes = mermaidNodes();
    if (!nodes.length) return Promise.resolve();
    return mermaid
      .run({ nodes: nodes, suppressErrors: true })
      .then(fixLabelContrast, function (e) { console.error(e); });
  }

  /*
   * mermaid 渲染后会在 .mermaid 上写 data-processed 并把源码替换成 SVG，
   * 之后 run() 会跳过这些节点。要想用新字体重新测量，必须先把源码还原回去
   * 再清掉 data-processed。Chirpy 把被替换的原始代码块作为 .mermaid 的
   * previousSibling 保留着（见 post.min.js 的主题切换逻辑），这里复用同一来源。
   */
  function resetProcessed() {
    mermaidNodes().forEach(function (node) {
      if (!node.getAttribute('data-processed')) return;
      var prev = node.previousSibling;
      var source = prev && prev.children && prev.children.item(0);
      if (!source) return;
      node.textContent = source.textContent;
      node.removeAttribute('data-processed');
    });
  }

  /*
   * 冷加载（字体未缓存）时 document.fonts.ready 往往在 webfont 真正到货前就
   * resolve——因为此刻还没有任何文字触发该字体的下载，loading set 是空的。
   * 于是首屏只能用 fallback 字体测宽，等 swap 字体到货后几何就对不上了，
   * 表现为“图忽大忽小，手动刷新（命中缓存）才规整”。
   *
   * 解决办法不是去猜字体名，而是：首屏先尽快渲染一版（fallback 也行），首屏
   * 渲染本身会让浏览器请求 webfont；之后任何一次字体加载完成（loadingdone）
   * 都把已渲染的图还原成源码、按新字体重渲一遍。命中缓存时不会触发 loadingdone，
   * 自然也不会多渲。整个过程把“需要手动刷新”变成自动收敛。
   */
  function renderWhenReady() {
    var fontsReady = (document.fonts && document.fonts.ready) || Promise.resolve();
    // webfont 源（Google Fonts）可能很慢甚至挂起，不能让首屏被它劫持：最多等 2.5 秒。
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 2500); });
    Promise.race([fontsReady, timeout]).then(render);

    if (document.fonts && typeof document.fonts.addEventListener === 'function') {
      var timer = null;
      document.fonts.addEventListener('loadingdone', function () {
        if (!mermaidNodes().length) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
          resetProcessed();
          render();
        }, 150);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderWhenReady);
  } else {
    renderWhenReady();
  }
})();
