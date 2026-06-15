/**
 * 3D 知识图书馆：每个分类是一座（或几座）书架，每篇文章是一本书。
 * 数据由 _layouts/3d.html 里的 #world-data JSON 注入。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DATA = JSON.parse(document.getElementById('world-data').textContent);

/* ---------- 书架尺寸常量 ---------- */
const ROWS = 5;          // 每座书架的层数
const ROW_H = 1.25;      // 层高
const BAY_W = 5.0;       // 书架外宽
const INNER_W = BAY_W - 0.4;
const DEPTH = 0.85;      // 书架进深
const BASE_Y = 0.5;      // 最底层书的底面高度
const BAY_H = BASE_Y + ROWS * ROW_H + 0.18;
const BAY_GAP = 0.45;    // 同分类相邻书架间隙
const GROUP_GAP = 2.2;   // 分类之间的间隙
const ARC_SPAN = Math.PI * 1.25; // 书架墙占用的弧度，开口朝向初始相机

/* ---------- 基础场景 ---------- */
const canvas = document.getElementById('world-canvas');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  const loader = document.getElementById('loader');
  loader.innerHTML = '<p>你的浏览器不支持 WebGL，<a href="' + DATA.site.home + '" style="color:#7dd3fc">返回经典版</a></p>';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.FogExp2(0x05070d, 0.011);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = 1.52;
controls.minDistance = 2;
controls.screenSpacePanning = false;
controls.target.set(0, 3, 0);

/* ---------- 灯光 ---------- */
scene.add(new THREE.HemisphereLight(0x8899cc, 0x1a2030, 0.9));
const dirLight = new THREE.DirectionalLight(0xeef2ff, 1.4);
dirLight.position.set(12, 26, 14);
scene.add(dirLight);
const centerLight = new THREE.PointLight(0x88bbff, 90, 50, 1.8);
centerLight.position.set(0, 5, 0);
scene.add(centerLight);

/* ---------- 简易补间动画系统 ---------- */
const tweens = new Set();
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function tween({ dur = 600, ease = easeOutCubic, onUpdate, onDone }) {
  const tw = { t0: performance.now(), dur, ease, onUpdate, onDone };
  tweens.add(tw);
  return tw;
}
function stepTweens(now) {
  for (const tw of tweens) {
    const k = Math.min(1, (now - tw.t0) / tw.dur);
    tw.onUpdate(tw.ease(k));
    if (k >= 1) {
      tweens.delete(tw);
      if (tw.onDone) tw.onDone();
    }
  }
}

/* ---------- 文字贴图工具 ---------- */
function makeSprite(draw, w, h, scale) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(scale * (w / h), scale, 1);
  return sp;
}

function makeSpineTexture(title, date, color) {
  const w = 128;
  const h = 512;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');

  const base = new THREE.Color(color);
  const jitter = (Math.random() - 0.5) * 0.12;
  const hsl = {};
  base.getHSL(hsl);
  const c1 = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.95), Math.max(0.12, hsl.l * 0.55 + jitter));
  const c2 = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.8), Math.max(0.08, hsl.l * 0.32 + jitter));
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#' + c1.getHexString());
  grad.addColorStop(1, '#' + c2.getHexString());
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(0, 14, w, 3);
  ctx.fillRect(0, h - 17, w, 3);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '500 42px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 4;
  let t = title;
  const maxW = h - 130;
  if (ctx.measureText(t).width > maxW) {
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    t += '…';
  }
  ctx.fillText(t, -28, 0);
  ctx.font = '300 22px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(date || '', (h - 130) / 2 + 36, 0);
  ctx.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ---------- 地面、星空、中央纪念碑 ---------- */
function buildEnvironment(radius) {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(radius + 50, 64),
    new THREE.MeshStandardMaterial({ color: 0x0a0d16, roughness: 1, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const grid = new THREE.PolarGridHelper(radius + 8, 16, 8, 64, 0x1c2440, 0x141a2e);
  grid.position.y = 0.02;
  scene.add(grid);

  const starCount = 1800;
  const pos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 70 + Math.random() * 120;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.95);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi) + 2;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0x9fb6e0, size: 0.7, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  scene.add(stars);

  const monument = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x101524, emissive: 0x7dd3fc, emissiveIntensity: 0.5, wireframe: true })
  );
  core.position.y = 3.4;
  monument.add(core);
  const inner = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.85, 1),
    new THREE.MeshStandardMaterial({ color: 0x0c1120, emissive: 0xc4b5fd, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 })
  );
  inner.position.y = 3.4;
  monument.add(inner);

  const ringMat1 = new THREE.MeshStandardMaterial({ color: 0x0c1120, emissive: 0x7dd3fc, emissiveIntensity: 1.6 });
  const ringMat2 = new THREE.MeshStandardMaterial({ color: 0x0c1120, emissive: 0xc4b5fd, emissiveIntensity: 1.6 });
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.035, 12, 96), ringMat1);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.03, 12, 96), ringMat2);
  ring1.position.y = 3.4;
  ring2.position.y = 3.4;
  ring1.rotation.x = 1.2;
  ring2.rotation.x = 2.0;
  monument.add(ring1, ring2);

  const title = makeSprite((ctx) => {
    ctx.textAlign = 'center';
    ctx.font = '700 120px "Segoe UI", sans-serif';
    const grad = ctx.createLinearGradient(150, 0, 880, 0);
    grad.addColorStop(0, '#7dd3fc');
    grad.addColorStop(0.5, '#c4b5fd');
    grad.addColorStop(1, '#f0abfc');
    ctx.fillStyle = grad;
    ctx.shadowColor = '#7dd3fc';
    ctx.shadowBlur = 28;
    ctx.fillText(DATA.site.title.toUpperCase(), 512, 150);
    ctx.shadowBlur = 0;
    ctx.font = '300 38px sans-serif';
    ctx.fillStyle = '#8fa3c8';
    ctx.fillText(DATA.site.tagline, 512, 230);
  }, 1024, 280, 2.4);
  title.position.y = 7.6;
  monument.add(title);
  scene.add(monument);

  return { stars, core, inner, ring1, ring2, title };
}

/* ---------- 把文章打包进书架（贪心装箱） ---------- */
function packCollection(items) {
  const bays = [];
  let rows = null;
  let row = null;
  let cursor = 0;
  const newRow = () => {
    if (!rows || rows.length === ROWS) {
      rows = [];
      bays.push(rows);
    }
    row = [];
    rows.push(row);
    cursor = -INNER_W / 2;
  };
  newRow();
  for (const item of items) {
    const w = 0.3 + Math.random() * 0.13;
    if (cursor + w > INNER_W / 2) newRow();
    row.push({ item, w, h: 0.82 + Math.random() * 0.24, x: cursor + w / 2 });
    cursor += w + 0.045;
  }
  return bays;
}

/* ---------- 建一座书架 ---------- */
const frameMat = new THREE.MeshStandardMaterial({ color: 0x232636, roughness: 0.85, metalness: 0.15 });
const bookGeo = new THREE.BoxGeometry(1, 1, 1);
const books = [];

function buildBay(rows, colData, sideMats) {
  const g = new THREE.Group();

  const backMat = new THREE.MeshStandardMaterial({
    color: 0x161a28, roughness: 0.9,
    emissive: new THREE.Color(colData.color), emissiveIntensity: 0.07
  });
  const back = new THREE.Mesh(new THREE.BoxGeometry(BAY_W, BAY_H, 0.06), backMat);
  back.position.set(0, BAY_H / 2, -DEPTH / 2);
  g.add(back);

  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.14, BAY_H, DEPTH), frameMat);
    side.position.set(sx * (BAY_W - 0.14) / 2, BAY_H / 2, 0);
    g.add(side);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(BAY_W, 0.14, DEPTH), frameMat);
  top.position.set(0, BAY_H - 0.07, 0);
  g.add(top);

  for (let r = 0; r <= Math.min(rows.length, ROWS); r++) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(BAY_W - 0.2, 0.08, DEPTH), frameMat);
    board.position.set(0, BASE_Y + r * ROW_H - 0.06, 0);
    g.add(board);
  }

  rows.forEach((rowBooks, r) => {
    const rowBottom = BASE_Y + r * ROW_H;
    for (const b of rowBooks) {
      const spineTex = makeSpineTexture(b.item.t, b.item.d, colData.color);
      const spineMat = new THREE.MeshStandardMaterial({
        map: spineTex, emissiveMap: spineTex,
        emissive: 0xffffff, emissiveIntensity: 0,
        roughness: 0.7
      });
      const side = sideMats[Math.floor(Math.random() * sideMats.length)];
      const mesh = new THREE.Mesh(bookGeo, [side, side, side, side, spineMat, side]);
      mesh.scale.set(b.w, b.h, 0.62);
      mesh.position.set(b.x, rowBottom + b.h / 2, 0.04);
      mesh.userData = {
        url: b.item.u, title: b.item.t, date: b.item.d,
        color: colData.color, baseZ: 0.04, spineMat
      };
      g.add(mesh);
      books.push(mesh);
    }
  });
  return g;
}

/* ---------- 布置整个世界 ---------- */
const packed = DATA.collections.map((c) => ({ col: c, bays: packCollection(c.items) }));
const totalBays = packed.reduce((s, p) => s + p.bays.length, 0);
const arcLen = totalBays * (BAY_W + BAY_GAP) + (packed.length - 1) * GROUP_GAP;
const RADIUS = Math.max(14, arcLen / ARC_SPAN);

const collectionAnchors = [];
{
  let walked = 0;
  const startTheta = Math.PI - ARC_SPAN / 2;
  for (const p of packed) {
    const sideMats = [0.0, 0.06, -0.06, 0.1].map((dl) => {
      const hsl = {};
      new THREE.Color(p.col.color).getHSL(hsl);
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hsl.h, hsl.s * 0.6, Math.max(0.08, hsl.l * 0.3 + dl)),
        roughness: 0.8
      });
    });
    const groupStart = walked;
    p.bays.forEach((rows) => {
      const theta = startTheta + (walked + BAY_W / 2) / RADIUS;
      const bay = buildBay(rows, p.col, sideMats);
      bay.position.set(RADIUS * Math.sin(theta), 0, RADIUS * Math.cos(theta));
      bay.rotation.y = theta + Math.PI;
      scene.add(bay);
      walked += BAY_W + BAY_GAP;
    });
    const midTheta = startTheta + (groupStart + (walked - groupStart - BAY_GAP) / 2) / RADIUS;
    const dir = new THREE.Vector3(Math.sin(midTheta), 0, Math.cos(midTheta));

    const sign = makeSprite((ctx) => {
      ctx.textAlign = 'center';
      ctx.font = '700 92px "Segoe UI", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = p.col.color;
      ctx.shadowBlur = 34;
      ctx.fillText(p.col.name, 256, 105);
      ctx.shadowBlur = 0;
      ctx.font = '300 40px sans-serif';
      ctx.fillStyle = p.col.color;
      ctx.fillText(p.col.items.length + ' 篇', 256, 168);
    }, 512, 200, 1.6);
    sign.position.copy(dir.clone().multiplyScalar(RADIUS - 0.4)).setY(BAY_H + 1.1);
    scene.add(sign);

    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(Math.min(4.5, (walked - groupStart) / 2), 48),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(p.col.color), transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.copy(dir.clone().multiplyScalar(RADIUS - 2.2)).setY(0.03);
    scene.add(glow);

    const lamp = new THREE.PointLight(new THREE.Color(p.col.color), 35, 14, 1.8);
    lamp.position.copy(dir.clone().multiplyScalar(RADIUS - 2.5)).setY(4.5);
    scene.add(lamp);

    collectionAnchors.push({ col: p.col, dir, theta: midTheta });
    walked += GROUP_GAP;
  }
}

const env = buildEnvironment(RADIUS);

/* ---------- 相机飞行 ---------- */
function flyCamera(toPos, toTarget, dur = 1400) {
  const fromPos = camera.position.clone();
  const fromTarget = controls.target.clone();
  tween({
    dur, ease: easeInOutCubic,
    onUpdate: (k) => {
      camera.position.lerpVectors(fromPos, toPos, k);
      controls.target.lerpVectors(fromTarget, toTarget, k);
    }
  });
}

const overviewPos = new THREE.Vector3(0, 7.5, RADIUS * 0.95);
const overviewTarget = new THREE.Vector3(0, 3.2, -RADIUS * 0.15);

function flyToCollection(anchor) {
  const pos = anchor.dir.clone().multiplyScalar(RADIUS - 7).setY(3.6);
  const target = anchor.dir.clone().multiplyScalar(RADIUS - 0.5).setY(3.2);
  flyCamera(pos, target);
}

/* ---------- HUD 分类导航 ---------- */
const nav = document.getElementById('hud-nav');
const overviewBtn = document.createElement('button');
overviewBtn.textContent = '⌂ 总览';
overviewBtn.style.setProperty('--c', '#8fa3c8');
overviewBtn.onclick = () => flyCamera(overviewPos.clone(), overviewTarget.clone());
nav.appendChild(overviewBtn);
for (const a of collectionAnchors) {
  const btn = document.createElement('button');
  btn.innerHTML = a.col.name + '<span class="cnt">' + a.col.items.length + '</span>';
  btn.style.setProperty('--c', a.col.color);
  btn.onclick = () => flyToCollection(a);
  nav.appendChild(btn);
}

/* ---------- 悬停与点击 ---------- */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerOnScreen = false;
let hovered = null;
let hoverTween = null;
let opening = false;
const tooltip = document.getElementById('tooltip');
const ttTitle = tooltip.querySelector('.tt-title');
const ttMeta = tooltip.querySelector('.tt-meta');
let mouseX = 0;
let mouseY = 0;

window.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  mouseX = e.clientX;
  mouseY = e.clientY;
  pointerOnScreen = true;
});
window.addEventListener('pointerleave', () => { pointerOnScreen = false; });

function setHover(mesh) {
  if (hovered === mesh) return;
  if (hovered) {
    const h = hovered;
    if (hoverTween) { tweens.delete(hoverTween); hoverTween = null; }
    tween({ dur: 350, onUpdate: (k) => { h.position.z = THREE.MathUtils.lerp(h.position.z, h.userData.baseZ, k); } });
    h.userData.spineMat.emissiveIntensity = 0;
  }
  hovered = mesh;
  if (mesh) {
    hoverTween = tween({ dur: 350, onUpdate: (k) => { mesh.position.z = THREE.MathUtils.lerp(mesh.position.z, mesh.userData.baseZ + 0.34, k); } });
    mesh.userData.spineMat.emissiveIntensity = 0.55;
    ttTitle.textContent = mesh.userData.title;
    ttMeta.textContent = mesh.userData.date || '';
    tooltip.style.setProperty('--c', mesh.userData.color);
    tooltip.style.display = 'block';
    canvas.style.cursor = 'pointer';
  } else {
    tooltip.style.display = 'none';
    canvas.style.cursor = 'grab';
  }
}

function updateHover() {
  if (!pointerOnScreen || opening) return;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(books, false)[0];
  setHover(hit ? hit.object : null);
  if (hovered) {
    tooltip.style.left = Math.min(window.innerWidth - 340, mouseX + 16) + 'px';
    tooltip.style.top = (mouseY + 18) + 'px';
  }
}

function openBook(mesh) {
  opening = true;
  controls.enabled = false;
  tooltip.style.display = 'none';
  const m = mesh;
  if (hoverTween) { tweens.delete(hoverTween); hoverTween = null; }
  m.position.z = m.userData.baseZ + 0.34;
  const z0 = m.position.z;
  tween({
    dur: 650, ease: easeInOutCubic,
    onUpdate: (k) => {
      m.position.z = z0 + k * 1.6;
      m.rotation.y = -k * 0.6;
      const s = 1 + k * 0.25;
      m.scale.x = m.userData.sw * s;
      m.scale.y = m.userData.sh * s;
    }
  });
  document.getElementById('overlay').classList.add('show');
  setTimeout(() => { window.location.href = m.userData.url; }, 800);
}

let downX = 0;
let downY = 0;
window.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
window.addEventListener('pointerup', (e) => {
  if (opening) return;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
  if (e.target !== canvas) return;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(books, false)[0];
  if (hit) {
    hit.object.userData.sw = hit.object.scale.x;
    hit.object.userData.sh = hit.object.scale.y;
    openBook(hit.object);
  }
});

/* ---------- 入场动画与主循环 ---------- */
camera.position.set(0, 26, RADIUS * 1.9);
flyCamera(overviewPos.clone(), overviewTarget.clone(), 2400);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let firstFrame = true;
renderer.setAnimationLoop((now) => {
  stepTweens(now);
  controls.update();
  updateHover();

  env.stars.rotation.y = now * 0.000012;
  env.core.rotation.y = now * 0.00035;
  env.inner.rotation.y = -now * 0.0005;
  env.ring1.rotation.z = now * 0.0004;
  env.ring2.rotation.z = -now * 0.0003;
  env.core.position.y = 3.4 + Math.sin(now * 0.0011) * 0.15;
  env.inner.position.y = env.core.position.y;
  env.title.position.y = 7.6 + Math.sin(now * 0.0008) * 0.1;

  renderer.render(scene, camera);
  if (firstFrame) {
    firstFrame = false;
    document.getElementById('loader').classList.add('hide');
    canvas.style.cursor = 'grab';
  }
});
