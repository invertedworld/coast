/* Picture effects for photographs taken in the village.

   applyEffect(name, source, opts) -> Promise<HTMLCanvasElement>
     name    'watercolour', 'oil', 'vangogh' or 'woodcut'
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

export const EFFECTS = ['watercolour', 'oil', 'vangogh', 'woodcut'];

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
   opts: radius (Kuwahara radius, default 6), stroke (stroke size, default 1), impasto (relief, default 1),
         mixing (0: colours mixed on the palette, the default; 1: optical mixing, described below) */
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
  if (o.mixing === 1) return opticalOil(srcTex, w, h, o);
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

/* ---------- oil painting with optical mixing (divisionism) ----------
   In the manner of the later Signac and Cross, no colour of the picture is mixed on the palette. The picture is
   divided into a lattice of cells, and each cell receives one small, square-ended stroke of a single pigment from a
   limited palette: thirteen pure hues round the colour circle, each straight from the tube, lightened with white
   or deepened, with white and three deep shadow colours. The pigment of each cell is chosen so that the
   strokes, averaged over a neighbourhood, reproduce the picture's colour: the difference between
   the colour wanted and the pigment laid is carried to the neighbouring cells (Floyd-Steinberg error diffusion,
   along alternate directions on alternate rows), and a pigment already laid beside a cell costs more there, so
   that neighbouring strokes differ and the colour is built from several pigments side by side. Some cells take an
   accent instead: in the shadows the complement of the local hue or ultramarine and violet, and elsewhere a
   pigment of the opposite warmth, warm beside cold and cold beside warm. Every pigment is kept close to the value
   of the place where it is laid, so that the picture's light holds together however it is viewed. Smaller strokes
   are laid over the broad ones where the picture has detail. The strokes follow the flow of the structure tensor
   and carry the bristle grooves and impasto of the oil style, lit in the same way.
   opts: radius (the brush size: the strokes are about 1.35 times as large in pixels), stroke (stroke length),
         impasto (relief) */
const OPT_VERT = `in vec3 position; in vec2 uv; in vec4 iA; in vec4 iB; in vec4 iC;
uniform vec2 uRes; uniform float uFirst;
out vec2 vUv; out vec3 vCol; out vec2 vP;
void main(){
  // iA: centre (px), length, width; iB: direction, seed, unused; iC: colour (sRGB), unused
  vec2 dir=iB.xy, nrm=vec2(-dir.y,dir.x);
  vec2 q=(position.xy-vec2(0.5,0.0))*vec2(iA.z,iA.w);
  vec2 px=iA.xy+dir*q.x+nrm*q.y;
  vUv=uv; vCol=iC.rgb; vP=vec2(iB.z,iA.w);
  gl_Position=vec4(px/uRes*2.0-1.0,0.0,1.0);
  if (float(gl_InstanceID)<uFirst) gl_Position=vec4(2.0,2.0,2.0,1.0);      // already on the canvas
}`;

// one stroke, opaque: its colour, and its height in alpha
const OPT_FRAG = `precision highp float; in vec2 vUv; in vec3 vCol; in vec2 vP; out vec4 fragColor;
float h1(float n){ return fract(sin(n)*43758.5453); }
float vn1(float x, float s){ float i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f); return mix(h1(i+s),h1(i+1.0+s),f); }
void main(){
  float u=vUv.x, v=vUv.y*2.0-1.0, seed=vP.x*97.0;
  // the shape of the dab varies from stroke to stroke: square-ended, an oval touch, a comma that tapers to a point
  // where the brush lifts, or a short stroke bent in an arc; each has slightly ragged sides and ends
  float kind=h1(seed+23.0), sideN=0.1*(vn1(u*6.0,seed)-0.5), endN=0.08*(vn1(v*5.0,seed+3.0)-0.5);
  float hw=0.92, vv=v, u0=0.04, u1=0.95;
  if (kind<0.32){ }
  else if (kind<0.56){ float e=2.0*u-1.0; hw=0.92*sqrt(max(0.0,1.0-e*e)); u0=0.0; u1=1.0; }
  else if (kind<0.8){ hw=0.92*(1.0-0.78*pow(u,1.4))*smoothstep(0.0,0.12,u+0.04); u0=0.0; }
  else { float bend=(h1(seed+31.0)-0.5)*1.2; vv=v-bend*(1.0-4.0*(u-0.5)*(u-0.5)); hw=0.6; }
  if (abs(vv)+sideN>hw || u+endN<u0 || u-endN>u1) discard;
  float r=abs(vv)/max(hw,1e-3);
  // bristle grooves along the stroke; the paint piles up where the brush lifts, at the end (u = 1)
  float br=vn1(vv*9.0+seed,seed)*0.55+vn1(vv*21.0,seed+7.0)*0.45;
  float h=0.55+0.08*(h1(seed+11.0)-0.5)+0.4*(br-0.5)+0.22*smoothstep(0.6,0.92,u)*(1.0-r*r);
  h=mix(0.3,h,smoothstep(1.0,0.7,r+sideN)*smoothstep(u0-0.02,u0+0.12,u)*smoothstep(u1+0.02,u1-0.09,u));
  fragColor=vec4(vCol*(0.94+0.12*br),clamp(h,0.02,1.0)); }`;

// the strokes lit as in the oil style, without its grading of colour, so that the strokes keep the pigments chosen
const OPT_FINAL = `uniform sampler2D tPaint; uniform float uImpasto, uFill;
void main(){
  vec2 p=vUv*uRes/uS, e=1.0/uRes;
  vec4 P=texture(tPaint,vUv); vec3 c=P.rgb; float h=P.a;
  // once the broad strokes are all laid, the slivers of ground left between them take the paint beside them, as
  // the edges of wet strokes close over a narrow gap
  if (uFill>0.5 && h<0.06){ vec4 acc=vec4(0.0);
    for (int y=-2;y<=2;y+=2) for (int x=-2;x<=2;x+=2){ vec4 q=texture(tPaint,vUv+vec2(x,y)*e); if (q.a>=0.06) acc+=vec4(q.rgb,1.0); }
    if (acc.w>0.0){ c=acc.rgb/acc.w; h=0.2; } }
  float hx=(texture(tPaint,vUv+vec2(e.x,0.0)).a-texture(tPaint,vUv-vec2(e.x,0.0)).a)*0.5;
  float hy=(texture(tPaint,vUv+vec2(0.0,e.y)).a-texture(tPaint,vUv-vec2(0.0,e.y)).a)*0.5;
  vec3 n=normalize(vec3(-hx*uImpasto*2.2/uS,-hy*uImpasto*2.2/uS,1.0));
  vec3 Ld=normalize(vec3(-0.45,0.55,0.7));
  float diff=dot(n,Ld)/Ld.z;
  float spec=pow(max(dot(n,normalize(Ld+vec3(0.0,0.0,1.0))),0.0),30.0)*smoothstep(0.35,0.75,h);
  float wv=0.5+0.25*sin(p.x*1.9+sin(p.y*0.95)*1.2)*sin(p.y*0.25)+0.25*sin(p.y*1.9+sin(p.x*0.95)*1.2)*sin(p.x*0.25);
  c*=1.0-0.07*(1.0-smoothstep(0.0,0.4,h))*wv;
  c=c*(1.0+0.2*(diff-1.0))+vec3(1.0,0.97,0.92)*spec*0.06*uImpasto;
  fragColor=vec4(clamp(c,0.0,1.0),1.0); }`;

const toLin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toSrgb = c => { c = Math.min(1, Math.max(0, c)); return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
// Oklab from linear sRGB (Ottosson), into o[k..k+2]
function oklab(r, g, b, o, k = 0) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  o[k] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s; o[k + 1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  o[k + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s; return o;
}

// the divisionist palette, in sRGB: the pure hues with whether each is warm, then white and the deep shadow colours
const HUES = [[1.0, 0.92, 0.2, 1], [1.0, 0.76, 0.08, 1], [0.99, 0.52, 0.08, 1], [0.92, 0.26, 0.1, 1], [0.84, 0.16, 0.36, 1], [0.8, 0.36, 0.62, 1],
  [0.52, 0.24, 0.66, 0], [0.2, 0.22, 0.7, 0], [0.16, 0.42, 0.8, 0], [0.2, 0.64, 0.82, 0], [0.06, 0.52, 0.44, 0], [0.18, 0.66, 0.3, 0], [0.62, 0.8, 0.16, 1]];
let PALETTE = null;
function palette() {
  if (PALETTE) return PALETTE;
  const P = [], white = [0.98, 0.97, 0.93].map(toLin), deep = [0.1, 0.1, 0.32].map(toLin);
  const add = (lin, fam, warm, accent) => { const lab = oklab(lin[0], lin[1], lin[2], [0, 0, 0]);
    P.push({ lin, lab, fam, warm, accent, srgb: lin.map(toSrgb), hue: Math.atan2(lab[2], lab[1]), C: Math.hypot(lab[1], lab[2]) }); };
  HUES.forEach(([r, g, b, warm], fam) => {
    const lin = [r, g, b].map(toLin);
    // lightened with white (mixed, as pigments mix, in linear reflectance), and deepened towards ultramarine
    for (const k of [0, 0.3, 0.55, 0.75, 0.88]) add(lin.map((v, i) => v * (1 - k) + white[i] * k), fam, warm, k < 0.8);
    // the yellows are not deepened, as they turn to olive, and orange and vermilion only as far as the deep cadmiums,
    // as further they turn to the earth colours, which the divisionists left out; a warm shadow is built from these
    // beside deep cool colours
    if (fam >= 2 && fam <= 11) for (const m of fam === 2 ? [0.6] : fam === 3 ? [0.55] : [0.55, 0.3]) add(lin.map((v, i) => (v * 0.85 + deep[i] * 0.15) * m), fam, warm, true);
  });
  add(white, 20, 0.5, false);
  add([0.08, 0.08, 0.24].map(toLin), 7, 0, true); add([0.18, 0.07, 0.22].map(toLin), 6, 0, true); add([0.04, 0.17, 0.16].map(toLin), 10, 0, true);
  return (PALETTE = P);
}

// chooses a pigment for every cell of a cols x rows lattice whose colours (linear sRGB) are in T; returns indices
// into the palette
function divide(T, cols, rows, rnd, plain = false) {
  const P = palette(), n = P.length, E = new Float32Array(cols * rows * 3), out = new Int16Array(cols * rows).fill(-1);
  const tl = [0, 0, 0], Tl = [0, 0, 0];
  // the colours are averaged in linear light raised to the power 0.7: the eye mixes the strokes in linear light when
  // the picture is seen from a distance, but a reduced copy on a screen is mostly averaged in the display's own
  // values, which are nearer to the power 0.45; between the two, the mixture comes out close in both
  const Wf = v => Math.sign(v) * Math.pow(Math.abs(v), 0.7), Wi = v => Math.sign(v) * Math.pow(Math.abs(v), 1 / 0.7);
  // plain: each cell takes the pigment nearest its own colour, with no accents and nothing carried to its neighbours
  const KV = 7, KR = 0.004, KF = 0.0025, KH = 0.22, KC = 0.6, ACC = plain ? 0 : 0.06, ED = plain ? 0 : 0.72;
  for (let y = 0; y < rows; y++) {
    const ltr = (y & 1) === 0;
    for (let xi = 0; xi < cols; xi++) {
      const x = ltr ? xi : cols - 1 - xi, i = y * cols + x, dx = ltr ? 1 : -1;
      const r0 = T[i * 3], g0 = T[i * 3 + 1], b0 = T[i * 3 + 2];
      const rw = Math.min(1.1, Math.max(-0.1, Wf(r0) + E[i * 3])), gw = Math.min(1.1, Math.max(-0.1, Wf(g0) + E[i * 3 + 1])), bw = Math.min(1.1, Math.max(-0.1, Wf(b0) + E[i * 3 + 2]));
      const r = Wi(rw), g = Wi(gw), b = Wi(bw);
      oklab(r, g, b, tl); oklab(r0, g0, b0, Tl);
      const L = Tl[0], C = Math.hypot(Tl[1], Tl[2]), hue = Math.atan2(Tl[2], Tl[1]);
      // the region's warmth: reds, oranges and yellows are warm (an Oklab hue from about -20 to 110 degrees)
      const warmth = C < 0.025 ? 0.5 : (hue > -0.35 && hue < 1.9 ? 1 : 0);
      // pigments already laid beside this cell: the one before it on the row and the three above
      const nb = [];
      if (xi > 0) nb.push(out[i - dx]);
      if (y > 0) for (const o of [-1, 0, 1]) { const xx = x + o; if (xx >= 0 && xx < cols) nb.push(out[i - cols + o]); }
      // an accent: in the shadows the complement of the local hue, or ultramarine and violet; elsewhere a pigment of
      // the opposite warmth
      const shadow = L < 0.5 ? Math.min(1, (0.5 - L) / 0.15) : 0;
      const accent = rnd() < ACC * (0.6 + 0.6 * shadow);
      let best = -1, bc = Infinity;
      for (let j = 0; j < n; j++) {
        const p = P[j];
        if (accent) {
          if (!p.accent) continue;
          const comp = C > 0.03 && Math.cos(p.hue - hue) < -0.6 && p.C > 0.06;
          const cool = p.fam === 6 || p.fam === 7;
          if (shadow > 0.3 ? !(comp || cool) : !(warmth === 0.5 ? true : p.warm !== warmth && p.C > 0.05)) continue;
        }
        const d0 = tl[0] - p.lab[0], d1 = tl[1] - p.lab[1], d2 = tl[2] - p.lab[2], dv = L - p.lab[0];
        let c = d0 * d0 + d1 * d1 + d2 * d2 + KV * dv * dv * (accent ? 2 : 1);
        // the strokes keep near the local hue and its neighbours; a contrasting hue is left to the occasional accent
        if (!accent) c += KH * p.C * Math.min(1, C * 12) * (1 - Math.cos(p.hue - hue));
        // an accent is no more vivid than the place where it is laid allows
        else { const ex = Math.max(0, p.C - C - 0.08); c += KC * ex * ex; }
        for (const q of nb) if (q === j) c += KR; else if (q >= 0 && P[q].fam === p.fam) c += KF;
        if (c < bc) { bc = c; best = j; }
      }
      if (best < 0) best = n - 1;
      out[i] = best;
      // the difference between the colour wanted and the pigment laid goes to the cells not yet painted
      // (damped, so that the neighbours do not swing to contrasting colours to make up for it)
      const q = P[best].lin, er = (rw - Wf(q[0])) * ED, eg = (gw - Wf(q[1])) * ED, eb = (bw - Wf(q[2])) * ED;
      const spread = (xx, yy, k) => { if (xx < 0 || xx >= cols || yy >= rows) return; const m = (yy * cols + xx) * 3; E[m] += er * k; E[m + 1] += eg * k; E[m + 2] += eb * k; };
      spread(x + dx, y, 7 / 16); spread(x - dx, y + 1, 3 / 16); spread(x, y + 1, 5 / 16); spread(x + dx, y + 1, 1 / 16);
    }
  }
  return out;
}

function opticalOil(srcTex, w, h, o) {
  const g = ctx(), s = h / 800, seed = o.seed ?? 1, rnd = mulberry(seed * 104729 + 7), S = o.stroke ?? 1, imp = o.impasto ?? 1;
  const cell = (o.radius ?? 6) * 1.35 * s, fine = Math.max(2 * s, cell * 0.55);
  const tfm = orientation(srcTex, w, h, 2.5 * s, 0.01, seed);
  const A = target(w, h), tmp = target(w, h), cb = target(w, h), cf = target(w, h), det = target(w, h);
  kuwahara(srcTex, tfm, Math.max(2 * s, cell * 0.6), A, 8);
  const tfm2 = orientation(A, w, h, 5.0 * s, 0.006, seed);
  // the colours wanted, averaged over a cell of each lattice
  blur(A, 0.45 * cell, tmp, cb); blur(A, 0.45 * fine, tmp, cf);
  pass(OIL_DETAIL, { tSrc: srcTex }, det); blur(det, 3 * s, tmp, det);
  const dw = Math.ceil(w / 2), dh = Math.ceil(h / 2), small = target(dw, dh, THREE.FloatType);
  const read = rt => { pass(COPY, { tSrc: rt, uGain: 1 }, small); return readTarget(small); };
  const RB = read(cb), RF = read(cf), RT = read(tfm2), RD = read(det);
  small.dispose();
  // x, y in pixels with y up, as the targets are read
  const at = (x, y) => (Math.min(dh - 1, Math.max(0, Math.floor(y / 2))) * dw + Math.min(dw - 1, Math.max(0, Math.floor(x / 2)))) * 4;
  const P = palette(), strokes = [], ends = [];
  // a broad lattice over the whole picture, then a fine one laid only where the picture has detail
  for (const [li, cs] of [[0, cell], [1, fine]]) {
    const cols = Math.ceil(w / cs) + 1, rows = Math.ceil(h / cs) + 1, R = li ? RF : RB, T = new Float32Array(cols * rows * 3);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const k = at((x + 0.5) * cs, (y + 0.5) * cs), m = (y * cols + x) * 3;
      T[m] = toLin(R[k]); T[m + 1] = toLin(R[k + 1]); T[m + 2] = toLin(R[k + 2]); }
    // the fine strokes only sharpen the edges and details: each takes the pigment nearest the colour there, so that
    // they do not lay a second, contrasting mixture over the finished broad one
    const pick = divide(T, cols, rows, rnd, li === 1), layer = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const cx = (x + 0.5 + (rnd() - 0.5) * 0.5) * cs, cy = (y + 0.5 + (rnd() - 0.5) * 0.5) * cs;
      if (li && RD[at(cx, cy)] < 0.45 + 0.15 * rnd()) continue;
      const t = at(cx, cy); let ang = Math.atan2(RT[t + 1], RT[t]) + (rnd() - 0.5) * 0.5;
      const sgn = rnd() < 0.5 ? 1 : -1, c = P[pick[y * cols + x]].srgb;
      const len = cs * (1.15 + 0.45 * S) * (0.9 + 0.2 * rnd()), wid = cs * (1.25 + 0.15 * rnd());
      // the order of painting: a slow sweep across the canvas, broken up at random
      const ord = 0.5 * (Math.sin(cx / w * 2.3 + seed) * Math.cos(cy / h * 1.7 - seed) + 1) * 0.5 + rnd() * 0.5;
      layer.push([ord, cx, cy, len, wid, Math.cos(ang) * sgn, Math.sin(ang) * sgn, rnd(), 0, c[0], c[1], c[2], 1]);
    }
    layer.sort((a, b) => a[0] - b[0]);
    for (const k of layer) strokes.push(k);
    ends.push(strokes.length);
  }
  const n = strokes.length, iA = new Float32Array(n * 4), iB = new Float32Array(n * 4), iC = new Float32Array(n * 4);
  strokes.forEach((k, i) => { iA.set(k.slice(1, 5), i * 4); iB.set(k.slice(5, 9), i * 4); iC.set(k.slice(9, 13), i * 4); });
  const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0.5, 0, 0);
  const ig = new THREE.InstancedBufferGeometry(); ig.index = geo.index; ig.attributes.position = geo.attributes.position; ig.attributes.uv = geo.attributes.uv;
  ig.setAttribute('iA', new THREE.InstancedBufferAttribute(iA, 4)); ig.setAttribute('iB', new THREE.InstancedBufferAttribute(iB, 4)); ig.setAttribute('iC', new THREE.InstancedBufferAttribute(iC, 4));
  const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: `precision highp float;\n` + OPT_VERT, fragmentShader: OPT_FRAG,
    uniforms: { uRes: { value: new THREE.Vector2(w, h) }, uFirst: { value: 0 } }, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  const mesh = new THREE.Mesh(ig, mat); mesh.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(mesh);
  // the canvas: a pale primed ground, with no paint on it
  const paint = target(w, h);
  g.renderer.setRenderTarget(paint); g.renderer.setClearColor(new THREE.Color(0.9, 0.87, 0.8), 0.05); g.renderer.clear();
  const all = [tfm, tfm2, A, tmp, cb, cf, det, paint];
  const dispose = () => { all.forEach(t => t.dispose()); mat.dispose(); geo.dispose(); ig.dispose(); };
  // progressive: the broad strokes over the bare ground, then the fine ones
  const span = [[0.02, 0.8], [0.8, 1.0]];
  const countAt = t => { if (t >= 1) return n; let c = 0;
    for (let i = 0; i < 2; i++) { const lo = i ? ends[i - 1] : 0, [t0, t1] = span[i]; c = t <= t0 ? c : lo + Math.round((ends[i] - lo) * Math.min(1, (t - t0) / (t1 - t0))); if (t < t1) break; }
    return c; };
  let drawn = 0;
  const frame = t => {
    const upto = countAt(t);
    if (upto > drawn) { ig.instanceCount = upto; mat.uniforms.uFirst.value = drawn; g.renderer.setRenderTarget(paint); g.renderer.render(sc, g.cam); drawn = upto; }
    const dbg = { A, paint, det }[o.debug]; if (dbg) return show(dbg, w, h);
    pass(OPT_FINAL, { tPaint: paint, uImpasto: imp, uFill: upto >= ends[0] ? 1 : 0 }, null, { w, h });
  };
  return { frame, dispose };
}

/* ---------- helpers for the painted strokes ---------- */
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

/* ---------- woodcut ----------
   A relief print from a carved block of plank wood, in black ink on off-white paper. The picture is simplified with
   the Kuwahara filter, and its values set the width of parallel cuts: the uncut wood between them prints as black
   lines, which swell into solid black in the shadows, where the cuts narrow to thin white gouges, and taper to
   nothing in the lights, where the wood is cleared away. The cuts follow the forms: on the land they run along the
   flow of the structure tensor, as a phasor noise of Gabor kernels each turned to the flow at its centre, and run
   level where the flow has no clear direction; the sky, found by filling from the top of the picture, is cut in
   level lines that grow heavier towards the top, and the sea, filled from beneath the horizon, in wavy ones. Outlines are cut round the edges of the picture's shapes with a slightly wandering knife, and where
   two dark shapes meet they are gouged white instead. The ink shows the grain of the plank and the unevenness of
   the press, and the paper its fibres. With colour blocks, the picture's main colours (found by k-means) are first
   printed flat from blocks of their own, slightly out of register, the sky graded as in bokashi, and the key block
   carries only the outlines and the darker tones. While it is shown being made, a single block is carved, lightest
   places first; with colour blocks, the impressions are printed one after another.
   opts: spacing (line spacing in pixels, default 9), weight (boldness of the black, default 1), contrast
         (default 1), outline (default 1), colours (number of colour blocks, 0 to 4, default 0), grain (default 1) */
const WOOD_TONE = `uniform sampler2D tSrc; uniform float uLo, uHi, uContrast, uWeight;
void main(){ vec3 c=texture(tSrc,vUv).rgb; float L=mix(lum(c),max(c.r,max(c.g,c.b)),0.3);
  float d=clamp((uHi-L)/max(uHi-uLo,0.1),0.0,1.0);
  // values pushed apart about the middle, then darkened or lightened as a whole
  float g=0.5+0.8*uContrast; float a=pow(d,g), b=pow(1.0-d,g); d=a/max(a+b,1e-6);
  d=pow(d,1.25/max(uWeight,0.05));
  fragColor=vec4(d,L,0.0,1.0); }`;

// the cuts: the distance from the middle of the nearest line of uncut wood, 0 on it and 1 halfway to the next
const WOOD_LINES = `uniform sampler2D tTfm, tMask; uniform float uSpacing, uHorizon;
float tri(float ph){ return abs(fract(ph+0.5)-0.5)*2.0; }
void main(){
  vec2 p=vUv*uRes/uS; float lam=uSpacing;
  vec2 m=texture(tMask,vUv).rg; float prof;
  if (m.r>0.5){
    // the sky: level cuts, wavering a little as a hand-held gouge does
    prof=tri((p.y+lam*0.9*(fbm3(vec2(p.x*0.004,p.y*0.015)+uSeed)-0.5))/lam);
  } else if (m.g>0.5){
    // the sea: wavy cuts, the waves growing with the distance from the horizon
    float dist=max(uHorizon-p.y,0.0);
    float A=lam*mix(0.15,0.55,smoothstep(0.0,320.0,dist));
    float xc=(p.x-0.5*uRes.x/uS)*mix(1.7,1.0,smoothstep(0.0,300.0,dist));
    float wv=sin(2.0*PI*(xc/34.0+1.3*fbm3(vec2(p.x*0.005,p.y/(3.0*lam))+uSeed+21.0)));
    wv=0.8*wv+0.6*(fbm3(vec2(p.x*0.02,p.y/(3.0*lam))+uSeed+27.0)-0.5);
    prof=tri((p.y+A*wv)/lam);
  } else {
    // the land: phasor noise, a sum of Gabor kernels whose waves cross the flow of the picture
    float f=1.0/lam, sk=1.8*lam, C=2.6*sk; vec2 ci=floor(p/C); vec2 acc=vec2(0.0);
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){ vec2 c=ci+vec2(i,j);
      for (int k=0;k<8;k++){ vec2 xi=(c+hash22(c*1.37+float(k)*7.31+uSeed))*C;
        // where the flow has no clear direction, as on a paved floor, the cuts run level
        vec4 tf=texture(tTfm,xi*uS/uRes); vec2 t=tf.x<0.0 ? -tf.xy : tf.xy; t=normalize(mix(vec2(1.0,0.0),t,smoothstep(0.08,0.35,tf.w))+1e-6);
        vec2 w=vec2(-t.y,t.x); if (w.y<0.0||(w.y==0.0&&w.x<0.0)) w=-w;
        vec2 d=p-xi; float g=exp(-dot(d,d)/(2.0*sk*sk));
        float th=2.0*PI*f*dot(d,w)+6.2831853*hash12(c*2.17+float(k)*3.9+uSeed+5.0);
        acc+=g*vec2(cos(th),sin(th)); } }
    prof=abs(atan(acc.y,acc.x))/PI;
  }
  fragColor=vec4(prof,0.0,0.0,1.0); }`;

// the strength of the edges of the picture's shapes, in colour, per pixel of a picture 800 pixels high
const WOOD_EDGE = `uniform sampler2D tSrc;
void main(){ vec2 d=1.0/uRes;
  vec3 a=texture(tSrc,vUv+d*vec2(-1,-1)).rgb, b=texture(tSrc,vUv+d*vec2(0,-1)).rgb, c=texture(tSrc,vUv+d*vec2(1,-1)).rgb;
  vec3 e=texture(tSrc,vUv+d*vec2(-1,0)).rgb, f=texture(tSrc,vUv+d*vec2(1,0)).rgb;
  vec3 g=texture(tSrc,vUv+d*vec2(-1,1)).rgb, h=texture(tSrc,vUv+d*vec2(0,1)).rgb, i=texture(tSrc,vUv+d*vec2(1,1)).rgb;
  vec3 gx=(c+2.0*f+i-a-2.0*e-g)*0.125, gy=(g+2.0*h+i-a-2.0*b-c)*0.125;
  fragColor=vec4(sqrt(dot(gx,gx)+dot(gy,gy))*uS,0.0,0.0,1.0); }`;

const WOOD_FINAL = `uniform sampler2D tTone, tLines, tEdge, tA, tMask; uniform float uOutline, uGrain, uN, uSky, uSea, uHorizon;
uniform vec3 uPal[4], uCen[4]; uniform vec2 uReg[4];
const vec3 PAPER=vec3(0.946,0.927,0.878), INK=vec3(0.06,0.055,0.06);
// the grain of the plank, which runs across the block: rings wandering round the knots, and fine fibres
float grain(vec2 p){
  vec2 q=p+vec2(0.0,40.0*fbm3(p*vec2(0.0012,0.004)+uSeed+70.0));
  float ring=0.5+0.5*sin(q.y*0.38+9.0*fbm3(vec2(q.x*0.0025,q.y*0.02)+uSeed+72.0));
  float g=smoothstep(0.55,0.95,ring)*(0.4+0.6*fbm3(vec2(p.x*0.01,p.y*0.12)+uSeed+74.0));
  return clamp(g+0.5*smoothstep(0.62,0.9,vnoise(vec2(p.x*0.04,p.y*0.9)+uSeed)),0.0,1.0); }
// a crisp step of x past the edge e, smoothed over a pixel
// colours are compared by lightness and by two opponent differences weighted twice, so that hues are kept apart
vec3 opp(vec3 c){ return vec3(lum(c),2.0*(c.r-c.g),2.0*(0.5*(c.r+c.g)-c.b)); }
float cut(float e, float x){ float fw=max(fwidth(x),1e-4); return clamp((x-e)/fw+0.5,0.0,1.0); }
void main(){
  vec2 px=vUv*uRes, p=px/uS;
  // the knife wanders a little from the drawn line
  vec2 wob=(vec2(fbm3(p*0.025+uSeed+5.0),fbm3(p*0.025+uSeed+9.0))-0.5)*2.0*uS/uRes;
  float d=texture(tTone,vUv+wob).r, prof=texture(tLines,vUv).r;
  bool colour=uN>0.5; vec2 mk=texture(tMask,vUv).rg;
  // a single block cuts the whole sky in lines, heavier towards the top and tapering towards the horizon
  float up=clamp((p.y-uHorizon)/max(uRes.y/uS-uHorizon,1.0),0.0,1.0);
  if (mk.r>0.5 && !colour) d=max(d,0.1+0.3*up*up);
  // the key block: with colour blocks under it, it carries only the darker tones
  float dk=colour ? clamp((d-0.42)/0.58,0.0,1.0) : d;
  // the width of the uncut wood, a little uneven (in the sky each line on its own, so that the lines end one by
  // one), with the finest lines cleared away and the darkest left whole
  float nz=mk.r>0.5 ? 0.1*(vnoise(vec2(p.x*0.015,p.y*0.5)+uSeed+3.0)-0.5) : 0.06*(vnoise(p*0.06+uSeed+3.0)-0.5);
  float wl=dk+nz*smoothstep(0.0,0.2,dk);
  float fw=clamp(fwidth(prof),0.02,0.4);
  wl = wl<1.1*fw ? 0.0 : (wl>1.0-0.9*fw ? 1.0 : wl);
  float k=wl<=0.0 ? 0.0 : (wl>=1.0 ? 1.0 : 1.0-cut(wl,prof));
  // outlines round the shapes, cut black, or gouged white where both sides are dark
  float e=texture(tEdge,vUv+wob).r*(0.8+0.4*vnoise(p*0.04+uSeed+11.0));
  float ol=cut(0.05/max(uOutline,0.05),e)*step(0.01,uOutline);
  vec2 o=2.5*uS/uRes; float dmin=min(min(texture(tTone,vUv+vec2(o.x,0)).r,texture(tTone,vUv-vec2(o.x,0)).r),
    min(texture(tTone,vUv+vec2(0,o.y)).r,texture(tTone,vUv-vec2(0,o.y)).r));
  float gouge=smoothstep(0.78,0.86,dmin);
  k=mix(max(k,ol),k*(1.0-ol),gouge);
  // the print as it is being made
  float sweep=clamp(vUv.x*0.85+0.3*(fbm3(p*0.004+uSeed+44.0)-0.5)+0.08,0.0,1.0);
  if (uT<1.0 && !colour){
    // a single block carved, the lightest places cleared first and the fine cuts in the shadows last
    float ord=clamp(0.7*d+0.35*(fbm3(p*0.006+uSeed+33.0)-0.5)+0.12,0.0,1.0);
    if (uT<0.02+0.95*ord) k=1.0;
  }
  float keyOn = (uT>=1.0||!colour) ? 1.0 : step((uN+sweep)/(uN+1.0),uT);
  // the paper and its fibres
  vec3 col=PAPER*(1.0+0.035*(fbm(p*0.35+uSeed+50.0)-0.5)+0.02*(vnoise(vec2(p.x*0.6,p.y*0.15)+uSeed)-0.5));
  // the colour blocks: the nearest of the palette's colours, or the paper where it is nearest
  if (colour){
    float best=1e9, second=1e9; int bi=-1;
    for (int i=0;i<4;i++){ if (float(i)>=uN) break;
      vec3 dc=opp(texture(tA,vUv+uReg[i]*uS/uRes).rgb)-opp(uCen[i]); float dd=dot(dc,dc);
      if (dd<best){ second=best; best=dd; bi=i; } else if (dd<second) second=dd; }
    vec3 dp=opp(texture(tA,vUv).rgb)-opp(vec3(0.97,0.96,0.94)); float dpaper=dot(dp,dp)*0.8;
    float op=1.0;
    if (mk.r>0.5 && uSky>=0.0){ bi=int(uSky); op=mix(0.18,1.0,smoothstep(0.05,0.85,d)); dpaper=1e9; }
    else if (mk.g>0.5 && uSea>=0.0){ bi=int(uSea); op=mix(0.55,1.0,d); dpaper=1e9; }
    if (dpaper<best) bi=-1;
    if (bi>=0){
      vec3 pig=vec3(0.0); vec2 reg=vec2(0.0);
      for (int i=0;i<4;i++) if (i==bi){ pig=uPal[i]; reg=uReg[i]; }
      // the pigment, brushed on the block with water, prints a little mottled
      vec2 q=p+reg;
      op*=0.8+0.2*fbm(q*0.06+uSeed+float(bi)*7.0)-0.12*step(0.93,vnoise(q*0.7+uSeed+float(bi)));
      op*=max(step((float(bi)+sweep)/(uN+1.0),uT),step(1.0,uT));
      col*=mix(vec3(1.0),pig/PAPER,clamp(op,0.0,1.0));
    }
  }
  // the ink: uneven over the sheet, lighter along the grain, with tiny gaps where the paper missed it
  float dens=0.93+0.1*(fbm3(p*0.005+uSeed+60.0)-0.5);
  dens*=1.0-uGrain*0.16*grain(p);
  dens*=1.0-uGrain*0.7*step(0.996,hash12(floor(vec2(p.x*0.35,p.y*1.4))+uSeed));
  col=mix(col,INK,clamp(k*keyOn,0.0,1.0)*clamp(dens,0.0,1.0));
  fragColor=vec4(clamp(col,0.0,1.0),1.0); }`;

// the sky and the sea, found on a small copy of the simplified picture (rows from the top, values 0 to 1): the sky is
// filled from the top of the picture through small steps of colour, and cut off where it starts to darken again below
// the horizon; the sea is filled from beneath the cut. Returns the two masks and the horizon's height (0 at the foot)
function skyAndSea(px, mw, mh) {
  const N = mw * mh, at = (x, y) => ((mh - 1 - y) * mw + x) * 4;   // the pixels are read from the foot up
  const L = new Float32Array(N), C = new Float32Array(N * 3);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) { const i = y * mw + x, j = at(x, y);
    C[i * 3] = px[j]; C[i * 3 + 1] = px[j + 1]; C[i * 3 + 2] = px[j + 2]; L[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]; }
  const step = (a, b) => Math.max(Math.abs(C[a * 3] - C[b * 3]), Math.abs(C[a * 3 + 1] - C[b * 3 + 1]), Math.abs(C[a * 3 + 2] - C[b * 3 + 2]));
  const fill = (mask, seeds, tol, ok) => {
    const q = seeds.slice(); for (const s of seeds) mask[s] = 1;
    while (q.length) { const i = q.pop(), x = i % mw, y = (i - x) / mw;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue;
        const n = ny * mw + nx; if (mask[n] || step(i, n) > tol || !ok(n, ny)) continue; mask[n] = 1; q.push(n); } }
  };
  // the sky: seeded from the top row where it is near the row's middle colour
  const sky = new Uint8Array(N), top = [];
  const med = k => { const v = []; for (let x = 0; x < mw; x++) v.push(C[x * 3 + k]); v.sort((a, b) => a - b); return v[mw >> 1]; };
  const m0 = [med(0), med(1), med(2)];
  for (let x = 0; x < mw; x++) if (Math.max(Math.abs(C[x * 3] - m0[0]), Math.abs(C[x * 3 + 1] - m0[1]), Math.abs(C[x * 3 + 2] - m0[2])) < 0.08) top.push(x);
  if (top.length > mw * 0.2) fill(sky, top, 0.022 * 480 / mh, () => true);
  // in each column the sky ends where it starts to darken after its lightest point, as the sea does below the horizon
  const cutRows = [], bottoms = [];
  for (let x = 0; x < mw; x++) {
    let y = 0, best = -1, by = -1; while (y < mh && sky[y * mw + x]) { if (L[y * mw + x] > best) { best = L[y * mw + x]; by = y; } y++; }
    if (y === 0) continue; let c = -1;
    for (let k = by + 1; k < y; k++) if (L[k * mw + x] < best - 0.03) { c = k; break; }
    if (c >= 0) { cutRows.push(c); for (let k = c; k < mh; k++) sky[k * mw + x] = 0; } else bottoms.push(y);
  }
  const median = a => { const v = a.slice().sort((p, q) => p - q); return v[v.length >> 1]; };
  const horizon = cutRows.length > mw * 0.08 ? median(cutRows) : bottoms.length ? median(bottoms) : Math.round(mh * 0.4);
  // the sea: seeded just beneath the sky wherever the sky reaches down to the horizon and the colour there is of the
  // same hue as the sky above the horizon, or close to it, as the sea reflects the sky; it is filled through small
  // steps of colour, as long as it stays near the colour of the seeds or is bluer than it is red
  const sk = [0, 0, 0]; let ns = 0;
  for (let y = Math.max(0, Math.round(horizon - mh * 0.04)); y < horizon; y++) for (let x = 0; x < mw; x++) { const i = y * mw + x;
    if (sky[i]) { sk[0] += C[i * 3]; sk[1] += C[i * 3 + 1]; sk[2] += C[i * 3 + 2]; ns++; } }
  const sea = new Uint8Array(N), seeds = [];
  if (ns) {
    sk.forEach((v, k) => { sk[k] = v / ns; });
    const chroma = c => { const l = (c[0] + c[1] + c[2]) / 3; return [c[0] - l, c[1] - l, c[2] - l]; }, ck = chroma(sk), nk = Math.hypot(...ck);
    for (let x = 0; x < mw; x++) { let y = 0; while (y < mh && sky[y * mw + x]) y++;
      const i = Math.min(mh - 1, y + Math.max(2, Math.round(mh * 0.006))) * mw + x;
      if (Math.abs(y - horizon) > mh * 0.015 || sky[i]) continue;
      const c = [C[i * 3], C[i * 3 + 1], C[i * 3 + 2]], cc = chroma(c), nc = Math.hypot(...cc);
      const sameHue = nc > 0.02 && nk > 0.02 && (cc[0] * ck[0] + cc[1] * ck[1] + cc[2] * ck[2]) / (nc * nk) > 0.75;
      if (sameHue || Math.max(...c.map((v, k) => Math.abs(v - sk[k]))) < 0.1) seeds.push(i); }
  }
  if (seeds.length > mw * 0.04) {
    // where the sea is seen the sky does not reach below the horizon: what the sky's fill found there is hazy land or sea
    for (let i = Math.ceil(horizon + mh * 0.006) * mw; i < N; i++) sky[i] = 0;
    const sm = [0, 1, 2].map(k => median(seeds.map(s => C[s * 3 + k])));
    const near = (n, t) => Math.max(Math.abs(C[n * 3] - sm[0]), Math.abs(C[n * 3 + 1] - sm[1]), Math.abs(C[n * 3 + 2] - sm[2])) < t;
    for (let i = (horizon + 2) * mw; i < N; i++) if (!sky[i] && near(i, 0.04)) seeds.push(i);
    const ok = (n, ny) => ny > horizon && !sky[n] && (near(n, 0.25) || C[n * 3 + 2] > C[n * 3] + 0.12);
    fill(sea, seeds, 0.035 * 480 / mh, ok);
    // parts of the sea cut off from the rest, behind a boat or a pier, have the colour of the sea found so far
    const found = []; for (let i = 0; i < N; i++) if (sea[i]) found.push(i);
    const fm = [0, 1, 2].map(k => median(found.map(s => C[s * 3 + k])));
    const more = []; for (let i = (horizon + 2) * mw; i < N; i++) if (!sea[i] && !sky[i] &&
      Math.max(Math.abs(C[i * 3] - fm[0]), Math.abs(C[i * 3 + 1] - fm[1]), Math.abs(C[i * 3 + 2] - fm[2])) < 0.04) more.push(i);
    if (more.length) fill(sea, more, 0.035 * 480 / mh, ok);
    // small patches enclosed by the sea, such as the shadows of waves, are sea too
    const seen = new Int32Array(N); let id = 0;
    for (let i = (horizon + 1) * mw; i < N; i++) { if (sea[i] || sky[i] || seen[i]) continue;
      const comp = [i], q = [i]; seen[i] = ++id; let open = false;
      while (q.length && comp.length < N * 0.003) { const j = q.pop(), x = j % mw, y = (j - x) / mw;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) { open = true; continue; }
          const n = ny * mw + nx; if (sky[n] || (seen[n] && seen[n] !== id)) open = true;
          if (sea[n] || sky[n] || seen[n]) continue; seen[n] = id; comp.push(n); q.push(n); } }
      if (!open && !q.length) for (const j of comp) sea[j] = 1; }
  }
  return { sky, sea, horizon: (mh - horizon) / mh, C };
}

// the picture's main colours by k-means, for the colour blocks: the paper is a fixed colour of its own
function woodPalette(C, n, k, rnd) {
  const pts = []; for (let i = 0; i < n; i += 3) pts.push([C[i * 3], C[i * 3 + 1], C[i * 3 + 2]]);
  const opp = c => [0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2], 2 * (c[0] - c[1]), 2 * (0.5 * (c[0] + c[1]) - c[2])];
  const paper = [0.97, 0.96, 0.94], d2 = (a, b) => { const p = opp(a), q = opp(b); return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; };
  const cs = [];
  for (let c = 0; c < k; c++) { // k-means++ seeding, away from the paper and the colours chosen so far
    const D = pts.map(p => Math.min(d2(p, paper), ...cs.map(q => d2(p, q)))), tot = D.reduce((a, b) => a + b, 0);
    let r = rnd() * tot, i = 0; while (i < pts.length - 1 && (r -= D[i]) > 0) i++; cs.push(pts[i].slice()); }
  for (let it = 0; it < 10; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (const p of pts) { let bi = -1, bd = d2(p, paper); cs.forEach((q, j) => { const d = d2(p, q); if (d < bd) { bd = d; bi = j; } });
      if (bi >= 0) { const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; } }
    sum.forEach((s, j) => { if (s[3]) cs[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  return cs;
}

function woodcut(srcTex, w, h, o) {
  const s = h / 800, seed = o.seed ?? 1, sd = (seed % 997) * 0.173, nc = Math.max(0, Math.min(4, Math.round(o.colours ?? 0)));
  const tfm0 = orientation(srcTex, w, h, 2.0 * s, 0.01, sd);
  const A = target(w, h), tmp = target(w, h), B = target(w, h), tone = target(w, h), edge = target(w, h),
    lines = target(w, h, THREE.FloatType);
  kuwahara(srcTex, tfm0, 4 * s, A, 8);
  // a small copy on the CPU, for the sky and the sea, the range of values and the colours
  const mh = Math.min(h, 400), mw = Math.max(8, Math.round(mh * w / h)), small = target(mw, mh, THREE.FloatType);
  pass(COPY, { tSrc: A, uGain: 1 }, small);
  const ss = skyAndSea(readTarget(small), mw, mh); small.dispose();
  const Ls = []; for (let i = 0; i < mw * mh; i += 7) Ls.push(0.7 * (0.299 * ss.C[i * 3] + 0.587 * ss.C[i * 3 + 1] + 0.114 * ss.C[i * 3 + 2]) + 0.3 * Math.max(ss.C[i * 3], ss.C[i * 3 + 1], ss.C[i * 3 + 2]));
  Ls.sort((a, b) => a - b);
  const lo = Math.min(0.4, Ls[Math.floor(Ls.length * 0.02)]), hi = Math.max(lo + 0.3, Math.min(0.98, Ls[Math.floor(Ls.length * 0.97)]));
  const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
  const mx = mc.getContext('2d'), im = mx.createImageData(mw, mh);
  for (let i = 0; i < mw * mh; i++) { im.data[i * 4] = ss.sky[i] * 255; im.data[i * 4 + 1] = ss.sea[i] * 255; im.data[i * 4 + 3] = 255; }
  mx.putImageData(im, 0, 0); const mask = sourceTexture(mc);
  pass(WOOD_TONE, { tSrc: A, uLo: lo, uHi: hi, uContrast: o.contrast ?? 1, uWeight: o.weight ?? 1 }, tone);
  blur(A, 1.8 * s, tmp, B); pass(WOOD_EDGE, { tSrc: B }, edge);
  const tfm = orientation(A, w, h, 24 * s, 0.02, sd, 0.15);
  pass(WOOD_LINES, { tTfm: tfm, tMask: mask, uSpacing: o.spacing ?? 9, uHorizon: ss.horizon * 800, uSeed: sd }, lines);
  // the colour blocks, each a little out of register with the key block
  const rnd = mulberry(seed * 7 + 3), pal = nc ? woodPalette(ss.C, mw * mh, nc, rnd) : [];
  const nearest = (m) => { let bi = -1, bd = 1e9; pal.forEach((q, j) => { const d = (q[0] - m[0]) ** 2 + (q[1] - m[1]) ** 2 + (q[2] - m[2]) ** 2; if (d < bd) { bd = d; bi = j; } }); return bi; };
  const meanOf = msk => { const m = [0, 0, 0]; let n = 0; for (let i = 0; i < msk.length; i++) if (msk[i]) { m[0] += ss.C[i * 3]; m[1] += ss.C[i * 3 + 1]; m[2] += ss.C[i * 3 + 2]; n++; } return n > msk.length * 0.01 ? m.map(v => v / n) : null; };
  const skyC = meanOf(ss.sky), seaC = meanOf(ss.sea);
  const pigment = c => { const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; return new THREE.Vector3(...c.map(v => Math.min(0.96, Math.max(0.02, v + (v - l) * 0.15) * 0.96 + 0.03))); };
  const U = { tTone: tone, tLines: lines, tEdge: edge, tA: A, tMask: mask, uHorizon: ss.horizon * 800, uOutline: o.outline ?? 1, uGrain: o.grain ?? 1, uN: pal.length,
    uSky: skyC && pal.length ? nearest(skyC) : -1, uSea: seaC && pal.length ? nearest(seaC) : -1, uSeed: sd,
    uPal: [0, 1, 2, 3].map(i => pal[i] ? pigment(pal[i]) : new THREE.Vector3()), uCen: [0, 1, 2, 3].map(i => new THREE.Vector3(...(pal[i] || [0, 0, 0]))),
    uReg: [0, 1, 2, 3].map(() => new THREE.Vector2((rnd() - 0.5) * 3, (rnd() - 0.5) * 3)) };
  const all = [tfm0, tfm, A, tmp, B, tone, edge, lines, mask], dispose = () => all.forEach(t => t.dispose());
  if (o.debug === 'mask') return { frame: () => pass(COPY, { tSrc: mask, uGain: 1 }, null, { w, h }), dispose };
  const dbg = { A, tone, lines, edge }[o.debug]; if (dbg) return { frame: () => show(dbg, w, h, o.debug === 'edge' ? 8 : 1), dispose };
  return { dispose, frame: t => pass(WOOD_FINAL, { ...U, uT: t }, null, { w, h }) };
}

/* ---------- Van Gogh ----------
   Painted in the manner of Van Gogh's late work: long, curving strokes of thick paint that follow the forms of the
   picture and wind into eddies in the sky, laid side by side in parallel rows over a thin underpainting. The colours
   are raised in saturation and drawn towards a small palette of chrome yellow, orange, viridian and ultramarine, with
   the shadows in Prussian blue, and each stroke carries streaks of a second, lighter or neighbouring colour. Strong
   edges are outlined with dark blue strokes. The strokes are traced along the orientation of the picture, stopping
   where its colour changes, and in the sky along a field of vortices placed in the open sky and about the sun.
   opts: size (stroke size, default 1), swirl (eddies in the sky, default 1), colour (intensity, default 1),
         outline (dark outlines, default 1), impasto (relief of the paint, default 1),
         stars (default 1: size and number of the stars painted where the sky has them),
         distort (default 0: how far the forms of the picture are bent into waves and flames before it is painted) */
const VG_VERT = `precision highp float; in vec3 position; in vec2 uv; in vec3 aC1; in vec3 aC2; in vec2 aP;
uniform vec2 uRes; out vec2 vUv; out vec3 vC1; out vec3 vC2; out vec2 vP;
void main(){ vUv=uv; vC1=aC1; vC2=aC2; vP=aP; gl_Position=vec4(position.xy/uRes*2.0-1.0,0.0,1.0); }`;

const VG_FRAG = `precision highp float; in vec2 vUv; in vec3 vC1; in vec3 vC2; in vec2 vP; out vec4 fragColor; uniform float uHeight;
float h1(float n){ return fract(sin(n)*43758.5453); }
float vn1(float x, float s){ float i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f); return mix(h1(i+s),h1(i+1.0+s),f); }
void main(){
  float u=vUv.x, v=vUv.y, seed=vP.x*97.0, load=vP.y;
  // the outline of the stroke: full where the loaded brush lands, narrowing a little and breaking up where it lifts
  float half_=0.98-0.22*u, edgeN=0.12*(vn1(u*9.0,seed)-0.5);
  float side=1.0-smoothstep(half_-0.2,half_,abs(v)+edgeN);
  float start=smoothstep(0.0,0.07,u-0.05*v*v), end=1.0-smoothstep(0.84,1.0,u+0.1*vn1(v*5.0,seed+3.0));
  // bristle grooves along the stroke, and the paint running out towards its end
  float br=vn1(v*10.0+seed,seed)*0.6+vn1(v*25.0,seed+7.0)*0.4;
  float dry=smoothstep(load-0.2,load+0.12,u*0.75+0.35*br);
  float a=clamp(side*start*end*(1.0-0.75*dry*(1.0-br))*1.2,0.0,1.0);
  if (a<0.02) discard;
  // streaks of the second colour picked up on the brush
  float band=smoothstep(0.5,0.66,vn1(v*3.2+seed*1.7,seed+11.0));
  vec3 col=mix(vC1,vC2,band)*(0.93+0.1*br);
  if (uHeight>0.5){ fragColor=vec4(vec3((0.3+0.7*br)*(1.0-0.35*u)),a); return; }
  fragColor=vec4(col,a); }`;

// the picture bent before it is painted: a slow sway that grows with height, as in the cypresses and hills of the late
// paintings, with smaller ripples over it
const VG_WARP = `uniform sampler2D tSrc; uniform float uAmt;
void main(){ vec2 p=vUv*uRes/uS;
  float sway=0.6*sin(p.y*0.011+uSeed*3.1)+2.0*(fbm3(p*0.0035+uSeed)-0.5);
  vec2 d=vec2(42.0*sway*(0.4+0.6*vUv.y)+36.0*(fbm3(p*0.009+uSeed+5.0)-0.5), 24.0*(fbm3(p*0.009+uSeed+9.0)-0.5))*uAmt;
  fragColor=texture(tSrc,clamp(vUv+d*uS/uRes,0.0,1.0)); }`;

// how far each point stands out above its surroundings, at half size: the largest excess in each 2 by 2 block, and the
// share of the block that is bright (large for the moon, small for a star)
const VG_STAR = `uniform sampler2D tSrc;
void main(){ vec2 d=1.0/vec2(textureSize(tSrc,0)); vec2 c=vUv; float best=0.0, bright=0.0, m=0.0;
  for (int y=-6;y<=6;y+=2) for (int x=-6;x<=6;x+=2) m+=lum(texture(tSrc,c+vec2(x,y)*d).rgb);
  m/=49.0;
  for (int y=-1;y<=0;y++) for (int x=-1;x<=0;x++){ float l=lum(texture(tSrc,c+(vec2(x,y)+0.5)*d).rgb); best=max(best,l-m); bright+=step(0.6,l)*0.25; }
  fragColor=vec4(best,bright,0.0,1.0); }`;

const VG_FINAL = `uniform sampler2D tPaint, tHeight; uniform float uImpasto;
void main(){
  vec2 d=1.0/uRes;
  float h=texture(tHeight,vUv).r;
  float hx=texture(tHeight,vUv+vec2(d.x,0)).r-texture(tHeight,vUv-vec2(d.x,0)).r;
  float hy=texture(tHeight,vUv+vec2(0,d.y)).r-texture(tHeight,vUv-vec2(0,d.y)).r;
  float k=2.6*uImpasto/uS;
  vec3 n=normalize(vec3(-hx*k,-hy*k,1.0)); vec3 L=normalize(vec3(-0.5,0.6,0.7));
  vec3 c=texture(tPaint,vUv).rgb;
  float diff=dot(n,L)/L.z;
  vec2 p=vUv*uRes/uS;
  float weave=0.5+0.5*sin(p.x*1.5)*sin(p.y*1.5);
  float spec=pow(max(dot(n,normalize(L+vec3(0,0,1))),0.0),30.0)*h;
  c*=1.0+(diff-1.0)*0.22*min(uImpasto,1.5); c*=1.0-0.035*weave; c+=vec3(1.0,0.97,0.88)*spec*0.16*min(uImpasto,1.5);
  fragColor=vec4(clamp(c,0.0,1.0),1.0); }`;

// the picture's colour moved towards Van Gogh's palette
const VG_HUES = [0.0, 0.075, 0.135, 0.2, 0.3, 0.44, 0.57, 0.63, 0.74];
function vgColour(c, k, sky) {
  let [hh, ss, vv] = rgb2hsv(c[0], c[1], c[2]);
  let best = VG_HUES[0], bd = 9;
  for (const q of VG_HUES) { const d = Math.abs(((hh - q + 1.5) % 1) - 0.5); if (d < bd) { bd = d; best = q; } }
  const dh = ((best - hh + 1.5) % 1) - 0.5;
  hh += dh * 0.55 * Math.min(1, k);
  ss = Math.min(1, ss * (1 + 0.55 * k) + 0.06 * k);
  vv = Math.min(1, Math.max(0, 0.5 + (vv - 0.5) * (1 + 0.15 * k)));
  let col = hsv2rgb(hh, ss, vv);
  const l = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2];
  // shadows in Prussian blue and ultramarine; in the sky the lights lean towards lemon and white
  if (l < 0.38) { const m = (0.38 - l) / 0.38 * 0.55 * Math.min(1, k); col = col.map((v, i) => v * (1 - m) + [0.1, 0.16, 0.36][i] * m); }
  if (sky && l > 0.75) { const m = (l - 0.75) * 1.2 * Math.min(1, k); col = col.map((v, i) => v * (1 - m) + [0.98, 0.95, 0.72][i] * m); }
  return col;
}

function vangogh(srcTex, w, h, o) {
  const g = ctx(), s = h / 800, rnd = mulberry((o.seed ?? 1) * 6007 + 11), SZ = o.size ?? 1, SW = o.swirl ?? 1, K = o.colour ?? 1, OL = o.outline ?? 1;
  const DI = o.distort ?? 0, bent = DI > 0 ? target(w, h) : null;
  if (bent) { pass(VG_WARP, { tSrc: srcTex, uAmt: DI, uSeed: ((o.seed ?? 1) % 89) * 0.37 }, bent); srcTex = bent.texture; }
  const tfm = orientation(srcTex, w, h, 9.0 * s, 0.012, (o.seed ?? 1) % 97, 1.0);
  const tmp = target(w, h), soft = [target(w, h), target(w, h), target(w, h)];
  const sig = [7 * s, 3 * s, 1.2 * s];
  pass(COPY, { tSrc: srcTex, uGain: 1 }, soft[2]);
  for (let i = 0; i < 3; i++) blur(soft[2], sig[i], tmp, soft[i]);
  const dw = Math.ceil(w / 2), dh = Math.ceil(h / 2), small = target(dw, dh, THREE.FloatType);
  const read = rt => { pass(COPY, { tSrc: rt, uGain: 1 }, small); return readTarget(small); };
  const T = read(tfm), C = soft.map(read);
  // the sky, found on a small copy of the broad colours
  const mh = Math.min(h, 300), mw = Math.max(8, Math.round(mh * w / h)), sm = target(mw, mh, THREE.FloatType);
  pass(COPY, { tSrc: soft[1], uGain: 1 }, sm);
  const ss = skyAndSea(readTarget(sm), mw, mh); sm.dispose();
  // pale walls and paving can join the sky's fill; the eddies keep to the parts that are bluer than they are warm
  for (let i = 0; i < mw * mh; i++) if (ss.sky[i] && ss.C[i * 3 + 2] < ss.C[i * 3] + 0.03) ss.sky[i] = 0;
  // at night the walls and roofs differ only a little from the sky, and its fill runs into them through small steps; there
  // the sky in each column ends at the first clear step of colour below the top
  let night = false;
  { let ls = 0, n = 0; for (let i = 0; i < mw * mh; i++) if (ss.sky[i]) { ls += ss.C[i * 3] + ss.C[i * 3 + 1] + ss.C[i * 3 + 2]; n++; }
    night = n > 0 && ls / n / 3 < 0.25;
    if (night) for (let x = 0; x < mw; x++) for (let y = 2; y < mh; y++) { const i = y * mw + x, j = (y - 2) * mw + x;
      if (Math.max(Math.abs(ss.C[i * 3] - ss.C[j * 3]), Math.abs(ss.C[i * 3 + 1] - ss.C[j * 3 + 1]), Math.abs(ss.C[i * 3 + 2] - ss.C[j * 3 + 2])) > 0.04) {
        for (let k = y; k < mh; k++) ss.sky[k * mw + x] = 0; break; } } }
  const skyAt = (x, y) => ss.sky[(mh - 1 - Math.min(mh - 1, Math.max(0, Math.floor(y / h * mh)))) * mw + Math.min(mw - 1, Math.max(0, Math.floor(x / w * mw)))];
  const at = (A, x, y) => (Math.min(dh - 1, Math.max(0, Math.floor(y / 2))) * dw + Math.min(dw - 1, Math.max(0, Math.floor(x / 2)))) * 4;
  const sample = (A, x, y) => { const i = at(A, x, y); return [A[i], A[i + 1], A[i + 2], A[i + 3]]; };
  // eddies in the open sky: one about the brightest part (the sun, or the lightest cloud) and a few more of varied size
  const skyPx = []; for (let i = 0; i < mw * mh; i++) if (ss.sky[i]) skyPx.push(i);
  const vort = [];
  // the stars, in a dark sky only: points much brighter than their surroundings in the sky, found at half size from the sharp picture
  const stars = [];
  if (night && skyPx.length > mw * mh * 0.04 && (o.stars ?? 1) > 0) {
    pass(VG_STAR, { tSrc: srcTex }, small); const S = readTarget(small), cand = [];
    for (let y = 2; y < dh - 2; y++) for (let x = 2; x < dw - 2; x++) { const i = (y * dw + x) * 4, v = S[i];
      if (v < 0.06 || !skyAt(x * 2, y * 2)) continue;
      let peak = true; for (let yy = -2; yy <= 2 && peak; yy++) for (let xx = -2; xx <= 2; xx++) if ((xx || yy) && S[((y + yy) * dw + x + xx) * 4] > v) { peak = false; break; }
      if (peak) cand.push([x * 2 + 1, y * 2 + 1, v, S[i + 1]]); }
    cand.sort((a, b) => b[2] - a[2]);
    const maxN = Math.round(11 * (o.stars ?? 1)), sep = h * 0.09;
    for (const c of cand) { if (stars.length >= maxN) break; if (stars.some(q => Math.hypot(q.x - c[0], q.y - c[1]) < sep)) continue;
      stars.push({ x: c[0], y: c[1], v: c[2], big: c[3] }); }
    // the brightest are drawn largest, with the widest halos
    stars.forEach((q, i) => { q.r = h * (0.008 + 0.032 * Math.pow(1 - i / Math.max(1, stars.length), 3) * (0.7 + 0.6 * rnd()) + 0.025 * Math.min(1, q.big * 3)) * (o.stars ?? 1) ** 0.5;
      vort.push({ x: q.x, y: q.y, r: q.r * 1.6, k: 0.9 + 0.3 * rnd(), star: true }); });
  }
  if (skyPx.length > mw * mh * 0.04 && SW > 0) {
    let bi = skyPx[0], bl = -1;
    for (const i of skyPx) { const l = ss.C[i * 3] + ss.C[i * 3 + 1] + ss.C[i * 3 + 2]; if (l > bl) { bl = l; bi = i; } }
    const toPx = i => { const x = i % mw, y = (i - x) / mw; return [(x + 0.5) / mw * w, (mh - 1 - y + 0.5) / mh * h]; };
    const [sx, sy] = toPx(bi); if (!stars.length) vort.push({ x: sx, y: sy, r: h * 0.07, k: 1.2 });
    const n = Math.round((2 + 2.5 * rnd()) * Math.min(1.4, skyPx.length / (mw * mh * 0.3)));
    for (let tries = 0; vort.length < n + 1 + stars.length && tries < 200; tries++) {
      const [x, y] = toPx(skyPx[Math.floor(rnd() * skyPx.length)]), r = h * (0.07 + 0.11 * rnd());
      if (vort.some(v => Math.hypot(v.x - x, v.y - y) < (v.r + r) * 0.9)) continue;
      vort.push({ x, y, r, k: (rnd() < 0.7 ? 1 : -1) * (0.8 + 0.5 * rnd()) });
    }
  }
  const lam = h * (0.22 + 0.1 * rnd()), ph = rnd() * 6.28;
  const field = (x, y, prev) => {
    let dx, dy;
    if (skyAt(x, y) && SW > 0) {
      // the sky moves in long waves along the horizon, wound into the eddies
      const a = 0.45 * Math.sin(x / lam * 6.283 + ph + 1.4 * Math.sin(y / (lam * 0.7) * 6.283));
      dx = Math.cos(a); dy = Math.sin(a);
      for (const v of vort) { const rx = x - v.x, ry = y - v.y, d = Math.hypot(rx, ry) + 1e-3, q = d / v.r;
        const wgt = 3.2 * v.k * SW * Math.exp(-(Math.max(0, q - 0.35) ** 2) * 1.6);
        dx += -ry / d * wgt; dy += rx / d * wgt; }
      if (SW < 1) { const t = sample(T, x, y); dx = dx * SW + t[0] * (1 - SW); dy = dy * SW + t[1] * (1 - SW); }
    } else { const t = sample(T, x, y); dx = t[0]; dy = t[1]; }
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    if (prev && dx * prev[0] + dy * prev[1] < 0) { dx = -dx; dy = -dy; }
    return [dx, dy];
  };
  // a stroke traced along the field from its middle in both directions, ending where the colour changes
  const trace = (x0, y0, len, wid, ref, tol, src) => {
    const step = Math.max(1.5, wid * 0.55), nh = Math.max(1, Math.round(len * 0.5 / step));
    const run = sgn => { const pts = []; let x = x0, y = y0, d = field(x, y, null); d = [d[0] * sgn, d[1] * sgn];
      for (let i = 0; i < nh; i++) {
        const m = field(x + d[0] * step * 0.5, y + d[1] * step * 0.5, d);
        const nd = field(x + m[0] * step, y + m[1] * step, d);
        if (nd[0] * d[0] + nd[1] * d[1] < 0.6) break;
        x += m[0] * step; y += m[1] * step; d = nd;
        if (x < -wid || y < -wid || x > w + wid || y > h + wid) break;
        const c = sample(C[src], x, y); if (Math.abs(c[0] - ref[0]) + Math.abs(c[1] - ref[1]) + Math.abs(c[2] - ref[2]) > tol) break;
        pts.push([x, y]); }
      return pts; };
    const back = run(-1).reverse(), fwd = run(1);
    return [...back, [x0, y0], ...fwd];
  };
  const strokes = [], ends = [];
  const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const layers = [{ wid: 10.5, len: [40, 80], src: 0, all: true }, { wid: 6.5, len: [26, 50], src: 1, all: false, thr: 0.05 }, { wid: 4.0, len: [14, 30], src: 2, all: false, thr: 0.07 }];
  for (const L of layers) {
    const wid0 = L.wid * s * SZ, gap = wid0 * 0.95, list = [];
    for (let y = 0; y < h; y += gap) for (let x = 0; x < w; x += gap) {
      const px = x + (rnd() - 0.5) * gap * 1.4, py = y + (rnd() - 0.5) * gap * 1.4;
      const c = sample(C[L.src], px, py);
      if (!L.all) { const k = sample(C[L.src - 1], px, py); if (Math.abs(k[0] - c[0]) + Math.abs(k[1] - c[1]) + Math.abs(k[2] - c[2]) < L.thr * 1.7 * (0.7 + 0.6 * rnd())) continue; }
      const sky = !!skyAt(px, py), wid = wid0 * (0.8 + 0.4 * rnd());
      const len = (L.len[0] + (L.len[1] - L.len[0]) * rnd()) * s * SZ * (sky ? 1.3 : 1);
      const pts = trace(px, py, len, wid, c, sky ? 0.32 : 0.16, L.src);
      if (pts.length < 2) continue;
      let col = vgColour(c, K, sky);
      // the hue and value vary a little from stroke to stroke; the streaks are lighter or of a neighbouring hue
      let [hh, sa, vv] = rgb2hsv(...col);
      col = hsv2rgb(hh + (rnd() - 0.5) * 0.04, sa, Math.min(1, vv * (0.93 + 0.14 * rnd())));
      let c2;
      const r2 = rnd();
      if (sky && r2 < 0.45) c2 = col.map((v, i) => v * 0.45 + (lum(col) < 0.3 ? [0.45, 0.62, 0.82] : [0.97, 0.96, 0.85])[i] * 0.55);
      else if (r2 < 0.6) c2 = hsv2rgb(hh + (rnd() < 0.5 ? -1 : 1) * (0.04 + 0.04 * rnd()), Math.min(1, sa * 1.1), Math.min(1, vv * 1.08));
      else if (sa < 0.25 && !sky) c2 = hsv2rgb(rnd() < 0.5 ? 0.1 : 0.05, 0.35 + 0.2 * rnd(), Math.min(1, vv * 0.98));
      else c2 = hsv2rgb(hh, sa * 0.8, Math.min(1, vv * 1.22 + 0.04));
      if (lum(col) < 0.3 && rnd() < 0.5) c2 = col.map((v, i) => v * 0.5 + [0.15, 0.25, 0.55][i] * 0.5);
      list.push({ pts, wid, col, c2, seed: rnd(), load: 0.7 + 0.3 * rnd() });
    }
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    strokes.push(...list); ends.push(strokes.length);
  }
  // each star as Van Gogh painted them: a core of lemon yellow and white in rings, and a halo of rings around it of
  // yellow, cream and a pale green-blue, each ring broken into a few curved strokes
  if (stars.length) {
    const list = [];
    for (const q of stars) {
      const wid = Math.max(2.6 * s, q.r * 0.15), rings = Math.max(3, Math.round(q.r / (wid * 0.55)));
      for (let k = 0; k < rings; k++) {
        const rr = (k + 0.4) * q.r / rings, f = k / rings;
        const col = f < 0.3 ? [1.0, 0.97, 0.82] : f < 0.55 ? [0.96, 0.86, 0.45] : f < 0.75 ? [0.78, 0.8, 0.62] : f < 0.9 ? [0.45, 0.58, 0.7] : [0.26, 0.36, 0.6];
        const c2 = f < 0.45 ? [1.0, 1.0, 0.92] : f < 0.75 ? [0.92, 0.8, 0.4] : [0.36, 0.5, 0.74];
        const arcs = rr < wid * 1.2 ? 1 : 2 + Math.floor(rnd() * 2), a0 = rnd() * 6.283;
        for (let j = 0; j < arcs; j++) {
          const span = 6.283 / arcs * (0.85 + 0.25 * rnd()), st = a0 + j * 6.283 / arcs, n = Math.max(3, Math.ceil(span * rr / (wid * 0.5))), pts = [];
          for (let m = 0; m <= n; m++) { const a = st + span * m / n; pts.push([q.x + Math.cos(a) * rr, q.y + Math.sin(a) * rr]); }
          list.push({ pts, wid: wid * (0.9 + 0.2 * rnd()) * (rr < wid ? 1.6 : 1), col, c2, seed: rnd(), load: 1.1 });
        }
      }
    }
    strokes.push(...list);
  }
  // dark blue outlines along the strongest edges of the picture
  if (OL > 0) {
    const list = [], gap = 6 * s, A = C[1];
    for (let y = gap; y < h - gap; y += gap) for (let x = gap; x < w - gap; x += gap) {
      const px = x + (rnd() - 0.5) * gap, py = y + (rnd() - 0.5) * gap, e2 = 2.5 * s;
      const gx = lum(sample(A, px + e2, py)) - lum(sample(A, px - e2, py)), gy = lum(sample(A, px, py + e2)) - lum(sample(A, px, py - e2));
      const e = Math.hypot(gx, gy);
      if (e < 0.16 / Math.max(0.3, OL) * (0.8 + 0.4 * rnd()) || skyAt(px, py)) continue;
      // the line lies on the darker side of the edge
      const ox = px - gx / e * 1.5 * s, oy = py - gy / e * 1.5 * s, c = sample(A, ox, oy);
      const pts = trace(ox, oy, (14 + 14 * rnd()) * s * SZ, 2.4 * s, c, 0.3, 1);
      if (pts.length < 2) continue;
      const k = 0.55 + 0.2 * rnd(), dk = vgColour(c, K, false).map((v, i) => v * 0.35 * (1 - k) + [0.06, 0.1, 0.3][i] * k);
      list.push({ pts, wid: (2.2 + 1.2 * rnd()) * s * Math.min(1.4, 0.7 + 0.3 * OL), col: dk, c2: dk.map(v => v * 1.3), seed: rnd(), load: 0.8 + 0.2 * rnd() });
    }
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    strokes.push(...list);
  }
  ends.push(strokes.length);
  // the strokes as ribbons along their traced paths
  let nv = 0, ni = 0; for (const k of strokes) { nv += k.pts.length * 2; ni += (k.pts.length - 1) * 6; }
  const P = new Float32Array(nv * 3), UV = new Float32Array(nv * 2), C1 = new Float32Array(nv * 3), C2 = new Float32Array(nv * 3), PP = new Float32Array(nv * 2), I = new Uint32Array(ni), iEnd = [];
  let v = 0, ii = 0;
  for (const k of strokes) {
    const p = k.pts, n = p.length; let tot = 0; const acc = [0];
    for (let j = 1; j < n; j++) { tot += Math.hypot(p[j][0] - p[j - 1][0], p[j][1] - p[j - 1][1]); acc.push(tot); }
    // the ribbon reaches half a width beyond the end points, for the rounded ends
    const ext = k.wid * 0.5, span = tot + 2 * ext;
    for (let j = 0; j < n; j++) {
      const a = p[Math.max(0, j - 1)], b = p[Math.min(n - 1, j + 1)]; let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      let x = p[j][0], y = p[j][1], u = (acc[j] + ext) / span;
      if (j === 0) { x -= tx * ext; y -= ty * ext; u = 0; } else if (j === n - 1) { x += tx * ext; y += ty * ext; u = 1; }
      const hw = k.wid * 0.5;
      for (const sd of [-1, 1]) {
        P[v * 3] = x - ty * hw * sd; P[v * 3 + 1] = y + tx * hw * sd; UV[v * 2] = u; UV[v * 2 + 1] = sd;
        C1.set(k.col, v * 3); C2.set(k.c2, v * 3); PP[v * 2] = k.seed; PP[v * 2 + 1] = k.load; v++; }
      if (j < n - 1) { const b0 = v - 2; I.set([b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2], ii); ii += 6; }
    }
    iEnd.push(ii);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  geo.setAttribute('aC1', new THREE.BufferAttribute(C1, 3)); geo.setAttribute('aC2', new THREE.BufferAttribute(C2, 3)); geo.setAttribute('aP', new THREE.BufferAttribute(PP, 2));
  geo.setIndex(new THREE.BufferAttribute(I, 1));
  const matC = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VG_VERT, fragmentShader: VG_FRAG,
    uniforms: { uRes: { value: new THREE.Vector2(w, h) }, uHeight: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });
  const matH = matC.clone(); matH.uniforms = { uRes: matC.uniforms.uRes, uHeight: { value: 1 } };
  const mesh = new THREE.Mesh(geo, matC); mesh.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(mesh);
  const paint = target(w, h, THREE.UnsignedByteType), height = target(w, h, THREE.UnsignedByteType);
  // a thin underpainting of the broad colours over a warm ground, of which a little shows between the strokes
  pass(`uniform sampler2D tSrc; uniform float uK; void main(){ vec3 c=texture(tSrc,vUv).rgb; vec3 hv=rgb2hsv(c); hv.y=min(1.0,hv.y*(1.0+0.5*uK));
    fragColor=vec4(mix(hsv2rgb(hv),vec3(0.8,0.66,0.45),0.3),1.0); }`, { tSrc: soft[0], uK: K }, paint);
  g.renderer.setRenderTarget(height); g.renderer.setClearColor(new THREE.Color(0, 0, 0), 1); g.renderer.clear();
  // the layers are laid in turn: the broad strokes, then the middle, the fine and last the outlines
  const span = [[0.03, 0.42], [0.42, 0.68], [0.68, 0.88], [0.88, 1.0]];
  const strokeAt = t => { if (t >= 1) return strokes.length; let c = 0;
    for (let i = 0; i < 4; i++) { const lo = i ? ends[i - 1] : 0, [t0, t1] = span[i]; c = t <= t0 ? c : lo + Math.round((ends[i] - lo) * Math.min(1, (t - t0) / (t1 - t0))); if (t < t1) break; }
    return c; };
  let drawn = 0;
  const dispose = () => { [tfm, tmp, ...soft, small, paint, height, bent].filter(Boolean).forEach(t => t.dispose()); matC.dispose(); matH.dispose(); geo.dispose(); };
  const frame = t => {
    const upto = strokeAt(t);
    if (upto > drawn) {
      const i0 = drawn ? iEnd[drawn - 1] : 0, i1 = iEnd[upto - 1];
      geo.setDrawRange(i0, i1 - i0);
      mesh.material = matC; g.renderer.setRenderTarget(paint); g.renderer.render(sc, g.cam);
      mesh.material = matH; g.renderer.setRenderTarget(height); g.renderer.render(sc, g.cam);
      drawn = upto;
    }
    if (o.debug === 'paint') return show(paint, w, h); if (o.debug === 'height') return show(height, w, h);
    pass(VG_FINAL, { tPaint: paint, tHeight: height, uImpasto: o.impasto ?? 1 }, null, { w, h });
  };
  return { frame, dispose };
}

const RUN = { watercolour, oil, vangogh, woodcut };

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
