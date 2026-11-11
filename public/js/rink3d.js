// 3D rink with Three.js: projected starting six on the ice, and shots/goals
// from the play-by-play once the game is under way. Units are feet (NHL coords:
// x from -100 to 100, y from -42.5 to 42.5).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const W = 200, H = 85, R = 28;
const PX = 10; // texture pixels per foot

function rinkShape() {
  const s = new THREE.Shape();
  const x = W / 2, y = H / 2;
  s.moveTo(-x + R, -y);
  s.lineTo(x - R, -y); s.absarc(x - R, -y + R, R, -Math.PI / 2, 0);
  s.lineTo(x, y - R); s.absarc(x - R, y - R, R, 0, Math.PI / 2);
  s.lineTo(-x + R, y); s.absarc(-x + R, y - R, R, Math.PI / 2, Math.PI);
  s.lineTo(-x, -y + R); s.absarc(-x + R, -y + R, R, Math.PI, Math.PI * 1.5);
  return s;
}

function drawMarkings(logo) {
  const c = document.createElement('canvas');
  c.width = W * PX; c.height = H * PX;
  const g = c.getContext('2d');
  const X = (v) => (v + W / 2) * PX, Y = (v) => (H / 2 - v) * PX;
  g.fillStyle = '#f4f8fc'; g.fillRect(0, 0, c.width, c.height);
  // faint ice texture
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(150,180,215,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 40 + Math.random() * 120, 1);
  }
  const line = (x, color, w) => { g.fillStyle = color; g.fillRect(X(x) - (w * PX) / 2, 0, w * PX, c.height); };
  const circle = (x, y, r, color, w = 0.17) => { g.strokeStyle = color; g.lineWidth = w * PX; g.beginPath(); g.arc(X(x), Y(y), r * PX, 0, Math.PI * 2); g.stroke(); };
  const dot = (x, y, r, color) => { g.fillStyle = color; g.beginPath(); g.arc(X(x), Y(y), r * PX, 0, Math.PI * 2); g.fill(); };
  const RED = '#c8102e', BLUE = '#0b4ea2';
  line(0, RED, 1); line(25, BLUE, 1); line(-25, BLUE, 1); line(89, RED, 0.17); line(-89, RED, 0.17);
  circle(0, 0, 15, BLUE); dot(0, 0, 0.5, BLUE);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) { circle(69 * sx, 22 * sy, 15, RED); dot(69 * sx, 22 * sy, 1, RED); dot(20 * sx, 22 * sy, 1, RED); }
    // goal crease
    g.fillStyle = 'rgba(70,140,230,.35)'; g.strokeStyle = RED; g.lineWidth = 0.17 * PX;
    g.beginPath(); g.arc(X(89 * sx), Y(0), 6 * PX, sx > 0 ? Math.PI / 2 : -Math.PI / 2, sx > 0 ? Math.PI * 1.5 : Math.PI / 2); g.closePath(); g.fill(); g.stroke();
  }
  if (logo) {
    g.globalAlpha = 0.9;
    const s = 26 * PX, ratio = logo.width / logo.height || 1;
    g.drawImage(logo, X(0) - (s * ratio) / 2, Y(0) - s / 2, s * ratio, s);
    g.globalAlpha = 1;
  }
  return c;
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Round player token: headshot, team-colour ring, sweater number.
function tokenCanvas(img, color, number) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.fillStyle = '#0e1a30'; g.fill();
  g.save(); g.beginPath(); g.arc(128, 128, 108, 0, Math.PI * 2); g.clip();
  if (img) g.drawImage(img, 18, 10, 220, 220);
  g.restore();
  g.lineWidth = 14; g.strokeStyle = color; g.beginPath(); g.arc(128, 128, 114, 0, Math.PI * 2); g.stroke();
  if (number != null) {
    g.fillStyle = color; g.beginPath(); g.arc(205, 205, 40, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 44px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(number), 205, 208);
  }
  return c;
}

function labelCanvas(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.font = '600 46px "DM Sans", sans-serif';
  const w = Math.min(500, g.measureText(text).width + 36);
  g.fillStyle = 'rgba(8,16,32,.82)';
  g.beginPath(); g.roundRect((512 - w) / 2, 14, w, 68, 34); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 50);
  return c;
}

// Starting six positions for a team defending the given side (+1 right, -1 left).
const SLOTS = { C: [12, 0], LW: [14, 20], RW: [14, -20], D1: [42, 14], D2: [42, -14], G: [85, 0] };

export function createRink(container, { onPick } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 1000);
  camera.position.set(0, 110, 120);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.15;
  controls.minDistance = 60; controls.maxDistance = 320;
  controls.autoRotate = !reduced; controls.autoRotateSpeed = 0.35;
  controls.enablePan = false;
  renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; }, { once: true });

  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x1a2a44, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(40, 120, 60); scene.add(sun);

  // Ice (horizontal plane: x = length, z = width; NHL y maps to -z)
  const shape = rinkShape();
  const iceGeo = new THREE.ShapeGeometry(shape, 24);
  iceGeo.rotateX(-Math.PI / 2);
  // ShapeGeometry UVs are in shape units; remap to 0..1
  const uv = iceGeo.attributes.uv, pos = iceGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, (-pos.getZ(i) + H / 2) / H);
  const iceTex = new THREE.CanvasTexture(drawMarkings(null));
  iceTex.colorSpace = THREE.SRGBColorSpace; iceTex.anisotropy = 8;
  const ice = new THREE.Mesh(iceGeo, new THREE.MeshStandardMaterial({ map: iceTex, roughness: 0.18, metalness: 0.05 }));
  scene.add(ice);

  // Boards and glass
  const outer = rinkShape();
  const inner = new THREE.Path(rinkShape().getPoints(48).map((p) => p.multiplyScalar(0.985)));
  outer.holes.push(inner);
  const boards = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outer, { depth: 3.5, bevelEnabled: false, curveSegments: 24 }).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.5 }),
  );
  scene.add(boards);
  const kick = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outer, { depth: 0.7, bevelEnabled: false, curveSegments: 24 }).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.6 }),
  );
  kick.position.y = 0.01; scene.add(kick);
  const glass = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outer, { depth: 6, bevelEnabled: false, curveSegments: 24 }).rotateX(-Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.12, roughness: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  glass.position.y = 3.5; scene.add(glass);

  // Nets
  for (const sx of [-1, 1]) {
    const net = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.4 });
    const post = new THREE.CylinderGeometry(0.12, 0.12, 4, 10);
    for (const z of [-3, 3]) { const p = new THREE.Mesh(post, red); p.position.set(0, 2, z); net.add(p); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 10).rotateX(Math.PI / 2), red); bar.position.set(0, 4, 0); net.add(bar);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(3.3, 4, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, wireframe: true }));
    mesh.position.set(1.65, 2, 0); net.add(mesh);
    net.position.set(89 * sx, 0, 0); net.rotation.y = sx > 0 ? 0 : Math.PI;
    scene.add(net);
  }

  const playersGroup = new THREE.Group(); scene.add(playersGroup);
  const shotsGroup = new THREE.Group(); scene.add(shotsGroup);
  const pickables = [];

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    // Fit the whole rink width in view, whatever the screen shape.
    const fitW = (W / 2 + 12) / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const fitH = (H / 2 + 30) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.setLength(Math.max(fitW, fitH) * 1.02);
    controls.maxDistance = camera.position.length() * 1.6;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  let running = true, visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(container);
  const t0 = performance.now();
  (function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    if (!visible) return;
    const t = (performance.now() - t0) / 1000;
    for (const s of shotsGroup.children) if (s.userData.goal) s.children[1].material.opacity = 0.35 + 0.25 * Math.sin(t * 3);
    controls.update();
    renderer.render(scene, camera);
  })();

  // Tap / click on a player token
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  renderer.domElement.addEventListener('click', (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    if (hit && onPick) onPick(hit.object.userData.player);
  });

  function clear(group) {
    for (const o of [...group.children]) {
      o.traverse((m) => { m.geometry?.dispose(); if (m.material) { m.material.map?.dispose(); m.material.dispose(); } });
      group.remove(o);
    }
  }

  async function setCenterLogo(src) {
    const img = await loadImage(src);
    iceTex.image = drawMarkings(img); iceTex.needsUpdate = true;
  }

  // teams: [{ side: 1|-1, color, players: { C, LW, RW, D1, D2, G } }]
  async function setLineups(teams) {
    clear(playersGroup); pickables.length = 0;
    for (const team of teams) {
      for (const [slot, [sx, sy]] of Object.entries(SLOTS)) {
        const p = team.players[slot];
        if (!p) continue;
        const img = await loadImage(p.headshot);
        const tex = new THREE.CanvasTexture(tokenCanvas(img, team.color, p.number)); tex.colorSpace = THREE.SRGBColorSpace;
        const token = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
        token.scale.set(10, 10, 1);
        const x = sx * team.side, z = -sy * team.side;
        token.position.set(x, 7.5, z);
        token.userData.player = p;
        const lt = new THREE.CanvasTexture(labelCanvas(p.short || p.name)); lt.colorSpace = THREE.SRGBColorSpace;
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt, depthTest: false }));
        label.scale.set(14, 2.6, 1); label.position.set(x, 1.6, z + 6);
        const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: team.color, transparent: true, opacity: 0.7 }));
        ring.position.set(x, 0.05, z);
        playersGroup.add(token, label, ring);
        pickables.push(token);
      }
    }
  }

  // shots: [{ x, y, goal, color, label }] already oriented for the view
  function setShots(shots) {
    clear(shotsGroup);
    playersGroup.visible = !shots.length;
    for (const s of shots) {
      const g = new THREE.Group();
      g.userData.goal = s.goal;
      const puck = new THREE.Mesh(new THREE.CylinderGeometry(s.goal ? 1.5 : 0.9, s.goal ? 1.5 : 0.9, 0.4, 20), new THREE.MeshStandardMaterial({ color: s.goal ? 0xffd166 : s.color, emissive: s.goal ? 0x664400 : 0x000000 }));
      puck.position.y = 0.2; g.add(puck);
      if (s.goal) {
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.4, 14, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.5, depthWrite: false }));
        beam.position.y = 7; g.add(beam);
      }
      g.position.set(s.x, 0, -s.y);
      shotsGroup.add(g);
    }
  }

  return {
    setCenterLogo, setLineups, setShots,
    dispose() { running = false; ro.disconnect(); io.disconnect(); controls.dispose(); clear(playersGroup); clear(shotsGroup); renderer.dispose(); renderer.domElement.remove(); },
  };
}
