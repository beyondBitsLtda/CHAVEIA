// 2D relief map for Conquista Mundial — full-image background with animated
// beacon markers per territory. Pan (drag), zoom (wheel), and click to attack.
// React is injected by the DC runtime as a function argument, so DON'T redeclare it.
console.log('%c[cq-map-2d.jsx] version 2026-07-18-r1 — 2D map with panzoom', 'color:#22e07a;font-weight:bold');
const { useEffect, useRef, useState } = React;

// Path to the parchment background — put map-bg.png in the site root
const MAP_BG_URL = 'map-bg.png';

// Territory coordinate window (matches the game's world-map bbox).
// (t.x, t.y) get remapped from this range into the map image's placement area.
const GAME_MIN_X = 20;
const GAME_MAX_X = 810;
const GAME_MIN_Y = 40;
const GAME_MAX_Y = 500;

// Where in the map image we place the pins (as fractions of image dims).
// Leaves margins so beacons don't sit on the borders of the artwork.
const MAP_INSET = { left: 0.08, right: 0.92, top: 0.12, bottom: 0.90 };

// Displayed image width; scale factor grows/shrinks it
const IMG_WIDTH_PX = 1800;   // natural width we render the bg at (before zoom)
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_STEP_WHEEL = 0.0012;

function CqMap2D({ territories, height }) {
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const [imgSize, setImgSize] = useState({ w: IMG_WIDTH_PX, h: IMG_WIDTH_PX * 9 / 16 });
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0, ready: false });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0, moved: false });

  // Preload the bg image to know its real dimensions
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const w = IMG_WIDTH_PX;
      const h = (IMG_WIDTH_PX * img.naturalHeight / img.naturalWidth) | 0;
      setImgSize({ w, h });
    };
    img.src = MAP_BG_URL;
  }, []);

  // Center + fit the map into the viewport on mount / resize / image load
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const fit = () => {
      const cw = container.clientWidth || 900;
      const ch = container.clientHeight || 540;
      // Choose a scale so the whole image fits comfortably
      const fitScale = Math.min(cw / imgSize.w, ch / imgSize.h);
      const scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitScale));
      const x = (cw - imgSize.w * scale) / 2;
      const y = (ch - imgSize.h * scale) / 2;
      setTransform({ scale, x, y, ready: true });
    };
    fit();
    const ro = window.ResizeObserver ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(container);
    window.addEventListener('resize', fit);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [imgSize.w, imgSize.h]);

  // Pan
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = {
      dragging: true, moved: false,
      startX: e.clientX, startY: e.clientY,
      origX: transform.x, origY: transform.y,
    };
    if (contentRef.current) contentRef.current.style.cursor = 'grabbing';
  };
  const onMouseMove = (e) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragRef.current.moved = true;
    setTransform(t => ({ ...t, x: dragRef.current.origX + dx, y: dragRef.current.origY + dy }));
  };
  const onMouseUp = () => {
    if (dragRef.current.dragging) {
      dragRef.current.dragging = false;
      if (contentRef.current) contentRef.current.style.cursor = 'grab';
    }
  };

  // Zoom toward cursor
  const onWheel = (e) => {
    e.preventDefault();
    const rect = containerRef.current && containerRef.current.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setTransform(t => {
      const factor = 1 - e.deltaY * ZOOM_STEP_WHEEL;
      const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, t.scale * factor));
      const scaleDelta = newScale / t.scale;
      const nx = mx - (mx - t.x) * scaleDelta;
      const ny = my - (my - t.y) * scaleDelta;
      return { ...t, scale: newScale, x: nx, y: ny };
    });
  };

  // Zoom controls (buttons)
  const zoomBy = (factor) => {
    const rect = containerRef.current && containerRef.current.getBoundingClientRect();
    if (!rect) return;
    const mx = rect.width / 2;
    const my = rect.height / 2;
    setTransform(t => {
      const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, t.scale * factor));
      const scaleDelta = newScale / t.scale;
      const nx = mx - (mx - t.x) * scaleDelta;
      const ny = my - (my - t.y) * scaleDelta;
      return { ...t, scale: newScale, x: nx, y: ny };
    });
  };
  const resetView = () => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth || 900;
    const ch = container.clientHeight || 540;
    const fitScale = Math.min(cw / imgSize.w, ch / imgSize.h);
    const scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitScale));
    setTransform({ scale, x: (cw - imgSize.w * scale) / 2, y: (ch - imgSize.h * scale) / 2, ready: true });
  };

  // Remap (t.x, t.y) → pixel coords inside the image
  const areaW = imgSize.w * (MAP_INSET.right - MAP_INSET.left);
  const areaH = imgSize.h * (MAP_INSET.bottom - MAP_INSET.top);
  const offX = imgSize.w * MAP_INSET.left;
  const offY = imgSize.h * MAP_INSET.top;
  const rangeX = GAME_MAX_X - GAME_MIN_X;
  const rangeY = GAME_MAX_Y - GAME_MIN_Y;
  const toPx = (gx, gy) => ({
    px: offX + ((gx - GAME_MIN_X) / rangeX) * areaW,
    py: offY + ((gy - GAME_MIN_Y) / rangeY) * areaH,
  });

  // Handle click (prevented if drag moved > threshold)
  const handleTerritoryClick = (t) => {
    if (dragRef.current.moved) return;
    if (t.onClick) t.onClick();
  };

  return React.createElement('div', {
    ref: containerRef,
    onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp,
    onWheel,
    style: {
      position: 'relative',
      width: '100%',
      height: height || '540px',
      borderRadius: '12px',
      overflow: 'hidden',
      background: 'radial-gradient(ellipse at 50% 40%,#1a1410,#0a0703 80%)',
      border: '1px solid #1e2733',
      cursor: 'grab',
      userSelect: 'none',
    },
  },
    // Zoomable content
    React.createElement('div', {
      ref: contentRef,
      style: {
        position: 'absolute',
        left: 0, top: 0,
        width: imgSize.w + 'px',
        height: imgSize.h + 'px',
        transformOrigin: '0 0',
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        willChange: 'transform',
        opacity: transform.ready ? 1 : 0,
        transition: transform.ready ? 'none' : 'opacity .2s',
      },
    },
      React.createElement('img', {
        src: MAP_BG_URL, draggable: false,
        style: { width: '100%', height: '100%', display: 'block', pointerEvents: 'none' },
      }),
      // Territory beacons overlay
      ...(territories || []).map((t, i) => {
        const { px, py } = toPx(t.x, t.y);
        const isRival = t.badge === '🔒';
        const isMine = !!t.isMine;
        const isAttack = !!t.attackable;

        // Color logic
        let mainColor = '#7f8b99';      // neutral gray
        let glowColor = 'rgba(127,139,153,.6)';
        if (isMine) { mainColor = '#22e07a'; glowColor = 'rgba(34,224,122,.85)'; }
        else if (isAttack) { mainColor = '#22e07a'; glowColor = 'rgba(34,224,122,.9)'; }
        else if (isRival) { mainColor = '#e0454b'; glowColor = 'rgba(224,69,75,.9)'; }

        // Marker size relative to image scale (compensate zoom so it stays readable)
        const invScale = 1 / Math.max(0.7, transform.scale);
        const beaconSize = 18 * invScale;
        const haloSize = beaconSize * 2.8;
        const nameSize = Math.max(9, 11 * invScale);

        const nameBg = (isMine || isAttack || isRival) ? 'rgba(10,26,26,.92)' : 'rgba(10,15,22,.75)';
        const nameBorder = (isMine || isAttack || isRival) ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.12)';
        const nameWeight = (isMine || isAttack || isRival) ? 800 : 600;

        const clickable = isAttack;

        return React.createElement('div', {
          key: 'terr-' + t.pos,
          onClick: () => handleTerritoryClick(t),
          onMouseDown: (e) => e.stopPropagation(), // prevent starting a pan on the pin
          style: {
            position: 'absolute',
            left: px + 'px',
            top: py + 'px',
            transform: 'translate(-50%, -50%)',
            cursor: clickable ? 'pointer' : 'default',
            pointerEvents: 'auto',
            zIndex: isAttack ? 20 : (isMine ? 15 : (isRival ? 15 : 10)),
          },
        },
          // Pulsing halo (attackable + rival get animation)
          React.createElement('div', {
            style: {
              position: 'absolute',
              left: '50%', top: '50%',
              width: haloSize + 'px', height: haloSize + 'px',
              transform: 'translate(-50%,-50%)',
              borderRadius: '50%',
              background: `radial-gradient(circle,${glowColor} 0%,transparent 70%)`,
              opacity: (isAttack || isRival) ? 0.85 : 0.35,
              animation: (isAttack || isRival) ? 'beaconPulse 1.4s ease-in-out infinite' : 'none',
              pointerEvents: 'none',
            },
          }),
          // Main beacon dot with border
          React.createElement('div', {
            style: {
              position: 'relative',
              width: beaconSize + 'px', height: beaconSize + 'px',
              borderRadius: '50%',
              background: mainColor,
              border: '2px solid ' + (isMine ? '#fff' : (isAttack ? '#c4ffdf' : (isRival ? '#ffd0d2' : '#e8ecf1'))),
              boxShadow: `0 0 ${beaconSize * 0.6}px ${glowColor}, 0 2px 6px rgba(0,0,0,.5)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: Math.max(9, beaconSize * 0.55) + 'px',
              color: '#04140b', fontWeight: 900,
            },
          }, isRival ? '🔒' : (isMine && t.badge === '✔' ? '✔' : (isAttack ? '⚔' : ''))),
          // Team name label above the beacon
          React.createElement('div', {
            style: {
              position: 'absolute',
              left: '50%',
              top: (-beaconSize / 2 - 4) + 'px',
              transform: 'translate(-50%,-100%)',
              padding: '2px 7px',
              background: nameBg,
              border: '1px solid ' + nameBorder,
              borderRadius: '5px',
              color: '#fff',
              fontFamily: '"Space Grotesk",sans-serif',
              fontSize: nameSize + 'px',
              fontWeight: nameWeight,
              whiteSpace: 'nowrap',
              textShadow: '0 1px 2px rgba(0,0,0,.9)',
              pointerEvents: 'none',
            },
          }, t.name || ''),
        );
      }),
    ),
    // Zoom controls overlay
    React.createElement('div', {
      style: {
        position: 'absolute',
        right: '14px',
        bottom: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        zIndex: 100,
      },
    },
      React.createElement('button', {
        onClick: () => zoomBy(1.25),
        style: zoomButtonStyle,
        title: 'Aumentar zoom',
      }, '+'),
      React.createElement('button', {
        onClick: () => zoomBy(1 / 1.25),
        style: zoomButtonStyle,
        title: 'Diminuir zoom',
      }, '−'),
      React.createElement('button', {
        onClick: resetView,
        style: { ...zoomButtonStyle, fontSize: '16px' },
        title: 'Enquadrar',
      }, '⌂'),
    ),
    // Hint bar
    React.createElement('div', {
      style: {
        position: 'absolute',
        bottom: '14px',
        left: '14px',
        padding: '5px 12px',
        background: 'rgba(10,15,22,.75)',
        border: '1px solid rgba(255,255,255,.12)',
        borderRadius: '99px',
        color: '#8b97a5',
        fontSize: '11px',
        fontFamily: '"Space Grotesk",sans-serif',
        pointerEvents: 'none',
      },
    }, '🖱️ Arraste para navegar · Roda do mouse para zoom'),
  );
}

const zoomButtonStyle = {
  width: '34px',
  height: '34px',
  borderRadius: '9px',
  background: 'rgba(14,22,32,.9)',
  border: '1px solid #263140',
  color: '#e6ebf0',
  fontFamily: '"Space Grotesk",sans-serif',
  fontSize: '18px',
  fontWeight: 700,
  cursor: 'pointer',
  backdropFilter: 'blur(6px)',
};

// Inject the pulsing keyframes once
if (typeof document !== 'undefined' && !document.getElementById('cq-map-2d-keyframes')) {
  const style = document.createElement('style');
  style.id = 'cq-map-2d-keyframes';
  style.textContent = `
    @keyframes beaconPulse {
      0%, 100% { opacity: 0.4; transform: translate(-50%,-50%) scale(0.85); }
      50%      { opacity: 0.95; transform: translate(-50%,-50%) scale(1.15); }
    }
  `;
  document.head.appendChild(style);
}

window.CqMap2D = CqMap2D;
if (typeof module !== 'undefined') module.exports = { CqMap2D };
