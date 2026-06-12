/**
 * 经典页面的 3D 纵深交互（与 cyber-skin.scss 的 html.depth-on 规则配套）：
 * - 卡片随鼠标 3D 倾斜 + 眩光（仅精确指针设备）
 * - 文章元素滚动入场：从深处带透视旋转浮现
 * - 文章页顶部阅读进度光束
 * 尊重 prefers-reduced-motion：完全退化为静态页面。
 */
(function () {
  'use strict';

  if (document.documentElement.getAttribute('data-mode') !== 'dark') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var html = document.documentElement;
  html.classList.add('depth-on');

  /* ---------- 卡片 3D 倾斜 + 眩光 ---------- */
  if (window.matchMedia('(pointer: fine)').matches) {
    var MAX_TILT = 5;
    document.querySelectorAll('.card').forEach(function (card) {
      card.classList.add('tilt-card');
      card.addEventListener('pointermove', function (e) {
        var rect = card.getBoundingClientRect();
        var nx = (e.clientX - rect.left) / rect.width - 0.5;
        var ny = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform =
          'perspective(900px) rotateX(' + (-ny * MAX_TILT).toFixed(2) + 'deg)' +
          ' rotateY(' + (nx * MAX_TILT).toFixed(2) + 'deg) translateY(-3px)';
        card.style.setProperty('--gx', ((nx + 0.5) * 100).toFixed(1) + '%');
        card.style.setProperty('--gy', ((ny + 0.5) * 100).toFixed(1) + '%');
      });
      card.addEventListener('pointerleave', function () {
        card.style.transform = '';
      });
    });
  }

  /* ---------- 滚动入场 ---------- */
  var targets = document.querySelectorAll(
    '.card, main article h2, main article img, main article table, ' +
    'main article blockquote, main article .highlight'
  );
  if ('IntersectionObserver' in window && targets.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.style.transitionDelay = Math.floor(Math.random() * 150) + 'ms';
        el.classList.add('reveal-in');
        io.unobserve(el);
        el.addEventListener('transitionend', function () {
          el.classList.remove('reveal-init', 'reveal-in');
          el.style.transitionDelay = '';
        }, { once: true });
      });
    }, { rootMargin: '0px 0px -8% 0px' });

    targets.forEach(function (el) {
      var rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight) return;
      el.classList.add('reveal-init');
      io.observe(el);
    });
  }

  /* ---------- 3D 翻页过渡兜底：浏览器不支持跨页 View Transitions 时用 JS 模拟 ---------- */
  if (!('PageRevealEvent' in window)) {
    document.body.classList.add('page-arrive');
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest('a[href]');
      if (!a || a.hasAttribute('download')) return;
      if (a.target && a.target !== '_self') return;
      var url;
      try {
        url = new URL(a.getAttribute('href'), location.href);
      } catch (err) {
        return;
      }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.hash) return;
      e.preventDefault();
      document.body.classList.remove('page-arrive');
      document.body.classList.add('page-leave');
      setTimeout(function () { location.href = url.href; }, 270);
    });
    /* bfcache 回退时清掉离场状态，避免页面停在隐身帧 */
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) document.body.classList.remove('page-leave');
    });
  }

  /* ---------- 回到顶部：火箭发射 ---------- */
  var backTop = document.getElementById('back-to-top');
  if (backTop) {
    backTop.addEventListener('click', function () {
      backTop.classList.add('launching');
      setTimeout(function () {
        backTop.classList.remove('launching');
      }, 900);
    });
  }

  /* ---------- 悬浮 3D 魔方传送门 ---------- */
  if (document.getElementById('sidebar')) {
    var portal = document.createElement('a');
    portal.id = 'world-portal';
    portal.href = '/world/';
    portal.title = '进入 3D 知识图书馆';
    portal.setAttribute('aria-label', '进入 3D 知识图书馆');
    portal.innerHTML = '<span class="cube"><i></i><i></i><i></i><i></i><i></i><i></i></span>';
    document.body.appendChild(portal);
  }

  /* ---------- 阅读进度光束 ---------- */
  if (document.querySelector('main article')) {
    var bar = document.createElement('div');
    bar.id = 'reading-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    var ticking = false;
    function updateBar() {
      ticking = false;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
    }
    window.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(updateBar);
      }
    }, { passive: true });
    updateBar();
  }
})();
