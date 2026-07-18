// 3D relief map for Conquista Mundial — vast GLTF terrain with Voronoi
// country-style territories, Lloyd-relaxed pin positions, and a launcher
// button variant that opens the whole thing in a fullscreen tab.
// React is injected by the DC runtime as a function argument, so DON'T redeclare it.
console.log('%c[cq-map-3d.jsx] version 2026-07-17-r8 — inline mini-viewport, 400px', 'color:#22e07a;font-weight:bold');
const { useEffect, useRef } = React;

const TERRAIN_GLTF_URL = 'scene.gltf';

// A moderate footprint sized for an inline mini-viewport (~400px tall).
const MAP_CX = 500;
const MAP_CY = -250;
const MAP_W  = 2200;
const MAP_H  = 1200;

// ---------- Voronoi helpers (half-plane clipping) --------------------------
function clipByBisector(poly, ax, ay, bx, by) {
  const f = (px, py) =>
    (px - bx) * (px - bx) + (py - by) * (py - by) -
    (px - ax) * (px - ax) - (py - ay) * (py - ay);
  const out = [];
  const n = poly.length;
  if (!n) return out;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    const f1 = f(x1, y1), f2 = f(x2, y2);
    const in1 = f1 > 0, in2 = f2 > 0;
    if (in1) out.push([x1, y1]);
    if (in1 !== in2) {
      const t = f1 / (f1 - f2);
      out.push([x1 + t * (x2 - x1), y1 + t * (y2 - y1)]);
    }
  }
  return out;
}
function voronoiCells(pins, rectPoly) {
  return pins.map((p, i) => {
    let poly = rectPoly.slice();
    for (let j = 0; j < pins.length; j++) {
      if (j === i) continue;
      const q = pins[j];
      poly = clipByBisector(poly, p.x, p.y, q.x, q.y);
      if (!poly.length) break;
    }
    return poly;
  });
}
function polygonCentroid(poly) {
  const n = poly.length;
  if (n < 3) {
    let sx = 0, sy = 0;
    poly.forEach(([x, y]) => { sx += x; sy += y; });
    return { x: sx / Math.max(1, n), y: sy / Math.max(1, n) };
  }
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    const c = x1 * y2 - x2 * y1;
    a += c;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  a /= 2;
  if (Math.abs(a) < 1e-6) {
    let sx = 0, sy = 0;
    poly.forEach(([x, y]) => { sx += x; sy += y; });
    return { x: sx / n, y: sy / n };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function hexToRgb(hex) {
  const h = (hex || '#3aa06a').replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

// Track opened map windows so the launcher can postMessage attack results back
const _mapWindows = [];

// =====================================================================
//  <CqMap3D> — the interactive 3D map itself. Container-size aware.
// =====================================================================
function CqMap3D({ territories, onTerritoryClick, height }) {
  const containerRef = useRef(null);
  const stateRef = useRef({});
  const territoriesRef = useRef(territories);
  territoriesRef.current = territories;

  useEffect(() => {
    const THREE = window.THREE;
    if (!THREE) { console.warn('THREE not loaded'); return; }
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#04070d');
    scene.fog = new THREE.FogExp2('#04070d', 0.00055);

    const width = container.clientWidth || 900;
    const heightPx = container.clientHeight || 400;
    const camera = new THREE.PerspectiveCamera(40, width / heightPx, 1, 8000);
    camera.position.set(500, -1100, 720);
    camera.up.set(0, 0, 1);
    camera.lookAt(500, -250, 40);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, heightPx);
    // Shadows disabled for perf — 100+ pins + a 200k-tri terrain on the shadow
    // pass was the single biggest cost. The scene reads fine without them.
    renderer.shadowMap.enabled = false;
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    let controls = null;
    const setupControls = () => {
      if (controls || !THREE.OrbitControls) return false;
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.target.set(500, -250, 40);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.rotateSpeed = 0.7;
      controls.zoomSpeed = 0.9;
      controls.minDistance = 200;
      controls.maxDistance = 3000;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.update();
      return true;
    };
    let ctrlTries = 0;
    const ctrlTimer = setInterval(() => {
      if (setupControls() || ++ctrlTries > 40) clearInterval(ctrlTimer);
    }, 100);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xfff1cf, 0.9);
    key.position.set(1000, -2200, 1800);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x7fc7d6, 0.4);
    fill.position.set(3200, -600, 1400);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe9a8, 0.25);
    rim.position.set(2200, 1200, 1100);
    scene.add(rim);

    // Subtle dark "abyss" disc under the terrain
    const abyssGeom = new THREE.CircleGeometry(Math.max(MAP_W, MAP_H) * 0.62, 48);
    const abyssMat = new THREE.MeshBasicMaterial({ color: '#0a0d13', transparent: true, opacity: 0.85 });
    const abyss = new THREE.Mesh(abyssGeom, abyssMat);
    abyss.position.set(MAP_CX, MAP_CY, -8);
    scene.add(abyss);

    const terrainGroup = new THREE.Group();
    scene.add(terrainGroup);
    const overlayGroup = new THREE.Group();
    scene.add(overlayGroup);
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const territoryGroup = new THREE.Group();
    scene.add(territoryGroup);

    const labelLayer = document.createElement('div');
    labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    container.appendChild(labelLayer);

    stateRef.current = {
      THREE, scene, camera, renderer,
      terrainGroup, overlayGroup, territoryGroup,
      raycaster, mouse, container, labelLayer,
      labels: [],
      terrainReady: false,
      terrainMeshes: [],
      terrainBounds: null,
      rebuildTerritories: null,
    };

    // ---------- Load the GLTF terrain -----------------------------------
    const loadTerrain = () => {
      const Loader = THREE.GLTFLoader;
      if (!Loader) return false;
      const loader = new Loader();
      loader.load(TERRAIN_GLTF_URL, (gltf) => {
        const root = gltf.scene || gltf.scenes[0];
        root.rotation.x = Math.PI / 2;
        root.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);
        const scale = Math.min(MAP_W / size.x, MAP_H / size.y);
        root.scale.multiplyScalar(scale);
        root.updateMatrixWorld(true);

        const box2 = new THREE.Box3().setFromObject(root);
        const cx = (box2.min.x + box2.max.x) / 2;
        const cy = (box2.min.y + box2.max.y) / 2;
        root.position.x += MAP_CX - cx;
        root.position.y += MAP_CY - cy;
        root.position.z += -box2.min.z;
        root.updateMatrixWorld(true);

        const meshes = [];
        root.traverse(o => {
          if (o.isMesh) {
            if (o.material) {
              o.material.side = THREE.FrontSide;
              if (o.material.map) o.material.map.encoding = THREE.sRGBEncoding;
            }
            meshes.push(o);
          }
        });

        terrainGroup.add(root);
        stateRef.current.terrainMeshes = meshes;
        stateRef.current.terrainReady = true;

        const finalBox = new THREE.Box3().setFromObject(root);
        stateRef.current.terrainBounds = {
          minX: finalBox.min.x, maxX: finalBox.max.x,
          minY: finalBox.min.y, maxY: finalBox.max.y,
          maxZ: finalBox.max.z,
        };

        if (typeof stateRef.current.rebuildTerritories === 'function') {
          stateRef.current.rebuildTerritories();
        }
      }, undefined, (err) => {
        console.warn('Failed to load terrain GLTF:', err);
      });
      return true;
    };
    let ldrTries = 0;
    const ldrTimer = setInterval(() => {
      if (loadTerrain() || ++ldrTries > 60) clearInterval(ldrTimer);
    }, 100);

    // ---------- Interaction --------------------------------------------
    const pickTerritory = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(territoryGroup.children, true);
      if (!hits.length) return null;
      let o = hits[0].object;
      while (o && !(o.userData && (o.userData.pos || o.userData.pos === 0))) o = o.parent;
      return o || null;
    };
    const onClick = (e) => {
      if (dragMoved) return;
      const o = pickTerritory(e);
      if (o && o.userData.attackable) {
        const list = territoriesRef.current || [];
        const t = list.find(x => x.pos === o.userData.pos);
        if (t && t.onClick) t.onClick();
        else if (onTerritoryClick) onTerritoryClick(o.userData.pos);
      }
    };
    const onMove = (e) => {
      const o = pickTerritory(e);
      renderer.domElement.style.cursor = (o && o.userData.attackable) ? 'pointer' : 'grab';
    };
    let dragMoved = false, downX = 0, downY = 0;
    const onDown = (e) => { dragMoved = false; downX = e.clientX; downY = e.clientY; };
    const onDrag = (e) => { if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) dragMoved = true; };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onDrag);
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.addEventListener('mousemove', onMove);
    renderer.domElement.style.cursor = 'grab';

    // Resize based on container (works for both fixed-height and fullscreen)
    const resize = () => {
      const w = container.clientWidth || 900;
      const h = container.clientHeight || 540;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    let ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(resize);
      ro.observe(container);
    }

    // ---------- Render loop (capped at ~30fps for CPU headroom) ---------
    let raf;
    let frame = 0;
    let lastRenderT = 0;
    const FRAME_INTERVAL_MS = 1000 / 30; // 30fps ceiling
    const tmpV = new THREE.Vector3();
    const clock = new THREE.Clock();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      // Global pause flag — the fullscreen page sets this while the attack
      // modal is open so the 3D loop doesn't compete with the React input.
      if (window.__cqMapPaused) return;
      if (now - lastRenderT < FRAME_INTERVAL_MS) return;
      lastRenderT = now;
      const st = stateRef.current;
      const t = clock.getElapsedTime();
      frame++;
      if (controls) controls.update();

      // Halo pulse — only recompute every 3 frames (still smooth-looking at 30fps target)
      if (territoryGroup.children.length && (frame % 3 === 0)) {
        territoryGroup.children.forEach((g) => {
          if (!g.userData || !g.userData.attackable) return;
          const base = g.userData.baseZ || 0;
          g.position.z = base + Math.sin(t * 2 + (g.userData.pos || 0)) * 3;
          const halo = g.userData.halo;
          if (halo) {
            const s = 1 + 0.15 * (0.5 + 0.5 * Math.sin(t * 3 + (g.userData.pos || 0)));
            halo.scale.set(s, s, 1);
            halo.material.opacity = 0.4 + 0.25 * Math.sin(t * 3 + (g.userData.pos || 0));
          }
        });
      }

      // Labels: only recompute every 4 frames (much cheaper DOM path)
      if (st.labels && (frame % 4 === 0)) {
        const rect = renderer.domElement.getBoundingClientRect();
        st.labels.forEach(lbl => {
          tmpV.set(lbl.x, lbl.y, lbl.z);
          tmpV.project(camera);
          const inFront = tmpV.z < 1;
          const inView = inFront && tmpV.x > -1.1 && tmpV.x < 1.1 && tmpV.y > -1.1 && tmpV.y < 1.1;
          if (!inView) {
            if (lbl._vis !== false) { lbl.el.style.opacity = '0'; lbl._vis = false; }
            return;
          }
          const px = (tmpV.x * 0.5 + 0.5) * rect.width;
          const py = (-tmpV.y * 0.5 + 0.5) * rect.height;
          lbl.el.style.transform = `translate(-50%,-50%) translate(${px}px,${py}px)`;
          if (lbl._vis !== true) { lbl.el.style.opacity = '1'; lbl._vis = true; }
        });
      }
      renderer.render(scene, camera);
    };
    loop(0);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(ctrlTimer);
      clearInterval(ldrTimer);
      window.removeEventListener('resize', resize);
      if (ro) ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onDrag);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('mousemove', onMove);
      if (controls) controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (labelLayer.parentNode) labelLayer.parentNode.removeChild(labelLayer);
    };
  }, []);

  // (Re)build territory pins + Voronoi country overlay
  useEffect(() => {
    const st = stateRef.current;
    if (!st.THREE) return;
    const THREE = st.THREE;
    const { overlayGroup, territoryGroup, labelLayer } = st;

    const build = () => {
      const clearGroup = (grp) => {
        while (grp.children.length) {
          const c = grp.children[0];
          grp.remove(c);
          c.traverse && c.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
          });
        }
      };
      clearGroup(overlayGroup);
      clearGroup(territoryGroup);
      labelLayer.innerHTML = '';
      st.labels = [];

      const list = territoriesRef.current || [];
      if (!list.length) return;

      const ray = new THREE.Raycaster();
      const downDir = new THREE.Vector3(0, 0, -1);
      const RAY_TOP = (st.terrainBounds && st.terrainBounds.maxZ ? st.terrainBounds.maxZ : 500) + 300;
      const zCache = new Map();
      const getGroundZ = (wx, wy) => {
        if (!st.terrainReady || !st.terrainMeshes.length) return 0;
        const k = ((wx * 2) | 0) + ',' + ((wy * 2) | 0);
        const cached = zCache.get(k);
        if (cached !== undefined) return cached;
        ray.set(new THREE.Vector3(wx, wy, RAY_TOP), downDir);
        const hits = ray.intersectObjects(st.terrainMeshes, true);
        const z = hits.length ? hits[0].point.z : 0;
        zCache.set(k, z);
        return z;
      };

      // initial pin positions from game (t.x, t.y) → terrain space
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      list.forEach(t => {
        if (typeof t.x !== 'number') return;
        if (t.x < minX) minX = t.x;
        if (t.x > maxX) maxX = t.x;
        if (t.y < minY) minY = t.y;
        if (t.y > maxY) maxY = t.y;
      });
      const bboxW = Math.max(1, maxX - minX);
      const bboxH = Math.max(1, maxY - minY);
      const bboxCX = (minX + maxX) / 2;
      const bboxCY = (minY + maxY) / 2;

      const tb = st.terrainBounds || {
        minX: MAP_CX - MAP_W / 2, maxX: MAP_CX + MAP_W / 2,
        minY: MAP_CY - MAP_H / 2, maxY: MAP_CY + MAP_H / 2,
      };
      const areaCX = (tb.minX + tb.maxX) / 2;
      const areaCY = (tb.minY + tb.maxY) / 2;
      const PAD = 0.94;
      const fitX = ((tb.maxX - tb.minX) * PAD) / bboxW;
      const fitY = ((tb.maxY - tb.minY) * PAD) / bboxH;

      const jitter = (seed, salt) => {
        const s = Math.sin((seed + 1) * 12.9898 + salt * 78.233) * 43758.5453;
        return (s - Math.floor(s)) - 0.5;
      };
      const pins = list.map((t) => ({
        x: areaCX + (t.x - bboxCX) * fitX + jitter(t.pos, 1.7) * 40,
        y: areaCY - (t.y - bboxCY) * fitY + jitter(t.pos, 4.3) * 40,
        t,
      }));

      const M = 30;
      const rect = [
        [tb.minX + M, tb.minY + M], [tb.maxX - M, tb.minY + M],
        [tb.maxX - M, tb.maxY - M], [tb.minX + M, tb.maxY - M],
      ];

      // Lloyd's relaxation: 4 passes → uniform spread
      for (let iter = 0; iter < 4; iter++) {
        const cs = voronoiCells(pins, rect);
        for (let i = 0; i < pins.length; i++) {
          const c = polygonCentroid(cs[i]);
          if (isFinite(c.x) && isFinite(c.y)) {
            const t = 0.6;
            pins[i].x = pins[i].x + (c.x - pins[i].x) * t;
            pins[i].y = pins[i].y + (c.y - pins[i].y) * t;
          }
        }
      }

      const cells = voronoiCells(pins, rect);

      // Country cells, terrain-conforming (fill only — no border lines, they
      // were the biggest transparent-sort cost with 100+ cells).
      pins.forEach((p, idx) => {
        const cell = cells[idx];
        if (!cell || cell.length < 3) return;
        const centroid = polygonCentroid(cell);
        const czGround = getGroundZ(centroid.x, centroid.y);

        const LIFT = 0.8;
        const verts = [];
        verts.push(centroid.x, centroid.y, czGround + LIFT);
        const cornerZs = cell.map(([cx, cy]) => getGroundZ(cx, cy));
        cell.forEach(([cx, cy], k) => {
          verts.push(cx, cy, cornerZs[k] + LIFT);
        });
        const idxArr = [];
        const N = cell.length;
        for (let k = 0; k < N; k++) idxArr.push(0, 1 + k, 1 + ((k + 1) % N));

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geom.setIndex(idxArr);

        const rgb = hexToRgb(p.t.color);
        const fillMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(rgb.r, rgb.g, rgb.b),
          transparent: true,
          opacity: p.t.isMine ? 0.55 : (p.t.attackable ? 0.5 : 0.32),
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geom, fillMat);
        overlayGroup.add(mesh);
      });

      // Pins at final positions
      list.forEach((t, i) => {
        const p = pins[i];
        const wx = p.x, wy = p.y;
        const groundZ = getGroundZ(wx, wy);

        const teamCol = t.color || '#3aa06a';
        const group = new THREE.Group();
        group.userData = {
          pos: t.pos,
          attackable: !!t.attackable,
          isMine: !!t.isMine,
          baseZ: 0,
        };
        group.position.set(wx, wy, 0);

        const POLE_H = 46;
        const poleGeom = new THREE.CylinderGeometry(2.2, 2.6, POLE_H, 6);
        poleGeom.rotateX(Math.PI / 2);
        poleGeom.translate(0, 0, groundZ + POLE_H / 2);
        const poleMat = new THREE.MeshStandardMaterial({
          color: '#1a2530', roughness: 0.6, metalness: 0.3,
        });
        const pole = new THREE.Mesh(poleGeom, poleMat);
        group.add(pole);

        const orbGeom = new THREE.SphereGeometry(14, 12, 8);
        orbGeom.translate(0, 0, groundZ + POLE_H + 10);
        const orbMat = new THREE.MeshStandardMaterial({
          color: teamCol,
          emissive: teamCol,
          emissiveIntensity: t.attackable ? 0.6 : (t.isMine ? 0.4 : 0.25),
          roughness: 0.45,
          metalness: 0.15,
        });
        const orb = new THREE.Mesh(orbGeom, orbMat);
        group.add(orb);

        if (t.attackable) {
          const haloGeom = new THREE.RingGeometry(26, 36, 24);
          haloGeom.translate(0, 0, groundZ + 1.8);
          const haloMat = new THREE.MeshBasicMaterial({
            color: '#22e07a', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
          });
          const halo = new THREE.Mesh(haloGeom, haloMat);
          group.add(halo);
          group.userData.halo = halo;
        }

        orb.userData = group.userData;
        pole.userData = group.userData;

        territoryGroup.add(group);

        // Label — shown for EVERY territory so player can identify all clubs.
        // Style is compact for neutrals, brighter for mine/attackable/rival.
        const el = document.createElement('div');
        const badge = t.badge
          ? `<span style="display:inline-block;margin-left:5px;padding:1px 6px;border-radius:99px;background:${t.attackable ? '#22e07a' : (t.isMine ? '#ffffff' : '#e0454b')};color:#04140b;font-size:9px;font-weight:900;">${t.badge}</span>`
          : '';
        const emphasize = t.isMine || t.attackable || (t.badge === '🔒');
        const bg = emphasize ? 'rgba(10,26,26,.78)' : 'rgba(6,14,20,.55)';
        const border = emphasize ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.10)';
        const fontSize = emphasize ? '11px' : '9.5px';
        const fontWeight = emphasize ? 800 : 600;
        el.style.cssText = 'position:absolute;left:0;top:0;font:' + fontWeight + ' ' + fontSize + ' "Space Grotesk",sans-serif;color:#fff;white-space:nowrap;padding:1.5px 6px;background:' + bg + ';border-radius:5px;border:1px solid ' + border + ';text-shadow:0 1px 2px rgba(0,0,0,.9);opacity:0;transition:opacity .2s;';
        el.innerHTML = (t.name || '') + badge;
        labelLayer.appendChild(el);
        st.labels.push({ el, x: wx, y: wy, z: groundZ + POLE_H + 26, isEmphasized: emphasize });
      });
    };

    st.rebuildTerritories = build;
    build();
  }, [territories]);

  return React.createElement('div', {
    ref: containerRef,
    style: {
      position: 'relative',
      width: '100%',
      height: height || '400px',
      borderRadius: height === '100vh' ? '0' : '12px',
      overflow: 'hidden',
      background: 'radial-gradient(ellipse at 50% 40%,#0a1626,#04070d 80%)',
      border: height === '100vh' ? 'none' : '1px solid #1e2733',
    },
  });
}

// =====================================================================
//  <CqMapLauncher> — the lightweight button that opens the map in a new
//  tab. Keeps the main UI snappy (no 3D scene runs here). Syncs state via
//  localStorage + BroadcastChannel so the map tab stays live.
// =====================================================================
function CqMapLauncher({ territories, stats, onExecuteAttack }) {
  const territoriesRef = useRef(territories);
  territoriesRef.current = territories;
  const onExecuteAttackRef = useRef(onExecuteAttack);
  onExecuteAttackRef.current = onExecuteAttack;
  const bcRef = useRef(null);

  const serialize = (list) => (list || []).map(t => ({
    pos: t.pos, x: t.x, y: t.y,
    name: t.name,
    areaName: t.areaName || '',
    originName: t.originName || t.name || '',
    ownerName: t.ownerName || '',
    color: t.color,
    attackable: !!t.attackable, isMine: !!t.isMine,
    badge: t.badge,
  }));

  // Push state whenever territories/stats change → map tab stays in sync.
  // Handles both attack CLICK (opens local modal in map) and attack EXECUTE
  // (map tab already collected the scores and asks us to run the match).
  useEffect(() => {
    const serial = serialize(territories);
    try {
      localStorage.setItem('cq-map-territories', JSON.stringify(serial));
      localStorage.setItem('cq-map-stats', JSON.stringify(stats || {}));
      localStorage.setItem('cq-map-ts', String(Date.now()));
    } catch (e) {}

    const handleMessage = (d) => {
      if (!d) return;
      if (d.type === 'cq-attack-execute' && typeof d.pos !== 'undefined') {
        // Map tab collected the scores — run the whole match here
        if (onExecuteAttackRef.current) {
          const r = onExecuteAttackRef.current(d.pos, d.homeScore, d.awayScore, d.penHome, d.penAway);
          // Report back so the map tab can show a toast + close modal
          const reply = { type: 'cq-attack-result', pos: d.pos, ok: (r && r.ok !== false), playerWon: r ? r.playerWon : false, reason: r ? r.reason : null };
          try { bcRef.current && bcRef.current.postMessage(reply); } catch (er) {}
          try {
            // Also postMessage back to any window that sent this
            for (const w of _mapWindows) { try { w.postMessage(reply, '*'); } catch (er) {} }
          } catch (er) {}
        }
      } else if (d.type === 'cq-attack' && typeof d.pos !== 'undefined') {
        // Legacy path: fire the main-tab modal (used if map tab is old version)
        const list = territoriesRef.current || [];
        const t = list.find(x => x.pos === d.pos);
        if (t && t.onClick) t.onClick();
      } else if (d.type === 'cq-map-hello') {
        try {
          bcRef.current && bcRef.current.postMessage({ type: 'cq-map-state', territories: serialize(territoriesRef.current), stats: stats || {} });
        } catch (er) {}
      }
    };

    if (!bcRef.current && typeof BroadcastChannel !== 'undefined') {
      bcRef.current = new BroadcastChannel('cq-map');
      bcRef.current.onmessage = (e) => handleMessage(e.data);
    } else if (bcRef.current) {
      try { bcRef.current.postMessage({ type: 'cq-map-state', territories: serial, stats: stats || {} }); } catch (e) {}
    }

    if (!window.__cqLauncherMsg) {
      window.__cqLauncherMsg = (e) => handleMessage(e.data);
      window.addEventListener('message', window.__cqLauncherMsg);
    }
    return () => {};
  }, [territories, stats]);

  useEffect(() => () => {
    if (bcRef.current) { try { bcRef.current.close(); } catch (e) {} bcRef.current = null; }
  }, []);

  const open = () => {
    try {
      const w = window.open('mapa.html', '_blank');
      if (w) _mapWindows.push(w);
    } catch (e) {}
  };

  const attackable = (territories || []).filter(t => t.attackable).length;

  return React.createElement('div', {
    style: {
      position: 'relative',
      padding: '28px 22px',
      borderRadius: '14px',
      background: 'linear-gradient(140deg,#0e1a26 0%,#0c1420 55%,#0a1018 100%)',
      border: '1px solid #1e2733',
      display: 'flex',
      alignItems: 'center',
      gap: '20px',
      flexWrap: 'wrap',
      overflow: 'hidden',
    },
  },
    React.createElement('div', {
      style: {
        width: '54px', height: '54px', borderRadius: '13px', flexShrink: 0,
        background: 'linear-gradient(135deg,#22e07a,#1a9d55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '28px', boxShadow: '0 8px 22px rgba(34,224,122,.28)',
      },
    }, '🌍'),
    React.createElement('div', { style: { flex: 1, minWidth: '180px' } },
      React.createElement('div', {
        style: { fontFamily: '"Space Grotesk",sans-serif', fontWeight: 800, fontSize: '18px', color: '#e6ebf0', marginBottom: '4px' },
      }, 'Mapa 3D em tela cheia'),
      React.createElement('div', {
        style: { fontSize: '12.5px', color: '#8b97a5', lineHeight: 1.45 },
      }, attackable > 0
        ? `Você tem ${attackable} território${attackable > 1 ? 's' : ''} atacável${attackable > 1 ? 'is' : ''} — abra o mapa pra ver o mundo inteiro.`
        : 'Abra o mapa numa aba dedicada, com HUD de estatísticas e todos os territórios.'),
    ),
    React.createElement('button', {
      onClick: open,
      style: {
        display: 'flex', alignItems: 'center', gap: '9px',
        padding: '12px 22px', borderRadius: '11px', border: '1px solid #22e07a',
        background: 'linear-gradient(135deg,#22e07a,#1a9d55)',
        color: '#04140b', fontFamily: '"Space Grotesk",sans-serif',
        fontWeight: 800, fontSize: '14px', cursor: 'pointer',
        boxShadow: '0 6px 18px rgba(34,224,122,.35)',
      },
    }, 'Abrir mapa ↗'),
  );
}

window.CqMap3D = CqMap3D;
window.CqMapLauncher = CqMapLauncher;
if (typeof module !== 'undefined') module.exports = { CqMap3D, CqMapLauncher };
