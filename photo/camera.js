/* ================= the camera: a mode for taking pictures =================
   K raises the camera to the eye and lowers it again. While it is raised the frame is drawn through a lens model:

   - Focal length, 16 to 300 mm in the equivalent of a 35 mm frame, measured across the diagonal, so that the
     field of view at a given focal length is the same whatever the shape of the window.
   - Depth of field from a thin lens. The scene is drawn into a floating-point target with its depth; each pixel's
     circle of confusion follows from the focal length, the f-number and the focus distance
     (c = f^2 (z - s) / (N z (s - f))), and a gather pass spreads each pixel over its circle. Pixels in front of
     the pixel being gathered spread over it freely; those behind it are limited to its own circle, so that what is
     in focus is neither blurred nor haloed by a blurred background. The largest circle in each 16-pixel tile,
     widened to its neighbours, sets how far each pixel looks.
   - Autofocus on what lies under the AF point at the centre of the frame (the nearest surface in it, read back from
     the depth buffer a few times a second and eased in dioptres); or manual focus.
   - Exposure compensation in thirds of a stop, applied before the tone curve.

   When the camera is lowered none of these passes runs, the field of view and the exposure are the game's own and
   the frame is drawn exactly as before: the focal length changes the camera's field of view only for the duration
   of each render and puts it back afterwards.

   ---------- API for picture effects (window.__village.photo) ----------
   photo.capture(opts?) -> Promise<HTMLCanvasElement>
       Takes a picture on the next frame at the full resolution of the drawing buffer, with the depth of field and
       exposure applied when the camera is raised (otherwise the game's own frame), without the viewfinder. The
       canvas carries canvas.photo, the metadata below. Options:
         depth: true    also reads back the linear depth in metres, top row first (meta.depth, Float32Array w*h)
         effects: true  passes the picture through the effect hooks (as the shutter does)
         gallery: true  keeps the picture in the gallery (as the shutter does)
   photo.shoot() -> Promise<HTMLCanvasElement>
       The shutter: a capture with the effect hooks, a flash, and the picture added to the gallery.
   photo.addEffectHook(fn) -> remove()
       fn(canvas, meta) is called on every picture taken with the shutter, in the order added. It may return (or
       resolve to) a canvas, which replaces the picture for the next hook and for the gallery, or nothing to keep it.
   photo.gallery
       The pictures kept, newest last (at most 24): { canvas, meta, time }. photo.download(i) saves one as PNG,
       photo.openGallery() and photo.closeGallery() show and hide the viewer.
   photo.renderer, photo.scene, photo.camera
       The game's renderer, scene and camera. The camera hangs in a group shifted by the floating origin, so its
       world position is camera.position plus meta.origin.
   photo.state
       { on, focal, fNumber, focus, autofocus, ev }; photo.enter(), photo.exit(), photo.toggle(),
       photo.setFocal(mm), photo.setAperture(N), photo.setEV(ev), photo.setFocus(metres | null for autofocus).

   meta = { width, height, time, on, focalLength, fNumber, focusDistance, ev, fov, aspect, near, far,
            projectionMatrix: number[16], matrixWorld: number[16], origin: {x,y,z}, depth?: Float32Array }
*/
import * as THREE from 'three';

const DIAG = Math.hypot(36, 24);   // the diagonal of a 35 mm frame, 43.3 mm
const F_MIN = 16, F_MAX = 300;
const STOPS = [1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22];
const FOCUS_MIN = 0.3, FOCUS_MAX = 2000;
const TILE = 16;
const KEEP = 24;

const VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`;
const DEPTH_FN = `
  uniform float uNear, uFar;
  float linZ(float d){ return uNear*uFar/(uFar-d*(uFar-uNear)); }`;

export function createPhoto({ renderer, scene, camera, canvas, origin, onFov, allowed = () => true }) {
  const S = { on: false, focal: 35, fNumber: 2.8, focus: 5, autofocus: true, ev: 0, afTarget: 5, afT: 0, af: false };
  const gallery = [], hooks = [], pending = [];

  /* ---------- targets ---------- */
  const half = THREE.HalfFloatType;
  const rtScene = new THREE.WebGLRenderTarget(1, 1, { type: half, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) });
  const rtCoc = new THREE.WebGLRenderTarget(1, 1, { type: half, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const rtTile = new THREE.WebGLRenderTarget(1, 1, { type: half, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const rtTileD = new THREE.WebGLRenderTarget(1, 1, { type: half, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const rtGather = new THREE.WebGLRenderTarget(1, 1, { type: half, depthBuffer: false });
  const rtAF = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
  let rtDepth = null;
  const afBuf = new Float32Array(4);

  /* ---------- passes ---------- */
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const postScene = new THREE.Scene(); postScene.add(quad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
  const nearFar = () => ({ uNear: { value: 0.1 }, uFar: { value: 3600 } });

  // colour and signed circle of confusion (radius in pixels; negative in front of the plane of focus)
  const cocU = { tColor: { value: null }, tDepth: { value: null }, uK: { value: 0 }, uFocus: { value: 5 }, uMaxR: { value: 24 }, ...nearFar() };
  const cocMat = pass(`uniform sampler2D tColor, tDepth; uniform float uK, uFocus, uMaxR; varying vec2 vUv; ${DEPTH_FN}
    void main(){
      vec3 c=texture2D(tColor,vUv).rgb;
      float r=clamp(uK*(1.0-uFocus/linZ(texture2D(tDepth,vUv).r)),-uMaxR,uMaxR);
      // a pixel on the edge of something in focus belongs to it: its colour is the antialiased mixture of the two,
      // and blurring it with the background would leave a broken line of the subject's colour round its outline
      vec2 px=1.0/vec2(textureSize(tDepth,0));
      float zn=min(min(linZ(texture2D(tDepth,vUv+vec2(px.x,0.0)).r),linZ(texture2D(tDepth,vUv-vec2(px.x,0.0)).r)),
                   min(linZ(texture2D(tDepth,vUv+vec2(0.0,px.y)).r),linZ(texture2D(tDepth,vUv-vec2(0.0,px.y)).r)));
      float rn=uK*(1.0-uFocus/zn);
      if (abs(rn)<0.75 && r>rn) r=rn;
      // very bright points (the sun on the sea) are tempered a little so that sparse samples do not sparkle
      float l=max(max(c.r,c.g),c.b); c*= l>6.0 ? 6.0/l : 1.0;
      gl_FragColor=vec4(c,r);
    }`, cocU);

  // the largest circle within each tile
  const tileU = { tCoc: { value: null }, uRes: { value: new THREE.Vector2() } };
  const tileMat = pass(`uniform sampler2D tCoc; uniform vec2 uRes; varying vec2 vUv;
    void main(){
      vec2 base=floor(gl_FragCoord.xy)*${TILE}.0; float m=0.0;
      for (int j=0;j<${TILE};j++) for (int i=0;i<${TILE};i++){
        vec2 p=(base+vec2(float(i),float(j))+0.5)/uRes; m=max(m,abs(texture2D(tCoc,p).a)); }
      gl_FragColor=vec4(m,0.0,0.0,1.0);
    }`, tileU);

  // ... widened to the tiles within reach of the largest possible circle
  const dilU = { tTile: { value: null }, uTiles: { value: new THREE.Vector2() } };
  const dilMat = pass(`uniform sampler2D tTile; uniform vec2 uTiles; varying vec2 vUv;
    void main(){
      float m=0.0;
      for (int j=-3;j<=3;j++) for (int i=-3;i<=3;i++){
        vec2 p=(floor(gl_FragCoord.xy)+vec2(float(i),float(j))+0.5)/uTiles;
        if (p.x<0.0||p.y<0.0||p.x>1.0||p.y>1.0) continue;
        float t=texture2D(tTile,p).r;
        // a tile's circles reach only so far: a neighbour counts if its largest circle reaches this tile
        float gap=max(0.0,(max(abs(float(i)),abs(float(j)))-1.0)*${TILE}.0);
        if (t>gap) m=max(m,t); }
      gl_FragColor=vec4(m,0.0,0.0,1.0);
    }`, dilU);

  // the gather: every pixel within reach that spreads over this one, in front kept apart from behind
  const gatherU = { tCoc: { value: null }, tTile: { value: null }, uRes: { value: new THREE.Vector2() }, uDensity: { value: 0.16 }, uMaxN: { value: 160 } };
  const gatherMat = pass(`uniform sampler2D tCoc, tTile; uniform vec2 uRes; uniform float uDensity, uMaxN; varying vec2 vUv;
    const float GA=2.39996323, PI=3.14159265, R1=1.6926;
    float ign(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(0.06711056,0.00583715)))); }
    vec3 B, F; float Wb, Wf, s0, r0, tol;
    // one pixel at distance d, standing for an area A of the disc. A pixel nearer than this one spreads its light
    // evenly over its own circle, and is laid over this pixel by how much of it its circles cover; everything else
    // is gathered over this pixel's own circle only, so that nothing in focus is overlaid by a blurred background,
    // and the edge of something blurred in front lets through the background beside it
    void tap(vec2 o, float d, float A){
      vec4 c=texture2D(tCoc,vUv+o/uRes); float s=c.a, r=abs(s);
      if (s<s0-tol){ float w=clamp(r-d+0.5,0.0,1.0)*A/max(PI*r*r,1.0); F+=c.rgb*w; Wf+=w; }
      else { float w=clamp(r0-d+0.5,0.0,1.0)*A; B+=c.rgb*w; Wb+=w; }
    }
    void main(){
      vec4 c0=texture2D(tCoc,vUv); s0=c0.a; r0=abs(s0);
      float R=max(texture2D(tTile,vUv).r,r0);
      if (R<0.6){ gl_FragColor=vec4(c0.rgb,0.0); return; }
      tol=max(1.0,0.15*r0);
      B=c0.rgb; Wb=1.0; F=vec3(0.0); Wf=0.0;
      // the eight neighbours exactly, then a golden-angle spiral over the rest of the disc, rotated pixel by pixel
      tap(vec2(1,0),1.0,1.0); tap(vec2(-1,0),1.0,1.0); tap(vec2(0,1),1.0,1.0); tap(vec2(0,-1),1.0,1.0);
      tap(vec2(1,1),1.4142,1.0); tap(vec2(-1,1),1.4142,1.0); tap(vec2(1,-1),1.4142,1.0); tap(vec2(-1,-1),1.4142,1.0);
      if (R>R1){
        float area=PI*(R*R-R1*R1), nf=clamp(floor(area*uDensity),8.0,uMaxN); int n=int(nf);
        float A=area/nf, rot=ign(gl_FragCoord.xy)*6.2831853;
        for (int i=0;i<160;i++){
          if (i>=n) break;
          float t=(float(i)+0.5)/nf, d=sqrt(R1*R1+t*(R*R-R1*R1)), a=float(i)*GA+rot;
          tap(vec2(cos(a),sin(a))*d,d,A);
        }
      }
      vec3 bg=Wb>0.0?B/Wb:c0.rgb; float al=clamp(Wf,0.0,1.0);
      // alpha marks the pixels whose sampling noise the last pass smooths: those out of focus, and those partly
      // covered by something blurred in front
      gl_FragColor=vec4(mix(bg, Wf>0.0?F/Wf:bg, al),max(smoothstep(0.5,2.0,r0),smoothstep(0.0,0.12,al*(1.0-al))));
    }`, gatherU);

  // exposure and the game's tone curve, to the screen
  const outU = { tColor: { value: null }, uGain: { value: 1 }, uRes: { value: new THREE.Vector2() } };
  const outMat = new THREE.ShaderMaterial({ uniforms: outU, vertexShader: VERT, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tColor; uniform float uGain; uniform vec2 uRes; varying vec2 vUv;
    void main(){
      vec4 c=texture2D(tColor,vUv); vec3 col=c.rgb;
      if (c.a>0.0){
        // a 3x3 tent over the marked pixels, among marked neighbours only, so that nothing sharp is spread
        vec3 acc=c.rgb*4.0; float ws=4.0;
        for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){
          if (i==0&&j==0) continue;
          vec4 n=texture2D(tColor,vUv+vec2(float(i),float(j))/uRes); float w=(i==0||j==0?2.0:1.0)*n.a; acc+=n.rgb*w; ws+=w; }
        col=mix(c.rgb,acc/ws,c.a);
      }
      gl_FragColor=vec4(col*uGain,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` });

  // autofocus: the nearest surface among points spread over the AF point
  const afU = { tDepth: { value: null }, uBox: { value: new THREE.Vector2(0.02, 0.03) }, ...nearFar() };
  const afMat = pass(`uniform sampler2D tDepth; uniform vec2 uBox; varying vec2 vUv; ${DEPTH_FN}
    void main(){
      float m=1e9;
      for (int j=-3;j<=3;j++) for (int i=-3;i<=3;i++){
        vec2 p=vec2(0.5)+vec2(float(i),float(j))/3.0*uBox; m=min(m,linZ(texture2D(tDepth,p).r)); }
      gl_FragColor=vec4(m,0.0,0.0,1.0);
    }`, afU);

  // linear depth for the effects API
  const depthU = { tDepth: { value: null }, ...nearFar() };
  const depthMat = pass(`uniform sampler2D tDepth; varying vec2 vUv; ${DEPTH_FN}
    void main(){ gl_FragColor=vec4(linZ(texture2D(tDepth,vUv).r),0.0,0.0,1.0); }`, depthU);

  function draw(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(postScene, postCam); }

  /* ---------- the lens ---------- */
  const sensor = aspect => { const h = DIAG / Math.sqrt(1 + aspect * aspect); return { w: h * aspect, h }; };
  const fovFor = (f, aspect) => 2 * Math.atan(sensor(aspect).h / (2 * f)) * 180 / Math.PI;
  let saved = null;
  function lensOn() {
    saved = camera.fov;
    camera.fov = fovFor(S.focal, camera.aspect); camera.updateProjectionMatrix(); onFov && onFov();
  }
  function lensOff() {
    if (saved === null) return;
    camera.fov = saved; saved = null; camera.updateProjectionMatrix(); onFov && onFov();
  }

  const _sz = new THREE.Vector2();
  // draws the frame through the lens; called by the game's renderMain while the camera is raised
  function renderLens() {
    renderer.getDrawingBufferSize(_sz);
    const W = _sz.x, H = _sz.y;
    if (rtScene.width !== W || rtScene.height !== H) {
      rtScene.setSize(W, H); rtCoc.setSize(W, H); rtGather.setSize(W, H);
      const tw = Math.ceil(W / TILE), th = Math.ceil(H / TILE); rtTile.setSize(tw, th); rtTileD.setSize(tw, th);
    }
    renderer.setRenderTarget(rtScene); renderer.render(scene, camera);
    const near = camera.near, far = camera.far;
    for (const U of [cocU, afU, depthU]) { U.uNear.value = near; U.uFar.value = far; }

    // circle of confusion: c = f^2 (z - s) / (N z (s - f)) on the sensor, as a radius in pixels of the frame's width
    const f = S.focal / 1000, s = Math.max(S.focus, f * 1.5), sw = sensor(camera.aspect).w / 1000;
    cocU.uK.value = f * f / (S.fNumber * (s - f)) / sw * W * 0.5;
    cocU.uFocus.value = s;
    cocU.uMaxR.value = clamp(Math.round(H * 0.022), 4, 3 * TILE);
    cocU.tColor.value = rtScene.texture; cocU.tDepth.value = rtScene.depthTexture;
    draw(cocMat, rtCoc);
    tileU.tCoc.value = rtCoc.texture; tileU.uRes.value.set(W, H); draw(tileMat, rtTile);
    dilU.tTile.value = rtTile.texture; dilU.uTiles.value.set(rtTile.width, rtTile.height); draw(dilMat, rtTileD);
    gatherU.tCoc.value = rtCoc.texture; gatherU.tTile.value = rtTileD.texture; gatherU.uRes.value.set(W, H);
    // a picture takes the full count of samples; the viewfinder of a large screen fewer, as many as a 1080-line
    // frame would use for the same blur, and at most 64, the noise being smoothed by the last pass
    const live = !(pendingJob);
    const big = live && H > 1200;
    gatherU.uDensity.value = big ? 0.16 * (1080 / H) * (1080 / H) : 0.16;
    gatherU.uMaxN.value = big ? 64 : 160;
    draw(gatherMat, rtGather);

    // autofocus, read back about eight times a second
    if (S.autofocus && (S.afT -= 1) <= 0) {
      S.afT = 7;
      afU.tDepth.value = rtScene.depthTexture; afU.uBox.value.set(0.022 / camera.aspect, 0.022);
      draw(afMat, rtAF);
      renderer.readRenderTargetPixels(rtAF, 0, 0, 1, 1, afBuf);
      if (afBuf[0] > 0) S.afTarget = clamp(afBuf[0], FOCUS_MIN, FOCUS_MAX);
    }
    if (wantDepth) {
      if (!rtDepth) rtDepth = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
      if (rtDepth.width !== W || rtDepth.height !== H) rtDepth.setSize(W, H);
      depthU.tDepth.value = rtScene.depthTexture; draw(depthMat, rtDepth);
      const buf = new Float32Array(W * H * 4); renderer.readRenderTargetPixels(rtDepth, 0, 0, W, H, buf);
      const out = new Float32Array(W * H);
      for (let y = 0; y < H; y++) { const src = (H - 1 - y) * W * 4, dst = y * W; for (let x = 0; x < W; x++) out[dst + x] = buf[src + x * 4]; }
      depthOut = out;
    }

    outU.tColor.value = rtGather.texture; outU.uGain.value = Math.pow(2, S.ev); outU.uRes.value.set(W, H);
    draw(outMat, null);
    return true;
  }
  let wantDepth = false, depthOut = null, pendingJob = null;

  // a frame of the game: the game's render() is called through here, with the lens in place while the camera is up
  function frame(dt, render) {
    if (S.on) {
      // autofocus eases towards its target in dioptres, as a lens's motor would
      if (S.autofocus) { const a = 1 / S.focus, b = 1 / S.afTarget, k = 1 - Math.exp(-dt * 9); S.focus = 1 / (a + (b - a) * k); }
      S.af = S.autofocus && Math.abs(1 / S.focus - 1 / S.afTarget) < 0.02 + 0.004 * S.fNumber;
      lensOn();
    }
    const job = pendingJob = pending.length ? pending.shift() : null;
    wantDepth = !!(job && job.opts.depth && S.on); depthOut = null;
    try { render(); }
    finally {
      if (job) grab(job);
      wantDepth = false; pendingJob = null;
      lensOff();
    }
    if (S.on) updateViewfinder();
  }

  function grab(job) {
    const src = renderer.domElement, c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    const pm = camera.projectionMatrix.elements.slice(), mw = camera.matrixWorld.elements.slice();
    c.photo = { width: c.width, height: c.height, time: Date.now(), on: S.on, focalLength: S.on ? S.focal : null, fNumber: S.on ? S.fNumber : null,
      focusDistance: S.on ? S.focus : null, ev: S.on ? S.ev : 0, fov: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far,
      projectionMatrix: pm, matrixWorld: mw, origin: origin ? { x: origin.x, y: origin.y, z: origin.z } : { x: 0, y: 0, z: 0 } };
    if (depthOut) c.photo.depth = depthOut;
    job.resolve(c);
  }

  function capture(opts = {}) {
    return new Promise(resolve => pending.push({ opts, resolve })).then(async c => {
      let pic = c;
      if (opts.effects) for (const fn of hooks.slice()) {
        try { const r = await fn(pic, pic.photo); if (r && r.getContext) { if (!r.photo) r.photo = pic.photo; pic = r; } }
        catch (err) { console.warn('A picture effect failed:', err); }
      }
      if (opts.gallery) { gallery.push({ canvas: pic, meta: pic.photo, time: pic.photo.time }); while (gallery.length > KEEP) gallery.shift(); updateCount(); if (!galEl.hidden) buildGallery(); }
      return pic;
    });
  }
  function shoot() { flash(); return capture({ effects: true, gallery: true }); }

  /* ---------- the viewfinder, the flash and the gallery ---------- */
  const css = document.createElement('style');
  css.textContent = `
.vf{position:fixed;inset:0;z-index:3;pointer-events:none;color:#f4efe6;font:500 15px/1 var(--font-body,system-ui);font-variant-numeric:tabular-nums;letter-spacing:.02em;text-shadow:0 1px 2px rgba(0,0,0,.55)}
.vf .fr{position:absolute;inset:4.5% 3.5% calc(4.5% + 34px)}
.vf .fr i{position:absolute;width:26px;height:26px;border:0 solid rgba(244,239,230,.85)}
.vf .fr i:nth-child(1){left:0;top:0;border-width:1.5px 0 0 1.5px}
.vf .fr i:nth-child(2){right:0;top:0;border-width:1.5px 1.5px 0 0}
.vf .fr i:nth-child(3){left:0;bottom:0;border-width:0 0 1.5px 1.5px}
.vf .fr i:nth-child(4){right:0;bottom:0;border-width:0 1.5px 1.5px 0}
.vf .af{position:absolute;left:50%;top:50%;width:4.4vh;height:4.4vh;transform:translate(-50%,-50%);border:1.5px solid rgba(244,239,230,.85);border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.25)}
.vf .af.ok{border-color:#8fe08a}
.vf .af.mf{border-style:dashed}
.vf .bar{position:absolute;left:0;right:0;bottom:0;height:34px;display:flex;align-items:center;justify-content:center;gap:28px;background:rgba(8,10,12,.62);text-shadow:none}
.vf .bar b{font-weight:500}
.vf .bar small{font-size:11px;letter-spacing:.12em;color:#a9b4ad;margin-right:6px}
.vf .ev{display:inline-flex;align-items:center;gap:8px}
.vf .ev s{position:relative;display:inline-block;width:96px;height:8px;text-decoration:none;background:linear-gradient(90deg,rgba(244,239,230,.7) 0 1px,transparent 1px) 0 4px/16px 4px repeat-x}
.vf .ev s::before{content:"";position:absolute;left:48px;top:0;width:1px;height:8px;background:#f4efe6}
.vf .ev s u{position:absolute;top:-3px;width:0;height:0;border:4px solid transparent;border-top-color:#f4efe6;margin-left:-4px}
.shutter{position:fixed;inset:0;z-index:5;pointer-events:none;background:#fff;opacity:0}
.shutter.go{animation:shutterflash .32s ease-out}
@keyframes shutterflash{0%{opacity:.85}100%{opacity:0}}
.gal{position:fixed;z-index:6;inset:16px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box;padding:16px 18px;background:rgba(14,18,22,.94);border:1px solid rgba(245,233,215,.22);border-radius:4px;color:var(--plaster,#f5e9d7);font-family:var(--font-body,system-ui)}
.gal header{display:flex;align-items:center;gap:12px}
.gal h2{margin:0 auto 0 0;font:400 1.2rem var(--font-display,serif);letter-spacing:.04em}
.gal button{font:500 .9rem var(--font-body,system-ui);color:var(--ink,#26232b);background:var(--plaster,#f5e9d7);border:0;border-radius:3px;padding:6px 12px;cursor:pointer}
.gal button:disabled{opacity:.4;cursor:default}
.gal .big{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
.gal .big canvas{max-width:100%;max-height:100%;object-fit:contain;box-shadow:0 4px 20px rgba(0,0,0,.5)}
.gal .info{font-size:.85rem;color:var(--plaster-dim,#d9c8b0);font-variant-numeric:tabular-nums;text-align:center;min-height:1em}
.gal .strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;min-height:74px}
.gal .strip img{height:66px;border:2px solid transparent;border-radius:2px;cursor:pointer;flex:none}
.gal .strip img.sel{border-color:var(--plaster,#f5e9d7)}
.gal .none{margin:auto;color:var(--plaster-dim,#d9c8b0)}
`;
  document.head.appendChild(css);
  const vf = document.createElement('div'); vf.className = 'vf'; vf.hidden = true;
  vf.innerHTML = `<div class="fr"><i></i><i></i><i></i><i></i></div><div class="af"></div>
    <div class="bar"><span><b data-k="focal"></b></span><span><b data-k="fno"></b></span><span><small data-k="mode"></small><b data-k="dist"></b></span>
    <span class="ev"><s><u></u></s><b data-k="ev"></b></span><span><b data-k="count"></b></span></div>`;
  const shutterEl = document.createElement('div'); shutterEl.className = 'shutter';
  const galEl = document.createElement('div'); galEl.className = 'gal'; galEl.hidden = true;
  galEl.setAttribute('role', 'dialog'); galEl.setAttribute('aria-label', 'Pictures');
  galEl.innerHTML = `<header><h2>Pictures</h2><button data-a="dl">Download PNG</button><button data-a="del">Delete</button><button data-a="close">Close</button></header>
    <div class="big"></div><div class="info"></div><div class="strip"></div>`;
  document.body.append(vf, shutterEl, galEl);
  const vfK = k => vf.querySelector(`[data-k="${k}"]`);
  const afEl = vf.querySelector('.af'), evMark = vf.querySelector('.ev u'), vignette = document.querySelector('.vignette');

  const fmtDist = m => m >= 1000 ? '∞' : m < 10 ? m.toFixed(1) + ' m' : Math.round(m) + ' m';
  const fmtEV = ev => (Math.abs(ev) < 0.05 ? '±0.0' : (ev > 0 ? '+' : '−') + Math.abs(ev).toFixed(1)) + ' EV';
  const fmtF = N => 'f/' + (Number.isInteger(N) ? N : N.toFixed(1));
  let lastVF = '';
  function updateViewfinder() {
    const txt = [Math.round(S.focal) + ' mm', fmtF(S.fNumber), S.autofocus ? 'AF' : 'MF', fmtDist(S.focus), fmtEV(S.ev), S.af].join('|');
    if (txt === lastVF) return; lastVF = txt;
    vfK('focal').textContent = Math.round(S.focal) + ' mm';
    vfK('fno').textContent = fmtF(S.fNumber);
    vfK('mode').textContent = S.autofocus ? 'AF' : 'MF';
    vfK('dist').textContent = fmtDist(S.focus);
    vfK('ev').textContent = fmtEV(S.ev);
    evMark.style.left = (48 + S.ev * 16) + 'px';
    afEl.classList.toggle('ok', S.af); afEl.classList.toggle('mf', !S.autofocus);
  }
  function updateCount() { vfK('count').textContent = `[${gallery.length}]`; lastVF = ''; }
  updateCount();
  function flash() { shutterEl.classList.remove('go'); void shutterEl.offsetWidth; shutterEl.classList.add('go'); }

  let sel = -1;
  function buildGallery() {
    const strip = galEl.querySelector('.strip'), big = galEl.querySelector('.big'), info = galEl.querySelector('.info');
    strip.textContent = ''; big.textContent = ''; info.textContent = '';
    if (!gallery.length) { big.innerHTML = '<span class="none">No pictures</span>'; sel = -1; }
    else {
      sel = clamp(sel < 0 ? gallery.length - 1 : sel, 0, gallery.length - 1);
      gallery.forEach((g, i) => {
        if (!g.thumb) { const t = document.createElement('canvas'), h = 132; t.width = Math.round(h * g.canvas.width / g.canvas.height); t.height = h; t.getContext('2d').drawImage(g.canvas, 0, 0, t.width, t.height); g.thumb = t.toDataURL('image/jpeg', 0.8); }
        const im = new Image(); im.src = g.thumb; im.alt = `Picture ${i + 1}`; if (i === sel) im.className = 'sel';
        im.onclick = () => { sel = i; buildGallery(); }; strip.appendChild(im);
      });
      big.appendChild(gallery[sel].canvas);
      const m = gallery[sel].meta;
      info.textContent = `${sel + 1} of ${gallery.length} · ${m.width} × ${m.height}` + (m.on ? ` · ${Math.round(m.focalLength)} mm · ${fmtF(m.fNumber)} · ${fmtDist(m.focusDistance)} · ${fmtEV(m.ev)}` : '');
      strip.querySelector('.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    galEl.querySelector('[data-a="dl"]').disabled = galEl.querySelector('[data-a="del"]').disabled = !gallery.length;
  }
  function openGallery() { if (document.pointerLockElement) document.exitPointerLock(); sel = -1; buildGallery(); galEl.hidden = false; }
  function closeGallery() { galEl.hidden = true; galEl.querySelector('.big').textContent = ''; canvas.focus && canvas.focus(); }
  function download(i = gallery.length - 1) {
    const g = gallery[i]; if (!g) return;
    const d = new Date(g.time), p = n => String(n).padStart(2, '0');
    const name = `coast-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
    g.canvas.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png');
  }
  galEl.addEventListener('click', e => {
    const a = e.target.dataset && e.target.dataset.a; if (!a) return;
    if (a === 'close') closeGallery();
    if (a === 'dl') download(sel);
    if (a === 'del' && sel >= 0) { gallery.splice(sel, 1); sel = Math.min(sel, gallery.length - 1); updateCount(); buildGallery(); }
  });

  /* ---------- controls ---------- */
  function enter() { if (S.on || !allowed()) return; S.on = true; S.afT = 0; S.afTarget = S.focus; vf.hidden = false; if (vignette) vignette.hidden = true; lastVF = ''; updateViewfinder(); }
  function exit() { if (!S.on) return; S.on = false; vf.hidden = true; if (vignette) vignette.hidden = false; }
  function toggle() { S.on ? exit() : enter(); }
  const setFocal = mm => { S.focal = clamp(mm, F_MIN, F_MAX); };
  const setAperture = N => { S.fNumber = STOPS.reduce((a, b) => Math.abs(b - N) < Math.abs(a - N) ? b : a); };
  const stepAperture = d => { const i = STOPS.indexOf(S.fNumber); S.fNumber = STOPS[clamp((i < 0 ? 6 : i) + d, 0, STOPS.length - 1)]; };
  const setEV = ev => { S.ev = clamp(Math.round(ev * 3) / 3, -3, 3); };
  const setFocus = m => { if (m === null || m === undefined) { S.autofocus = true; S.afT = 0; } else { S.autofocus = false; S.focus = clamp(m, FOCUS_MIN, FOCUS_MAX); } };
  const nudgeFocus = k => setFocus(S.focus * k);
  const zoom = k => setFocal(S.focal * k);

  const stop = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  addEventListener('keydown', e => {
    if (!galEl.hidden) {
      if (e.code === 'Escape' || (e.code === 'KeyL' && !e.repeat)) closeGallery();
      else if (e.code === 'ArrowLeft' && sel > 0) { sel--; buildGallery(); }
      else if (e.code === 'ArrowRight' && sel < gallery.length - 1) { sel++; buildGallery(); }
      else if (e.code === 'Tab') return;
      return stop(e);
    }
    if (e.code === 'KeyK') { if (!e.repeat) toggle(); return stop(e); }
    if (e.code === 'KeyL') { if (!e.repeat) openGallery(); return stop(e); }
    if (!S.on) return;
    const c = e.code;
    if (c === 'Enter' || c === 'NumpadEnter') { if (!e.repeat) shoot(); }
    else if (c === 'Equal' || c === 'NumpadAdd') zoom(Math.pow(2, 1 / 8));
    else if (c === 'Minus' || c === 'NumpadSubtract') zoom(Math.pow(2, -1 / 8));
    else if (c === 'BracketLeft') stepAperture(-1);
    else if (c === 'BracketRight') stepAperture(1);
    else if (c === 'Semicolon') setEV(S.ev - 1 / 3);
    else if (c === 'Quote') setEV(S.ev + 1 / 3);
    else if (c === 'Digit9') nudgeFocus(1 / 1.1);
    else if (c === 'Digit0') nudgeFocus(1.1);
    else if (c === 'KeyU') { if (!e.repeat) setFocus(S.autofocus ? S.focus : null); }
    else return;
    stop(e);
  }, true);
  canvas.addEventListener('wheel', e => {
    if (!S.on) return;
    stop(e);
    const d = clamp(e.deltaMode === 1 ? (e.deltaY || e.deltaX) * 33 : (e.deltaY || e.deltaX), -150, 150);
    if (e.shiftKey) nudgeFocus(Math.exp(-d * 0.0015));
    else zoom(Math.exp(-d * 0.0018));
  }, { passive: false, capture: true });
  canvas.addEventListener('mousedown', e => {
    if (S.on && e.button === 0 && document.pointerLockElement === canvas) { shoot(); stop(e); }
  }, true);

  // the mouse turns the view less with a longer lens, so that the subject moves across the frame at the same rate
  const lookScale = () => S.on && saved === null ? Math.tan(fovFor(S.focal, camera.aspect) * Math.PI / 360) / Math.tan(camera.fov * Math.PI / 360) : 1;

  const api = {
    capture, shoot, gallery, renderer, scene, camera, download, openGallery, closeGallery,
    addEffectHook(fn) { hooks.push(fn); return () => { const i = hooks.indexOf(fn); if (i >= 0) hooks.splice(i, 1); }; },
    removeEffectHook(fn) { const i = hooks.indexOf(fn); if (i >= 0) hooks.splice(i, 1); },
    get state() { return { on: S.on, focal: S.focal, fNumber: S.fNumber, focus: S.focus, autofocus: S.autofocus, ev: S.ev, focused: S.af }; },
    enter, exit, toggle, setFocal, setAperture, setEV, setFocus,
  };
  return { get on() { return S.on; }, frame, renderLens, lookScale, api };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
