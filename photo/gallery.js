/* ================= the gallery and the Art Studio =================
   The gallery (G) keeps the photographs taken with the camera, each with the artworks made from it. It lists them
   newest first, one row to a photo: the photo, then its artworks, each labelled with its style. A click on any item
   selects it and shows it large; Download PNG and Delete act on the item selected. The Art Studio opens for a selected
   photo.

   The Art Studio makes artworks from one photo. A style is chosen (Watercolour, Oil, Van Gogh or Woodcut), then its
   settings, which are kept in the browser's local storage (key coast.pictureSettings) as soon as they change. Render
   paints the photo in the style chosen and shows it being made; a render in progress is stopped by another render, by a change of style or by
   leaving. Save keeps the finished artwork in the gallery under its photo; it is available exactly while there is a
   finished render that has not been saved. Leaving the Art Studio with such a render asks whether to save it.

   Back up saves every photo and artwork, with their details, in one zip file; Restore adds those of a backup that the
   gallery does not hold.

   createGallery({ renderer, scene, camera, origin, onClose }) -> { add(canvas), open(), close(), get isOpen,
     photos, download(item), handleKey(e), backupBlob() -> Promise<Blob>, readBackup(file), restoreConfirmed() }
   photos: [{ n, canvas, meta, time, works: [{ canvas, meta, time, style }] }], oldest first, at most 24 photos.
*/

const KEEP = 24;
const Q_KEY = 'coast.pictureSettings';
// the version of the stored settings: version 4 replaced the charcoal style with the woodcut, version 5 replaced the
// impressionist style with the Van Gogh style, version 6 removed the 3D render and version 7 the oil style's optical mixing; the settings of a style that no
// longer exists are dropped from the stored copy
const Q_VERSION = 7;
const sl = (k, label, def, min, max, step, fmt = v => '× ' + v.toFixed(2)) => ({ k, label, def, min, max, step, fmt });
// a slider's value is a multiple of the style's own amount (1 is as designed)
export const Q_GROUPS = [
  { id: 'all', title: 'Painting', fields: [ sl('duration', 'Time to paint', 6, 0, 30, 1, v => v ? v + ' s' : 'At once') ] },
  { id: 'watercolour', title: 'Watercolour', fields: [
    sl('abstraction', 'Simplification', 8, 2, 16, 1, v => v + ' px'), sl('washes', 'Washes', 1, 0, 2, 0.05), sl('bleed', 'Bleeding', 1, 0, 2, 0.05),
    sl('edge', 'Dark edges', 1, 0, 2, 0.05), sl('granulation', 'Granulation', 1, 0, 2, 0.05), sl('pencil', 'Pencil', 1, 0, 2, 0.05), sl('margin', 'Paper margin', 1, 0, 2, 0.05) ] },
  { id: 'oil', title: 'Oil', fields: [ sl('radius', 'Brush size', 6, 2, 14, 1, v => v + ' px'), sl('stroke', 'Stroke length', 1, 0.25, 2, 0.05), sl('impasto', 'Impasto', 1, 0, 2, 0.05) ] },
  { id: 'vangogh', title: 'Van Gogh', fields: [ sl('size', 'Stroke size', 1, 0.5, 2, 0.05), sl('swirl', 'Eddies in the sky', 1, 0, 2, 0.05), sl('stars', 'Stars', 1, 0, 2, 0.05),
    sl('colour', 'Colour intensity', 1, 0, 2, 0.05), sl('outline', 'Outlines', 1, 0, 2, 0.05), sl('impasto', 'Impasto', 1, 0, 2, 0.05),
    sl('distort', 'Distortion', 0, 0, 2, 0.05) ] },
  { id: 'woodcut', title: 'Woodcut', fields: [ sl('spacing', 'Line spacing', 9, 5, 16, 1, v => v + ' px'), sl('weight', 'Boldness', 1, 0.4, 2, 0.05),
    sl('contrast', 'Contrast', 1, 0, 2, 0.05), sl('outline', 'Outlines', 1, 0, 2, 0.05), sl('grain', 'Wood grain', 1, 0, 2, 0.05),
    sl('colours', 'Colour blocks', 0, 0, 4, 1, v => v ? String(v) : 'None') ] },
];
export const STYLES = [['watercolour', 'Watercolour'], ['oil', 'Oil'], ['vangogh', 'Van Gogh'], ['woodcut', 'Woodcut']];
// the name of a style, including one no longer offered, for the artworks already made in it
const OLD_STYLES = { render3d: '3D render' };
const styleName = id => (STYLES.find(s => s[0] === id) || [id, OLD_STYLES[id] || id])[1];

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const ICON = {
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: svg('<path d="M14.5 5.5L8 12l6.5 6.5"/>'),
  download: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>'),
  trash: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/>'),
  easel: svg('<path d="M12 3v2M5.5 5h13v10h-13zM8 15l-2.5 6M16 15l2.5 6M12 15v3"/>'),
  watercolour: svg('<path d="M12 3.5c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.5-6 5.5-10z"/><path d="M9.2 14.5a2.8 2.8 0 0 0 2.8 2.6" opacity=".7"/>'),
  oil: svg('<path d="M20.5 3.5l-7.2 7.8"/><path d="M11.4 10.2l2.4 2.4"/><path d="M10.6 11.2c-2.2-.1-3.8 1.2-4.2 3.2-.3 1.7-.9 3.4-2.4 4.9 2.6.5 5.5 0 7.1-1.7 1.4-1.4 1.8-3.2 1.4-4.5z"/>'),
  vangogh: svg('<path d="M4 9c2-3 6-3 7 0s-2 5-4 3 0-4 2-3"/><path d="M13 7c2-2 5-2 7 0"/><path d="M3 15c3-1.5 6 1.5 9 0s6-1.5 9 0"/><path d="M3 19c3-1.5 6 1.5 9 0s6-1.5 9 0"/>'),
  woodcut: svg('<path d="M3.5 20.5l7-7"/><path d="M9 12l3 3 2.5-2.5L20.5 6.5 17.5 3.5 11.5 9.5z"/><path d="M14 20.5h6.5M16 17.5h4.5"/>'),
  stop: svg('<rect x="7" y="7" width="10" height="10" rx="1.2"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  compass: svg('<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  backup: svg('<path d="M4.5 8.5h15v11h-15zM3.5 4.5h17v4h-17zM10 12h4"/>'),
  restore: svg('<path d="M12 20V9M7.5 13.5L12 9l4.5 4.5M5 4.5h14"/>'),
};

// zooming and panning a picture in its frame: a pinch on a trackpad or a touch screen, or the mouse wheel, zooms about
// the point under the fingers or the pointer, from the whole picture to eight times; a drag pans while it is zoomed;
// a double click returns to the whole picture. The picture is moved with a transform, so its own size is unchanged
function zoomPan(box, pick) {
  const Z = { s: 1, x: 0, y: 0 }, pts = new Map(); let last = null;
  const el = () => pick();
  const apply = () => { const c = el(); if (!c) return; const r = box.getBoundingClientRect(), cw = c.offsetWidth, ch = c.offsetHeight;
    // the picture never leaves the frame: it may move only as far as its enlargement allows
    const mx = Math.max(0, (cw * Z.s - r.width) / 2, cw * (Z.s - 1) / 2), my = Math.max(0, (ch * Z.s - r.height) / 2, ch * (Z.s - 1) / 2);
    Z.x = Math.max(-mx, Math.min(mx, Z.x)); Z.y = Math.max(-my, Math.min(my, Z.y));
    c.style.transform = Z.s === 1 ? '' : `translate(${Z.x}px,${Z.y}px) scale(${Z.s})`; box.style.cursor = Z.s > 1 ? 'grab' : ''; };
  const zoomAt = (k, px, py) => { const r = box.getBoundingClientRect(), cx = px - r.left - r.width / 2, cy = py - r.top - r.height / 2;
    const s2 = Math.max(1, Math.min(8, Z.s * k)), f = s2 / Z.s; Z.x = cx - (cx - Z.x) * f; Z.y = cy - (cy - Z.y) * f; Z.s = s2;
    if (Z.s === 1) Z.x = Z.y = 0; apply(); };
  box.addEventListener('wheel', e => { if (!el() || box.classList.contains('stack')) return; e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY; zoomAt(Math.exp(-d * (e.ctrlKey ? 0.012 : 0.0025)), e.clientX, e.clientY); }, { passive: false });
  box.addEventListener('pointerdown', e => { if (!el() || box.classList.contains('stack') || e.button > 0) return; box.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = null; });
  box.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; const p0 = pts.get(e.pointerId);
    if (pts.size === 1){ if (Z.s > 1){ Z.x += e.clientX - p0.x; Z.y += e.clientY - p0.y; apply(); } }
    else { const [a, b] = [...pts.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y), mid0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); const [c, d] = [...pts.values()], d1 = Math.hypot(c.x - d.x, c.y - d.y), mid1 = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
      if (d0 > 0) zoomAt(d1 / d0, mid1.x, mid1.y); Z.x += mid1.x - mid0.x; Z.y += mid1.y - mid0.y; apply(); return; }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  const up = e => { pts.delete(e.pointerId); };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  box.addEventListener('dblclick', () => { Z.s = 1; Z.x = Z.y = 0; apply(); });
  box.style.touchAction = 'none'; box.style.overflow = 'hidden';
  return { reset() { Z.s = 1; Z.x = Z.y = 0; const c = el(); if (c && !box.classList.contains('stack')) c.style.transform = ''; box.style.cursor = ''; } };
}

export function createGallery({ renderer, scene, camera, origin, onClose, onLoad, onChange = null, goTo = null }) {
  // the pictures kept have changed: loaded, taken, deleted or painted
  const changed = () => { if (onChange) try { onChange(); } catch (e) { console.warn(e); } };
  const photos = [];
  let count = 0, sel = null;   // sel: { p: photo, w: artwork or null }, the item shown
  // the items selected: the one shown, and more added with Cmd or Ctrl (one at a time) or Shift (a run of them)
  const picked = new Set();
  let anchor = null;

  /* ---------- settings, kept in the browser ---------- */
  const QS = Object.fromEntries(Q_GROUPS.map(g => [g.id, Object.fromEntries(g.fields.map(f => [f.k, f.def]))]));
  try { const v = JSON.parse(localStorage.getItem(Q_KEY) || 'null');
    if (v) for (const g of Q_GROUPS) for (const f of g.fields) if (v[g.id] && typeof v[g.id][f.k] === typeof f.def) QS[g.id][f.k] = v[g.id][f.k];
    // settings of a style that no longer exists, such as the charcoal, are dropped from the stored copy
    if (v && !(v.v >= Q_VERSION)) localStorage.setItem(Q_KEY, JSON.stringify({ ...QS, v: Q_VERSION })); } catch (e) { /* storage unavailable */ }
  const storeQS = () => { try { localStorage.setItem(Q_KEY, JSON.stringify({ ...QS, v: Q_VERSION })); } catch (e) { /* storage unavailable */ } };

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
.gal,.art{--g-bg:#0d1824;--g-raise:rgba(245,233,215,.06);--g-raise2:rgba(245,233,215,.11);--g-line:rgba(245,233,215,.16);
  position:fixed;z-index:6;box-sizing:border-box;color:var(--plaster,#f5e9d7);font:400 15px/1.35 var(--font-body,system-ui);font-variant-numeric:lining-nums tabular-nums}
.gal *,.art *{box-sizing:border-box}
.gal{inset:16px;display:flex;flex-direction:column;background:var(--g-bg);border:1px solid var(--g-line);border-radius:6px;box-shadow:0 18px 60px rgba(0,0,0,.45);overflow:hidden}
.art{inset:0;z-index:7;display:flex;flex-direction:column;background:var(--g-bg)}
.gal header,.art header{display:flex;align-items:center;gap:14px;padding:12px 14px 12px 20px;border-bottom:1px solid var(--g-line);min-height:58px}
.gal h2,.art h2{margin:0;font:400 1.3rem/1 var(--font-display,serif);letter-spacing:.05em}
.gal header .sum,.art header .src{color:var(--plaster-dim,#d9c8b0);font-size:.9rem;margin-right:auto}
.gal header .bk{background:transparent;border-color:var(--g-line)}
@media (max-width:640px){.gal header .bk span{display:none}.gal header .bk{width:40px;padding:0}}
.gal button,.art button{font:500 .95rem/1 var(--font-body,system-ui);color:var(--plaster,#f5e9d7);background:var(--g-raise2);border:1px solid transparent;border-radius:4px;
  padding:0 14px;height:38px;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s,opacity .12s}
@media (hover:hover){.gal button:hover:not(:disabled),.art button:hover:not(:disabled){background:rgba(245,233,215,.18)}}
.gal button:disabled,.art button:disabled{opacity:.35;cursor:default}
.gal button svg,.art button svg{width:20px;height:20px;flex:none}
.gal button.pri,.art button.pri{background:var(--accent,#2f72b8);color:#fff}
@media (hover:hover){.gal button.pri:hover:not(:disabled),.art button.pri:hover:not(:disabled){background:var(--accent-deep,#235c97)}}
.gal button.ib,.art button.ib{width:40px;padding:0;background:transparent}
.gal button:focus-visible,.art button:focus-visible,.art input:focus-visible,.art select:focus-visible{outline:2px solid var(--verdigris,#7cc3ad);outline-offset:2px}
.gal .body{flex:1;min-height:0;display:grid;grid-template-columns:var(--split,41.6%) 7px minmax(0,1fr)}
.gal .split{cursor:col-resize;position:relative;touch-action:none}
.gal .split::after{content:"";position:absolute;top:0;bottom:0;left:3px;width:1px;background:var(--g-line)}
.gal .split.drag::after{left:2px;width:3px;background:rgba(124,195,173,.7)}
@media (hover:hover){.gal .split:hover::after{left:2px;width:3px;background:rgba(124,195,173,.7)}}
.gal .sheet{overflow-y:auto;padding:14px 16px 20px;display:flex;flex-direction:column;gap:10px}
.gal .none{margin:auto;color:var(--plaster-dim,#d9c8b0);font-family:var(--font-display,serif);font-size:1.1rem;letter-spacing:.04em}
.gal .set{display:flex;align-items:stretch;gap:12px;padding:10px;background:var(--g-raise);border-radius:5px}
.gal .works{flex:1;display:flex;flex-wrap:wrap;align-content:flex-start;gap:6px;padding-left:12px;border-left:1px solid var(--g-line);min-width:0}
.gal .works:empty{display:none}
.gal .cw{position:relative;align-self:flex-start;display:flex;flex:none}
.gal .cw button.cp{position:absolute;top:8px;right:8px;width:30px;height:30px;padding:0;display:grid;place-items:center;border-radius:4px;background:rgba(20,30,40,.72);color:var(--plaster,#f5e9d7);border:1px solid rgba(245,233,215,.25);opacity:0;transition:opacity .12s}
.gal .cw button.cp svg{width:17px;height:17px}
.gal .cw button.cp:focus-visible,.gal .cw button.cp.done{opacity:1}
@media (hover:hover){.gal .cw:hover button.cp{opacity:1}}
@media (hover:none){.gal .cw button.cp{opacity:1}}
@media (hover:hover){.gal .cw button.cp:hover{background:rgba(20,30,40,.92)}}
.gal .cw button.cp.done{color:var(--verdigris,#7cc3ad)}
.gal .cw button.cp.go{top:44px}
.gal .card{align-self:flex-start;display:flex;flex-direction:column;align-items:stretch;gap:6px;height:auto;padding:4px;background:transparent;border:1.5px solid transparent;border-radius:4px;flex:none}
@media (hover:hover){.gal .card:hover:not(.sel){background:rgba(245,233,215,.08)!important}}
.gal .card img{display:block;align-self:flex-start;height:84px;width:auto;min-width:104px;max-width:180px;object-fit:cover;border-radius:2px;box-shadow:0 2px 8px rgba(0,0,0,.4)}
.gal .card.wk img{height:62px;min-width:92px;max-width:132px}
/* a photo's thumbnail is shown as a frame of 35 mm film, with the sprocket holes along its top and bottom edges */
.gal .card.ph img{height:100px;padding:8px 0;border-radius:1px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='8'%3E%3Crect x='2' y='2' width='5' height='4' rx='1' fill='%238a8275'/%3E%3C/svg%3E") 0 0/9px 8px repeat-x,url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='8'%3E%3Crect x='2' y='2' width='5' height='4' rx='1' fill='%238a8275'/%3E%3C/svg%3E") 0 100%/9px 8px repeat-x,#17120d}
.gal .card span{width:0;min-width:100%;overflow:hidden;white-space:nowrap;display:flex;justify-content:space-between;gap:8px;font:500 .78rem/1 var(--font-body,system-ui);letter-spacing:.04em;color:var(--plaster-dim,#d9c8b0)}
.gal .card span em{font-style:normal;opacity:.7}
.gal .card.ph span{color:var(--plaster,#f5e9d7)}
.gal .card.sel{border-color:var(--verdigris,#7cc3ad);background:rgba(124,195,173,.12)!important}
.gal .card.sel span{color:var(--verdigris,#7cc3ad)}
.gal .view{min-width:0;min-height:0;display:flex;flex-direction:column;gap:12px;padding:16px 18px}
.gal .big{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;border-radius:4px;background:rgba(0,0,0,.18)}
.gal .big canvas{max-width:100%;max-height:100%;border:6px solid #f4efe6;box-sizing:border-box;box-shadow:0 6px 26px rgba(0,0,0,.55)}
.gal .big.stack{position:relative}
.gal .big.stack canvas{position:absolute;max-width:72%;max-height:72%;transition:transform .2s}
.gal .big .none{font-size:1rem}
.gal .foot{display:flex;align-items:center;gap:10px}
.gal .info{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--plaster-dim,#d9c8b0);font-size:.9rem}
.gal .info b{font:400 1.05rem var(--font-display,serif);color:var(--plaster,#f5e9d7);letter-spacing:.04em;margin-right:10px}
@media (max-width:820px){
  .gal{inset:8px}
  .gal .body{grid-template-columns:1fr;grid-template-rows:minmax(200px,48%) 1fr}
  .gal .split{display:none}
  .gal .view{order:-1;padding:10px 12px;border-bottom:1px solid var(--g-line)}
  .gal .sheet{border-right:0;padding:10px 12px}
  .gal .card img{height:64px;min-width:104px} .gal .card.wk img{height:52px;min-width:86px} .gal .card.ph img{height:80px}
  .gal .foot{flex-wrap:wrap} .gal .info{flex-basis:100%}
}
/* the Art Studio */
.art .body{flex:1;min-height:0;display:grid;grid-template-columns:340px 1fr}
.art aside{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--g-line);background:rgba(245,233,215,.025)}
.art .scroll{flex:1;min-height:0;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:18px}
.art h3{margin:0 0 10px;font:500 .72rem/1 var(--font-body,system-ui);letter-spacing:.16em;text-transform:uppercase;color:var(--verdigris,#7cc3ad)}
.art .tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.art .tiles button{height:auto;min-height:62px;flex-direction:column;gap:6px;padding:10px 6px;background:var(--g-raise);border-color:var(--g-line);font-size:.9rem}
.art .tiles button svg{width:24px;height:24px;opacity:.85}
.art .tiles button[aria-pressed=true]{background:rgba(124,195,173,.16);border-color:var(--verdigris,#7cc3ad);color:#fff}
.art .tiles button[aria-pressed=true] svg{color:var(--verdigris,#7cc3ad);opacity:1}
.art form{display:flex;flex-direction:column;gap:14px;margin:0}
.art form:empty{display:none}
.art .opts .reset{margin-top:16px;width:100%}
.art form label{display:flex;flex-direction:column;gap:6px;color:var(--plaster-dim,#d9c8b0);font-size:.9rem}
.art form label>span{display:flex;justify-content:space-between;align-items:baseline}
.art form output{color:var(--plaster,#f5e9d7);font-size:.88rem}
.art form input[type=range]{width:100%;margin:0;accent-color:var(--verdigris,#7cc3ad);height:18px}
.art form select{font:inherit;font-size:.92rem;color:var(--plaster,#f5e9d7);background:var(--g-raise2);border:1px solid var(--g-line);border-radius:4px;padding:6px 8px;height:36px}
.art form select option{color:var(--ink,#26232b);background:var(--plaster,#f5e9d7)}
.art form label.ck{flex-direction:row;align-items:center;gap:10px;color:var(--plaster,#f5e9d7)}
.art form label.ck input{width:18px;height:18px;margin:0;accent-color:var(--verdigris,#7cc3ad)}
.art form hr{border:0;border-top:1px solid var(--g-line);margin:2px 0;width:100%}
.art .dock{padding:14px 18px 16px;border-top:1px solid var(--g-line);display:flex;flex-direction:column;gap:12px}
.art .state{display:flex;align-items:center;gap:10px;min-height:24px;font-size:.88rem;color:var(--plaster-dim,#d9c8b0)}
.art .state .st{flex:none;min-width:0}
.art .state .bar{flex:1;height:4px;border-radius:2px;background:rgba(245,233,215,.14);overflow:hidden}
.art .state .bar i{display:block;height:100%;width:0;background:var(--verdigris,#7cc3ad)}
.art .state.done .bar i{background:var(--plaster-dim,#d9c8b0)}
.art .state button.ib{width:28px;height:28px}
.art .state button.ib svg{width:16px;height:16px}
.art .btns{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.art .btns button{height:44px;font-size:1rem}
.art .btns button.ok:not(:disabled){background:var(--verdigris,#7cc3ad);color:var(--ink,#26232b)}
@media (hover:hover){.art .btns button.ok:hover:not(:disabled){background:#95d3bf}}
.art .stage{min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;padding:22px;background:radial-gradient(ellipse at 50% 40%,#1a2a3a,#0b141d 75%)}
.art .stage canvas{display:block;box-shadow:0 10px 40px rgba(0,0,0,.6);background:#0e1216}
.gal .ask,.art .ask{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(4,8,12,.6);z-index:2}
.gal .ask>div,.art .ask>div{width:min(380px,calc(100% - 32px));padding:20px 22px;background:#13212f;border:1px solid var(--g-line);border-radius:6px;box-shadow:0 18px 60px rgba(0,0,0,.5)}
.gal .ask h3,.art .ask h3{font:400 1.2rem/1.2 var(--font-display,serif);letter-spacing:.04em;text-transform:none;color:var(--plaster,#f5e9d7);margin:0 0 18px}
.art .ask .btns{grid-template-columns:repeat(3,1fr)}
.gal .ask .btns{display:grid;gap:8px;grid-template-columns:repeat(2,1fr)}
.gal .ask p{margin:-8px 0 18px;color:var(--plaster-dim,#d9c8b0)}.gal .ask p:empty{display:none}
.gal .ask.one .btns{grid-template-columns:1fr}.gal .ask.one [data-a="rs-yes"]{display:none}
@media (max-width:820px){
  .art .body{grid-template-columns:1fr;grid-template-rows:minmax(180px,42%) 1fr}
  .art .stage{order:-1;padding:10px}
  .art aside{border-right:0;border-top:1px solid var(--g-line)}
  .art .tiles{grid-template-columns:repeat(4,1fr)}
  .art header{padding-left:10px}
}
`;
  document.head.appendChild(css);

  /* ---------- the gallery ---------- */
  const gal = document.createElement('div'); gal.className = 'gal'; gal.hidden = true;
  gal.setAttribute('role', 'dialog'); gal.setAttribute('aria-label', 'Gallery');
  gal.innerHTML = `<header><h2>Gallery</h2><span class="sum"></span>
      <button class="bk" data-a="backup" title="Save every picture and its details in a zip file">${ICON.backup}<span>Back up</span></button>
      <button class="bk" data-a="restore" title="Add the pictures from a backup">${ICON.restore}<span>Restore</span></button>
      <button class="ib" data-a="close" title="Close (G)" aria-label="Close">${ICON.close}</button></header>
    <div class="body"><div class="sheet"></div><div class="split" role="separator" aria-orientation="vertical" aria-label="Resize"></div>
      <div class="view"><div class="big"></div>
        <div class="foot"><div class="info"></div>
          <button class="pri" data-a="art" title="Art Studio">${ICON.easel}<span>Art Studio</span></button>
          <button data-a="go" title="Go to the place and time of this picture">${ICON.compass}<span>Go there</span></button>
          <button data-a="dl" title="Download as PNG">${ICON.download}<span>Download PNG</span></button>
          <button class="ib" data-a="del" title="Delete" aria-label="Delete">${ICON.trash}</button></div></div></div>
    <div class="ask" hidden><div role="alertdialog" aria-label="Delete"><h3></h3>
      <div class="btns"><button class="pri" data-a="del-yes">Delete</button><button data-a="del-no">Cancel</button></div></div></div>
    <div class="ask rs" hidden><div role="alertdialog" aria-label="Restore"><h3></h3><p></p>
      <div class="btns"><button class="pri" data-a="rs-yes">Restore</button><button data-a="rs-no">Cancel</button></div></div></div>`;
  const $ = (root, q) => root.querySelector(q);
  const sheet = $(gal, '.sheet'), big = $(gal, '.big'), info = $(gal, '.info'), gask = $(gal, '.ask'), rask = $(gal, '.ask.rs');
  const bigZoom = zoomPan(big, () => big.querySelector('canvas'));
  // the divider between the pictures and the preview is dragged to resize them; its place is kept in the browser
  { const SPLIT_KEY = 'coast.gallerySplit', body = $(gal, '.body'), sp = $(gal, '.split');
    const setSplit = f => { f = Math.min(0.8, Math.max(0.15, f)); body.style.setProperty('--split', (f * 100).toFixed(2) + '%'); return f; };
    try { const v = parseFloat(localStorage.getItem(SPLIT_KEY)); if (v > 0) setSplit(v); } catch (e) { /* storage unavailable */ }
    sp.addEventListener('pointerdown', e => { e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add('drag');
      const r = body.getBoundingClientRect(); let f = null;
      const move = ev => { f = setSplit((ev.clientX - r.left) / r.width); };
      const up = () => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); sp.removeEventListener('pointercancel', up);
        if (f !== null) try { localStorage.setItem(SPLIT_KEY, String(f)); } catch (e) { /* storage unavailable */ } };
      sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up); sp.addEventListener('pointercancel', up); });
    sp.addEventListener('dblclick', () => { body.style.removeProperty('--split'); try { localStorage.removeItem(SPLIT_KEY); } catch (e) { /* storage unavailable */ } }); }

  const fmtDist = m => m >= 1000 ? '∞' : m < 10 ? m.toFixed(1) + ' m' : Math.round(m) + ' m';
  const fmtEV = ev => (Math.abs(ev) < 0.05 ? '±0.0' : (ev > 0 ? '+' : '−') + Math.abs(ev).toFixed(1)) + ' EV';
  const fmtF = N => 'f/' + (Number.isInteger(N) ? N : N.toFixed(1));
  const hhmm = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); };
  const thumb = item => {
    if (!item.thumb) { const c = item.canvas, t = document.createElement('canvas'), h = 168; t.width = Math.round(h * c.width / c.height); t.height = h;
      t.getContext('2d').drawImage(c, 0, 0, t.width, t.height); item.thumb = t.toDataURL('image/jpeg', 0.82); }
    return item.thumb;
  };

  function card(p, w) {
    const item = w || p, b = document.createElement('button'); b.type = 'button';
    b.className = 'card ' + (w ? 'wk' : 'ph') + (picked.has(item) ? ' sel' : '');
    const im = new Image(); im.src = thumb(item); im.alt = '';
    const lab = document.createElement('span');
    if (w) lab.textContent = styleName(w.style);
    else lab.innerHTML = `Photo ${p.n}<em>${hhmm(p.time)}</em>`;
    b.append(im, lab);
    b.addEventListener('click', e => select(p, w || null, e.shiftKey ? 'range' : (e.metaKey || e.ctrlKey) ? 'toggle' : null));
    // the copy button over the thumbnail puts the picture, at its full size, on the clipboard as a PNG
    const cp = document.createElement('button'); cp.type = 'button'; cp.className = 'cp'; cp.title = 'Copy'; cp.setAttribute('aria-label', 'Copy'); cp.innerHTML = ICON.copy;
    cp.addEventListener('click', e => { e.stopPropagation(); copy(item, cp); });
    const wrap = document.createElement('div'); wrap.className = 'cw'; wrap.append(b, cp);
    // and, beneath it, for a picture that records where and when it was taken (or an artwork made from one), the
    // compass returns there
    const sc = sceneOfItem(p, w);
    if (sc && goTo) { const go = document.createElement('button'); go.type = 'button'; go.className = 'cp go'; go.title = 'Go there'; go.setAttribute('aria-label', 'Go there'); go.innerHTML = ICON.compass;
      go.addEventListener('click', e => { e.stopPropagation(); goThere(p, w, im); }); wrap.append(go); }
    return wrap;
  }
  // the scene a picture was taken in: its own, or for an artwork that of its photo
  const sceneOfItem = (p, w) => (w && w.meta && w.meta.scene) || (p.meta && p.meta.scene) || null;
  // Go there: the picture grows from where it lies to its place in a white mount, not quite filling the screen, over a
  // ground that darkens, and the game is then given the scene with the picture and the field of view it was taken
  // with. The page that shows the place begins with the picture in the same place (goThereFrame in index.html, which
  // this matches), so that nothing moves as the page is loaded again.
  const GO_GROUND = '#05080c', GO_BORDER = 6;
  const goFrame = (W, H, a) => { const M = Math.round(Math.min(W, H) * 0.07), b = GO_BORDER;
    const iw = Math.min(W - 2 * M - 2 * b, (H - 2 * M - 2 * b) * a), ih = iw / a, w = iw + 2 * b, h = ih + 2 * b;
    return { left: (W - w) / 2, top: (H - h) / 2, width: w, height: h }; };
  let going = false;
  // from is the element the picture lies in, or the rectangle on the screen it covers ({ left, top, width, height })
  function goThere(p, w, from) {
    const sc = sceneOfItem(p, w); if (!sc || !goTo || going) return; going = true;
    const item = w || p, src = item.canvas, m = p.meta || {}, a = src.width / src.height;
    const r = from.getBoundingClientRect ? from.getBoundingClientRect() : from, f = goFrame(innerWidth, innerHeight, a);
    const ov = document.createElement('div');
    ov.style.cssText = `position:fixed;inset:0;z-index:1000;background:${GO_GROUND};opacity:0;pointer-events:auto`;
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0);
    c.style.cssText = `position:fixed;z-index:1001;object-fit:cover;box-sizing:border-box;border:${GO_BORDER}px solid #f4efe6;box-shadow:0 6px 26px rgba(0,0,0,.55);left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    document.body.append(ov, c);
    const px = v => v + 'px', T = 800;
    ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T, easing: 'ease-in-out', fill: 'forwards' });
    const zoom = c.animate([{}, { left: px(f.left), top: px(f.top), width: px(f.width), height: px(f.height) }], { duration: T, easing: 'cubic-bezier(.55,0,.2,1)', fill: 'forwards' });
    const undo = () => { ov.remove(); c.remove(); going = false; };
    Promise.resolve(goTo(sc, { canvas: src, fov: m.fov, aspect: a, ready: zoom.finished }))
      .then(ok => { if (ok === false) undo(); }, undo);
  }
  function copy(item, btn) {
    // the PNG is given to the clipboard as a promise, so that the write starts within the click (Safari requires it)
    const blob = item.blob ? Promise.resolve(item.blob) : new Promise((ok, no) => item.canvas.toBlob(b => b ? ok(b) : no(new Error('PNG')), 'image/png'));
    const mark = ok => { btn.innerHTML = ok ? ICON.check : ICON.close; btn.classList.add('done'); btn.title = ok ? 'Copied' : 'Copy failed';
      clearTimeout(btn._t); btn._t = setTimeout(() => { btn.innerHTML = ICON.copy; btn.classList.remove('done'); btn.title = 'Copy'; }, 1400); };
    try { navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => mark(true), () => mark(false)); }
    catch (e) { mark(false); }
  }
  function buildSheet() {
    sheet.textContent = '';
    if (!photos.length) { sheet.innerHTML = '<span class="none">No pictures</span>'; }
    for (let i = photos.length - 1; i >= 0; i--) {
      const p = photos[i], row = document.createElement('div'); row.className = 'set';
      const works = document.createElement('div'); works.className = 'works';
      for (const w of p.works) works.appendChild(card(p, w));
      row.append(card(p, null), works); sheet.appendChild(row);
    }
    const nw = photos.reduce((a, p) => a + p.works.length, 0);
    $(gal, '.sum').textContent = photos.length ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} · ${nw} ${nw === 1 ? 'artwork' : 'artworks'}` : '';
  }
  function showSel() {
    bigZoom.reset(); big.textContent = ''; info.textContent = '';
    if (!sel) big.innerHTML = photos.length ? '<span class="none">No picture selected</span>' : '';
    else {
      const item = sel.w || sel.p, m = item.meta;
      big.classList.toggle('stack', picked.size > 1);
      if (picked.size > 1){
        // several selected: they lie in a loose pile, each turned and shifted a little, the one last chosen on top
        const L = [...picked].filter(it => it !== item).slice(-7); L.push(item);
        L.forEach((it, k) => { const c = it.canvas, h = (k * 2654435761 >>> 0) / 4294967296, h2 = (k * 40503 + 17) % 97 / 97, top = k === L.length - 1;
          c.style.transform = top ? 'rotate(-1deg)' : `translate(${((h - 0.5) * 16).toFixed(1)}%, ${((h2 - 0.5) * 12).toFixed(1)}%) rotate(${((h2 - 0.5) * 16).toFixed(1)}deg)`;
          big.appendChild(c); });
      } else { item.canvas.style.transform = ''; big.appendChild(item.canvas); }
      const b = document.createElement('b'); b.textContent = sel.w ? styleName(sel.w.style) : `Photo ${sel.p.n}`;
      const rest = sel.w ? `${m.width} × ${m.height} · Photo ${sel.p.n}`
        : `${m.width} × ${m.height}` + (m.on ? ` · ${Math.round(m.focalLength)} mm · ${fmtF(m.fNumber)} · ${fmtDist(m.focusDistance)} · ${fmtEV(m.ev)}` : '');
      info.append(b, rest);
    }
    const n = picked.size;
    if (n > 1) info.append(` · ${n} selected`);
    $(gal, '[data-a="dl"] span').textContent = n > 1 ? `Download ${n} PNGs` : 'Download PNG';
    $(gal, '[data-a="dl"]').disabled = $(gal, '[data-a="del"]').disabled = !sel;
    $(gal, '[data-a="art"]').disabled = !(sel && !sel.w && n <= 1);
    $(gal, '[data-a="go"]').hidden = !goTo; $(gal, '[data-a="go"]').disabled = !(sel && n <= 1 && sceneOfItem(sel.p, sel.w));
  }
  // every item in the order of the sheet: each photo, newest first, followed by its artworks
  const order = () => { const L = []; for (let i = photos.length - 1; i >= 0; i--) { L.push([photos[i], null]); for (const w of photos[i].works) L.push([photos[i], w]); } return L; };
  function select(p, w, how = null) {
    const item = w || p;
    if (how === 'toggle'){ if (picked.has(item) && picked.size > 1){ picked.delete(item); const last = [...picked].pop(); const q = order().find(([a, b]) => (b || a) === last); sel = q ? { p: q[0], w: q[1] } : null; }
      else { picked.add(item); sel = { p, w }; } anchor = { p, w }; }
    else if (how === 'range' && anchor){ const L = order(), a = L.findIndex(([x, y]) => x === anchor.p && y === anchor.w), b = L.findIndex(([x, y]) => x === p && y === w);
      picked.clear(); for (let k = Math.min(a, b); k <= Math.max(a, b); k++) if (k >= 0) picked.add(L[k][1] || L[k][0]); sel = { p, w }; }
    else { picked.clear(); picked.add(item); sel = { p, w }; anchor = { p, w }; }
    buildSheet(); showSel();
    sheet.querySelector('.card.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function build() { if (sel && !photos.includes(sel.p)) sel = null;
    for (const it of [...picked]) if (!photos.includes(it) && !photos.some(p => p.works.includes(it))) picked.delete(it);
    if (!sel) picked.clear(); buildSheet(); showSel(); }

  function add(c) {
    const meta = { ...c.photo }; delete meta.depth;
    const p = { n: ++count, canvas: c, meta, time: meta.time || Date.now(), works: [] };
    photos.push(p); store.put(p);
    while (photos.length > KEEP) store.del(photos.shift());
    changed();
    if (!gal.hidden) build();
  }

  /* ---------- keeping the pictures: the photos and their artworks are kept in the browser's IndexedDB as PNG images,
     so that they are still there when the browser is closed and opened again ---------- */
  const store = (() => {
    const DB = 'coast-pictures', OS = 'photos';
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((res, rej) => { const q = indexedDB.open(DB, 1);
      q.onupgradeneeded = () => q.result.createObjectStore(OS, { keyPath: 'id' }); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }));
    const tx = (mode, fn) => db().then(d => new Promise((res, rej) => { const t = d.transaction(OS, mode), r = fn(t.objectStore(OS)); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }));
    const png = c => new Promise(res => c.toBlob(res, 'image/png'));
    const clean = m => { const o = { ...m }; delete o.depth; return JSON.parse(JSON.stringify(o)); };
    const idOf = p => p.id || (p.id = `${p.time}-${p.n}`);
    // each photo is written once with its own picture; its artworks are written with it whenever one is added or removed
    async function put(p) {
      try {
        if (!p.blob) p.blob = await png(p.canvas);
        for (const w of p.works) if (!w.blob) w.blob = await png(w.canvas);
        const rec = { id: idOf(p), n: p.n, time: p.time, meta: clean(p.meta), png: p.blob,
          works: p.works.map(w => ({ time: w.time, style: w.style, meta: clean(w.meta || {}), png: w.blob })) };
        await tx('readwrite', s => s.put(rec));
      } catch (e) { console.warn('The picture could not be kept:', e); }
    }
    function del(p) { tx('readwrite', s => s.delete(idOf(p))).catch(() => {}); }
    const toCanvas = async b => { const bm = await createImageBitmap(b), c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; c.getContext('2d').drawImage(bm, 0, 0); bm.close && bm.close(); return c; };
    async function load() {
      try {
        const recs = (await tx('readonly', s => s.getAll())) || [];
        recs.sort((a, b) => a.time - b.time);
        for (const r of recs.slice(-KEEP)) {
          const c = await toCanvas(r.png); c.photo = r.meta;
          const works = [];
          for (const w of r.works || []) { const wc = await toCanvas(w.png); wc.photo = w.meta; works.push({ canvas: wc, meta: w.meta, time: w.time, style: w.style, blob: w.png }); }
          photos.push({ id: r.id, n: r.n, canvas: c, meta: r.meta, time: r.time, works, blob: r.png }); count = Math.max(count, r.n);
        }
        photos.sort((a, b) => a.time - b.time);
        if (!gal.hidden) build();
        onLoad && onLoad(); changed();
      } catch (e) { console.warn('The pictures kept could not be read:', e); }
    }
    return { put, del, load, toCanvas };
  })();
  store.load();
  function open() { if (document.pointerLockElement) document.exitPointerLock(); sel = null; picked.clear(); build(); gal.hidden = false; }
  function close() {
    if (!art.hidden) return leaveArt(close);
    gal.hidden = true; big.textContent = ''; onClose && onClose();
  }
  function download(item) {
    if (!item) return;
    const d = new Date(item.time), p = n => String(n).padStart(2, '0');
    const name = `coast-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${item.style ? '-' + item.style : ''}.png`;
    item.canvas.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png');
  }
  gal.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'close') close();
    // the selected items are downloaded one after another, a moment apart, so that the browser takes each of them
    else if (a === 'dl' && sel) [...picked].forEach((it, k) => setTimeout(() => download(it), k * 250));
    else if (a === 'del' && sel) {
      // a question first: what is to be deleted, counting the artworks that go with a photograph
      const nP = [...picked].filter(it => photos.includes(it)), nW = [...picked].filter(it => !photos.includes(it) && !nP.some(p => p.works.includes(it))).length;
      const withW = nP.reduce((k, p) => k + p.works.length, 0), parts = [];
      if (nP.length) parts.push(`${nP.length} ${nP.length === 1 ? 'photo' : 'photos'}` + (withW ? ` and ${withW} ${withW === 1 ? 'artwork' : 'artworks'} made from ${nP.length === 1 ? 'it' : 'them'}` : ''));
      if (nW) parts.push(`${nW} ${nW === 1 ? 'artwork' : 'artworks'}`);
      $(gask, 'h3').textContent = `Delete ${parts.join(' and ')}?`; gask.hidden = false; $(gask, '[data-a="del-no"]').focus();
    }
    else if (a === 'del-no') gask.hidden = true;
    else if (a === 'del-yes' && sel) {
      gask.hidden = true;
      const touched = new Set();
      for (const it of picked) { const i = photos.indexOf(it);
        if (i >= 0){ photos.splice(i, 1); store.del(it); continue; }
        const p = photos.find(q => q.works.includes(it)); if (p){ p.works.splice(p.works.indexOf(it), 1); touched.add(p); } }
      for (const p of touched) if (photos.includes(p)) store.put(p);
      sel = null; picked.clear(); build(); changed();
    }
    else if (a === 'art' && sel && !sel.w) openArt(sel.p);
    else if (a === 'backup') backup();
    else if (a === 'restore') pickBackup();
    else if (a === 'rs-yes') restoreConfirmed();
    else if (a === 'rs-no') { rask.hidden = true; pendingRestore = null; }
    else if (a === 'go' && sel && goTo) { const it = sel.w || sel.p; if (sceneOfItem(sel.p, sel.w)) goThere(sel.p, sel.w, big.contains(it.canvas) ? it.canvas : big); }
  });

  /* ---------- backing up and restoring: every photo and its artworks, with their details, in one zip file ----------
     The archive holds gallery.json, which lists the photos oldest first, each with its number, time and details and
     its artworks with theirs, and names the PNG image of each in the folder pictures/. A restore adds the photos of a
     backup that the gallery does not hold, and the artworks it does not hold of those it does; the gallery then keeps
     its newest KEEP photos. */
  const BK_FORMAT = 'coast-gallery';
  const stamp = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
  const pngOf = it => it.blob ? Promise.resolve(it.blob) : new Promise((ok, no) => it.canvas.toBlob(b => b ? ok(b) : no(new Error('PNG')), 'image/png'));
  const cleanMeta = m => { const o = { ...(m || {}) }; delete o.depth; return JSON.parse(JSON.stringify(o)); };
  const workKey = w => `${w.time}-${w.style}`;
  async function backupBlob() {
    const { zip } = await import('./zip.js');
    const files = [], list = [];
    for (const p of photos) {
      const id = p.id || (p.id = `${p.time}-${p.n}`), file = `pictures/${id}.png`;
      files.push({ name: file, data: await pngOf(p), time: p.time });
      const works = [];
      for (let k = 0; k < p.works.length; k++) { const w = p.works[k], wf = `pictures/${id}-${k + 1}-${w.style}.png`;
        files.push({ name: wf, data: await pngOf(w), time: w.time }); works.push({ time: w.time, style: w.style, meta: cleanMeta(w.meta), file: wf }); }
      list.push({ id, n: p.n, time: p.time, meta: cleanMeta(p.meta), file, works });
    }
    const manifest = { format: BK_FORMAT, version: 1, made: Date.now(), photos: list };
    files.unshift({ name: 'gallery.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 1)), time: Date.now() });
    return zip(files);
  }
  async function backup() {
    const b = $(gal, '[data-a="backup"]'); b.disabled = true;
    try { const blob = await backupBlob(), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `coast-gallery-${stamp(Date.now())}.zip`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    catch (e) { console.warn('The backup could not be made:', e); showRestoreNote('The backup could not be made.', String(e.message || e)); }
    finally { b.disabled = false; }
  }
  function pickBackup() {
    // the chooser is kept in the page until a file is chosen, since Safari may otherwise let it go before it reports one
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.zip,application/zip'; inp.hidden = true;
    gal.querySelectorAll('input[type=file]').forEach(x => x.remove()); gal.append(inp);
    inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); if (f) readBackup(f); });
    inp.click();
  }
  let pendingRestore = null;
  function showRestoreNote(title, text) { rask.classList.add('one'); $(rask, 'h3').textContent = title; $(rask, 'p').textContent = text || '';
    $(rask, '[data-a="rs-no"]').textContent = 'Close'; rask.hidden = false; $(rask, '[data-a="rs-no"]').focus(); }
  // reads a backup and asks whether to restore what it holds that the gallery does not
  async function readBackup(file) {
    let plan;
    try {
      const { unzip } = await import('./zip.js'), files = await unzip(file), j = files.get('gallery.json');
      const m = j && JSON.parse(new TextDecoder().decode(j));
      if (!m || m.format !== BK_FORMAT || !Array.isArray(m.photos)) throw new Error('This zip file is not a backup of the gallery.');
      plan = { photos: [], works: [] };
      for (const r of m.photos) { if (!r || !files.has(r.file)) continue;
        const have = photos.find(p => (p.id || `${p.time}-${p.n}`) === r.id);
        const ws = (r.works || []).filter(w => files.has(w.file) && !(have && have.works.some(x => workKey(x) === workKey(w))));
        if (!have) plan.photos.push({ r, works: ws }); else for (const w of ws) plan.works.push({ p: have, w }); }
      plan.files = files;
    } catch (e) { return showRestoreNote('The backup could not be read.', String(e.message || e)); }
    const nW = plan.works.length + plan.photos.reduce((k, x) => k + x.works.length, 0), nP = plan.photos.length;
    if (!nP && !nW) return showRestoreNote('Nothing to restore', 'Every picture in this backup is already in the gallery.');
    const parts = []; if (nP) parts.push(`${nP} ${nP === 1 ? 'photo' : 'photos'}`); if (nW) parts.push(`${nW} ${nW === 1 ? 'artwork' : 'artworks'}`);
    // the gallery keeps its newest KEEP photos: those that would go, of its own and of the backup's
    const all = [...photos.map(p => ({ t: p.time, mine: true })), ...plan.photos.map(x => ({ t: x.r.time, mine: false }))].sort((a, b) => a.t - b.t);
    const gone = all.slice(0, Math.max(0, all.length - KEEP)), goneMine = gone.filter(x => x.mine).length, goneNew = gone.length - goneMine;
    const ph = n => `${n} ${n === 1 ? 'photo' : 'photos'}`, notes = [];
    if (goneNew) notes.push(`The gallery keeps ${KEEP} photos, and ${goneNew === nP && !nW ? (nP === 1 ? 'this photo is' : 'these photos are') : ph(goneNew) + ' of the backup ' + (goneNew === 1 ? 'is' : 'are')} older than those it keeps, so ${goneNew === 1 ? 'it' : 'they'} cannot be restored until some are deleted.`);
    if (goneMine) notes.push(`The ${goneMine === 1 ? 'oldest photo' : goneMine + ' oldest photos'} in the gallery, with ${goneMine === 1 ? 'its' : 'their'} artworks, will be removed to make room.`);
    if (goneNew === nP && !nW) return showRestoreNote('Nothing can be restored', notes[0]);
    pendingRestore = plan; rask.classList.remove('one'); $(rask, '[data-a="rs-no"]').textContent = 'Cancel';
    $(rask, 'h3').textContent = `Restore ${parts.join(' and ')}?`;
    $(rask, 'p').textContent = notes.join(' ');
    rask.hidden = false; $(rask, '[data-a="rs-yes"]').focus();
  }
  async function restoreConfirmed() {
    const plan = pendingRestore; pendingRestore = null; rask.hidden = true; if (!plan) return;
    const blobOf = name => new Blob([plan.files.get(name)], { type: 'image/png' });
    const work = async w => { const blob = blobOf(w.file), c = await store.toCanvas(blob); c.photo = w.meta; return { canvas: c, meta: w.meta, time: w.time, style: w.style, blob }; };
    const touched = new Set(), added = new Set();
    let nW = 0;
    try {
      for (const { r, works } of plan.photos) {
        const blob = blobOf(r.file), c = await store.toCanvas(blob); c.photo = r.meta;
        const p = { id: r.id, n: r.n, canvas: c, meta: r.meta, time: r.time, works: [], blob };
        for (const w of works) p.works.push(await work(w));
        photos.push(p); touched.add(p); added.add(p); count = Math.max(count, r.n || 0);
      }
      for (const { p, w } of plan.works) { p.works.push(await work(w)); touched.add(p); nW++; }
      for (const p of touched) p.works.sort((a, b) => a.time - b.time);
      photos.sort((a, b) => a.time - b.time);
      while (photos.length > KEEP) { const p = photos.shift(); touched.delete(p); store.del(p); }
      for (const p of touched) await store.put(p);
      // what was done: the photos and artworks added and kept
      const kept = [...added].filter(p => photos.includes(p)), nk = kept.length; nW += kept.reduce((k, p) => k + p.works.length, 0);
      const parts = []; if (nk) parts.push(`${nk} ${nk === 1 ? 'photo' : 'photos'}`); if (nW) parts.push(`${nW} ${nW === 1 ? 'artwork' : 'artworks'}`);
      build(); changed();
      showRestoreNote(parts.length ? `Restored ${parts.join(' and ')}` : 'Nothing was restored', `The gallery now holds ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}.`);
      return;
    } catch (e) { console.warn('The backup could not be restored:', e); showRestoreNote('The backup could not be restored.', String(e.message || e)); }
    build(); changed();
  }

  /* ---------- the Art Studio ---------- */
  const art = document.createElement('div'); art.className = 'art'; art.hidden = true;
  art.setAttribute('role', 'dialog'); art.setAttribute('aria-label', 'Art Studio');
  art.innerHTML = `<header><button class="ib" data-a="back" title="Back to the pictures (Esc)" aria-label="Back">${ICON.back}</button><h2>Art Studio</h2><span class="src"></span></header>
    <div class="body"><aside><div class="scroll">
        <section><h3>Style</h3><div class="tiles">${STYLES.map(([id, name]) => `<button type="button" data-style="${id}" aria-pressed="false">${ICON[id]}${name}</button>`).join('')}</div></section>
        <section class="opts" hidden><h3></h3><form></form><button type="button" class="reset" data-a="reset">Reset to default</button></section></div>
      <div class="dock"><div class="state"><span class="st"></span><span class="bar"><i></i></span></div>
        <div class="btns"><button class="pri" data-a="render" disabled>Create</button><button class="ok" data-a="save" disabled>Save</button></div></div></aside>
      <div class="stage"><canvas></canvas></div></div>
    <div class="ask" hidden><div role="alertdialog" aria-label="Unsaved artwork"><h3>Save this artwork?</h3>
      <div class="btns"><button class="pri" data-a="ask-save">Save</button><button data-a="ask-del">Delete</button><button data-a="ask-cancel">Cancel</button></div></div></div>`;
  document.body.append(gal, art);
  const stage = $(art, '.stage canvas'), g2 = stage.getContext('2d'), form = $(art, 'form'), stateEl = $(art, '.state'), ask = $(art, '.ask');
  // A: the photo, its style, the job in progress and the finished render, and whether it has been saved
  const A = { p: null, style: null, job: null, run: 0, result: null, saved: false, after: null };

  function setState(text, frac, done) {
    $(stateEl, '.st').textContent = text; $(stateEl, '.bar i').style.width = (frac == null ? 0 : Math.round(frac * 100)) + '%';
    $(stateEl, '.bar').style.visibility = frac == null ? 'hidden' : 'visible'; stateEl.classList.toggle('done', !!done);
  }
  function syncButtons() {
    const rb = $(art, '[data-a="render"]');
    rb.textContent = A.job ? 'Cancel' : 'Create'; rb.classList.toggle('pri', !A.job); rb.disabled = !A.job && !A.style;
    $(art, '[data-a="save"]').disabled = !(A.result && !A.saved && !A.job);
  }
  // the picture on the stage is drawn as large as the stage allows, keeping its shape
  function fitStage() {
    const box = stage.parentNode, cs = getComputedStyle(box), bw = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      bh = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom), k = Math.min(bw / stage.width, bh / stage.height);
    if (k > 0 && isFinite(k)) { stage.style.width = Math.floor(stage.width * k) + 'px'; stage.style.height = Math.floor(stage.height * k) + 'px'; }
  }
  new ResizeObserver(() => { if (!art.hidden) fitStage(); }).observe($(art, '.stage'));
  const stageZoom = zoomPan($(art, '.stage'), () => stage);
  const sizeStage = (w, h) => { if (stage.width !== w || stage.height !== h) { stage.width = w; stage.height = h; fitStage(); } };
  function showSource() { stageZoom.reset(); sizeStage(A.p.canvas.width, A.p.canvas.height); g2.drawImage(A.p.canvas, 0, 0); }

  // the settings groups shown for the chosen style: the painting time and the style's own
  const formGroups = () => ['all', A.style];
  const atDefault = () => formGroups().every(gid => Q_GROUPS.find(x => x.id === gid).fields.every(f => QS[gid][f.k] === f.def));
  function syncReset() { const b = $(art, '[data-a="reset"]'); if (b) b.disabled = !A.style || atDefault(); }
  function resetSettings() {
    for (const gid of formGroups()) for (const f of Q_GROUPS.find(x => x.id === gid).fields) QS[gid][f.k] = f.def;
    storeQS(); buildForm();
  }
  function buildForm() {
    form.textContent = ''; const opts = $(art, '.opts'); opts.hidden = !A.style; if (!A.style) return;
    $(opts, 'h3').textContent = styleName(A.style);
    const groups = formGroups();
    syncReset();
    groups.forEach((gid, gi) => {
      const g = Q_GROUPS.find(x => x.id === gid);
      if (gi) form.appendChild(document.createElement('hr'));
      for (const f of g.fields) {
        const l = document.createElement('label'), name = g.id + '.' + f.k, v = QS[g.id][f.k];
        if (f.check) { l.className = 'ck'; const i = document.createElement('input'); i.type = 'checkbox'; i.checked = v; i.name = name; l.append(i, f.label); }
        else if (f.opts) {
          const sel2 = document.createElement('select'); sel2.name = name;
          for (const o of f.opts) {
            let [ov, t] = Array.isArray(o) ? o : [o, String(o)];
            if (f.size) t = `${Math.round(A.p.canvas.width * ov)} × ${Math.round(A.p.canvas.height * ov)}`;
            const op = new Option(t, ov); if (ov === v) op.selected = true; sel2.add(op);
          }
          l.append(f.label, sel2);
        } else {
          const i = document.createElement('input'); i.type = 'range'; i.name = name; i.min = f.min; i.max = f.max; i.step = f.step; i.value = v;
          const out = document.createElement('output'); out.textContent = f.fmt(v);
          const top = document.createElement('span'); top.append(f.label, out); l.append(top, i);
        }
        form.appendChild(l);
      }
    });
  }
  form.addEventListener('input', e => {
    const [gid, k] = (e.target.name || '').split('.'), g = Q_GROUPS.find(x => x.id === gid), f = g && g.fields.find(x => x.k === k); if (!f) return;
    QS[gid][k] = f.check ? e.target.checked : Number(e.target.value);
    if (!f.check && !f.opts) e.target.parentNode.querySelector('output').textContent = f.fmt(QS[gid][k]);
    storeQS(); syncReset();
  });

  function openArt(p) {
    Object.assign(A, { p, style: null, result: null, saved: false });
    $(art, '.src').textContent = `Photo ${p.n}`;
    for (const b of art.querySelectorAll('[data-style]')) b.setAttribute('aria-pressed', 'false');
    ask.hidden = true; art.hidden = false; buildForm(); showSource(); fitStage(); setState('', null); syncButtons();
  }
  function pickStyle(id) {
    if (A.job) stopJob();
    A.style = id;
    for (const b of art.querySelectorAll('[data-style]')) b.setAttribute('aria-pressed', String(b.dataset.style === id));
    buildForm(); syncButtons();
  }
  // stops the render in progress; the promise resolves once it has wound up
  async function stopJob() {
    const j = A.job; if (!j) return; j.ctl.abort(); A.run++; A.job = null;
    showSource(); setState('Cancelled', null); syncButtons();
    try { await j.done; } catch (e) { /* stopped */ }
  }
  async function render() {
    if (!A.style) return;
    const prev = A.job; if (prev) { prev.ctl.abort(); try { await prev.done; } catch (e) { /* stopped */ } }
    const run = ++A.run, ctl = new AbortController(), style = A.style, p = A.p;
    A.result = null; A.saved = false;
    const job = { ctl, done: null }; A.job = job; syncButtons();
    const live = () => A.run === run && !ctl.signal.aborted;
    const t0 = performance.now();
    job.done = (async () => {
      const { applyEffect } = await import('./effects.js');
      const dur = QS.all.duration * 1000;
      setState('Painting', 0);
      return await applyEffect(style, p.canvas, { ...QS[style], seed: (Date.now() & 0xffff), duration: dur, signal: ctl.signal,
        onFrame: (c, k) => { if (!live()) return; sizeStage(c.width, c.height);
          g2.drawImage(c, 0, 0); setState(`Painting ${Math.round(k * 100)} %`, k); } });
    })();
    try {
      const out = await job.done;
      if (!live()) return;
      out.photo = { ...p.meta, width: out.width, height: out.height, effect: style, settings: { ...QS.all, ...QS[style] }, time: Date.now() };
      A.result = { canvas: out, style, p };
      sizeStage(out.width, out.height); g2.drawImage(out, 0, 0);
      const s = (performance.now() - t0) / 1000;
      setState(`Finished in ${s < 60 ? s.toFixed(1) + ' s' : Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s'}`, 1, true);
    } catch (err) {
      if (err.name !== 'AbortError') { console.warn('The artwork could not be made:', err); if (live()) { setState('Failed', null); showSource(); } }
    } finally {
      if (A.job === job) A.job = null;
      if (A.run === run) syncButtons();
    }
  }
  function save() {
    const r = A.result; if (!r || A.saved || A.job) return;
    r.p.works.push({ canvas: r.canvas, meta: r.canvas.photo, time: r.canvas.photo.time, style: r.style }); store.put(r.p); changed();
    A.saved = true; setState('Saved', 1, true); syncButtons(); build();
  }
  // leaving the Art Studio: an unsaved finished render is offered to be saved first; then() runs once it has closed
  function leaveArt(then) {
    if (A.result && !A.saved && !A.job) { A.after = then || null; ask.hidden = false; $(ask, '[data-a="ask-save"]').focus(); return; }
    shutArt(); then && then();
  }
  function shutArt() {
    if (A.job) stopJob();
    A.result = null; ask.hidden = true; art.hidden = true; A.after = null; build(); }
  art.addEventListener('click', e => {
    const s = e.target.closest('[data-style]'); if (s) return pickStyle(s.dataset.style);
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'back') leaveArt();
    else if (a === 'render') A.job ? stopJob() : render();
    else if (a === 'save') save();
    else if (a === 'reset') resetSettings();
    else if (a === 'ask-save' || a === 'ask-del') { if (a === 'ask-save') save(); const then = A.after; shutArt(); then && then(); }
    else if (a === 'ask-cancel') { ask.hidden = true; A.after = null; }
  });

  /* ---------- keys while the gallery is open: the game sees none of them ---------- */
  function handleKey(e) {
    if (gal.hidden) return false;
    e.stopImmediatePropagation();
    const field = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (!art.hidden) {
      if (e.code === 'Escape') { e.preventDefault(); if (!ask.hidden) { ask.hidden = true; A.after = null; } else leaveArt(); }
      return true;
    }
    if (!gask.hidden){ if (e.code === 'Escape'){ e.preventDefault(); gask.hidden = true; } return true; }
    if (!rask.hidden){ if (e.code === 'Escape'){ e.preventDefault(); rask.hidden = true; pendingRestore = null; } return true; }
    if (e.code === 'Escape' || (e.code === 'KeyG' && !e.repeat)) { e.preventDefault(); close(); return true; }
    if (!field && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      e.preventDefault();
      const list = order();
      if (!list.length) return true;
      let i = sel ? list.findIndex(([p, w]) => p === sel.p && w === sel.w) : -1;
      i = e.code === 'ArrowRight' ? Math.min(list.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      select(...list[i], e.shiftKey ? 'range' : null);
    }
    return true;
  }

  return { add, open, close, download, handleKey, photos, goThere, backupBlob, readBackup, restoreConfirmed, get isOpen() { return !gal.hidden; }, get artOpen() { return !art.hidden; },
    get settings() { return QS; }, openArt: i => openArt(photos[i]), select: (i, j) => select(photos[i], j == null ? null : photos[i].works[j]) };
}
