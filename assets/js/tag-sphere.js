/**
 * 标签页 3D 星球：把 #tags 里的标签克隆成一颗可拖拽旋转的球（斐波那契均匀分布），
 * 原扁平标签云保留在下方。点击球上的标签直接跳转。
 * 尊重 prefers-reduced-motion；标签太少时不启用。
 */
(function () {
  'use strict';

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var cloud = document.getElementById('tags');
  if (!cloud) return;
  var sources = Array.prototype.slice.call(cloud.querySelectorAll('a.tag'));
  if (sources.length < 10) return;

  /* 标签太多球面会糊成一团，只取最热的 72 个；完整标签云仍在下方 */
  var countOf = function (a) {
    return parseInt((a.querySelector('span') || {}).textContent, 10) || 1;
  };
  sources.sort(function (a, b) { return countOf(b) - countOf(a); });
  sources = sources.slice(0, 72);

  var sphere = document.createElement('div');
  sphere.id = 'tag-sphere';
  var hint = document.createElement('p');
  hint.id = 'tag-sphere-hint';
  hint.textContent = '拖动旋转星球 · 点击标签进入';
  cloud.parentNode.insertBefore(sphere, cloud);
  cloud.parentNode.insertBefore(hint, cloud);

  var items = [];
  var N = sources.length;
  var GOLDEN = Math.PI * (1 + Math.sqrt(5));
  sources.forEach(function (src, i) {
    var a = src.cloneNode(true);
    var count = countOf(a);
    a.style.fontSize = Math.min(1.35, 0.78 + Math.sqrt(count) * 0.09) + 'rem';
    sphere.appendChild(a);
    var phi = Math.acos(1 - 2 * (i + 0.5) / N);
    var theta = GOLDEN * i;
    items.push({
      el: a,
      x: Math.sin(phi) * Math.cos(theta),
      y: Math.cos(phi),
      z: Math.sin(phi) * Math.sin(theta)
    });
  });

  var R = 150;
  function resize() {
    R = Math.max(110, Math.min(sphere.clientWidth, sphere.clientHeight) / 2 - 60);
  }
  window.addEventListener('resize', resize);
  resize();

  var rx = -0.25;
  var ry = 0;
  var vx = 0;
  var vy = 0.005;
  var dragging = false;
  var lastX = 0;
  var lastY = 0;

  sphere.addEventListener('pointerdown', function (e) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    vy = (e.clientX - lastX) * 0.0022;
    vx = (e.clientY - lastY) * -0.0022;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('pointerup', function () {
    dragging = false;
  });

  function frame() {
    if (!dragging) {
      vy += (0.005 - vy) * 0.02;
      vx += (0 - vx) * 0.02;
    }
    ry += vy;
    rx += vx;
    rx = Math.max(-1.2, Math.min(1.2, rx));

    var cy = Math.cos(ry);
    var sy = Math.sin(ry);
    var cx = Math.cos(rx);
    var sx = Math.sin(rx);
    for (var i = 0; i < items.length; i++) {
      var p = items[i];
      var x1 = p.x * cy + p.z * sy;
      var z1 = -p.x * sy + p.z * cy;
      var y2 = p.y * cx - z1 * sx;
      var z2 = p.y * sx + z1 * cx;
      var k = (z2 + 2) / 3;
      p.el.style.transform =
        'translate(-50%,-50%) translate(' + (x1 * R).toFixed(1) + 'px,' +
        (y2 * R).toFixed(1) + 'px) scale(' + (0.6 + k * 0.55).toFixed(3) + ')';
      p.el.style.opacity = (0.2 + k * 0.8).toFixed(3);
      p.el.style.zIndex = Math.round(z2 * 100) + 100;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
