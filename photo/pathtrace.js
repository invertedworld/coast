/* A path-traced picture of the village, seen from the game's camera.

   pathTrace({renderer, scene, camera, samples, width, height, onProgress, onFrame, signal, ...settings})
     -> Promise<HTMLCanvasElement>

   renderer is optional and is only read (its canvas size and exposure); everything is drawn with a renderer of this
   module's own, on a canvas of its own, so that the state of the game's renderer is never touched. The renderer and
   the compiled path tracer are kept between calls. The settings and their defaults are listed in DEFAULTS below.
   onProgress({phase, fraction, info}) reports the phases 'world', 'scene', 'albedo', 'bvh', 'trace', 'denoise', 'done'.
   signal is an AbortSignal; aborting rejects the promise with an AbortError.

   onFrame(canvas, progress) shows the picture while it is made. While the samples accumulate it is called after the
   first sample and then at most once every frameInterval milliseconds (120 by default, longer if drawing the frames
   would take more than a tenth of the time), after a whole sample has been added, with progress the share of the
   samples taken so far (above 0 and below 1). The canvas is a 2D canvas of the final size holding the picture as it
   stands: the light filtered lightly (previewFilter), times the game's surface colour, with haze, exposure and tone
   mapping as in the final picture, so that it is recognisable from the first sample and sharpens as the samples add
   up. The same canvas object is passed each time and is drawn over before the next call, so a caller that keeps a
   frame copies it. Last, after the filter, onFrame is called once with progress exactly 1 and the very canvas the
   promise resolves with.

   The world. The picture is given a world of its own, built round the camera and only where it looks (gatherWorld):
   each block at the detail its distance asks for, taken from the game where the game holds it and otherwise generated
   with the game's genChunk for the picture alone, a few at a time between frames, out to blockReach; beyond, out to
   horizonReach, the land is a terrain mesh made from the game's coarse terrain. The game's draw distance is not
   touched. The scene is kept for the next picture of the same view (releasePathTrace() lets it go).

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
  samples: 128,            // samples per pixel
  bounces: 3,              // diffuse and glossy bounces after the camera ray
  extend: true,            // build the world for the picture beyond the game's draw distance, in the view
  lodRings: [3, 12],       // blocks from the camera: full detail out to the first ring, simplified to the second, outlines beyond
  blockReach: null,        // metres: blocks with their buildings are built out to here (or to horizonReach, if nearer);
                           // null takes 1600 m for a horizonReach up to 5 km and 42 % of it beyond, so that the longest
                           // draw distances keep the distant islands' cliffs and villages as blocks
  horizonReach: 5000,      // metres: beyond the blocks, the land is drawn as terrain alone out to here
  terrainStep: 0.005,      // radians: the angular spacing of the distant terrain's points, as seen from the camera
  colourReach: 520,        // metres: within this the game's own surface colours are drawn for blocks built for the picture
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
  frustumWidenFar: 1.12,   // and this much wider beyond widenReach
  widenReach: 320,         // metres
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
  previewFilter: 4,        // a-trous iterations for the frames handed to onFrame (0 shows them unfiltered)
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
    // the defines are set now as every picture uses them (plain PCG random numbers, no depth of field, the sky as the
    // background, no fog), which starts the compilation of the path tracer in the background while the world is built
    m.setDefine('RANDOM_TYPE', 0); m.setDefine('FEATURE_DOF', 0); m.setDefine('FEATURE_BACKGROUND_MAP', 1); m.setDefine('FEATURE_FOG', 0);
    if (!pt.isCompiling) pt._compileFunction();
    ctx = { R, pt, canvas, quad: new FullScreenQuad(null), targets: new Map(), uploaded: null };
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
// gives the page a turn between slices of work: scheduler.yield where the browser has it, which is not slowed as a
// chain of zero timeouts is
const yieldPage = () => (globalThis.scheduler && typeof globalThis.scheduler.yield === 'function') ? globalThis.scheduler.yield() : sleep0();
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

/* ---------- the BVH, built in workers ----------
   Building the bounding volume hierarchy over a few million triangles takes many seconds on one thread, so it is
   built in parallel, off the page. The triangles are split into 2^k groups by halving them at the median of their
   centres along the longest axis, k times over; each group's hierarchy is built with SAH in a worker of its own (the
   workers are kept between calls), and the groups' hierarchies are joined under the k levels of the split, in the
   layout three-mesh-bvh uses: 32 bytes a node, six floats of bounds, then for an inner node the 32-bit word at which
   its right child starts (the left child follows it directly) and the split axis, and for a leaf the offset of its
   first triangle, its count of triangles (16 bits) and the leaf flag 0xFFFF. The vendored module is loaded into the
   workers with its import of 'three' pointed at the URL the page's import map gives. Should a worker fail, the
   hierarchy is built on the page instead. */
let bvhPool = null;
async function getBVHPool(n) {
  if (bvhPool && bvhPool.n === n) return bvhPool.ready;
  if (bvhPool) dropBVHPool();
  const pool = { n, workers: [] };
  pool.ready = (async () => {
    const threeURL = import.meta.resolve('three'), vendorURL = new URL('./vendor/pathtracer.module.js', import.meta.url).href;
    const src = (await (await fetch(vendorURL)).text()).replace(/from\s*"three"/g, `from"${threeURL}"`);
    const modURL = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const code = `import { MeshBVH } from '${modURL}';
      import { BufferGeometry, BufferAttribute } from '${threeURL}';
      onmessage = e => {
        try {
          const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(e.data.position, 3));
          const s = MeshBVH.serialize(new MeshBVH(g, e.data.options), { cloneBuffers: false });
          postMessage({ root: s.roots[0], indirect: s.indirectBuffer }, [s.roots[0], s.indirectBuffer.buffer]);
        } catch (err) { postMessage({ error: String(err && err.message || err) }); }
      };`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    for (let i = 0; i < n; i++) pool.workers.push(new Worker(url, { type: 'module' }));
    return pool;
  })();
  bvhPool = pool;
  return pool.ready;
}
function dropBVHPool() { if (!bvhPool) return; const p = bvhPool; bvhPool = null; p.ready.then(q => q.workers.forEach(w => w.terminate()), () => {}); }
function runWorker(wk, msg, transfer, signal) {
  return new Promise((res, rej) => {
    const onAbort = () => rej(new DOMException('The path tracing was stopped.', 'AbortError'));
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    wk.onmessage = e => { if (signal) signal.removeEventListener('abort', onAbort); e.data.error ? rej(new Error(e.data.error)) : res(e.data); };
    wk.onerror = e => { if (signal) signal.removeEventListener('abort', onAbort); if (e.preventDefault) e.preventDefault(); rej(new Error('A BVH worker failed: ' + (e.message || ''))); };
    wk.postMessage(msg, transfer);
  });
}
async function buildBVH(geo, options, signal, info) {
  const pos = geo.attributes.position.array, idx = geo.index.array, nt = idx.length / 3;
  const levels = nt < 200000 ? 1 : Math.max(1, Math.min(3, Math.floor(Math.log2(Math.max(2, (navigator.hardwareConcurrency || 4) - 1)))));
  try {
    const t0 = performance.now();
    const pool = await getBVHPool(1 << levels);
    // the centre of each triangle
    const cen = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) for (let q = 0; q < 3; q++) cen[t * 3 + q] = (pos[idx[t * 3] * 3 + q] + pos[idx[t * 3 + 1] * 3 + q] + pos[idx[t * 3 + 2] * 3 + q]) / 3;
    // the split: each node of the top tree holds its triangles until it is halved
    const split = (ids, depth) => {
      if (depth === levels || ids.length < 2) return { ids };
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < ids.length; k++) for (let q = 0; q < 3; q++) { const v = cen[ids[k] * 3 + q]; if (v < lo[q]) lo[q] = v; if (v > hi[q]) hi[q] = v; }
      let axis = 0; for (let q = 1; q < 3; q++) if (hi[q] - lo[q] > hi[axis] - lo[axis]) axis = q;
      // the median from a histogram of the centres along the axis
      const NB = 4096, hist = new Uint32Array(NB), span = Math.max(1e-6, hi[axis] - lo[axis]);
      const bin = v => Math.min(NB - 1, Math.floor((v - lo[axis]) / span * NB));
      for (let k = 0; k < ids.length; k++) hist[bin(cen[ids[k] * 3 + axis])]++;
      let acc = 0, cut = 0; while (cut < NB - 1 && acc + hist[cut] < ids.length / 2) acc += hist[cut++];
      let nl = 0; for (let k = 0; k < ids.length; k++) if (bin(cen[ids[k] * 3 + axis]) <= cut) nl++;
      if (nl === 0 || nl === ids.length) return { ids };
      const L = new Uint32Array(nl), Rr = new Uint32Array(ids.length - nl); let a = 0, b = 0;
      for (let k = 0; k < ids.length; k++) { const t = ids[k]; if (bin(cen[t * 3 + axis]) <= cut) L[a++] = t; else Rr[b++] = t; }
      return { axis, left: split(L, depth + 1), right: split(Rr, depth + 1) };
    };
    const all = new Uint32Array(nt); for (let t = 0; t < nt; t++) all[t] = t;
    const top = split(all, 0);
    const groups = []; const collectLeaves = n => { if (n.ids) groups.push(n); else { collectLeaves(n.left); collectLeaves(n.right); } }; collectLeaves(top);
    info.bvhGroups = groups.length; info.tBvhSplit = Math.round(performance.now() - t0);
    // each group's hierarchy, built in a worker of its own over its own copy of its triangles
    const results = await Promise.all(groups.map((g, i) => {
      const P = new Float32Array(g.ids.length * 9);
      for (let k = 0; k < g.ids.length; k++) { const t = g.ids[k]; for (let c = 0; c < 3; c++) { const v = idx[t * 3 + c] * 3; P[k * 9 + c * 3] = pos[v]; P[k * 9 + c * 3 + 1] = pos[v + 1]; P[k * 9 + c * 3 + 2] = pos[v + 2]; } }
      return runWorker(pool.workers[i], { position: P, options }, [P.buffer], signal);
    }));
    // the joined hierarchy
    let bytes = 0; for (const r of results) bytes += r.root.byteLength;
    bytes += (groups.length - 1) * 32;
    const buf = new ArrayBuffer(bytes), F = new Float32Array(buf), U32 = new Uint32Array(buf), U16 = new Uint16Array(buf);
    const indirect = new Uint32Array(nt);
    let triBase = 0, gi = 0;
    // writes node n at word w and returns the word after it and its subtree, with its bounds
    const emit = (n, w) => {
      if (n.ids) {
        const r = results[gi], g = groups[gi]; gi++;
        const sub32 = new Uint32Array(r.root), sub16 = new Uint16Array(r.root), nn = sub32.length / 8;
        U32.set(sub32, w);
        for (let k = 0; k < nn; k++) {
          const o = w + k * 8;
          if (sub16[k * 16 + 15] === 0xFFFF) U32[o + 6] += triBase; else U32[o + 6] += w;
        }
        for (let k = 0; k < r.indirect.length; k++) indirect[triBase + k] = g.ids[r.indirect[k]];
        triBase += r.indirect.length;
        return { end: w + nn * 8, b: Array.from(F.subarray(w, w + 6)) };
      }
      const L = emit(n.left, w + 8), Rr = emit(n.right, L.end);
      const b = [0, 1, 2].map(q => Math.min(L.b[q], Rr.b[q])).concat([3, 4, 5].map(q => Math.max(L.b[q], Rr.b[q])));
      for (let q = 0; q < 6; q++) F[w + q] = b[q];
      U32[w + 6] = L.end; U32[w + 7] = n.axis;
      return { end: Rr.end, b };
    };
    emit(top, 0);
    info.tBvhWorkers = Math.round(performance.now() - t0);
    return MeshBVH.deserialize({ roots: [buf], index: idx, indirectBuffer: indirect }, geo, { setIndex: false, indirect: true });
  } catch (e) {
    // workers stopped half way, or that failed, are replaced by new ones next time
    dropBVHPool();
    if (e.name === 'AbortError') throw e;
    console.warn('The BVH is built on the page:', e.message);
    return new MeshBVH(geo, options);
  }
}

/* ---------- recognising the game's objects ---------- */
const isSkyMaterial = m => m && m.uniforms && m.uniforms.uTop && m.uniforms.uRot && m.side === THREE.BackSide;
const isSeaMaterial = m => m && m.uniforms && m.uniforms.uW && m.uniforms.uDeep && m.uniforms.uField;
const isFarMaterial = m => m && typeof m.onBeforeCompile === 'function' && /insideL/.test(String(m.onBeforeCompile));
// the game's blocks (and the tiles it merges distant blocks into) are drawn with these materials
const isBlockMaterial = m => m && typeof m.customProgramCacheKey === 'function' && /^(buildings|ground)(-fade)?$/.test(m.customProgramCacheKey());
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
      // the blocks are gathered for the picture apart (gatherWorld), each at the detail its distance asks for
      if (opt.skipBlocks && isBlockMaterial(m)) return;
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

/* ---------- the world for the picture ----------
   The game loads its blocks in rings round the player: full detail, simplified, then outlines, out to a radius it
   sets from the frame rate, with a coarse terrain mesh and fog beyond. The picture is given a world of its own, built
   round the camera and only where the camera looks (with every block close by, for the shadows and reflections of
   what stands behind it): out to blockReach, each block at the detail its distance asks for (lodRings), taken from
   the game where the game has built it at that detail or finer, and otherwise generated with the game's own genChunk
   for the picture alone, never joining the game's scene. The blocks are generated nearest first, a few at a time,
   letting the page carry on in between; the game's draw distance is left as it is. Beyond the blocks, out to
   horizonReach, the land is a terrain mesh made from the game's own coarse terrain (farPoint), its points spaced
   evenly in the angle they make at the camera, so that they grow coarser with distance. */
const worldGroup = V => V.sea ? V.sea.parent : V.farMesh.parent;
// the view frustum widened by k, for culling
function wideFrustum(cam, k) {
  const wide = cam.clone(); wide.fov = Math.min(170, cam.fov * k); wide.aspect = cam.aspect * k; wide.updateProjectionMatrix();
  wide.matrixWorldInverse.copy(cam.matrixWorld).invert();
  return { wide, frustum: new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(wide.projectionMatrix, wide.matrixWorldInverse)) };
}
// The blocks, filled into W as they come so that whatever was generated can be let go even if the picture is
// stopped half way: W.parts (for the scene), W.temps (meshes with the game's own materials, for the colour passes),
// W.generated (the blocks made for the picture alone, which the caller hands back with V.disposeChunk), W.built
// (the cells covered, in the true world)
async function gatherWorld(V, cam, opt, info, budget, W, report, signal) {
  const C = BLOCK, wg = worldGroup(V); wg.updateMatrixWorld(true);
  const ox = -wg.position.x, oz = -wg.position.z;   // the floating origin: true world = scene + origin
  let bMat = null, gMat = null;
  for (const ch of V.chunks.values()) if (ch.mesh && ch.ground && ch.fade >= 1 && !ch.prev) { bMat = ch.mesh.material; gMat = ch.ground.material; break; }
  if (!bMat) return false;
  const have = new Map(); for (const ch of V.chunks.values()) if (ch.geo && ch.groundGeo) have.set(ch.cx + ',' + ch.cz, ch);
  // close by the view is widened more, for the shadows and reflections of what stands just outside it
  const { frustum } = wideFrustum(cam, opt.frustumWiden), far = wideFrustum(cam, opt.frustumWidenFar).frustum, box = new THREE.Box3();
  const wx = cam.position.x + ox, wz = cam.position.z + oz, pcx = Math.floor(wx / C), pcz = Math.floor(wz / C);
  const reach = Math.min(opt.horizonReach, opt.blockReach), n = Math.ceil(reach / C) + 1, [r0, r1] = opt.lodRings;
  const cells = [];
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const cx = pcx + i, cz = pcz + j;
    // the distance from the camera to the nearest point of the block
    const d = Math.hypot(Math.max(0, Math.abs(wx - (cx + 0.5) * C) - C / 2), Math.max(0, Math.abs(wz - (cz + 0.5) * C) - C / 2));
    if (d > reach) continue;
    // the world repeats every 8.8 km from north to south (WRAP_Z in index.html); the open sea lies at the join
    if (Math.abs((cz + 0.5) * C) > 4400) continue;
    if (d > opt.nearReach) {
      box.min.set(cx * C - ox, -60, cz * C - oz); box.max.set(cx * C + C - ox, 700, cz * C + C - oz);
      if (!(d > opt.widenReach ? far : frustum).intersectsBox(box)) continue;
    }
    const ring = Math.max(Math.abs(i), Math.abs(j));
    cells.push({ cx, cz, d, want: ring <= r0 ? 0 : ring <= r1 ? 1 : 2 });
  }
  cells.sort((a, b) => a.d - b.d);
  let tris = 0, verts = 0, made = 0, reused = 0, t = performance.now();
  const tGen = [0, 0, 0], nGen = [0, 0, 0], trisByLod = [0, 0, 0];
  const t0 = performance.now();
  for (let k = 0; k < cells.length; k++) {
    // beyond the budget the blocks end, and the distant terrain begins there instead
    if (tris > budget.triangles || verts > budget.vertices) { info.blocksCut = cells.length - k; W.reach = cells[k].d; break; }
    const c = cells[k], key = c.cx + ',' + c.cz;
    let ch = have.get(key);
    // a block the game holds at the detail wanted or finer is taken as it is; so is a simplified one where full detail
    // is wanted, since the game's boats stand with it and would otherwise be there twice
    if (!(ch && (ch.lod <= c.want || (c.want === 0 && ch.lod === 1)))) {
      const tg = performance.now();
      ch = V.genChunk(c.cx, c.cz, c.want); W.generated.push(ch); made++;
      tGen[c.want] += performance.now() - tg; nGen[c.want]++;
    } else reused++;
    W.built.add(key);
    const M = new THREE.Matrix4().makeTranslation(c.cx * C - ox, 0, c.cz * C - oz);
    for (const [g, m] of [[ch.geo, bMat], [ch.groundGeo, gMat]]) {
      if (!g || !g.attributes.position || !g.attributes.position.count) continue;
      if (g === ch.groundGeo) { if (!g.boundingBox) g.computeBoundingBox(); if (g.boundingBox.max.y < -1.5) continue; }   // sea floor, unseen under the water
      W.parts.push({ o: { geometry: g, material: m, isInstancedMesh: false, position: new THREE.Vector3() }, matrix: M, instance: -1, block: true });
      const nt = (g.index ? g.index.count : g.attributes.position.count) / 3;
      tris += nt; verts += g.attributes.position.count; trisByLod[Math.min(2, ch.lod)] += nt;
      // near the camera the colour passes draw the game's own surfaces, patterns and all
      if (c.d < opt.colourReach) { const mesh = new THREE.Mesh(g, m); mesh.position.set(c.cx * C, 0, c.cz * C); mesh.frustumCulled = false; W.temps.push(mesh); }
    }
    if (performance.now() - t > 25) { report('world', (k + 1) / cells.length); await yieldPage(); checkAbort(signal); t = performance.now(); }
  }
  info.blockCells = cells.length; info.blocksReused = reused; info.blocksMade = made; info.blockTriangles = Math.round(tris); info.blockVertices = verts;
  info.genMs = tGen.map(Math.round); info.blockTrianglesByLod = trisByLod.map(Math.round); info.genCount = nGen; info.tBlocks = Math.round(performance.now() - t0);
  return true;
}

// the land beyond the blocks, out to horizonReach, from the game's coarse terrain
function distantTerrain(V, cam, opt, info, built, reach = Infinity) {
  const r0 = Math.min(opt.horizonReach, opt.blockReach, reach), R = opt.horizonReach;
  if (!V.farPoint || !V.FS || R <= r0 + 1) return null;
  const t0 = performance.now(), FS = V.FS, C = BLOCK, wg = worldGroup(V);
  const ox = -wg.position.x, oz = -wg.position.z, wx = cam.position.x + ox, wz = cam.position.z + oz;
  // the azimuths the widened view takes in on the ground, from the corners of its frustum
  const { wide } = wideFrustum(cam, 1.15), az = [], v = new THREE.Vector3();
  let full = false;
  for (const [x, y] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    v.set(x, y, 0.5).unproject(wide).sub(cam.position);
    if (Math.hypot(v.x, v.z) < 0.25 * v.length()) full = true;
    az.push(Math.atan2(v.z, v.x));
  }
  let a0 = az[0], lo = 0, hi = 0;
  for (const a of az) { const d = Math.atan2(Math.sin(a - a0), Math.cos(a - a0)); lo = Math.min(lo, d); hi = Math.max(hi, d); }
  lo -= 0.04; hi += 0.04;
  if (full || hi - lo > 2 * Math.PI - 0.2) { a0 = 0; lo = -Math.PI; hi = Math.PI; full = true; }
  const da = opt.terrainStep, na = Math.ceil((hi - lo) / da) + 1, radii = [];
  for (let r = r0 * 0.96; r < R; r *= 1 + da) radii.push(r);
  radii.push(R);
  const nr = radii.length, nv = nr * na;
  const P = new Float32Array(nv * 3), Cc = new Float32Array(nv * 3), Hs = new Float32Array(nv);
  const pts = new Map();
  const fp = (gi, gj) => { const k = gi * 1e6 + gj; let F = pts.get(k); if (!F) { F = V.farPoint(gi, gj); pts.set(k, F); } return F; };
  const inBuilt = (x, z) => built.has(Math.floor(x / C) + ',' + Math.floor(z / C));
  for (let a = 0; a < nr; a++) for (let b = 0; b < na; b++) {
    const r = radii[a], th = a0 + lo + (hi - lo) * b / (na - 1), x = wx + Math.cos(th) * r, z = wz + Math.sin(th) * r, q = a * na + b;
    let h, cr, cg, cb;
    if (Math.abs(z) > 4400) { h = -50; cr = cg = cb = 0; }   // beyond the join of the repeating world, the open sea
    else {
      // the grid of 22 m points, read bilinearly
      const fx = x / FS, fz = z / FS, i0 = Math.floor(fx), j0 = Math.floor(fz), tx = fx - i0, tz = fz - j0;
      const A = fp(i0, j0), B = fp(i0 + 1, j0), D = fp(i0, j0 + 1), E = fp(i0 + 1, j0 + 1);
      const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;
      h = A.h * w00 + B.h * w10 + D.h * w01 + E.h * w11;
      cr = A.r * w00 + B.r * w10 + D.r * w01 + E.r * w11; cg = A.g * w00 + B.g * w10 + D.g * w01 + E.g * w11; cb = A.b * w00 + B.b * w10 + D.b * w01 + E.b * w11;
    }
    let y = h - 0.35;
    // under the blocks the terrain is lowered out of their way, as the game's own coarse terrain is
    if (inBuilt(x - 2, z - 2) && inBuilt(x + 2, z - 2) && inBuilt(x - 2, z + 2) && inBuilt(x + 2, z + 2)) y -= 60;
    P[q * 3] = x - ox; P[q * 3 + 1] = y; P[q * 3 + 2] = z - oz; Hs[q] = h;
    Cc[q * 3] = cr; Cc[q * 3 + 1] = cg; Cc[q * 3 + 2] = cb;
  }
  const I = [];
  for (let a = 0; a + 1 < nr; a++) for (let b = 0; b + 1 < na; b++) {
    const b1 = b + 1, p0 = a * na + b, p1 = a * na + b1, q0 = p0 + na, q1 = p1 + na;
    // the sea floor is left out: the sea is opaque in the picture
    if (Hs[p0] < -1.5 && Hs[p1] < -1.5 && Hs[q0] < -1.5 && Hs[q1] < -1.5) continue;
    I.push(p0, q0, p1, p1, q0, q1);
  }
  if (!I.length) return null;
  // the triangles are wound to face up (the path tracer takes the side a ray strikes from the winding), whichever way
  // round the angles happen to run
  let up = 0;
  for (let k = 0; k < I.length; k += 3) { const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    up += (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]); }
  if (up < 0) for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1));
  geo.computeVertexNormals();
  info.terrainTriangles = I.length / 3; info.terrainVertices = nv; info.terrainPoints = pts.size; info.tTerrain = Math.round(performance.now() - t0);
  return { o: { geometry: geo, material: V.farMesh.material, isInstancedMesh: false, position: new THREE.Vector3() }, matrix: new THREE.Matrix4(), instance: -1, generated: true };
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

/* ---------- the albedo of the game's own materials under a flat white light ----------
   The game's scene is set up once (only what the picture holds left visible, no fog, no background, and with albedo
   its lights replaced by a flat white light), draw() is called to draw it as many times as it likes, and the scene is
   put back as it was. */
function withGameScene(scene, col, albedo, draw) {
  const saved = [];
  const set = (o, k, v) => { saved.push([o, k, o[k]]); o[k] = v; };
  try {
    if (albedo) scene.traverse(o => {
      if (o.isLight) {
        if (o.isHemisphereLight) { saved.push([o.color, 'copy', o.color.clone()], [o.groundColor, 'copy', o.groundColor.clone()]); o.color.setRGB(1, 1, 1); o.groundColor.setRGB(1, 1, 1); set(o, 'intensity', Math.PI); }
        else set(o, 'intensity', 0);
      }
    });
    for (const o of col.renderables) if (!col.included.has(o)) set(o, 'visible', false);
    if (scene.fog) { set(scene.fog, 'near', 1e9); set(scene.fog, 'far', 2e9); }
    set(scene, 'background', null);
    draw();
  } finally {
    for (let i = saved.length - 1; i >= 0; i--) { const [o, k, v] = saved[i]; if (k === 'copy') o.copy(v); else o[k] = v; }
  }
}
function drawGame(scene, cam, out) {
  const { R } = ctx;
  R.setClearColor(0xffffff, 1);
  R.setRenderTarget(out); R.clear(); R.render(scene, cam); R.setRenderTarget(null);
}
// the meshes made for the colour passes join the game's world while they are drawn, and leave it straight after
function withTemps(V, temps, col, fn) {
  const wg = temps.length ? worldGroup(V) : null;
  for (const m of temps) { wg.add(m); col.included.add(m); }
  try { fn(); } finally { for (const m of temps) wg.remove(m); }
}

/* ---------- the scene kept between pictures ----------
   The scene built for a picture (its geometry, its BVH, its materials and its colour passes) is kept, so that the same
   view drawn again with other settings (samples, bounces, the haze, the filter) goes straight to the tracing. It is let
   go when a picture of another view is made, or with releasePathTrace(). */
let kept = null;
function dropKept() {
  if (!kept) return;
  kept.bvh.geometry = null; kept.geo.dispose(); kept.rasterMats.forEach(x => x.dispose()); kept.materials.forEach(x => x.dispose());
  kept = null; if (ctx) ctx.uploaded = null;
}
export function releasePathTrace() { dropKept(); }
// what the scene depends on: the camera in the true world (not the floating origin), the size and the settings that
// change the geometry
function sceneKey(cam, wg, w, h, opt) {
  const o = wg ? wg.position : { x: 0, y: 0, z: 0 }, e = cam.matrixWorld.elements;
  const m = e.map((x, i) => i === 12 ? (x - o.x).toFixed(2) : i === 13 ? (x - o.y).toFixed(2) : i === 14 ? (x - o.z).toFixed(2) : x.toFixed(4));
  return [m.join(','), cam.projectionMatrix.elements.map(x => x.toFixed(5)).join(','), w, h, opt.extend, opt.horizonReach, opt.blockReach, opt.lodRings.join('/'), opt.materials,
    opt.ripple, opt.rippleSize, opt.jitter, opt.textureSize, opt.nearReach, opt.farReach, opt.frustumWiden, opt.frustumWidenFar, opt.widenReach, opt.terrainStep, opt.colourReach, opt.maxTriangles, opt.maxVertices].join('|');
}
// the sky, the sun and the hemisphere light of the live scene
function lightsOf(scene) {
  let sky = null, sun = null, hemi = null;
  scene.traverseVisible(o => {
    if (o.isDirectionalLight && (!sun || o.castShadow)) sun = o;
    if (o.isHemisphereLight) hemi = o;
    if (o.isMesh && !Array.isArray(o.material) && isSkyMaterial(o.material)) sky = o;
  });
  return { sky, sun, hemi };
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
  const info = { width: w, height: h, samples, bounces: opt.bounces };
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

  const V = window.__village;
  const extend = !!(opt.extend && V && V.genChunk && V.chunks && (V.sea || V.farMesh));
  if (extend) { opt.farReach = Math.max(opt.farReach, opt.horizonReach); opt.farTerrain = false; opt.skipBlocks = true; }
  if (opt.blockReach == null) opt.blockReach = opt.horizonReach <= 5000 ? 1600 : Math.round(opt.horizonReach * 0.42);
  info.blockReach = Math.min(opt.blockReach, opt.horizonReach);
  camPT.far = Math.max(camPT.far, opt.horizonReach * 5); camPT.updateProjectionMatrix();
  const NJ = Math.max(1, opt.jitter);
  const key = sceneKey(cam, extend ? worldGroup(V) : null, w, h, opt);
  let S = kept && kept.key === key ? kept : null;
  info.sceneKept = !!S;
  // the colour passes' sums and the filter's guide, drawn once for each scene
  const accPt = target('accPt', w, h, THREE.FloatType), accGame = target('accGame', w, h, THREE.FloatType);
  const tG = target('guide', w, h, THREE.FloatType, true), tLit = target('lit', w, h, THREE.FloatType, true);
  const wantLit = opt.autoExposure && opt.exposure == null;

  if (!S) {
    // the scene kept for another view is let go before this one is built
    dropKept();
    const W = { parts: [], temps: [], generated: [], built: new Set(), reach: Infinity };
    let geo, materials, seaIndex, rasterMats, col;
    try {
      if (extend) { report('world', 0); await yieldPage(); await gatherWorld(V, cam, opt, info, { triangles: opt.maxTriangles * 0.85, vertices: opt.maxVertices * 0.7 }, W, report, signal); mark('tWorld'); }
      checkAbort(signal);

      // everything taken from the live scene is taken now, in one go, before the game moves on
      report('scene', 0); await yieldPage();
      scene.updateMatrixWorld(true);
      col = collect(scene, cam, opt, info);
      let terrain = null;
      if (extend) { col.parts.push(...W.parts); terrain = distantTerrain(V, cam, opt, info, W.built, W.reach); if (terrain) col.parts.push(terrain); }
      const seaGeo = col.sea ? buildSea(col.sea, opt.horizonReach * 4) : null;
      mark('tCollect');
      ({ geo, materials, seaIndex } = buildGeometry(col, seaGeo, origin, info, opt));
      if (terrain) terrain.o.geometry.dispose();
      mark('tGeometry');

      // the two colour passes, with the same sub-pixel offsets
      report('albedo', 0); await yieldPage();
      const rasterScene = new THREE.Scene();
      // the sea, glass and metal keep the path tracer's colour: they are written as uncovered in the colour passes
      rasterMats = materials.map((m, i) => albedoMaterial(m, i === seaIndex || isDirectClass(m.userData.cls)));
      const rasterMesh = new THREE.Mesh(geo, rasterMats); rasterMesh.frustumCulled = false; rasterScene.add(rasterMesh);
      const tA = target('a', w, h, THREE.HalfFloatType, true), tB = target('b', w, h, THREE.HalfFloatType, true);
      R.setClearColor(0x000000, 0);
      for (const t of [accPt, accGame]) { R.setRenderTarget(t); R.clear(); }
      R.setRenderTarget(null);
      const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
      withTemps(V, W.temps, col, () => {
        withGameScene(scene, col, true, () => {
          for (let j = 0; j < NJ; j++) {
            const jx = NJ > 1 ? halton(j + 1, 2) - 0.5 : 0, jy = NJ > 1 ? halton(j + 1, 3) - 0.5 : 0;
            cam.setViewOffset(w, h, jx, jy, w, h); camPT.setViewOffset(w, h, jx, jy, w, h);
            R.setClearColor(0xffffff, 0); R.setRenderTarget(tA); R.clear(); R.render(rasterScene, camPT);
            drawGame(scene, cam, tB);
            accumulateMat.uniforms.tA.value = tA.texture; accumulateMat.uniforms.tB.value = tB.texture;
            accumulateMat.uniforms.uWhich.value = 0; R.autoClear = false; runPass(accumulateMat, accPt);
            accumulateMat.uniforms.uWhich.value = 1; runPass(accumulateMat, accGame); R.autoClear = true;
          }
        });
        cam.clearViewOffset(); camPT.clearViewOffset();
        // the guide for the filter: normals and depth at the centre of each pixel
        rasterScene.overrideMaterial = guideMaterial();
        R.setClearColor(0x000000, 0); R.setRenderTarget(tG); R.clear(); R.render(rasterScene, camPT); R.setRenderTarget(null);
        rasterScene.overrideMaterial.dispose(); rasterScene.overrideMaterial = null;
        // the game's own lighting of the same surfaces, for matching the brightness later
        if (wantLit) withGameScene(scene, col, false, () => drawGame(scene, cam, tLit));
      });
      await gpuIdle(R);
      mark('tAlbedo');
    } catch (e) {
      if (geo) geo.dispose(); if (materials) materials.forEach(x => x.dispose()); if (rasterMats) rasterMats.forEach(x => x.dispose());
      throw e;
    } finally {
      // the blocks made for the picture alone are let go (the game's boats and clock faces with them)
      for (const ch of W.generated) try { if (V.disposeChunk) V.disposeChunk(ch); else { ch.geo.dispose(); ch.groundGeo.dispose(); } } catch (e) { /* already gone */ }
    }
    checkAbort(signal);

    // the bounding volume hierarchy over every triangle
    report('bvh', 0);
    await yieldPage();
    try {
      const bvh = await buildBVH(geo, { strategy: opt.bvhStrategy ?? SAH, maxLeafTris: opt.bvhLeaf ?? 1, indirect: true }, signal, info);
      S = { key, geo, materials, seaIndex, rasterMats, bvh, temps: W.temps, included: col.included };
    } catch (e) { geo.dispose(); materials.forEach(x => x.dispose()); rasterMats.forEach(x => x.dispose()); throw e; }
    kept = S;
    mark('tBVH');
    checkAbort(signal);
  } else if (wantLit) {
    // the same view again: only the game's own lighting is drawn anew, since the time of day may have moved on
    report('albedo', 0);
    scene.updateMatrixWorld(true);
    const renderables = [];
    scene.traverseVisible(o => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) renderables.push(o); });
    const col = { renderables, included: new Set(S.included) };
    withTemps(V, extend ? S.temps : [], col, () => withGameScene(scene, col, false, () => drawGame(scene, cam, tLit)));
    mark('tAlbedo');
  }
  const { geo, materials, seaIndex, bvh } = S;

  // the light: the sun and the sky, as the game has them now
  const L = lightsOf(scene);
  const sunDir = new THREE.Vector3(0, 1, 0), sunRad = new THREE.Color(0, 0, 0);
  if (L.sun) {
    L.sun.updateMatrixWorld(); L.sun.target.updateMatrixWorld();
    sunDir.setFromMatrixPosition(L.sun.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(L.sun.target.matrixWorld)).normalize();
    sunRad.copy(L.sun.color).multiplyScalar(L.sun.intensity);
    info.sun = { dir: sunDir.toArray().map(x => +x.toFixed(3)), intensity: +L.sun.intensity.toFixed(3) };
  }
  const hemiInfo = L.hemi ? { color: L.hemi.color.clone(), intensity: L.hemi.intensity } : null;
  const fallbackSky = { uTop: { value: new THREE.Color(0.1, 0.25, 0.6) }, uMid: { value: new THREE.Color(0.2, 0.4, 0.7) }, uHor: { value: new THREE.Color(0.5, 0.6, 0.7) }, uSun: { value: sunDir }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uDay: { value: 1 } };
  const SU = L.sky ? L.sky.material.uniforms : fallbackSky;
  const exposure = opt.exposure ?? (renderer ? renderer.toneMappingExposure : 1);
  const fogNear = scene.fog ? scene.fog.near : 90, fogFar = scene.fog ? scene.fog.far : 1500;
  const horCol = SU.uHor.value.clone(), midCol = SU.uMid.value.clone();
  const sky = buildSky(SU, sunDir, sunRad, { ...opt, hemi: hemiInfo });
  info.skyGain = sky.gains.map(x => +x.toFixed(3));
  mark('tSky');

  // hand everything to the path tracer; the scene's own buffers only when they are not there already
  const m = pt.material;
  m.bounces = opt.bounces; m.transmissiveBounces = 2; m.filterGlossyFactor = 0.5;
  // the stratified sample lists repeat the same numbers in every sample here, so plain PCG random numbers are used
  m.setDefine('RANDOM_TYPE', opt.randomType ?? 0);
  m.uniforms.uSampleClamp.value = opt.sampleClamp;
  m.uniforms.uSpecSky.value.set(1 / sky.gains[0], 1 / sky.gains[1], 1 / sky.gains[2]);
  if (ctx.uploaded !== S) {
    m.bvh.updateFrom(bvh);
    m.attributesArray.updateFrom(geo.attributes.normal, geo.attributes.tangent, geo.attributes.uv, geo.attributes.color);
    m.materialIndexAttribute.updateFrom(geo.attributes.materialIndex);
    const textures = [...new Set(materials.flatMap(x => [x.map, x.normalMap]).filter(Boolean))];
    m.textures.setTextures(R, textures, opt.textureSize, opt.textureSize);
    m.materials.updateFrom(materials, textures);
    ctx.uploaded = S;
  }
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
  // until half the samples are in, the half-way buffer is black, which the filter reads as a great deal of noise and
  // smooths the early frames strongly
  R.setClearColor(0x000000, 0); R.setRenderTarget(tH); R.clear(); R.setRenderTarget(null);
  demodMat.uniforms.uTexel.value.set(1 / w, 1 / h); demodMat.uniforms.tP.value = tP.texture; demodMat.uniforms.tH.value = tH.texture; demodMat.uniforms.tApt.value = accPt.texture; demodMat.uniforms.uN.value = NJ;
  const tE0 = target('e0', w, h), tE1 = target('e1', w, h);
  atrousMat.uniforms.tG.value = tG.texture; atrousMat.uniforms.uTexel.value.set(1 / w, 1 / h);
  atrousMat.uniforms.uTanY.value = tanY; atrousMat.uniforms.uAspect.value = w / h;
  // the light on each surface, filtered with the given number of a-trous steps; returns the target holding it
  const filtered = iters => {
    runPass(demodMat, tE0);
    let src = tE0, dst = tE1;
    for (let k = 0; k < iters; k++) { atrousMat.uniforms.tC.value = src.texture; atrousMat.uniforms.uStep.value = 1 << k; runPass(atrousMat, dst); [src, dst] = [dst, src]; }
    return src;
  };
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
  // It is measured from the unfiltered light after 8 samples and kept to the end, so that the picture shown while it
  // clears and the final picture have the same exposure; the frames shown before then take a first measure from the
  // filtered light of the first sample. The game's lighting and the guide do not change while the samples are taken,
  // so they are read back once
  let fixed = null;
  const measureGain = (src) => {
    if (!wantLit) return;
    cu.tE.value = src.texture;
    const tL = target('lin', w, h);
    cu.uSceneGain.value = 1; cu.uFog.value = 0; cu.uHaze.value = 0; runPass(composeMat, tL); cu.uFog.value = opt.fog && !opt.haze && scene.fog ? 1 : 0; cu.uHaze.value = opt.haze ? 1 : 0;
    const a = new Float32Array(w * h * 4);
    R.readRenderTargetPixels(tL, 0, 0, w, h, a);
    if (!fixed) {
      const b = new Float32Array(w * h * 4), gd = new Float32Array(w * h * 4), cv = new Float32Array(w * h * 4);
      R.readRenderTargetPixels(tLit, 0, 0, w, h, b); R.readRenderTargetPixels(tG, 0, 0, w, h, gd); R.readRenderTargetPixels(accPt, 0, 0, w, h, cv);
      const idx = [], lb = [];
      for (let i = 0; i < w * h; i += 3) {
        const k = i * 4, z = gd[k + 3];
        if (!(z > 0 && z < 400) || cv[k + 3] < NJ - 0.01) continue;
        idx.push(k); lb.push(Math.log(0.2126 * b[k] + 0.7152 * b[k + 1] + 0.0722 * b[k + 2] + 1e-3));
      }
      let sb = 0; for (const x of lb) sb += x;
      fixed = { idx, sb };
    }
    let sa = 0; const n = fixed.idx.length;
    for (const k of fixed.idx) sa += Math.log(0.2126 * a[k] + 0.7152 * a[k + 1] + 0.0722 * a[k + 2] + 1e-3);
    if (n > 1000) {
      const k = Math.exp((fixed.sb - sa) / n);
      info.exposureMatch = +k.toFixed(3);
      cu.uSceneGain.value = Math.min(opt.autoExposureMax, Math.max(0.85, Math.pow(k, opt.autoExposure)));
      info.sceneGain = +cu.uSceneGain.value.toFixed(3);
    }
  };
  // the picture as it stands, filtered lightly, drawn into one canvas that is handed to onFrame each time
  let frameCanvas = null, lastFrame = 0, frameCost = 0;
  const showFrame = (progress) => {
    const tf = performance.now();
    const src = filtered(opt.previewFilter);
    cu.tE.value = src.texture;
    R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = exposure;
    runPass(composeMat, null); R.toneMapping = THREE.NoToneMapping;
    if (!frameCanvas) { frameCanvas = document.createElement('canvas'); frameCanvas.width = w; frameCanvas.height = h; }
    frameCanvas.getContext('2d').drawImage(ctx.canvas, 0, 0);
    if (info.tFirstFrame == null) mark('tFirstFrame');
    try { opt.onFrame(frameCanvas, progress); } catch (e) { /* the caller's own error */ }
    lastFrame = performance.now(); frameCost = lastFrame - tf;
  };

  // the samples, a tile at a time; one sample is left to run on the GPU while the next is queued behind it
  report('trace', 0);
  const gl = R.getContext();
  const waitFence = async f => { for (;;) { const st = gl.clientWaitSync(f, 0, 0); if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED || st === gl.WAIT_FAILED) break; await new Promise(r => setTimeout(r, 1)); } gl.deleteSync(f); };
  const half = Math.max(1, Math.floor(samples / 2)), gainAt = Math.min(8, samples);
  let tTrace = 0, halfDone = false, gainDone = false, early = false, fence = null;
  try {
    while (pt.samples < samples) {
      checkAbort(signal);
      const s0 = pt.samples;
      pt.update();
      if (pt.isCompiling) { await new Promise(r => setTimeout(r, 30)); continue; }
      if (tTrace === 0) { await gpuIdle(R); mark('tCompile'); tTrace = performance.now(); }
      if (Math.floor(pt.samples) !== Math.floor(s0)) {
        if (!halfDone && pt.samples >= half) { copyMat.uniforms.t.value = pt.target.texture; runPass(copyMat, tH); halfDone = true; }
        if (!gainDone && pt.samples >= gainAt) { measureGain(filtered(0)); gainDone = true; }
        else if (!gainDone && !early && opt.onFrame) { measureGain(filtered(opt.previewFilter)); early = true; info.earlyGain = info.sceneGain; }
        if (opt.onFrame && pt.samples < samples && (lastFrame === 0 || performance.now() - lastFrame >= Math.max(opt.frameInterval, frameCost * 10))) showFrame(pt.samples / samples);
        const f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
        if (fence) await waitFence(fence);
        fence = f;
        report('trace', pt.samples / samples);
      }
    }
  } finally { if (fence) gl.deleteSync(fence); }
  if (!gainDone) measureGain(filtered(0));
  await gpuIdle(R);
  info.traceMs = Math.round(performance.now() - tTrace);
  info.samplesPerSecond = +(samples / (info.traceMs / 1000)).toFixed(2);
  mark('tTrace');

  // the light on each surface, filtered, then the picture
  report('denoise', 0);
  const src = filtered(opt.denoise);
  cu.tE.value = src.texture;
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = exposure;
  runPass(composeMat, null);
  const out = snapshot(w, h);

  // the intermediate buffers, drawn for inspection when asked for
  if (opt.debug) {
    const show = (tex, mode, scale = 1, div = 1) => { viewMat.uniforms.t.value = tex; viewMat.uniforms.uMode.value.set(...mode); viewMat.uniforms.uScale.value = scale; viewMat.uniforms.uDiv.value = div; runPass(viewMat, null); return snapshot(w, h); };
    opt.debug.raw = show(tP.texture, [1, 0, 0, 0]);
    opt.debug.light = show(src.texture, [1, 0, 0, 0], 0.5);
    opt.debug.lightNoisy = show(filtered(0).texture, [1, 0, 0, 0], 0.5);
    R.toneMapping = THREE.NoToneMapping;
    opt.debug.albedoPt = show(accPt.texture, [1, 0, 0, 0], 1, NJ);
    opt.debug.albedoGame = show(accGame.texture, [1, 0, 0, 0], 1, NJ);
    opt.debug.normal = show(tG.texture, [0, 1, 0, 0]);
    opt.debug.depth = show(tG.texture, [0, 0, 1, 0], 300);
  }
  R.toneMapping = THREE.NoToneMapping;
  mark('tTotal');
  info.exposure = exposure;

  // the sky is made for each picture; the scene is kept for the next picture of the same view
  sky.envTex.dispose(); sky.bgTex.dispose();
  out.info = info;
  report('done', 1);
  if (opt.onFrame) try { opt.onFrame(out, 1); } catch (e) { /* the caller's own error */ }
  return out;
}

// the inner steps, for the test bench
export const _internals = { buildSea, buildSky, collect, buildGeometry, albedoMaterial, guideMaterial, gatherWorld, distantTerrain };
