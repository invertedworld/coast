/* A path-traced picture of the village, seen from the game's camera.

   pathTrace({renderer, scene, camera, samples, width, height, onProgress, onFrame, signal, ...settings})
     -> Promise<HTMLCanvasElement>

   renderer is optional and is only read (its canvas size and exposure); everything is drawn with a renderer of this
   module's own, on a canvas of its own, so that the state of the game's renderer is never touched. The renderer and
   the compiled path tracer are kept between calls. The settings and their defaults are listed in DEFAULTS below.
   onProgress({phase, fraction, info}) reports the phases 'world', 'scene', 'albedo', 'bvh', 'trace', 'denoise', 'done'.
   signal is an AbortSignal; aborting rejects the promise with an AbortError.

   onFrame(canvas, progress) shows the picture while it is made. It is first called with progress 0 once the colour
   passes are drawn, before the BVH is finished, with every surface lit as the far field is (see below). While the
   samples accumulate it is then called after the first sample and then at most once every frameInterval milliseconds (120 by default, longer if drawing the frames
   would take more than a tenth of the time), after a whole sample has been added, with progress the share of the
   samples taken, or of the time allowed, so far (above 0 and below 1). The canvas is a 2D canvas of the final size holding the picture as it
   stands: the light filtered lightly (previewFilter), times the game's surface colour, with haze, exposure and tone
   mapping as in the final picture, so that it is recognisable from the first sample and sharpens as the samples add
   up. The same canvas object is passed each time and is drawn over before the next call, so a caller that keeps a
   frame copies it. Last, after the filter, onFrame is called once with progress exactly 1 and the very canvas the
   promise resolves with.

   Time. The picture is given timeBudget seconds (30 by default) from startTime, which the caller sets to the moment
   it was asked for. The samples are taken until another would not be finished, filtered and shown within that time,
   or until samples have been taken, but never fewer than minSamples, so that a slower computer makes a picture of
   fewer samples in the same time rather than taking longer; the filter is the more important the fewer they are.
   While the samples are taken, the GPU is given the path tracer's work one tile at a time (see the loop at the end
   of pathTrace), so that the page and the system stay responsive.

   The near field and the far field. Only the near field, out to ptReach (500 m by default), is path-traced. Beyond
   it the world is drawn by raster passes alone, and lit by a model of the light: the sun's, as far as two shadow
   maps drawn from the sun say it is seen, and the irradiance of the sky and the ground on a surface facing each way.
   The two terms are fitted, by least squares, to the path-traced light of the surfaces at the edge of the near
   field, so that the two fields agree in brightness and colour, and the far field is blended in over the last 30 %
   of the near field's reach. The path tracer itself holds only the near field, with the distant terrain carried on
   as a stand-in for the far field's blocks in its reflections and shadows, so that its BVH stays small and its rays
   short; the pixels of the far field are not traced at all, those of open sky at one pass in eight, and the far
   field's sea, glass and metal at one pass in three with two bounces. The near field ends sooner should the path
   tracer's budget of triangles or vertices be spent before ptReach.

   The world. The picture is given a world of its own, built round the camera and only where it looks (gatherWorld):
   each block at the detail its distance asks for, taken from the game where the game holds it and otherwise generated
   with the game's genChunk for the picture alone, a few at a time between frames, out to blockReach; the blocks
   within the near field join the path tracer's scene, those beyond it only the raster passes'. Beyond the blocks, out
   to horizonReach, the land is a terrain mesh made from the game's coarse terrain. The game's draw distance is not
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
   agree. The sky, the sea, glass and metal are taken from the path tracer directly. In the far field the light is
   the model's in place of the path tracer's. Aerial perspective is added from
   the depth (extinction by a haze that thins with height, and in-scattered light of the sky's horizon colour), and
   the picture is tone mapped with ACES Filmic at the game's exposure. */

import * as THREE from 'three';
import { PathTracingRenderer, MeshBVH, SAH, FullScreenQuad } from './vendor/pathtracer.module.js';

/* ---------- settings ---------- */
const DEFAULTS = {
  samples: 512,            // the most samples per pixel
  timeBudget: 30,          // seconds: the picture is finished when this time is up, counted from startTime (or from the
                           // call), with as many samples as fitted in; 0 or null takes the samples alone
  startTime: null,         // performance.now() at which the time budget began; null takes the time of the call
  minSamples: 4,           // the fewest samples a picture is given, should the time be up sooner
  ptReach: 500,            // metres: the near field, which is path-traced; beyond it the raster passes draw the world and
                           // light it (the far field), blended into the near field over the last 30 % of this distance.
                           // 0 or null path-traces everything
  maxRasterTriangles: null,  // the most triangles of the far field's blocks; null takes 6 million, or less likewise
  shadowSize: 2048,        // the size of each of the far field's two shadow maps
  farField: 400,           // metres: where the whole picture is path-traced (ptReach 0), a surface beyond this is far;
                           // otherwise a surface beyond 70 % of the near field is. A far surface is sampled at one pass
                           // in farEvery, with at most farBounces bounces (the camera ray counts as the first)
  farEvery: 3,
  farBounces: 2,
  skyEvery: 8,             // the open sky is sampled at one pass in this many
  bounces: 3,              // diffuse and glossy bounces after the camera ray
  extend: true,            // build the world for the picture beyond the game's draw distance, in the view
  lodRings: [2, 12],       // blocks from the camera: full detail out to the first ring, simplified to the second, outlines beyond
  blockReach: null,        // metres: blocks with their buildings are built out to here (or to horizonReach, if nearer);
                           // null takes 1600 m for a horizonReach up to 5 km and 42 % of it beyond, so that the longest
                           // draw distances keep the distant islands' cliffs and villages as blocks
  horizonReach: 5000,      // metres: beyond the blocks, the land is drawn as terrain alone out to here
  terrainStep: 0.005,      // radians: the angular spacing of the distant terrain's points, as seen from the camera
  colourReach: 520,        // metres: within this the game's own surface colours are drawn for blocks built for the picture
  maxTriangles: null,      // the most triangles the path-traced scene may hold; the farthest blocks are left out beyond it.
                           // null takes 4.5 million, or less on a machine that reports under 8 GB of memory
  maxVertices: null,       // the most vertices: the path tracer keeps four float4 textures of this length on the GPU;
                           // null takes 6 million, or less likewise
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
  tiles: null,             // path tracer tiles per side to begin with; null chooses from the size. The number is then
                           // adjusted between samples so that each tile keeps the GPU busy for about tileMs
  inFlight: 1,             // tiles sent to the GPU before the oldest is waited for
  tileMs: 30,              // milliseconds of GPU time aimed at for one tile; a tile is drawn in one go, and many small
                           // tiles cost far more than a few large ones
  gpuShare: 0.85,          // the share of the GPU's time the tracing may take, so that the page and the rest of
                           // the system keep enough of the GPU to stay responsive
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
    // the rate of sampling by distance: a pixel whose surface lies beyond uFarDist (the distance along the ray, from the
    // guide's depth, the least of the pixel and four neighbours) is traced at one pass in uFarEvery, and with at most
    // uFarBounces bounces; a pixel
    // of open sky at one pass in uSkyEvery. Every pixel is traced at the first pass. The passes a pixel takes are
    // spread by blocks of 8 by 8 pixels, so that each pass costs about the same and the GPU's threads stay together,
    // and the pixel's own weight in the running mean is used in place of the pass's, so that the mean is exact
    m.uniforms.uGuide = { value: null };
    m.uniforms.uRateOn = { value: 0 };
    m.uniforms.uFarDist = { value: 1e9 };
    m.uniforms.uFarEvery = { value: 1 };
    m.uniforms.uSkyEvery = { value: 1 };
    m.uniforms.uFarBounces = { value: 8 };
    // the far field, which the raster passes light: a pixel with a surface at its centre and in its colour pass (uCover,
    // the colour pass's coverage summed over uCoverN offsets), whose surface lies beyond uSkipDist, is not traced at all
    m.uniforms.uCover = { value: null };
    m.uniforms.uCoverN = { value: 1 };
    m.uniforms.uView = { value: new THREE.Vector2(1, 1) };
    m.uniforms.uSkipDist = { value: 1e9 };
    m.fragmentShader = m.fragmentShader
      .replace('void main() {', 'uniform float uSampleClamp;\nuniform vec3 uSpecSky;\nuniform sampler2D uGuide, uCover;\nuniform float uRateOn, uFarDist, uFarEvery, uSkyEvery, uCoverN, uSkipDist;\nuniform vec2 uView;\nuniform int uFarBounces;\nvoid main() {')
      .replace('Ray ray = getCameraRay();', `Ray ray = getCameraRay();
          float pxOpacity = opacity; bool pxFar = false;
          if ( uRateOn > 0.5 ) {
            ivec2 gp = ivec2( gl_FragCoord.xy ), gs = textureSize( uGuide, 0 ) - 1;
            // the distance along the ray for a unit of view depth
            float rayK = length( vec3( ( gl_FragCoord.xy / vec2( gs + 1 ) * 2.0 - 1.0 ) * uView, 1.0 ) );
            float dmin = 1e9;
            for ( int q = 0; q < 5; q ++ ) {
              ivec2 o = q == 1 ? ivec2( 2, 0 ) : q == 2 ? ivec2( - 2, 0 ) : q == 3 ? ivec2( 0, 2 ) : q == 4 ? ivec2( 0, - 2 ) : ivec2( 0 );
              float z = texelFetch( uGuide, clamp( gp + o, ivec2( 0 ), gs ), 0 ).w;
              if ( z > 0.0 && z < 1e5 ) dmin = min( dmin, z * rayK );
            }
            float zc = texelFetch( uGuide, gp, 0 ).w;
            if ( dmin > uSkipDist && dmin < 1e8 && zc > 0.0 && zc < 1e5 && texelFetch( uCover, gp, 0 ).a > 0.02 * uCoverN ) discard;
            pxFar = dmin > uFarDist;
            float every = dmin > 1e8 ? uSkyEvery : pxFar ? uFarEvery : 1.0;
            if ( every > 1.5 ) {
              float k = floor( 1.0 / opacity - 0.5 );
              vec2 bk = floor( gl_FragCoord.xy / 8.0 );
              float off = floor( fract( sin( dot( bk, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * every );
              if ( k > 0.5 && mod( k + off, every ) > 0.5 ) discard;
              pxOpacity = 1.0 / ( 1.0 + floor( ( k + off ) / every ) );
            }
          }`)
      .replace('for ( int i = 0; i < bounces; i ++ ) {', 'for ( int i = 0; i < bounces; i ++ ) {\n\t\t\t\t\t\tif ( pxFar && i >= uFarBounces ) break;')
      .replace('gl_FragColor.rgb += environmentIntensity * envColor * state.throughputColor * misWeight;',
        'gl_FragColor.rgb += environmentIntensity * envColor * state.throughputColor * misWeight * ( state.isShadowRay ? vec3( 1.0 ) : uSpecSky );')
      .replace('gl_FragColor.a *= opacity;', '{ if ( any( isnan( gl_FragColor.rgb ) ) || any( isinf( gl_FragColor.rgb ) ) ) gl_FragColor.rgb = vec3( 0.0 ); float mx = max( max( gl_FragColor.r, gl_FragColor.g ), gl_FragColor.b ); if ( mx > uSampleClamp ) gl_FragColor.rgb *= uSampleClamp / mx; }\n\t\t\t\t\tgl_FragColor.a *= pxOpacity;');
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

// a single-channel float target with a depth buffer, for a shadow map
function shadowTarget(name, size) {
  let t = ctx.targets.get(name);
  if (!t) {
    t = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false });
    ctx.targets.set(name, t);
  }
  if (t.width !== size) t.setSize(size, size);
  return t;
}

// gives the page a turn between slices of work, by a message to itself: a message is not slowed as a chain of zero
// timeouts is, and, unlike scheduler.yield, it does not go ahead of the browser's drawing of the page
const yieldChannel = new MessageChannel(), yieldQueue = [];
yieldChannel.port1.onmessage = () => { const r = yieldQueue.shift(); if (r) r(); };
const yieldPage = () => new Promise(r => { yieldQueue.push(r); yieldChannel.port2.postMessage(0); });
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
  const levels = nt < 200000 ? 1 : Math.max(1, Math.min(2, Math.floor(Math.log2(Math.max(2, (navigator.hardwareConcurrency || 4) - 1)))));
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
    await yieldPage(); checkAbort(signal);
    const all = new Uint32Array(nt); for (let t = 0; t < nt; t++) all[t] = t;
    const top = split(all, 0);
    await yieldPage(); checkAbort(signal);
    const groups = []; const collectLeaves = n => { if (n.ids) groups.push(n); else { collectLeaves(n.left); collectLeaves(n.right); } }; collectLeaves(top);
    info.bvhGroups = groups.length; info.tBvhSplit = Math.round(performance.now() - t0);
    // each group's hierarchy, built in a worker of its own over its own copy of its triangles
    const results = await Promise.all(groups.map(async (g, i) => {
      await yieldPage();
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
    await yieldPage(); checkAbort(signal);
    emit(top, 0);
    await yieldPage(); checkAbort(signal);
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
// (own: a material that is not to be shared with any other part, such as the distant terrain's, which the raster
// passes leave out)
function convertMaterial(m, cache, list, noShadow = false, cls = CLS.BASE, own = '') {
  const rough = m.type === 'MeshStandardMaterial' || m.type === 'MeshPhysicalMaterial' ? Math.max(0.05, m.roughness)
    : m.type === 'MeshPhongMaterial' ? Math.min(1, Math.max(0.25, Math.sqrt(2 / (m.shininess + 2)) * 1.6))
    : m.type === 'MeshToonMaterial' ? 0.85 : 0.92;
  const metal = m.metalness !== undefined ? m.metalness : 0;
  const em = m.emissive ? m.emissive.clone().multiplyScalar(m.emissiveIntensity ?? 1) : new THREE.Color(0, 0, 0);
  const key = [m.color ? m.color.getHexString() : 'ffffff', m.map ? m.map.uuid : '-', rough.toFixed(2), metal.toFixed(2), em.getHexString(), m.alphaTest > 0 ? m.alphaTest : 0, noShadow ? 'ns' : 's', cls, own].join('|');
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
async function buildSky(U, sunDir, sunRad, opt) {
  const W = opt.envWidth, H = W / 2;
  const bg = new Float32Array(W * H * 4), env = new Float32Array(W * H * 4);
  const c = [0, 0, 0];
  const cosR = Math.cos(opt.sunRadiusDeg * Math.PI / 180), cosR0 = Math.cos(opt.sunRadiusDeg * 0.8 * Math.PI / 180);
  // irradiance of the sky alone on an upward surface, and the solid angle the sun's disc covers
  let eUp = [0, 0, 0], discW = 0;
  const dTh = 2 * Math.PI / W, dPh = Math.PI / H;
  const discMask = new Float32Array(W * H);
  let tY = performance.now();
  for (let j = 0; j < H; j++) {
    if (performance.now() - tY > 12) { await yieldPage(); tY = performance.now(); }
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
  // the sky light without the sun, averaged into a coarse map, for the irradiance of the far field
  const DW = 64, DH = 32, down = new Float32Array(DW * DH * 3), fx = W / DW, fy = H / DH;
  for (let p = 0; p < W * H; p++) {
    if ((p & 65535) === 0 && performance.now() - tY > 12) { await yieldPage(); tY = performance.now(); }
    const k = p * 4, w = discMask[p];
    for (let q = 0; q < 3; q++) env[k + q] = env[k + q] * gains[q];
    const d = (Math.floor(Math.floor(p / W) / fy) * DW + Math.floor((p % W) / fx)) * 3;
    for (let q = 0; q < 3; q++) down[d + q] += env[k + q] / (fx * fy);
    for (let q = 0; q < 3; q++) env[k + q] += sunL[q] * w;
  }
  const irrTex = irradianceMap(down, DW, DH, sunDir, sunRad);
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
  return { bgTex, envTex: mk(env), irrTex, gain, gains, eUp, sunL };
}

// The irradiance on a surface facing each direction, from the sky (sky: the radiance without the sun, DW by DH, laid
// out as the environment map) and from the ground, taken as a grey diffuse plane of albedo 0.25 lit by the sun and the
// sky; an equirectangular map of 32 by 16 in the same layout
function irradianceMap(sky, DW, DH, sunDir, sunRad) {
  const dirs = [], dOm = [];
  for (let j = 0; j < DH; j++) for (let i = 0; i < DW; i++) {
    const v = (j + 0.5) / DH, phi = (1 - v) * Math.PI, sp = Math.sin(phi), th = ((i + 0.5) / DW - 0.5) * 2 * Math.PI;
    dirs.push([sp * Math.cos(th), Math.cos(phi), sp * Math.sin(th)]); dOm.push(sp * (2 * Math.PI / DW) * (Math.PI / DH));
  }
  const up = [0, 0, 0];
  for (let k = 0; k < dirs.length; k++) if (dirs[k][1] > 0) for (let q = 0; q < 3; q++) up[q] += sky[k * 3 + q] * dirs[k][1] * dOm[k];
  const sr = [sunRad.r, sunRad.g, sunRad.b], ground = [0, 1, 2].map(q => 0.25 * (up[q] + sr[q] * Math.max(0, sunDir.y)) / Math.PI);
  const OW = 32, OH = 16, out = new Float32Array(OW * OH * 4);
  for (let j = 0; j < OH; j++) for (let i = 0; i < OW; i++) {
    const v = (j + 0.5) / OH, phi = (1 - v) * Math.PI, sp = Math.sin(phi), th = ((i + 0.5) / OW - 0.5) * 2 * Math.PI;
    const n = [sp * Math.cos(th), Math.cos(phi), sp * Math.sin(th)], o = (j * OW + i) * 4;
    for (let k = 0; k < dirs.length; k++) {
      const d = dirs[k], c = n[0] * d[0] + n[1] * d[1] + n[2] * d[2]; if (c <= 0) continue;
      for (let q = 0; q < 3; q++) out[o + q] += (d[1] > 0 ? sky[k * 3 + q] : ground[q]) * c * dOm[k];
    }
    out[o + 3] = 1;
  }
  const t = new THREE.DataTexture(out, OW, OH, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
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
  // what lies wholly beyond ptReach is drawn by the raster passes alone (farParts)
  const parts = [], farParts = [], included = new Set(), renderables = [];
  const ptReach = opt.ptReach > 0 ? opt.ptReach : Infinity;
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
        (c.distanceTo(camPos) - r > ptReach ? farParts : parts).push({ o, matrix: mw.clone(), instance: k }); any = true;
      }
      if (any) included.add(o);
    } else {
      const c = bs.center.clone().applyMatrix4(o.matrixWorld), r = bs.radius * o.matrixWorld.getMaxScaleOnAxis();
      if (!farTerrain && !keep(c, r)) return;
      (!farTerrain && c.distanceTo(camPos) - r > ptReach ? farParts : parts).push({ o, matrix: o.matrixWorld.clone(), instance: -1, far: farTerrain }); included.add(o);
    }
  });
  info.parts = parts.length; info.farParts = farParts.length;
  return { parts, farParts, included, renderables, sea, sky, sun, hemi, far };
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
// stopped half way: W.parts (the blocks within ptReach, for the path-traced scene), W.far (the geometry of the blocks
// beyond it, for the raster passes alone), W.temps (meshes with the game's own materials, for the colour passes),
// W.generated and W.farChunks (the blocks made for the picture alone, near and far, which are handed back with
// V.disposeChunk), W.built and W.farBuilt (the cells covered, near and far, in the true world)
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
  let tris = 0, verts = 0, farTris = 0, made = 0, reused = 0, t = performance.now();
  const tGen = [0, 0, 0], nGen = [0, 0, 0], trisByLod = [0, 0, 0];
  const t0 = performance.now();
  for (let k = 0; k < cells.length; k++) {
    // blocks nearer than ptReach are path-traced; those beyond are drawn by the raster passes alone
    const c = cells[k], key = c.cx + ',' + c.cz;
    // once the path tracer's budget is spent, the near field ends there (W.nearReach) and the blocks beyond it are
    // drawn by the raster passes; beyond the raster passes' own budget the blocks end, and the distant terrain begins
    if (c.d < W.nearReach && (tris > budget.triangles || verts > budget.vertices)) W.nearReach = c.d;
    const near = c.d < W.nearReach;
    if (!near && farTris > budget.rasterTriangles) { info.blocksCut = cells.length - k; W.reach = c.d; break; }
    let ch = have.get(key);
    // a block the game holds at the detail wanted or finer is taken as it is; so is a simplified one where full detail
    // is wanted, since the game's boats stand with it and would otherwise be there twice
    if (!(ch && (ch.lod <= c.want || (c.want === 0 && ch.lod === 1)))) {
      const tg = performance.now();
      ch = V.genChunk(c.cx, c.cz, c.want); (near ? W.generated : W.farChunks).push(ch); made++;
      tGen[c.want] += performance.now() - tg; nGen[c.want]++;
    } else reused++;
    (near ? W.built : W.farBuilt).add(key);
    const M = new THREE.Matrix4().makeTranslation(c.cx * C - ox, 0, c.cz * C - oz);
    for (const [g, m] of [[ch.geo, bMat], [ch.groundGeo, gMat]]) {
      if (!g || !g.attributes.position || !g.attributes.position.count) continue;
      if (g === ch.groundGeo) { if (!g.boundingBox) g.computeBoundingBox(); if (g.boundingBox.max.y < -1.5) continue; }   // sea floor, unseen under the water
      // a block beyond ptReach is drawn by the raster passes alone
      if (!near) { W.far.push({ g, m, x: c.cx * C - ox, z: c.cz * C - oz }); farTris += (g.index ? g.index.count : g.attributes.position.count) / 3; continue; }
      W.parts.push({ o: { geometry: g, material: m, isInstancedMesh: false, position: new THREE.Vector3() }, matrix: M, instance: -1, block: true });
      const nt = (g.index ? g.index.count : g.attributes.position.count) / 3;
      tris += nt; verts += g.attributes.position.count; trisByLod[Math.min(2, ch.lod)] += nt;
      // near the camera the colour passes draw the game's own surfaces, patterns and all
      if (c.d < opt.colourReach) { const mesh = new THREE.Mesh(g, m); mesh.position.set(c.cx * C, 0, c.cz * C); mesh.frustumCulled = false; W.temps.push(mesh); }
    }
    if (performance.now() - t > 30) { report('world', (k + 1) / cells.length); await yieldPage(); checkAbort(signal); t = performance.now(); }
  }
  info.farBlockTriangles = Math.round(farTris); info.nearReach = Math.round(Math.min(W.nearReach, 1e6));
  info.blockCells = cells.length; info.blocksReused = reused; info.blocksMade = made; info.blockTriangles = Math.round(tris); info.blockVertices = verts;
  info.genMs = tGen.map(Math.round); info.blockTrianglesByLod = trisByLod.map(Math.round); info.genCount = nGen; info.tBlocks = Math.round(performance.now() - t0);
  return true;
}

// the land beyond the blocks, out to horizonReach, from the game's coarse terrain
// (lowered under the blocks within built, for the path tracer; rasterPosition is the same lowered also under the
// blocks of farBuilt, which only the raster passes draw, the terrain standing in for them in the path tracer)
function distantTerrain(V, cam, opt, info, built, reach = Infinity, farBuilt = null) {
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
  const P = new Float32Array(nv * 3), Cc = new Float32Array(nv * 3), Hs = new Float32Array(nv), PR = new Float32Array(nv * 3);
  const pts = new Map();
  const fp = (gi, gj) => { const k = gi * 1e6 + gj; let F = pts.get(k); if (!F) { F = V.farPoint(gi, gj); pts.set(k, F); } return F; };
  const inSet = (S, x, z) => S.has(Math.floor(x / C) + ',' + Math.floor(z / C));
  const under = (S, x, z) => S && inSet(S, x - 2, z - 2) && inSet(S, x + 2, z - 2) && inSet(S, x - 2, z + 2) && inSet(S, x + 2, z + 2);
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
    let y = h - 0.35, yr = y;
    // under the blocks the terrain is lowered out of their way, as the game's own coarse terrain is
    if (under(built, x, z)) y = yr = y - 60; else if (under(farBuilt, x, z)) yr -= 60;
    P[q * 3] = PR[q * 3] = x - ox; P[q * 3 + 1] = y; PR[q * 3 + 1] = yr; P[q * 3 + 2] = PR[q * 3 + 2] = z - oz; Hs[q] = h;
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
  return { o: { geometry: geo, material: V.farMesh.material, isInstancedMesh: false, position: new THREE.Vector3() }, matrix: new THREE.Matrix4(), instance: -1, generated: true, terrain: true, rasterPosition: PR };
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

async function buildGeometry(col, seaGeo, origin, info, opt, signal) {
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
  let tY = performance.now();
  for (const p of col.parts) {
    if (performance.now() - tY > 12) { await yieldPage(); checkAbort(signal); tY = performance.now(); }
    const o = p.o, g = o.geometry, ms = Array.isArray(o.material) ? o.material : null;
    const idx = g.index, total = idx ? idx.count : g.attributes.position.count;
    const dr0 = Math.max(0, g.drawRange.start), dr1 = Math.min(total, g.drawRange.start + g.drawRange.count);
    const ranges = ms ? (g.groups.length ? g.groups : [{ start: 0, count: total, materialIndex: 0 }]).map(gr => ({ s: Math.max(dr0, gr.start), e: Math.min(dr1, gr.start + gr.count), m: ms[gr.materialIndex] }))
      : [{ s: dr0, e: dr1, m: o.material }];
    for (const r of ranges) {
      if (!usable(r.m) || r.e <= r.s) continue;
      const e3 = r.e - ((r.e - r.s) % 3);
      const cl = opt.materials ? classify(g, r.m, r.s, e3, idx) : null;
      if (!cl) { pieces.push({ p, s: r.s, e: e3, m: r.m, mi: convertMaterial(r.m, matCache, materials, !!p.far, CLS.BASE, p.terrain ? 'terrain' : '') }); continue; }
      // a mesh holding several classes of surface is split into one piece for each, triangle by triangle
      const by = new Map();
      for (let k = 0; k < cl.length; k++) { let L = by.get(cl[k]); if (!L) by.set(cl[k], L = []); L.push(r.s + k * 3); }
      for (const [c, L] of by) pieces.push({ p, s: 0, e: L.length * 3, tris: Uint32Array.from(L), m: r.m, mi: convertMaterial(r.m, matCache, materials, !!p.far, c, p.terrain ? 'terrain' : '') });
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
    if (performance.now() - tY > 12) { await yieldPage(); checkAbort(signal); tY = performance.now(); }
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
  const terrainMats = new Set(pieces.filter(pc => pc.p.terrain).map(pc => pc.mi));
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
  return { geo, materials, seaIndex, terrainMats };
}

// a block made for the picture alone is handed back to the game, which lets go of it and of its boats and clock faces
function disposeChunk(V, ch) {
  try { if (V && V.disposeChunk) V.disposeChunk(ch); else { ch.geo.dispose(); ch.groundGeo.dispose(); } } catch (e) { /* already gone */ }
}

/* ---------- the far field, drawn by the raster passes alone ----------
   Beyond ptReach the picture is not path-traced. The blocks there (W.far), the game's objects there (col.farParts)
   and the distant terrain, lowered under every block, are drawn into the colour passes, the guide and the shadow
   maps; the path tracer holds the terrain alone there, unlowered, which stands in for them in its reflections and
   shadows. The light on the far surfaces is worked out from the guide (farBasisMat). */
async function buildFarScene(W, col, terrain, materials, terrainMats, origin, info, opt, signal) {
  const meshes = [], owned = [], white = new THREE.Color(1, 1, 1), byMat = new Map();
  const albedoOf = m => { let a = byMat.get(m); if (!a) { a = albedoMaterial({ color: m.color || white, map: null }, false); byMat.set(m, a); owned.push(a); } return a; };
  const add = (g, m, x = 0, y = 0, z = 0) => { const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); meshes.push(mesh); };
  let tris = 0;
  for (const f of W.far) { add(f.g, albedoOf(f.m), f.x - origin.x, -origin.y, f.z - origin.z); tris += (f.g.index ? f.g.index.count : f.g.attributes.position.count) / 3; }
  if (col.farParts && col.farParts.length) {
    const fi = {}, r = await buildGeometry({ parts: col.farParts, far: null }, null, origin, fi, opt, signal);
    const mats = r.materials.map(m => albedoMaterial(m, false));
    add(r.geo, mats); owned.push(r.geo, ...mats, ...r.materials); tris += fi.triangles;
  }
  let terrainOn = false;
  if (terrain && terrainMats.size) {
    const tg = terrain.o.geometry, PR = terrain.rasterPosition, P = new Float32Array(PR.length);
    for (let k = 0; k < PR.length; k += 3) { P[k] = PR[k] - origin.x; P[k + 1] = PR[k + 1] - origin.y; P[k + 2] = PR[k + 2] - origin.z; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', tg.attributes.normal); g.setAttribute('color', tg.attributes.color); g.setIndex(tg.index);
    const m = albedoMaterial(materials[terrainMats.values().next().value], false);
    add(g, m); owned.push(g, m); terrainOn = true;
  }
  info.farTriangles = Math.round(tris);
  return { meshes, terrain: terrainOn, dispose() { for (const x of owned) x.dispose(); } };
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

// every other pixel of every other row, for reading back a quarter of a buffer
const packMat = pass(`uniform sampler2D t; void main(){ gl_FragColor=texelFetch(t,ivec2(gl_FragCoord.xy)*2,0); }`, { t: { value: null } }, { blending: THREE.NoBlending });
const copyMat = pass(`uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor=texture2D(t,vUv); }`, { t: { value: null } }, { blending: THREE.NoBlending });

// the light falling on each surface (radiance over flat colour) and the variance of its mean, from the two halves of
// the samples
// the far field: a surface beyond uBand.x (at the centre of the pixel) takes the light of the far field, entirely
// beyond uBand.y. Where the surface covers only part of the pixel, the rest is the sky as the path tracer shows it,
// which is mixed in by the share the surface leaves uncovered (the colour passes count what they leave uncovered as
// white)
// With uPreview, before any sample is taken, every surface takes the light of the far field and the rest is sky.
const demodMat = pass(`uniform sampler2D tP, tH, tApt, tG, tFar, tBg; uniform float uN, uHybrid, uPreview, uTanY, uAspect; uniform vec2 uTexel, uBand; uniform vec3 uKSun, uKSky;
  uniform mat3 uCamRot; varying vec2 vUv;
  float lum(vec3 c){ return dot(c,vec3(0.2126,0.7152,0.0722)); }
  vec3 viewDir(vec2 uv){ return vec3((uv*2.0-1.0)*vec2(uTanY*uAspect,uTanY),-1.0); }
  float farShare(vec2 uv, float cover){
    if (uHybrid<0.5 || cover<0.02) return 0.0;
    float z=texture2D(tG,uv).w; if (z<=0.0 || z>1e5) return 0.0;
    return smoothstep(uBand.x,uBand.y,z*length(viewDir(uv))); }
  // the sky behind the pixel, as the path tracer draws it
  vec3 skyIn(vec3 d){ return texture2D(tBg,vec2(atan(d.z,d.x)/6.2831853+0.5,1.0-acos(clamp(d.y,-1.0,1.0))/3.1415927)).rgb; }
  vec3 skyAt(vec2 uv){ return skyIn(normalize(uCamRot*viewDir(uv))); }
  // the light of the far field on the pixel's surface, as the light to multiply its colour (A, with cover) by
  vec3 farLight(vec2 uv, vec4 A){ vec4 b=texture2D(tFar,uv); vec3 E=uKSun*b.a+uKSky*b.rgb;
    if (A.a>0.99) return E;
    vec3 sky=skyAt(uv), alb=max(A.rgb-(1.0-A.a),vec3(0.0));
    return (alb*E+(1.0-A.a)*sky)/max(A.rgb,vec3(0.03)); }
  vec3 light(vec2 uv){ vec4 A=texture2D(tApt,uv)/uN; vec3 E=texture2D(tP,uv).rgb/max(A.rgb,vec3(0.03));
    float t=farShare(uv,A.a); return t>0.0 ? mix(E,farLight(uv,A),t) : E; }
  void main(){ vec3 P=texture2D(tP,vUv).rgb, H=texture2D(tH,vUv).rgb; vec4 A=texture2D(tApt,vUv)/uN;
    // (the sea, glass and metal, which the colour passes leave uncovered, take a dim reflection of the sky)
    if (uPreview>0.5){ vec4 g=texture2D(tG,vUv); bool hit=g.w>0.0 && g.w<1e5;
      vec3 E = hit && A.a>0.02 ? farLight(vUv,A) : hit ? 0.35*skyIn(reflect(normalize(uCamRot*viewDir(vUv)),normalize(g.xyz))) : skyAt(vUv);
      gl_FragColor=vec4(E/(hit && A.a>0.02 ? vec3(1.0) : max(A.rgb,vec3(0.03))),0.0); return; }
    vec3 a=max(A.rgb,vec3(0.03)); vec3 E=P/a; float d=lum(P-H)/max(lum(a),0.03);
    float t=farShare(vUv,A.a); if (t>0.0){ E=mix(E,farLight(vUv,A),t); d*=1.0-t; }
    // a pixel far brighter than every one of its eight neighbours is a firefly: it takes their mean instead
    vec3 s=vec3(0.0); float mx=0.0;
    for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){ if (x==0&&y==0) continue; vec3 q=light(vUv+vec2(float(x),float(y))*uTexel); s+=q; mx=max(mx,lum(q)); }
    if (lum(E)>3.0*mx+0.05){ E=s/8.0; d=0.0; }
    gl_FragColor=vec4(E,d*d); }`,
  { tP: { value: null }, tH: { value: null }, tApt: { value: null }, tG: { value: null }, tFar: { value: null }, uN: { value: 1 }, uTexel: { value: new THREE.Vector2() },
    uHybrid: { value: 0 }, uPreview: { value: 0 }, uTanY: { value: 1 }, uAspect: { value: 1 }, uBand: { value: new THREE.Vector2(1e9, 1e9) }, uKSun: { value: new THREE.Vector3() }, uKSky: { value: new THREE.Vector3() },
    tBg: { value: null }, uCamRot: { value: new THREE.Matrix3() } }, { blending: THREE.NoBlending });

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

/* ---------- the light on the far field ----------
   Beyond ptReach the light on a surface is the sun's, as far as the sun is seen from it, and the sky's: the sun's
   visibility comes from two shadow maps over the far part of the view, drawn from the sun with everything the raster
   passes draw, and the sky's irradiance from a coarse map of the irradiance of the sky and the ground on a surface
   facing each way (irradianceMap). farBasisMat writes, for each pixel, the sky's irradiance (rgb) and the share of
   the sun's (a: the cosine of its angle times its visibility). The light is then kSun * a + kSky * rgb, where kSun and
   kSky are fitted, colour by colour, to the path-traced light of the surfaces between, at the edge of the near field
   (see calibrate in pathTrace), so that the two fields meet without a seam. */
const shadowDepthMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
  vertexShader: `in vec3 position; uniform mat4 modelViewMatrix, projectionMatrix; void main(){ gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `precision highp float; out vec4 o; void main(){ o=vec4(gl_FragCoord.z); }`,
});
// an orthographic camera looking along the sun's light over the part of the view between view depths n0 and n1
function sunCamera(camPT, sunDir, n0, n1, tanY, aspect) {
  const rot = new THREE.Matrix3().setFromMatrix4(camPT.matrixWorld), corners = [], centre = new THREE.Vector3();
  for (const d of [n0, n1]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const c = new THREE.Vector3(sx * tanY * aspect * d, sy * tanY * d, -d).applyMatrix3(rot); corners.push(c); centre.add(c); }
  centre.multiplyScalar(1 / 8);
  const lc = new THREE.OrthographicCamera(), D = 4000;
  lc.position.copy(centre).addScaledVector(sunDir, D);
  if (Math.abs(sunDir.y) > 0.99) lc.up.set(1, 0, 0);
  lc.lookAt(centre); lc.updateMatrixWorld(true);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity;
  for (const c of corners) { const v = c.applyMatrix4(lc.matrixWorldInverse); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); z0 = Math.min(z0, v.z); }
  lc.left = x0; lc.right = x1; lc.bottom = y0; lc.top = y1; lc.near = 1; lc.far = -z0 + 800; lc.updateProjectionMatrix();
  return lc;
}
const farBasisMat = pass(`uniform sampler2D tG, tIrr, tS0, tS1; uniform mat4 uL0, uL1; uniform vec4 uT0, uT1; uniform mat3 uCamRot;
  uniform float uTanY, uAspect, uSize; uniform vec3 uSun; varying vec2 vUv;
  // the share of the sun seen from p, from one shadow map (t: texel size in metres, depth range, -, the view depth up
  // to which it serves), with a 3 by 3 filter
  float sunSeen(sampler2D S, mat4 L, vec4 t, vec3 p, vec3 n){
    vec4 q=L*vec4(p+n*t.x*1.5,1.0); vec3 c=q.xyz/q.w*0.5+0.5;
    if (any(lessThan(c.xy,vec2(0.0))) || any(greaterThan(c.xy,vec2(1.0))) || c.z>1.0) return 1.0;
    float bias=t.x*1.5/t.y, v=0.0;
    for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++) v+=step(c.z-bias,texture2D(S,c.xy+vec2(float(x),float(y))/uSize).r);
    return v/9.0; }
  void main(){
    vec4 g=texture2D(tG,vUv);
    if (g.w<=0.0 || g.w>1e5){ gl_FragColor=vec4(0.0); return; }
    vec3 p=uCamRot*(vec3((vUv*2.0-1.0)*vec2(uTanY*uAspect,uTanY),-1.0)*g.w), n=normalize(g.xyz);
    float d=g.w, nl=max(dot(n,uSun),0.0), vis=1.0;
    if (nl>0.0) vis = d<uT0.w ? sunSeen(tS0,uL0,uT0,p,n) : d<uT1.w ? sunSeen(tS1,uL1,uT1,p,n) : 1.0;
    vec2 uv=vec2(atan(n.z,n.x)/6.2831853+0.5, 1.0-acos(clamp(n.y,-1.0,1.0))/3.1415927);
    gl_FragColor=vec4(texture2D(tIrr,uv).rgb, nl*vis); }`,
  { tG: { value: null }, tIrr: { value: null }, tS0: { value: null }, tS1: { value: null }, uL0: { value: new THREE.Matrix4() }, uL1: { value: new THREE.Matrix4() },
    uT0: { value: new THREE.Vector4() }, uT1: { value: new THREE.Vector4() }, uCamRot: { value: new THREE.Matrix3() }, uTanY: { value: 1 }, uAspect: { value: 1 }, uSize: { value: 2048 },
    uSun: { value: new THREE.Vector3(0, 1, 0) } }, { blending: THREE.NoBlending });

// a float buffer drawn for inspection: tone mapped, or as it is
const viewMat = pass(`uniform sampler2D t; uniform float uScale, uDiv; uniform vec4 uMode; varying vec2 vUv;
  void main(){ vec4 c=texture2D(t,vUv)/uDiv; vec3 o=uMode.x>0.5? c.rgb*uScale : uMode.y>0.5 ? c.xyz*0.5+0.5 : uMode.z>0.5 ? vec3(c.w/uScale) : vec3(c.a);
    gl_FragColor=vec4(o,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`, { t: { value: null }, uScale: { value: 1 }, uDiv: { value: 1 }, uMode: { value: new THREE.Vector4(1, 0, 0, 0) } }, { blending: THREE.NoBlending, toneMapped: true });

// the passes' programs are compiled once, in the background (the browser compiles them on threads of its own where it
// can), while the world for the first picture is built, so that their first use does not hold up the page
function precompilePasses() {
  if (ctx.precompiled) return; ctx.precompiled = true;
  const { R } = ctx, sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), geo = new THREE.PlaneGeometry(2, 2);
  const add = mat => { const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; sc.add(mesh); };
  [accumulateMat, copyMat, packMat, demodMat, atrousMat, farBasisMat, shadowDepthMat, guideMaterial(), albedoMaterial({ color: new THREE.Color(1, 1, 1), map: null }, false)].forEach(add);
  const tm = R.toneMapping;
  const compile = mapping => { R.toneMapping = mapping; const sc2 = new THREE.Scene(); const mesh = new THREE.Mesh(geo, composeMat); mesh.frustumCulled = false; sc2.add(mesh); return R.compileAsync(sc2, cam); };
  try {
    const all = [R.compileAsync(sc, cam), compile(THREE.ACESFilmicToneMapping), compile(THREE.NoToneMapping)];
    R.toneMapping = tm;
    Promise.all(all).catch(() => {});
  } catch (e) { R.toneMapping = tm; }
}

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
  if (kept.bvh) kept.bvh.geometry = null; kept.geo.dispose(); kept.rasterMats.forEach(x => x.dispose()); kept.materials.forEach(x => x.dispose());
  kept.farScene.dispose(); for (const ch of kept.farChunks) disposeChunk(kept.V, ch);
  kept = null; if (ctx) ctx.uploaded = null;
}
export function releasePathTrace() { dropKept(); }
// what the scene depends on: the camera in the true world (not the floating origin), the size and the settings that
// change the geometry
function sceneKey(cam, wg, w, h, opt) {
  const o = wg ? wg.position : { x: 0, y: 0, z: 0 }, e = cam.matrixWorld.elements;
  const m = e.map((x, i) => i === 12 ? (x - o.x).toFixed(2) : i === 13 ? (x - o.y).toFixed(2) : i === 14 ? (x - o.z).toFixed(2) : x.toFixed(4));
  return [m.join(','), cam.projectionMatrix.elements.map(x => x.toFixed(5)).join(','), w, h, opt.extend, opt.horizonReach, opt.blockReach, opt.lodRings.join('/'), opt.materials,
    opt.ripple, opt.rippleSize, opt.jitter, opt.textureSize, opt.nearReach, opt.farReach, opt.frustumWiden, opt.frustumWidenFar, opt.widenReach, opt.terrainStep, opt.colourReach, opt.maxTriangles, opt.maxVertices, opt.ptReach, opt.maxRasterTriangles].join('|');
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
  const mem = Math.min(8, navigator.deviceMemory || 8) / 8;
  if (opt.maxTriangles == null) opt.maxTriangles = 4.5e6 * mem;
  if (opt.maxVertices == null) opt.maxVertices = 6e6 * mem;
  if (opt.maxRasterTriangles == null) opt.maxRasterTriangles = 6e6 * mem;
  opt.ptReach = opt.ptReach > 0 ? opt.ptReach : Infinity;
  const { renderer, scene, camera, signal, onProgress } = opt;
  const samples = Math.max(1, Math.round(opt.samples));
  if (!scene || !camera) throw new Error('pathTrace needs the scene and the camera.');
  const gameCanvas = renderer && renderer.domElement;
  const w = Math.round(opt.width || (gameCanvas ? gameCanvas.width : 1280));
  const h = Math.round(opt.height || (gameCanvas ? gameCanvas.height : Math.round(w / (camera.aspect || 1.6))));
  const info = { width: w, height: h, samples, bounces: opt.bounces };
  const t0 = performance.now(), mark = k => { info[k] = Math.round(performance.now() - t0); };
  const deadline = opt.timeBudget > 0 ? (opt.startTime ?? t0) + opt.timeBudget * 1000 : Infinity;
  const report = (phase, fraction) => { if (onProgress) try { onProgress({ phase, fraction, info }); } catch (e) { /* the caller's own error */ } };
  checkAbort(signal);
  getContext(w, h);
  const { R, pt } = ctx;
  precompilePasses();

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
  // (a scene whose BVH was not finished, because the picture was stopped, is not kept)
  let S = kept && kept.key === key && kept.bvh ? kept : null;
  info.sceneKept = !!S;
  // the colour passes' sums and the filter's guide, drawn once for each scene
  const accPt = target('accPt', w, h, THREE.FloatType), accGame = target('accGame', w, h, THREE.FloatType);
  const tG = target('guide', w, h, THREE.FloatType, true), tLit = target('lit', w, h, THREE.FloatType, true);
  const wantLit = opt.autoExposure && opt.exposure == null;

  let bvhJob = null;
  if (!S) {
    // the scene kept for another view is let go before this one is built
    dropKept();
    const W = { parts: [], far: [], temps: [], generated: [], farChunks: [], built: new Set(), farBuilt: new Set(), reach: Infinity, nearReach: opt.ptReach };
    let geo, materials, seaIndex, rasterMats, col, farScene = null, rasterScene = null;
    try {
      if (extend) { report('world', 0); await yieldPage(); await gatherWorld(V, cam, opt, info, { triangles: opt.maxTriangles * 0.85, vertices: opt.maxVertices * 0.7, rasterTriangles: opt.maxRasterTriangles }, W, report, signal); mark('tWorld'); }
      checkAbort(signal);

      // everything taken from the live scene is taken now, in one go, before the game moves on
      report('scene', 0); await yieldPage();
      scene.updateMatrixWorld(true);
      col = collect(scene, cam, { ...opt, ptReach: W.nearReach }, info);
      let terrain = null;
      if (extend) { col.parts.push(...W.parts); terrain = distantTerrain(V, cam, opt, info, W.built, W.reach, W.farBuilt); if (terrain) col.parts.push(terrain); }
      const seaGeo = col.sea ? buildSea(col.sea, opt.horizonReach * 4) : null;
      mark('tCollect');
      // the page is given a turn between the longer steps
      await yieldPage(); checkAbort(signal);
      let terrainMats;
      ({ geo, materials, seaIndex, terrainMats } = await buildGeometry(col, seaGeo, origin, info, opt, signal));
      // what only the raster passes draw: the blocks and the game's objects beyond ptReach, and the distant terrain
      // lowered under all the blocks (the path tracer's own terrain stands in for the far blocks)
      await yieldPage(); checkAbort(signal);
      farScene = await buildFarScene(W, col, terrain, materials, terrainMats, origin, info, opt, signal);
      if (terrain) terrain.o.geometry.dispose();
      mark('tGeometry');

      // the two colour passes, with the same sub-pixel offsets
      report('albedo', 0); await yieldPage();
      rasterScene = new THREE.Scene();
      // the sea, glass and metal keep the path tracer's colour: they are written as uncovered in the colour passes
      rasterMats = materials.map((m, i) => albedoMaterial(m, i === seaIndex || isDirectClass(m.userData.cls)));
      for (const i of terrainMats) if (farScene.terrain) rasterMats[i].visible = false;
      const rasterMesh = new THREE.Mesh(geo, rasterMats); rasterMesh.frustumCulled = false; rasterScene.add(rasterMesh);
      for (const mesh of farScene.meshes) rasterScene.add(mesh);
      const tA = target('a', w, h, THREE.HalfFloatType, true), tB = target('b', w, h, THREE.HalfFloatType, true);
      R.setClearColor(0x000000, 0);
      for (const t of [accPt, accGame]) { R.setRenderTarget(t); R.clear(); }
      R.setRenderTarget(null);
      const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
      // the programs of the game's materials, which this renderer has not drawn before, are compiled in the background
      try { await R.compileAsync(rasterScene, camPT); await R.compileAsync(scene, cam); } catch (e) { /* compiled as they are drawn */ }
      checkAbort(signal);
      // one offset at a time, with the game's scene set up for it and put back each time, so that the page has a
      // turn between them
      for (let j = 0; j < NJ; j++) {
        const jx = NJ > 1 ? halton(j + 1, 2) - 0.5 : 0, jy = NJ > 1 ? halton(j + 1, 3) - 0.5 : 0;
        cam.setViewOffset(w, h, jx, jy, w, h); camPT.setViewOffset(w, h, jx, jy, w, h);
        R.setClearColor(0xffffff, 0); R.setRenderTarget(tA); R.clear(); R.render(rasterScene, camPT);
        withTemps(V, W.temps, col, () => withGameScene(scene, col, true, () => drawGame(scene, cam, tB)));
        accumulateMat.uniforms.tA.value = tA.texture; accumulateMat.uniforms.tB.value = tB.texture;
        accumulateMat.uniforms.uWhich.value = 0; R.autoClear = false; runPass(accumulateMat, accPt);
        accumulateMat.uniforms.uWhich.value = 1; runPass(accumulateMat, accGame); R.autoClear = true;
        cam.clearViewOffset(); camPT.clearViewOffset();
        await yieldPage(); checkAbort(signal);
      }
      withTemps(V, W.temps, col, () => {
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
      if (farScene) farScene.dispose();
      for (const ch of W.farChunks) disposeChunk(V, ch);
      throw e;
    } finally {
      // the blocks made for the picture alone are let go (the game's boats and clock faces with them)
      for (const ch of W.generated) disposeChunk(V, ch);
    }
    checkAbort(signal);

    // the bounding volume hierarchy over every triangle, built in the workers while the light of the far field is
    // worked out and a first picture is shown
    report('bvh', 0);
    S = { key, geo, materials, seaIndex, rasterMats, bvh: null, temps: W.temps, included: col.included, rasterScene, farScene, farChunks: W.farChunks, V, nearReach: W.nearReach };
    kept = S;
    bvhJob = buildBVH(geo, { strategy: opt.bvhStrategy ?? SAH, maxLeafTris: opt.bvhLeaf ?? 1, indirect: true }, signal, info).then(b => { mark('tBVH'); return b; });
    bvhJob.catch(() => {});
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
  const { geo, materials } = S;

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
  await yieldPage(); checkAbort(signal);
  const sky = await buildSky(SU, sunDir, sunRad, { ...opt, hemi: hemiInfo });
  info.skyGain = sky.gains.map(x => +x.toFixed(3));
  mark('tSky');
  await yieldPage();
  if (signal && signal.aborted) { sky.envTex.dispose(); sky.bgTex.dispose(); sky.irrTex.dispose(); checkAbort(signal); }

  const m = pt.material;
  pt.alpha = !R.extensions.get('EXT_float_blend');
  // the rate of sampling by distance needs the running mean blended on the GPU, which the alpha mode does not do
  const rate = !pt.alpha && (opt.farEvery > 1 || opt.skyEvery > 1 || opt.farBounces < opt.bounces);
  const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / cam.zoom;
  // the far field is lit by the raster passes when there is one
  const hybrid = !!(S.farScene && S.nearReach < Infinity);
  const nearR = hybrid ? S.nearReach : Infinity;
  m.uniforms.uRateOn.value = rate || hybrid ? 1 : 0; m.uniforms.uGuide.value = tG.texture;
  m.uniforms.uFarDist.value = hybrid ? nearR * 0.7 : opt.farField > 0 ? opt.farField : 1e9;
  m.uniforms.uFarEvery.value = rate ? Math.max(1, Math.round(opt.farEvery)) : 1; m.uniforms.uSkyEvery.value = rate ? Math.max(1, Math.round(opt.skyEvery)) : 1;
  m.uniforms.uFarBounces.value = Math.max(1, Math.round(opt.farBounces));
  m.uniforms.uCover.value = accPt.texture; m.uniforms.uCoverN.value = NJ; m.uniforms.uView.value.set(tanY * w / h, tanY);
  m.uniforms.uSkipDist.value = hybrid ? nearR : 1e9;
  const tFarB = target('farBasis', w, h);
  if (hybrid) {
    // the shadow maps of the far field, from the sun as it is now, and the sky's irradiance and the sun's share on
    // each far surface
    const size = opt.shadowSize, split = Math.min(opt.horizonReach, nearR * 5), cams = [sunCamera(camPT, sunDir, nearR * 0.3, split, tanY, w / h)];
    if (split < opt.horizonReach) cams.push(sunCamera(camPT, sunDir, split * 0.9, opt.horizonReach * 1.05, tanY, w / h));
    const fb = farBasisMat.uniforms, rs = S.rasterScene;
    rs.overrideMaterial = shadowDepthMat;
    cams.forEach((lc, i) => {
      const t = shadowTarget('shadow' + i, size);
      R.setClearColor(0xffffff, 1); R.setRenderTarget(t); R.clear(); R.render(rs, lc);
      const L = new THREE.Matrix4().multiplyMatrices(lc.projectionMatrix, lc.matrixWorldInverse);
      (i ? fb.uL1 : fb.uL0).value.copy(L); (i ? fb.tS1 : fb.tS0).value = t.texture;
      (i ? fb.uT1 : fb.uT0).value.set((lc.right - lc.left) / size, lc.far - lc.near, 0, i ? opt.horizonReach * 2 : split);
    });
    if (cams.length < 2) { fb.tS1.value = fb.tS0.value; fb.uT1.value.set(1, 1, 0, 0); }
    rs.overrideMaterial = null; R.setRenderTarget(null);
    fb.tG.value = tG.texture; fb.tIrr.value = sky.irrTex; fb.uCamRot.value.setFromMatrix4(cam.matrixWorld); fb.uTanY.value = tanY; fb.uAspect.value = w / h;
    fb.uSize.value = size; fb.uSun.value.copy(sunDir);
    runPass(farBasisMat, tFarB);
    mark('tFarField');
  }
  let tiles = opt.tiles || Math.max(2, Math.ceil(Math.sqrt(w * h / 100000)));
  pt.tiles.set(tiles, tiles);
  pt.setSize(w, h);
  pt.setCamera(camPT);
  pt.reset();
  mark('tUpload');

  // the passes that make the picture from the samples, set up before the samples are taken so that the picture can
  // be shown while it clears
  const tP = pt.target;
  const tH = target('half', w, h, THREE.FloatType);
  // until half the samples are in, the half-way buffer is black, which the filter reads as a great deal of noise and
  // smooths the early frames strongly
  R.setClearColor(0x000000, 0); R.setRenderTarget(tH); R.clear(); R.setRenderTarget(null);
  const du = demodMat.uniforms;
  du.uTexel.value.set(1 / w, 1 / h); du.tP.value = tP.texture; du.tH.value = tH.texture; du.tApt.value = accPt.texture; du.uN.value = NJ;
  du.tG.value = tG.texture; du.tFar.value = tFarB.texture; du.uHybrid.value = hybrid ? 1 : 0; du.uTanY.value = tanY; du.uAspect.value = w / h;
  du.uBand.value.set(nearR * 0.7, nearR * 0.95); du.tBg.value = sky.bgTex; du.uCamRot.value.setFromMatrix4(cam.matrixWorld);
  // the far field's light, fitted to the path-traced light of the surfaces at the edge of the near field: for each
  // colour, the light E = P / A_pt there is fitted as kSun * (the sun's share) + kSky * (the sky's irradiance), by least
  // squares, leaving out the points that miss the first fit by more than three standard deviations. Should the points
  // be too few, or too alike in their share of the sun to tell the two terms apart, one gain is fitted to both, and
  // with fewer still the terms are taken as they are
  const sunC = [sunRad.r, sunRad.g, sunRad.b];
  const setK = (a, b) => { du.uKSun.value.set(a[0] * sunC[0] / Math.PI, a[1] * sunC[1] / Math.PI, a[2] * sunC[2] / Math.PI); du.uKSky.value.set(b[0] / Math.PI, b[1] / Math.PI, b[2] / Math.PI); };
  setK([1, 1, 1], [0.9, 0.9, 0.9]);
  // a buffer read back at every other pixel of every other row (w2 by h2)
  const w2 = Math.floor(w / 2), h2 = Math.floor(h / 2);
  const readPacked = tex => {
    const t = target('pack', w2, h2); packMat.uniforms.t.value = tex; runPass(packMat, t);
    const a = new Float32Array(w2 * h2 * 4); R.readRenderTargetPixels(t, 0, 0, w2, h2, a); return a;
  };
  let calPts = null;
  const calibrate = () => {
    if (!hybrid) return;
    if (!calPts) {
      const gd = readPacked(tG.texture), ap = readPacked(accPt.texture), fb = readPacked(tFarB.texture);
      const idx = [], S = [], A = [], Al = [];
      for (let y2 = 0; y2 < h2; y2++) for (let x2 = 0; x2 < w2; x2++) {
        const x = x2 * 2, y = y2 * 2, k = (y2 * w2 + x2) * 4, z = gd[k + 3]; if (!(z > 0 && z < 1e5) || ap[k + 3] < 0.99 * NJ) continue;
        const u = (x + 0.5) / w * 2 - 1, v = (y + 0.5) / h * 2 - 1, d = z * Math.hypot(u * tanY * w / h, v * tanY, 1);
        if (d < Math.max(40, nearR * 0.3) || d > nearR * 0.95) continue;
        idx.push(k); S.push(fb[k + 3]); A.push(fb[k], fb[k + 1], fb[k + 2]); Al.push(ap[k] / NJ, ap[k + 1] / NJ, ap[k + 2] / NJ);
      }
      calPts = { idx, S, A, Al };
    }
    const n = calPts.idx.length; info.calibPoints = n;
    if (n < 200) return;
    const P = readPacked(tP.texture);
    // the terms of each point, colour by colour (c = 3 for the luminance)
    const terms = c => {
      const xs = new Float32Array(n), as = new Float32Array(n), es = new Float32Array(n), L = [0.2126, 0.7152, 0.0722];
      for (let i = 0; i < n; i++) {
        const k = calPts.idx[i], e = q => P[k + q] / Math.max(0.03, calPts.Al[i * 3 + q]);
        if (c < 3) { xs[i] = sunC[c] * calPts.S[i] / Math.PI; as[i] = calPts.A[i * 3 + c] / Math.PI; es[i] = e(c); }
        else for (let q = 0; q < 3; q++) { xs[i] += L[q] * sunC[q] * calPts.S[i] / Math.PI; as[i] += L[q] * calPts.A[i * 3 + q] / Math.PI; es[i] += L[q] * e(q); }
      }
      return { xs, as, es };
    };
    // least squares of e = a x + b s, twice, the second time without the points the first fit misses by more than three
    // standard deviations; fixedA keeps a as given
    const fit = ({ xs, as, es }, fixedA) => {
      let keep = null, a = fixedA ?? 1, b = 0.9;
      for (let pass = 0; pass < 2; pass++) {
        let sxx = 0, sxa = 0, saa = 0, sxe = 0, sae = 0, m = 0;
        for (let i = 0; i < n; i++) { if (keep && !keep[i]) continue; sxx += xs[i] * xs[i]; sxa += xs[i] * as[i]; saa += as[i] * as[i]; sxe += xs[i] * es[i]; sae += as[i] * es[i]; m++; }
        const det = sxx * saa - sxa * sxa;
        if (fixedA != null) b = (sae - a * sxa) / Math.max(1e-9, saa);
        else if (m > 200 && det > 1e-3 * sxx * saa) { a = (sxe * saa - sae * sxa) / det; b = (sae * sxx - sxe * sxa) / det; }
        else { const g = (sxe + sae) / Math.max(1e-9, sxx + 2 * sxa + saa); a = g; b = g * 0.9; }
        if (fixedA == null) a = Math.min(1.15, Math.max(0.75, a));
        b = Math.min(2, Math.max(0.3, b));
        let r2 = 0; for (let i = 0; i < n; i++) { const r = es[i] - a * xs[i] - b * as[i]; r2 += r * r; }
        const lim = 9 * r2 / n; keep = new Uint8Array(n);
        for (let i = 0; i < n; i++) { const r = es[i] - a * xs[i] - b * as[i]; keep[i] = r * r <= lim ? 1 : 0; }
      }
      return [a, b];
    };
    // the sun's light is the path tracer's own, but for the share of it that the surfaces between pass on, so one gain
    // is fitted to it for all colours, from the luminance; the light of the sky, and of the surfaces round about, is
    // fitted colour by colour
    const a = fit(terms(3))[0], ka = [a, a, a], kb = [0, 1, 2].map(c => fit(terms(c), a)[1]);
    setK(ka, kb);
    info.calib = { sun: ka.map(x => +x.toFixed(3)), sky: kb.map(x => +x.toFixed(3)), at: pt.samples };
  };
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
    const a = readPacked(tL.texture);
    if (!fixed) {
      const b = readPacked(tLit.texture), gd = readPacked(tG.texture), cv = readPacked(accPt.texture);
      const idx = [], lb = [];
      for (let i = 0; i < w2 * h2; i++) {
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

  // a first picture, from the colour passes and the light of the far field on every surface, while the BVH is built
  if (bvhJob && hybrid && opt.onFrame) {
    du.uPreview.value = 1; measureGain(filtered(0)); showFrame(0); du.uPreview.value = 0;
    if (opt.debug) opt.debug.preview = snapshot(w, h);
    await yieldPage();
  }
  if (bvhJob) S.bvh = await bvhJob;
  checkAbort(signal);
  const { bvh } = S;

  // hand everything to the path tracer; the scene's own buffers only when they are not there already
  m.bounces = opt.bounces; m.transmissiveBounces = 2; m.filterGlossyFactor = 0.5;
  // the stratified sample lists repeat the same numbers in every sample here, so plain PCG random numbers are used
  m.setDefine('RANDOM_TYPE', opt.randomType ?? 0);
  m.uniforms.uSampleClamp.value = opt.sampleClamp;
  m.uniforms.uSpecSky.value.set(1 / sky.gains[0], 1 / sky.gains[1], 1 / sky.gains[2]);
  if (ctx.uploaded !== S) {
    m.bvh.updateFrom(bvh); await yieldPage();
    m.attributesArray.updateFrom(geo.attributes.normal, geo.attributes.tangent, geo.attributes.uv, geo.attributes.color); await yieldPage();
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

  // the samples, a tile at a time. At most inFlight tiles are on the GPU at once, so that the browser's own drawing
  // never waits behind more than that; the next tile is sent as soon as the last is seen to be done, the fence being
  // polled quickly once the tile's expected time is nearly up. The number of tiles is adjusted between samples so that
  // one tile takes about tileMs (each tile costs a good deal on top of its share of the work, so a few large tiles are
  // far quicker than many small ones), and should the tracing have kept the GPU busy for more than gpuShare of the
  // last tenth of a second, it pauses, so that the rest of the system keeps a share of the GPU
  report('trace', 0);
  const gl = R.getContext();
  // a fence is polled at the pace of timeouts until the time it is expected to take is nearly up, and then at the
  // pace of messages, which the browser does not slow down as it does a chain of timeouts
  const chan = new MessageChannel(), tick = () => new Promise(r => { chan.port1.onmessage = () => r(); chan.port2.postMessage(0); });
  const waitFence = async (f, expect = 0) => {
    const t0f = performance.now();
    for (;;) { const st = gl.clientWaitSync(f, 0, 0); if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED || st === gl.WAIT_FAILED) break;
      if (performance.now() - t0f < expect - 2) await new Promise(r => setTimeout(r, 1)); else await tick(); }
    gl.deleteSync(f);
  };
  const minSamples = Math.min(samples, Math.max(1, opt.minSamples));
  let tTrace = 0, halfDone = false, gainDone = false, early = false, passStart = 0, passMs = 0;
  // the share of the picture done: of the samples, or of the time left when the tracing began, whichever is further on
  const progress = () => Math.min(1, Math.max(pt.samples / samples, tTrace && deadline < Infinity ? (performance.now() - tTrace) / Math.max(1, deadline - tTrace) : 0));
  // the time the filter and the last picture take, kept back from the budget
  const finishMs = () => 150 + frameCost * 1.5;
  let stopped = false, tileTime = 0, passTiles = 0, passGpu = 0;
  const flight = [];   // the tiles on the GPU: their fences and the times they were sent
  let lastDone = 0, winStart = 0, winBusy = 0;
  info.tilesUsed = []; info.tilesSent = 0; info.gpuBusy = 0; info.pauses = 0;
  // the work done between samples (the frames shown, the fits), with a turn for the page after each step that reads
  // from the GPU
  const atSample = async () => {
    const now = performance.now(); passMs = now - passStart; passStart = now;
    // the time is up when another sample would not be finished, filtered and shown before the deadline
    if (pt.samples >= minSamples && now + passMs + finishMs() > deadline) stopped = true;
    const k = stopped ? 1 : progress();
    if (hybrid && (pt.samples === 1 || pt.samples === 8 || (!halfDone && k >= 0.5))) { calibrate(); await yieldPage(); }
    if (!halfDone && k >= 0.5 && !stopped) { copyMat.uniforms.t.value = pt.target.texture; runPass(copyMat, tH); halfDone = true; info.halfAt = pt.samples; }
    if (!gainDone && (pt.samples >= 8 || stopped || pt.samples >= samples)) { measureGain(filtered(0)); gainDone = true; await yieldPage(); }
    else if (!gainDone && !early && opt.onFrame) { measureGain(filtered(opt.previewFilter)); early = true; info.earlyGain = info.sceneGain; await yieldPage(); }
    if (opt.onFrame && !stopped && pt.samples < samples && (lastFrame === 0 || performance.now() - lastFrame >= Math.max(opt.frameInterval, frameCost * 10))) showFrame(Math.min(0.99, k));
    report('trace', k);
    // the size of the tiles of the next sample, so that one tile takes about tileMs
    if (passTiles) tileTime = passGpu / passTiles;
    passTiles = 0; passGpu = 0;
    if (tileTime > 0) {
      const want = Math.min(24, Math.max(1, Math.round(tiles * Math.sqrt(tileTime / opt.tileMs))));
      if ((tileTime > opt.tileMs * 1.4 || tileTime < opt.tileMs * 0.6) && want !== tiles) { tiles = want; pt.tiles.set(tiles, tiles); info.tilesUsed.push(tiles); }
    }
  };
  // waits for the oldest tile on the GPU; its time is from the later of its sending and the end of the tile before it
  const retire = async () => {
    const e = flight.shift(); await waitFence(e.f, tileTime - (performance.now() - Math.max(e.t, lastDone)));
    const now = performance.now(), dt = now - Math.max(e.t, lastDone); lastDone = now;
    passTiles++; passGpu += dt; winBusy += dt; info.gpuBusy += dt;
  };
  try {
    while (pt.samples < samples && !stopped) {
      checkAbort(signal);
      if (pt.isCompiling || tTrace === 0) {
        pt.update();
        if (pt.isCompiling) { await new Promise(r => setTimeout(r, 30)); continue; }
        // the first tile, sent with the compilation, is waited for and not timed
        await gpuIdle(R); mark('tCompile'); tTrace = passStart = winStart = lastDone = performance.now(); continue;
      }
      const s0 = pt.samples;
      // the path tracer's own target is bound first, so that it does not switch targets between tiles
      R.setRenderTarget(pt._primaryTarget);
      pt.update(); info.tilesSent++;
      flight.push({ f: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), t: performance.now() }); gl.flush();
      if (Math.floor(pt.samples) !== Math.floor(s0)) await atSample();
      if (flight.length >= Math.max(1, opt.inFlight)) await retire();
      // the GPU's share over the last tenth of a second
      const now = performance.now();
      if (now - winStart >= 100) {
        if (winBusy > opt.gpuShare * (now - winStart)) {
          while (flight.length) await retire();
          const rest = winBusy / opt.gpuShare - (performance.now() - winStart);
          if (rest > 0) { info.pauses++; await new Promise(r => setTimeout(r, Math.min(50, rest))); }
          lastDone = performance.now();
        }
        winStart = performance.now(); winBusy = 0;
      }
    }
    while (flight.length) await retire();
  } finally { for (const e of flight) gl.deleteSync(e.f); }
  calibrate();
  if (!gainDone) measureGain(filtered(0));
  await gpuIdle(R);
  info.traceMs = Math.round(performance.now() - tTrace);
  info.samplesTaken = pt.samples;
  info.samplesPerSecond = +(pt.samples / (info.traceMs / 1000)).toFixed(2);
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
    if (hybrid) { opt.debug.farSun = show(tFarB.texture, [0, 0, 0, 0]); opt.debug.farSky = show(tFarB.texture, [1, 0, 0, 0], 0.3); }
  }
  R.toneMapping = THREE.NoToneMapping;
  mark('tTotal');
  info.exposure = exposure;

  // the sky is made for each picture; the scene is kept for the next picture of the same view
  sky.envTex.dispose(); sky.bgTex.dispose(); sky.irrTex.dispose();
  out.info = info;
  report('done', 1);
  if (opt.onFrame) try { opt.onFrame(out, 1); } catch (e) { /* the caller's own error */ }
  return out;
}

// the inner steps, for the test bench
export const _internals = { buildSea, buildSky, collect, buildGeometry, albedoMaterial, guideMaterial, gatherWorld, distantTerrain };
