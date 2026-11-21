/* ================= the art gallery: a building that shows the player's own pictures =================
   A single tall room, whitewashed inside and out, under a pitched roof of teal tiles with whitewashed gables at the
   front and back and three skylights in each slope, which let daylight fall into the room. The front has a tall arched doorway with a pair of blue
   doors standing open and, above it, a signboard hung at right angles to the wall from an iron bracket, showing an
   easel in black on white; the walls are whitewashed pure white, inside and out. Inside, a floor of pale limestone, a bench down the middle, and the pictures hung at
   eye level on the side and back walls, each lit by a picture light on the wall above it, under the open roof: a painting in a narrow black frame, a
   photograph in a white mount with a thinner black frame.

   buildArtGallery(pictures, opts) -> { group, size, pictures: [{ mesh, item }], walls }
     pictures   the pictures to hang, best first: [{ image (a canvas, image or ImageBitmap), painting (boolean),
                item (anything; returned with the mesh it is hung on) }]; at most GALLERY_SLOTS are hung
     opts.lights  whether to add a SpotLight for each picture and the room's own light (for a page of its own; the
                game lights its rooms itself)
     group      the building in its own frame: x across, z from the back wall (-) to the front (+), y up from the foot
                of the walls, the doorway in the middle of the front wall
     pictures   each picture's mesh (for a ray from the pointer), with the item it shows
     walls      the walls as boxes in the building's frame, { x, z, hw, hd }, for whoever keeps a walker out of them
   pickPictures(set, pictures): the pictures a gallery shows: the paintings, newest first, or the photographs where
   there are no paintings; set is the gallery's list of photos ({ canvas, time, works: [{ canvas, time }] }). Each is
   marked glow where it records the scene it was taken in, so that it can be gone to.
   pictureGlow(ow, oh): a faint warm glow round a frame ow by oh, on the wall behind it, for a picture marked glow.
*/
import * as THREE from 'three';

export const GALLERY = { w: 8.4, d: 11, h: 4.8, t: 0.45, pitch: 0.44, eave: 0.45, door: { w: 1.9, spring: 2.5 } };
export const GALLERY_SLOTS = 8;

const LIME = 0xfbfaf7, LIME_IN = 0xfbfaf7, SKIRT = 0xfbfaf7, BLUE = 0x24578f, OAK = 0x8a6a45, STONE = 0xd9cdb6;

// the paintings, newest first, or the photographs where there are none
const hasScene = (p, w) => !!((w && w.meta && w.meta.scene) || (p.meta && p.meta.scene));
export function pickPictures(photos) {
  const works = [];
  for (const p of photos) for (const w of p.works || []) works.push({ image: w.canvas, painting: true, time: w.time || p.time, glow: hasScene(p, w), item: { p, w } });
  if (works.length) return works.sort((a, b) => b.time - a.time).slice(0, GALLERY_SLOTS);
  return photos.map(p => ({ image: p.canvas, painting: false, time: p.time, glow: hasScene(p, null), item: { p, w: null } }))
    .sort((a, b) => b.time - a.time).slice(0, GALLERY_SLOTS);
}

// the glow round a frame ow by oh: a plane GLOW wider on every side, lying just off the wall behind the frame, whose
// light is added to the wall's and falls away from the frame's edge to nothing at GLOW
const GLOW = 0.22, GLOW_K = 0.09;
export function pictureGlow(ow, oh) {
  const W = ow + 2 * GLOW, H = oh + 2 * GLOW;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: new THREE.Vector2(W, H) }, uHalf: { value: new THREE.Vector2(ow / 2, oh / 2) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec2 uSize, uHalf; varying vec2 vUv;
      void main(){ vec2 p = (vUv - 0.5) * uSize; float d = length(max(abs(p) - uHalf, 0.0)), a = 1.0 - smoothstep(0.0, ${GLOW.toFixed(3)}, d);
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.72) * a * a * ${GLOW_K.toFixed(3)}, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat); m.renderOrder = 1; return m;
}

// a wall in the x-y plane, t thick (towards -z from z=0), rising to a gable of height g in the middle, with holes:
// { x, w, y0, y1, arch } (arch: a round head springing at y1 - w/2)
function wallGeo(len, h, t, holes = [], g = 0) {
  const s = new THREE.Shape(); s.moveTo(-len / 2, 0); s.lineTo(len / 2, 0); s.lineTo(len / 2, h); if (g) s.lineTo(0, h + g); s.lineTo(-len / 2, h); s.lineTo(-len / 2, 0);
  for (const o of holes) {
    const p = new THREE.Path(), r = o.w / 2;
    if (o.arch) { const sp = o.y1 - r; p.moveTo(o.x - r, o.y0); p.lineTo(o.x + r, o.y0); p.lineTo(o.x + r, sp); p.absarc(o.x, sp, r, 0, Math.PI, false); p.lineTo(o.x - r, o.y0); }
    else { p.moveTo(o.x - r, o.y0); p.lineTo(o.x + r, o.y0); p.lineTo(o.x + r, o.y1); p.lineTo(o.x - r, o.y1); p.lineTo(o.x - r, o.y0); }
    s.holes.push(p);
  }
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 18 }).translate(0, 0, -t);
}

// limewash: a faint unevenness of tone, so that the white does not read as plastic
function limeTex(base, seed = 1) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const col = new THREE.Color(base); g.fillStyle = '#' + col.getHexString(); g.fillRect(0, 0, 256, 256);
  let s = seed >>> 0 || 1; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 500; i++) { const x = R() * 256, y = R() * 256, r = 6 + R() * 30, a = 0.006 + R() * 0.012;
    g.fillStyle = R() < 0.5 ? `rgba(120,110,95,${a})` : `rgba(255,255,255,${a * 1.5})`; g.beginPath(); g.ellipse(x, y, r, r * (0.5 + R()), R() * 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(0.3, 0.3); return t;
}
// pale limestone flags, laid in courses of different lengths
function floorTex() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  let s = 7; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.fillStyle = '#cdbf9f'; g.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 4; row++) { let x = -R() * 128; while (x < 512) { const w = 96 + R() * 96, v = 200 + R() * 22;
    g.fillStyle = `rgb(${v + 14},${v + 6},${v - 12})`; g.fillRect(x + 2, row * 128 + 2, w - 4, 124); x += w; } }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
// roof tiles in the teal of the church spires and clock towers: the channels of the curved tiles running down the slope, each course lapping the one below
function tileTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  let s = 11; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.fillStyle = '#4f8f7d'; g.fillRect(0, 0, 256, 256);
  const cols = 6, rows = 4, cw = 256 / cols, rh = 256 / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = i * cw, y = j * rh, v = (R() - 0.5) * 26, gr = g.createLinearGradient(x, 0, x + cw, 0);
    const base = [116 + v * 0.6, 193 + v, 170 + v * 0.8], dk = k => `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`;
    gr.addColorStop(0, dk(0.62)); gr.addColorStop(0.35, dk(1.0)); gr.addColorStop(0.6, dk(1.08)); gr.addColorStop(1, dk(0.66));
    g.fillStyle = gr; g.fillRect(x, y, cw, rh - 3);
    g.fillStyle = 'rgba(40,14,8,0.45)'; g.fillRect(x, y + rh - 4, cw, 4);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1 / 1.3, 1 / 1.4); return t;
}
// the boarding under the tiles, seen from inside: limewashed boards laid along the room
function boardTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  let s = 5; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.fillStyle = '#efe9de'; g.fillRect(0, 0, 256, 256);
  for (let j = 0; j < 8; j++) { const v = (R() - 0.5) * 10; g.fillStyle = `rgb(${236 + v},${229 + v},${216 + v})`; g.fillRect(0, j * 32, 256, 30); g.fillStyle = 'rgba(90,75,55,0.25)'; g.fillRect(0, j * 32 + 30, 256, 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1 / 2, 1 / 1.3); return t;
}
// the signboard's face: an easel in black on white, two legs and a canvas, inside a black ring, with a black border
// round the board
function signTex() {
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  const ink = '#141414', paper = '#f4f2ec';
  g.fillStyle = paper; g.fillRect(0, 0, N, N);
  g.strokeStyle = ink; g.lineWidth = 16; g.strokeRect(22, 22, N - 44, N - 44);
  g.lineWidth = 12; g.beginPath(); g.arc(N / 2, N / 2, 180, 0, Math.PI * 2); g.stroke();
  g.lineCap = 'round';
  // the easel, plainly: two legs splayed from the top, and a canvas standing on them
  g.fillStyle = ink; g.lineWidth = 16;
  for (const fx of [186, 326]) { g.beginPath(); g.moveTo(256, 140); g.lineTo(fx, 380); g.stroke(); }
  g.fillRect(186, 156, 140, 112);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function buildArtGallery(pictures = [], opts = {}) {
  const { w: W, d: D, h: H, t: T } = GALLERY, hw = W / 2, hd = D / 2, dw = GALLERY.door.w, top = GALLERY.door.spring + dw / 2;
  const group = new THREE.Group(); group.name = 'art gallery';
  const limeOut = new THREE.MeshStandardMaterial({ color: 0xffffff, map: limeTex(LIME, 3), roughness: 0.92 });
  const limeIn = new THREE.MeshStandardMaterial({ color: 0xffffff, map: limeTex(LIME_IN, 5), roughness: 0.95 });
  const skirt = new THREE.MeshStandardMaterial({ color: SKIRT, roughness: 0.9 });
  const blue = new THREE.MeshStandardMaterial({ color: BLUE, roughness: 0.6 });
  const stone = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.85 });
  const oak = new THREE.MeshStandardMaterial({ color: OAK, roughness: 0.7 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.5 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.5, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xbcd6e6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false });
  const add = (geo, m, x = 0, y = 0, z = 0, ry = 0, cast = true) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = cast; o.receiveShadow = true; group.add(o); return o; };
  const box = (sx, sy, sz, m, x, y, z, ry = 0) => add(new THREE.BoxGeometry(sx, sy, sz), m, x, y + sy / 2, z, ry);

  // the walls, whitewashed outside and in: each wall is built twice, a hair apart, so that each face has its own
  // limewash (the outer a little warmer, the inner whiter)
  const door = { x: 0, w: dw, y0: 0, y1: top, arch: true }, PA = GALLERY.pitch, GH = hw * Math.tan(PA);
  const walls = [
    { len: W, z: hd, ry: 0, holes: [door], g: GH },        // the front, facing +z, with its gable
    { len: W, z: hd, ry: Math.PI, holes: [], g: GH },      // the back
    { len: D - 2 * T, z: hw, ry: Math.PI / 2, holes: [] },   // the right-hand side (x+), between front and back
    { len: D - 2 * T, z: hw, ry: -Math.PI / 2, holes: [] },  // the left-hand side
  ];
  for (const wl of walls) {
    const g = wallGeo(wl.len, H, T, wl.holes, wl.g || 0), o = new THREE.Group(); o.rotation.y = wl.ry;
    const out = new THREE.Mesh(g, [limeOut, limeOut]); out.position.z = wl.z; out.castShadow = out.receiveShadow = true;
    // the inner face: the same wall, its outer side hidden in the outer wall, its inner face whiter
    const inn = new THREE.Mesh(wallGeo(wl.len, H, 0.02, wl.holes, wl.g ? GH - T * Math.tan(PA) + 0.05 : 0), limeIn);
    inn.position.z = wl.z - T + 0.021; inn.receiveShadow = true;
    o.add(out, inn); group.add(o);
    // a band round the foot, outside, in the same white (the game's gallery has none)
    if (wl.holes.length) for (const s of [-1, 1]) { const L = (wl.len - dw) / 2; const b = new THREE.Mesh(new THREE.BoxGeometry(L, 0.42, 0.03), skirt); b.position.set(s * (dw / 2 + L / 2), 0.21, wl.z + 0.015); o.add(b); }
    else { const b = new THREE.Mesh(new THREE.BoxGeometry(wl.len + (wl.ry === 0 || wl.ry === Math.PI ? 0 : 2 * T) + 0.06, 0.42, 0.03), skirt); b.position.set(0, 0.21, wl.z + 0.015); o.add(b); }
  }
  // the roof: a pitched roof of teal tiles over the gables, its eaves overhanging the side walls, with ridge tiles
  // along the top and three skylights in each slope. Inside, the room is open to the roof: limewashed boarding under
  // the tiles, carried by a ridge beam and tie beams across the room at the height of the side walls.
  const OH = GALLERY.eave, OZ = 0.3, Ls = (hw + OH) / Math.cos(PA), eY = H - OH * Math.tan(PA), ZL = hd + OZ;
  const tiles = new THREE.MeshStandardMaterial({ map: tileTex(), roughness: 0.85, side: THREE.DoubleSide });
  const boards = new THREE.MeshStandardMaterial({ map: boardTex(), roughness: 0.9, side: THREE.DoubleSide });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e4e33, roughness: 0.8 });
  const lead = new THREE.MeshStandardMaterial({ color: 0x5f6468, roughness: 0.6, metalness: 0.2 });
  const SKY = [-3.4, 0, 3.4].map(v => ({ v, u: Ls * 0.52, lv: 1.1, lu: 1.5 }));   // along the room, up the slope, and their sizes
  for (const sd of [1, -1]) {
    // the slope's frame: v along the room, u up the slope from the eave, t out of the roof
    const E = new THREE.Vector3(sd * (hw + OH), eY, 0), dU = new THREE.Vector3(-sd * Math.cos(PA), Math.sin(PA), 0), nT = new THREE.Vector3(sd * Math.sin(PA), Math.cos(PA), 0);
    // v runs towards -z on the right-hand slope and +z on the left, so that each frame is a rotation, not a mirror image
    const M = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -sd), dU, nT).setPosition(E);
    const slab = (t0, t1, u0, mat, cast) => { const sh = new THREE.Shape(); sh.moveTo(-ZL, u0); sh.lineTo(ZL, u0); sh.lineTo(ZL, Ls); sh.lineTo(-ZL, Ls); sh.lineTo(-ZL, u0);
      for (const k of SKY) { const p = new THREE.Path(); p.moveTo(k.v - k.lv / 2, k.u - k.lu / 2); p.lineTo(k.v - k.lv / 2, k.u + k.lu / 2); p.lineTo(k.v + k.lv / 2, k.u + k.lu / 2); p.lineTo(k.v + k.lv / 2, k.u - k.lu / 2); p.lineTo(k.v - k.lv / 2, k.u - k.lu / 2); sh.holes.push(p); }
      const g = new THREE.ExtrudeGeometry(sh, { depth: t1 - t0, bevelEnabled: false }).translate(0, 0, t0).applyMatrix4(M);
      const o = new THREE.Mesh(g, mat); o.castShadow = cast; o.receiveShadow = true; group.add(o); return o; };
    slab(0.03, 0.11, 0, tiles, true);                                 // the tiles
    slab(0, 0.03, OH / Math.cos(PA) - 0.02, boards, false);           // the boarding, from the wall inwards
    // each skylight: a pane of glass in a frame of lead, standing a little proud of the tiles
    for (const k of SKY) {
      const at = (v, u, t) => new THREE.Vector3(v, u, t).applyMatrix4(M);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(k.lv, k.lu), glass); pane.position.copy(at(k.v, k.u, 0.1));
      pane.quaternion.setFromRotationMatrix(M); group.add(pane);
      for (const [lv, lu, dv, du] of [[k.lv + 0.12, 0.06, 0, k.lu / 2 + 0.03], [k.lv + 0.12, 0.06, 0, -k.lu / 2 - 0.03], [0.06, k.lu, k.lv / 2 + 0.03, 0], [0.06, k.lu, -k.lv / 2 - 0.03, 0]]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(lv, lu, 0.08), lead); f.position.copy(at(k.v + dv, k.u + du, 0.12)); f.quaternion.setFromRotationMatrix(M); f.castShadow = true; group.add(f); }
    }
    // the fascia along the eave
    { const f = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 2 * ZL), wood); f.position.set(sd * (hw + OH + 0.01), eY - 0.02, 0); group.add(f); }
  }
  // the ridge tiles: a row of half-round tiles along the top
  { const rt = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2 * ZL + 0.06, 12, 1, false, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: 0x5f9e8b, roughness: 0.8 }));
    rt.rotation.x = Math.PI / 2; rt.rotation.y = 0; rt.position.set(0, H + GH + 0.12 / Math.cos(PA) - 0.02, 0); rt.castShadow = true; group.add(rt);
    rt.rotation.set(Math.PI / 2, 0, 0); rt.geometry.rotateY(Math.PI / 2); }
  // the gables' verges: a band of limewash along the slope where the tiles stop
  for (const zz of [ZL, -ZL]) for (const sd of [1, -1]) { const L = Ls, v = new THREE.Mesh(new THREE.BoxGeometry(L, 0.14, 0.06), limeOut);
    v.position.set(sd * (hw + OH) / 2, (eY + H + GH) / 2 + 0.1, zz); v.rotation.z = sd * -PA; group.add(v); }
  // the beams inside: the ridge beam under the apex, and tie beams across the room on the side walls
  box(0.2, 0.26, D - 2 * T, wood, 0, H + GH - T * Math.tan(PA) - 0.3, 0);
  for (const z of [-3.3, 0, 3.3]) box(W - 2 * T + 0.3, 0.22, 0.2, wood, 0, H - 0.22, z);
  // a plate along the top of each side wall, closing the gap under the boarding
  for (const sd of [1, -1]) box(T, T * Math.tan(PA) + 0.04, D, limeIn, sd * (hw - T / 2), H, 0);

  // the doorway: a step of stone, a reveal of limewash, and the pair of blue doors standing open against the reveal
  box(dw + 0.5, 0.12, 0.7, stone, 0, -0.1, hd + 0.3);
  // each leaf is half the doorway: square at its foot and hinge side, and rounded at its head to the arch
  { const lw = dw / 2, sp = GALLERY.door.spring, r = lw - 0.02;
    for (const s of [-1, 1]) { const leaf = new THREE.Group(); leaf.position.set(s * dw / 2, 0, hd - T + 0.06); leaf.rotation.y = s * -1.45;
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(-s * lw, 0); sh.lineTo(-s * lw, sp + r);
      if (s > 0) sh.absarc(-lw, sp, r, Math.PI / 2, 0, true); else sh.absarc(lw, sp, r, Math.PI / 2, Math.PI, false);
      sh.lineTo(0, 0);
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: false, curveSegments: 16 }), blue); m.castShadow = true; leaf.add(m);
      for (const y of [0.5, 1.25, 2.0]) { const p = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.2, 0.5, 0.02), blue); p.position.set(-s * lw / 2, y, 0.08); leaf.add(p); }
      group.add(leaf); } }
  // the signboard above the doorway, hung at right angles to the wall from an iron bracket: a straight arm out from
  // the wall, and two short hooks from which the board hangs, its face to either side
  { const S = 0.8, y = top + 0.8, x0 = hd + 0.2, x1 = hd + 1.15, arm = top + 1.6;
    const st = new THREE.MeshStandardMaterial({ map: signTex(), roughness: 0.75 }), edge = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.045, S, S), [st, st, edge, edge, edge, edge]); board.position.set(0, y, (x0 + x1) / 2); board.castShadow = true; group.add(board);
    box(0.06, 0.06, 1.35, iron, 0, arm - 0.03, hd + 0.675);                   // the arm
    box(0.12, 0.3, 0.04, iron, 0, arm - 0.2, hd + 0.02);                     // its plate on the wall
    for (const z of [x0 + 0.1, x1 - 0.1]) box(0.015, arm - 0.03 - (y + S / 2), 0.015, iron, 0, y + S / 2, z);   // the hooks
  }
  // inside: the floor, the bench down the middle and the lamps
  { const ft = floorTex(); ft.repeat.set((W - 2 * T) / 4, (D - 2 * T) / 4);
    add(new THREE.PlaneGeometry(W - 2 * T, D - 2 * T).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.8 }), 0, 0.01, 0, 0, false);
    box(0.55, 0.06, 2.6, oak, 0, 0.42, -0.3); for (const z of [-1.4, 0.8]) box(0.45, 0.42, 0.08, iron, 0, 0, z); }

  // the pictures, at eye level: three on each side wall and two on the back wall
  const slots = [];
  const side = D - 2 * T - 1.2;
  for (const sx of [1, -1]) for (let i = 0; i < 3; i++) slots.push({ x: sx * (hw - T), z: -side / 2 + side * (i + 0.5) / 3 - 0.2, ry: -sx * Math.PI / 2, wmax: 2.0 });
  for (const sx of [-1, 1]) slots.push({ x: sx * 1.55, z: -hd + T, ry: 0, wmax: 2.1 });
  const order = [6, 7, 0, 3, 1, 4, 2, 5];   // the back wall first, then the side walls from the back
  const hung = [];
  pictures.slice(0, GALLERY_SLOTS).forEach((pic, k) => {
    const S = slots[order[k]], img = pic.image, a = (img.width || 4) / (img.height || 3);
    const maxH = 1.3, maxW = S.wmax; let ph = maxH, pw = ph * a; if (pw > maxW) { pw = maxW; ph = pw / a; }
    const g = new THREE.Group(); g.position.set(S.x, 1.6, S.z); g.rotation.y = S.ry; group.add(g);
    const tex = new THREE.CanvasTexture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const m = pic.painting ? 0 : Math.min(pw, ph) * 0.12, fw = pic.painting ? 0.07 : 0.025, fz = 0.045;
    // the frame, and for a photograph its white mount
    const fm = black, ow = pw + 2 * (m + fw), oh = ph + 2 * (m + fw);
    for (const [sx2, sy2, x, y] of [[ow, fw, 0, oh / 2 - fw / 2], [ow, fw, 0, -oh / 2 + fw / 2], [fw, oh - 2 * fw, ow / 2 - fw / 2, 0], [fw, oh - 2 * fw, -ow / 2 + fw / 2, 0]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(sx2, sy2, fz), fm); b.position.set(x, y, fz / 2 + 0.005); b.castShadow = true; g.add(b); }
    if (m) { const mt = new THREE.Mesh(new THREE.PlaneGeometry(pw + 2 * m, ph + 2 * m), new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.9 })); mt.position.z = 0.012; g.add(mt); }
    const back = new THREE.Mesh(new THREE.BoxGeometry(ow, oh, 0.01), black); back.position.z = 0.006; g.add(back);
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshStandardMaterial({ map: tex, roughness: pic.painting ? 0.85 : 0.35 }));
    pm.position.z = 0.016; pm.userData.picture = pic.item; g.add(pm);
    if (pic.glow) { const gl = pictureGlow(ow, oh); gl.position.z = 0.002; g.add(gl); }
    // a picture light on the wall above the frame: a short arm out from a small plate, and a hood over the lamp
    { const ly = oh / 2 + 0.16, brass = new THREE.MeshStandardMaterial({ color: 0x9a7a3c, roughness: 0.35, metalness: 0.7 });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.02), brass); plate.position.set(0, ly, 0.01); g.add(plate);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.28, 6), brass); arm.rotation.x = Math.PI / 2 - 0.35; arm.position.set(0, ly + 0.05, 0.14); g.add(arm);
      const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, Math.min(0.9, ow * 0.55), 12, 1, false, 0, Math.PI), brass); hood.rotation.set(0, 0, Math.PI / 2); hood.rotation.x = -0.6; hood.position.set(0, ly + 0.1, 0.27); g.add(hood);
      if (opts.lights) { const L = new THREE.SpotLight(0xfff1dc, 6, 4, 0.75, 0.7, 1.6); L.position.set(0, ly + 0.08, 0.28); const tg = new THREE.Object3D(); tg.position.set(0, -oh * 0.15, 0); g.add(L, tg); L.target = tg; } }
    hung.push({ mesh: pm, item: pic.item });
  });
  if (opts.lights) { const L = new THREE.PointLight(0xfff6ea, 30, 14, 1.2); L.position.set(0, H - 1.0, 0); group.add(L); }

  // the walls as boxes, for keeping a walker out of them (the front in two parts either side of the doorway)
  const wallsBoxes = [
    { x: 0, z: -hd + T / 2, hw, hd: T / 2 }, { x: hw - T / 2, z: 0, hw: T / 2, hd }, { x: -hw + T / 2, z: 0, hw: T / 2, hd },
    { x: -(hw + dw / 2) / 2, z: hd - T / 2, hw: (hw - dw / 2) / 2, hd: T / 2 }, { x: (hw + dw / 2) / 2, z: hd - T / 2, hw: (hw - dw / 2) / 2, hd: T / 2 },
    { x: 0, z: -0.3, hw: 0.3, hd: 1.35 } ];
  return { group, size: { w: W + 2 * OH, d: D + 2 * OZ, h: H + GH + 0.3 }, pictures: hung, walls: wallsBoxes };
}
