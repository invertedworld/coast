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
   - The aspect ratio of the frame: the whole space between the controls, or 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 2:3 or
     9:16, fitted within it.
   - A vignette, from off to 100 per cent in tenths, darkening the corners of the frame.
   - The frame is the part of the window inside the crop marks, centred on the lens's axis; the window around it is
     darkened, and a picture holds the frame alone. The focal length sets the field of view of the frame.

   While the camera is raised its controls are on the screen: the zoom, the focus (autofocus or manual, and the
   distance), the aperture and the exposure, each stepped with − and + buttons that repeat while held, the shutter, the
   pictures taken and a button that lowers the camera. The mouse is not captured, so that they can be clicked; a drag
   on the scene turns the view, and the player walks with the usual keys. The gallery and artist mode are in
   photo/gallery.js.

   When the camera is lowered none of these passes runs, the field of view and the exposure are the game's own and
   the frame is drawn exactly as before: the focal length changes the camera's field of view only for the duration
   of each render and puts it back afterwards.

   ---------- API for picture effects (window.__village.photo) ----------
   photo.capture(opts?) -> Promise<HTMLCanvasElement>
       Takes a picture on the next frame at the full resolution of the drawing buffer (when the camera is raised, of
       the frame inside the crop marks), with the depth of field and
       exposure applied when the camera is raised (otherwise the game's own frame), without the viewfinder. The
       canvas carries canvas.photo, the metadata below. Options:
         depth: true    also reads back the linear depth in metres, top row first (meta.depth, Float32Array w*h)
         effects: true  passes the picture through the effect hooks (as the shutter does)
         gallery: true  keeps the picture in the gallery (as the shutter does)
   photo.shoot() -> Promise<HTMLCanvasElement>
       The shutter: a capture with the effect hooks, a flash, and the picture added to the gallery.
       Enter with the camera lowered takes a quick picture of the game's frame in the same way, with the shutter's
       sound and flash.
   photo.addEffectHook(fn) -> remove()
       fn(canvas, meta) is called on every picture taken with the shutter, in the order added. It may return (or
       resolve to) a canvas, which replaces the picture for the next hook and for the gallery, or nothing to keep it.
   photo.gallery
       The photos kept, oldest first (at most 24): { n, canvas, meta, time, works }, where works holds the artworks
       made from the photo in artist mode, { canvas, meta, time, style }, meta.effect naming the style and
       meta.settings its settings. photo.download(i, j?) saves photo i, or its artwork j, as PNG;
       photo.openGallery() and photo.closeGallery() show and hide the gallery; photo.studio is the gallery itself.
   photo.renderer, photo.scene, photo.camera
       The game's renderer, scene and camera. The camera hangs in a group shifted by the floating origin, so its
       world position is camera.position plus meta.origin.
   photo.state
       { on, focal, fNumber, focus, autofocus, ev, vignette, ratio }; photo.enter(), photo.exit(), photo.toggle(),
       photo.setFocal(mm), photo.setAperture(N), photo.setEV(ev), photo.setVignette(0 to 1), photo.setRatio('3:2' | index),
       photo.setFocus(metres | null for autofocus).

   meta = { width, height, time, on, focalLength, fNumber, focusDistance, ev, vignette, fov, aspect, near, far,
            projectionMatrix: number[16], matrixWorld: number[16], origin: {x,y,z}, depth?: Float32Array }
*/
import * as THREE from 'three';
import { createGallery } from './gallery.js';

const DIAG = Math.hypot(36, 24);   // the diagonal of a 35 mm frame, 43.3 mm
const F_MIN = 16, F_MAX = 300;
const STOPS = [1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22];
const FOCUS_MIN = 0.3, FOCUS_MAX = 2000;
const TILE = 16;

const VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`;
const DEPTH_FN = `
  uniform float uNear, uFar;
  float linZ(float d){ return uNear*uFar/(uFar-d*(uFar-uNear)); }`;

export function createPhoto({ renderer, scene, camera, canvas, origin, onFov, allowed = () => true, onShutter = null, quickOk = null }) {
  const S = { on: false, focal: 35, fNumber: 2.8, focus: 5, autofocus: true, ev: 0, vignette: 0, ratio: 0, afTarget: 5, afT: 0, af: false };
  // the frame within the window, as fractions of its width and height, centred; set from the viewfinder's layout
  const FR = { x: 1, y: 1 };
  // the shapes of the frame: the whole of the space between the controls, or a fixed ratio of width to height
  const RATIOS = [['Full', 0], ['16:9', 16 / 9], ['3:2', 3 / 2], ['4:3', 4 / 3], ['5:4', 5 / 4], ['1:1', 1], ['4:5', 4 / 5], ['2:3', 2 / 3], ['9:16', 9 / 16]];
  const hooks = [], pending = [];

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
  const outU = { tColor: { value: null }, uGain: { value: 1 }, uRes: { value: new THREE.Vector2() }, uVig: { value: 0 }, uFrame: { value: new THREE.Vector2(1, 1) } };
  const outMat = new THREE.ShaderMaterial({ uniforms: outU, vertexShader: VERT, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tColor; uniform float uGain; uniform vec2 uRes; uniform float uVig; uniform vec2 uFrame; varying vec2 vUv;
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
      // the vignette: the light falls away towards the corners of the frame, as through a lens
      vec2 fp=(vUv-0.5)*2.0/uFrame; float fa=uRes.x*uFrame.x/(uRes.y*uFrame.y);
      float d=length(fp*vec2(fa,1.0))/length(vec2(fa,1.0));
      float vig=1.0-uVig*0.85*smoothstep(0.15,1.0,d)*(0.5+0.5*d);
      gl_FragColor=vec4(col*uGain,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb*=vig;
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
  // the focal length gives the field of view of the frame inside the crop marks; the window shows more around it
  const frameAspect = () => camera.aspect * FR.x / FR.y;
  const frameFov = () => fovFor(S.focal, frameAspect());
  const lensFov = () => 2 * Math.atan(Math.tan(frameFov() * Math.PI / 360) / FR.y) * 180 / Math.PI;
  let saved = null;
  function lensOn() {
    saved = camera.fov;
    camera.fov = lensFov(); camera.updateProjectionMatrix(); onFov && onFov();
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
    const f = S.focal / 1000, s = Math.max(S.focus, f * 1.5), sw = sensor(frameAspect()).w / 1000;
    cocU.uK.value = f * f / (S.fNumber * (s - f)) / sw * W * FR.x * 0.5;
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

    outU.tColor.value = rtGather.texture; outU.uGain.value = Math.pow(2, S.ev); outU.uRes.value.set(W, H); outU.uVig.value = S.vignette; outU.uFrame.value.set(FR.x, FR.y);
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
    // a picture taken through the lens is the frame inside the crop marks; otherwise the whole of the game's frame
    const crop = S.on && saved !== null, W = src.width, H = src.height;
    const cw = crop ? Math.round(W * FR.x) : W, ch = crop ? Math.round(H * FR.y) : H, x0 = (W - cw) >> 1, y0 = (H - ch) >> 1;
    c.width = cw; c.height = ch;
    c.getContext('2d').drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
    let fov = camera.fov, aspect = camera.aspect, pm = camera.projectionMatrix.elements.slice();
    if (crop) { fov = frameFov(); aspect = cw / ch; const fc = new THREE.PerspectiveCamera(fov, aspect, camera.near, camera.far); pm = fc.projectionMatrix.elements.slice(); }
    const mw = camera.matrixWorld.elements.slice();
    c.photo = { width: c.width, height: c.height, time: Date.now(), on: S.on, focalLength: S.on ? S.focal : null, fNumber: S.on ? S.fNumber : null,
      focusDistance: S.on ? S.focus : null, ev: S.on ? S.ev : 0, vignette: S.on ? S.vignette : 0, fov, aspect, near: camera.near, far: camera.far,
      projectionMatrix: pm, matrixWorld: mw, origin: origin ? { x: origin.x, y: origin.y, z: origin.z } : { x: 0, y: 0, z: 0 } };
    if (depthOut && crop) { const d = new Float32Array(cw * ch); for (let y = 0; y < ch; y++) d.set(depthOut.subarray((y + y0) * W + x0, (y + y0) * W + x0 + cw), y * cw); depthOut = d; }
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
      if (opts.gallery) G.add(pic);
      return pic;
    });
  }
  function quickShot() { flash(); if (onShutter) try { onShutter(); } catch (e) { /* the host's own sound */ } return capture({ effects: true, gallery: true }).then(c => { setRoll(c); return c; }); }
  function shoot() { flash(); if (onShutter) try { onShutter(); } catch (e) { /* the host's own sound */ } return capture({ effects: true, gallery: true }).then(c => { setRoll(c); return c; }); }

  /* ---------- the controls on the screen: the lens, the shutter, the pictures and the way out ---------- */
  const css = document.createElement('style');
  css.textContent = `
.cam{position:fixed;inset:0;z-index:3;pointer-events:none;color:var(--plaster,#f5e9d7);font:500 15px/1 var(--font-body,system-ui);font-variant-numeric:lining-nums tabular-nums;--deck:96px}
.cam button{pointer-events:auto;font:inherit;color:inherit;border:0;margin:0;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;user-select:none}
.cam svg{display:block;width:100%;height:100%}
.cam .fr{position:absolute;inset:76px 3.5% calc(var(--deck) + 28px);box-shadow:0 0 0 200vmax rgba(6,8,11,.6)}
.cam .fr i{position:absolute;width:26px;height:26px;border:0 solid rgba(244,239,230,.8)}
.cam .fr i:nth-child(1){left:0;top:0;border-width:1.5px 0 0 1.5px}
.cam .fr i:nth-child(2){right:0;top:0;border-width:1.5px 1.5px 0 0}
.cam .fr i:nth-child(3){left:0;bottom:0;border-width:0 0 1.5px 1.5px}
.cam .fr i:nth-child(4){right:0;bottom:0;border-width:0 1.5px 1.5px 0}
.cam .af{position:absolute;left:50%;top:50%;width:4.4vh;height:4.4vh;transform:translate(-50%,-50%);border:1.5px solid rgba(244,239,230,.85);border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.25)}
.cam .af.ok{border-color:#8fe08a}
.cam .af.mf{border-style:dashed}
.cam .exit{position:absolute;top:16px;right:16px;width:44px;height:44px;padding:11px;border-radius:50%;background:rgba(10,14,18,.6);box-shadow:0 0 0 1px rgba(245,233,215,.18)}
.cam .exit:hover{background:rgba(10,14,18,.8)}
.cam .rail{position:absolute;right:16px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:22px;padding:14px 10px;border-radius:44px;background:rgba(10,14,18,.5)}
.cam .shut{width:72px;height:72px;border-radius:50%;padding:0;background:transparent;box-shadow:inset 0 0 0 3px #f5e9d7;display:grid;place-items:center}
.cam .shut i{display:block;width:56px;height:56px;border-radius:50%;background:#f5e9d7;transition:transform .08s,background .08s}
.cam .shut:hover i{background:#fff}
.cam .shut:active i{transform:scale(.88)}
.cam .roll{position:relative;width:52px;height:52px;padding:0;border-radius:8px;background:rgba(245,233,215,.12) center/cover no-repeat;box-shadow:0 0 0 1.5px rgba(245,233,215,.55)}
.cam .roll svg{width:24px;height:24px;margin:auto;opacity:.75}
.cam .roll.has svg{display:none}
.cam .roll b{position:absolute;right:-7px;bottom:-7px;min-width:22px;height:22px;padding:0 5px;box-sizing:border-box;border-radius:11px;background:var(--verdigris,#7cc3ad);color:var(--ink,#26232b);font:600 .78rem/22px var(--font-body,system-ui);text-align:center}
.cam .roll b:empty{display:none}
.cam .deck{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:stretch;padding:10px 8px;border-radius:14px;background:rgba(10,14,18,.62);box-shadow:0 0 0 1px rgba(245,233,215,.1)}
.cam .dial{display:flex;flex-direction:column;align-items:center;gap:8px;padding:0 14px;min-width:150px;box-sizing:border-box}
.cam .dial+.dial{border-left:1px solid rgba(245,233,215,.14)}
.cam .dial small{display:flex;align-items:center;gap:8px;height:20px;font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:var(--verdigris,#7cc3ad)}
.cam .dial .row{display:flex;align-items:center;gap:6px}
.cam .dial b{min-width:72px;text-align:center;font-weight:500;font-size:1.12rem;letter-spacing:.02em}
.cam .step{width:34px;height:34px;padding:8px;border-radius:50%;background:rgba(245,233,215,.1)}
.cam .step:hover{background:rgba(245,233,215,.2)}
.cam .step:active{background:rgba(245,233,215,.3)}
.cam .dial s{position:relative;display:block;width:100%;height:3px;border-radius:2px;background:rgba(245,233,215,.18);text-decoration:none}
.cam .dial s u{position:absolute;top:-3px;width:3px;height:9px;margin-left:-1.5px;border-radius:1.5px;background:#f5e9d7}
.cam .dial.ev s::before{content:"";position:absolute;left:50%;top:-2px;width:1px;height:7px;background:rgba(245,233,215,.6)}
.cam .mode{height:20px;padding:0 7px;border-radius:10px;background:rgba(245,233,215,.12);font-size:.68rem;letter-spacing:.1em;color:var(--plaster-dim,#d9c8b0)}
.cam .mode.on{background:var(--verdigris,#7cc3ad);color:var(--ink,#26232b)}
.cam .af-dist.mf{color:#ffe7b0}
@media (max-width:860px){
  .cam{--deck:150px}
  .cam .deck{left:8px;right:96px;bottom:8px;transform:none;display:grid;grid-template-columns:1fr 1fr;gap:12px 0;padding:10px 4px}
  .cam .dial{min-width:0;padding:0 8px}
  .cam .dial:nth-child(3){border-left:0}
  .cam .dial b{min-width:58px;font-size:1rem}
  .cam .rail{right:8px;top:auto;bottom:8px;transform:none;padding:10px 6px}
  .cam .shut{width:62px;height:62px} .cam .shut i{width:48px;height:48px}
  .cam .fr{inset:72px 3.5% calc(var(--deck) + 20px) 3.5%}
}
.shutter{position:fixed;inset:0;z-index:5;pointer-events:none;background:#fff;opacity:0}
.shutter.go{animation:shutterflash .32s ease-out}
@keyframes shutterflash{0%{opacity:.85}100%{opacity:0}}
`;
  document.head.appendChild(css);
  const ic = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const MINUS = ic('<path d="M6 12h12"/>'), PLUS = ic('<path d="M6 12h12M12 6v12"/>');
  const dial = (k, label, dn, up, tdn, tup, extra = '') => `<div class="dial ${k}"><small>${label}${extra}</small>
    <div class="row"><button class="step" data-c="${dn}" title="${tdn}" aria-label="${tdn}">${MINUS}</button><b data-k="${k}"></b><button class="step" data-c="${up}" title="${tup}" aria-label="${tup}">${PLUS}</button></div><s><u data-m="${k}"></u></s></div>`;
  const hud = document.createElement('div'); hud.className = 'cam'; hud.hidden = true;
  hud.innerHTML = `<div class="fr"><i></i><i></i><i></i><i></i></div><div class="af"></div>
    <button class="exit" data-c="exit" title="Leave the camera (K)" aria-label="Leave the camera">${ic('<path d="M6 6l12 12M18 6L6 18"/>')}</button>
    <div class="rail"><button class="shut" data-c="shoot" title="Take a picture (Enter)" aria-label="Take a picture"><i></i></button>
      <button class="roll" data-c="gallery" title="Gallery (G)" aria-label="Gallery">${ic('<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="M3.5 15.5l5-4.5 4 3.5 3-2.5 5 4"/>')}<b></b></button></div>
    <div class="deck">${dial('focal', 'Zoom', 'zoom-', 'zoom+', 'Wider (−)', 'Longer (+)')}
      ${dial('focus', 'Focus', 'near', 'far', 'Nearer (9)', 'Further (0)', '<button class="mode" data-c="af" title="Autofocus or manual focus (U)">AF</button>')}
      ${dial('fno', 'Aperture', 'open', 'close', 'Wider aperture ([)', 'Narrower aperture (])')}
      ${dial('ev', 'Exposure', 'ev-', 'ev+', 'Darker (;)', "Brighter (')")}
      ${dial('ratio', 'Aspect ratio', 'ratio-', 'ratio+', 'Previous shape (T with Shift)', 'Next shape (T)')}
      ${dial('vig', 'Vignette', 'vig-', 'vig+', 'Less vignette (,)', 'More vignette (.)')}</div>`;
  const shutterEl = document.createElement('div'); shutterEl.className = 'shutter';
  document.body.append(hud, shutterEl);
  const vfK = k => hud.querySelector(`[data-k="${k}"]`), vfM = k => hud.querySelector(`[data-m="${k}"]`);
  const afEl = hud.querySelector('.af'), modeEl = hud.querySelector('.mode'), rollEl = hud.querySelector('.roll'), deckEl = hud.querySelector('.deck');
  const vignette = document.querySelector('.vignette');

  const G = createGallery({ renderer, scene, camera, origin, onClose: () => { canvas.focus && canvas.focus(); }, onLoad: () => setRoll() });
  function setRoll(c) {
    const n = G.photos.length; rollEl.querySelector('b').textContent = n ? String(n) : '';
    const p = G.photos[n - 1]; rollEl.classList.toggle('has', !!p);
    if (!p) { rollEl.style.backgroundImage = ''; return; }
    if (!p.roll) { const t = document.createElement('canvas'), h = 104; t.width = Math.round(h * p.canvas.width / p.canvas.height); t.height = h; t.getContext('2d').drawImage(p.canvas, 0, 0, t.width, t.height); p.roll = t.toDataURL('image/jpeg', 0.8); }
    rollEl.style.backgroundImage = `url(${p.roll})`;
  }

  const fmtDist = m => m >= 1000 ? '∞' : m < 10 ? m.toFixed(1) + ' m' : Math.round(m) + ' m';
  const fmtEV = ev => (Math.abs(ev) < 0.05 ? '±0.0' : (ev > 0 ? '+' : '−') + Math.abs(ev).toFixed(1)) + ' EV';
  const fmtF = N => 'f/' + (Number.isInteger(N) ? N : N.toFixed(1));
  const logPos = (v, a, b) => clamp(Math.log(v / a) / Math.log(b / a), 0, 1);
  let lastVF = '';
  function updateViewfinder() {
    const txt = [Math.round(S.focal), S.fNumber, S.autofocus, fmtDist(S.focus), S.ev, S.vignette, S.ratio, S.af, G.photos.length].join('|');
    if (txt === lastVF) return; lastVF = txt;
    vfK('focal').textContent = Math.round(S.focal) + ' mm'; vfM('focal').style.left = logPos(S.focal, F_MIN, F_MAX) * 100 + '%';
    vfK('fno').textContent = fmtF(S.fNumber); vfM('fno').style.left = STOPS.indexOf(S.fNumber) / (STOPS.length - 1) * 100 + '%';
    vfK('focus').textContent = fmtDist(S.focus); vfM('focus').style.left = logPos(S.focus, FOCUS_MIN, 1000) * 100 + '%';
    vfK('ev').textContent = fmtEV(S.ev); vfM('ev').style.left = (S.ev + 3) / 6 * 100 + '%';
    vfK('ratio').textContent = RATIOS[S.ratio][0]; vfM('ratio').style.left = S.ratio / (RATIOS.length - 1) * 100 + '%';
    vfK('vig').textContent = S.vignette ? Math.round(S.vignette * 100) + ' %' : 'Off'; vfM('vig').style.left = S.vignette * 100 + '%';
    modeEl.textContent = S.autofocus ? 'AF' : 'MF'; modeEl.classList.toggle('on', S.autofocus);
    afEl.classList.toggle('ok', S.af); afEl.classList.toggle('mf', !S.autofocus);
  }
  function flash() { shutterEl.classList.remove('go'); void shutterEl.offsetWidth; shutterEl.classList.add('go'); }

  /* ---------- controls ---------- */
  // the crop marks stand an equal distance from the top and the foot of the window, clear of the controls, so that
  // the frame is centred on the lens's axis
  const frEl = hud.querySelector('.fr');
  function layoutFrame() {
    hud.style.setProperty('--deck', deckEl.offsetHeight + 'px');
    const W = innerWidth, H = innerHeight, narrow = W <= 860;
    const side = Math.round(W * 0.035), v = Math.min(Math.round(H * 0.3), Math.max(narrow ? 72 : 76, deckEl.offsetHeight + (narrow ? 20 : 28)));
    let fw = W - 2 * side, fh = H - 2 * v; const r = RATIOS[S.ratio][1];
    if (r) { if (fw / fh > r) fw = fh * r; else fh = fw / r; }
    frEl.style.inset = `${(H - fh) / 2}px ${(W - fw) / 2}px`;
    FR.x = fw / W; FR.y = fh / H;
  }
  function enter() {
    if (S.on || !allowed()) return; S.on = true; S.afT = 0; S.afTarget = S.focus;
    if (document.pointerLockElement) document.exitPointerLock();
    hud.hidden = false; if (vignette) vignette.hidden = true; lastVF = ''; setRoll(); updateViewfinder();
    layoutFrame();
  }
  function exit() { if (!S.on) return; S.on = false; release(); hud.hidden = true; if (vignette) vignette.hidden = false; }
  function toggle() { S.on ? exit() : enter(); }
  function openGallery() { release(); G.open(); }
  const setFocal = mm => { S.focal = clamp(mm, F_MIN, F_MAX); };
  const setAperture = N => { S.fNumber = STOPS.reduce((a, b) => Math.abs(b - N) < Math.abs(a - N) ? b : a); };
  const stepAperture = d => { const i = STOPS.indexOf(S.fNumber); S.fNumber = STOPS[clamp((i < 0 ? 6 : i) + d, 0, STOPS.length - 1)]; };
  const setEV = ev => { S.ev = clamp(Math.round(ev * 3) / 3, -3, 3); };
  const setRatio = i => { S.ratio = clamp(Math.round(i), 0, RATIOS.length - 1); if (S.on) layoutFrame(); };
  const setVignette = v => { S.vignette = clamp(Math.round(v * 10) / 10, 0, 1); };
  const setFocus = m => { if (m === null || m === undefined) { S.autofocus = true; S.afT = 0; } else { S.autofocus = false; S.focus = clamp(m, FOCUS_MIN, FOCUS_MAX); } };
  const nudgeFocus = k => setFocus(S.focus * k);
  const zoom = k => setFocal(S.focal * k);
  const ZOOM = Math.pow(2, 1 / 8);
  // the buttons that step a setting repeat while held: at once, then after 0.4 s every 70 ms (the aperture and the
  // exposure, whose steps are coarse, every 160 ms)
  const STEP = { 'zoom-': () => zoom(1 / ZOOM), 'zoom+': () => zoom(ZOOM), near: () => nudgeFocus(1 / 1.1), far: () => nudgeFocus(1.1),
    open: () => stepAperture(-1), close: () => stepAperture(1), 'ev-': () => setEV(S.ev - 1 / 3), 'ev+': () => setEV(S.ev + 1 / 3),
    'ratio-': () => setRatio(S.ratio - 1), 'ratio+': () => setRatio(S.ratio + 1), 'vig-': () => setVignette(S.vignette - 0.1), 'vig+': () => setVignette(S.vignette + 0.1) };
  let held = null;
  function release() { if (held) { clearTimeout(held.t); held = null; } }
  hud.addEventListener('mousedown', e => e.preventDefault());   // the controls never take the keyboard's focus
  hud.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-c]'); if (!b || e.button > 0) return;
    const c = b.dataset.c, fn = STEP[c]; if (!fn) return;
    e.preventDefault(); release(); fn(); updateViewfinder();
    const every = c === 'open' || c === 'close' || c === 'ev-' || c === 'ev+' || c === 'vig-' || c === 'vig+' ? 160 : c === 'ratio-' || c === 'ratio+' ? 300 : 70;
    const tick = () => { fn(); updateViewfinder(); held.t = setTimeout(tick, every); };
    held = { t: setTimeout(tick, 400) };
  });
  for (const t of ['pointerup', 'pointercancel', 'blur']) addEventListener(t, release);
  hud.addEventListener('pointerout', e => { if (held && e.target.closest('[data-c]') && !e.target.closest('[data-c]').contains(e.relatedTarget)) release(); });
  hud.addEventListener('click', e => {
    const c = e.target.closest('[data-c]')?.dataset.c; if (!c) return;
    if (c === 'shoot') shoot();
    else if (c === 'exit') exit();
    else if (c === 'gallery') openGallery();
    else if (c === 'af') { setFocus(S.autofocus ? S.focus : null); updateViewfinder(); }
  });

  const stop = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  addEventListener('keydown', e => {
    if (!e.isTrusted) return;   // keys the program presses for itself (the path tracer's draw distance) pass through
    if (G.handleKey(e)) return;
    if (e.code === 'KeyK') { if (!e.repeat) toggle(); return stop(e); }
    if (e.code === 'KeyL' || e.code === 'KeyG') { if (!e.repeat) openGallery(); return stop(e); }
    // Enter with the camera lowered takes a quick picture of the game's own frame, with the shutter's sound and flash
    // and no viewfinder (not while a field or a panel has the keyboard)
    if (!S.on && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
      const el = document.activeElement, busy = el && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName) || (quickOk && !quickOk());
      if (busy || !allowed()) return;
      if (!e.repeat) quickShot(); return stop(e); }
    if (!S.on) return;
    const c = e.code;
    if (c === 'Escape') exit();
    else if (c === 'Enter' || c === 'NumpadEnter') { if (!e.repeat) shoot(); }
    else if (c === 'Equal' || c === 'NumpadAdd') zoom(ZOOM);
    else if (c === 'Minus' || c === 'NumpadSubtract') zoom(1 / ZOOM);
    else if (c === 'BracketLeft') stepAperture(-1);
    else if (c === 'BracketRight') stepAperture(1);
    else if (c === 'Semicolon') setEV(S.ev - 1 / 3);
    else if (c === 'Quote') setEV(S.ev + 1 / 3);
    else if (c === 'KeyT') { if (!e.repeat) setRatio((S.ratio + (e.shiftKey ? RATIOS.length - 1 : 1)) % RATIOS.length); }
    else if (c === 'Comma') setVignette(S.vignette - 0.1);
    else if (c === 'Period') setVignette(S.vignette + 0.1);
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
  addEventListener('resize', () => { if (S.on) layoutFrame(); });

  // the mouse turns the view less with a longer lens, so that the subject moves across the frame at the same rate
  const lookScale = () => S.on && saved === null ? Math.tan(lensFov() * Math.PI / 360) / Math.tan(camera.fov * Math.PI / 360) : 1;

  const api = {
    capture, shoot, renderer, scene, camera, openGallery, closeGallery: () => G.close(),
    get gallery() { return G.photos; }, studio: G,
    download(i = G.photos.length - 1, j = null) { const p = G.photos[i]; if (p) G.download(j == null ? p : p.works[j]); },
    addEffectHook(fn) { hooks.push(fn); return () => { const i = hooks.indexOf(fn); if (i >= 0) hooks.splice(i, 1); }; },
    removeEffectHook(fn) { const i = hooks.indexOf(fn); if (i >= 0) hooks.splice(i, 1); },
    get state() { return { on: S.on, focal: S.focal, fNumber: S.fNumber, focus: S.focus, autofocus: S.autofocus, ev: S.ev, vignette: S.vignette, ratio: RATIOS[S.ratio][0], focused: S.af }; },
    enter, exit, toggle, setFocal, setAperture, setEV, setFocus, setVignette, setRatio: k => setRatio(typeof k === 'string' ? RATIOS.findIndex(q => q[0] === k) : k),
  };
  return { get on() { return S.on; }, frame, renderLens, lookScale, api };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
