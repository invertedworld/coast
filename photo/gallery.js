/* ================= the gallery and artist mode =================
   The gallery (L) keeps the photographs taken with the camera, each with the artworks made from it. It lists them
   newest first, one row to a photo: the photo, then its artworks, each labelled with its style. A click on any item
   selects it and shows it large; Download PNG and Delete act on the item selected. Artist mode opens for a selected
   photo.

   Artist mode makes artworks from one photo. A style is chosen (Watercolour, Oil, Impressionist, Charcoal or
   3D render), then its settings, which are kept in the browser's local storage (key coast.pictureSettings) as soon as
   they change. Render paints the photo in the style chosen, or path-traces the scene again from the photo's own
   camera, and shows it being made; a render in progress is stopped by another render, by a change of style or by
   leaving. Save keeps the finished artwork in the gallery under its photo; it is available exactly while there is a
   finished render that has not been saved. Leaving artist mode with such a render asks whether to save it.

   createGallery({ renderer, scene, camera, origin, onClose }) -> { add(canvas), open(), close(), get isOpen,
     photos, download(item), handleKey(e) }
   photos: [{ n, canvas, meta, time, works: [{ canvas, meta, time, style }] }], oldest first, at most 24 photos.
*/
import * as THREE from 'three';

const KEEP = 24;
const Q_KEY = 'coast.pictureSettings';
// the version of the stored settings: version 2 lowered the 3D render's default samples and bounces, and version 3
// gave the 3D render a time limit, with the samples per pixel its upper bound; the values kept from an earlier
// version give way to the new defaults
const Q_VERSION = 3;
const sl = (k, label, def, min, max, step, fmt = v => '× ' + v.toFixed(2)) => ({ k, label, def, min, max, step, fmt });
// a slider's value is a multiple of the style's own amount (1 is as designed)
export const Q_GROUPS = [
  { id: 'render3d', title: '3D render', fields: [
    { k: 'timeBudget', label: 'Time limit', opts: [[15, '15 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min'], [0, 'None']], def: 30 },
    { k: 'samples', label: 'Maximum samples per pixel', opts: [32, 64, 128, 256, 512, 1024, 2048, 4096], def: 512 },
    { k: 'scale', label: 'Resolution', opts: [0.5, 0.75, 1, 1.5, 2], def: 1, size: true },
    { k: 'bounces', label: 'Bounces of light', opts: [2, 3, 4, 5, 6, 8, 10], def: 3 },
    { k: 'ptReach', label: 'Path-traced distance', opts: [[250, '250 m'], [500, '500 m'], [1000, '1 km'], [2000, '2 km']], def: 500 },
    { k: 'horizonReach', label: 'Draw distance', opts: [[1500, '1.5 km'], [3000, '3 km'], [5000, '5 km'], [8000, '8 km'], [12000, '12 km']], def: 5000 },
    { k: 'hazeVisibility', label: 'Visibility in the haze', opts: [[8000, '8 km'], [15000, '15 km'], [28000, '28 km'], [50000, '50 km'], [100000, '100 km']], def: 28000 },
    { k: 'denoise', label: 'Noise filter', opts: [[0, 'Off'], [2, 'Light'], [5, 'Normal'], [8, 'Strong']], def: 5 },
    { k: 'materials', label: 'Glass and metal', check: true, def: true },
    { k: 'reflectivity', label: 'Reflectivity of glass and metal', opts: [[0, 'None'], [0.5, 'Low'], [1, 'Normal'], [1.5, 'High'], [2, 'Very high']], def: 1 },
    { k: 'haze', label: 'Haze', check: true, def: true } ] },
  { id: 'all', title: 'Painting', fields: [ sl('duration', 'Time to paint', 6, 0, 30, 1, v => v ? v + ' s' : 'At once') ] },
  { id: 'watercolour', title: 'Watercolour', fields: [
    sl('abstraction', 'Simplification', 8, 2, 16, 1, v => v + ' px'), sl('washes', 'Washes', 1, 0, 2, 0.05), sl('bleed', 'Bleeding', 1, 0, 2, 0.05),
    sl('edge', 'Dark edges', 1, 0, 2, 0.05), sl('granulation', 'Granulation', 1, 0, 2, 0.05), sl('pencil', 'Pencil', 1, 0, 2, 0.05), sl('margin', 'Paper margin', 1, 0, 2, 0.05) ] },
  { id: 'oil', title: 'Oil', fields: [ sl('radius', 'Brush size', 6, 2, 14, 1, v => v + ' px'), sl('stroke', 'Stroke length', 1, 0.25, 2, 0.05), sl('impasto', 'Impasto', 1, 0, 2, 0.05) ] },
  { id: 'impressionist', title: 'Impressionist', fields: [ sl('size', 'Dab size', 1, 0.4, 2.5, 0.05), sl('strokes', 'Number of dabs', 1, 0.3, 2, 0.05), sl('jitter', 'Broken colour', 1, 0, 2, 0.05) ] },
  { id: 'charcoal', title: 'Charcoal', fields: [ sl('abstraction', 'Simplification', 5, 2, 12, 1, v => v + ' px'), sl('hatching', 'Hatching', 1, 0, 2, 0.05),
    sl('smudge', 'Smudging', 1, 0, 2, 0.05), sl('contour', 'Contour lines', 1, 0, 2, 0.05) ] },
];
export const STYLES = [['watercolour', 'Watercolour'], ['oil', 'Oil'], ['impressionist', 'Impressionist'], ['charcoal', 'Charcoal'], ['render3d', '3D render']];
const styleName = id => (STYLES.find(s => s[0] === id) || [id, id])[1];

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const ICON = {
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: svg('<path d="M14.5 5.5L8 12l6.5 6.5"/>'),
  download: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>'),
  trash: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/>'),
  easel: svg('<path d="M12 3v2M5.5 5h13v10h-13zM8 15l-2.5 6M16 15l2.5 6M12 15v3"/>'),
  watercolour: svg('<path d="M12 3.5c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.5-6 5.5-10z"/><path d="M9.2 14.5a2.8 2.8 0 0 0 2.8 2.6" opacity=".7"/>'),
  oil: svg('<path d="M20.5 3.5l-7.2 7.8"/><path d="M11.4 10.2l2.4 2.4"/><path d="M10.6 11.2c-2.2-.1-3.8 1.2-4.2 3.2-.3 1.7-.9 3.4-2.4 4.9 2.6.5 5.5 0 7.1-1.7 1.4-1.4 1.8-3.2 1.4-4.5z"/>'),
  impressionist: svg('<circle cx="7" cy="8" r="1.6"/><circle cx="13" cy="6.5" r="1.6"/><circle cx="18" cy="10" r="1.6"/><circle cx="9" cy="14" r="1.6"/><circle cx="15.5" cy="15.5" r="1.6"/><circle cx="6" cy="19" r="1.3"/><circle cx="12" cy="19.5" r="1.3"/>'),
  charcoal: svg('<path d="M16.5 3.5l4 4L9 19l-5 1.5L5.5 15.5z"/><path d="M14 6l4 4"/>'),
  render3d: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
  stop: svg('<rect x="7" y="7" width="10" height="10" rx="1.2"/>'),
};

export function createGallery({ renderer, scene, camera, origin, onClose }) {
  const photos = [];
  let count = 0, sel = null;   // sel: { p: photo, w: artwork or null }

  /* ---------- settings, kept in the browser ---------- */
  const QS = Object.fromEntries(Q_GROUPS.map(g => [g.id, Object.fromEntries(g.fields.map(f => [f.k, f.def]))]));
  try { const v = JSON.parse(localStorage.getItem(Q_KEY) || 'null');
    if (v && !(v.v >= 2) && v.render3d) delete v.render3d.bounces;
    if (v && !(v.v >= 3) && v.render3d) delete v.render3d.samples;
    if (v) for (const g of Q_GROUPS) for (const f of g.fields) if (v[g.id] && typeof v[g.id][f.k] === typeof f.def) QS[g.id][f.k] = v[g.id][f.k]; } catch (e) { /* storage unavailable */ }
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
.gal button,.art button{font:500 .95rem/1 var(--font-body,system-ui);color:var(--plaster,#f5e9d7);background:var(--g-raise2);border:1px solid transparent;border-radius:4px;
  padding:0 14px;height:38px;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s,opacity .12s}
.gal button:hover:not(:disabled),.art button:hover:not(:disabled){background:rgba(245,233,215,.18)}
.gal button:disabled,.art button:disabled{opacity:.35;cursor:default}
.gal button svg,.art button svg{width:20px;height:20px;flex:none}
.gal button.pri,.art button.pri{background:var(--coral,#d85d52);color:#fff}
.gal button.pri:hover:not(:disabled),.art button.pri:hover:not(:disabled){background:var(--coral-deep,#b9463d)}
.gal button.ib,.art button.ib{width:40px;padding:0;background:transparent}
.gal button:focus-visible,.art button:focus-visible,.art input:focus-visible,.art select:focus-visible{outline:2px solid var(--verdigris,#7cc3ad);outline-offset:2px}
.gal .body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(300px,5fr) 7fr}
.gal .sheet{overflow-y:auto;padding:14px 16px 20px;border-right:1px solid var(--g-line);display:flex;flex-direction:column;gap:10px}
.gal .none{margin:auto;color:var(--plaster-dim,#d9c8b0);font-family:var(--font-display,serif);font-size:1.1rem;letter-spacing:.04em}
.gal .set{display:flex;align-items:stretch;gap:12px;padding:10px;background:var(--g-raise);border-radius:5px}
.gal .works{flex:1;display:flex;flex-wrap:wrap;align-content:flex-start;gap:6px;padding-left:12px;border-left:1px solid var(--g-line);min-width:0}
.gal .works:empty{display:none}
.gal .card{align-self:flex-start;display:flex;flex-direction:column;align-items:stretch;gap:6px;height:auto;padding:4px;background:transparent;border:1.5px solid transparent;border-radius:4px;flex:none}
.gal .card:hover:not(.sel){background:rgba(245,233,215,.08)!important}
.gal .card img{display:block;align-self:flex-start;height:84px;width:auto;min-width:104px;max-width:180px;object-fit:cover;border-radius:2px;box-shadow:0 2px 8px rgba(0,0,0,.4)}
.gal .card.wk img{height:62px;min-width:92px;max-width:132px}
.gal .card span{width:0;min-width:100%;overflow:hidden;white-space:nowrap;display:flex;justify-content:space-between;gap:8px;font:500 .78rem/1 var(--font-body,system-ui);letter-spacing:.04em;color:var(--plaster-dim,#d9c8b0)}
.gal .card span em{font-style:normal;opacity:.7}
.gal .card.ph span{color:var(--plaster,#f5e9d7)}
.gal .card.sel{border-color:var(--verdigris,#7cc3ad);background:rgba(124,195,173,.12)!important}
.gal .card.sel span{color:var(--verdigris,#7cc3ad)}
.gal .view{min-width:0;min-height:0;display:flex;flex-direction:column;gap:12px;padding:16px 18px}
.gal .big{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;border-radius:4px;background:rgba(0,0,0,.18)}
.gal .big canvas{max-width:100%;max-height:100%;box-shadow:0 6px 26px rgba(0,0,0,.55)}
.gal .big .none{font-size:1rem}
.gal .foot{display:flex;align-items:center;gap:10px}
.gal .info{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--plaster-dim,#d9c8b0);font-size:.9rem}
.gal .info b{font:400 1.05rem var(--font-display,serif);color:var(--plaster,#f5e9d7);letter-spacing:.04em;margin-right:10px}
@media (max-width:820px){
  .gal{inset:8px}
  .gal .body{grid-template-columns:1fr;grid-template-rows:minmax(200px,48%) 1fr}
  .gal .view{order:-1;padding:10px 12px;border-bottom:1px solid var(--g-line)}
  .gal .sheet{border-right:0;padding:10px 12px}
  .gal .card img{height:64px;min-width:104px} .gal .card.wk img{height:52px;min-width:86px}
  .gal .foot{flex-wrap:wrap} .gal .info{flex-basis:100%}
}
/* artist mode */
.art .body{flex:1;min-height:0;display:grid;grid-template-columns:340px 1fr}
.art aside{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--g-line);background:rgba(245,233,215,.025)}
.art .scroll{flex:1;min-height:0;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:18px}
.art h3{margin:0 0 10px;font:500 .72rem/1 var(--font-body,system-ui);letter-spacing:.16em;text-transform:uppercase;color:var(--verdigris,#7cc3ad)}
.art .tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.art .tiles button{height:auto;min-height:62px;flex-direction:column;gap:6px;padding:10px 6px;background:var(--g-raise);border-color:var(--g-line);font-size:.9rem}
.art .tiles button svg{width:24px;height:24px;opacity:.85}
.art .tiles button[aria-pressed=true]{background:rgba(124,195,173,.16);border-color:var(--verdigris,#7cc3ad);color:#fff}
.art .tiles button[aria-pressed=true] svg{color:var(--verdigris,#7cc3ad);opacity:1}
.art .tiles button:last-child{grid-column:1/-1;flex-direction:row;min-height:48px}
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
.art .btns button.ok:hover:not(:disabled){background:#95d3bf}
.art .stage{min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;padding:22px;background:radial-gradient(ellipse at 50% 40%,#1a2a3a,#0b141d 75%)}
.art .stage canvas{display:block;box-shadow:0 10px 40px rgba(0,0,0,.6);background:#0e1216}
.art .ask{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(4,8,12,.6);z-index:2}
.art .ask>div{width:min(380px,calc(100% - 32px));padding:20px 22px;background:#13212f;border:1px solid var(--g-line);border-radius:6px;box-shadow:0 18px 60px rgba(0,0,0,.5)}
.art .ask h3{font:400 1.2rem/1.2 var(--font-display,serif);letter-spacing:.04em;text-transform:none;color:var(--plaster,#f5e9d7);margin:0 0 18px}
.art .ask .btns{grid-template-columns:repeat(3,1fr)}
@media (max-width:820px){
  .art .body{grid-template-columns:1fr;grid-template-rows:minmax(180px,42%) 1fr}
  .art .stage{order:-1;padding:10px}
  .art aside{border-right:0;border-top:1px solid var(--g-line)}
  .art .tiles{grid-template-columns:repeat(3,1fr)} .art .tiles button:last-child{grid-column:auto;flex-direction:column;min-height:62px}
  .art header{padding-left:10px}
}
`;
  document.head.appendChild(css);

  /* ---------- the gallery ---------- */
  const gal = document.createElement('div'); gal.className = 'gal'; gal.hidden = true;
  gal.setAttribute('role', 'dialog'); gal.setAttribute('aria-label', 'Pictures');
  gal.innerHTML = `<header><h2>Pictures</h2><span class="sum"></span><button class="ib" data-a="close" title="Close (L)" aria-label="Close">${ICON.close}</button></header>
    <div class="body"><div class="sheet"></div>
      <div class="view"><div class="big"></div>
        <div class="foot"><div class="info"></div>
          <button class="pri" data-a="art" title="Artist mode">${ICON.easel}<span>Artist mode</span></button>
          <button data-a="dl" title="Download as PNG">${ICON.download}<span>Download PNG</span></button>
          <button class="ib" data-a="del" title="Delete" aria-label="Delete">${ICON.trash}</button></div></div></div>`;
  const $ = (root, q) => root.querySelector(q);
  const sheet = $(gal, '.sheet'), big = $(gal, '.big'), info = $(gal, '.info');

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
    b.className = 'card ' + (w ? 'wk' : 'ph') + (sel && sel.p === p && sel.w === (w || null) ? ' sel' : '');
    const im = new Image(); im.src = thumb(item); im.alt = '';
    const lab = document.createElement('span');
    if (w) lab.textContent = styleName(w.style);
    else lab.innerHTML = `Photo ${p.n}<em>${hhmm(p.time)}</em>`;
    b.append(im, lab);
    b.addEventListener('click', () => select(p, w || null));
    return b;
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
    big.textContent = ''; info.textContent = '';
    if (!sel) big.innerHTML = photos.length ? '<span class="none">No picture selected</span>' : '';
    else {
      const item = sel.w || sel.p, m = item.meta; big.appendChild(item.canvas);
      const b = document.createElement('b'); b.textContent = sel.w ? styleName(sel.w.style) : `Photo ${sel.p.n}`;
      const rest = sel.w ? `${m.width} × ${m.height} · Photo ${sel.p.n}`
        : `${m.width} × ${m.height}` + (m.on ? ` · ${Math.round(m.focalLength)} mm · ${fmtF(m.fNumber)} · ${fmtDist(m.focusDistance)} · ${fmtEV(m.ev)}` : '');
      info.append(b, rest);
    }
    $(gal, '[data-a="dl"]').disabled = $(gal, '[data-a="del"]').disabled = !sel;
    $(gal, '[data-a="art"]').disabled = !(sel && !sel.w);
  }
  function select(p, w) {
    sel = sel && sel.p === p && sel.w === w ? sel : { p, w };
    for (const c of sheet.querySelectorAll('.card.sel')) c.classList.remove('sel');
    buildSheet(); showSel();
    sheet.querySelector('.card.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function build() { if (sel && !photos.includes(sel.p)) sel = null; buildSheet(); showSel(); }

  function add(c) {
    const meta = { ...c.photo }; delete meta.depth;
    photos.push({ n: ++count, canvas: c, meta, time: meta.time || Date.now(), works: [] });
    while (photos.length > KEEP) photos.shift();
    if (!gal.hidden) build();
  }
  function open() { if (document.pointerLockElement) document.exitPointerLock(); sel = null; build(); gal.hidden = false; }
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
    else if (a === 'dl' && sel) download(sel.w || sel.p);
    else if (a === 'del' && sel) {
      if (sel.w) sel.p.works.splice(sel.p.works.indexOf(sel.w), 1); else photos.splice(photos.indexOf(sel.p), 1);
      sel = null; build();
    }
    else if (a === 'art' && sel && !sel.w) openArt(sel.p);
  });

  /* ---------- artist mode ---------- */
  const art = document.createElement('div'); art.className = 'art'; art.hidden = true;
  art.setAttribute('role', 'dialog'); art.setAttribute('aria-label', 'Artist mode');
  art.innerHTML = `<header><button class="ib" data-a="back" title="Back to the pictures (Esc)" aria-label="Back">${ICON.back}</button><h2>Artist mode</h2><span class="src"></span></header>
    <div class="body"><aside><div class="scroll">
        <section><h3>Style</h3><div class="tiles">${STYLES.map(([id, name]) => `<button type="button" data-style="${id}" aria-pressed="false">${ICON[id]}${name}</button>`).join('')}</div></section>
        <section class="opts" hidden><h3></h3><form></form><button type="button" class="reset" data-a="reset">Reset to default</button></section></div>
      <div class="dock"><div class="state"><span class="st"></span><span class="bar"><i></i></span></div>
        <div class="btns"><button class="pri" data-a="render" disabled>Render</button><button class="ok" data-a="save" disabled>Save</button></div></div></aside>
      <div class="stage"><canvas></canvas></div></div>
    <div class="ask" hidden><div role="alertdialog" aria-label="Unsaved artwork"><h3>Save this artwork?</h3>
      <div class="btns"><button class="pri" data-a="ask-save">Save</button><button data-a="ask-del">Delete</button><button data-a="ask-cancel">Cancel</button></div></div></div>`;
  document.body.append(gal, art);
  const stage = $(art, '.stage canvas'), g2 = stage.getContext('2d'), form = $(art, 'form'), stateEl = $(art, '.state'), ask = $(art, '.ask');
  // A: the photo, its style, the job in progress and the finished render, and whether it has been saved
  const A = { p: null, style: null, job: null, run: 0, result: null, saved: false, after: null };
  let ptModule = null;

  function setState(text, frac, done) {
    $(stateEl, '.st').textContent = text; $(stateEl, '.bar i').style.width = (frac == null ? 0 : Math.round(frac * 100)) + '%';
    $(stateEl, '.bar').style.visibility = frac == null ? 'hidden' : 'visible'; stateEl.classList.toggle('done', !!done);
  }
  function syncButtons() {
    const rb = $(art, '[data-a="render"]');
    rb.textContent = A.job ? 'Cancel' : 'Render'; rb.classList.toggle('pri', !A.job); rb.disabled = !A.job && !A.style;
    $(art, '[data-a="save"]').disabled = !(A.result && !A.saved && !A.job);
  }
  // the picture on the stage is drawn as large as the stage allows, keeping its shape
  function fitStage() {
    const box = stage.parentNode, cs = getComputedStyle(box), bw = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      bh = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom), k = Math.min(bw / stage.width, bh / stage.height);
    if (k > 0 && isFinite(k)) { stage.style.width = Math.floor(stage.width * k) + 'px'; stage.style.height = Math.floor(stage.height * k) + 'px'; }
  }
  new ResizeObserver(() => { if (!art.hidden) fitStage(); }).observe($(art, '.stage'));
  const sizeStage = (w, h) => { if (stage.width !== w || stage.height !== h) { stage.width = w; stage.height = h; fitStage(); } };
  function showSource() { sizeStage(A.p.canvas.width, A.p.canvas.height); g2.drawImage(A.p.canvas, 0, 0); }

  // the settings groups shown for the chosen style: the 3D render's own, or the painting time and the style's own
  const formGroups = () => A.style === 'render3d' ? ['render3d'] : ['all', A.style];
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
      let out;
      if (style === 'render3d') out = await trace(p, ctl.signal, live, t0);
      else {
        const { applyEffect } = await import('./effects.js');
        const dur = QS.all.duration * 1000;
        setState('Painting', 0);
        out = await applyEffect(style, p.canvas, { ...QS[style], seed: (Date.now() & 0xffff), duration: dur, signal: ctl.signal,
          onFrame: (c, k) => { if (!live()) return; sizeStage(c.width, c.height);
            g2.drawImage(c, 0, 0); setState(`Painting ${Math.round(k * 100)} %`, k); } });
      }
      return out;
    })();
    try {
      const out = await job.done;
      if (!live()) return;
      out.photo = { ...p.meta, width: out.width, height: out.height, effect: style, settings: style === 'render3d' ? { ...QS.render3d } : { ...QS.all, ...QS[style] }, time: Date.now() };
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
  // the path tracer, from the camera the photo was taken with: its matrices are in the scene's frame of the time,
  // which the floating origin has moved by (origin then - origin now) since
  async function trace(p, signal, live, t0) {
    const m = p.meta, Q = QS.render3d;
    const cam = new THREE.PerspectiveCamera(m.fov, m.aspect, m.near, m.far);
    const mw = new THREE.Matrix4().fromArray(m.matrixWorld), o0 = m.origin || { x: 0, y: 0, z: 0 };
    mw.elements[12] += o0.x - origin.x; mw.elements[13] += o0.y - origin.y; mw.elements[14] += o0.z - origin.z;
    cam.matrixAutoUpdate = false; cam.matrix.copy(mw); cam.matrix.decompose(cam.position, cam.quaternion, cam.scale); cam.updateMatrixWorld(true);
    cam.projectionMatrix.fromArray(m.projectionMatrix); cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    const W = Math.round(p.canvas.width * Q.scale), H = Math.round(p.canvas.height * Q.scale);
    const phases = { world: 'Loading the world', scene: 'Gathering the scene', albedo: 'Colours', bvh: 'Building', trace: 'Tracing', denoise: 'Filtering', done: 'Finished' };
    let first = true;
    setState(phases.world, 0);
    const { pathTrace } = ptModule = await import('./pathtrace.js');
    // artist mode covers the game, so the game draws nothing while the picture is traced and leaves the GPU to it; the
    // world also stands still, so that what moves in it (the trains, the boats, the people) stands where it stood in
    // every pass of the picture, and the game leaves the page's time to the picture
    const draw = renderer.render; renderer.render = () => {};
    const V = window.__village, wasPaused = V ? V.paused : true;
    if (V) V.paused = true;
    try {
      return await pathTrace({ renderer, scene, camera: cam, signal, width: W, height: H,
        timeBudget: Q.timeBudget, startTime: t0,
        samples: Q.samples, bounces: Q.bounces, horizonReach: Q.horizonReach, ptReach: Q.ptReach, hazeVisibility: Q.hazeVisibility, denoise: Q.denoise, materials: Q.materials, reflectivity: Q.reflectivity, haze: Q.haze,
        onProgress: ({ phase, fraction }) => { if (live() && (phase !== 'trace' || first)) setState(phases[phase] || phase, fraction || 0); },
        // the first picture, shown before the tracing begins, leaves the phase as it is
        onFrame: (c, k) => { if (!live()) return; if (first) { sizeStage(W, H); first = false; } g2.drawImage(c, 0, 0, W, H); if (k > 0) setState(`Tracing ${Math.round(k * 100)} %`, k); } });
    } finally { renderer.render = draw; if (V) V.paused = wasPaused; }
  }
  function save() {
    const r = A.result; if (!r || A.saved || A.job) return;
    r.p.works.push({ canvas: r.canvas, meta: r.canvas.photo, time: r.canvas.photo.time, style: r.style });
    A.saved = true; setState('Saved', 1, true); syncButtons(); build();
  }
  // leaving artist mode: an unsaved finished render is offered to be saved first; then() runs once it has closed
  function leaveArt(then) {
    if (A.result && !A.saved && !A.job) { A.after = then || null; ask.hidden = false; $(ask, '[data-a="ask-save"]').focus(); return; }
    shutArt(); then && then();
  }
  // the path tracer keeps the scene of the last view it traced, for another render of it; it is let go on leaving
  function shutArt() {
    (A.job ? stopJob() : Promise.resolve()).then(() => { if (ptModule && art.hidden) ptModule.releasePathTrace(); });
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
    if (e.code === 'Escape' || (e.code === 'KeyL' && !e.repeat)) { e.preventDefault(); close(); return true; }
    if (!field && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      e.preventDefault();
      const list = []; for (let i = photos.length - 1; i >= 0; i--) { list.push([photos[i], null]); for (const w of photos[i].works) list.push([photos[i], w]); }
      if (!list.length) return true;
      let i = sel ? list.findIndex(([p, w]) => p === sel.p && w === sel.w) : -1;
      i = e.code === 'ArrowRight' ? Math.min(list.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      select(...list[i]);
    }
    return true;
  }

  return { add, open, close, download, handleKey, photos, get isOpen() { return !gal.hidden; }, get artOpen() { return !art.hidden; },
    get settings() { return QS; }, openArt: i => openArt(photos[i]), select: (i, j) => select(photos[i], j == null ? null : photos[i].works[j]) };
}
