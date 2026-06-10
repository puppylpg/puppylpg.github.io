/**
 * 全站星空背景：固定 canvas 上的微光闪烁星点，与 /world/ 3D 页的星空呼应。
 * 星星带深度（z），随鼠标与滚动做多层视差，营造纵深感。
 * 尊重 prefers-reduced-motion（只画静态星空），页面不可见时暂停。
 */
(function () {
  'use strict';

  if (document.documentElement.getAttribute('data-mode') !== 'dark') return;

  var canvas = document.createElement('canvas');
  canvas.id = 'starfield';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stars = [];
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var px = 0;
  var py = 0;
  var targetPx = 0;
  var targetPy = 0;

  function resize() {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    var count = Math.min(200, Math.floor(window.innerWidth * window.innerHeight / 8000));
    stars = [];
    for (var i = 0; i < count; i++) {
      var z = 0.25 + Math.random() * 0.75;
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: z,
        r: (0.3 + z * 1.2) * dpr,
        base: 0.1 + z * 0.55,
        phase: Math.random() * Math.PI * 2,
        speed: 0.0004 + Math.random() * 0.0009,
        hue: [200, 250, 290][Math.floor(Math.random() * 3)]
      });
    }
  }

  function draw(now) {
    var w = canvas.width;
    var h = canvas.height;
    px += (targetPx - px) * 0.05;
    py += (targetPy - py) * 0.05;
    var scroll = window.scrollY || 0;
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var x = (((s.x + px * s.z * 40 * dpr) % w) + w) % w;
      var y = (((s.y + py * s.z * 40 * dpr - scroll * s.z * 0.25 * dpr) % h) + h) % h;
      var a = reduced ? s.base : s.base * (0.55 + 0.45 * Math.sin(now * s.speed + s.phase));
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + s.hue + ', 80%, 80%, ' + a.toFixed(3) + ')';
      ctx.fill();
    }
  }

  var running = false;
  function loop(now) {
    if (!running) return;
    draw(now);
    requestAnimationFrame(loop);
  }
  function start() {
    if (running || reduced) return;
    running = true;
    requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
  }

  window.addEventListener('pointermove', function (e) {
    targetPx = (e.clientX / window.innerWidth - 0.5) * -2;
    targetPy = (e.clientY / window.innerHeight - 0.5) * -2;
  }, { passive: true });

  window.addEventListener('resize', function () {
    resize();
    if (reduced) draw(0);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else start();
  });

  resize();
  if (reduced) {
    draw(0);
  } else {
    start();
  }
})();
