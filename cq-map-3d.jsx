// 3D relief map for Conquista Mundial — laser-cut topographic contour style.
// Each territory is a "mountain" of many thin stacked contour layers with an
// elevation colour ramp, rendered with three.js over a stepped teal sea.
// React is injected by the DC runtime as a function argument, so DON'T redeclare it.
const { useEffect, useRef } = React;

function pathToShape(THREE, d) {
  const shape = new THREE.Shape();
  const cmds = d.match(/[MLZ][^MLZ]*/g) || [];
  cmds.forEach((c, i) => {
    const type = c[0];
    if (type === 'Z') { return; }
    const parts = c.slice(1).trim().split(/[\s,]+/).map(parseFloat);
    for (let k = 0; k < parts.length; k += 2) {
      const x = parts[k];
      const y = -parts[k + 1]; // flip Y (SVG down → three up)
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else if (type === 'M' && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
  });
  shape.autoClose = true;
  return shape;
}

function hexToRgb(hex) {
  const h = hex.replace('#','');
  return { r: parseInt(h.slice(0,2),16)/255, g: parseInt(h.slice(2,4),16)/255, b: parseInt(h.slice(4,6),16)/255 };
}
function mix(a, b, t) { return a * (1 - t) + b * t; }

// Deterministic pseudo-random
function seedRand(i) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
function noise2(x, y) {
  const s = Math.sin(x * 0.7 + 1.3) * Math.cos(y * 0.9 + 2.1)
          + Math.sin(x * 1.9 + 4.2) * 0.5 * Math.cos(y * 1.7 + 0.4);
  return s; // ~ -1.5..1.5
}

// Elevation colour ramp anchored on the team colour: dark teal base → team hue
// mid → bright yellow-green crest, like the reference relief map.
function elevColor(THREE, teamHex, frac) {
  const c = hexToRgb(teamHex);
  // Base: deep teal-green shadow tone
  const base = { r: 0.05, g: 0.24, b: 0.26 };
  // Mid: the team colour itself, slightly deepened
  const mid = { r: c.r * 0.85, g: c.g * 0.9, b: c.b * 0.7 };
  // Crest: push toward warm lime/yellow highlight
  const crest = { r: mix(c.r, 0.95, 0.6), g: mix(c.g, 0.92, 0.55), b: mix(c.b, 0.45, 0.55) };
  let r, g, b;
  if (frac < 0.5) {
    const t = frac / 0.5;
    r = mix(base.r, mid.r, t); g = mix(base.g, mid.g, t); b = mix(base.b, mid.b, t);
  } else {
    const t = (frac - 0.5) / 0.5;
    r = mix(mid.r, crest.r, t); g = mix(mid.g, crest.g, t); b = mix(mid.b, crest.b, t);
  }
  return new THREE.Color(r, g, b);
}

function CqMap3D({ territories, onTerritoryClick }) {
  const containerRef = useRef(null);
  const stateRef = useRef({});
  const territoriesRef = useRef(territories);
  territoriesRef.current = territories;

  // Mount scene once
  useEffect(() => {
    const THREE = window.THREE;
    if (!THREE) { console.warn('THREE not loaded'); return; }
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#050a12');
    scene.fog = new THREE.Fog('#050a12', 1400, 2600);

    const width = container.clientWidth || 900;
    const height = 540;
    const camera = new THREE.PerspectiveCamera(34, width / height, 1, 6000);
    camera.position.set(500, -1050, 560);
    camera.up.set(0, 0, 1);
    camera.lookAt(500, -230, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Orbit controls — drag to rotate, scroll to zoom, right-drag to pan.
    // The script may still be loading when we mount, so retry until it's ready.
    let controls = null;
    const setupControls = () => {
      if (controls || !THREE.OrbitControls) return false;
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.target.set(500, -230, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.rotateSpeed = 0.7;
      controls.zoomSpeed = 0.9;
      controls.minDistance = 350;
      controls.maxDistance = 2400;
      controls.maxPolarAngle = Math.PI * 0.49; // don't go under the map
      controls.update();
      return true;
    };
    let ctrlTries = 0;
    const ctrlTimer = setInterval(() => {
      if (setupControls() || ++ctrlTries > 40) clearInterval(ctrlTimer);
    }, 100);

    // Lights — low grazing key to carve shadows between the contour steps
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xfff1cf, 1.25);
    key.position.set(120, -520, 380);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -700, right: 1700, top: 500, bottom: -900, near: 50, far: 2600 });
    key.shadow.bias = -0.0005;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x7fc7d6, 0.5);
    fill.position.set(900, -300, 500);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe9a8, 0.35);
    rim.position.set(700, 400, 300);
    scene.add(rim);

    // Stepped teal sea — concentric shrinking plates like the reference water
    const seaGroup = new THREE.Group();
    const seaCols = ['#123a44', '#0e323b', '#0a2a32', '#071f26', '#05161c'];
    seaCols.forEach((col, i) => {
      const inset = i * 30;
      const g = new THREE.BoxGeometry(1240 - inset * 2, 740 - inset * 2, 5);
      const m = new THREE.MeshStandardMaterial({ color: col, roughness: 1, metalness: 0 });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(500, -250, -6 - i * 5);
      mesh.receiveShadow = true;
      seaGroup.add(mesh);
    });
    scene.add(seaGroup);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const territoryGroup = new THREE.Group();
    scene.add(territoryGroup);

    const labelLayer = document.createElement('div');
    labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    container.appendChild(labelLayer);

    stateRef.current = { THREE, scene, camera, renderer, territoryGroup, seaGroup, raycaster, mouse, container, labelLayer, labels: [] };

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
      if (dragMoved) return; // ignore clicks that were camera drags
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
    // Track pointer travel so an orbit-drag isn't mistaken for an attack click
    let dragMoved = false, downX = 0, downY = 0;
    const onDown = (e) => { dragMoved = false; downX = e.clientX; downY = e.clientY; };
    const onDrag = (e) => { if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) dragMoved = true; };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onDrag);
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.addEventListener('mousemove', onMove);
    renderer.domElement.style.cursor = 'grab';

    const onResize = () => {
      const w = container.clientWidth || 900;
      renderer.setSize(w, height);
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    let raf;
    const tmpV = new THREE.Vector3();
    const loop = () => {
      const st = stateRef.current;
      if (controls) controls.update();
      if (st.labels) {
        const rect = renderer.domElement.getBoundingClientRect();
        st.labels.forEach(lbl => {
          tmpV.set(lbl.x, lbl.y, lbl.z);
          tmpV.project(camera);
          const px = (tmpV.x * 0.5 + 0.5) * rect.width;
          const py = (-tmpV.y * 0.5 + 0.5) * rect.height;
          lbl.el.style.transform = `translate(-50%,-50%) translate(${px}px,${py}px)`;
          lbl.el.style.opacity = tmpV.z < 1 ? '1' : '0';
        });
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(ctrlTimer);
      window.removeEventListener('resize', onResize);
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

  // (Re)build territories whenever the list changes
  useEffect(() => {
    const st = stateRef.current;
    if (!st.THREE) return;
    const THREE = st.THREE;
    const { territoryGroup, labelLayer } = st;

    while (territoryGroup.children.length) {
      const c = territoryGroup.children[0];
      territoryGroup.remove(c);
      c.traverse && c.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
    }
    labelLayer.innerHTML = '';
    st.labels = [];

    const LAYERS = 11;         // number of stacked contour slices
    const LAYER_H = 5.6;       // thickness of each slice
    (territories || []).forEach((t) => {
      if (!t.path) return;
      const shape = pathToShape(THREE, t.path);
      const seed = t.pos + 1;
      const rand = seedRand(seed);
      const peakScale = 0.62 + rand * 0.16;   // how sharply it narrows to the crest
      const teamCol = t.color || '#3aa06a';
      const cx = t.x, cy = -t.y;

      // Irregular crest drift so the peak isn't dead-centre (gives ridged look)
      const driftX = (seedRand(seed * 3.1) - 0.5) * 60;
      const driftY = (seedRand(seed * 5.7) - 0.5) * 60;

      // Build all contour slices, bake per-vertex colours, and merge into ONE
      // geometry so the whole mountain is a single draw call (big perf win).
      const posArrs = [], normArrs = [], colArrs = [];
      let total = 0;
      let crestX = cx, crestY = cy, crestZ = 0;
      const m = new THREE.Matrix4(), sc = new THREE.Matrix4();
      for (let l = 0; l < LAYERS; l++) {
        const frac = l / (LAYERS - 1);
        const shrink = 1 - Math.pow(frac, 1.15) * peakScale;
        let geom = new THREE.ExtrudeGeometry(shape, { depth: LAYER_H + 0.6, bevelEnabled: false, steps: 1 });
        const ox = cx + driftX * frac, oy = cy + driftY * frac;
        m.makeTranslation(ox - ox * shrink, oy - oy * shrink, l * LAYER_H);
        sc.makeScale(shrink, shrink, 1);
        m.multiply(sc);
        geom.applyMatrix4(m);
        geom = geom.toNonIndexed();
        geom.computeVertexNormals();
        const pos = geom.attributes.position.array;
        const nor = geom.attributes.normal.array;
        const n = geom.attributes.position.count;
        const col = elevColor(THREE, teamCol, frac);
        const side = col.clone().multiplyScalar(0.7);
        const colArr = new Float32Array(n * 3);
        for (let v = 0; v < n; v++) {
          const up = nor[v * 3 + 2] > 0.55; // top face vs wall
          const c = up ? col : side;
          colArr[v * 3] = c.r; colArr[v * 3 + 1] = c.g; colArr[v * 3 + 2] = c.b;
        }
        posArrs.push(pos); normArrs.push(nor); colArrs.push(colArr);
        total += n;
        crestX = ox; crestY = oy; crestZ = l * LAYER_H;
        geom.dispose();
      }
      const positions = new Float32Array(total * 3);
      const normals = new Float32Array(total * 3);
      const colors = new Float32Array(total * 3);
      let off = 0;
      for (let i = 0; i < posArrs.length; i++) {
        positions.set(posArrs[i], off); normals.set(normArrs[i], off); colors.set(colArrs[i], off);
        off += posArrs[i].length;
      }
      const merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { pos: t.pos, attackable: !!t.attackable, isMine: !!t.isMine };

      const group = new THREE.Group();
      group.userData = mesh.userData;
      group.add(mesh);

      // Frontier / owned outline halo (only a handful, cheap)
      if (t.attackable || t.isMine) {
        const ringGeom = new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: false, steps: 1 });
        const ringMat = new THREE.MeshBasicMaterial({ color: t.isMine ? '#ffffff' : '#22e07a', transparent: true, opacity: 0.4 });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.set(0, 0, 1);
        ring.userData = group.userData;
        group.add(ring);
      }

      territoryGroup.add(group);

      // HTML label above the crest
      const el = document.createElement('div');
      const badge = t.badge
        ? `<span style="display:inline-block;margin-left:5px;padding:1px 6px;border-radius:99px;background:${t.attackable ? '#22e07a' : '#ffffff'};color:#04140b;font-size:9px;font-weight:900;">${t.badge}</span>`
        : '';
      el.style.cssText = 'position:absolute;left:0;top:0;font:800 11px "Space Grotesk",sans-serif;color:#fff;white-space:nowrap;padding:2px 8px;background:rgba(10,26,26,.62);border-radius:6px;border:1px solid rgba(255,255,255,.18);text-shadow:0 1px 2px rgba(0,0,0,.9);backdrop-filter:blur(2px);';
      el.innerHTML = (t.name || '') + badge;
      labelLayer.appendChild(el);
      st.labels.push({ el, x: crestX, y: crestY, z: crestZ + 26 });
    });
  }, [territories]);

  return React.createElement('div', {
    ref: containerRef,
    style: { position: 'relative', width: '100%', height: '540px', borderRadius: '12px', overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 40%,#0a1626,#04070d 80%)', border: '1px solid #1e2733' },
  });
}

window.CqMap3D = CqMap3D;
if (typeof module !== 'undefined') module.exports = { CqMap3D };
