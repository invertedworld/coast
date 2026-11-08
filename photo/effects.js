/* Picture effects for photographs taken in the village.

   applyEffect(name, source, opts) -> Promise<HTMLCanvasElement>
     name    'watercolour', 'oil', 'impressionist' or 'charcoal'
     source  an HTMLCanvasElement, HTMLImageElement or ImageBitmap holding the picture
     opts    seed (a number, for the random parts), and per-effect settings listed with each effect below
             (opts.debug names an intermediate stage to return instead, for the testbench)
             onFrame(canvas, progress): when given, the picture is shown being made. The effect's own canvas,
               holding the picture so far, is passed after every frame with progress from 0 to 1 (it may return
               a promise, which is awaited); the last call has progress 1 and shows exactly the picture that is
               returned. The canvas must be copied or drawn from during the call, as the next frame replaces it.
             duration: length of the progressive display in milliseconds (default 6000), paced by the display
             signal: an AbortSignal; aborting stops the display and rejects the promise with an AbortError
             steps: instead of real time, a fixed number of evenly spaced frames, for recording

   pathTrace({renderer, scene, camera, samples, onProgress, ...}) -> Promise<HTMLCanvasElement>
     re-renders the scene from the camera with a progressive path tracer on the GPU; see photo/pathtrace.js

   The painted effects run as full-screen passes in a WebGL2 context of their own, so they never disturb the
   game's renderer. Image values are kept in sRGB throughout, which is closer to how paint mixes on paper and
   canvas than linear light is. Sizes are given in pixels of a picture 800 pixels high and scaled with the
   picture. */
import * as THREE from 'three';

export const EFFECTS = ['watercolour', 'oil', 'impressionist', 'charcoal'];

/* ---------- the private GL context and full-screen passes ---------- */
let G = null;
function ctx() {
  if (G) return G;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; renderer.autoClear = false;
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null); quad.frustumCulled = false; scene.add(quad);
  G = { renderer, scene, cam, quad, mats: new Map(), pool: [] };
  return G;
}

const VERT = `in vec3 position; in vec2 uv; out vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`;

// helpers shared by every fragment shader
const LIB = `precision highp float; precision highp int;
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uS; uniform float uSeed; uniform float uT;
// progressive display: 0 when a part of the picture has not been laid yet, 1 once it has. A part laid between
// t0 and t1 arrives at a moment set by ord (0 to 1), fading in over the last 30 per cent of its span; at the
// end (uT = 1) everything is laid, so the last frame is exactly the static picture
float reveal(float t0, float t1, float ord){ if (uT>=1.0) return 1.0; float f=0.3*(t1-t0); float tt=t0+(t1-t0-f)*clamp(ord,0.0,1.0); return clamp((uT-tt)/f,0.0,1.0); }
#define PI 3.14159265
float lum(vec3 c){ return dot(c,vec3(0.299,0.587,0.114)); }
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for (int i=0;i<5;i++){ s+=a*vnoise(p); p=mat2(1.6,1.2,-1.2,1.6)*p+17.1; a*=0.5; } return s/0.97; }
float fbm3(vec2 p){ float a=0.5, s=0.0; for (int i=0;i<3;i++){ s+=a*vnoise(p); p=mat2(1.6,1.2,-1.2,1.6)*p+17.1; a*=0.5; } return s/0.875; }
// distance to the nearest of a jittered grid of points, and to the second nearest
vec2 worley(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=8.0, d2=8.0;
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){ vec2 g=vec2(x,y), o=hash22(i+g); float d=length(g+o-f);
    if (d<d1){ d2=d1; d1=d; } else if (d<d2) d2=d; }
  return vec2(d1,d2); }
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.0,-1.0/3.0,2.0/3.0,-1.0); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
  vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1.0e-10;
  return vec3(abs(q.z+(q.w-q.y)/(6.0*d+e)),d/(q.x+e),q.x); }
vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0); return c.z*mix(vec3(1.0),clamp(p-1.0,0.0,1.0),c.y); }
`;

function material(frag) {
  const g = ctx();
  let m = g.mats.get(frag);
  if (!m) {
    m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: LIB + frag, uniforms: {},
      depthTest: false, depthWrite: false });
    g.mats.set(frag, m);
  }
  return m;
}

function target(w, h, type = THREE.HalfFloatType) {
  return new THREE.WebGLRenderTarget(w, h, { type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false });
}

// one full-screen pass: frag is the shader body, U its uniforms (textures may be render targets), out a target or null
function pass(frag, U, out, size) {
  const g = ctx(), m = material(frag);
  const w = out ? out.width : size.w, h = out ? out.height : size.h;
  // three.js keeps the uniforms object a material was compiled with, so the values are changed in place
  const set = (k, v) => { if (v && v.isWebGLRenderTarget) v = v.texture; if (m.uniforms[k]) m.uniforms[k].value = v; else m.uniforms[k] = { value: v }; };
  set('uRes', new THREE.Vector2(w, h)); set('uS', h / 800); set('uSeed', U.uSeed ?? 0); set('uT', U.uT ?? 1);
  for (const k in U) set(k, U[k]);
  g.quad.material = m;
  g.renderer.setRenderTarget(out || null);
  if (!out) g.renderer.setSize(w, h, false);
  g.renderer.render(g.scene, g.cam);
  return out;
}

function sourceTexture(src) {
  const t = new THREE.Texture(src);
  t.colorSpace = THREE.NoColorSpace; t.flipY = true; t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

function toCanvas(w, h) {
  const g = ctx(), c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(g.renderer.domElement, 0, 0);
  return c;
}

const size = src => ({ w: src.naturalWidth || src.videoWidth || src.width, h: src.naturalHeight || src.videoHeight || src.height });

/* ---------- shared passes: structure tensor, smoothing, anisotropic Kuwahara, line integral convolution ---------- */
// the structure tensor of the picture from Sobel derivatives of each channel: (E, F, G)
const ST = `uniform sampler2D tSrc;
void main(){ vec2 d=1.0/uRes;
  vec3 a=texture(tSrc,vUv+d*vec2(-1,-1)).rgb, b=texture(tSrc,vUv+d*vec2(0,-1)).rgb, c=texture(tSrc,vUv+d*vec2(1,-1)).rgb;
  vec3 e=texture(tSrc,vUv+d*vec2(-1,0)).rgb, f=texture(tSrc,vUv+d*vec2(1,0)).rgb;
  vec3 g=texture(tSrc,vUv+d*vec2(-1,1)).rgb, h=texture(tSrc,vUv+d*vec2(0,1)).rgb, i=texture(tSrc,vUv+d*vec2(1,1)).rgb;
  vec3 gx=(c+2.0*f+i-a-2.0*e-g)*0.25, gy=(g+2.0*h+i-a-2.0*b-c)*0.25;
  fragColor=vec4(dot(gx,gx),dot(gx,gy),dot(gy,gy),1.0); }`;

// a separable Gaussian blur along uDir, of standard deviation uSigma pixels
const BLUR = `uniform sampler2D tSrc; uniform vec2 uDir; uniform float uSigma;
void main(){ float s=max(uSigma,0.3); int r=int(ceil(2.5*s)); vec4 acc=vec4(0.0); float wsum=0.0;
  for (int i=-r;i<=r;i++){ float w=exp(-float(i*i)/(2.0*s*s)); acc+=w*texture(tSrc,vUv+uDir*float(i)/uRes); wsum+=w; }
  fragColor=acc/wsum; }`;

// the local orientation from the smoothed tensor: tangent (along edges), its angle, and the anisotropy
const TFM = `uniform sampler2D tSrc; uniform float uFlat, uDrift;
void main(){ vec3 g=texture(tSrc,vUv).xyz; float E=g.x, F=g.y, G=g.z;
  float D=sqrt(max(0.0,(E-G)*(E-G)+4.0*F*F)); float l1=0.5*(E+G+D), l2=0.5*(E+G-D);
  vec2 t=vec2(l1-E,-F); t = length(t)>1e-12 ? normalize(t) : vec2(0.0,1.0);
  float A = l1+l2>1e-12 ? (l1-l2)/(l1+l2) : 0.0;
  // where the picture is flat the tensor's direction is noise: there the field drifts slowly about the horizontal
  vec2 p=vUv*uRes/uS; float a=(fbm3(p*0.003+uSeed+40.0)-0.5)*2.2*uDrift; vec2 nd=vec2(cos(a),sin(a));
  float k=smoothstep(uFlat*0.3,uFlat,sqrt(l1));
  if (dot(nd,t)<0.0) t=-t;
  t=normalize(mix(nd,t,k)+1e-6); A*=k;
  fragColor=vec4(t,atan(t.y,t.x),A); }`;

// the anisotropic Kuwahara filter with polynomial weights (Kyprianidis, Kang and Döllner)
const AKF = `uniform sampler2D tSrc, tTfm; uniform float uRadius, uQ, uAlpha;
void main(){
  vec4 t=texture(tTfm,vUv); float r=uRadius;
  float a=r*clamp((uAlpha+t.w)/uAlpha,0.1,2.0), b=r*clamp(uAlpha/(uAlpha+t.w),0.1,2.0);
  float cp=cos(t.z), sp=sin(t.z);
  int mx=int(sqrt(a*a*cp*cp+b*b*sp*sp)), my=int(sqrt(a*a*sp*sp+b*b*cp*cp));
  float zeta=2.0/r, zc=0.58, eta=(zeta+cos(zc))/(sin(zc)*sin(zc));
  vec4 m[8]; vec3 s[8];
  for (int k=0;k<8;k++){ m[k]=vec4(0.0); s[k]=vec3(0.0); }
  for (int y=-my;y<=my;y++) for (int x=-mx;x<=mx;x++){
    vec2 q=vec2(x,y); vec2 v=vec2((cp*q.x+sp*q.y)*0.5/a,(-sp*q.x+cp*q.y)*0.5/b);
    if (dot(v,v)>0.25) continue;
    vec3 c=clamp(texture(tSrc,vUv+q/uRes).rgb,0.0,1.0);
    float w[8]; float sum=0.0, z, vxx, vyy;
    vxx=zeta-eta*v.x*v.x; vyy=zeta-eta*v.y*v.y;
    z=max(0.0,v.y+vxx); w[0]=z*z; z=max(0.0,-v.x+vyy); w[2]=z*z; z=max(0.0,-v.y+vxx); w[4]=z*z; z=max(0.0,v.x+vyy); w[6]=z*z;
    v=0.70710678*vec2(v.x-v.y,v.x+v.y);
    vxx=zeta-eta*v.x*v.x; vyy=zeta-eta*v.y*v.y;
    z=max(0.0,v.y+vxx); w[1]=z*z; z=max(0.0,-v.x+vyy); w[3]=z*z; z=max(0.0,-v.y+vxx); w[5]=z*z; z=max(0.0,v.x+vyy); w[7]=z*z;
    for (int k=0;k<8;k++) sum+=w[k];
    float g=exp(-3.125*dot(v,v))/max(sum,1e-6);
    for (int k=0;k<8;k++){ float wk=w[k]*g; m[k]+=vec4(c*wk,wk); s[k]+=c*c*wk; }
  }
  vec4 o=vec4(0.0);
  for (int k=0;k<8;k++){ if (m[k].w<=0.0) continue; vec3 mu=m[k].rgb/m[k].w; vec3 sk=abs(s[k]/m[k].w-mu*mu);
    float s2=sk.r+sk.g+sk.b; float w=1.0/(1.0+pow(clamp(8000.0*s2,1e-6,1e8),0.5*uQ)); o+=vec4(mu*w,w); }
  // where every sector varies strongly the weights all but vanish; then the sectors are simply averaged
  if (o.w<1e-30){ o=vec4(0.0); for (int k=0;k<8;k++) if (m[k].w>0.0) o+=vec4(m[k].rgb/m[k].w,1.0); }
  fragColor=vec4(o.rgb/max(o.w,1e-30),1.0); }`;

function blur(src, sigma, tmp, out) {
  pass(BLUR, { tSrc: src, uDir: new THREE.Vector2(1, 0), uSigma: sigma }, tmp);
  pass(BLUR, { tSrc: tmp, uDir: new THREE.Vector2(0, 1), uSigma: sigma }, out);
  return out;
}

// the orientation field of a picture, smoothed over sigma pixels
function orientation(srcTex, w, h, sigma, flat = 0.01, seed = 1, drift = 1) {
  const st = target(w, h, THREE.FloatType), tmp = target(w, h, THREE.FloatType), tfm = target(w, h, THREE.FloatType);
  pass(ST, { tSrc: srcTex }, st);
  blur(st, sigma, tmp, st);
  pass(TFM, { tSrc: st, uFlat: flat, uSeed: seed, uDrift: drift }, tfm);
  st.dispose(); tmp.dispose();
  return tfm;
}

const COPY = `uniform sampler2D tSrc; uniform float uGain; void main(){ vec4 c=texture(tSrc,vUv); fragColor=vec4(c.rgb*uGain,1.0); }`;
function show(rt, w, h, gain = 1) { pass(COPY, { tSrc: rt, uGain: gain }, null, { w, h }); }

function kuwahara(src, tfm, radius, out, q = 8) {
  return pass(AKF, { tSrc: src, tTfm: tfm, uRadius: radius, uQ: q, uAlpha: 1.0 }, out);
}

/* ---------- watercolour ----------
   The picture is simplified with the anisotropic Kuwahara filter into flat shapes, whose edges are made to wobble
   as a hand-laid wash does. Each colour is then treated as a transparent pigment over white paper: its absorbance
   is split into a hue and a strength, and the strength is laid down as a few overlapping washes, each with a hard,
   slightly darker edge where the pigment dried. Shadows are glazed a little towards blue and violet, the lightest
   places are left as bare paper, and in wet passages neighbouring colours bleed together with soft edges. Pigment
   density varies in slow blotches and settles into the hollows of the paper (granulation); a faint pencil
   drawing shows through, and the painting stops short of the edges of the sheet in an irregular border.
   opts: abstraction (Kuwahara radius, default 7), washes (how strongly values are gathered into washes, default 1),
         edge (edge darkening, default 1), granulation (default 1), bleed (wet-in-wet, default 1),
         pencil (default 1), margin (unpainted border, default 1) */
const WC_WOBBLE = `uniform sampler2D tSrc; uniform float uAmp;
void main(){ vec2 p=vUv*uRes/uS;
  vec2 o=vec2(fbm(p*0.011+uSeed)-0.5, fbm(p*0.011+uSeed+31.7)-0.5)*uAmp*3.0;
  o+=vec2(vnoise(p*0.09+uSeed*1.3)-0.5, vnoise(p*0.09+uSeed*1.3+9.2)-0.5)*uAmp*0.9;
  fragColor=texture(tSrc,vUv+o*uS/uRes); }`;

const WC_FINAL = `uniform sampler2D tAbs, tWet, tEdge, tP1, tP2, tGap, tTfm; uniform float uEdge, uGran, uBleed, uMargin, uWashes, uPencil;
// a thin line where the simplified picture changes value sharply: the step in lightness across one pixel, less what
// remains of it two pixels further out, so that broad soft changes draw nothing
float pencilEdge(vec2 uv){
  vec2 d=uS/uRes;
  float gx=lum(texture(tP1,uv+vec2(d.x,0.0)).rgb)-lum(texture(tP1,uv-vec2(d.x,0.0)).rgb);
  float gy=lum(texture(tP1,uv+vec2(0.0,d.y)).rgb)-lum(texture(tP1,uv-vec2(0.0,d.y)).rgb);
  float g=length(vec2(gx,gy));
  float gx2=lum(texture(tP2,uv+vec2(d.x,0.0)*2.0).rgb)-lum(texture(tP2,uv-vec2(d.x,0.0)*2.0).rgb);
  float gy2=lum(texture(tP2,uv+vec2(0.0,d.y)*2.0).rgb)-lum(texture(tP2,uv-vec2(0.0,d.y)*2.0).rgb);
  float g2=length(vec2(gx2,gy2))*0.5;
  return smoothstep(0.035,0.09,g-0.6*g2); }
float paperH(vec2 p){ // cold-pressed paper: rounded tooth and finer fibre
  vec2 w=worley(p*0.24); float t=1.0-smoothstep(0.0,0.95,w.x);
  return clamp(0.55*t+0.45*fbm(p*0.55),0.0,1.0); }
void main(){
  vec2 px=vUv*uRes, p=px/uS;
  vec3 c=texture(tAbs,vUv).rgb, wet=texture(tWet,vUv).rgb, eb=texture(tEdge,vUv).rgb;
  // wet-in-wet: where the paper was wet, neighbouring colours run into each other
  float busy=smoothstep(0.02,0.1,length(eb-c));
  float wmask=clamp(smoothstep(0.45,0.7,fbm(p*0.004+uSeed+3.0))*0.75*(1.0-0.6*busy)+0.35*(1.0-busy),0.0,1.0)*uBleed;
  c=mix(c,wet,clamp(wmask,0.0,0.7));
  // the colour as a transparent pigment: absorbance split into hue (ah) and strength (A)
  vec3 cc=clamp(c,0.03,1.0);
  vec3 ab=-log(cc); float A=-log(clamp(lum(cc),0.03,1.0));
  vec3 ah=ab/max(A,1e-3);
  // lighter overall, as transparent washes are
  A*=0.82;
  // values gathered into a few overlapping washes with wobbling, hard edges
  float An=A+0.04*(fbm(p*0.008+uSeed+9.0)-0.5);
  const float D=0.32; float Aq=0.0, rim=0.0;
  float fw=max(fwidth(An),1e-4);
  for (int k=0;k<6;k++){ float t=k==0?0.045:D*(float(k)+0.2);
    float m=smoothstep(t-0.5*fw,t+0.5*fw,An);
    Aq+=m*(k==0?D*0.6:D);
    float dpx=(An-t)/fw;                                   // pixels inside the wash's edge
    rim+=m*exp(-dpx*dpx/(9.0*uS*uS)); }
  float hard=1.0-0.75*wmask;                               // wet passages keep soft edges
  float Af=mix(A,Aq,clamp(uWashes*0.7*hard,0.0,1.0));
  // progressive: pale washes spread first and darker glazes follow, each region in its own time
  float ordW=clamp(fbm(p*0.004+uSeed+90.0)*1.3-0.15,0.0,1.0);
  if (uT<1.0){ float k=clamp((uT-0.12-0.2*ordW)/0.62,0.0,1.0); Af=min(Af,3.2*k*k*k+0.25*smoothstep(0.0,0.25,k)); }
  // shadows glazed towards blue and violet
  vec3 violet=-log(vec3(0.62,0.6,0.8)); violet/=-log(lum(vec3(0.62,0.6,0.8)));
  ah=mix(ah,violet,0.3*smoothstep(0.55,1.3,Af));
  // pigment density: pooling at the edges of washes and of shapes, slow blotches, granulation in the tooth
  float dark=clamp((lum(eb)-lum(c))*7.0,0.0,1.0);
  float lateEdge=reveal(0.74,0.95,fbm(p*0.01+uSeed+91.0));
  float d=1.0+uEdge*(0.35*rim*hard+0.3*dark)*lateEdge;
  d*=1.0+0.4*(fbm(p*0.005+uSeed+11.0)-0.5)+(0.15+0.2*(1.0-busy))*(fbm(p*0.018+uSeed+5.0)-0.5);
  // the strokes of a broad wash, laid along the flow of the picture: streaks of more and less pigment
  vec2 tf=texture(tTfm,vUv).xy; vec2 fq=vec2(dot(p,tf),dot(p,vec2(-tf.y,tf.x)));
  d*=1.0+(0.22*(1.0-busy)+0.08)*(fbm(vec2(fq.x*0.006,fq.y*0.045)+uSeed+80.0)-0.5);
  // blooms: where wet paint ran back into a drying wash, a paler patch with a dark, frilled edge
  vec2 bp=p*0.009+0.6*vec2(fbm(p*0.02+uSeed+50.0),fbm(p*0.02+uSeed+60.0));
  vec2 bi=floor(bp); float bb=8.0; vec2 bc=vec2(0.0);
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){ vec2 g=bi+vec2(x,y); vec2 o=g+hash22(g+uSeed); float dd=length(bp-o); if (dd<bb){ bb=dd; bc=g; } }
  float bsel=step(0.86,hash12(bc+uSeed*3.0))*wmask*(1.0-busy);
  float br=0.28+0.12*hash12(bc+7.0);
  d*=1.0-bsel*(0.2*(1.0-smoothstep(br-0.08,br,bb))-0.3*exp(-pow((bb-br)/0.025,2.0)));
  float ph=paperH(p);
  float gr=uGran*(0.4+0.6*smoothstep(0.1,0.8,Af))*(0.6+0.6*smoothstep(-0.1,0.3,c.b-c.r))*smoothstep(0.3,0.7,fbm(p*0.01+uSeed+14.0));
  d*=1.0+0.4*gr*(0.5-ph);
  vec3 paper=vec3(0.976,0.966,0.938);
  vec3 col=paper*exp(-ah*Af*d);
  // slivers of paper left between neighbouring shapes, where the painter kept one colour off the next
  float edgeG=length(texture(tGap,vUv).rgb-c);
  float gap=smoothstep(0.05,0.14,edgeG)*smoothstep(0.5,0.62,fbm(p*0.015+uSeed+70.0))*hard;
  col=mix(col,paper,0.8*gap);
  // the pencil drawing beneath the paint: thin grey graphite lines along the main edges, each drawn twice by a
  // wandering hand, pressed harder in places, lifted here and there, and broken on the tooth of the paper, where
  // the graphite catches the raised grain and skips the hollows
  float st=0.0;
  for (int k=0;k<2;k++){
    float fk=float(k);
    vec2 wob=vec2(fbm(p*0.012+uSeed+40.0+fk*7.3),fbm(p*0.012+uSeed+47.0+fk*5.1))-0.5;
    vec2 uv=vUv+wob*(1.6+1.4*fk)*uS/uRes;
    float g=pencilEdge(uv);
    float press=(0.55+0.6*fbm(p*0.02+uSeed+33.0+fk*3.0))*(k==0?1.0:0.6);
    float lift=smoothstep(0.32,0.46,fbm(p*0.035+uSeed+30.0+fk*11.0));
    st=max(st,g*press*lift);
  }
  float grain=smoothstep(0.25,0.6,ph+0.45*(hash12(floor(px*0.9)+uSeed)-0.5));
  float lead=clamp(uPencil*1.0*st*(0.3+0.7*grain),0.0,0.9)*reveal(0.0,0.14,fbm(p*0.006+uSeed+92.0));
  // the edge of the painting: irregular, with dry-brush breaks where the brush skipped over the tooth
  vec2 q=abs(vUv-0.5)*2.0;
  float edgeN=(fbm(p*0.0035+uSeed+21.0)-0.5)*0.5+(fbm(p*0.025+uSeed+2.0)-0.5)*0.12+(fbm(vec2(atan(vUv.y-0.5,vUv.x-0.5)*1.3,uSeed+4.0))-0.5)*0.3;
  float e2=max(pow(q.x,5.0),pow(q.y,5.0))*0.6+0.4*pow(q.x*q.x+q.y*q.y,2.0)*0.5;
  float cover=1.0-smoothstep(0.42,0.48,e2*uMargin+edgeN*uMargin);
  float dry=smoothstep(0.35,0.7,ph+cover*0.55);
  cover=clamp(mix(dry*cover,cover,cover*cover),0.0,1.0);
  float erim=smoothstep(0.05,0.35,cover)*(1.0-smoothstep(0.35,0.95,cover));
  col*=1.0-0.12*erim*uEdge*lateEdge;
  col=mix(paper,col,cover);
  // the drawing runs on past the paint into the bare paper, fading before the edge of the sheet
  float drawn=1.0-smoothstep(0.5,0.62,e2*uMargin+edgeN*0.6*uMargin);
  col*=mix(vec3(1.0),vec3(0.42,0.43,0.47),lead*drawn);
  // the paper's tooth, lit from the upper left
  float hx=paperH(p+vec2(1.0,0.0))-ph, hy=paperH(p+vec2(0.0,1.0))-ph;
  col*=1.0+0.09*(-hx*0.7+hy*0.7)-0.035*(1.0-ph);
  fragColor=vec4(clamp(col,0.0,1.0),1.0); }`;

function watercolour(srcTex, w, h, o) {
  const s = h / 800, seed = o.seed ?? 1;
  const tfm = orientation(srcTex, w, h, 2.0 * s, 0.01, seed);
  const A = target(w, h), B = target(w, h), wob = target(w, h), wet = target(w, h), edge = target(w, h), tmp = target(w, h),
    p1 = target(w, h), p2 = target(w, h), gap = target(w, h);
  const r = (o.abstraction ?? 8) * s;
  kuwahara(srcTex, tfm, r, A, 6);
  kuwahara(A, tfm, r * 0.6, B, 6);
  pass(WC_WOBBLE, { tSrc: B, uAmp: 1.8, uSeed: seed }, wob);
  blur(wob, 1.2 * s, tmp, gap);
  blur(wob, 8 * s, tmp, wet);
  blur(wob, 3 * s, tmp, edge);
  blur(srcTex, 0.8 * s, tmp, p1); blur(srcTex, 2.5 * s, tmp, p2);
  const all = [tfm, A, B, wob, wet, edge, tmp, p1, p2, gap], dispose = () => all.forEach(t => t.dispose());
  const dbg = { A, B, wob, wet, edge }[o.debug]; if (dbg) return { frame: () => show(dbg, w, h), dispose };
  return { dispose, frame: t => pass(WC_FINAL, { tAbs: wob, tGap: gap, tTfm: tfm, tWet: wet, tEdge: edge, tP1: p1, tP2: p2, uEdge: o.edge ?? 1,
    uGran: o.granulation ?? 1, uBleed: o.bleed ?? 1, uMargin: o.margin ?? 1, uWashes: o.washes ?? 1, uPencil: o.pencil ?? 1, uSeed: seed, uT: t }, null, { w, h }) };
}

/* ---------- oil painting ----------
   Anisotropic Kuwahara filtering flattens the picture into patches of paint that follow its structure. Strokes
   are then laid along the flow of the structure tensor: seeds scattered on a jittered lattice are traced along
   the flow, and every pixel takes the stroke of highest order whose path passes within a brush's half-width of
   it. Each stroke carries one load of colour, taken where it starts, and a height that rises at its edges and
   end and is grooved by the bristles; the height field is lit so that the impasto catches the light, and the
   canvas weave shows where the paint is thin. Broad strokes cover the picture, and smaller ones are laid where
   it has detail.
   opts: radius (Kuwahara radius, default 6), stroke (stroke size, default 1), impasto (relief, default 1) */
const OIL_STROKES = `uniform sampler2D tTfm, tPaint; uniform float uCell, uLen, uWidth, uLayer, uTol, uCut;
float bristle(float s, float id){ return 0.4*vnoise(vec2(s*4.0,id*13.1))+0.35*vnoise(vec2(s*11.0,id*7.3))+0.25*vnoise(vec2(s*23.0,id*3.1)); }
void main(){
  vec2 px=vUv*uRes; float cell=uCell*uS, r=uWidth*uS, L=uLen*uS, stepL=max(1.0,0.12*L);
  int n=min(int(L/stepL),24);
  float best=-1.0; vec2 bc=vec2(0.0), bt=vec2(1.0,0.0); float bAlong=0.0, bSide=0.0;
  vec3 here=texture(tPaint,vUv).rgb;
  for (int dir=0; dir<2; dir++){
    vec2 x=px; vec2 tp=texture(tTfm,vUv).xy*(dir==0?1.0:-1.0);
    for (int i=0;i<=24;i++){ if (i>n) break;
      if (i>0){ vec2 t=texture(tTfm,x/uRes).xy; if (dot(t,tp)<0.0) t=-t; tp=t; x+=t*stepL; }
      vec2 ci=floor(x/cell);
      for (int yy=-1;yy<=1;yy++) for (int xx=-1;xx<=1;xx++){
        vec2 cc=ci+vec2(xx,yy); vec2 cp=(cc+hash22(cc+uSeed*7.0+uLayer*31.0))*cell;
        vec2 dv=x-cp; float d=length(dv);
        float pr=hash12(cc*1.37+uSeed+uLayer*17.0);
        float lk=0.4+0.6*hash12(cc*2.11+uSeed+5.0);                  // each stroke has its own length and breadth
        float rk=r*(0.65+0.6*hash12(cc*3.7+uSeed+2.0));
        float along=float(i)*stepL*(dir==0?1.0:-1.0);
        float sd=dot(dv,vec2(-tp.y,tp.x))/rk;
        // ragged ends: each bristle runs out of paint at its own point
        float endK=L*lk*(0.8+0.2*vnoise(vec2(sd*6.0,pr*91.0)));
        // strokes are laid in order of pr, so a stroke beyond the cut is not on the canvas yet
        if (d<rk && abs(along)<endK && pr>best && pr<uCut){
          // a stroke stops where the paint beneath it changes colour, as a painter keeps to the shapes
          vec3 ld=texture(tPaint,cp/uRes).rgb;
          if (length(ld-here)<uTol){ best=pr; bc=cp; bt=tp*(dir==0?1.0:-1.0); bAlong=along/endK; bSide=sd; } }
      }
    }
  }
  if (best<0.0){ fragColor=vec4(here,0.0); return; }
  float id=best*97.0;
  vec3 load=texture(tPaint,bc/uRes).rgb;
  float s=bSide, a=bAlong;     // across the stroke, -1 to 1; along it, from where the brush lands (1) to where it lifts (-1)
  // the stroke starts with the colour it was loaded with and picks up the colour beneath as it runs out
  vec3 c=mix(load,here,0.3+0.35*smoothstep(0.6,-1.0,a));
  vec3 hsv=rgb2hsv(c); hsv.x=fract(hsv.x+(hash12(vec2(id,3.0))-0.5)*0.012); hsv.y=clamp(hsv.y*(0.95+0.15*hash12(vec2(id,4.0))),0.0,1.0);
  hsv.z=clamp(hsv.z*(1.0+(hash12(vec2(id,5.0))-0.5)*0.06),0.0,1.0);
  c=hsv2rgb(hsv);
  // height: a body of paint grooved by the bristles, piled up where the brush lifted, soft at the sides
  float br=bristle(s,id);
  float h=0.5+0.1*hash12(vec2(id,9.0));
  h+=0.6*(br-0.5);
  h+=0.22*smoothstep(-0.55,-0.95,a)*(1.0-s*s);
  h=mix(0.5,h,smoothstep(1.0,0.65,abs(s))*smoothstep(1.0,0.8,abs(a)));
  c*=0.93+0.14*br;
  fragColor=vec4(c,clamp(h,0.02,1.0)); }`;

const OIL_FINAL = `uniform sampler2D tBase, tMid, tFine, tDetail; uniform float uImpasto, uLayers, uBaseDone;
// uLayers: how many of the three layers of strokes are on the canvas so far; before the broad strokes cover it,
// the bare toned canvas shows between them
vec4 paintAt(vec2 uv){ vec4 a=texture(tBase,uv), m=texture(tMid,uv), b=texture(tFine,uv); float d=texture(tDetail,uv).r;
  vec4 c=a; if (c.a<=0.0) c=uBaseDone>0.5?vec4(a.rgb,0.12):vec4(0.8,0.75,0.66,0.0);
  if (uLayers>1.5 && m.a>0.0) c=m;
  if (uLayers>2.5 && b.a>0.0 && d>0.35) c=b;
  return c; }
void main(){
  vec2 px=vUv*uRes, p=px/uS, e=1.0/uRes;
  vec4 P=paintAt(vUv);
  vec3 c=P.rgb; float h=P.a;
  float hx=(paintAt(vUv+vec2(e.x,0.0)).a-paintAt(vUv-vec2(e.x,0.0)).a)*0.5;
  float hy=(paintAt(vUv+vec2(0.0,e.y)).a-paintAt(vUv-vec2(0.0,e.y)).a)*0.5;
  vec3 n=normalize(vec3(-hx*uImpasto*2.2/uS,-hy*uImpasto*2.2/uS,1.0));
  vec3 Ld=normalize(vec3(-0.45,0.55,0.7));
  float diff=dot(n,Ld)/Ld.z;
  vec3 hv=normalize(Ld+vec3(0.0,0.0,1.0));
  float spec=pow(max(dot(n,hv),0.0),30.0)*smoothstep(0.35,0.75,h);
  // richer colour, as oil paint is next to the thin game colours
  vec3 hsv=rgb2hsv(c); hsv.y=clamp(hsv.y*1.08,0.0,1.0); c=hsv2rgb(hsv);
  c=mix(c,c*c*(3.0-2.0*c),0.3);
  c+=(lum(c)-0.5)*vec3(0.05,0.015,-0.05);     // warm lights and cool shadows, as under an old varnish
  // canvas weave, visible where the paint is thin
  float wv=0.5+0.25*sin(p.x*1.9+sin(p.y*0.95)*1.2)*sin(p.y*0.25)+0.25*sin(p.y*1.9+sin(p.x*0.95)*1.2)*sin(p.x*0.25);
  c*=1.0-0.07*(1.0-smoothstep(0.0,0.4,h))*wv;
  c=c*(0.86+0.18*diff)+vec3(1.0,0.97,0.92)*spec*0.3*uImpasto;
  fragColor=vec4(clamp(c,0.0,1.0),1.0); }`;

// where the picture has detail worth smaller strokes: gradient strength after smoothing
const OIL_DETAIL = `uniform sampler2D tSrc;
void main(){ vec2 d=1.0/uRes; vec3 a=texture(tSrc,vUv-vec2(d.x,0)).rgb, b=texture(tSrc,vUv+vec2(d.x,0)).rgb, c=texture(tSrc,vUv-vec2(0,d.y)).rgb, e=texture(tSrc,vUv+vec2(0,d.y)).rgb;
  float g=length(b-a)+length(e-c); fragColor=vec4(vec3(clamp(g*6.0,0.0,1.0)),1.0); }`;

function oil(srcTex, w, h, o) {
  const s = h / 800, seed = o.seed ?? 1, S = o.stroke ?? 1;
  const tfm = orientation(srcTex, w, h, 2.5 * s, 0.01, seed);
  const A = target(w, h), B = target(w, h), base = target(w, h), mid = target(w, h), fine = target(w, h), det = target(w, h), tmp = target(w, h),
    live = target(w, h);
  const r = (o.radius ?? 6) * s;
  kuwahara(srcTex, tfm, r, A, 8);
  kuwahara(A, tfm, r * 0.5, B, 8);
  const tfm2 = orientation(B, w, h, 5.0 * s, 0.006, seed);
  const L0 = { tTfm: tfm2, tPaint: B, uCell: 15 * S, uLen: 36 * S, uWidth: 11.5 * S, uLayer: 0, uTol: 0.2, uSeed: seed };
  const L1 = { tTfm: tfm2, tPaint: B, uCell: 12 * S, uLen: 22 * S, uWidth: 6.5 * S, uLayer: 1, uTol: 0.14, uSeed: seed };
  const L2 = { tTfm: tfm2, tPaint: A, uCell: 4.5 * S, uLen: 8 * S, uWidth: 2.6 * S, uLayer: 2, uTol: 0.12, uSeed: seed };
  for (const [L, out] of [[L0, base], [L1, mid], [L2, fine]]) pass(OIL_STROKES, { ...L, uCut: 2 }, out);
  pass(OIL_DETAIL, { tSrc: srcTex }, det); blur(det, 4 * s, tmp, det);
  const all = [tfm, tfm2, A, B, base, mid, fine, det, tmp, live], dispose = () => all.forEach(t => t.dispose());
  const dbg = { A, B, base, mid, fine, det, tfm: tfm2 }[o.debug]; if (dbg) return { frame: () => show(dbg, w, h), dispose };
  // progressive: the layer being painted is traced again each frame with only the strokes laid so far; broad
  // strokes over the toned canvas first, then the middle strokes, then the fine ones
  const span = [[0.02, 0.46], [0.46, 0.8], [0.8, 0.99]], Ls = [L0, L1, L2], done = [base, mid, fine];
  const frame = t => {
    const T = [base, mid, fine]; let layers = 3, baseDone = 1;
    if (t < 1) for (let i = 0; i < 3; i++) { const [t0, t1] = span[i]; if (t < t1) {
      pass(OIL_STROKES, { ...Ls[i], uCut: Math.max(0, (t - t0) / (t1 - t0)) }, live);
      T[i] = live; layers = i + 1; baseDone = i > 0 ? 1 : 0; break; } }
    pass(OIL_FINAL, { tBase: T[0], tMid: T[1], tFine: T[2], tDetail: det, uLayers: layers, uBaseDone: baseDone, uImpasto: o.impasto ?? 1, uSeed: seed, uT: t }, null, { w, h });
  };
  return { dispose, frame };
}

/* ---------- impressionist ----------
   Painted with many short strokes in layers, from broad strokes that cover a toned ground to small ones where the
   picture has detail. Each stroke takes the colour of the picture under its centre, varied in hue and value and
   sometimes shifted towards a complementary tint (blue and violet in shadow, warm in light), and lies across the
   gradient of the picture. The strokes carry bristle marks and a little relief.
   opts: strokes (density, default 1), size (stroke size, default 1), jitter (colour variation, default 1) */
const IMP_VERT = `in vec3 position; in vec2 uv; in vec4 iA; in vec4 iB; in vec4 iC;
uniform vec2 uRes; uniform float uFirst;
out vec2 vUv; out vec3 vCol; out vec4 vP;
void main(){
  // iA: centre (px), length, width; iB: direction, seed, load; iC: colour, unused
  vec2 dir=iB.xy, nrm=vec2(-dir.y,dir.x);
  vec2 q=position.xy*vec2(iA.z,iA.w);
  vec2 px=iA.xy+dir*q.x+nrm*q.y;
  vUv=uv; vCol=iC.rgb; vP=vec4(iB.z,iB.w,iA.z/iA.w,iC.a);
  gl_Position=vec4(px/uRes*2.0-1.0,0.0,1.0);
  if (float(gl_InstanceID)<uFirst) gl_Position=vec4(2.0,2.0,2.0,1.0);      // already on the canvas
}`;

const IMP_FRAG = `precision highp float; in vec2 vUv; in vec3 vCol; in vec4 vP; out vec4 fragColor; uniform float uHeight;
float h1(float n){ return fract(sin(n)*43758.5453); }
float vn1(float x, float s){ float i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f); return mix(h1(i+s),h1(i+1.0+s),f); }
void main(){
  float u=vUv.x, v=vUv.y*2.0-1.0, seed=vP.x*97.0;
  // the stroke's outline: rounded where the brush lands, tapering and breaking up where it lifts
  float half_=0.95-0.3*u;
  float edgeN=0.14*(vn1(u*7.0,seed)-0.5);
  float side=1.0-smoothstep(half_-0.3,half_,abs(v)+edgeN);
  float start=smoothstep(0.0,0.18,u-0.12*v*v), end=1.0-smoothstep(0.7,1.0,u+0.2*vn1(v*5.0,seed+3.0));
  // bristles: grooves along the stroke, paint running out towards its end
  float br=vn1(v*14.0+seed,seed)*0.6+vn1(v*31.0,seed+7.0)*0.4;
  float load=vP.y;
  float dry=smoothstep(load-0.25,load+0.15,u*0.9+0.3*br);
  float a=side*start*end*(1.0-0.8*dry*(1.0-br));
  a=clamp(a*1.15,0.0,1.0);
  if (a<0.02) discard;
  vec3 col=vCol*(0.88+0.22*br)*(1.04-0.08*u);
  if (uHeight>0.5){ fragColor=vec4(vec3(0.35+0.65*br)*(1.0-0.5*u),a); return; }
  fragColor=vec4(col,a); }`;

const IMP_FINAL = `uniform sampler2D tPaint, tHeight;
void main(){
  vec2 d=1.0/uRes;
  float h=texture(tHeight,vUv).r;
  float hx=texture(tHeight,vUv+vec2(d.x,0)).r-texture(tHeight,vUv-vec2(d.x,0)).r;
  float hy=texture(tHeight,vUv+vec2(0,d.y)).r-texture(tHeight,vUv-vec2(0,d.y)).r;
  vec3 n=normalize(vec3(-hx*1.8/uS,-hy*1.8/uS,1.0)); vec3 L=normalize(vec3(-0.5,0.6,0.7));
  vec3 c=texture(tPaint,vUv).rgb;
  float diff=dot(n,L)/L.z;
  vec2 p=vUv*uRes/uS;
  float weave=0.5+0.5*sin(p.x*1.6)*sin(p.y*1.6);
  float spec=pow(max(dot(n,normalize(L+vec3(0,0,1))),0.0),24.0)*h;
  c*=0.9+0.12*diff; c*=1.0-0.03*weave; c+=vec3(1.0,0.97,0.9)*spec*0.12;
  fragColor=vec4(clamp(c,0.0,1.0),1.0); }`;

function mulberry(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function readTarget(rt) {
  const g = ctx(), w = rt.width, h = rt.height;
  const isF = rt.texture.type === THREE.FloatType;
  const buf = isF ? new Float32Array(w * h * 4) : new Uint16Array(w * h * 4);
  g.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  if (isF) return buf;
  const out = new Float32Array(w * h * 4); for (let i = 0; i < buf.length; i++) out[i] = THREE.DataUtils.fromHalfFloat(buf[i]);
  return out;
}

function rgb2hsv(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d > 1e-6) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; }
  return [h, mx > 0 ? d / mx : 0, mx]; }
function hsv2rgb(h, s, v) { h = ((h % 1) + 1) % 1; const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]; }

function impressionist(srcTex, w, h, o) {
  const g = ctx(), s = h / 800, rnd = mulberry((o.seed ?? 1) * 7919), J = o.jitter ?? 1, SZ = o.size ?? 1, DEN = o.strokes ?? 1;
  const tfm = orientation(srcTex, w, h, 6.0 * s);
  // colour sampled from slightly softened copies of the picture, one per layer
  const tmp = target(w, h), soft = [target(w, h), target(w, h), target(w, h)];
  const sig = [9 * s, 4 * s, 1.5 * s];
  pass(`uniform sampler2D tSrc; void main(){ fragColor=texture(tSrc,vUv); }`, { tSrc: srcTex }, soft[2]);
  for (let i = 0; i < 3; i++) blur(soft[2], sig[i], tmp, soft[i]);
  // read back orientation and the layers' colours at a reduced size
  const dw = Math.ceil(w / 2), dh = Math.ceil(h / 2), small = target(dw, dh, THREE.FloatType);
  const read = rt => { pass(`uniform sampler2D tSrc; void main(){ fragColor=texture(tSrc,vUv); }`, { tSrc: rt }, small); return readTarget(small); };
  const T = read(tfm), C = soft.map(read);
  // the canvas and its height
  const paint = target(w, h, THREE.UnsignedByteType), height = target(w, h, THREE.UnsignedByteType);
  // a thin underpainting: the picture's broad colours rubbed into a warm ground
  pass(`uniform sampler2D tSrc; void main(){ vec3 c=texture(tSrc,vUv).rgb; fragColor=vec4(mix(c,vec3(0.84,0.78,0.66),0.35),1.0); }`, { tSrc: soft[0] }, paint);
  g.renderer.setRenderTarget(height); g.renderer.setClearColor(new THREE.Color(0, 0, 0), 1); g.renderer.clear();
  const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0.5, 0, 0);   // u runs along the stroke from where the brush lands
  const matC = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: `precision highp float;\n` + IMP_VERT, fragmentShader: IMP_FRAG,
    uniforms: { uRes: { value: new THREE.Vector2(w, h) }, uHeight: { value: 0 }, uFirst: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });
  const matH = matC.clone(); matH.uniforms = { uRes: matC.uniforms.uRes, uHeight: { value: 1 }, uFirst: matC.uniforms.uFirst };
  const sample = (A, x, y) => { const i = (Math.min(dh - 1, Math.max(0, Math.floor(y / 2))) * dw + Math.min(dw - 1, Math.max(0, Math.floor(x / 2)))) * 4; return [A[i], A[i + 1], A[i + 2], A[i + 3]]; };
  const layers = [{ r: 11, gap: 6.5, src: 0, all: true }, { r: 6.5, gap: 4.8, src: 1, all: false }, { r: 3.6, gap: 3.0, src: 2, all: false }];
  const all = [], ends = [];
  for (const [li, L] of layers.entries()) {
    const R = L.r * s * SZ, gap = L.gap * s * SZ / Math.sqrt(DEN), strokes = [];
    // where the painting so far differs from the picture, the next layer adds strokes (Hertzmann's layered painting)
    for (let y = 0; y < h; y += gap) for (let x = 0; x < w; x += gap) {
      const px = x + (rnd() - 0.5) * gap * 1.6, py = y + (rnd() - 0.5) * gap * 1.6;
      const c = sample(C[L.src], px, py);
      // smaller strokes go only where the picture has detail at their scale: where it differs from its softer copy
      if (!L.all) { const k = sample(C[L.src - 1], px, py), e = Math.hypot(k[0] - c[0], k[1] - c[1], k[2] - c[2]);
        if (e < (L.src === 1 ? 0.05 : 0.07) * (0.7 + 0.6 * rnd())) continue; }
      const t = sample(T, px, py);
      let ang = Math.atan2(t[1], t[0]);
      // where the picture is flat, the strokes follow a slow drift instead of noise in the tensor
      const aniso = t[3]; ang += (rnd() - 0.5) * (0.35 + 0.5 * (1 - aniso));
      const len = R * (1.6 + 1.4 * rnd()) * (0.85 + 0.4 * aniso), wid = R * (0.8 + 0.35 * rnd());
      // colour: hue and value jittered, chroma raised, sometimes broken towards a complementary tint
      let [hh, ss, vv] = rgb2hsv(c[0], c[1], c[2]);
      hh += (rnd() - 0.5) * 0.05 * J; ss = Math.min(1, ss * (1.1 + 0.3 * rnd() * J)); vv = Math.min(1, vv * (1 + (rnd() - 0.5) * 0.1 * J));
      let col = hsv2rgb(hh, ss, vv);
      const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2], lumv = lum(col);
      // broken colour: shadows laid with ultramarine and violet, lights with warm cream and pink, and the middle
      // values with the neighbouring hues, so that the colours mix in the eye rather than on the palette
      if (rnd() < 0.35 * J) {
        let tint;
        if (lumv < 0.42) tint = rnd() < 0.6 ? [0.32, 0.32, 0.72] : [0.5, 0.33, 0.62];
        else if (lumv > 0.72) tint = rnd() < 0.6 ? [1.0, 0.9, 0.62] : [1.0, 0.76, 0.72];
        if (tint) { const k = 0.25 + 0.25 * rnd(); col = col.map((v, i) => v * (1 - k) + tint[i] * k); }
        else col = hsv2rgb(hh + (rnd() < 0.5 ? -1 : 1) * (0.03 + 0.025 * rnd()), Math.min(1, ss * 1.12), vv);
        // the broken colour keeps the value of the colour it replaces, so that the picture's light holds together
        const k2 = lumv / Math.max(0.02, lum(col)); col = col.map(v => Math.min(1, v * (0.7 + 0.3 * k2)));
      }
      // starts behind the centre so that the stroke is centred on the sample
      const dx = Math.cos(ang), dy = Math.sin(ang), sgn = rnd() < 0.5 ? 1 : -1;
      strokes.push([px - dx * sgn * len * 0.5, py - dy * sgn * len * 0.5, len, wid, dx * sgn, dy * sgn, rnd(), 0.65 + 0.35 * rnd(), col[0], col[1], col[2], 1]);
    }
    // random order, so that no direction of the grid shows
    for (let i = strokes.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [strokes[i], strokes[j]] = [strokes[j], strokes[i]]; }
    all.push(...strokes); ends.push(all.length);
  }
  const n = all.length, iA = new Float32Array(n * 4), iB = new Float32Array(n * 4), iC = new Float32Array(n * 4);
  all.forEach((k, i) => { iA.set(k.slice(0, 4), i * 4); iB.set(k.slice(4, 8), i * 4); iC.set(k.slice(8, 12), i * 4); });
  const ig = new THREE.InstancedBufferGeometry(); ig.index = geo.index; ig.attributes.position = geo.attributes.position; ig.attributes.uv = geo.attributes.uv;
  ig.setAttribute('iA', new THREE.InstancedBufferAttribute(iA, 4)); ig.setAttribute('iB', new THREE.InstancedBufferAttribute(iB, 4)); ig.setAttribute('iC', new THREE.InstancedBufferAttribute(iC, 4));
  const mesh = new THREE.Mesh(ig, matC); mesh.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(mesh);
  // the strokes go down in the order they were made: broad ones over the underpainting first, then middle, then fine
  const span = [[0.04, 0.46], [0.46, 0.8], [0.8, 1.0]];
  const countAt = t => { if (t >= 1) return n; let c = 0;
    for (let i = 0; i < 3; i++) { const lo = i ? ends[i - 1] : 0, [t0, t1] = span[i]; c = t <= t0 ? c : lo + Math.round((ends[i] - lo) * Math.min(1, (t - t0) / (t1 - t0))); if (t < t1) break; }
    return c; };
  let drawn = 0;
  const dispose = () => { [tfm, tmp, ...soft, small, paint, height].forEach(t => t.dispose()); matC.dispose(); matH.dispose(); geo.dispose(); ig.dispose(); };
  const frame = t => {
    const upto = countAt(t);
    if (upto > drawn) {
      ig.instanceCount = upto; matC.uniforms.uFirst.value = drawn;
      mesh.material = matC; g.renderer.setRenderTarget(paint); g.renderer.render(sc, g.cam);
      mesh.material = matH; g.renderer.setRenderTarget(height); g.renderer.render(sc, g.cam);
      drawn = upto;
    }
    if (o.debug === 'paint') return show(paint, w, h); if (o.debug === 'height') return show(height, w, h);
    pass(IMP_FINAL, { tPaint: paint, tHeight: height }, null, { w, h });
  };
  return { frame, dispose };
}

/* ---------- charcoal ----------
   A monochrome drawing on laid charcoal paper. The picture's values are gathered into tonal masses from its
   Kuwahara-simplified copy and drawn with hatching: strokes laid along the flow of the structure tensor, each a
   line whose breadth and pressure follow the darkness beneath it, with a second set crossing the first in the
   shadows. The charcoal catches only on the tooth of the paper where the pressure is light and fills it where it
   is heavy. Middle tones are smudged into a soft grey, contours are drawn as crisp lines of varying pressure,
   the lightest places are lifted back to bare paper, and stray dust and finger smudges lie on the sheet.
   opts: abstraction (Kuwahara radius, default 5), hatching (default 1), contour (default 1), smudge (default 1) */
const CH_TONE = `uniform sampler2D tSrc; uniform float uLo, uHi;
void main(){ vec3 c=texture(tSrc,vUv).rgb; float L=mix(lum(c),max(c.r,max(c.g,c.b)),0.5);
  // values pushed apart, as a draughtsman simplifies light and shadow
  float D=clamp((uHi-L)/max(uHi-uLo,0.1),0.0,1.0); D=pow(D,1.1);
  fragColor=vec4(D,D,D,1.0); }`;

// hatching: a line integral convolution of sparse noise along the flow (turned by uTurn) draws long strokes that
// follow the form; the strokes appear where the drawing is darker than each stroke's threshold
const CH_HATCH = `uniform sampler2D tTfm, tTone, tQuiet; uniform float uLen, uLayer, uTurn, uFrom;
float seedAt(vec2 x){ vec2 c=floor(x/(1.7*uS)); float h=hash12(c+uSeed*3.0+uLayer*17.0); return step(0.82,h)*(0.6+0.4*hash12(c+9.0)); }
void main(){
  vec2 px=vUv*uRes; float cs=cos(uTurn), sn=sin(uTurn);
  float acc=seedAt(px), wsum=1.0; int n=int(uLen*uS);
  for (int dir=0; dir<2; dir++){
    vec2 x=px; vec2 t0=texture(tTfm,vUv).xy; vec2 tp=vec2(cs*t0.x-sn*t0.y,sn*t0.x+cs*t0.y)*(dir==0?1.0:-1.0);
    for (int i=1;i<=60;i++){ if (i>n) break;
      vec2 t=texture(tTfm,x/uRes).xy; t=vec2(cs*t.x-sn*t.y,sn*t.x+cs*t.y); if (dot(t,tp)<0.0) t=-t; tp=t; x+=t;
      float w=1.0-float(i)/float(n+1); acc+=w*seedAt(x); wsum+=w; }
  }
  float v=acc/wsum*5.0;                                     // about 1 on a stroke, 0 between strokes
  float D=texture(tTone,vUv).r;
  float w=clamp((D-uFrom)/(1.0-uFrom),0.0,1.0);
  float line=smoothstep(1.0-w,1.0-w+0.35,v)*smoothstep(0.0,0.15,w);
  // broad quiet passages such as the sky are mostly smudged, with only a few strokes
  line*=mix(0.5,1.0,smoothstep(0.01,0.12,texture(tQuiet,vUv).r));
  fragColor=vec4(line*(0.55+0.45*w),w,0.0,1.0); }`;

const CH_FINAL = `uniform sampler2D tTone, tSoft, tH1, tH2, tP1, tP2; uniform float uHatch, uContour, uSmudge;
float tooth(vec2 p){ // laid paper: fine chain and laid lines, and a granular tooth
  float laid=0.5+0.5*sin(p.y*2.1+0.6*sin(p.x*0.05));
  float g=fbm(p*0.9)*0.6+vnoise(p*2.3)*0.4;
  return clamp(0.25*laid+0.75*g,0.0,1.0); }
void main(){
  vec2 px=vUv*uRes, p=px/uS;
  float D=texture(tTone,vUv).r, Ds=texture(tSoft,vUv).r;
  D=clamp(D+1.2*(D-Ds),0.0,1.0);                 // local contrast, as the draughtsman separates planes
  float ph=tooth(p);
  // the charcoal catches on the peaks of the tooth under light pressure and fills the hollows under heavy
  float k=0.0;
  // smudged middle tones: charcoal rubbed into the paper with a finger or stump
  float sm=uSmudge*smoothstep(0.03,0.9,mix(Ds,D,0.5))*(0.8+0.35*(fbm(p*0.01+uSeed+3.0)-0.5));
  sm*=0.55+0.45*smoothstep(0.1,0.7,ph);
  vec2 sw=p*0.004+uSeed+93.0; float ord=fbm(sw), ord2=fbm(sw+7.0);
  k=1.0-(1.0-k)*(1.0-0.62*sm*reveal(0.5,0.74,ord2));
  // hatching: two sets of strokes, the second crossing the first in the shadows
  vec4 h1=texture(tH1,vUv), h2=texture(tH2,vUv);
  float g1=smoothstep(1.0-h1.x*1.5-0.1,1.0-h1.x*1.5+0.25,ph);
  float g2=smoothstep(1.0-h2.x*1.5-0.1,1.0-h2.x*1.5+0.25,ph);
  k=1.0-(1.0-k)*(1.0-uHatch*0.7*h1.x*g1*reveal(0.0,0.36,ord))*(1.0-uHatch*0.7*h2.x*g2*reveal(0.28,0.56,ord2));
  // the deepest shadows pressed into a dense black
  float deep=smoothstep(0.62,0.95,D);
  k=1.0-(1.0-k)*(1.0-0.8*deep*smoothstep(0.2,0.6,ph+deep*0.4)*reveal(0.4,0.66,ord));
  // contours: crisp lines from the picture's edges, heavier and lighter as the hand presses and lifts
  float e=lum(texture(tP1,vUv).rgb)-lum(texture(tP2,vUv).rgb);
  float cl=smoothstep(0.015,0.05,abs(e))*(0.55+0.45*vnoise(p*0.03+uSeed+8.0));
  cl*=smoothstep(0.25,0.55,ph+0.35*cl);
  k=1.0-(1.0-k)*(1.0-uContour*0.85*cl*reveal(0.68,0.9,fbm(p*0.012+uSeed+94.0)));
  // highlights lifted with a putty rubber: streaks of bare paper in the lightest places
  float lift=smoothstep(0.1,0.02,Ds)*(0.6+0.4*fbm(vec2(p.x*0.02,p.y*0.08)+uSeed+40.0));
  k*=1.0-lift*reveal(0.88,0.99,ord);
  // dust and smudges on the sheet
  float dust=smoothstep(0.62,0.8,fbm(p*0.004+uSeed+60.0))*0.12+step(0.9985,hash12(floor(p*0.7)+uSeed))*0.5;
  k=1.0-(1.0-k)*(1.0-dust*smoothstep(0.3,0.7,ph)*reveal(0.9,1.0,ord2));
  vec3 paper=vec3(0.93,0.915,0.875), char=vec3(0.11,0.105,0.11);
  vec3 col=mix(paper,char,clamp(k,0.0,1.0));
  // the tooth of the paper, lit from the upper left, everywhere the charcoal has not filled it
  float hx=tooth(p+vec2(1.0,0.0))-ph, hy=tooth(p+vec2(0.0,1.0))-ph;
  col*=1.0+(1.0-k)*(0.06*(-hx*0.7+hy*0.7)-0.03*(1.0-ph));
  fragColor=vec4(clamp(col,0.0,1.0),1.0); }`;

function charcoal(srcTex, w, h, o) {
  const s = h / 800, seed = o.seed ?? 1;
  const tfm = orientation(srcTex, w, h, 3.0 * s, 0.01, seed);
  const A = target(w, h), tone = target(w, h), soft = target(w, h), h1 = target(w, h), h2 = target(w, h), tmp = target(w, h),
    p1 = target(w, h), p2 = target(w, h);
  kuwahara(srcTex, tfm, (o.abstraction ?? 5) * s, A, 8);
  // the drawing uses the whole range from paper to black, whatever the picture's own range
  const sw = 64, sh = Math.max(8, Math.round(64 * h / w)), small = target(sw, sh, THREE.FloatType);
  pass(COPY, { tSrc: A, uGain: 1 }, small);
  const px = readTarget(small), Ls = [];
  for (let i = 0; i < px.length; i += 4) Ls.push(0.5 * (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) + 0.5 * Math.max(px[i], px[i + 1], px[i + 2]));
  Ls.sort((a, b) => a - b); small.dispose();
  const lo = Math.min(0.45, Ls[Math.floor(Ls.length * 0.03)]), hi = Math.max(lo + 0.25, Math.min(0.97, Ls[Math.floor(Ls.length * 0.9)]));
  pass(CH_TONE, { tSrc: A, uLo: lo, uHi: hi }, tone);
  blur(tone, 5 * s, tmp, soft);
  const det = target(w, h); pass(OIL_DETAIL, { tSrc: A }, det); blur(det, 6 * s, tmp, det);
  const tfm2 = orientation(A, w, h, 14.0 * s, 0.02, seed, 0.15);
  pass(CH_HATCH, { tTfm: tfm2, tQuiet: det, tTone: tone, uLen: 22, uLayer: 0, uTurn: 0.75, uFrom: 0.15, uSeed: seed }, h1);
  pass(CH_HATCH, { tTfm: tfm2, tQuiet: det, tTone: tone, uLen: 18, uLayer: 1, uTurn: -0.45, uFrom: 0.5, uSeed: seed }, h2);
  blur(A, 1.0 * s, tmp, p1); blur(A, 1.8 * s, tmp, p2);
  const all = [tfm, tfm2, A, tone, soft, h1, h2, tmp, p1, p2, det], dispose = () => all.forEach(t => t.dispose());
  const dbg = { A, tone, soft, h1, h2 }[o.debug]; if (dbg) return { frame: () => show(dbg, w, h), dispose };
  return { dispose, frame: t => pass(CH_FINAL, { tTone: tone, tSoft: soft, tH1: h1, tH2: h2, tP1: p1, tP2: p2, uHatch: o.hatching ?? 1,
    uContour: o.contour ?? 1, uSmudge: o.smudge ?? 1, uSeed: seed, uT: t }, null, { w, h }) };
}

const RUN = { watercolour, oil, impressionist, charcoal };

function stopped(signal) { if (signal && signal.aborted) throw new DOMException('The painting was stopped.', 'AbortError'); }

export async function applyEffect(name, source, opts = {}) {
  stopped(opts.signal);
  const f = RUN[name]; if (!f) throw new Error(`There is no effect called ${name}.`);
  const { w, h } = size(source);
  const g = ctx(); g.renderer.setSize(w, h, false);
  const tex = sourceTexture(source);
  const job = f(tex, w, h, opts);
  try {
    // progressive display: the picture is shown being made, frame by frame, on the effect's own canvas
    if (opts.onFrame) {
      if (opts.steps) for (let i = 0; i < opts.steps; i++) { const t = opts.steps > 1 ? i / (opts.steps - 1) : 1; job.frame(t); await opts.onFrame(g.renderer.domElement, t); }
      else {
        const dur = opts.duration ?? 6000, t0 = performance.now();
        for (;;) { stopped(opts.signal); const t = Math.min(1, (performance.now() - t0) / dur); job.frame(t); await opts.onFrame(g.renderer.domElement, t);
          if (t >= 1) break; await new Promise(r => requestAnimationFrame(r)); }
      }
    }
    job.frame(1);
    return toCanvas(w, h);
  } finally { job.dispose(); tex.dispose(); }
}

export async function pathTrace(opts) {
  const m = await import('./pathtrace.js');
  return m.pathTrace(opts);
}
