/* A path-traced picture of the village, seen from the game's camera.

   pathTrace({renderer, scene, camera, samples, width, height, onProgress, onFrame, signal, ...settings})
     -> Promise<HTMLCanvasElement>

   renderer is optional and is only read (its canvas size and exposure); everything is drawn with a renderer of this
   module's own, on a canvas of its own, so that the state of the game's renderer is never touched. The renderer and
   the compiled path tracer are kept between calls. The settings and their defaults are listed in DEFAULTS below.
   onProgress({phase, fraction, info}) reports the phases 'world', 'scene', 'albedo', 'bvh', 'trace', 'denoise', 'done'.
   signal is an AbortSignal; aborting rejects the promise with an AbortError.

   onFrame(canvas, progress) shows the picture while it is made. While the samples accumulate it is called at most
   once every frameInterval milliseconds (120 by default), after a whole sample has been added, with progress the
   share of the samples taken so far (above 0 and below 1). The canvas is a 2D canvas of the final size holding the
   picture as it stands: the unfiltered light times the game's surface colour, with haze, exposure and tone mapping as
   in the final picture, so it clears from noise as the samples add up. The same canvas object is passed each time
   and is drawn over before the next call, so a caller that keeps a frame copies it. Frames begin once the exposure
   has been measured (after 8 samples). Last, after the filter, onFrame is called once with progress exactly 1 and
   the very canvas the promise resolves with.

   The world. For the picture the game is set, for a while, to a fixed draw level that reaches further than its
   own (extendLevel, chosen with the game's Page Up key) and builds every block in it at once; beyond that ring, out
   to horizonReach, outline blocks are generated with the game's genChunk for the picture alone, within a budget of
   triangles and vertices. The game's draw level is handed back as soon as the scene has been copied.

   The scene. The live scene is copied into a static scene for three-gpu-pathtracer: every visible opaque mesh within
   reach of the view is baked into world space and merged into one geometry, with one physical material for each
   distinct surface of the game. Window panes (surface code 5) become glass, the game's metal colours become metal
   (steel, iron, bronze, polished rail heads) and the trains' bodies lacquered paint. The sea is rebuilt on the CPU
   from the game's own wave sum, so that its crests stand where they stand in the game, given a smooth water surface
   tinted by the depth beneath it, and carried on as open water to the horizon. The sky is the game's sky gradient in
   an equirectangular map, with the sun added as a small bright disc whose irradiance equals that of the game's sun,
   so that importance sampling of the map gives soft shadows, sky light and bounce light together.

   The picture. The game's surfaces carry patterns (bricks, paving, roof tiles, planks) that are drawn in their
   shaders and that the path tracer cannot see. The picture therefore keeps the light of the path tracer and the
   surface colour of the game: the radiance P is divided by the flat surface colour A_pt of the converted scene, the
   quotient (the light falling on each surface) is filtered by an edge-aware a-trous filter guided by normals, depth
   and an estimate of its own noise, and the result is multiplied by the surface colour A_game drawn with the game's
   own materials under a flat white light. Both colour passes are drawn with the same sub-pixel offsets, so that edges
   agree. The sky, the sea, glass and metal are taken from the path tracer directly. Aerial perspective is added from
   the depth (extinction by a haze that thins with height, and in-scattered light of the sky's horizon colour), and
   the picture is tone mapped with ACES Filmic at the game's exposure. */

import * as THREE from 'three';
import { PathTracingRenderer, MeshBVH, SAH, FullScreenQuad } from './vendor/pathtracer.module.js';

/* ---------- settings ---------- */
const DEFAULTS = {
  samples: 512,            // samples per pixel
  bounces: 5,              // diffuse and glossy bounces after the camera ray
  extend: true,            // load the world far beyond the game's draw distance while the picture is taken
  extendLevel: 12,         // the game's simplified ring, in blocks, while the picture is taken (a fixed draw level)
  horizonReach: 5000,      // metres: beyond the game's blocks, blocks are generated for the picture alone out to here
  maxTriangles: 12e6,      // the most triangles the path-traced scene may hold; the farthest blocks are left out beyond it
  maxVertices: 16e6,       // the most vertices: the path tracer keeps four float4 textures of this length on the GPU
  materials: true,         // glass and metal are given physical materials of their own
  haze: true,              // aerial perspective in place of the game's fog
  hazeVisibility: 28000,   // metres: the meteorological visibility at sea level (extinction 3.912 / visibility)
  hazeHeight: 1200,        // metres: the scale height over which the haze thins with altitude
  remodReach: [250, 420],  // metres: the game's surface patterns fade out over this range, as they do in the game
  sunRadiusDeg: 0.6,       // angular radius of the sun's disc; a little larger than the real sun for softer shadows
  envWidth: 2048,          // width of the equirectangular sky (height is half)
  textureSize: 1024,       // size of the texture array the path tracer packs the game's textures into
  nearReach: 140,          // metres: everything this close to the camera is kept, in any direction
  farReach: 2600,          // metres: nothing beyond this is kept, except the distant terrain
  frustumWiden: 1.3,       // the view frustum used for culling is this much wider than the camera's
  jitter: 16,              // sub-pixel offsets for the two colour passes
  denoise: 5,              // a-trous iterations (0 turns the filter off)
  sampleClamp: 40,         // per-sample limit on the brightest channel, against fireflies
  skyGain: null,           // gain on the sky light; null works it out from the game's hemisphere light
  skyShare: 0.85,          // with skyGain null: the share of the hemisphere light's brightness the sky is raised to
  skyTint: 0.8,            // how far the sky light takes the hemisphere light's colour (0 to 1)
  autoExposure: 0.75,      // how far the exposure is brought towards the game's brightness (0 leaves it alone)
  autoExposureMax: 1.6,    // the most it may be raised by that
  ripple: 0.12,            // strength of the fine ripples on the water
  rippleSize: 4,           // metres across one tile of the ripple pattern
  exposure: null,          // null takes the game renderer's exposure
  fog: true,               // the game's own fog, used only when the haze is turned off
  tiles: null,             // path tracer tiles per side; null chooses from the size
  onFrame: null,           // onFrame(canvas, progress): the picture while it clears (see the notes on pathTrace)
  frameInterval: 120,      // milliseconds: the least time between two frames handed to onFrame
};

/* ---------- the renderer and the path tracer, kept between calls ---------- */
let ctx = null;
function getContext(w, h) {
  if (!ctx) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const R = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    R.setPixelRatio(1);
    R.outputColorSpace = THREE.SRGBColorSpace;
    R.shadowMap.enabled = false;
    const pt = new PathTracingRenderer(R);
    // each sample's brightest channel is limited, so that rare paths to the sun do not leave bright specks
    const m = pt.material;
    m.uniforms.uSampleClamp = { value: DEFAULTS.sampleClamp };
    // the sky in the environment map is brightened and tinted to light the scene as the game's hemisphere light
    // does; a ray that leaves a mirror-like reflection sees the sky as it is drawn, by undoing that gain
    m.uniforms.uSpecSky = { value: new THREE.Vector3(1, 1, 1) };
    m.fragmentShader = m.fragmentShader
      .replace('void main() {', 'uniform float uSampleClamp;\nuniform vec3 uSpecSky;\nvoid main() {')
      .replace('gl_FragColor.rgb += environmentIntensity * envColor * state.throughputColor * misWeight;',
        'gl_FragColor.rgb += environmentIntensity * envColor * state.throughputColor * misWeight * ( state.isShadowRay ? vec3( 1.0 ) : uSpecSky );')
      .replace('gl_FragColor.a *= opacity;', '{ if ( any( isnan( gl_FragColor.rgb ) ) || any( isinf( gl_FragColor.rgb ) ) ) gl_FragColor.rgb = vec3( 0.0 ); float mx = max( max( gl_FragColor.r, gl_FragColor.g ), gl_FragColor.b ); if ( mx > uSampleClamp ) gl_FragColor.rgb *= uSampleClamp / mx; }\n\t\t\t\t\tgl_FragColor.a *= opacity;');
    m.needsUpdate = true;
    ctx = { R, pt, canvas, quad: new FullScreenQuad(null), targets: new Map() };
  }
  ctx.R.setSize(w, h, false);
  return ctx;
}

// float render targets, kept by name and resized as needed
function target(name, w, h, type = THREE.FloatType, depth = false) {
  let t = ctx.targets.get(name);
  if (!t) {
    t = new THREE.WebGLRenderTarget(w, h, { type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: depth, generateMipmaps: false });
    ctx.targets.set(name, t);
  }
  if (t.width !== w || t.height !== h) t.setSize(w, h);
  return t;
}

const sleep0 = () => new Promise(r => setTimeout(r, 0));
function checkAbort(signal) { if (signal && signal.aborted) throw new DOMException('The path tracing was stopped.', 'AbortError'); }

// waits until the GPU has finished what has been sent to it, without blocking the page
async function gpuIdle(R) {
  const gl = R.getContext();
  const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
  for (;;) {
    const st = gl.clientWaitSync(s, 0, 0);
    if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED || st === gl.WAIT_FAILED) break;
    await new Promise(r => setTimeout(r, 1));
  }
  gl.deleteSync(s);
}

/* ---------- recognising the game's objects ---------- */
const isSkyMaterial = m => m && m.uniforms && m.uniforms.uTop && m.uniforms.uRot && m.side === THREE.BackSide;
const isSeaMaterial = m => m && m.uniforms && m.uniforms.uW && m.uniforms.uDeep && m.uniforms.uField;
const isFarMaterial = m => m && typeof m.onBeforeCompile === 'function' && /insideL/.test(String(m.onBeforeCompile));
const SURFACE_TYPES = new Set(['MeshLambertMaterial', 'MeshPhongMaterial', 'MeshToonMaterial', 'MeshBasicMaterial', 'MeshStandardMaterial', 'MeshPhysicalMaterial']);

// whether a material is drawn as an opaque surface in the path-traced scene
function usable(m) {
  if (!m || !m.visible || m.colorWrite === false) return false;
  if (!SURFACE_TYPES.has(m.type)) return false;
  if (m.blending === THREE.AdditiveBlending) return false;
  if (m.transparent && m.opacity < 0.6) return false;
  return true;
}

/* ---------- the path tracer's materials ---------- */
// The game draws almost everything with a few vertex-coloured Lambert materials, so glass and metal are told apart
// triangle by triangle: glass by the surface code 5 the game gives window panes (attribute 'surf'), metal by the
// exact colours the game builds its metal parts in. Each class becomes its own physical material.
const CLS = { BASE: 0, DARK_GLASS: 1, CLEAR_GLASS: 2, STEEL: 3, IRON: 4, BRONZE: 5, RAIL_TOP: 6, PAINT: 7 };
const METAL_COLOURS = {
  '#7d8086': CLS.STEEL,    // rails, station and harbour steel
  '#5d6066': CLS.STEEL, '#6d7176': CLS.STEEL, '#9a9c9f': CLS.STEEL,   // the trains' fittings and wheel rims
  '#4a5560': CLS.IRON, '#2a2624': CLS.IRON, '#2e2f31': CLS.IRON, '#3b3f3c': CLS.IRON, '#34312f': CLS.IRON,   // railings, posts, hinges, bench ends
  '#26262a': CLS.IRON, '#3a3632': CLS.IRON,   // the trains' frames, bogies and wheels
  '#2b2b35': CLS.IRON,     // clock hands
  '#a8742e': CLS.BRONZE,   // bells
};
const colourKey = (r, g, b) => Math.round(r * 2000) + ',' + Math.round(g * 2000) + ',' + Math.round(b * 2000);
let metalLookup = null;
function metalClass(r, g, b) {
  if (!metalLookup) { metalLookup = new Map(); for (const h in METAL_COLOURS) { const c = new THREE.Color(h); metalLookup.set(colourKey(c.r, c.g, c.b), METAL_COLOURS[h]); } }
  return metalLookup.get(colourKey(r, g, b)) ?? CLS.BASE;
}
const isTrainMaterial = m => typeof m.customProgramCacheKey === 'function' && /^train/.test(m.customProgramCacheKey());

// one physical material for each distinct look among the game's materials and each class of surface in it
function convertMaterial(m, cache, list, noShadow = false, cls = CLS.BASE) {
  const rough = m.type === 'MeshStandardMaterial' || m.type === 'MeshPhysicalMaterial' ? Math.max(0.05, m.roughness)
    : m.type === 'MeshPhongMaterial' ? Math.min(1, Math.max(0.25, Math.sqrt(2 / (m.shininess + 2)) * 1.6))
    : m.type === 'MeshToonMaterial' ? 0.85 : 0.92;
  const metal = m.metalness !== undefined ? m.metalness : 0;
  const em = m.emissive ? m.emissive.clone().multiplyScalar(m.emissiveIntensity ?? 1) : new THREE.Color(0, 0, 0);
  const key = [m.color ? m.color.getHexString() : 'ffffff', m.map ? m.map.uuid : '-', rough.toFixed(2), metal.toFixed(2), em.getHexString(), m.alphaTest > 0 ? m.alphaTest : 0, noShadow ? 'ns' : 's', cls].join('|');
  let i = cache.get(key);
  if (i !== undefined) return i;
  const base = { color: m.color ? m.color.clone() : new THREE.Color(1, 1, 1), vertexColors: true, side: THREE.DoubleSide };
  let p;
  switch (cls) {
    // a pane in front of a room that is not built (the wall stands right behind it): the game's dark colour beneath
    // a smooth dielectric surface, which gives the Fresnel reflection of the sky and the street
    case CLS.DARK_GLASS: p = new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.02, metalness: 0, ior: 1.5 }); break;
    // a pane with open space behind it: clear glass, transmitting and reflecting
    case CLS.CLEAR_GLASS: p = new THREE.MeshPhysicalMaterial({ ...base, color: new THREE.Color(1, 1, 1), vertexColors: false, roughness: 0.02, metalness: 0, ior: 1.5, transmission: 1, thickness: 0.01 }); break;
    case CLS.STEEL: p = new THREE.MeshStandardMaterial({ ...base, roughness: 0.32, metalness: 1 }); break;
    case CLS.IRON: p = new THREE.MeshStandardMaterial({ ...base, roughness: 0.55, metalness: 1 }); break;
    case CLS.BRONZE: p = new THREE.MeshStandardMaterial({ ...base, roughness: 0.35, metalness: 1 }); break;
    // the running surface of a rail, polished bright by the wheels
    case CLS.RAIL_TOP: p = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.62, 0.62, 0.64), vertexColors: false, side: THREE.DoubleSide, roughness: 0.12, metalness: 1 }); break;
    // the trains' painted bodies: a smooth, glossy paint (the path tracer's clear coat gives NaNs on this geometry,
    // which has no tangents, so the gloss is the dielectric paint's own)
    case CLS.PAINT: p = new THREE.MeshStandardMaterial({ ...base, roughness: 0.22, metalness: 0 }); break;
    default: p = new THREE.MeshStandardMaterial({ ...base, map: m.map || null, roughness: rough, metalness: metal, emissive: em, emissiveIntensity: 1,
      alphaTest: m.map && m.alphaTest > 0 ? m.alphaTest : 0 });
  }
  p.userData.cls = cls;
  // the coarse distant terrain stands a little proud of the land near the shore, so it casts no shadow
  if (noShadow) p.castShadow = false;
  i = list.length; list.push(p); cache.set(key, i);
  return i;
}
// the classes whose pixels keep the path tracer's own colour, without the game's surface patterns
const isDirectClass = c => c === CLS.DARK_GLASS || c === CLS.CLEAR_GLASS || c === CLS.STEEL || c === CLS.IRON || c === CLS.BRONZE || c === CLS.RAIL_TOP;

// the class of each triangle of a range of a mesh, or null when every triangle is of the base class
function classify(g, m, s, e, idx) {
  const col = m.vertexColors ? g.attributes.color : null, surf = g.attributes.surf, nrm = g.attributes.normal;
  const train = isTrainMaterial(m);
  const matCls = m.color && !m.vertexColors ? metalClass(m.color.r, m.color.g, m.color.b) : CLS.BASE;
  if (!col && !surf && !train && matCls === CLS.BASE) return null;
  const out = new Uint8Array((e - s) / 3); let any = false;
  for (let t = s, k = 0; t < e; t += 3, k++) {
    const v = idx ? idx.getX(t) : t;
    let c = matCls;
    if (surf && Math.abs(surf.getX(v) - 5) < 0.5) {
      const l = col ? 0.2126 * col.getX(v) + 0.7152 * col.getY(v) + 0.0722 * col.getZ(v) : 0;
      c = l < 0.1 ? CLS.DARK_GLASS : CLS.CLEAR_GLASS;
    } else if (col) {
      const mc = metalClass(col.getX(v), col.getY(v), col.getZ(v));
      if (mc !== CLS.BASE) c = mc === CLS.STEEL && !train && nrm && nrm.getY(v) > 0.9 ? CLS.RAIL_TOP : mc;
      else if (train) c = CLS.PAINT;
    } else if (train) c = CLS.PAINT;
    out[k] = c; if (c) any = true;
  }
  return any ? out : null;
}

/* ---------- the sea, rebuilt from the game's wave sum ---------- */
// the shore field the sea shader reads: [swell factor, wind factor, depth], bilinear as the GPU samples it
function makeFieldReader(U) {
  const tex = U.uField.value, R = U.uFieldR.value, out = U.uOutside.value;
  const D = tex && tex.image && tex.image.data, n = R.w;
  const f = [0, 0, 0];
  return (x, z) => {
    const fx = (x - R.x) / R.z, fz = (z - R.y) / R.z;
    if (!D || fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) { f[0] = out.x; f[1] = out.y; f[2] = out.z; return f; }
    // texel centres lie at whole numbers of f, so this is the GPU's linear filter
    const i0 = Math.min(n - 2, Math.floor(fx)), j0 = Math.min(n - 2, Math.floor(fz)), tx = fx - i0, tz = fz - j0;
    for (let c = 0; c < 3; c++) {
      const a = D[(j0 * n + i0) * 4 + c], b = D[(j0 * n + i0 + 1) * 4 + c], e = D[((j0 + 1) * n + i0) * 4 + c], g = D[((j0 + 1) * n + i0 + 1) * 4 + c];
      f[c] = ((a * (1 - tx) + b * tx) * (1 - tz) + (e * (1 - tx) + g * tx) * tz) / 255 * (c === 2 ? 20 : 1.5);
    }
    return f;
  };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the displaced sea surface: positions, normals and a body colour from the depth of the water beneath each point
function buildSea(sea, outerR = 0) {
  const U = sea.material.uniforms, field = makeFieldReader(U);
  const NT = U.uN.value, W = U.uW.value, PH = U.uPh.value, C = U.uCentre.value, spc0 = U.uSpc.value, scale = U.uScale.value, off = U.uOff.value;
  const NS = 3;
  const comp = [];
  for (let i = 0; i < NT; i++) { const w = W[i], k = Math.hypot(w.x, w.y); if (k > 1e-5) comp.push({ i, kx: w.x, kz: w.y, k, A: w.z, Q: w.w, ph: PH[i], lam: 2 * Math.PI / k }); }
  const g = sea.geometry, pos = g.attributes.position, n = pos.count;
  sea.updateMatrixWorld(true);
  const M = sea.matrixWorld, v = new THREE.Vector3();
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), Col = new Float32Array(n * 3);
  const deep = U.uDeep.value, mid = U.uMid.value, swA = Math.max(U.uSwellA.value, 0.15);
  for (let j = 0; j < n; j++) {
    v.fromBufferAttribute(pos, j).applyMatrix4(M);
    const qx = v.x + off.x, qz = v.z + off.z;
    const fa = field(qx, qz), fs = fa[0], fw = fa[1], dep = fa[2];
    const r = Math.hypot(qx - C.x, qz - C.y), spc = spc0 * scale * Math.pow(Math.max(r / scale, 1), 0.6667);
    const qb = 1 + 0.7 * (1 - smooth(1.2, 4.5, dep));
    let T = 0;
    for (const c of comp) { const A = c.A * smooth(4, 6, c.lam / spc) * (c.i < NS ? fs : fw); T += c.Q * qb * smooth(5, 9, c.lam / spc) * c.k * A; }
    const qs = T > 0.92 ? 0.92 / T : 1;
    let dx = 0, dy = 0, dz = 0, nx = 0, ny = 1, nz = 0;
    for (const c of comp) {
      const A = c.A * smooth(4, 6, c.lam / spc) * (c.i < NS ? fs : fw), Q = c.Q * qb * qs * smooth(5, 9, c.lam / spc);
      const Dx = c.kx / c.k, Dz = c.kz / c.k, ph = c.kx * qx + c.kz * qz + c.ph, Co = Math.cos(ph), S = Math.sin(ph);
      dx += Q * A * Dx * Co; dz += Q * A * Dz * Co; dy += A * S;
      nx -= Dx * c.k * A * Co; nz -= Dz * c.k * A * Co; ny -= Q * c.k * A * S;
    }
    const l = Math.hypot(nx, ny, nz);
    P[j * 3] = v.x + dx; P[j * 3 + 1] = v.y + dy; P[j * 3 + 2] = v.z + dz;
    N[j * 3] = nx / l; N[j * 3 + 1] = ny / l; N[j * 3 + 2] = nz / l;
    // the light scattered back out of the water, as the game works it out looking straight down: the sea bed seen
    // through the water where it is shallow, the colour of the deep water where it is not
    const path = Math.max(0, dep + dy) * 2 * (10 / 12);
    const tr = [Math.exp(-0.32 * path), Math.exp(-0.13 * path), Math.exp(-0.10 * path)];
    const lift = 0.25 + 0.75 * smooth(-0.7, 0.9, dy / swA);
    const body = [deep.r + (mid.r - deep.r) * lift, deep.g + (mid.g - deep.g) * lift, deep.b + (mid.b - deep.b) * lift];
    const kd = smooth(1.5, 9.6, Math.max(0, dep + dy));
    const ins = [0.03 + (body[0] * 0.8 - 0.03) * kd, 0.13 + (body[1] * 0.8 - 0.13) * kd, 0.15 + (body[2] * 0.8 - 0.15) * kd];
    const bed = [0.24, 0.24, 0.19];
    for (let c = 0; c < 3; c++) Col[j * 3 + c] = Math.min(0.6, bed[c] * tr[c] + ins[c] * (1 - tr[1]));
  }
  // beyond the game's disc of sea, a flat ring of open water reaches out to the horizon, in the colour of deep water
  let ring = null;
  if (outerR > 0) {
    let r0 = 0; const cx = sea.position.x, cz = sea.position.z;
    for (let j = 0; j < n; j++) r0 = Math.max(r0, Math.hypot(pos.getX(j), pos.getZ(j)));
    const c0 = new THREE.Vector3(0, 0, 0).applyMatrix4(M), y0 = c0.y;
    const SEG = 160, radii = [];
    for (let r = r0 * 0.995; r < outerR; r *= 1.35) radii.push(r);
    radii.push(outerR);
    const kd = 1, lift = 0.25 + 0.75 * smooth(-0.7, 0.9, 0);
    const deepCol = [0, 1, 2].map(q => { const b = [deep.r, deep.g, deep.b][q] + ([mid.r, mid.g, mid.b][q] - [deep.r, deep.g, deep.b][q]) * lift; return Math.min(0.6, b * 0.8 * kd); });
    const rp = [], ri = [];
    for (let a = 0; a < radii.length; a++) for (let k = 0; k < SEG; k++) { const t = k / SEG * Math.PI * 2; rp.push(c0.x + Math.cos(t) * radii[a] * M.elements[0], y0, c0.z + Math.sin(t) * radii[a] * M.elements[0]); }
    for (let a = 0; a + 1 < radii.length; a++) for (let k = 0; k < SEG; k++) {
      const p0 = n + a * SEG + k, p1 = n + a * SEG + (k + 1) % SEG, q0 = p0 + SEG, q1 = p1 + SEG; ri.push(p0, q0, q1, p0, q1, p1); }
    ring = { rp, ri, deepCol, count: rp.length / 3 };
  }
  const nAll = n + (ring ? ring.count : 0);
  const P2 = new Float32Array(nAll * 3), N2 = new Float32Array(nAll * 3), C2 = new Float32Array(nAll * 3);
  P2.set(P); N2.set(N); C2.set(Col);
  if (ring) for (let j = 0; j < ring.count; j++) { const k = (n + j) * 3; P2[k] = ring.rp[j * 3]; P2[k + 1] = ring.rp[j * 3 + 1]; P2[k + 2] = ring.rp[j * 3 + 2]; N2[k + 1] = 1; C2[k] = ring.deepCol[0]; C2[k + 1] = ring.deepCol[1]; C2[k + 2] = ring.deepCol[2]; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P2, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N2, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(C2, 3));
  // the triangles are wound so that their faces look up, as the normals do; the game's disc is wound the other way
  const I = new Uint32Array(g.index.count + (ring ? ring.ri.length : 0));
  I.set(g.index.array); if (ring) I.set(ring.ri, g.index.count);

  const up = (k) => { const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3, P = P2;
    return (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]); };
  for (let k = 0; k < I.length; k += 3) if (up(k) < 0) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
  geo.setIndex(new THREE.BufferAttribute(I, 1));
  return geo;
}

/* ---------- the sky ---------- */
function skyColour(U, x, y, z, glow, out) {
  const top = U.uTop.value, mid = U.uMid.value, hor = U.uHor.value, s = U.uSun.value, sc = U.uSunCol.value, day = U.uDay.value;
  let r, g, b;
  if (y > 0.12) { const t = Math.min(1, (y - 0.12) / 0.6); r = mid.r + (top.r - mid.r) * t; g = mid.g + (top.g - mid.g) * t; b = mid.b + (top.b - mid.b) * t; }
  else { const t = Math.max(0, Math.min(1, (y + 0.04) / 0.16)); r = hor.r + (mid.r - hor.r) * t; g = hor.g + (mid.g - hor.g) * t; b = hor.b + (mid.b - hor.b) * t; }
  const sd = Math.max(0, x * s.x + y * s.y + z * s.z);
  const k = (glow ? Math.pow(sd, 900) * 6 : 0) + Math.pow(sd, 12) * 0.35 + Math.pow(sd, 3) * 0.12 * (1 - day);
  out[0] = r + sc.r * k; out[1] = g + sc.g * k; out[2] = b + sc.b * k;
  return out;
}

// the background as the game draws it, and the light of the sky with the sun as a disc
function buildSky(U, sunDir, sunRad, opt) {
  const W = opt.envWidth, H = W / 2;
  const bg = new Float32Array(W * H * 4), env = new Float32Array(W * H * 4);
  const c = [0, 0, 0];
  const cosR = Math.cos(opt.sunRadiusDeg * Math.PI / 180), cosR0 = Math.cos(opt.sunRadiusDeg * 0.8 * Math.PI / 180);
  // irradiance of the sky alone on an upward surface, and the solid angle the sun's disc covers
  let eUp = [0, 0, 0], discW = 0;
  const dTh = 2 * Math.PI / W, dPh = Math.PI / H;
  const discMask = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    // row 0 is the bottom of the map: direction y = -cos(pi v)
    const v = (j + 0.5) / H, phi = (1 - v) * Math.PI, sp = Math.sin(phi), y = Math.cos(phi);
    const dOmega = sp * dTh * dPh;
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W, th = (u - 0.5) * 2 * Math.PI, x = sp * Math.cos(th), z = sp * Math.sin(th);
      const k = (j * W + i) * 4;
      skyColour(U, x, y, z, true, c); bg[k] = c[0]; bg[k + 1] = c[1]; bg[k + 2] = c[2]; bg[k + 3] = 1;
      skyColour(U, x, y, z, false, c); env[k] = c[0]; env[k + 1] = c[1]; env[k + 2] = c[2]; env[k + 3] = 1;
      if (y > 0) for (let q = 0; q < 3; q++) eUp[q] += c[q] * y * dOmega;
      const cd = x * sunDir.x + y * sunDir.y + z * sunDir.z;
      if (cd > cosR) { const w = smooth(cosR, cosR0, cd); discMask[j * W + i] = w; discW += w * dOmega; }
    }
  }
  // the gain on the sky light: the game lights its shade with a hemisphere light far brighter than its sky, so the
  // sky is brightened towards it, short of matching it, since the path tracer adds the light reflected from the ground
  const lum = a => 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  // The game's hemisphere light is also less blue than its sky, so the gain is given part of the hemisphere light's
  // tint, channel by channel (opt.skyTint: 0 keeps the sky's own colour, 1 takes the hemisphere light's)
  const hs = opt.hemi ? [opt.hemi.color.r * opt.hemi.intensity, opt.hemi.color.g * opt.hemi.intensity, opt.hemi.color.b * opt.hemi.intensity] : eUp;
  let gain = opt.skyGain;
  if (gain == null) gain = Math.max(1, Math.min(2.5, opt.skyShare * lum(hs) / Math.max(1e-4, lum(eUp))));
  const ratio = [0, 1, 2].map(q => hs[q] / Math.max(1e-4, eUp[q]));
  const rl = lum(ratio);
  const gains = ratio.map(r => gain * Math.pow(Math.max(1e-3, r / rl), opt.skyTint));
  const sunL = discW > 0 ? [sunRad.r / discW, sunRad.g / discW, sunRad.b / discW] : [0, 0, 0];
  for (let p = 0; p < W * H; p++) {
    const k = p * 4, w = discMask[p];
    for (let q = 0; q < 3; q++) env[k + q] = env[k + q] * gains[q] + sunL[q] * w;
  }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
    t.mapping = THREE.EquirectangularReflectionMapping; t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = false; t.flipY = false; t.needsUpdate = true;
    return t;
  };
  // the background is sampled directly, so it is kept as half floats, which every GPU filters
  const bgHalf = new Uint16Array(W * H * 4);
  for (let p = 0; p < bg.length; p++) bgHalf[p] = THREE.DataUtils.toHalfFloat(bg[p]);
  const bgTex = new THREE.DataTexture(bgHalf, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  bgTex.minFilter = bgTex.magFilter = THREE.LinearFilter; bgTex.wrapS = THREE.RepeatWrapping; bgTex.wrapT = THREE.ClampToEdgeWrapping; bgTex.generateMipmaps = false; bgTex.needsUpdate = true;
  return { bgTex, envTex: mk(env), gain, gains, eUp, sunL };
}

/* ---------- collecting the scene ---------- */
function collect(scene, cam, opt, info) {
  const camPos = cam.position;
  const wide = cam.clone(); wide.fov = Math.min(170, cam.fov * opt.frustumWiden); wide.aspect = cam.aspect * opt.frustumWiden; wide.updateProjectionMatrix();
  wide.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(wide.projectionMatrix, wide.matrixWorldInverse));
  const sph = new THREE.Sphere();
  const keep = (c, r) => {
    const d = c.distanceTo(camPos);
    if (d - r < opt.nearReach) return true;
    if (d - r > opt.farReach) return false;
    sph.center.copy(c); sph.radius = r; return frustum.intersectsSphere(sph);
  };
  const parts = [], included = new Set(), renderables = [];
  let sea = null, sky = null, sun = null, hemi = null, far = null;
  scene.traverseVisible(o => {
    if (o.isDirectionalLight && (!sun || o.castShadow)) sun = o;
    if (o.isHemisphereLight) hemi = o;
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    renderables.push(o);
    if (!o.isMesh) return;
    const m = o.material;
    if (Array.isArray(m)) { if (!m.some(usable)) return; }
    else {
      if (isSkyMaterial(m)) { sky = o; return; }
      // there may be more than one mesh with the sea's material; the open sea is the largest
      if (isSeaMaterial(m)) { if (!sea || o.geometry.attributes.position.count > sea.geometry.attributes.position.count) sea = o; return; }
      if (!usable(m)) return;
    }
    const g = o.geometry; if (!g || !g.attributes.position) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const bs = g.boundingSphere;
    const farTerrain = isFarMaterial(m);
    if (farTerrain) { if (opt.farTerrain === false) return; far = o; }
    if (o.isInstancedMesh) {
      const im = new THREE.Matrix4(), mw = new THREE.Matrix4(), c = new THREE.Vector3();
      let any = false;
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, im); mw.multiplyMatrices(o.matrixWorld, im);
        c.copy(bs.center).applyMatrix4(mw); const r = bs.radius * mw.getMaxScaleOnAxis();
        if (!keep(c, r)) continue;
        parts.push({ o, matrix: mw.clone(), instance: k }); any = true;
      }
      if (any) included.add(o);
    } else {
      const c = bs.center.clone().applyMatrix4(o.matrixWorld), r = bs.radius * o.matrixWorld.getMaxScaleOnAxis();
      if (!farTerrain && !keep(c, r)) return;
      parts.push({ o, matrix: o.matrixWorld.clone(), instance: -1, far: farTerrain }); included.add(o);
    }
  });
  info.parts = parts.length;
  return { parts, included, renderables, sea, sky, sun, hemi, far };
}

/* ---------- the world beyond the game's draw distance ----------
   The game loads its blocks in rings round the player: full detail, simplified, then outlines, out to a radius it
   sets from the frame rate, with a coarse terrain mesh and fog beyond. For the picture the game is put, for a while,
   at a fixed draw level that reaches much further (the Page Up levels, chosen by pressing the key), and every block
   inside it is built at once with the game's own updateChunks (a budget of 1e9 ms builds the whole ring in one call,
   without fading). Beyond that ring, out to the horizon, blocks are generated at outline detail with the game's own
   genChunk for the picture alone: they never join the game's scene. Afterwards the draw level is stepped back down
   (Page Down) and, if the game was choosing its draw distance itself, handed back to it (Home). */
const pressKey = code => { for (const t of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(t, { code, key: code })); };
function extendView(V, opt, info, cam) {
  const view0 = V.view;
  // the fixed levels go beyond 12 blocks, which the automatic setting never does
  const fixed0 = view0 > 12;
  for (let i = 0; i < 12 && V.view < opt.extendLevel; i++) { const v = V.view; pressKey('PageUp'); if (V.view === v) break; }
  info.viewBefore = view0; info.viewDuring = V.view;
  const t = performance.now();
  // round the camera, which for a picture taken earlier may stand elsewhere than the player
  const wg = V.sea ? V.sea.parent : V.farMesh.parent;
  V.updateChunks(cam.position.x - wg.position.x, cam.position.z - wg.position.z);
  info.tLoadBlocks = Math.round(performance.now() - t); info.blocks = V.chunks.size;
  return () => {
    for (let i = 0; i < 12 && V.view > view0; i++) { const v = V.view; pressKey('PageDown'); if (V.view === v) break; }
    if (!fixed0) pressKey('Home');
    info.viewAfter = V.view;
  };
}
// the game builds its blocks three vertices to a triangle; vertices that agree in position, normal, colour and
// surface code are shared, which roughly halves the memory the distant blocks take on the GPU
function weld(g) {
  const P = g.attributes.position.array, N = g.attributes.normal.array, Cc = g.attributes.color ? g.attributes.color.array : null, S = g.attributes.surf ? g.attributes.surf.array : null;
  const n = P.length / 3, src = g.index ? g.index.array : null, cnt = src ? src.length : n;
  const map = new Map(), P2 = new Float32Array(n * 3), N2 = new Float32Array(n * 3), C2 = Cc ? new Float32Array(n * 3) : null, S2 = S ? new Float32Array(n) : null, I = new Uint32Array(cnt);
  let m = 0;
  for (let t = 0; t < cnt; t++) {
    const v = src ? src[t] : t, k = v * 3;
    const key = Math.round(P[k] * 200) + ',' + Math.round(P[k + 1] * 200) + ',' + Math.round(P[k + 2] * 200) + ',' + Math.round(N[k] * 50) + ',' + Math.round(N[k + 1] * 50) + ',' + Math.round(N[k + 2] * 50)
      + (Cc ? ',' + Math.round(Cc[k] * 500) + ',' + Math.round(Cc[k + 1] * 500) + ',' + Math.round(Cc[k + 2] * 500) : '') + (S ? ',' + S[v] : '');
    let j = map.get(key);
    if (j === undefined) { j = m++; map.set(key, j); for (let q = 0; q < 3; q++) { P2[j * 3 + q] = P[k + q]; N2[j * 3 + q] = N[k + q]; if (C2) C2[j * 3 + q] = Cc[k + q]; } if (S2) S2[j] = S[v]; }
    I[t] = j;
  }
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.BufferAttribute(P2.slice(0, m * 3), 3));
  o.setAttribute('normal', new THREE.BufferAttribute(N2.slice(0, m * 3), 3));
  if (C2) o.setAttribute('color', new THREE.BufferAttribute(C2.slice(0, m * 3), 3));
  if (S2) o.setAttribute('surf', new THREE.BufferAttribute(S2.slice(0, m), 1));
  o.setIndex(new THREE.BufferAttribute(I, 1));
  return o;
}

// outline blocks for the picture alone, in the view out to horizonReach, nearest first, within the triangle budget
function farBlocks(V, cam, opt, info, budget) {
  const C = BLOCK, wg = V.sea ? V.sea.parent : V.farMesh.parent;
  const ox = -wg.position.x, oz = -wg.position.z;   // the floating origin: true world = scene + origin
  let bMat = null, gMat = null;
  for (const ch of V.chunks.values()) if (ch.mesh && ch.ground && ch.fade >= 1 && !ch.prev) { bMat = ch.mesh.material; gMat = ch.ground.material; break; }
  if (!bMat) return [];
  const have = new Set(); for (const ch of V.chunks.values()) have.add(ch.cx + ',' + ch.cz);
  const wide = cam.clone(); wide.fov = Math.min(170, cam.fov * 1.12); wide.aspect = cam.aspect * 1.12; wide.updateProjectionMatrix();
  wide.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(wide.projectionMatrix, wide.matrixWorldInverse));
  const box = new THREE.Box3();
  const wx = cam.position.x + ox, wz = cam.position.z + oz, pcx = Math.floor(wx / C), pcz = Math.floor(wz / C), n = Math.ceil(opt.horizonReach / C);
  const cells = [];
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const cx = pcx + i, cz = pcz + j, d = Math.hypot(i, j) * C;
    if (d > opt.horizonReach || have.has(cx + ',' + cz)) continue;
    // the world repeats every 8.8 km from north to south (WRAP_Z in index.html); the open sea lies at the join
    if (Math.abs((cz + 0.5) * C) > 4400) continue;
    box.min.set(cx * C - ox, -60, cz * C - oz); box.max.set(cx * C + C - ox, 700, cz * C + C - oz);
    if (fr.intersectsBox(box)) cells.push([cx, cz, d]);
  }
  cells.sort((a, b) => a[2] - b[2]);
  const parts = []; let tris = 0, verts = 0, made = 0;
  const t0 = performance.now();
  for (const [cx, cz] of cells) {
    if (tris > budget.triangles || verts > budget.vertices) break;
    const ch = V.genChunk(cx, cz, 2); made++;
    const M = new THREE.Matrix4().makeTranslation(cx * C - ox, 0, cz * C - oz);
    for (const [g, m] of [[ch.geo, bMat], [ch.groundGeo, gMat]]) {
      if (!g || !g.attributes.position || !g.attributes.position.count) continue;
      if (!g.boundingBox) g.computeBoundingBox();
      if (g === ch.groundGeo && g.boundingBox.max.y < -1.5) { g.dispose(); continue; }   // sea floor, unseen under the water
      const gm = weld(g); if (gm !== g) g.dispose();
      parts.push({ o: { geometry: gm, material: m, isInstancedMesh: false, position: new THREE.Vector3() }, matrix: M, instance: -1, generated: true });
      tris += gm.index.count / 3; verts += gm.attributes.position.count;
    }
    for (const k of ['surfGeo', 'glowGeo']) if (ch[k]) ch[k].dispose();
  }
  info.farBlocks = made; info.farBlockCells = cells.length; info.farBlockTriangles = Math.round(tris); info.farBlockVertices = verts; info.tFarBlocks = Math.round(performance.now() - t0);
  return parts;
}

// the cells of the world whose blocks are loaded, under which the distant terrain is lowered out of sight
function loadedCells() {
  const V = window.__village, S = new Set();
  if (!V || !V.chunks) return S;
  for (const ch of V.chunks.values()) { if (ch.fade < 1 && !ch.prev) continue; S.add(ch.cx + ',' + ch.cz); }
  return S;
}
const BLOCK = 40;   // the game's block size in metres (C in index.html)

/* ---------- merging into one geometry ---------- */
// fine ripples for the water as a normal map that tiles: a sum of waves whose frequencies are whole numbers of
// cycles across the tile, in several directions
let rippleTex = null;
function rippleTexture() {
  if (rippleTex) return rippleTex;
  const N = 256, d = new Uint8Array(N * N * 4), waves = [];
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 24; i++) {
    const kx = Math.round((rnd() * 2 - 1) * (3 + i)), kz = Math.round((rnd() * 2 - 1) * (3 + i));
    if (!kx && !kz) continue;
    waves.push({ kx, kz, a: 1 / Math.hypot(kx, kz), ph: rnd() * Math.PI * 2 });
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let sx = 0, sz = 0;
    for (const w of waves) { const c = Math.cos(2 * Math.PI * (w.kx * i + w.kz * j) / N + w.ph) * w.a * 2 * Math.PI; sx += c * w.kx / N * N * 0.02; sz += c * w.kz / N * N * 0.02; }
    const l = Math.hypot(sx, sz, 1), k = (j * N + i) * 4;
    d[k] = Math.round((-sx / l * 0.5 + 0.5) * 255); d[k + 1] = Math.round((-sz / l * 0.5 + 0.5) * 255); d[k + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); d[k + 3] = 255;
  }
  rippleTex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  rippleTex.wrapS = rippleTex.wrapT = THREE.RepeatWrapping; rippleTex.magFilter = THREE.LinearFilter; rippleTex.minFilter = THREE.LinearFilter;
  rippleTex.colorSpace = THREE.NoColorSpace; rippleTex.needsUpdate = true;
  return rippleTex;
}

function buildGeometry(col, seaGeo, origin, info, opt) {
  // everything is moved so that the camera stands at the origin, where floats are finest
  const shift = new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z);
  const matCache = new Map(), materials = [];
  const normCache = new Map();
  const getNormals = g => {
    if (g.attributes.normal) return g.attributes.normal;
    let n = normCache.get(g); if (!n) { const c = g.clone(); c.computeVertexNormals(); n = c.attributes.normal; normCache.set(g, n); }
    return n;
  };
  // each part becomes one or more pieces: a range of triangles with one material
  const pieces = [];
  for (const p of col.parts) {
    const o = p.o, g = o.geometry, ms = Array.isArray(o.material) ? o.material : null;
    const idx = g.index, total = idx ? idx.count : g.attributes.position.count;
    const dr0 = Math.max(0, g.drawRange.start), dr1 = Math.min(total, g.drawRange.start + g.drawRange.count);
    const ranges = ms ? (g.groups.length ? g.groups : [{ start: 0, count: total, materialIndex: 0 }]).map(gr => ({ s: Math.max(dr0, gr.start), e: Math.min(dr1, gr.start + gr.count), m: ms[gr.materialIndex] }))
      : [{ s: dr0, e: dr1, m: o.material }];
    for (const r of ranges) {
      if (!usable(r.m) || r.e <= r.s) continue;
      const e3 = r.e - ((r.e - r.s) % 3);
      const cl = opt.materials ? classify(g, r.m, r.s, e3, idx) : null;
      if (!cl) { pieces.push({ p, s: r.s, e: e3, m: r.m, mi: convertMaterial(r.m, matCache, materials, !!p.far) }); continue; }
      // a mesh holding several classes of surface is split into one piece for each, triangle by triangle
      const by = new Map();
      for (let k = 0; k < cl.length; k++) { let L = by.get(cl[k]); if (!L) by.set(cl[k], L = []); L.push(r.s + k * 3); }
      for (const [c, L] of by) pieces.push({ p, s: 0, e: L.length * 3, tris: Uint32Array.from(L), m: r.m, mi: convertMaterial(r.m, matCache, materials, !!p.far, c) });
    }
  }
  const seaMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.07, metalness: 0, ior: 1.333, side: THREE.DoubleSide,
    normalMap: opt.ripple > 0 ? rippleTexture() : null, normalScale: new THREE.Vector2(opt.ripple, opt.ripple) });
  const seaIndex = materials.length; materials.push(seaMat);
  pieces.sort((a, b) => a.mi - b.mi);
  // a piece that covers a whole smooth-shaded mesh keeps its index and its vertices; a flat-shaded piece, or a piece
  // of a mesh with several materials, is written out three vertices to a triangle
  let nv = 0, ni = 0;
  for (const pc of pieces) {
    pc.indexed = !pc.tris && !pc.m.flatShading && !Array.isArray(pc.p.o.material);
    nv += pc.indexed ? pc.p.o.geometry.attributes.position.count : pc.e - pc.s; ni += pc.e - pc.s;
  }
  const seaTris = seaGeo ? seaGeo.index.count : 0;
  nv += seaGeo ? seaGeo.attributes.position.count : 0; ni += seaTris;
  info.triangles = ni / 3; info.vertices = nv;
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), Cc = new Float32Array(nv * 3), UV = new Float32Array(nv * 2), MI = new Uint16Array(nv);
  const I = new Uint32Array(ni);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c3 = new THREE.Vector3();
  const ic = new THREE.Color();
  const cells = col.far ? loadedCells() : null;
  info.loadedCells = cells ? cells.size : 0;
  let w = 0, wi = 0, seaUV = null; const groups = []; let gStart = 0, gMat = -1;
  for (const pc of pieces) {
    if (pc.mi !== gMat) { if (gMat >= 0) groups.push({ start: gStart, count: wi - gStart, materialIndex: gMat }); gMat = pc.mi; gStart = wi; }
    const o = pc.p.o, g = o.geometry, pos = g.attributes.position, idx = g.index, M = shift.clone().multiply(pc.p.matrix);
    nm.getNormalMatrix(M);
    const nrm = getNormals(g), colA = pc.m.vertexColors ? g.attributes.color : null, uvA = pc.m.map ? g.attributes.uv : null;
    let ir = 1, ig = 1, ib = 1;
    if (o.isInstancedMesh && o.instanceColor && pc.p.instance >= 0) { o.getColorAt(pc.p.instance, ic); ir = ic.r; ig = ic.g; ib = ic.b; }
    const farX = pc.p.far ? o.position.x : 0, farZ = pc.p.far ? o.position.z : 0;
    const putVertex = vi => {
      v.fromBufferAttribute(pos, vi);
      if (pc.p.far && cells) {
        // the far terrain's own shader drops it 60 m wherever a block has been built, so that the two never meet
        const wx = v.x + farX, wz = v.z + farZ;
        if (cells.has(Math.floor((wx - 2) / BLOCK) + ',' + Math.floor((wz - 2) / BLOCK)) && cells.has(Math.floor((wx + 2) / BLOCK) + ',' + Math.floor((wz - 2) / BLOCK))
          && cells.has(Math.floor((wx - 2) / BLOCK) + ',' + Math.floor((wz + 2) / BLOCK)) && cells.has(Math.floor((wx + 2) / BLOCK) + ',' + Math.floor((wz + 2) / BLOCK))) { v.y -= 60; info.farLowered = (info.farLowered || 0) + 1; }
      }
      v.applyMatrix4(M);
      P[w * 3] = v.x; P[w * 3 + 1] = v.y; P[w * 3 + 2] = v.z;
      n.fromBufferAttribute(nrm, vi).applyMatrix3(nm).normalize();
      N[w * 3] = n.x; N[w * 3 + 1] = n.y; N[w * 3 + 2] = n.z;
      if (colA) { Cc[w * 3] = colA.getX(vi) * ir; Cc[w * 3 + 1] = colA.getY(vi) * ig; Cc[w * 3 + 2] = colA.getZ(vi) * ib; }
      else { Cc[w * 3] = ir; Cc[w * 3 + 1] = ig; Cc[w * 3 + 2] = ib; }
      if (uvA) { UV[w * 2] = uvA.getX(vi); UV[w * 2 + 1] = uvA.getY(vi); }
      MI[w] = pc.mi; w++;
    };
    if (pc.indexed) {
      const base = w;
      for (let vi = 0; vi < pos.count; vi++) putVertex(vi);
      for (let t = pc.s; t < pc.e; t++) I[wi++] = base + (idx ? idx.getX(t) : t);
    } else {
      for (let tt = pc.s; tt < pc.e; tt += 3) {
        const w0 = w, t = pc.tris ? pc.tris[tt / 3] : tt;
        for (let q = 0; q < 3; q++) { putVertex(idx ? idx.getX(t + q) : t + q); I[wi++] = w - 1; }
        if (pc.m.flatShading) {
          a.fromArray(P, w0 * 3); b.fromArray(P, w0 * 3 + 3); c3.fromArray(P, w0 * 3 + 6);
          n.subVectors(c3, b).cross(a.sub(b)).normalize();
          for (let q = 0; q < 3; q++) n.toArray(N, (w0 + q) * 3);
        }
      }
    }
  }
  if (gMat >= 0) groups.push({ start: gStart, count: wi - gStart, materialIndex: gMat });
  // the sea goes last
  if (seaGeo) {
    const sp = seaGeo.attributes.position.array, sn = seaGeo.attributes.normal.array, sc = seaGeo.attributes.color.array, si = seaGeo.index.array;
    const s0 = wi, base = w;
    for (let k = 0; k < sp.length; k += 3) { P[w * 3 + k] = sp[k] - origin.x; P[w * 3 + k + 1] = sp[k + 1] - origin.y; P[w * 3 + k + 2] = sp[k + 2] - origin.z; }
    // the ripples are laid in world metres, with the tangent along x
    seaUV = [w, sp.length / 3];
    for (let k = 0, q = w; k < sp.length; k += 3, q++) { UV[q * 2] = sp[k] / opt.rippleSize; UV[q * 2 + 1] = sp[k + 2] / opt.rippleSize; }
    N.set(sn, w * 3); Cc.set(sc, w * 3); MI.fill(seaIndex, w, w + sp.length / 3); w += sp.length / 3;
    for (let t = 0; t < si.length; t++) I[wi++] = base + si[t];
    groups.push({ start: s0, count: wi - s0, materialIndex: seaIndex });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  const TG = new Float32Array(nv * 4);
  if (seaUV) for (let q = seaUV[0]; q < seaUV[0] + seaUV[1]; q++) { TG[q * 4] = 1; TG[q * 4 + 3] = 1; }
  geo.setAttribute('tangent', new THREE.BufferAttribute(TG, 4));
  geo.setAttribute('materialIndex', new THREE.BufferAttribute(MI, 1));
  geo.setIndex(new THREE.BufferAttribute(I, 1));
  for (const gr of groups) geo.addGroup(gr.start, gr.count, gr.materialIndex);
  info.materials = materials.length;
  return { geo, materials, seaIndex };
}

/* ---------- shaders for the raster passes ---------- */
const RASTER_VS = `
  in vec3 position; in vec3 normal; in vec3 color; in vec2 uv;
  uniform mat4 modelViewMatrix, projectionMatrix;
  out vec3 vCol; out vec2 vUv; out vec3 vN; out float vZ;
  void main(){ vCol=color; vUv=uv; vN=normal; vec4 mv=modelViewMatrix*vec4(position,1.0); vZ=-mv.z; gl_Position=projectionMatrix*mv; }`;
// the flat surface colour the path tracer sees; the sky and the sea are written as white with no coverage
function albedoMaterial(m, water) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
    uniforms: { uColor: { value: m.color.clone() }, uMap: { value: m.map || null }, uHasMap: { value: m.map ? 1 : 0 }, uWater: { value: water ? 1 : 0 } },
    vertexShader: RASTER_VS,
    fragmentShader: `precision highp float; uniform vec3 uColor; uniform sampler2D uMap; uniform float uHasMap, uWater;
      in vec3 vCol; in vec2 vUv; in vec3 vN; in float vZ; out vec4 o;
      void main(){ if (uWater>0.5){ o=vec4(1.0,1.0,1.0,0.0); return; }
        vec3 a=uColor*vCol; if (uHasMap>0.5) a*=texture(uMap,vUv).rgb; o=vec4(a,1.0); }`,
  });
}
// the world normal facing the camera and the distance along the view axis
const guideMaterial = () => new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
  vertexShader: RASTER_VS,
  fragmentShader: `precision highp float; in vec3 vCol; in vec2 vUv; in vec3 vN; in float vZ; out vec4 o;
    void main(){ vec3 n=normalize(vN); if (!gl_FrontFacing) n=-n; o=vec4(n,vZ); }`,
});

const QUAD_VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`;
const pass = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VS, fragmentShader: fs, depthTest: false, depthWrite: false, ...extra });

// adds one sub-pixel sample of the two colour passes to their running sums: the sky and the sea count as white
const accumulateMat = pass(`uniform sampler2D tA, tB; uniform float uWhich; varying vec2 vUv;
  void main(){ vec4 a=texture2D(tA,vUv); vec3 b=texture2D(tB,vUv).rgb;
    gl_FragColor = uWhich<0.5 ? vec4(mix(vec3(1.0),a.rgb,a.a),a.a) : vec4(mix(vec3(1.0),b,a.a),1.0); }`,
  { tA: { value: null }, tB: { value: null }, uWhich: { value: 0 } },
  { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, transparent: true });

const copyMat = pass(`uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor=texture2D(t,vUv); }`, { t: { value: null } }, { blending: THREE.NoBlending });

// the light falling on each surface (radiance over flat colour) and the variance of its mean, from the two halves of
// the samples
const demodMat = pass(`uniform sampler2D tP, tH, tApt; uniform float uN; uniform vec2 uTexel; varying vec2 vUv;
  float lum(vec3 c){ return dot(c,vec3(0.2126,0.7152,0.0722)); }
  vec3 light(vec2 uv){ return texture2D(tP,uv).rgb/max(texture2D(tApt,uv).rgb/uN,vec3(0.03)); }
  void main(){ vec3 P=texture2D(tP,vUv).rgb, H=texture2D(tH,vUv).rgb; vec4 A=texture2D(tApt,vUv)/uN;
    vec3 a=max(A.rgb,vec3(0.03)); vec3 E=P/a; float d=lum(P-H)/max(lum(a),0.03);
    // a pixel far brighter than every one of its eight neighbours is a firefly: it takes their mean instead
    vec3 s=vec3(0.0); float mx=0.0;
    for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){ if (x==0&&y==0) continue; vec3 q=light(vUv+vec2(float(x),float(y))*uTexel); s+=q; mx=max(mx,lum(q)); }
    if (lum(E)>3.0*mx+0.05){ E=s/8.0; d=0.0; }
    gl_FragColor=vec4(E,d*d); }`,
  { tP: { value: null }, tH: { value: null }, tApt: { value: null }, uN: { value: 1 }, uTexel: { value: new THREE.Vector2() } }, { blending: THREE.NoBlending });

// one step of the edge-aware a-trous filter (a 5x5 B3 spline at a spacing of uStep pixels), weighted by the plane of
// the surface, its normal and the difference in light measured against the estimated noise
const atrousMat = pass(`uniform sampler2D tC, tG; uniform vec2 uTexel; uniform float uStep, uSigL, uTanY, uAspect; varying vec2 vUv;
  float lum(vec3 c){ return dot(c,vec3(0.2126,0.7152,0.0722)); }
  vec3 viewPos(vec2 uv, float z){ return vec3((uv*2.0-1.0)*vec2(uTanY*uAspect,uTanY)*z, -z); }
  void main(){
    vec4 c=texture2D(tC,vUv); vec4 g=texture2D(tG,vUv);
    if (g.w<=0.0 || g.w>1e5){ gl_FragColor=c; return; }
    // the noise of the centre, smoothed over its neighbours
    float v=0.0, vw=0.0;
    for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){ float k=(x==0?0.5:0.25)*(y==0?0.5:0.25); v+=texture2D(tC,vUv+vec2(float(x),float(y))*uTexel).a*k; vw+=k; }
    v/=vw;
    float lc=lum(c.rgb), sl=uSigL*sqrt(max(v,0.0))+1e-4+0.02*lc;
    vec3 p=viewPos(vUv,g.w);
    float h[3]; h[0]=0.375; h[1]=0.25; h[2]=0.0625;
    vec3 sum=vec3(0.0); float ws=0.0, vs=0.0;
    for (int y=-2;y<=2;y++) for (int x=-2;x<=2;x++){
      vec2 uv=vUv+vec2(float(x),float(y))*uStep*uTexel;
      vec4 q=texture2D(tC,uv); vec4 gq=texture2D(tG,uv);
      if (gq.w<=0.0 || gq.w>1e5) continue;
      float wn=pow(max(0.0,dot(g.xyz,gq.xyz)),64.0);
      float wp=exp(-abs(dot(g.xyz,viewPos(uv,gq.w)-p))/(0.003*g.w*uStep+0.01));
      float wl=exp(-abs(lc-lum(q.rgb))/sl);
      float w=h[x<0?-x:x]*h[y<0?-y:y]*wn*wp*wl;
      sum+=q.rgb*w; vs+=q.a*w*w; ws+=w; }
    gl_FragColor = ws>1e-6 ? vec4(sum/ws, vs/(ws*ws)) : c; }`,
  { tC: { value: null }, tG: { value: null }, uTexel: { value: new THREE.Vector2() }, uStep: { value: 1 }, uSigL: { value: 4 }, uTanY: { value: 1 }, uAspect: { value: 1 } }, { blending: THREE.NoBlending });

// the light filtered, times the game's own surface colour; then the game's fog, tone mapping and sRGB
const composeMat = pass(`uniform sampler2D tE, tP, tApt, tAg, tG; uniform float uN, uFog, uFogNear, uFogFar, uTanY, uAspect, uSceneGain; uniform vec3 uHor, uMid;
  uniform mat3 uCamRot; uniform vec2 uRemod; uniform float uHaze, uSigma, uHazeH, uCamY, uDay; uniform vec3 uTop, uSun, uSunCol; varying vec2 vUv;
  // the sky's colour in a direction, as the game's sky shader works it out, without the sun's disc
  vec3 skyAt(vec3 d){ float y=d.y;
    vec3 c = y>0.12 ? mix(uMid,uTop,clamp((y-0.12)/0.6,0.0,1.0)) : mix(uHor,uMid,clamp((y+0.04)/0.16,0.0,1.0));
    float sd=max(dot(d,uSun),0.0); return c+uSunCol*(pow(sd,12.0)*0.35+pow(sd,3.0)*0.12*(1.0-uDay)); }
  void main(){
    vec4 A=texture2D(tApt,vUv)/uN; vec3 Ag=texture2D(tAg,vUv).rgb/uN; vec3 E=texture2D(tE,vUv).rgb; vec4 g=texture2D(tG,vUv);
    vec3 a=max(A.rgb,vec3(0.03));
    // the game's colour, kept within reach of the path tracer's where the two scenes disagree; its patterns fade
    // with distance in the game, and the colour is the path tracer's own beyond that
    float rm=1.0-smoothstep(uRemod.x,uRemod.y,g.w);
    vec3 col=E*mix(a,clamp(Ag,a*0.2,a*5.0),rm);
    bool scene=g.w>0.0 && g.w<1e5;
    // the scene, but not the sky behind it, takes the gain that matches the game's brightness
    if (scene) col*=uSceneGain;
    // aerial perspective: light from the surface is dimmed by the haze between, and the haze itself scatters the
    // light of the sky towards the eye; the haze thins exponentially with height, so the optical depth is integrated
    // along the ray between the eye's height and the point's
    if (scene && uHaze>0.5){
      vec3 vd=vec3((vUv*2.0-1.0)*vec2(uTanY*uAspect,uTanY),-1.0); vec3 d=normalize(uCamRot*vd);
      float dist=g.w*length(vd), y0=max(uCamY,0.0), y1=max(uCamY+d.y*dist,0.0), H=uHazeH;
      float od = abs(y1-y0)<1.0 ? uSigma*dist*exp(-y0/H) : uSigma*dist*H*(exp(-y0/H)-exp(-y1/H))/(y1-y0);
      float T=exp(-od);
      vec3 inS=skyAt(normalize(vec3(d.x,max(d.y,0.0)*0.25+0.01,d.z)));
      col=col*T+inS*(1.0-T); }
    gl_FragColor=vec4(col,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // the game mixes in its fog after tone mapping, with the fog colour taken as it stands, and so does this
    if (g.w>0.0 && g.w<1e5 && uFog>0.5){
      vec3 d=normalize(uCamRot*vec3((vUv*2.0-1.0)*vec2(uTanY*uAspect,uTanY),-1.0));
      float f=smoothstep(uFogNear,uFogFar,g.w);
      gl_FragColor.rgb=mix(gl_FragColor.rgb,mix(uHor,uMid,clamp((d.y+0.04)/0.16,0.0,1.0)),f); }
  }`,
  { tE: { value: null }, tP: { value: null }, tApt: { value: null }, tAg: { value: null }, tG: { value: null }, uN: { value: 1 }, uSceneGain: { value: 1 }, uRemod: { value: new THREE.Vector2(250, 420) }, uHaze: { value: 1 }, uSigma: { value: 1e-4 }, uHazeH: { value: 1200 }, uCamY: { value: 0 },
    uDay: { value: 1 }, uTop: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uFog: { value: 1 }, uFogNear: { value: 90 }, uFogFar: { value: 1500 },
    uTanY: { value: 1 }, uAspect: { value: 1 }, uHor: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uCamRot: { value: new THREE.Matrix3() } },
  { blending: THREE.NoBlending, toneMapped: true });

// a float buffer drawn for inspection: tone mapped, or as it is
const viewMat = pass(`uniform sampler2D t; uniform float uScale, uDiv; uniform vec4 uMode; varying vec2 vUv;
  void main(){ vec4 c=texture2D(t,vUv)/uDiv; vec3 o=uMode.x>0.5? c.rgb*uScale : uMode.y>0.5 ? c.xyz*0.5+0.5 : uMode.z>0.5 ? vec3(c.w/uScale) : vec3(c.a);
    gl_FragColor=vec4(o,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`, { t: { value: null }, uScale: { value: 1 }, uDiv: { value: 1 }, uMode: { value: new THREE.Vector4(1, 0, 0, 0) } }, { blending: THREE.NoBlending, toneMapped: true });

function runPass(mat, out) {
  const { R, quad } = ctx;
  quad.material = mat; R.setRenderTarget(out); quad.render(R); R.setRenderTarget(null);
}
function snapshot(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(ctx.canvas, 0, 0); return c;
}

/* ---------- the albedo of the game's own materials under a flat white light ---------- */
function gameAlbedoPass(scene, cam, col, out, albedo = true) {
  const { R } = ctx;
  const saved = [];
  const set = (o, k, v) => { saved.push([o, k, o[k]]); o[k] = v; };
  if (albedo) scene.traverse(o => {
    if (o.isLight) {
      if (o.isHemisphereLight) { saved.push([o.color, 'copy', o.color.clone()], [o.groundColor, 'copy', o.groundColor.clone()]); o.color.setRGB(1, 1, 1); o.groundColor.setRGB(1, 1, 1); set(o, 'intensity', Math.PI); }
      else set(o, 'intensity', 0);
    }
  });
  for (const o of col.renderables) if (!col.included.has(o)) set(o, 'visible', false);
  if (scene.fog) { set(scene.fog, 'near', 1e9); set(scene.fog, 'far', 2e9); }
  set(scene, 'background', null);
  const ac = R.autoClear;
  R.setClearColor(0xffffff, 1);
  R.setRenderTarget(out); R.clear(); R.render(scene, cam); R.setRenderTarget(null);
  R.autoClear = ac;
  for (let i = saved.length - 1; i >= 0; i--) { const [o, k, v] = saved[i]; if (k === 'copy') o.copy(v); else o[k] = v; }
}

/* ---------- the main entry ---------- */
export async function pathTrace(opts = {}) {
  const opt = { ...DEFAULTS, ...opts };
  const { renderer, scene, camera, signal, onProgress } = opt;
  const samples = Math.max(1, Math.round(opt.samples));
  if (!scene || !camera) throw new Error('pathTrace needs the scene and the camera.');
  const gameCanvas = renderer && renderer.domElement;
  const w = Math.round(opt.width || (gameCanvas ? gameCanvas.width : 1280));
  const h = Math.round(opt.height || (gameCanvas ? gameCanvas.height : Math.round(w / (camera.aspect || 1.6))));
  const info = { width: w, height: h, samples };
  const t0 = performance.now(), mark = k => { info[k] = Math.round(performance.now() - t0); };
  const report = (phase, fraction) => { if (onProgress) try { onProgress({ phase, fraction, info }); } catch (e) { /* the caller's own error */ } };
  checkAbort(signal);
  getContext(w, h);
  const { R, pt } = ctx;

  // the camera as it is now, standing alone
  camera.updateMatrixWorld();
  const cam = new THREE.PerspectiveCamera(camera.fov, w / h, camera.near, camera.far);
  cam.zoom = camera.zoom; cam.matrixAutoUpdate = false;
  cam.matrix.copy(camera.matrixWorld); cam.matrix.decompose(cam.position, cam.quaternion, cam.scale);
  cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  // the same camera at the origin, for the path-traced scene, which is moved there
  const origin = cam.position.clone();
  const camPT = cam.clone(); camPT.matrixAutoUpdate = false;
  camPT.matrix.copy(cam.matrix).setPosition(0, 0, 0); camPT.matrix.decompose(camPT.position, camPT.quaternion, camPT.scale);
  camPT.updateMatrixWorld(true); camPT.updateProjectionMatrix();

  // the world is loaded far beyond the game's draw distance, and handed back to the game once the scene has been
  // copied and its colour passes drawn (in the finally block below)
  const V = window.__village;
  const extend = opt.extend && V && V.updateChunks && V.genChunk && V.chunks;
  if (extend) { opt.farReach = Math.max(opt.farReach, opt.horizonReach); opt.farTerrain = false; }
  camPT.far = Math.max(camPT.far, opt.horizonReach * 5); camPT.updateProjectionMatrix();
  let restoreView = null, generated = [];
  try {
  if (extend) { report('world', 0); await sleep0(); restoreView = extendView(V, opt, info, cam); mark('tLoad'); }
  checkAbort(signal);

  // everything taken from the live scene is taken now, in one go, before the game moves on
  report('scene', 0);
  scene.updateMatrixWorld(true);
  var col = collect(scene, cam, opt, info);
  if (extend) {
    let n = 0, nv = 0; for (const p of col.parts) { const g = p.o.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3; nv += g.attributes.position.count; }
    // the sea takes its share of the budget too
    if (col.sea) { n += col.sea.geometry.index.count / 3; nv += col.sea.geometry.attributes.position.count; }
    generated = farBlocks(V, cam, opt, info, { triangles: opt.maxTriangles - n, vertices: opt.maxVertices - nv * 1.3 });
    col.parts.push(...generated);
  }
  var skyU = col.sky ? col.sky.material.uniforms : null;
  var seaGeo = col.sea ? buildSea(col.sea, opt.horizonReach * 4) : null;
  mark('tCollect');
  var { geo, materials, seaIndex } = buildGeometry(col, seaGeo, origin, info, opt);
  for (const p of generated) p.o.geometry.dispose();
  mark('tGeometry');
  var sunObj = col.sun;
  var sunDir = new THREE.Vector3(0, 1, 0), sunRad = new THREE.Color(0, 0, 0);
  if (sunObj) {
    sunObj.updateMatrixWorld(); sunObj.target.updateMatrixWorld();
    sunDir.setFromMatrixPosition(sunObj.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(sunObj.target.matrixWorld)).normalize();
    sunRad.copy(sunObj.color).multiplyScalar(sunObj.intensity);
    info.sun = { dir: sunDir.toArray().map(x => +x.toFixed(3)), intensity: +sunObj.intensity.toFixed(3) };
  }
  var hemiInfo = col.hemi ? { color: col.hemi.color.clone(), intensity: col.hemi.intensity } : null;
  var fallbackSky = { uTop: { value: new THREE.Color(0.1, 0.25, 0.6) }, uMid: { value: new THREE.Color(0.2, 0.4, 0.7) }, uHor: { value: new THREE.Color(0.5, 0.6, 0.7) }, uSun: { value: sunDir }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uDay: { value: 1 } };
  var SU = skyU || fallbackSky;
  var exposure = opt.exposure ?? (renderer ? renderer.toneMappingExposure : 1);
  var fogNear = scene.fog ? scene.fog.near : 90, fogFar = scene.fog ? scene.fog.far : 1500;
  var horCol = SU.uHor.value.clone(), midCol = SU.uMid.value.clone();

  // the two colour passes, with the same sub-pixel offsets
  report('albedo', 0);
  var rasterScene = new THREE.Scene();
  // the sea, glass and metal keep the path tracer's colour: they are written as uncovered in the colour passes
  var rasterMats = materials.map((m, i) => albedoMaterial(m, i === seaIndex || isDirectClass(m.userData.cls)));
  var rasterMesh = new THREE.Mesh(geo, rasterMats); rasterMesh.frustumCulled = false; rasterScene.add(rasterMesh);
  var tA = target('a', w, h, THREE.HalfFloatType, true), tB = target('b', w, h, THREE.HalfFloatType, true);
  var accPt = target('accPt', w, h, THREE.FloatType), accGame = target('accGame', w, h, THREE.FloatType);
  R.setClearColor(0x000000, 0);
  for (const t of [accPt, accGame]) { R.setRenderTarget(t); R.clear(); }
  R.setRenderTarget(null);
  var halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
  var NJ = Math.max(1, opt.jitter);
  for (let j = 0; j < NJ; j++) {
    const jx = NJ > 1 ? halton(j + 1, 2) - 0.5 : 0, jy = NJ > 1 ? halton(j + 1, 3) - 0.5 : 0;
    cam.setViewOffset(w, h, jx, jy, w, h); camPT.setViewOffset(w, h, jx, jy, w, h);
    R.setClearColor(0xffffff, 0); R.setRenderTarget(tA); R.clear(); R.render(rasterScene, camPT);
    gameAlbedoPass(scene, cam, col, tB);
    accumulateMat.uniforms.tA.value = tA.texture; accumulateMat.uniforms.tB.value = tB.texture;
    accumulateMat.uniforms.uWhich.value = 0; R.autoClear = false; runPass(accumulateMat, accPt);
    accumulateMat.uniforms.uWhich.value = 1; runPass(accumulateMat, accGame); R.autoClear = true;
  }
  cam.clearViewOffset(); camPT.clearViewOffset();
  // the guide for the filter: normals and depth at the centre of each pixel
  var tG = target('guide', w, h, THREE.FloatType, true);
  rasterScene.overrideMaterial = guideMaterial();
  R.setClearColor(0x000000, 0); R.setRenderTarget(tG); R.clear(); R.render(rasterScene, camPT); R.setRenderTarget(null);
  rasterScene.overrideMaterial.dispose(); rasterScene.overrideMaterial = null;
  // the game's own lighting of the same surfaces, for matching the brightness later
  if (opt.autoExposure && opt.exposure == null) gameAlbedoPass(scene, cam, col, target('lit', w, h, THREE.FloatType, true), false);
  await gpuIdle(R);
  mark('tAlbedo');
  } finally {
    if (restoreView) restoreView();
  }
  checkAbort(signal);

  // the bounding volume hierarchy over every triangle
  report('bvh', 0);
  await sleep0();
  const bvh = new MeshBVH(geo, { strategy: SAH, maxLeafTris: 1, indirect: true });
  mark('tBVH');
  checkAbort(signal);

  // the sky and the sun
  const sky = buildSky(SU, sunDir, sunRad, { ...opt, hemi: hemiInfo });
  info.skyGain = sky.gains.map(x => +x.toFixed(3));
  mark('tSky');

  // hand everything to the path tracer
  const m = pt.material;
  m.bounces = opt.bounces; m.transmissiveBounces = 2; m.filterGlossyFactor = 0.5;
  // the stratified sample lists repeat the same numbers in every sample here, so plain PCG random numbers are used
  m.setDefine('RANDOM_TYPE', opt.randomType ?? 0);
  m.uniforms.uSampleClamp.value = opt.sampleClamp;
  m.uniforms.uSpecSky.value.set(1 / sky.gains[0], 1 / sky.gains[1], 1 / sky.gains[2]);
  m.bvh.updateFrom(bvh);
  m.attributesArray.updateFrom(geo.attributes.normal, geo.attributes.tangent, geo.attributes.uv, geo.attributes.color);
  m.materialIndexAttribute.updateFrom(geo.attributes.materialIndex);
  const textures = [...new Set(materials.flatMap(x => [x.map, x.normalMap]).filter(Boolean))];
  m.textures.setTextures(R, textures, opt.textureSize, opt.textureSize);
  m.materials.updateFrom(materials, textures);
  m.lights.updateFrom([], []);
  m.envMapInfo.updateFrom(sky.envTex);
  m.environmentIntensity = 1; m.environmentRotation.identity();
  m.backgroundMap = sky.bgTex; m.backgroundAlpha = 1; m.backgroundIntensity = 1; m.backgroundBlur = 0; m.backgroundRotation.identity();
  pt.alpha = !R.extensions.get('EXT_float_blend');
  const tiles = opt.tiles || Math.max(1, Math.ceil(Math.sqrt(w * h / 70000)));
  pt.tiles.set(tiles, tiles);
  pt.setSize(w, h);
  pt.setCamera(camPT);
  pt.reset();
  mark('tUpload');

  // the passes that make the picture from the samples, set up before the samples are taken so that the picture can
  // be shown while it clears
  const tP = pt.target;
  const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / cam.zoom;
  const tH = target('half', w, h, THREE.FloatType);
  demodMat.uniforms.uTexel.value.set(1 / w, 1 / h); demodMat.uniforms.tP.value = tP.texture; demodMat.uniforms.tH.value = tH.texture; demodMat.uniforms.tApt.value = accPt.texture; demodMat.uniforms.uN.value = NJ;
  const tE0 = target('e0', w, h), tE1 = target('e1', w, h);
  const cu = composeMat.uniforms;
  cu.tP.value = tP.texture; cu.tApt.value = accPt.texture; cu.tAg.value = accGame.texture; cu.tG.value = tG.texture;
  cu.uRemod.value.set(opt.remodReach[0], opt.remodReach[1]);
  cu.uHaze.value = opt.haze ? 1 : 0; cu.uSigma.value = 3.912 / opt.hazeVisibility; cu.uHazeH.value = opt.hazeHeight; cu.uCamY.value = origin.y;
  cu.uDay.value = SU.uDay.value; cu.uTop.value.copy(SU.uTop.value); cu.uSun.value.copy(SU.uSun.value); cu.uSunCol.value.copy(SU.uSunCol.value);
  cu.uN.value = NJ; cu.uFog.value = opt.fog && !opt.haze && scene.fog ? 1 : 0; cu.uFogNear.value = fogNear; cu.uFogFar.value = fogFar;
  cu.uTanY.value = tanY; cu.uAspect.value = w / h; cu.uHor.value.copy(horCol); cu.uMid.value.copy(midCol);
  cu.uCamRot.value.setFromMatrix4(cam.matrixWorld);
  cu.uSceneGain.value = 1;
  // the exposure is brought part of the way towards that of the game: the mean log luminance of the nearer surfaces
  // in the path-traced light is compared with the same surfaces lit by the game's own lights (without its shadows).
  // It is measured once, early in the sampling, from the unfiltered light, and kept to the end, so that the picture
  // shown while it clears and the final picture have the same exposure
  const measureGain = () => {
    if (!(opt.autoExposure && opt.exposure == null)) return;
    runPass(demodMat, tE0); cu.tE.value = tE0.texture;
    const tL = target('lin', w, h), tR = target('lit', w, h, THREE.FloatType, true);   // tR was drawn with the colour passes
    cu.uSceneGain.value = 1; cu.uFog.value = 0; cu.uHaze.value = 0; runPass(composeMat, tL); cu.uFog.value = opt.fog && !opt.haze && scene.fog ? 1 : 0; cu.uHaze.value = opt.haze ? 1 : 0;
    const a = new Float32Array(w * h * 4), b = new Float32Array(w * h * 4), gd = new Float32Array(w * h * 4), cv = new Float32Array(w * h * 4);
    R.readRenderTargetPixels(tL, 0, 0, w, h, a); R.readRenderTargetPixels(tR, 0, 0, w, h, b);
    R.readRenderTargetPixels(tG, 0, 0, w, h, gd); R.readRenderTargetPixels(accPt, 0, 0, w, h, cv);
    let sa = 0, sb = 0, n = 0;
    for (let i = 0; i < w * h; i += 3) {
      const k = i * 4, z = gd[k + 3];
      if (!(z > 0 && z < 400) || cv[k + 3] < NJ - 0.01) continue;
      const la = 0.2126 * a[k] + 0.7152 * a[k + 1] + 0.0722 * a[k + 2];
      const lb = 0.2126 * b[k] + 0.7152 * b[k + 1] + 0.0722 * b[k + 2];
      sa += Math.log(la + 1e-3); sb += Math.log(lb + 1e-3); n++;
    }
    if (n > 1000) {
      const k = Math.exp((sb - sa) / n);
      info.exposureMatch = +k.toFixed(3);
      cu.uSceneGain.value = Math.min(opt.autoExposureMax, Math.max(0.85, Math.pow(k, opt.autoExposure)));
      info.sceneGain = +cu.uSceneGain.value.toFixed(3);
    }
  };
  // the picture as it stands, unfiltered, drawn into one canvas that is handed to onFrame each time
  let frameCanvas = null, lastFrame = 0;
  const showFrame = (progress) => {
    runPass(demodMat, tE0); cu.tE.value = tE0.texture;
    R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = exposure;
    runPass(composeMat, null); R.toneMapping = THREE.NoToneMapping;
    if (!frameCanvas) { frameCanvas = document.createElement('canvas'); frameCanvas.width = w; frameCanvas.height = h; }
    frameCanvas.getContext('2d').drawImage(ctx.canvas, 0, 0);
    try { opt.onFrame(frameCanvas, progress); } catch (e) { /* the caller's own error */ }
    lastFrame = performance.now();
  };

  // the samples, a tile at a time, letting the page breathe in between
  report('trace', 0);
  const half = Math.max(1, Math.floor(samples / 2));
  let tTrace = 0, halfDone = false, gainDone = false;
  while (pt.samples < samples) {
    checkAbort(signal);
    const s0 = pt.samples;
    pt.update();
    if (pt.isCompiling) { await new Promise(r => setTimeout(r, 30)); continue; }
    if (tTrace === 0) { await gpuIdle(R); mark('tCompile'); tTrace = performance.now(); }
    if (Math.floor(pt.samples) !== Math.floor(s0)) {
      if (!halfDone && pt.samples >= half) { copyMat.uniforms.t.value = pt.target.texture; runPass(copyMat, tH); halfDone = true; }
      if (!gainDone && pt.samples >= Math.min(8, samples)) { measureGain(); gainDone = true; }
      if (opt.onFrame && gainDone && performance.now() - lastFrame >= opt.frameInterval && pt.samples < samples) showFrame(pt.samples / samples);
      await gpuIdle(R);
      report('trace', pt.samples / samples);
    }
  }
  if (!gainDone) measureGain();
  await gpuIdle(R);
  info.traceMs = Math.round(performance.now() - tTrace);
  info.samplesPerSecond = +(samples / (info.traceMs / 1000)).toFixed(2);
  mark('tTrace');

  // the light on each surface, filtered, then the picture
  report('denoise', 0);
  runPass(demodMat, tE0);
  let src = tE0, dst = tE1;
  atrousMat.uniforms.tG.value = tG.texture; atrousMat.uniforms.uTexel.value.set(1 / w, 1 / h);
  atrousMat.uniforms.uTanY.value = tanY; atrousMat.uniforms.uAspect.value = w / h;
  for (let k = 0; k < opt.denoise; k++) {
    atrousMat.uniforms.tC.value = src.texture; atrousMat.uniforms.uStep.value = 1 << k;
    runPass(atrousMat, dst); [src, dst] = [dst, src];
  }
  cu.tE.value = src.texture;
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = exposure;
  runPass(composeMat, null);
  const out = snapshot(w, h);

  // the intermediate buffers, drawn for inspection when asked for
  if (opt.debug) {
    const show = (tex, mode, scale = 1, div = 1) => { viewMat.uniforms.t.value = tex; viewMat.uniforms.uMode.value.set(...mode); viewMat.uniforms.uScale.value = scale; viewMat.uniforms.uDiv.value = div; runPass(viewMat, null); return snapshot(w, h); };
    opt.debug.raw = show(tP.texture, [1, 0, 0, 0]);
    opt.debug.light = show(src.texture, [1, 0, 0, 0], 0.5);
    opt.debug.lightNoisy = show(tE0.texture, [1, 0, 0, 0], 0.5);
    R.toneMapping = THREE.NoToneMapping;
    opt.debug.albedoPt = show(accPt.texture, [1, 0, 0, 0], 1, NJ);
    opt.debug.albedoGame = show(accGame.texture, [1, 0, 0, 0], 1, NJ);
    opt.debug.normal = show(tG.texture, [0, 1, 0, 0]);
    opt.debug.depth = show(tG.texture, [0, 0, 1, 0], 300);
  }
  R.toneMapping = THREE.NoToneMapping;
  mark('tTotal');
  info.exposure = exposure;

  // what was made for this picture alone is let go; the renderer and the compiled path tracer are kept
  bvh.geometry = null;
  geo.dispose(); rasterMats.forEach(x => x.dispose()); materials.forEach(x => x.dispose());
  sky.envTex.dispose(); sky.bgTex.dispose();
  out.info = info;
  report('done', 1);
  if (opt.onFrame) try { opt.onFrame(out, 1); } catch (e) { /* the caller's own error */ }
  return out;
}

// the inner steps, for the test bench
export const _internals = { buildSea, buildSky, collect, buildGeometry, albedoMaterial, guideMaterial };
