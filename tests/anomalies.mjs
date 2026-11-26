/* The anomaly suite: loads the game in headless Chrome, visits villages and stations on several islands, and looks for
   the faults of the built world that a walker meets: steps that end against a wall or over a drop, steps sunk into the
   ground, sheer drops beside a stair with nothing to stop a fall, doors that cannot be reached, railings too short to
   be of use, terrace walls hanging in the air, squares left on a pillar of ground, anything built in a station's yard,
   and errors thrown by the page.

   Usage (from the repository):   cd tests && npm install && node anomalies.mjs [options]
     --seeds A,B,C     islands to sweep (default: three fixed seeds)
     --spots N         village spots visited on each island (default 8)
     --cases FILE      places to check, each a scene link with no faults allowed within 25 m (default anomaly-cases.json)
     --no-sweep        check the cases only
     --shots           save a screenshot of each finding
     --out DIR         where the report goes (default out)
     --link-base URL   where the links in the report open the game (default http://localhost:8765, the repository
                       served locally; https://markhammond.me/play/coast for the published game)
   The report is written to out/report.md and out/report.json: every finding with its check, where it is, what was
   measured and a link that opens the game standing beside it. The exit code is 1 when a case has a finding of
   severity "error", or the sweep finds more errors of any check than anomaly-baseline.json allows. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const SEEDS = String(arg('seeds', 'COAST,8BO29PK7,LANTERN')).split(',').filter(Boolean);
const SPOTS = +arg('spots', 8), SHOTS = !!arg('shots', false), SWEEP = !process.argv.includes('--no-sweep');
const OUT = path.resolve(HERE, arg('out', 'out')), CASES = path.resolve(HERE, arg('cases', 'anomaly-cases.json'));
const BASE = path.resolve(HERE, 'anomaly-baseline.json');
const LINK_BASE = String(arg('link-base', 'http://localhost:8765')).replace(/\/$/, '');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// a static server for the repository, on a free port
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.css': 'text/css' };
const server = http.createServer((q, r) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

/* ---------- the checks, run inside the page ----------
   Each finding: {check, sev ('error' or 'warn'), x, z, y, note}. y is the height to look at. */
function audit(R) {
  const V = window.__village, P = V.player, out = [], C = 40;
  const near = (x, z) => Math.hypot(x - R.x, z - R.z) <= R.r;
  const add = (check, sev, x, z, y, note) => { if (near(x, z)) out.push({ check, sev, x: +x.toFixed(1), z: +z.toFixed(1), y: +y.toFixed(2), note }); };
  const chunksNear = (x, z) => { const a = []; const cx = Math.floor(x / C), cz = Math.floor(z / C);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { for (const ch of V.chunks.values()) if (ch.cx === cx + i && ch.cz === cz + j) a.push(ch); } return a; };
  const inObb = (o, x, z, m = 0) => { const dx = x - o.x, dz = z - o.z, c = Math.cos(o.rot), s = Math.sin(o.rot); return Math.abs(dx * c - dz * s) <= o.hw + m && Math.abs(dx * s + dz * c) <= o.hd + m; };
  const isRail = o => o.bot !== undefined && Math.min(o.hw, o.hd) <= 0.06;
  // what stands at (x,z) higher than y: 'rail', 'wall' or null
  const blocker = (x, z, y) => { let b = null;
    for (const ch of chunksNear(x, z)) { for (const o of ch.obbs) { if (o.roof || !inObb(o, x, z)) continue; if (o.top <= y) continue; if (o.bot !== undefined && o.bot > y + 1.75) continue; if (isRail(o)) b = b || 'rail'; else b = 'wall'; }
      for (const c of ch.circles) if (Math.hypot(x - c.x, z - c.z) <= c.r && c.top > y) b = 'wall'; }
    return b; };
  // walking out from (x,z) along (ux,uz): the first thing in the way within d, or the surface reached
  const walkOut = (x, z, ux, uz, from, d, y, at) => { for (let e = from; e <= d + 1e-6; e += 0.05) { const b = blocker(x + ux * e, z + uz * e, y + 0.5); if (b) return { b }; }
    const q = at ?? d + 0.1, t = V.topAt(x + ux * q, z + uz * q, y + 0.5); return { t }; };
  const chunks = [...V.chunks.values()].filter(ch => ch.lod === 0 && Math.hypot(ch.cx * C + 20 - R.x, ch.cz * C + 20 - R.z) < R.r + 30);
  for (const ch of chunks) {
    for (const o of ch.obbs) {
      // ---- stairs
      if (o.stair) {
        const alongU = o.stair === 'bastion' || o.stair === 'citadel', half = alongU ? o.hw : o.hd, side = alongU ? o.hd : o.hw;
        const c = Math.cos(o.rot), s = Math.sin(o.rot), fx = alongU ? c : s, fz = alongU ? -s : c, lx = alongU ? s : c, lz = alongU ? c : -s;
        const g = V.heightAt(o.x, o.z);
        if (o.top < g - 0.3) add('stair-buried', 'error', o.x, o.z, g, `a ${o.stair} step's tread lies ${(g - o.top).toFixed(2)} m under the ground`);
        for (const sg of [-1, 1]) {
          const ex = o.x + sg * fx * (half + 0.3), ez = o.z + sg * fz * (half + 0.3);
          let mate = false; for (const c2 of chunksNear(ex, ez)) { for (const q of c2.obbs) if (q !== o && q.stair === o.stair && Math.abs(q.top - o.top) < 0.6 && inObb(q, ex, ez, 0.05)) { mate = true; break; } if (mate) break; }
          if (mate) continue;
          // (the drop is measured just beyond the edge, so that ground which goes on falling gently beyond the last
          // step is not counted against it)
          const w = walkOut(o.x, o.z, sg * fx, sg * fz, half - 0.2, half + 0.5, o.top, half + 0.15);
          if (w.b === 'wall') add('stair-end-wall', 'error', ex, ez, o.top, `a ${o.stair} flight ends against a wall`);
          else if (w.b !== 'rail' && w.t !== null && o.top - w.t > 1.0) add('stair-end-drop', 'error', ex, ez, o.top, `a ${o.stair} flight ends ${(o.top - w.t).toFixed(2)} m above the ground beyond it, unguarded`);
          else if (w.b !== 'rail' && w.t !== null && o.top - w.t > 0.6) add('stair-end-riser', 'warn', ex, ez, o.top, `a ${o.stair} flight's last riser is ${(o.top - w.t).toFixed(2)} m high`);
          else if (w.b !== 'rail' && w.t !== null && w.t - o.top > 0.45) add('stair-end-step-up', 'warn', ex, ez, o.top, `a ${o.stair} flight ends ${(w.t - o.top).toFixed(2)} m below the surface beyond it`);
        }
        for (const sg of [-1, 1]) {
          const w = walkOut(o.x, o.z, sg * lx, sg * lz, side - 0.2, side + 0.5, o.top);
          if (w.b || w.t === null || o.top - w.t <= 1.5) continue;
          if (o.stair === 'street') add('street-side-drop', 'warn', o.x + sg * lx * side, o.z + sg * lz * side, o.top, `${(o.top - w.t).toFixed(2)} m drop beside a street flight`);
          else add('stair-side-drop', 'error', o.x + sg * lx * side, o.z + sg * lz * side, o.top, `${(o.top - w.t).toFixed(2)} m unguarded drop beside a ${o.stair} stair`);
        }
        if (o.stair !== 'yard' && V.stCut(o.x, o.z, 0)) add('yard-intrusion', 'error', o.x, o.z, o.top, `a ${o.stair} step in a station's yard`);
      }
      // ---- terrace walls of the olive groves and farms
      if (o.twall !== undefined) {
        const c = Math.cos(o.rot), s = Math.sin(o.rot); let lo = 1e9, hi = -1e9;
        for (const u of [-o.hw, 0, o.hw]) for (const v of [-o.hd, o.hd]) { const h = V.heightAt(o.x + c * u + s * v, o.z - s * u + c * v); lo = Math.min(lo, h); hi = Math.max(hi, h); }
        if (lo < o.twall - 0.15) add('terrace-wall-hanging', 'error', o.x, o.z, o.top, `a terrace wall's foot stands ${(o.twall - lo).toFixed(2)} m above the ground`);
        if (V.stCut(o.x, o.z, 0)) add('yard-intrusion', 'error', o.x, o.z, o.top, `a terrace wall in a station's yard`);
      }
    }
    // ---- railings: runs of iron railing too short to be of use
    { const segs = ch.obbs.filter(isRail).map(o => { const long = o.hd >= o.hw, L = 2 * Math.max(o.hw, o.hd), c = Math.cos(o.rot), s = Math.sin(o.rot), ax = long ? s : c, az = long ? c : -s;
        return { a: [o.x - ax * L / 2, o.z - az * L / 2], b: [o.x + ax * L / 2, o.z + az * L / 2], L, y: o.bot, grp: -1 }; });
      let gid = 0; const touch = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.25;
      for (const sgm of segs) { if (sgm.grp >= 0) continue; sgm.grp = gid; const st = [sgm];
        while (st.length) { const q = st.pop(); for (const r of segs) if (r.grp < 0 && (touch(q.a, r.a) || touch(q.a, r.b) || touch(q.b, r.a) || touch(q.b, r.b))) { r.grp = gid; st.push(r); } } gid++; }
      for (let k = 0; k < gid; k++) { const G = segs.filter(q => q.grp === k), L = G.reduce((a, q) => a + q.L, 0);
        if (L < 2.3) add('railing-short', 'warn', G[0].a[0], G[0].a[1], G[0].y + 0.9, `a railing ${L.toFixed(2)} m long`); } }
    // ---- doors of houses
    for (const D of ch.doors || []) {
      if (D.kind !== 'house' && D.kind !== 'tower') continue;
      const w = V.roomFns.localToWorld({ x: D.x, z: D.z, rot: D.rot }, D.dx, D.d / 2 + 0.6), fx = w.x ?? w[0], fz = w.z ?? w[1];
      const t = V.topAt(fx, fz, D.y + 0.8);
      if (t === null) add('door-blocked', 'error', fx, fz, D.y + 1, 'something stands across a door');
      else if (t - D.y > 0.8) add('door-step-high', 'error', fx, fz, D.y + 1, `the surface outside a door is ${(t - D.y).toFixed(2)} m above its threshold`);
      else if (t - D.y > 0.45) add('door-step', 'warn', fx, fz, D.y + 1, `a step of ${(t - D.y).toFixed(2)} m up from a door`);
      else if (D.y - t > 0.8) add('door-above-ground', 'error', fx, fz, D.y + 1, `a door ${(D.y - t).toFixed(2)} m above the ground before it`);
      if (V.stCut(D.x, D.z, 0)) add('yard-intrusion', 'error', D.x, D.z, D.y + 1, `a house in a station's yard`);
    }
    // ---- squares
    const S = ch.piazza;
    // (a terrace square overlooks a drop on its open side by design; one with the ground fallen away on most of its
    // sides stands on a pillar)
    if (S && !S.peak) { let n = 0, lo = 1e9; for (let k = 0; k < 16; k++) { const a = k / 16 * 6.283, h = V.heightAt(S.x + Math.cos(a) * (S.r + 3), S.z + Math.sin(a) * (S.r + 3)); lo = Math.min(lo, h); if (S.level - h > 4) n++; }
      if (n >= 11) add('square-on-pillar', 'error', S.x, S.z, S.level, `a square with the ground more than 4 m below it on ${n} of 16 sides, ${(S.level - lo).toFixed(2)} m at most`);
      if (V.stCut(S.x, S.z, S.r)) add('yard-intrusion', 'error', S.x, S.z, S.level, `a square in a station's yard`);
      // the square's edge: walking out from its paving, a drop of more than 1.5 m with nothing to stop a fall
      for (let k = 0; k < 48; k++) { const a = k / 48 * 6.283, ux = Math.cos(a), uz = Math.sin(a), x = S.x + ux * (S.r - 0.5), z = S.z + uz * (S.r - 0.5);
        if (V.topAt(x, z, S.level + 0.3) === null) continue;   // a building stands at the edge here
        const w = walkOut(x, z, ux, uz, 0.2, 2.6, S.level);
        if (!w.b && w.t !== null && S.level - w.t > 1.5) add('square-edge-drop', 'error', x + ux * 2, z + uz * 2, S.level, `the edge of a square open over a drop of ${(S.level - w.t).toFixed(2)} m`); } }
  }
  return out;
}

/* ---------- driving the page ---------- */
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=metal', '--window-size=1280,720'] });
const report = { cases: [], sweep: [], errors: [] };
async function openPage(query) {
  const p = await browser.newPage(); await p.setViewport({ width: 1280, height: 720 });
  p.on('pageerror', e => report.errors.push({ query, msg: e.message }));
  p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) report.errors.push({ query, msg: m.text().slice(0, 300) }); });
  await p.goto(`${ORIGIN}/index.html?${query}`); await p.waitForFunction(() => window.__village && window.__village.player, { timeout: 180000 });
  await sleep(3000);
  if (await p.evaluate(() => window.__village.mode) !== 'street') { await p.evaluate(() => window.__village.toggleView()); await sleep(500); }
  return p;
}
// stand at (x,z) and wait until the blocks round it are built in full
async function goTo(p, x, z) {
  await p.evaluate((x, z) => { const V = window.__village, P = V.player; P.x = x; P.z = z; P.y = V.heightAt(x, z) + 30; P.vy = 0; P.holdT = 1e9; }, x, z);
  let last = -1; for (let t = 0; t < 40; t++) { await sleep(500);
    const n = await p.evaluate((x, z) => { let k = 0, all = 0; for (const ch of window.__village.chunks.values()) if (Math.hypot(ch.cx * 40 + 20 - x, ch.cz * 40 + 20 - z) < 70) { all++; if (ch.lod === 0) k++; } return all && k === all ? k : -1; }, x, z);
    if (n > 0 && n === last) return; last = n; }
}
// a place to stand within sight of a finding, and the link to it
async function viewOf(p, f) {
  return p.evaluate(async f => { const V = window.__village, P = V.player;
    for (const r of [5, 8, 3]) for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283, x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r, t = V.topAt(x, z, f.y + 4);
      if (t === null || Math.abs(t - f.y) > 4) continue;
      P.x = x; P.z = z; P.y = t; P.vy = 0; P.holdT = 1e9; V.setYaw(Math.atan2(-(f.x - x), -(f.z - z))); V.setFpPitch(Math.atan2(f.y - (t + 1.6), Math.hypot(f.x - x, f.z - z)));
      return await V.share.link(); }
    return null; }, f);
}
async function auditAt(p, x, z, r, tag) {
  await goTo(p, x, z);
  const found = await p.evaluate(audit, { x, z, r });
  for (const f of found) { f.link = await viewOf(p, f); if (f.link) f.link = f.link.replace(ORIGIN, LINK_BASE);
    if (SHOTS) { await sleep(1500); const n = `${tag}-${f.check}-${Math.round(f.x)}_${Math.round(f.z)}.png`; await p.screenshot({ path: path.join(OUT, n) }); f.shot = n; } }
  return found;
}
fs.mkdirSync(OUT, { recursive: true });
const key = f => `${f.check}:${Math.round(f.x)}:${Math.round(f.z)}`;

// ---- the cases: places once reported, which must now be clean
const cases = fs.existsSync(CASES) ? JSON.parse(fs.readFileSync(CASES, 'utf8')) : [];
for (const c of cases) {
  const s = new URL(c.link).searchParams.get('s'), p = await openPage(`s=${s}`);
  const at = await p.evaluate(() => ({ x: window.__village.player.x, z: window.__village.player.z }));
  const found = await auditAt(p, at.x, at.z, 25, 'case');
  report.cases.push({ ...c, findings: found }); await p.close();
  console.log(`case ${c.name}: ${found.filter(f => f.sev === 'error').length} errors, ${found.filter(f => f.sev === 'warn').length} warnings`);
}

// ---- the sweep: villages and stations on each island
if (SWEEP) for (const seed of SEEDS) {
  const p = await openPage(`seed=${encodeURIComponent(seed)}`);
  const spots = await p.evaluate(n => { const V = window.__village, G = V.__gen, P = V.player, out = [];
    for (let x = P.x - 24000; x <= P.x + 24000 && out.length < 400; x += 700) { const zr = V.railZ(x);
      for (let dz = -900; dz <= 900; dz += 120) { const z = zr + dz, cx = Math.floor(x / 40), cz = Math.floor(z / 40);
        if (G.isVillage(cx, cz) && out.every(q => Math.hypot(q[0] - x, q[1] - z) > 600)) { out.push([cx * 40 + 20, cz * 40 + 20, 'village']); break; } }
      const S = V.stationNear(x, 360); if (S && out.every(q => Math.hypot(q[0] - S.x, q[1] - S.z) > 200)) out.push([S.x, S.z, 'station']); }
    const v = out.filter(q => q[2] === 'village'), s = out.filter(q => q[2] === 'station'), pick = [];
    for (let i = 0; pick.length < n && i < Math.max(v.length, s.length); i++) { if (v[i * 3]) pick.push(v[i * 3]); if (pick.length < n && s[i * 2]) pick.push(s[i * 2]); }
    return pick; }, SPOTS);
  const seen = new Set(); let k = 0;
  for (const [x, z, kind] of spots) { const found = await auditAt(p, x, z, 60, `${seed}-${k++}`);
    for (const f of found) if (!seen.has(key(f))) { seen.add(key(f)); report.sweep.push({ seed, spot: kind, ...f }); }
    console.log(`${seed} ${kind} ${Math.round(x)},${Math.round(z)}: ${found.length} findings`); }
  await p.close();
}
await browser.close(); server.close();

/* ---------- the report ---------- */
const count = (list, sev) => { const m = {}; for (const f of list) if (!sev || f.sev === sev) m[f.check] = (m[f.check] || 0) + 1; return m; };
const sweepErr = count(report.sweep, 'error'), base = fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : {};
const over = Object.entries(sweepErr).filter(([k, n]) => n > (base[k] || 0));
const caseFail = report.cases.filter(c => c.findings.some(f => f.sev === 'error'));
if (process.argv.includes('--update-baseline')) fs.writeFileSync(BASE, JSON.stringify(sweepErr, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const md = ['# Anomaly report', '', `Islands: ${SEEDS.join(', ')}; ${SPOTS} spots each.`, '',
  '## Cases', '', '| Case | Errors | Warnings |', '|---|---|---|',
  ...report.cases.map(c => `| [${c.name}](${c.link}) | ${c.findings.filter(f => f.sev === 'error').length} | ${c.findings.filter(f => f.sev === 'warn').length} |`), '',
  '## Sweep', '', '| Check | Errors | Warnings | Allowed errors |', '|---|---|---|---|',
  ...[...new Set(report.sweep.map(f => f.check))].sort().map(k => `| ${k} | ${count(report.sweep, 'error')[k] || 0} | ${count(report.sweep, 'warn')[k] || 0} | ${base[k] || 0} |`), '',
  '## Findings', '', ...[...report.cases.flatMap(c => c.findings.map(f => ({ seed: c.name, ...f }))), ...report.sweep].map(f => `- **${f.check}** (${f.sev}) ${f.seed}: ${f.note}${f.link ? ` — [open](${f.link})` : ''}${f.shot ? ` — ${f.shot}` : ''}`), '',
  '## Page errors', '', ...(report.errors.length ? report.errors.map(e => `- ${e.query}: ${e.msg}`) : ['None.']), ''];
fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n'));
console.log(`\nreport: ${path.join(OUT, 'report.md')}`);
console.log(`cases failing: ${caseFail.length}; sweep errors over the baseline: ${over.map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}; page errors: ${report.errors.length}`);
process.exit(caseFail.length || over.length || report.errors.length ? 1 : 0);
