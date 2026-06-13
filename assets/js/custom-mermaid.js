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
   * 取节点的 mermaid 源码：首选首屏渲染前缓存到 __mmdSrc 的值；没有就回退到
   * Chirpy 作为 .mermaid 的 previousSibling 保留的原始代码块（见 post.min.js 的
   * 主题切换逻辑）。重渲（换字体重测、纠越界）都要拿原始源码重画。
   */
  function sourceOf(node) {
    if (node.__mmdSrc) return node.__mmdSrc;
    var prev = node.previousSibling;
    var src = prev && prev.children && prev.children.item(0);
    return src ? src.textContent.trim() : null;
  }

  /*
   * 首屏渲染所有 .mermaid 节点。suppressErrors 让单张图的语法错误不会中断整批，
   * 否则一张图抛错会让后面的图全部停在“原始 mermaid 源码”状态。run 之前先把
   * 源码缓存起来，因为 run 会把 textContent 换成 SVG，后续重渲就拿不到源码了。
   */
  function render() {
    var nodes = mermaidNodes();
    if (!nodes.length) return Promise.resolve();
    nodes.forEach(function (node) {
      if (!node.__mmdSrc && !node.getAttribute('data-processed')) {
        node.__mmdSrc = node.textContent.trim();
      }
    });
    return mermaid
      .run({ nodes: nodes, suppressErrors: true })
      .then(fixLabelContrast, function (e) { console.error(e); });
  }

  /*
   * 重新渲染给定的若干 .mermaid 容器（换字体后重测、纠越界）。关键是“无闪烁”：用
   * mermaid.render 离屏生成新 SVG，拿到结果后再整体替换节点内容——全程不把源码塞回
   * 可见节点，因此不会像“先还原源码再 run”那样闪现一帧 mermaid 代码。
   */
  var rerenderSeq = 0;
  function rerenderContainers(containers) {
    var jobs = containers.map(function (node) {
      var src = sourceOf(node);
      if (!src) return Promise.resolve();
      return mermaid.render('mmd-rerender-' + (rerenderSeq++), src).then(function (res) {
        node.innerHTML = res.svg;
        node.setAttribute('data-processed', 'true');
        if (res.bindFunctions) res.bindFunctions(node);
      }, function (e) { console.error(e); });
    });
    return Promise.all(jobs).then(fixLabelContrast);
  }

  // 字体事件影响全部图，整页一起重渲。
  function rerenderAll() {
    return rerenderContainers(mermaidNodes());
  }

  /*
   * 节点 label 的字体是 mermaid 固定的 "trebuchet ms",verdana,arial,sans-serif，
   * 其中 CJK 没有对应字形，退到系统 sans-serif。系统字体不会触发 fonts
   * loadingdone，所以靠字体事件兜底的重渲对“中文标签”这条路是失效的：一旦最终
   * 用于绘制的字形比测宽时更宽，盒子按旧宽度定死，文字就冲出节点边框（开了
   * overflow:visible 之后表现为“字符越界”而不是被裁剪）。
   *
   * 这里不再只赌字体事件，而是渲染后直接按几何判断：找出内部存在“文字盒比形状还宽”
   * 的图，只把这些越界的图按当前真实字体无闪烁重渲。重渲后 mermaid 用当前字体重新
   * 测宽，几何自洽不再越界；加计数器封顶，避免极端情况下反复重渲。
   */
  function overflowingContainers() {
    return mermaidNodes().filter(function (container) {
      return Array.prototype.some.call(container.querySelectorAll('g.node'), function (node) {
        var shape = node.querySelector('rect, polygon, circle, ellipse, path');
        var label = node.querySelector('foreignObject div, foreignObject span, foreignObject p') ||
          node.querySelector('foreignObject');
        if (!shape || !label) return false;
        var s = shape.getBoundingClientRect();
        var l = label.getBoundingClientRect();
        // 文字盒任一侧超出形状 >1px 视为越界（留亚像素容差）
        return (l.right - s.right > 1) || (s.left - l.left > 1);
      });
    });
  }

  var healCount = 0;
  function healIfOverflow() {
    if (healCount >= 2) return;
    var bad = overflowingContainers();
    if (!bad.length) return;
    healCount++;
    rerenderContainers(bad);
  }

  // 系统字体换字形 / 布局稳定的时刻不可预测，且不一定发事件，所以渲染后在一段
  // 时间窗里多查几次是否越界，命中就自愈重渲；不越界时只是空查，无副作用。
  function scheduleHealChecks() {
    [250, 800, 1600].forEach(function (d) { setTimeout(healIfOverflow, d); });
  }

  function renderAndHeal() {
    return render().then(scheduleHealChecks);
  }

  /*
   * .mermaid 容器不是页面静态 HTML 自带的，而是 Chirpy 的 post.min.js（同样是
   * defer 脚本）在运行时把 ```mermaid 代码块替换成 <pre class="mermaid"> 后才有。
   * 本脚本、mermaid 库、webfont、post.min.js 四者的就绪顺序并不固定：冷加载时
   * 经常出现 document.fonts.ready / loadingdone 在 Chirpy 建好 .mermaid 之前就
   * 触发，此刻 render() 查到 0 个节点直接返回，而之后再没有任何字体事件来兜底
   * 重渲——表现为“偶发地只把 mermaid 源码原样打出来，刷新几次又好了”。
   *
   * 所以首屏渲染的真正前置条件是“.mermaid 容器已存在”，不能只赌字体事件。这里
   * 用 MutationObserver 等到至少出现一个 .mermaid 节点（已存在则立即返回），并配
   * 超时兜底，避免容器始终没出现时永远挂起。
   */
  function whenNodesPresent() {
    if (mermaidNodes().length) return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      var timer = null;
      function finish() {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      }
      var observer = new MutationObserver(function () {
        if (mermaidNodes().length) finish();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      timer = setTimeout(finish, 5000);
    });
  }

  /*
   * 冷加载（字体未缓存）时 document.fonts.ready 往往在 webfont 真正到货前就
   * resolve——因为此刻还没有任何文字触发该字体的下载，loading set 是空的。
   * 于是首屏只能用 fallback 字体测宽，等 swap 字体到货后几何就对不上了，
   * 表现为“图忽大忽小，手动刷新（命中缓存）才规整”。
   *
   * 解决办法不是去猜字体名，而是：等 .mermaid 容器就绪后尽快渲染一版（fallback
   * 也行），首屏渲染本身会让浏览器请求 webfont；之后任何一次字体加载完成
   * （loadingdone）都用当前字体无闪烁重渲一遍。命中缓存时不会触发 loadingdone，
   * 自然也不会多渲。整个过程把“需要手动刷新”变成自动收敛。
   */
  function renderWhenReady() {
    var fontsReady = (document.fonts && document.fonts.ready) || Promise.resolve();
    // webfont 源（Google Fonts）可能很慢甚至挂起，不能让首屏被它劫持：最多等 2.5 秒。
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 2500); });
    // 首屏渲染必须同时满足：字体就绪（或超时）且 .mermaid 容器已被 Chirpy 建好。
    Promise.all([Promise.race([fontsReady, timeout]), whenNodesPresent()]).then(renderAndHeal);

    if (document.fonts && typeof document.fonts.addEventListener === 'function') {
      var timer = null;
      document.fonts.addEventListener('loadingdone', function () {
        if (!mermaidNodes().length) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
          rerenderAll().then(scheduleHealChecks);
        }, 150);
      });
    }

    // 系统字体不发 loadingdone，整页 load 完成后再兜底查几次是否越界。
    window.addEventListener('load', scheduleHealChecks);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderWhenReady);
  } else {
    renderWhenReady();
  }
})();
