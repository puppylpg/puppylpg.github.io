/*
 * 为什么需要这个脚本：
 *
 * 1) Chirpy 默认让 mermaid 自动渲染（startOnLoad），时机不在我们手里。
 * 2) mermaid 默认 label 字体是 "trebuchet ms",verdana,arial,sans-serif，里面没有
 *    中文字形，中文只能退到系统字体；而站点正文又常用 font-display:swap 的 webfont。
 *    mermaid 是“按渲染那一刻 DOM 里生效的字体测每个文字盒的宽度”，一旦测宽用的字体
 *    和最终绘制的字体对不上（webfont 晚到、或中文退到的系统字体不同），盒子就按错误
 *    宽度定死，文字要么被裁、要么冲出边框（“字符越界”）。
 *
 * 过去为此打了一堆补丁（等字体、loadingdone 重渲、几何探测越界后自愈、离屏重渲防闪
 * 烁……），都是在“事后补救测错的几何”。这里改成从根上消除“测错”的可能：
 *
 *   把 label 字体钉死成「本机一定有 + 含中文」的系统字体栈。系统字体不存在 webfont
 *   那种 swap，测宽用的字体 == 绘制用的字体，几何天然稳定，于是完全不需要任何重渲或
 *   自愈逻辑。
 *
 * 本脚本只剩三件事：
 *   1) 接管 initialize：关掉 startOnLoad（自己控制时机）、钉死 fontFamily；
 *   2) 等 Chirpy 把 ```mermaid 代码块替换成 .mermaid 容器后，渲染一次；
 *   3) 暗色主题下浅色填充节点的文字补成深色（纯可读性，与几何无关）。
 */
(function () {
  if (typeof mermaid === 'undefined' || typeof mermaid.initialize !== 'function') return;

  // 覆盖中英文的系统字体栈，不引入任何 webfont，确保“测宽字体 == 绘制字体”。
  // macOS: -apple-system / PingFang SC；Windows: Segoe UI / Microsoft YaHei；
  // Linux: Noto Sans CJK SC / Noto Sans SC；最后兜底 sans-serif（仍是系统字体，不 swap）。
  var FONT_STACK =
    '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", ' +
    '"Noto Sans CJK SC", "Noto Sans SC", sans-serif';

  /*
   * Chirpy 的 post.min.js 会调 mermaid.initialize({theme})。这里包一层，确保每次
   * 初始化（含主题切换重渲）都带上 startOnLoad:false 和我们钉死的字体，不覆盖主题。
   */
  var originalInitialize = mermaid.initialize.bind(mermaid);
  mermaid.initialize = function (config) {
    config = config || {};
    config.startOnLoad = false;
    config.fontFamily = FONT_STACK;
    config.themeVariables = config.themeVariables || {};
    config.themeVariables.fontFamily = FONT_STACK;
    return originalInitialize(config);
  };

  function mermaidNodes() {
    return Array.prototype.slice.call(document.querySelectorAll('.mermaid'));
  }

  /*
   * 站点固定暗色主题，mermaid 暗色主题文字是浅色；而文章里常用浅色填充高亮节点
   * （style X fill:#fff3bf 等），浅底浅字几乎不可读。渲染完成后按节点填充色亮度，
   * 把浅色节点的文字换成深色。
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
   * .mermaid 容器不是静态 HTML 自带的，而是 Chirpy 的 post.min.js（同样是 defer
   * 脚本）在运行时把 ```mermaid 替换成 <pre class="mermaid"> 后才有。本脚本、mermaid
   * 库、post.min.js 的就绪顺序不固定，所以渲染前必须先确认容器已存在，否则会查到 0
   * 个节点白跑一趟、又没人补渲，表现为“偶发只显示源码”。用 MutationObserver 等容器
   * 出现（已存在则立即返回），并配超时兜底，避免容器始终不出现时永远挂起。
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
   * 渲染所有 .mermaid 节点。suppressErrors 让单张图的语法错误不会中断整批，否则一张
   * 图抛错会让后面的图全部停在“原始 mermaid 源码”状态。因为字体已钉死成系统字体，
   * 这一次渲染的测宽就是最终绘制的字体，不会再有几何漂移，渲染一次即可。
   */
  function render() {
    var nodes = mermaidNodes();
    if (!nodes.length) return Promise.resolve();
    return mermaid
      .run({ nodes: nodes, suppressErrors: true })
      .then(fixLabelContrast, function (e) { console.error(e); });
  }

  function start() {
    whenNodesPresent().then(render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
