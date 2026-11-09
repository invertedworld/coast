/* The townspeople of Coast: their bodies, clothes and poses, and their life in the squares, on the station platforms
   and at the ferry landings, and as passengers on the trains and the ferries. Developed in testbench/people.html,
   whose body, appearance and pose code this module shares; see docs/people-research.md for the design.

   createPeople(ctx) returns { update(dt), setOn(on), on, people, places, stats() }; ctx is described at createPeople. */
import * as THREE from 'three';

const lerp=(a,b,t)=>a+(b-a)*t;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>{ t=clamp(t,0,1); return t*t*(3-2*t); };
const hex=h=>new THREE.Color(h);
const TAU=Math.PI*2;
const wrapA=a=>{ a=(a+Math.PI)%TAU; if (a<0) a+=TAU; return a-Math.PI; };
const ease=(k,dt)=>1-Math.exp(-k*dt);
function rng(seed){ let s=seed>>>0||1; return ()=>{ s=(s+0x6D2B79F5)|0; let t=Math.imul(s^s>>>15,1|s); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const gauss=(R,m,sd)=>{ let u=0; for (let i=0;i<4;i++) u+=R(); return m+(u-2)*sd*1.732; };
const pick=(R,a)=>a[Math.floor(R()*a.length)];
let R=Math.random;
const pickW=(R,a,w)=>{ let t=R()*w.reduce((s,x)=>s+x,0); for (let i=0;i<a.length;i++){ t-=w[i]; if (t<=0) return a[i]; } return a[a.length-1]; };

/* ======================================================================================================
   1. The body
   A person is fourteen rigid segments, each built in its own frame with its joint at the origin, in metres, for a
   reference adult 1.77 m tall, +z forward and +y up (a limb hangs along -y):
     0 pelvis (at the hip joints), 1 torso (at the waist), 2 head (at the base of the neck), 3 4 left upper arm and
     forearm with the hand, 5 6 the same on the right, 7 8 9 left thigh, shin and foot, 10 11 12 the same on the
     right, 13 the skirt (hung from the hips, so that it can follow the thighs when the person sits).
   Each triangle carries a role, which chooses one of the person's thirteen colours, and a part, a bit that the person
   must have in their mask for the triangle to be drawn (hair styles, hats, skirts, bags). A shirt with short sleeves
   is the arm's middle and lower roles given the colour of the skin; shorts are the shin's role given the skin.
   ====================================================================================================== */
const SEGS=14, NROLE=13, TW=SEGS*3+NROLE+1;
const ROLE={skin:0,hair:1,top:2,bottom:3,shoes:4,hat:5,legMid:6,legLow:7,armMid:8,armLow:9,eyes:10,skirt:11,bag:12};
const PART={skirt:1,longSkirt:2,hair:4,long:8,bun:16,fringe:32,cap:64,straw:128,scarf:256,handBag:512,shoulderBag:1024};
const REF_H=1.77, HIP_REF=0.9225, TORSO_REF=0.55, HEAD_REF=0.3, FOOT_H=0.0825;

function personGeometry(){
  const P=[], N=[], SG=[], RL=[], PT=[];
  function tri(a,b,c,seg,role,part,h){
    const ux=b[0]-a[0], uy=b[1]-a[1], uz=b[2]-a[2], vx=c[0]-a[0], vy=c[1]-a[1], vz=c[2]-a[2];
    let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx; const l=Math.hypot(nx,ny,nz); if (l<1e-10) return;
    const mx=(a[0]+b[0]+c[0])/3-h[0], my=(a[1]+b[1]+c[1])/3-h[1], mz=(a[2]+b[2]+c[2])/3-h[2];
    if (nx*mx+ny*my+nz*mz<0){ const t=b; b=c; c=t; nx=-nx; ny=-ny; nz=-nz; }
    for (const p of [a,b,c]){ P.push(p[0],p[1],p[2]); N.push(nx/l,ny/l,nz/l); SG.push(seg); RL.push(role); PT.push(part); }
  }
  // a faceted tube through rings [y, half width, half depth, z of the centre, x of the centre]
  function loft(seg,role,part,st,K=6,caps=[true,true]){
    const ring=s=>Array.from({length:K},(_,k)=>{ const a=(k+0.5)/K*TAU; return [(s[4]||0)+s[1]*Math.sin(a), s[0], s[3]+s[2]*Math.cos(a)]; });
    const R=st.map(ring);
    for (let i=0;i<st.length-1;i++){
      const h=[((st[i][4]||0)+(st[i+1][4]||0))/2,(st[i][0]+st[i+1][0])/2,(st[i][3]+st[i+1][3])/2];
      for (let k=0;k<K;k++){ const a=R[i][k], b=R[i][(k+1)%K], c=R[i+1][(k+1)%K], d=R[i+1][k]; tri(a,b,c,seg,role,part,h); tri(a,c,d,seg,role,part,h); }
    }
    const cap=(i,j)=>{ const s=st[i], o=st[j]; if (s[1]<1e-4) return; const cen=[s[4]||0,s[0],s[3]], h=[o[4]||0,o[0],o[3]];
      for (let k=0;k<K;k++) tri(R[i][k],R[i][(k+1)%K],cen,seg,role,part,h); };
    if (caps[0]) cap(0,1); if (caps[1]) cap(st.length-1,st.length-2);
  }
  function geo(seg,role,part,g,m){
    g=g.index?g.toNonIndexed():g; g.applyMatrix4(m); g.computeBoundingBox(); const c=g.boundingBox.getCenter(new THREE.Vector3()), h=[c.x,c.y,c.z], p=g.attributes.position.array;
    for (let i=0;i<p.length;i+=9) tri([p[i],p[i+1],p[i+2]],[p[i+3],p[i+4],p[i+5]],[p[i+6],p[i+7],p[i+8]],seg,role,part,h);
  }
  const box=(seg,role,part,x,y,z,sx,sy,sz,rx=0)=>geo(seg,role,part,new THREE.BoxGeometry(1,1,1),
    new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,0,0)),new THREE.Vector3(sx,sy,sz)));
  function bar(seg,role,part,a,b,w,h){
    const A=new THREE.Vector3(...a), B=new THREE.Vector3(...b), d=B.clone().sub(A), L=d.length();
    geo(seg,role,part,new THREE.BoxGeometry(w,h,L),new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),d.normalize()),new THREE.Vector3(1,1,1)));
  }
  // pelvis
  loft(0,ROLE.bottom,0,[[-0.115,0.142,0.09,0],[-0.03,0.16,0.102,0],[0.085,0.148,0.096,0]],8);
  // skirts: to the knee, and to the middle of the calf
  loft(13,ROLE.skirt,PART.skirt,[[0.085,0.156,0.104,0],[-0.08,0.182,0.128,0],[-0.27,0.212,0.162,0.01],[-0.44,0.232,0.182,0.015]],10);
  loft(13,ROLE.skirt,PART.longSkirt,[[0.085,0.156,0.104,0],[-0.08,0.182,0.128,0],[-0.36,0.212,0.168,0.01],[-0.68,0.232,0.188,0.015]],10);
  // torso
  loft(1,ROLE.top,0,[[-0.01,0.142,0.094,0],[0.12,0.148,0.1,0.005],[0.26,0.156,0.11,0.012],[0.37,0.178,0.1,0],[0.43,0.162,0.076,-0.008],[0.47,0.07,0.05,-0.012]],8);
  // a bag on a strap across the chest
  bar(1,ROLE.bag,PART.shoulderBag,[0.165,0.0,0.092],[0.0,0.24,0.123],0.035,0.008);
  bar(1,ROLE.bag,PART.shoulderBag,[0.0,0.24,0.123],[-0.14,0.44,0.058],0.035,0.008);
  box(1,ROLE.bag,PART.shoulderBag,0.185,-0.07,0.03,0.07,0.19,0.24);
  // neck and head; nose, eyes and ears
  loft(2,ROLE.skin,0,[[-0.03,0.05,0.052,0],[0.085,0.046,0.048,0.005]],6,[false,false]);
  loft(2,ROLE.skin,0,[[0.065,0.045,0.05,0.03],[0.095,0.07,0.085,0.022],[0.155,0.087,0.1,0.008],[0.215,0.088,0.1,0],[0.265,0.072,0.083,-0.006],[0.3,0.032,0.038,-0.01]],8);
  box(2,ROLE.skin,0,0,0.165,0.11,0.024,0.042,0.028);
  for (const s of [-1,1]) box(2,ROLE.eyes,0,s*0.033,0.19,0.103,0.02,0.014,0.012);
  for (const s of [-1,1]) box(2,ROLE.skin,0,s*0.088,0.17,-0.005,0.018,0.05,0.032);
  // hair: a cap over the crown and the back of the head, long hair to the shoulders, a bun, a balding fringe
  loft(2,ROLE.hair,PART.hair,[[0.115,0.09,0.093,-0.024],[0.17,0.095,0.102,-0.013],[0.225,0.096,0.104,-0.006],[0.275,0.079,0.088,-0.01],[0.318,0.036,0.042,-0.012]],8,[true,false]);
  loft(2,ROLE.hair,PART.long,[[0.25,0.086,0.055,-0.055],[0.13,0.098,0.06,-0.065],[0.0,0.104,0.045,-0.07],[-0.07,0.094,0.03,-0.065]],8);
  loft(2,ROLE.hair,PART.bun,[[0.215,0,0,-0.115],[0.232,0.036,0.036,-0.122],[0.272,0.04,0.04,-0.122],[0.302,0,0,-0.115]],6);
  loft(2,ROLE.hair,PART.fringe,[[0.12,0.09,0.094,-0.026],[0.205,0.096,0.103,-0.012]],8,[false,false]);
  // a flat cap, a straw hat, a headscarf
  loft(2,ROLE.hat,PART.cap,[[0.225,0.099,0.108,-0.004],[0.275,0.095,0.106,0],[0.305,0.06,0.075,0.006],[0.315,0,0,0.01]],8,[true,false]);
  box(2,ROLE.hat,PART.cap,0,0.232,0.118,0.15,0.014,0.07,-0.15);
  loft(2,ROLE.hat,PART.straw,[[0.235,0.2,0.21,-0.005],[0.247,0.2,0.21,-0.005]],12);
  loft(2,ROLE.hat,PART.straw,[[0.24,0.096,0.106,-0.004],[0.33,0.088,0.098,-0.004],[0.335,0,0,0]],10,[false,true]);
  loft(2,ROLE.hat,PART.scarf,[[0.03,0.07,0.07,-0.04],[0.12,0.096,0.096,-0.03],[0.2,0.099,0.104,-0.018],[0.26,0.088,0.096,-0.014],[0.3,0.05,0.056,-0.012],[0.325,0,0,-0.01]],8,[true,false]);
  // arms
  for (const [ua,fa] of [[3,4],[5,6]]){
    loft(ua,ROLE.top,0,[[0.045,0.03,0.035,0],[0.0,0.056,0.058,0],[-0.13,0.05,0.053,0]],6,[true,false]);
    loft(ua,ROLE.armMid,0,[[-0.13,0.05,0.053,0],[-0.29,0.041,0.045,0]],6,[false,true]);
    loft(fa,ROLE.armLow,0,[[0.01,0.041,0.044,0],[-0.24,0.031,0.033,0]],6);
    loft(fa,ROLE.skin,0,[[-0.232,0.018,0.03,0],[-0.29,0.017,0.042,0.008],[-0.345,0.01,0.024,0.01]],6);
  }
  // a shopping bag in the right hand
  bar(6,ROLE.bag,PART.handBag,[0,-0.31,0.02],[0,-0.43,0.08],0.012,0.012);
  bar(6,ROLE.bag,PART.handBag,[0,-0.31,0.02],[0,-0.43,-0.04],0.012,0.012);
  box(6,ROLE.bag,PART.handBag,0,-0.555,0.02,0.08,0.25,0.29);
  // legs and shoes
  for (const [th,sh,ft] of [[7,8,9],[10,11,12]]){
    loft(th,ROLE.bottom,0,[[0.03,0.082,0.088,0.005],[-0.19,0.075,0.08,0]],8,[true,false]);
    loft(th,ROLE.legMid,0,[[-0.19,0.075,0.08,0],[-0.44,0.054,0.058,0]],8,[false,true]);
    loft(sh,ROLE.legLow,0,[[0.0,0.055,0.057,0],[-0.12,0.053,0.06,-0.01],[-0.41,0.034,0.038,0]],6);
    box(ft,ROLE.shoes,0,0,-0.045,0.0,0.088,0.075,0.12);
    box(ft,ROLE.shoes,0,0,-0.055,0.1,0.084,0.055,0.15);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(N,3));
  g.setAttribute('aSeg',new THREE.Float32BufferAttribute(SG,1));
  g.setAttribute('aRole',new THREE.Float32BufferAttribute(RL,1));
  g.setAttribute('aPart',new THREE.Float32BufferAttribute(PT,1));
  return g;
}

/* createPeopleMesh(parent, max) adds one InstancedMesh and returns { mesh, write(row, look, pose), setCount(n), tris }.
   Row r of the texture holds person r: three texels per segment (the rows of its 3x4 matrix), then the thirteen
   colours, then the mask of visible parts. The shadow pass poses the bodies in the same way. */
const PPL_HEAD=`
uniform sampler2D uPpl; attribute float aSeg; attribute float aRole; attribute float aPart;
mat4 pplBone(){ int i=gl_InstanceID, s=int(aSeg+0.5)*3;
  vec4 a=texelFetch(uPpl,ivec2(s,i),0), b=texelFetch(uPpl,ivec2(s+1,i),0), c=texelFetch(uPpl,ivec2(s+2,i),0);
  return mat4(a.x,b.x,c.x,0.0, a.y,b.y,c.y,0.0, a.z,b.z,c.z,0.0, a.w,b.w,c.w,1.0); }
bool pplHidden(){ int m=int(texelFetch(uPpl,ivec2(${TW-1},gl_InstanceID),0).r+0.5), p=int(aPart+0.5); return p!=0 && (m&p)==0; }
`;
function createPeopleMesh(parent, MAX, origin=null){
  const g=personGeometry(), data=new Float32Array(TW*MAX*4);
  const tex=new THREE.DataTexture(data,TW,MAX,THREE.RGBAFormat,THREE.FloatType); tex.minFilter=tex.magFilter=THREE.NearestFilter; tex.needsUpdate=true;
  const mat=new THREE.MeshLambertMaterial();
  mat.onBeforeCompile=sh=>{ sh.uniforms.uPpl={value:tex};
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\n'+PPL_HEAD+'varying vec3 vPC;')
      .replace('#include <beginnormal_vertex>','mat4 pB=pplBone(); vec3 objectNormal=normalize(mat3(pB)*normal);')
      .replace('#include <begin_vertex>',`vec3 transformed=pplHidden()?pB[3].xyz:(pB*vec4(position,1.0)).xyz;
        vPC=texelFetch(uPpl,ivec2(${SEGS*3}+int(aRole+0.5),gl_InstanceID),0).rgb;`);
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vPC;').replace('#include <color_fragment>','diffuseColor.rgb*=vPC;');
  };
  const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  depth.onBeforeCompile=sh=>{ sh.uniforms.uPpl={value:tex};
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\n'+PPL_HEAD)
      .replace('#include <begin_vertex>','mat4 pB=pplBone(); vec3 transformed=pplHidden()?pB[3].xyz:(pB*vec4(position,1.0)).xyz;'); };
  const mesh=new THREE.InstancedMesh(g,mat,MAX); const I=new THREE.Matrix4(); for (let i=0;i<MAX;i++) mesh.setMatrixAt(i,I);
  mesh.customDepthMaterial=depth; mesh.frustumCulled=false; mesh.castShadow=true; mesh.receiveShadow=true; mesh.count=0; parent.add(mesh);

  const F=Array.from({length:SEGS},()=>new THREE.Matrix4()), R0=new THREE.Matrix4(), L=new THREE.Matrix4(), D=new THREE.Matrix4();
  const _e=new THREE.Euler(), _q=new THREE.Quaternion(), _p=new THREE.Vector3(), _s=new THREE.Vector3(), ONE=new THREE.Vector3(1,1,1);
  const loc=(x,y,z,rx,ry,rz,o)=>{ _e.set(rx,ry,rz,o); _q.setFromEuler(_e); return L.compose(_p.set(x,y,z),_q,ONE); };
  const put=(row,seg,M,sx,sy,sz)=>{ D.copy(M).scale(_s.set(sx,sy,sz)); const e=D.elements, o=(row*TW+seg*3)*4;
    data[o]=e[0]; data[o+1]=e[4]; data[o+2]=e[8]; data[o+3]=e[12];
    data[o+4]=e[1]; data[o+5]=e[5]; data[o+6]=e[9]; data[o+7]=e[13];
    data[o+8]=e[2]; data[o+9]=e[6]; data[o+10]=e[10]; data[o+11]=e[14]; };
  function write(row, look, Q){
    const b=look.body, s=b.s, tS=s*b.torsoK, lL=s*b.legK, aL=s*b.armK, gl=s*b.limb, hx=s*b.hip*b.girth, sx=s*b.sh*b.girth, dz=s*b.girth;
    R0.compose(_p.set(Q.x-(origin?origin.x:0),Q.y-(origin?origin.y:0),Q.z-(origin?origin.z:0)),_q.setFromEuler(_e.set(0,Q.yaw,0,'YXZ')),ONE);
    F[0].multiplyMatrices(R0,loc(0,Q.hipY,0,Q.pelPitch,Q.pelYaw,Q.pelRoll,'YXZ'));
    F[1].multiplyMatrices(F[0],loc(0,0.085*tS,0,Q.lean,Q.twist,Q.side,'YXZ'));
    F[2].multiplyMatrices(F[1],loc(0,0.465*tS,0,Q.hdPitch,Q.hdYaw,Q.hdRoll,'YXZ'));
    F[3].multiplyMatrices(F[1],loc(0.195*sx,0.405*tS,-0.005*s,-Q.lSh,-Q.lTw,Q.lAb,'ZXY'));
    F[4].multiplyMatrices(F[3],loc(0,-0.29*aL,0,-Q.lEl,0,0,'ZXY'));
    F[5].multiplyMatrices(F[1],loc(-0.195*sx,0.405*tS,-0.005*s,-Q.rSh,Q.rTw,-Q.rAb,'ZXY'));
    F[6].multiplyMatrices(F[5],loc(0,-0.29*aL,0,-Q.rEl,0,0,'ZXY'));
    F[7].multiplyMatrices(F[0],loc(0.088*hx,0,0,-Q.lHip,-Q.pelYaw,Q.lHa-Q.pelRoll,'YZX'));
    F[8].multiplyMatrices(F[7],loc(0,-0.43*lL,0,Q.lKn,0,0,'ZXY'));
    F[9].multiplyMatrices(F[8],loc(0,-0.41*lL,0,Q.lAn,Q.lFy,0,'YXZ'));
    F[10].multiplyMatrices(F[0],loc(-0.088*hx,0,0,-Q.rHip,-Q.pelYaw,-Q.rHa-Q.pelRoll,'YZX'));
    F[11].multiplyMatrices(F[10],loc(0,-0.43*lL,0,Q.rKn,0,0,'ZXY'));
    F[12].multiplyMatrices(F[11],loc(0,-0.41*lL,0,Q.rAn,-Q.rFy,0,'YXZ'));
    F[13].multiplyMatrices(F[0],loc(0,0,0,-Q.skirt,0,0,'ZXY'));
    put(row,0,F[0],hx,s,dz); put(row,1,F[1],sx,tS,dz*b.chest); put(row,2,F[2],s*b.headK,s*b.headK,s*b.headK);
    for (const k of [3,4,5,6]) put(row,k,F[k],gl,aL,gl);
    for (const k of [7,10]) put(row,k,F[k],gl*b.thigh,lL,gl*b.thigh);
    for (const k of [8,11]) put(row,k,F[k],gl,lL,gl);
    for (const k of [9,12]) put(row,k,F[k],s*b.foot,s*b.foot,s*b.foot);
    put(row,13,F[13],hx,lL,dz);
    const o=(row*TW+SEGS*3)*4;
    for (let r=0;r<NROLE;r++){ const c=look.cols[r]; data[o+r*4]=c.r; data[o+r*4+1]=c.g; data[o+r*4+2]=c.b; }
    data[o+NROLE*4]=look.mask;
  }
  return { mesh, write, data, setCount(n){ mesh.count=n; tex.needsUpdate=true; }, tris:g.attributes.position.count/3 };
}

/* ---------- appearance ----------
   makeLook(kind, age, R) gives { kind, age, child, elder, body, cols, mask }. kind is man, woman, boy or girl; an
   age of 65 or more makes an older person, who stoops a little, dresses more darkly and soberly, and goes grey. */

const COL=a=>a.map(hex);
const SKIN=COL(['#f3d6bd','#ecc7a4','#e0b28c','#d19f78','#bd8862','#a06d4b','#7b5136','#5d3b28']), SKIN_W=[0.08,0.16,0.2,0.2,0.14,0.1,0.07,0.05];
const HAIR=COL(['#1d1916','#2e2119','#46301f','#5e3f27','#7a4d2c','#8c4a2a','#b48a56','#d0b07a']), HAIR_W=[0.22,0.25,0.2,0.12,0.07,0.04,0.06,0.04];
const HAIR_OLD=COL(['#8f8a84','#a9a49e','#c8c4be','#e2dfda','#5a5550']);
const TOPS=COL(['#f3f0e9','#e9dfcb','#d8c6a2','#2f3d5a','#8fb2cf','#c06a4f','#d59c4b','#7e8150','#a3b59c','#b0463c','#2c2c30','#e3a7a1','#4c8a86','#a89cc4','#e6cc66','#6b8fb5','#cfd8dc']);
const BOTTOMS=COL(['#3e5576','#58718f','#2c3a55','#b8a57c','#d3c7ad','#3b3b41','#efece4','#7a7b4c','#5b4a3c']);
const SKIRTS=COL(['#f2efe8','#2f3d5a','#b5443a','#c4704f','#e6cc66','#8fb2cf','#4c8a86','#e3a7a1','#2b2a2e','#7e8150','#a89cc4']);
const OLD_TOPS=COL(['#f1eee6','#c9d6e2','#e3dccb','#8a8f99','#5d6470','#3a3a40','#7d6a58']);
const OLD_BOTTOMS=COL(['#5d5f66','#6e5a48','#2f3540','#8b8478','#3a3a40']);
const OLD_SKIRTS=COL(['#26252a','#3a3542','#4b4650','#2f3540','#5c4b48']);
const KID_TOPS=COL(['#e4513f','#f0c43c','#4f9bd0','#6dbb72','#f3f0e9','#e98fb0','#8e6fc4','#f08a3c','#3e5576']);
const SHOES=COL(['#2b2420','#5e4330','#e8e4dc','#8c7860','#3a3f4a']), KID_SHOES=COL(['#e8e4dc','#d6453a','#3f6fb0','#2b2420']);
const CAPS=COL(['#4a4a52','#6b5b49','#5a6168']), SCARVES=COL(['#3b3344','#6a3e45','#2d3b52','#7b6f60']), STRAW=hex('#d9c48c'), KID_HAT=hex('#f1e7c9');
const BAGS=COL(['#7a5236','#a8743e','#2c2c30','#d8cbb0','#8b3a32','#3d5a7a']), EYES=hex('#241c19'), TIGHTS=hex('#8e7466');

function makeLook(kind, age, R){
  const child=age<15, elder=age>=65, man=kind==='man'||kind==='boy';
  const c=clamp((14-age)/10,0,1);
  const H= child ? 0.78+0.06*age+gauss(R,0,0.035)
    : man ? (elder?gauss(R,1.70,0.05):gauss(R,1.765,0.06)) : (elder?gauss(R,1.575,0.045):gauss(R,1.635,0.055));
  const girth=clamp(child?gauss(R,0.96,0.05):elder?gauss(R,man?1.07:1.1,0.09):gauss(R,1.01,0.08),0.84,1.32);
  const s=H/REF_H, headK=1+0.42*c, legK=1-0.1*c, armK=1-0.05*c;
  const body={ s, headK, legK, armK, torsoK:(REF_H-HIP_REF*legK-HEAD_REF*headK)/TORSO_REF, girth,
    sh:child?1:man?1.06:0.93, hip:child?1:man?0.96:1.07, chest:man?1:1.04, limb:Math.pow(girth,0.6)*(child?1.06:1), thigh:man?1:1.05,
    foot:1+0.08*c, stoop:elder?0.08+R()*0.16:0 };
  const skin=pickW(R,SKIN,SKIN_W), cols=new Array(NROLE);
  let hair = elder ? pick(R,HAIR_OLD) : (!child && age>48 && R()<0.45) ? pick(R,HAIR_OLD.slice(0,3)) : pickW(R,HAIR,HAIR_W);
  let top, bottom, skirt=null, mask=0, legMid, legLow, armMid, armLow, shoes, hat=STRAW, bag=pick(R,BAGS);
  const sleeves=(pShort,pRolled)=>{ const q=R(); if (q<pShort){ armMid=skin; armLow=skin; } else if (q<pShort+pRolled){ armMid=top; armLow=skin; } else { armMid=top; armLow=top; } };
  if (kind==='man'){
    top=pick(R,elder?OLD_TOPS:TOPS); bottom=pick(R,elder?OLD_BOTTOMS:BOTTOMS); sleeves(elder?0.25:0.55,0.2);
    if (!elder && R()<0.35){ legMid=bottom; legLow=skin; } else { legMid=bottom; legLow=bottom; }
    mask|=(age>38 && R()<(elder?0.5:0.25)) ? PART.fringe : PART.hair;
    const q=R(); if (elder ? q<0.45 : q<0.05){ mask|=PART.cap; hat=pick(R,CAPS); } else if (q<(elder?0.55:0.15)) mask|=PART.straw;
    if (!elder && R()<0.1) mask|=PART.shoulderBag;
    shoes=pick(R,SHOES);
  } else if (kind==='woman'){
    const q=R();
    if (elder){
      top=pick(R,OLD_TOPS);
      if (q<0.55){ skirt=pick(R,OLD_SKIRTS); mask|=PART.longSkirt; if (R()<0.4) top=skirt; }
      else if (q<0.75){ skirt=pick(R,OLD_SKIRTS); mask|=PART.skirt; }
      else bottom=pick(R,OLD_BOTTOMS);
      sleeves(0.25,0.15);
    } else {
      top=pick(R,TOPS);
      if (q<0.3){ skirt=pick(R,SKIRTS); top=skirt; mask|=PART.skirt; }
      else if (q<0.55){ skirt=pick(R,SKIRTS); mask|=PART.skirt; }
      else if (q<0.85) bottom=pick(R,BOTTOMS);
      else { bottom=pick(R,BOTTOMS); legLow=skin; }
      sleeves(0.7,0.1);
    }
    if (skirt){ bottom=skirt; legMid=skin; legLow=(elder&&R()<0.6)?TIGHTS:skin; } else { legMid=bottom; legLow=legLow||bottom; }
    const hq=R();
    if (elder && R()<0.15){ mask|=PART.scarf; hat=pick(R,SCARVES); }
    else mask|= elder ? (hq<0.55?PART.hair|PART.bun:PART.hair) : (hq<0.5?PART.hair|PART.long:hq<0.7?PART.hair|PART.bun:PART.hair);
    if (!(mask&PART.scarf) && R()<(elder?0.06:0.12)) mask|=PART.straw;
    const bq=R(); if (bq<(elder?0.35:0.2)) mask|=PART.handBag; else if (!elder && bq<0.45) mask|=PART.shoulderBag;
    shoes=pick(R,SHOES);
  } else {
    top=pick(R,KID_TOPS); sleeves(0.85,0);
    if (kind==='boy'){ bottom=pick(R,BOTTOMS); legMid=bottom; legLow=R()<0.75?skin:bottom; mask|=PART.hair; }
    else {
      const q=R();
      if (q<0.45){ skirt=pick(R,SKIRTS.concat(KID_TOPS)); top=skirt; mask|=PART.skirt; }
      else if (q<0.65){ skirt=pick(R,SKIRTS); mask|=PART.skirt; }
      if (skirt){ bottom=skirt; legMid=skin; legLow=skin; } else { bottom=pick(R,BOTTOMS); legMid=bottom; legLow=q<0.9?skin:bottom; }
      const hq=R(); mask|= hq<0.45?PART.hair|PART.long : hq<0.75?PART.hair|PART.bun : PART.hair;
    }
    if (R()<0.14){ mask|=PART.straw; hat=KID_HAT; }
    shoes=pick(R,KID_SHOES);
  }
  if (!skirt) skirt=bottom;
  cols[ROLE.skin]=skin; cols[ROLE.hair]=hair; cols[ROLE.top]=top; cols[ROLE.bottom]=bottom; cols[ROLE.shoes]=shoes; cols[ROLE.hat]=hat;
  cols[ROLE.legMid]=legMid; cols[ROLE.legLow]=legLow; cols[ROLE.armMid]=armMid; cols[ROLE.armLow]=armLow; cols[ROLE.eyes]=EYES; cols[ROLE.skirt]=skirt; cols[ROLE.bag]=bag;
  return { kind, age, child, elder, man, body, cols, mask, H };
}



/* Each person walks in their own way: a longer or shorter stride, softer or straighter knees, a higher or lower
   lift of the foot, more or less sway of the hips and weight shifted over the standing foot, toes turned out, a wider
   or narrower track, a fuller or slighter arm swing (and the two arms not quite alike), elbows more or less bent and a
   nod of the head at each step. Older people take shorter, flatter steps on a wider track and swing their arms less;
   children walk with a spring in their step and swing their arms more. */
function makeGait(look){
  const old=look.elder, kid=look.child, fem=!look.man, u=(a,b)=>a+R()*(b-a);
  return { stride:clamp(gauss(R,old?0.86:1,0.06),0.75,1.15), knee:old?u(0.94,0.96):u(0.945,0.978), lift:old?u(0.5,0.8):kid?u(1,1.35):u(0.75,1.25),
    sway:(fem?u(0.022,0.04):u(0.012,0.028))*(old?1.3:1), roll:fem?u(0.04,0.08):u(0.02,0.05), hips:fem?u(1,1.7):u(0.6,1.2),
    width:old?u(0.03,0.06):u(0,0.035), toe:old?u(0.12,0.26):u(0.03,0.2), arm:old?u(0.35,0.8):kid?u(1.1,1.6):u(0.6,1.35),
    asym:u(0.82,1.18), elbow:u(0.1,0.45), armOut:u(0.08,0.2), nod:u(0.01,0.035), lean:old?u(0.02,0.08):u(-0.02,0.06),
    bounce:kid?u(0.4,1):u(0,0.35), pace:u(0.03,0.08), paceF:u(0.15,0.4) };
}
const hsh=(a,b)=>{ let h=Math.imul(a|0,0x27d4eb2d)^Math.imul(b|0,0x165667b1); h=Math.imul(h^(h>>>15),0x85ebca6b); h=Math.imul(h^(h>>>13),0xc2b2ae35); return ((h^(h>>>16))>>>0)/4294967296; };

/* ======================================================================================================
   2. The pose
   buildPose(p, t, Q) fills Q from a person's state: speedSm (smoothed speed, m/s), phase (the gait, one step per pi),
   walkW (how far the legs walk rather than stand), turnStep (stepping round on the spot), sitW and seat (sitting),
   armMode and armW (free, behind the back, folded, gesturing, holding a hand), hY and hP (the head's yaw from the
   body and its pitch downwards). The pelvis is set at the height at which the lower foot meets the ground, so that
   the stride, the bob and the dip at each footfall follow from the legs themselves.
   ====================================================================================================== */
const GAIT0={stride:1,knee:0.965,lift:1,sway:0.02,roll:0.04,hips:1,width:0.02,toe:0.1,arm:1,asym:1,elbow:0.2,armOut:0.12,nod:0.02,lean:0.02,bounce:0.2,pace:0,paceF:0.2};
const POSE0={x:0,y:0,z:0,yaw:0,hipY:0.92,pelPitch:0,pelYaw:0,pelRoll:0,lean:0,twist:0,side:0,hdPitch:0,hdYaw:0,hdRoll:0,
  lSh:0,lAb:0.12,lTw:0,lEl:0.15,rSh:0,rAb:0.12,rTw:0,rEl:0.15,lHip:0,lHa:0.02,lKn:0.05,lAn:0,rHip:0,rHa:0.02,rKn:0.05,rAn:0,lFy:0,rFy:0,skirt:0};
const newPose=()=>Object.assign({},POSE0);
const ARM_KEYS=['lSh','lAb','lTw','lEl','rSh','rAb','rTw','rEl'];
const ARMS={
  behind:{lSh:-0.34,lAb:0.1,lTw:1.25,lEl:1.35,rSh:-0.34,rAb:0.1,rTw:1.25,rEl:1.35},
  folded:{lSh:0.32,lAb:0.04,lTw:1.35,lEl:1.8,rSh:0.36,rAb:0.04,rTw:1.35,rEl:1.7},
  hips:{lSh:-0.1,lAb:0.55,lTw:0.9,lEl:1.6,rSh:-0.1,rAb:0.55,rTw:0.9,rEl:1.6},
  pockets:{lSh:-0.06,lAb:0.17,lTw:0.55,lEl:0.5,rSh:-0.06,rAb:0.17,rTw:0.55,rEl:0.5},
  pocketL:{lSh:-0.06,lAb:0.17,lTw:0.55,lEl:0.5},
};
const _sit=newPose();
/* The shoulder joint of one side (+1 left) in the world, and the frame of the torso it hangs from, from the last pose
   drawn: where the pelvis was, how high, and how far the torso was turned and leaning. */
function torsoOf(p){ return { x:p.qx??p.x, z:p.qz??p.z, y:p.hipW??(p.y+HIP_REF*p.look.body.s*p.look.body.legK), yaw:p.yaw+(p.qTurn||0), lean:p.qLean||0 }; }
function shoulderOf(p,side){
  const b=p.look.body, s=b.s, tS=s*b.torsoK, o=0.195*s*b.sh*b.girth*side, T=torsoOf(p), up=0.49*tS;
  const fw=up*Math.sin(T.lean), y=T.y+up*Math.cos(T.lean), c=Math.cos(T.yaw), sn=Math.sin(T.yaw);
  return [T.x+c*o+sn*fw, y, T.z-sn*o+c*fw];
}
const armLen=p=>0.59*p.look.body.s*p.look.body.armK;
// where two held hands meet: as low as the adult's arm reaches with a little slack, the child's arm raised to it
function holdPoint(p){
  const q=p.holdBy||p.holdKid; if (!q||!q.alive||q.armMode!=='hold') return null;
  const kid=p.child?p:q, ad=p.child?q:p, SK=shoulderOf(kid,kid.holdSide), SA=shoulderOf(ad,ad.holdSide);
  const gap=Math.hypot(SK[0]-SA[0],SK[2]-SA[2]); if (gap>(armLen(kid)+armLen(ad))*0.8) return null;
  const y=Math.min(SK[1]+0.05,SA[1]-armLen(ad)*0.9), k=0.42, fy=(p.yaw+q.yaw)/2;
  return [lerp(SA[0],SK[0],k)+Math.sin(fy)*0.06, y, lerp(SA[2],SK[2],k)+Math.cos(fy)*0.06];
}
// a two-bone solution for an arm to reach a point, in the frame of the torso: the swing forward and out, and the elbow
function armTo(p,side,H){
  const S=shoulderOf(p,side), T=torsoOf(p), c=Math.cos(T.yaw), sn=Math.sin(T.yaw), dx=H[0]-S[0], dz=H[2]-S[2], dy=H[1]-S[1];
  const lat=(dx*c-dz*sn)*side, fw0=dx*sn+dz*c, dn0=-dy, cl=Math.cos(T.lean), sl=Math.sin(T.lean);
  const dn=dn0*cl+fw0*sl, fw=fw0*cl-dn0*sl, aL=p.look.body.s*p.look.body.armK, u=0.29*aL, f=0.3*aL;
  const d=clamp(Math.hypot(lat,fw,dn),0.1,(u+f)*0.995);
  const el=Math.PI-Math.acos(clamp((u*u+f*f-d*d)/(2*u*f),-1,1)), al=Math.acos(clamp((u*u+d*d-f*f)/(2*u*d),-1,1));
  const ab=Math.atan2(lat,dn), sw=Math.atan2(fw,Math.hypot(dn,lat));   // ab passes a right angle when the hand is above the shoulder
  return [sw-al, ab, el];
}
const stepLenOf=p=>p.look.body.s*p.look.body.legK*(0.35+0.28*Math.min(p.speedSm,3.2))*(p.gait?p.gait.stride:1);
/* Feet on the ground. For the crowd each foot is a place in the world. Planted, it does not move at all. In its swing
   it travels from where it was to where it will next come down, worked out afresh each frame from where the hip will
   be when it lands, so that turns, changes of pace and sidesteps are followed; on stairs that place is moved to the
   middle of a tread, and the foot is lifted higher to clear a step up. The pelvis is set as high as the planted feet
   allow, and each leg is solved to reach its foot, bending sideways at the hip where the foot is out to the side. A
   person who has stopped with the feet out of place, or has turned on the spot, steps to set them under the hips. */
// the slope of the ground along the way a person faces, under a foot; a step is not a slope
function slopeUnder(p,x,z,y,sy,cy){ const a=p.ground(x+sy*0.15,z+cy*0.15,y), b=p.ground(x-sy*0.15,z-cy*0.15,y); return Math.abs(a-b)>0.1?0:Math.atan((a-b)/0.3); }
function pinnedLegs(p,t,Q,G){
  const {s,b,lL,Lt,Ls,fh,SL,beta,run,shift,m}=G, gt=p.gait||GAIT0;
  const sy=Math.sin(p.yaw), cy=Math.cos(p.yaw), hipX=0.088*s*b.hip*b.girth, Lm=(Lt+Ls)*lerp(0.985,gt.knee,m)*(1-0.05*run);
  const dt=clamp(t-(p.poseT??t),0,0.1); p.poseT=t;
  const moving=p.speedSm>0.2, T=2*SL/Math.max(0.35,p.speedSm), hLift=(0.07+0.22*run)*lL/0.92*gt.lift, push=0.45+0.4*run;
  let need=false, swing=false, hipT=Infinity; const res=[];
  for (const side of [1,-1]){
    const key=side>0?'pinL':'pinR', u0=p.phase/TAU+(side>0?0:0.5), u=u0-Math.floor(u0);
    const hx=p.x+cy*(side*hipX+shift), hz=p.z-sy*(side*hipX+shift);
    let F=p[key]; if (!F) F=p[key]={x:hx,z:hz,y:p.ground(hx,hz,p.y),swing:false};
    let lift=0, an=0;
    if (u<beta){
      if (F.swing){ F.swing=false; F.x=F.tx; F.z=F.tz; F.y=F.ty; }
      const q=u/beta, th=moving&&q>0.72?(q-0.72)/0.28*push:0; an=th; lift=0.16*s*Math.sin(th);
    } else {
      const q=(u-beta)/(1-beta);
      if (!F.swing){ F.swing=true; F.fx=F.x; F.fz=F.z; F.fy=F.y; }
      // no two steps quite alike: the length and the placing of each vary a little
      const k=Math.floor(u0), j1=hsh(p.id*2+side,k)-0.5, j2=hsh(p.id*2+side,k+7919)-0.5;
      const rem=(1-q)*(1-beta)*T, lead=moving?beta*SL*(1+0.12*j1):0, wd=side*(moving?gt.width+0.03*j2:0.01)-shift;
      const [tx,tz]=(x=>x)([hx+(moving?p.vx*rem:0)+sy*lead+cy*wd, hz+(moving?p.vz*rem:0)+cy*lead-sy*wd]);
      F.tx=tx; F.tz=tz; F.ty=p.ground(tx,tz,F.fy);
      const e=smooth(q), ey=smooth(Math.min(1,q*1.5)), up=Math.max(0,F.ty-F.fy);
      F.x=lerp(F.fx,tx,e); F.z=lerp(F.fz,tz,e); F.y=lerp(F.fy,F.ty,ey);
      lift=(hLift*(moving?1:0.6)+up*0.5)*Math.sin(Math.PI*Math.pow(q,0.75));
      an=moving?(q<0.3?push*(1-q/0.3):q>0.85?-0.18*(q-0.85)/0.15:0):0;
      swing=true;
    }
    const dh=Math.hypot(F.x-hx,F.z-hz);
    if (!F.swing){ hipT=Math.min(hipT,F.y+fh+lift+Math.sqrt(Math.max(0.01,Lm*Lm-dh*dh)));
      if (!moving && (dh>0.16*lL || Math.abs(F.y-p.ground(hx,hz,F.y))>0.1)) need=true; }
    res.push({F,hx,hz,lift,an,side});
  }
  p.needStep=need; p.inSwing=swing;
  if (hipT===Infinity) hipT=p.hipW??(p.y+Lm+fh);
  hipT-=(1-p.walkW)*0.012;   // standing, the knees a little soft
  hipT+=m*gt.bounce*0.02*Math.max(0,Math.sin(2*p.phase-0.6));   // a spring in the step
  if (p.hipW==null||Math.abs(p.hipW-hipT)>0.6) p.hipW=hipT; else p.hipW+=(hipT-p.hipW)*ease(16,dt||0.016);
  const hy=p.hipW; Q.hipY=hy-p.y;
  for (const r of res){
    const F=r.F, dx=F.x-r.hx, dz=F.z-r.hz, fw=dx*sy+dz*cy, lat=(dx*cy-dz*sy)*r.side, down=Math.max(0.05,hy-(F.y+fh+r.lift));
    const yv=Math.hypot(down,lat), d=Math.max(0.05,Math.min(Math.hypot(fw,yv),(Lt+Ls)*0.999));
    const kn=Math.acos(clamp((d*d-Lt*Lt-Ls*Ls)/(2*Lt*Ls),-1,1)), al=Math.acos(clamp((Lt*Lt+d*d-Ls*Ls)/(2*Lt*d),-1,1));
    const aT=Math.atan2(fw,yv)+al, ha=Math.atan2(lat,down), g=F.swing?0:slopeUnder(p,F.x,F.z,F.y,sy,cy);
    const hip=aT+Q.pelPitch, an=aT-kn+r.an-g;   // the foot level, or along the slope under it
    if (r.side>0){ Q.lHip=hip; Q.lKn=kn; Q.lAn=an; Q.lHa=ha; } else { Q.rHip=hip; Q.rKn=kn; Q.rAn=an; Q.rHa=ha; }
  }
}
function buildPose(p, t, Q){
  const b=p.look.body, s=b.s, lL=s*b.legK, Lt=0.43*lL, Ls=0.41*lL, fh=FOOT_H*s*b.foot, legL=Lt+Ls+fh;
  const sp=p.speedSm, w=p.walkW, run=p.canRun?smooth((sp-1.9)/0.7)*w:0;
  const stepLen=stepLenOf(p);
  const m=Math.min(1,w+p.turnStep), still=1-m, ph=p.phase, cs=Math.cos(ph);
  Object.assign(Q,POSE0);
  Q.x=p.x; Q.y=p.y; Q.z=p.z; Q.yaw=p.yaw;
  Q.pelPitch=0.03*w+0.06*run;
  /* legs: each foot follows a planned path in the pelvis's frame and the hip and knee are solved to reach it. In
     stance the foot stays on the ground and moves back at exactly the walking speed, so that it does not slide: the
     phase advances by pi a step over the distance actually walked, and the stance takes the fraction beta of the cycle,
     so the foot sweeps 2 beta stepLen. In swing it is lifted on an arc; the heel rises and the toes push off at the end
     of stance. Turning on the spot is a few short steps. */
  const SL=lerp(stepLen,0.14*lL,p.turnStep*(1-w)), beta=lerp(0.62,0.38,run);
  const A=m*Math.asin(Math.min(0.6,beta*SL/legL));
  const Lm=(Lt+Ls)*0.985*(1-0.05*run), hLift=(0.07+0.22*run)*lL/0.92, push=0.45+0.4*run;
  const foot=u=>{ u-=Math.floor(u);
    if (u<beta){ const q=u/beta, th=q>0.72?(q-0.72)/0.28*push:0; return {z:beta*SL*(1-2*q), lift:0.16*s*Math.sin(th), an:th, st:true, q}; }
    const q=(u-beta)/(1-beta), e=q*q*(3-2*q), th=q<0.3?push*(1-q/0.3):q>0.85?-0.18*(q-0.85)/0.15:0;
    return {z:-beta*SL+2*beta*SL*e, lift:Math.max(hLift*Math.sin(Math.PI*Math.pow(q,0.75)),q<0.3?0.16*s*Math.sin(th):0), an:th, st:false, q}; };
  const fL=foot(ph/TAU), fR=foot(ph/TAU+0.5);
  // the pelvis rides over the stance leg; in a run it dips in stance and rises in flight
  const pend=f=>Math.sqrt(Math.max(0.01,Lm*Lm-f.z*f.z))+fh;
  let walkY=Infinity; for (const f of [fL,fR]) if (f.st) walkY=Math.min(walkY,pend(f));
  if (walkY===Infinity) walkY=Math.sqrt(Math.max(0.01,Lm*Lm-(beta*SL)**2))+fh;
  const fs=[fL,fR].find(f=>f.st), uf=((ph/TAU)%0.5+0.5)%0.5, fly=clamp((uf-beta)/Math.max(0.01,0.5-beta),0,1);
  const runY=fh+Lm*0.95+(fs?-0.04*Math.sin(Math.PI*fs.q):0.05*Math.sin(Math.PI*fly));
  const gaitY=lerp(walkY,runY,run);
  const ik=(z,lift,lat)=>{ const y=Math.hypot(gaitY-fh-lift,lat), d=Math.max(0.05,Math.min(Math.hypot(z,y),(Lt+Ls)*0.999));
    const kn=Math.acos(clamp((d*d-Lt*Lt-Ls*Ls)/(2*Lt*Ls),-1,1)), al=Math.acos(clamp((Lt*Lt+d*d-Ls*Ls)/(2*Lt*d),-1,1));
    return [Math.atan2(z,y)+al, kn]; };   // the thigh's angle forward of straight down, and the bend of the knee
  const [aL,kL]=ik(fL.z,fL.lift,0), [aR,kR]=ik(fR.z,fR.lift,0);
  // standing: the weight on one leg and then the other, the free knee relaxed
  const wt=Math.sin(t*0.55+p.seed), sKL=0.04+0.09*Math.max(0,wt), sKR=0.04+0.09*Math.max(0,-wt);
  const reach=(hip,kn)=>{ const aT=hip-Q.pelPitch, aS=aT-kn; return Lt*Math.cos(aT)+Ls*Math.cos(aS)+fh; };
  Q.lHip=lerp(0.02,aL+Q.pelPitch,m); Q.rHip=lerp(0.02,aR+Q.pelPitch,m); Q.lKn=lerp(sKL,kL,m); Q.rKn=lerp(sKR,kR,m);
  Q.hipY=lerp(Math.max(reach(0.02,sKL),reach(0.02,sKR)),gaitY,m);
  Q.lAn=Q.lHip-Q.lKn-Q.pelPitch+fL.an*m; Q.rAn=Q.rHip-Q.rKn-Q.pelPitch+fR.an*m;
  const gt=p.gait||GAIT0, wS=Math.cos(ph-Math.PI*beta);   // +1 with the weight over the left foot, -1 over the right
  const shift=m*gt.sway*wS*(1-0.6*run)+still*0.018*wt;
  Q.pelRoll=m*gt.roll*wS*(1-0.5*run)+still*0.035*wt; Q.side=-0.6*Q.pelRoll; Q.lHa=0.02+still*0.025; Q.rHa=0.02+still*0.025;
  Q.pelYaw=-0.12*A*cs*gt.hips; Q.twist=0.2*A*cs*(0.6+0.4*gt.hips);
  Q.lFy=Q.rFy=gt.toe*(1-0.5*run);
  Q.x+=Math.cos(p.yaw)*shift; Q.z-=Math.sin(p.yaw)*shift;
  Q.lean=(0.04+gt.lean)*w+0.22*run+b.stoop+0.01*Math.sin(t*1.7+p.seed)*still+(p.lockFeet?p.climb*0.12:0);
  if (p.lockFeet) pinnedLegs(p,t,Q,{s,b,lL,Lt,Ls,fh,SL,beta,run,shift,m});
  // arms swing against the legs; in a run they bend and pump
  // the arms swing a little behind the legs, the forward swing bending the elbow
  const armA=A*(1.15+0.7*run)*gt.arm, ca=Math.cos(ph-0.3);
  Q.lSh=0.03-armA*ca*gt.asym; Q.rSh=0.03+armA*ca/gt.asym;
  Q.lEl=gt.elbow+0.35*Math.max(0,Q.lSh)+run*1.15; Q.rEl=gt.elbow+0.35*Math.max(0,Q.rSh)+run*1.15;
  Q.lAb=Q.rAb=gt.armOut+0.04*run+0.03*(b.girth-1);
  Q.nod=m*gt.nod*Math.cos(2*ph);
  if (p.look.mask&PART.handBag){ Q.rAb=0.2; Q.rSh*=0.3; Q.rEl=0.08; }
  // the arms held otherwise
  if (p.armW>0.001){
    const k=smooth(p.armW);
    if (p.armMode==='gesture'){
      const g1=Math.sin(t*3.1+p.seed), g2=Math.sin(t*4.3+p.seed*2);
      Q.rSh=lerp(Q.rSh,0.42+0.12*g1,k); Q.rAb=lerp(Q.rAb,0.2,k); Q.rTw=lerp(Q.rTw,-0.25,k); Q.rEl=lerp(Q.rEl,1.25+0.3*g2,k);
      if (p.gest2){ Q.lSh=lerp(Q.lSh,0.3+0.1*g2,k); Q.lAb=lerp(Q.lAb,0.18,k); Q.lEl=lerp(Q.lEl,1.1+0.25*g1,k); }
    } else if (p.armMode==='hold'){
      // hand in hand: both arms are solved to one point between the two, a little in front and nearer the child's height
      const H=holdPoint(p);
      if (H){ const [sh,ab,el]=armTo(p,p.holdSide,H);
        if (p.holdSide>0){ Q.lSh=lerp(Q.lSh,sh,k); Q.lAb=lerp(Q.lAb,ab,k); Q.lTw=lerp(Q.lTw,0,k); Q.lEl=lerp(Q.lEl,el,k); }
        else { Q.rSh=lerp(Q.rSh,sh,k); Q.rAb=lerp(Q.rAb,ab,k); Q.rTw=lerp(Q.rTw,0,k); Q.rEl=lerp(Q.rEl,el,k); } }
    } else { const A2=ARMS[p.armMode]; if (A2) for (const key in A2) Q[key]=lerp(Q[key],A2[key],k); }
  }
  Q.skirt=(Q.lHip+Q.rHip)*0.35;

  // sitting
  const seat=p.mode==='unsit'?p.unseat:p.seat;
  if (p.sitW>0.001 && seat){
    const S=_sit; Object.assign(S,Q);
    /* the thighs slope down from the seat just enough for the feet to rest flat on the ground, the shins leaning
       forward as far as the seat is low; legs too short to reach, as a child's are, hang and now and then swing */
    const seatH=seat.h, hipY=seatH+0.07*s, pp=-0.12, drop0=hipY-fh;
    const slope=Math.min(0.35,Math.asin(clamp((drop0-Ls*0.97)/Lt,0,1))), aT=Math.PI/2-slope, drop=drop0-Lt*Math.cos(aT);
    const dangle=drop>Ls, kn=aT-(dangle?0:Math.acos(drop/Ls));
    S.pelPitch=pp; S.pelYaw=0; S.pelRoll=0; S.twist=0;
    S.lean=-0.03+b.stoop*0.6+(p.sitLean?0.32:0);
    S.lHip=S.rHip=aT+pp; S.lHa=S.rHa=0.1;
    const sw=dangle&&p.child?0.32*Math.pow(Math.max(0,Math.sin(t*0.31+p.seed)),3):0;
    S.lKn=kn+sw*Math.sin(t*3.2+p.seed); S.rKn=kn+sw*Math.sin(t*3.2+p.seed+2.4);
    if (p.sitCross && !dangle){ S.lHip+=0.25; S.lKn=1.2; S.lHa=-0.15; }
    S.lAn=S.lHip-S.lKn-pp; S.rAn=S.rHip-S.rKn-pp;
    if (p.sitLean){ S.lSh=S.rSh=0.75; S.lEl=S.rEl=0.9; S.lAb=S.rAb=0.12; }
    else if (p.sitHands){ S.lSh=S.rSh=0.38; S.lTw=S.rTw=0.9; S.lEl=S.rEl=1.15; S.lAb=S.rAb=0.08; }
    else { S.lSh=S.rSh=0.55; S.lTw=S.rTw=0.25; S.lEl=S.rEl=0.6; S.lAb=S.rAb=0.12; }
    if (p.armMode==='gesture' && p.armW>0.01){ const g1=Math.sin(t*3.1+p.seed), g2=Math.sin(t*4.3+p.seed*2), k=smooth(p.armW);
      S.rSh=lerp(S.rSh,0.6+0.12*g1,k); S.rEl=lerp(S.rEl,1.3+0.25*g2,k); S.rTw=lerp(S.rTw,-0.1,k); }
    S.skirt=Math.PI/2*0.92;
    S.hipY=hipY;
    const k=smooth(p.sitW);
    for (const key in Q) if (key!=='x'&&key!=='y'&&key!=='z'&&key!=='yaw') Q[key]=lerp(Q[key],S[key],k);
  }
  // the head and the top of the body turn towards what is looked at
  const tw=clamp(p.hY*0.28,-0.32,0.32)*(1-0.6*w);
  Q.twist+=tw; p.qx=Q.x; p.qz=Q.z; p.qTurn=Q.pelYaw+Q.twist; p.qLean=Q.lean; Q.hdYaw=p.hY-tw; Q.hdPitch=p.hP-Q.lean*0.85-Q.pelPitch*0.8+(Q.nod||0); Q.hdRoll=0.03*Math.sin(t*0.4+p.seed);
}


/* ======================================================================================================
   The life of the town
   People belong to places that come to life near the player: the squares of the villages, the platforms of the
   stations and the ferry landings. Each place has a grid of 0.5 m cells over its walkable ground, found from the
   game's own surfaces and colliders, which gives every cell its height and its clearance from walls and drops, and
   from which paths are found as in the testbench. A place holds only a few people, more in the evening and fewer in
   the hours after lunch and at night. Passengers sit in the coaches of the train and the saloon of the ferry; at a
   stop some walk out through the doors or down the gangway, and people waiting on the platform or the quay go aboard.

   No one appears or disappears in view: a person is created only at a point outside the camera's view (or beyond
   VIEW_FAR), and removed only there. A group that reaches the way out of a place while it can be seen carries on
   about the place and tries again later; passengers join and leave a train or a ferry only while it is out of view.

   ctx: { world, origin, camera, C,
          topAt(x,z,yhi): the highest surface at (x,z) no higher than yhi, or null where something higher stands,
          block(cx,cz): the block record, or null; ready(cx,cz): whether it and its neighbours are built in full,
          player(): {x,y,z,vx,vz}, hour(), night() (0 by day to 1 at night), hidden(): true while a picture is made,
          seatTaken(seat): whether the player or a cat is on one of a block's seats,
          train: { cars(), wait(), doorOpen(), obj() (the train's state: x, dir, v, wait), stationNear(x,r), railZ(x), CDX, CDZ, seats, playerCar() },
          ferry: { list(), quay(R,stop), FB, FPL, FGZ, FD0, FSZ0, seats, ridden() } } */
const VIEW_FAR=420, ACT_R=120, CAP=22, MAXP=64, SQUARE_KINDS=new Set(['piazza','church']);
const NB=[[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.4142],[1,-1,1.4142],[-1,1,1.4142],[-1,-1,1.4142]];

// a place's grid: walkable cells with their heights, clearance to walls and drops, and paths by flow fields
function makeGrid(x0,z0,w,d,surf){
  const cs=0.5, nx=Math.ceil(w/cs), nz=Math.ceil(d/cs), N=nx*nz;
  const G={x0,z0,cs,nx,nz,N,hgt:new Float32Array(N),clr:new Float32Array(N),open:new Uint8Array(N),done:0,ready:false,fields:new Map(),budget:2};
  const cX=c=>x0+(c%nx+0.5)*cs, cZ=c=>z0+(Math.floor(c/nx)+0.5)*cs;
  G.cX=cX; G.cZ=cZ;
  G.cellOf=(x,z)=>{ const i=Math.floor((x-x0)/cs), j=Math.floor((z-z0)/cs); return (i<0||j<0||i>=nx||j>=nz)?-1:j*nx+i; };
  // built a few hundred cells at a time, so that no frame waits for a whole square
  G.build=n=>{
    for (let k=0;k<n&&G.done<N;k++,G.done++){ const c=G.done, s=surf(cX(c),cZ(c)); if (s==null){ G.open[c]=0; G.hgt[c]=-99; } else { G.open[c]=1; G.hgt[c]=s; } }
    if (G.done<N||G.ready) return;
    // the edge of a drop, or of a step too high to take, is a wall
    const blocked=new Uint8Array(N);
    for (let c=0;c<N;c++){ if (!G.open[c]){ blocked[c]=1; continue; } const i=c%nx;
      for (const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){ if (i+di<0||i+di>=nx) continue; const n2=c+dj*nx+di; if (n2<0||n2>=N) continue;
        if (G.open[n2]&&Math.abs(G.hgt[n2]-G.hgt[c])>0.42) blocked[c]=1; } }
    const INF=1e9, D=cs, D2=cs*Math.SQRT2, cl=G.clr;
    for (let c=0;c<N;c++) cl[c]=blocked[c]?0:INF;
    for (let j=0;j<nz;j++) for (let i=0;i<nx;i++){ const c=j*nx+i; let v=cl[c]; if (!v) continue;
      v=i>0?Math.min(v,cl[c-1]+D):Math.min(v,D); if (j>0){ v=Math.min(v,cl[c-nx]+D); if (i>0) v=Math.min(v,cl[c-nx-1]+D2); if (i<nx-1) v=Math.min(v,cl[c-nx+1]+D2); } else v=Math.min(v,D); cl[c]=v; }
    for (let j=nz-1;j>=0;j--) for (let i=nx-1;i>=0;i--){ const c=j*nx+i; let v=cl[c]; if (!v) continue;
      v=i<nx-1?Math.min(v,cl[c+1]+D):Math.min(v,D); if (j<nz-1){ v=Math.min(v,cl[c+nx]+D); if (i<nx-1) v=Math.min(v,cl[c+nx+1]+D2); if (i>0) v=Math.min(v,cl[c+nx-1]+D2); } else v=Math.min(v,D); cl[c]=v; }
    for (let c=0;c<N;c++) cl[c]=cl[c]>0?Math.max(0,cl[c]-cs*0.5):-0.3;
    G.ready=true;
  };
  G.clearAt=(x,z)=>{ const fx=(x-x0)/cs-0.5, fz=(z-z0)/cs-0.5, i=Math.floor(fx), j=Math.floor(fz), u=fx-i, v=fz-j;
    if (!(i>=0&&j>=0&&i<nx-1&&j<nz-1)) return -1; const c=j*nx+i, k=G.clr;
    return (k[c]*(1-u)+k[c+1]*u)*(1-v)+(k[c+nx]*(1-u)+k[c+nx+1]*u)*v; };
  G.ground=(x,z,y)=>{ const c=G.cellOf(x,z); if (c<0||!G.open[c]) return y; return G.hgt[c]; };
  G.los=(xa,za,xb,zb,need=0.27)=>{ const d=Math.hypot(xb-xa,zb-za), n=Math.ceil(d/0.25); for (let k=1;k<=n;k++){ const t=k/n; if (G.clearAt(xa+(xb-xa)*t,za+(zb-za)*t)<need) return false; } return true; };
  const WALK=0.3;
  G.field=(x,z)=>{
    let t=G.cellOf(x,z); if (t<0) return null; const key0=t;
    if (G.fields.has(key0)) return G.fields.get(key0);
    if (G.budget<=0) return null; G.budget--;
    if (G.clr[t]<WALK){ let best=-1, bd=1e9; for (let dj=-6;dj<=6;dj++) for (let di=-6;di<=6;di++){ const c=t+dj*nx+di; if (c>=0&&c<N&&G.clr[c]>=WALK){ const q=di*di+dj*dj; if (q<bd){ bd=q; best=c; } } } if (best<0) return null; t=best; }
    // in double precision, so that no rounding up can reopen a settled cell
    const Dd=new Float64Array(N).fill(Infinity), H=[], push=(c,v)=>{ H.push([v,c]); let i=H.length-1; while (i>0){ const p=(i-1)>>1; if (H[p][0]<=H[i][0]) break; [H[p],H[i]]=[H[i],H[p]]; i=p; } },
      pop=()=>{ const top=H[0], last=H.pop(); if (H.length){ H[0]=last; let i=0; for(;;){ const l=2*i+1, r=l+1; let m=i; if (l<H.length&&H[l][0]<H[m][0]) m=l; if (r<H.length&&H[r][0]<H[m][0]) m=r; if (m===i) break; [H[m],H[i]]=[H[i],H[m]]; i=m; } } return top; };
    Dd[t]=0; push(t,0);
    while (H.length){ const [dv,c]=pop(); if (dv>Dd[c]) continue; const i=c%nx;
      for (const [di,dj,w] of NB){ if (i+di<0||i+di>=nx) continue; const n2=c+dj*nx+di; if (n2<0||n2>=N||G.clr[n2]<WALK) continue;
        if (di&&dj&&(G.clr[c+di]<WALK||G.clr[c+dj*nx]<WALK)) continue;
        const nd=dv+w*(1+0.6*Math.max(0,0.9-G.clr[n2])); if (nd<Dd[n2]){ Dd[n2]=nd; push(n2,nd); } } }
    const F=Float32Array.from(Dd); G.fields.set(key0,F); if (G.fields.size>40) G.fields.delete(G.fields.keys().next().value); return F;
  };
  G.waypoint=(x,z,tx,tz)=>{
    if (G.los(x,z,tx,tz)) return [tx,tz];
    const F=G.field(tx,tz); if (!F) return null; const c=G.cellOf(x,z); if (c<0) return null;
    if (!(F[c]<Infinity)){ let b=-1, bv=Infinity; for (let dj=-3;dj<=3;dj++) for (let di=-3;di<=3;di++){ const n2=c+dj*nx+di; if (n2>=0&&n2<N&&F[n2]<bv){ bv=F[n2]; b=n2; } } return b<0?null:[cX(b),cZ(b)]; }
    let wx=cX(c), wz=cZ(c), cur=c, miss=0;
    for (let k=0;k<40;k++){ let nb=-1, nv=F[cur]; const i=cur%nx;
      for (const [di,dj] of NB){ if (i+di<0||i+di>=nx) continue; const n2=cur+dj*nx+di; if (n2>=0&&n2<N&&F[n2]<nv){ nv=F[n2]; nb=n2; } }
      if (nb<0) break; cur=nb; if (G.los(x,z,cX(cur),cZ(cur))){ wx=cX(cur); wz=cZ(cur); miss=0; } else if (++miss>4) break; }
    return [wx,wz];
  };
  return G;
}

export function createPeople(ctx){
  const O=ctx.origin, cam=ctx.camera;
  const body=createPeopleMesh(ctx.world, MAXP, O); body.mesh.visible=false;
  const people=[], groups=[], places=new Map(), games=[], pax=[];
  let on=false, simT=0, NEXT=1, scanT=0, wasWait=0; const ferryWas=new Map();
  const POSE=newPose(), rnd=Math.random, rand=(a,b)=>a+rnd()*(b-a);

  /* ---------- what the camera sees ---------- */
  const frustum=new THREE.Frustum(), _vm=new THREE.Matrix4(), _sph=new THREE.Sphere();
  function viewUpdate(){ _vm.compose(cam.position,cam.quaternion,cam.scale).invert().premultiply(cam.projectionMatrix); frustum.setFromProjectionMatrix(_vm); }
  function inView(x,y,z){ if (Math.hypot(x-cam.position.x,y-cam.position.y,z-cam.position.z)>VIEW_FAR) return false; _sph.center.set(x,y+0.9,z); _sph.radius=1.4; return frustum.intersectsSphere(_sph); }
  // out of view, and not right behind the camera either, where a turn of the head would find them
  const hiddenAt=(x,y,z)=>!inView(x,y,z) && Math.hypot(x-cam.position.x,z-cam.position.z)>8;

  /* ---------- places ---------- */
  function hashS(s){ let h=0; for (let i=0;i<s.length;i++) h=Math.imul(h,31)+s.charCodeAt(i)|0; return (h>>>0)/4294967296; }
  function newPlace(key,kind,cx,cz,w,d,surf,extra){
    return Object.assign({key,kind,x:cx,z:cz,G:makeGrid(cx-w/2,cz-d/2,w,d,surf),seen:simT,base:1+Math.floor(hashS(key)*3),seatSets:[],spots:[],exits:[],spawnT:0,setup:false},extra);
  }
  // once the grid is built: the places to stop, the ways in and out, and the seats whose approach lies on the grid
  function setupPlace(pl){
    const G=pl.G; pl.setup=true;
    for (let k=0;k<600&&pl.spots.length<24;k++){ const c=Math.floor(rnd()*G.N); if (G.clr[c]>(pl.kind==='station'?0.55:1.0)&&pl.spotOk(G.cX(c),G.cZ(c))) pl.spots.push({x:G.cX(c),z:G.cZ(c)}); }
    for (let c=0;c<G.N;c++){ if (G.clr[c]<0.45) continue; const x=G.cX(c), z=G.cZ(c); if (pl.exitOk(x,z)) pl.exits.push({x,z}); }
    if (pl.exits.length>60){ const keep=[], st=Math.ceil(pl.exits.length/60); for (let i=0;i<pl.exits.length;i+=st) keep.push(pl.exits[i]); pl.exits=keep; }
    const seats=[], seen=new Set();
    for (let j=-1;j<=1;j++) for (let i=-1;i<=1;i++){ const ch=ctx.block(Math.floor(pl.x/ctx.C)+i,Math.floor(pl.z/ctx.C)+j); if (!ch||!ch.seats) continue;
      for (const s of ch.seats){ if (seen.has(s)||s.kind==='lounger') continue; seen.add(s); const ax=s.x+s.fx*0.6, az=s.z+s.fz*0.6, y0=s.y-s.h;
        if (G.clearAt(ax,az)<0.3||Math.abs(G.ground(ax,az,-99)-y0)>0.3) continue;
        seats.push({x:s.x,z:s.z,h:s.h,y0,yaw:Math.atan2(s.fx,s.fz),ax,az,taken:null,ref:s}); } }
    // seats close together are one bench; chairs round one table are a table
    for (const s of seats){ if (s.set) continue; const set={kind:s.ref.kind==='chair'?'table':'bench',seats:[]};
      for (const t of seats) if (!t.set&&Math.hypot(t.x-s.x,t.z-s.z)<(set.kind==='table'?1.6:1.1)){ t.set=set; set.seats.push(t); }
      pl.seatSets.push(set); }
  }
  function scan(){
    const P=ctx.player(), C=ctx.C;
    for (let j=-4;j<=4;j++) for (let i=-4;i<=4;i++){ const cx=Math.floor(P.x/C)+i, cz=Math.floor(P.z/C)+j, ch=ctx.block(cx,cz);
      if (!ch||ch.lod!==0||!ch.piazza||!SQUARE_KINDS.has(ch.kind)||!ctx.ready(cx,cz)) continue;
      const Pz=ch.piazza; if (Math.hypot(Pz.x-P.x,Pz.z-P.z)>ACT_R) continue;
      const key='sq:'+Math.round(Pz.x)+','+Math.round(Pz.z); let pl=places.get(key);
      if (!pl){ const r=Pz.r+6, lv=Pz.level;
        pl=newPlace(key,'square',Pz.x,Pz.z,2*r,2*r,(x,z)=>{ if (Math.hypot(x-Pz.x,z-Pz.z)>r) return null; const s=ctx.topAt(x,z,lv+0.45); return (s==null||s<0.3||Math.abs(s-lv)>2.2)?null:s; },
          {exitOk:(x,z)=>Math.hypot(x-Pz.x,z-Pz.z)>r-1.2, spotOk:(x,z)=>Math.hypot(x-Pz.x,z-Pz.z)<Pz.r});
        places.set(key,pl); }
      pl.seen=simT; }
    const S=ctx.train.stationNear(P.x,ACT_R);
    if (S&&Math.hypot(S.x-P.x,S.z-P.z)<ACT_R&&ctx.ready(Math.floor(S.x/C),Math.floor(S.z/C))){ const key='st:'+S.n; let pl=places.get(key);
      if (!pl){ pl=newPlace(key,'station',S.x,S.z+S.side*3.4,62,18,(x,z)=>{ const u=x-S.x, v=(z-ctx.train.railZ(x))*S.side; if (Math.abs(u)>29.5||v<2.05||v>4.85) return null;
            const s=ctx.topAt(x,z,S.ry+1.4); return (s==null||s<S.ry+0.12)?null:s; },
          {S, exitOk:(x)=>Math.abs(x-S.x)>22.5, spotOk:(x)=>Math.abs(x-S.x)<20});
        places.set(key,pl); }
      pl.seen=simT; }
    for (const F of ctx.ferry.list()){ if (!F.R) continue;
      for (const stop of [0,1]){ const [qx,qz]=ctx.ferry.quay(F.R,stop); if (Math.hypot(qx-P.x,qz-P.z)>ACT_R||!ctx.ready(Math.floor(qx/C),Math.floor(qz/C))) continue;
        const key='fq:'+Math.round(qx)+','+Math.round(qz); let pl=places.get(key);
        if (!pl){ pl=newPlace(key,'quay',qx,qz,24,24,(x,z)=>{ const s=ctx.topAt(x,z,2.6); return (s==null||s<0.9)?null:s; },
            {exitOk:(x,z)=>Math.hypot(x-qx,z-qz)>9, spotOk:(x,z)=>Math.hypot(x-qx,z-qz)<7}); places.set(key,pl); }
        pl.F=F; pl.stop=stop; pl.seen=simT; } }
    for (const [k,pl] of places){ pl.gone=simT-pl.seen>3; if (pl.gone&&!people.some(p=>p.place===pl)&&!pax.some(p=>p.veh.place===pl)) places.delete(k); }
  }
  // how many people a place holds: few at night and in the hours after lunch, most in the evening
  function target(pl){
    if (pl.gone||!pl.G.ready) return 0;
    const h=ctx.hour(), n=ctx.night(), f=n>0.7?0.3:(h>13.5&&h<16)?0.5:(h>18&&h<21.5)?1.4:1;
    if (pl.kind==='square') return Math.round(pl.base*f);
    return Math.max(1,Math.round(pl.base*Math.max(0.5,f)*0.7));   // someone is nearly always waiting for the train or the ferry
  }

  /* ---------- people and groups ---------- */
  function makePerson(kind,age,pl){
    const look=makeLook(kind,age,rnd), p={ id:NEXT++, look, kind, child:look.child, elder:look.elder, rad:look.child?0.19:0.25+0.03*(look.body.girth-1),
      x:0,y:0,z:0,climb:0,vx:0,vz:0,yaw:0,speedSm:0,phase:rnd()*TAU,walkW:0,turnStep:0,yawRate:0,
      pref:clamp(look.child?gauss(rnd,1.25,0.12):look.elder?gauss(rnd,1.0,0.1):gauss(rnd,look.man?1.36:1.28,0.12),0.75,1.7),
      runSpeed:look.child?2.3+rnd()*0.6:2.6, canRun:look.child, lockFeet:true, mode:'slot', tx:0,tz:0, face:null, group:null, order:0,
      slotL:0,slotF:0,sitW:0,seat:null,hY:0,hP:0,gaze:null,gazeT:0,armMode:'free',armW:0,armWant:'free',gest2:false,holdSide:0,
      wp:null,wpT:0,seed:rnd()*100,kidMode:'slot',kidT:2+rnd()*4,game:null,freeze:0,alive:true,
      sitLean:look.elder&&rnd()<0.35, sitHands:rnd()<0.4, sitCross:!look.child&&rnd()<0.25,
      walkArms:look.elder&&look.man&&rnd()<0.45?'behind':!look.child&&look.man&&rnd()<0.14?'pockets':!look.child&&rnd()<0.1?'pocketL':'free',
      place:pl, veh:null };
    R=rnd; p.gait=makeGait(look);
    p.ground=(x,z,y)=>p.veh?p.y:p.place?p.place.G.ground(x,z,y):y;
    return p;
  }
  function makeGroup(members,kind,pl){
    const g={id:NEXT++,kind,members,place:pl,state:'walk',dest:null,ax:0,az:0,ayaw:0,avx:0,avz:0,timer:0,visits:0,circle:null,wp:null,wpT:0,board:null,alighted:false};
    const adults=members.filter(m=>!m.child);
    g.speed=Math.min(...(adults.length?adults:members).map(m=>m.pref))*[1,1,0.88,0.82,0.78][Math.min(4,members.length)];
    const kids=members.filter(m=>m.child), row=adults.length>=2?[adults[0],...kids,...adults.slice(1)]:[...adults,...kids];
    row.forEach((m,i)=>{ m.order=i; m.group=g; });
    return g;
  }
  // mostly people on their own and couples; now and then a parent with a child or two, or a few friends
  function compose(pl){
    const adult=(old=rnd()<0.25)=>makePerson(rnd()<0.5?'man':'woman',old?66+Math.floor(rand(0,20)):18+Math.floor(rand(0,46)),pl);
    const q=rnd();
    if (q<0.5) return makeGroup([adult()],'single',pl);
    if (q<0.72){ const a=adult(); return makeGroup([a,makePerson(a.kind==='man'?'woman':'man',clamp(a.look.age+Math.floor(gauss(rnd,0,4)),18,85),pl)],'couple',pl); }
    if (q<0.88){ const m=[makePerson(rnd()<0.6?'woman':'man',26+Math.floor(rand(0,18)),pl)], nk=rnd()<0.65?1:2;
      for (let i=0;i<nk;i++) m.push(makePerson(rnd()<0.5?'boy':'girl',4+Math.floor(rand(0,9)),pl)); return makeGroup(m,'family',pl); }
    const m=[adult(false),adult(false)]; if (rnd()<0.3) m.push(adult(false)); return makeGroup(m,'friends',pl);
  }
  function placeGroup(g,x,z,yaw){
    g.ax=x; g.az=z; g.ayaw=yaw; g.avx=g.avz=0; const G=g.place.G;
    for (const m of g.members){ m.x=x+(rnd()-0.5)*1.0; m.z=z+(rnd()-0.5)*1.0; if (G.clearAt(m.x,m.z)<0.3){ m.x=x; m.z=z; }
      m.y=G.ground(m.x,m.z,0); m.yaw=yaw; m.vx=m.vz=0; m.mode='slot'; m.pinL=m.pinR=null; m.hipW=null; people.push(m); }
    groups.push(g);
  }
  function freeSeat(m){ for (const s of [m.seat,m.unseat]) if (s){ s.taken=null; if (s.ref&&s.ref.ppl===m) s.ref.ppl=null; } }
  function dropPerson(m){ m.alive=false; freeSeat(m); leaveGame(m); }
  function removeGroup(g){ for (const m of g.members) dropPerson(m); for (let i=people.length-1;i>=0;i--) if (!people[i].alive) people.splice(i,1); const i=groups.indexOf(g); if (i>=0) groups.splice(i,1); }
  const seatFreeAt=s=>!s.taken&&!(s.ref&&(s.ref.ppl||ctx.seatTaken(s.ref)));
  function freeRun(set,k){ const f=set.seats.filter(seatFreeAt); if (set.kind==='table') return set.seats.every(seatFreeAt)&&f.length>=k?f.slice(0,k):null; return f.length>=k?f.slice(0,k):null; }
  function chooseDest(g){
    const pl=g.place, adults=g.members.filter(m=>!m.child), n=g.members.length, elder=adults.length&&adults.every(m=>m.elder);
    g.visits++;
    const leave=(pl.gone||people.filter(p=>p.place===pl).length>target(pl))?0.8:0.06+0.08*g.visits;
    const w=[leave, elder?0.45:0.25, n>1?0.3:0.25, 0.2], opts=['leave','sit','spot','pause'];
    for (let t=0;t<5;t++){ const kind=pickW(rnd,opts,w);
      if (kind==='leave'&&pl.exits.length){ const e=pick(rnd,pl.exits); g.dest={kind:'leave',x:e.x,z:e.z}; return; }
      if (kind==='sit'){ const k=Math.max(1,Math.min(3,adults.length+(g.kind==='family'?1:0)));
        for (const set of pl.seatSets.slice().sort(()=>rnd()-0.5)){ const run=freeRun(set,Math.min(k,set.seats.length)); if (!run) continue;
          const sitters=(g.kind==='family'?[...adults,...g.members.filter(m=>m.child)]:g.members).slice(0,run.length);
          sitters.forEach((m,i)=>{ run[i].taken=m; if (run[i].ref) run[i].ref.ppl=m; m.seat=run[i]; });
          g.dest={kind:'sit',x:run.reduce((s,a)=>s+a.ax,0)/run.length,z:run.reduce((s,a)=>s+a.az,0)/run.length}; return; }
        continue; }
      if (pl.spots.length){ const s=pick(rnd,pl.spots); g.dest={kind:kind==='pause'?'pause':'spot',x:s.x,z:s.z}; return; }
    }
    g.dest={kind:'spot',x:g.ax,z:g.az};
  }
  function releaseHands(g){ for (const m of g.members){ m.armWant='free'; m.holdKid=null; m.holdBy=null; if (m.child) m.kidMode='slot'; } }
  function startWalk(g){
    if (g.kind==='family'){ const kids=g.members.filter(m=>m.child).sort((a,b)=>a.look.age-b.look.age); if (kids[0]&&rnd()<(kids[0].look.age<9?0.8:0.4)){ kids[0].kidMode='hold'; kids[0].kidT=8+rnd()*10; } }
    const ad=g.members.filter(m=>!m.child), src=ad.length?ad:g.members;
    if (g.state!=='walk'){ g.ax=src.reduce((s,m)=>s+m.x,0)/src.length; g.az=src.reduce((s,m)=>s+m.z,0)/src.length; }
    g.state='walk'; g.circle=null; g.wp=null;
    for (const m of g.members){ m.mode=m.unseat?'unsit':'slot'; m.face=null; m.circle=null; leaveGame(m); m.armWant=m.walkArms; }
  }
  function arrive(g){
    const d=g.dest; releaseHands(g);
    if (d.kind==='leave'){ g.state='leaving'; for (const m of g.members){ m.mode='goto'; m.tx=d.x; m.tz=d.z; } return; }
    if (d.kind==='sit'){ g.state='sit'; g.timer=25+rnd()*70; for (const m of g.members){ if (m.seat){ m.mode='toSeat'; m.tx=m.seat.ax; m.tz=m.seat.az; } else if (m.child) joinGame(m,g); else { m.mode='stand'; m.tx=m.x; m.tz=m.z; } } return; }
    if (g.members.length>1&&d.kind==='spot'){ g.state='talk'; g.timer=12+rnd()*30; makeCircle(g); return; }
    g.state='pause'; g.timer=3+rnd()*8; for (const m of g.members){ m.mode='stand'; m.tx=m.x; m.tz=m.z; m.face=null; }
  }
  function makeCircle(g){
    const talkers=g.members.filter(m=>!m.child||g.members.every(o=>o.child)), n=talkers.length, r=n<=2?0.62:0.42+0.15*n, cx=g.ax, cz=g.az;
    const C={x:cx,z:cz,members:talkers,speaker:pick(rnd,talkers),spT:2+rnd()*4};
    const ring=talkers.map(m=>({m,a:Math.atan2(m.z-cz,m.x-cx)})).sort((a,b)=>a.a-b.a);
    ring.forEach((o,i)=>{ const a=ring[0].a+i/n*TAU; o.m.mode='stand'; o.m.tx=cx+Math.cos(a)*r; o.m.tz=cz+Math.sin(a)*r; o.m.face=Math.atan2(cx-o.m.tx,cz-o.m.tz); o.m.circle=C; });
    for (const k of g.members) if (!talkers.includes(k)) joinGame(k,g);
    g.circle=C;
  }
  function joinGame(k,g){
    k.mode='play'; k.home=g; let Gm=games.find(G2=>G2.place===g.place&&Math.hypot(G2.x-g.ax,G2.z-g.az)<14);
    if (!Gm){ Gm={x:g.ax,z:g.az,members:[],it:null,itWait:0,place:g.place}; games.push(Gm); }
    Gm.members.push(k); k.game=Gm; if (!Gm.it||Gm.members.length===1){ Gm.it=k; Gm.itWait=1.5; } k.playT=0; k.tx=k.x; k.tz=k.z;
  }
  function leaveGame(k){ const Gm=k.game; if (!Gm) return; Gm.members.splice(Gm.members.indexOf(k),1); k.game=null;
    if (Gm.it===k) Gm.it=Gm.members.length?pick(rnd,Gm.members):null; if (!Gm.members.length) games.splice(games.indexOf(Gm),1); }
  function playThink(k,dt){
    const Gm=k.game, home=k.home, G=k.place.G; if (!Gm) return;
    const hx=home?home.ax:Gm.x, hz=home?home.az:Gm.z; k.speedWant=1.3; k.playT-=dt;
    if (k.freeze>0){ k.freeze-=dt; k.tx=k.x; k.tz=k.z; k.speedWant=0; return; }
    if (Gm.it===k&&Gm.members.length>1){
      if (Gm.itWait>0){ Gm.itWait-=dt; k.tx=k.x; k.tz=k.z; k.speedWant=0; return; }
      let best=null, bd=1e9; for (const o of Gm.members) if (o!==k&&o.freeze<=0){ const d=Math.hypot(o.x-k.x,o.z-k.z); if (d<bd){ bd=d; best=o; } }
      if (best){ k.tx=best.x; k.tz=best.z; k.speedWant=k.runSpeed*0.95; if (bd<0.5){ Gm.it=best; Gm.itWait=1.2; best.freeze=1.2; k.playT=0; } }
      return; }
    const it=Gm.it;
    if (it&&it!==k){ const dx=k.x-it.x, dz=k.z-it.z, d=Math.hypot(dx,dz)||1; if (d<4.5){ let fx=dx/d, fz=dz/d; const bx=hx-k.x, bz=hz-k.z, bd=Math.hypot(bx,bz); if (bd>7){ fx+=bx/bd*0.8; fz+=bz/bd*0.8; }
      k.tx=k.x+fx*3; k.tz=k.z+fz*3; if (G.clearAt(k.tx,k.tz)<0.4){ k.tx=k.x+fz*3; k.tz=k.z-fx*3; } k.speedWant=k.runSpeed; return; } }
    if (k.playT<=0){ k.playT=2+rnd()*4; for (let t=0;t<8;t++){ const a=rnd()*TAU, r=1+rnd()*5, x=hx+Math.cos(a)*r, z=hz+Math.sin(a)*r; if (G.clearAt(x,z)>0.6){ k.tx=x; k.tz=z; break; } } }
    k.speedWant=Math.hypot(k.tx-k.x,k.tz-k.z)>1?1.6:0;
  }
  function formation(g){
    const ms=g.members.filter(m=>m.mode==='slot'), n=ms.length; if (!n) return; ms.sort((a,b)=>a.order-b.order);
    const G=g.place.G, avail=Math.max(0.2,2*(G.clearAt(g.ax,g.az)-0.35));
    const gap=(a,b)=>(a.child&&b.child)?0.5:(a.child||b.child)?(a.kidMode==='hold'||b.kidMode==='hold'?0.64:0.55):0.72;
    let lat=[0]; for (let i=1;i<n;i++) lat.push(lat[i-1]+gap(ms[i-1],ms[i]));
    const width=lat[n-1], mid=width/2; lat=lat.map(l=>l-mid); let fwd=lat.map(l=>n>=3?-0.28*(1-Math.abs(l)/(mid||1)):0);
    if (width>avail){ const per=Math.max(1,Math.floor(avail/0.62)+1); lat=[]; fwd=[]; for (let i=0;i<n;i++){ const r=Math.floor(i/per), c=i%per, inRow=Math.min(per,n-r*per); lat.push((c-(inRow-1)/2)*(Math.min(0.62,avail/Math.max(1,inRow-1))||0)); fwd.push(-r*0.95); } }
    ms.forEach((m,i)=>{ let L=lat[i], Fw=fwd[i]; if (m.child&&m.kidMode==='ahead'){ L=m.aheadL; Fw=m.aheadF; } m.slotL+=(L-m.slotL)*0.04; m.slotF+=(Fw-m.slotF)*0.04; });
    for (let i=0;i<n;i++){ const m=ms[i]; if (!(m.child&&m.kidMode==='hold')) continue; const nb=[ms[i-1],ms[i+1]].filter(o=>o&&!o.child)[0]; if (!nb){ m.kidMode='slot'; continue; }
      const side=Math.sign(nb.slotL-m.slotL)||1; m.armWant='hold'; m.holdSide=side; nb.armWant='hold'; nb.holdSide=-side; nb.holdKid=m; m.holdBy=nb; }
  }
  const slotPos=(g,m)=>{ const c=Math.cos(g.ayaw), s=Math.sin(g.ayaw); return [g.ax+c*m.slotL+s*m.slotF, g.az-s*m.slotL+c*m.slotF]; };
  function moveAnchor(g,dt){
    const d=g.dest, G=g.place.G; let lag=0;
    for (const m of g.members) if (m.mode==='slot'&&!(m.child&&m.kidMode==='ahead')){ const [sx,sz]=slotPos(g,m); lag=Math.max(lag,Math.hypot(sx-m.x,sz-m.z)); }
    for (const m of g.members) if (m.mode==='unsit') lag=Math.max(lag,3);
    g.wpT-=dt; if (!g.wp||g.wpT<=0){ g.wp=G.waypoint(g.ax,g.az,d.x,d.z)||[d.x,d.z]; g.wpT=0.35; }
    const dx=g.wp[0]-g.ax, dz=g.wp[1]-g.az, dl=Math.hypot(dx,dz)||1, rem=Math.hypot(d.x-g.ax,d.z-g.az);
    const gt=g.members[0].gait, v=g.speed*(1+gt.pace*Math.sin(simT*gt.paceF+g.id))*clamp(1.5-lag/1.1,0,1)*clamp(rem/1.2,0.25,1);
    g.avx=lerp(g.avx,dx/dl*v,ease(4,dt)); g.avz=lerp(g.avz,dz/dl*v,ease(4,dt)); g.ax+=g.avx*dt; g.az+=g.avz*dt;
    if (Math.hypot(g.avx,g.avz)>0.2) g.ayaw+=wrapA(Math.atan2(g.avx,g.avz)-g.ayaw)*ease(2.2,dt);
    return rem;
  }
  function groupThink(g,dt){
    g.timer-=dt;
    if (g.board) return;   // walking to the train or the ferry: see vehicleTick
    if (g.state==='walk'){
      formation(g); const rem=moveAnchor(g,dt);
      for (const m of g.members) if (m.child&&g.kind==='family'){ m.kidT-=dt; if (m.kidT<=0){ m.kidT=4+rnd()*7; const young=m.look.age<8, q=rnd();
        m.kidMode=q<(young?0.65:0.25)?'hold':q<(young?0.8:0.5)?'ahead':'slot'; if (m.kidMode==='hold') m.kidT+=6; if (m.kidMode==='ahead'){ m.aheadF=2+rnd()*2.5; m.aheadL=(rnd()-0.5)*2; }
        if (m.kidMode!=='hold'){ m.armWant='free'; if (m.holdBy){ m.holdBy.armWant=m.holdBy.walkArms; m.holdBy.holdKid=null; m.holdBy=null; } } } }
      if (rem<0.6){ g.avx=g.avz=0; arrive(g); }
      return; }
    if (g.state==='leaving'){
      if (g.members.every(m=>Math.hypot(m.x-g.dest.x,m.z-g.dest.z)<0.9)){
        if (g.members.every(m=>hiddenAt(m.x,m.y,m.z))){ removeGroup(g); return; }
        g.state='pause'; g.timer=2+rnd()*4; for (const m of g.members){ m.mode='stand'; m.tx=m.x; m.tz=m.z; } }
      return; }
    if (g.state==='talk'&&g.circle){ const C=g.circle; C.spT-=dt; if (C.spT<=0){ C.spT=1.8+rnd()*5; const o=C.members.filter(m=>m!==C.speaker); if (o.length) C.speaker=pick(rnd,o); } }
    if (g.state==='sit'&&g.timer<0&&g.members.some(m=>m.mode==='toSeat')) g.timer=3;
    if (g.place.gone&&g.timer>2) g.timer=2;
    if (g.timer<0){
      for (const m of g.members) if (m.seat){ if (m.sitW>0||m.mode==='sit') m.unseat=m.seat; else freeSeat(m); m.seat=null; }
      chooseDest(g); startWalk(g); }
  }

  /* ---------- moving each person ---------- */
  const HASH=new Map(), HC=2, NEAR=[], NEAR2=[];
  const hkey=(x,z)=>(Math.floor(x/HC)+100000)*262144+(Math.floor(z/HC)+100000);
  function rebuildHash(){ HASH.clear(); for (const p of people){ const k=hkey(p.x,p.z); let a=HASH.get(k); if (!a) HASH.set(k,a=[]); a.push(p); } }
  function near(x,z,r,out){ out.length=0; const i0=Math.floor((x-r)/HC), i1=Math.floor((x+r)/HC), j0=Math.floor((z-r)/HC), j1=Math.floor((z+r)/HC);
    if (!(i1-i0<20&&j1-j0<20)) return out;
    for (let i=i0;i<=i1;i++) for (let j=j0;j<=j1;j++){ const a=HASH.get((i+100000)*262144+(j+100000)); if (a) for (const p of a) out.push(p); } return out; }
  // the player, whom people avoid and step round, and who is never pushed
  const PL={id:-1,x:0,z:0,vx:0,vz:0,rad:0.3,group:null,speedSm:0,sitW:0};
  function ttc(p,q,k,f){
    const rx=p.x-q.x, rz=p.z-q.z, Rr=(p.rad+q.rad)*(p.group&&p.group===q.group?0.8:1), vx=p.vx-q.vx, vz=p.vz-q.vz, c=rx*rx+rz*rz-Rr*Rr;
    if (c<1e-3){ const d=Math.sqrt(rx*rx+rz*rz)||1e-3, pen=Math.max(0,Rr-d); f[0]+=rx/d*pen*14; f[1]+=rz/d*pen*14; return; }
    const a=vx*vx+vz*vz, b=rx*vx+rz*vz; if (a<1e-5||b>=0) return;
    let disc=b*b-a*c; if (disc<=0) return; disc=Math.sqrt(disc);
    let tau=c/(-b+disc); if (tau<0||tau>4) return; tau=Math.max(tau,0.05);
    const mag=k*Math.exp(-tau/3)/(a*tau*tau)*(2/tau+1/3);
    let fx=-mag*(vx-(a*rx-b*vx)/disc), fz=-mag*(vz-(a*rz-b*vz)/disc); const fl=Math.hypot(fx,fz); if (fl>5){ fx*=5/fl; fz*=5/fl; }
    const sp=Math.hypot(p.vx,p.vz); if (sp>0.3&&-b/Math.sqrt(a*(rx*rx+rz*rz))>0.9){ const s=Math.min(fl,5)*0.35; fx+=-p.vz/sp*s; fz+=p.vx/sp*s; }
    if (Number.isFinite(fx)&&Number.isFinite(fz)){ f[0]+=fx; f[1]+=fz; }
  }
  const _fa={}, _fb={};
  function footprint(p,o){ if (p===PL){ o.x=PL.x; o.z=PL.z; o.r=PL.rad; o.w=0; return o; }
    if (p.sitW>0.5){ o.x=p.x+Math.sin(p.yaw)*0.3*p.look.body.s; o.z=p.z+Math.cos(p.yaw)*0.3*p.look.body.s; o.r=p.rad+0.06; o.w=0; }
    else { o.x=p.x; o.z=p.z; o.r=p.rad; o.w=(p.mode==='sit'||p.mode==='unsit')?0:p.speedSm<0.2?0.35:1; } return o; }
  // no one passes through anyone else, nor through the player
  function separate(){
    for (let it=0;it<2;it++){ rebuildHash();
      for (const p of people){ const a=footprint(p,_fa), G=p.place.G, list=near(a.x,a.z,1.4,NEAR2).slice(); list.push(PL);
        for (const q of list){ if (q===p||(q!==PL&&(q.id<=p.id||q.place!==p.place))) continue; const c=footprint(q,_fb), W=a.w+c.w; if (!W) continue;
          let dx=c.x-a.x, dz=c.z-a.z, d=Math.hypot(dx,dz); const Rr=(a.r+c.r)*(q!==PL&&p.group===q.group?0.88:1); if (d>=Rr) continue;
          if (d<1e-4){ dx=Math.cos(p.id); dz=Math.sin(p.id); d=1; } else { dx/=d; dz/=d; }
          const o=Rr-Math.min(d,Rr), mp=o*a.w/W, mq=o*c.w/W;
          if (mp>0&&G.clearAt(p.x-dx*mp,p.z-dz*mp)>p.rad*0.6){ p.x-=dx*mp; p.z-=dz*mp; a.x-=dx*mp; a.z-=dz*mp; }
          if (mq>0&&q!==PL&&G.clearAt(q.x+dx*mq,q.z+dz*mq)>q.rad*0.6){ q.x+=dx*mq; q.z+=dz*mq; } } } }
  }
  function steerTo(p,tx,tz,dt){
    const d=Math.hypot(tx-p.x,tz-p.z); if (d<0.05) return [tx,tz];
    p.wpT-=dt; if (!p.wp||p.wpT<=0||p.wpFor!==tx+tz*1e4){ p.wp=d>1.5?(p.place.G.waypoint(p.x,p.z,tx,tz)||[tx,tz]):[tx,tz]; p.wpT=0.3+rnd()*0.1; p.wpFor=tx+tz*1e4; }
    return p.wp;
  }
  function personThink(p,dt){
    const g=p.group, G=p.place.G; let vdx=0, vdz=0, still=false, maxV=p.pref*1.35;
    if (p.mode==='slot'){
      const [sx,sz]=slotPos(g,p); let tx=sx, tz=sz; if (G.clearAt(tx,tz)<p.rad+0.1){ tx=lerp(sx,g.ax,0.7); tz=lerp(sz,g.az,0.7); }
      const dx=tx-p.x, dz=tz-p.z, d=Math.hypot(dx,dz);
      if (d>2.5){ const w=steerTo(p,tx,tz,dt), wl=Math.hypot(w[0]-p.x,w[1]-p.z)||1, v=p.child?p.runSpeed:p.pref*1.3; vdx=(w[0]-p.x)/wl*v; vdz=(w[1]-p.z)/wl*v; maxV=v; }
      else { vdx=g.avx+dx*1.4; vdz=g.avz+dz*1.4; if (p.child&&p.kidMode==='ahead') maxV=p.runSpeed*0.8; }
      if (Math.hypot(g.avx,g.avz)<0.05&&d<0.3){ vdx=vdz=0; still=true; }
    } else if (p.mode==='goto'||p.mode==='stand'||p.mode==='toSeat'||p.mode==='play'){
      if (p.mode==='play') playThink(p,dt);
      const d=Math.hypot(p.tx-p.x,p.tz-p.z), arr=p.mode==='toSeat'?0.12:p.mode==='play'?0.4:0.25;
      let v=p.mode==='play'?p.speedWant:p.pref*(p.mode==='stand'?0.75:1); if (p.mode==='play') maxV=Math.max(p.runSpeed,maxV);
      if (d<arr||v===0){ still=true; if (p.mode==='toSeat'){ p.mode='sit'; p.sitFrom=[p.x,p.z]; } }
      else { const w=steerTo(p,p.tx,p.tz,dt), wl=Math.hypot(w[0]-p.x,w[1]-p.z)||1; v*=clamp(d/0.9,0.3,1); vdx=(w[0]-p.x)/wl*v; vdz=(w[1]-p.z)/wl*v; }
    }
    if (p.mode==='sit'||p.mode==='unsit'){ sitThink(p,dt); return; }
    const f=[(vdx-p.vx)/0.42,(vdz-p.vz)/0.42];
    if (!still||p.mode==='slot'){ for (const q of near(p.x,p.z,3.5,NEAR)) if (q!==p&&q.place===p.place) ttc(p,q,q.group===g?0.35:1.4,f); if (Math.hypot(PL.x-p.x,PL.z-p.z)<4) ttc(p,PL,1.6,f); }
    const c0=G.clearAt(p.x,p.z); if (c0<p.rad+0.3){ const gx=G.clearAt(p.x+0.2,p.z)-G.clearAt(p.x-0.2,p.z), gz=G.clearAt(p.x,p.z+0.2)-G.clearAt(p.x,p.z-0.2), gl=Math.hypot(gx,gz)||1, k=(p.rad+0.3-c0)*7; f[0]+=gx/gl*k; f[1]+=gz/gl*k; }
    p.vx+=f[0]*dt; p.vz+=f[1]*dt; if (!Number.isFinite(p.vx)||!Number.isFinite(p.vz)) p.vx=p.vz=0;   // a fault is never passed on to others
    if (still){ p.vx*=Math.exp(-7*dt); p.vz*=Math.exp(-7*dt); }
    const sp=Math.hypot(p.vx,p.vz); if (sp>maxV){ p.vx*=maxV/sp; p.vz*=maxV/sp; }
    let nx=p.x+p.vx*dt, nz=p.z+p.vz*dt;
    const c1=G.clearAt(nx,nz), lim=Math.min(p.rad*0.6,c0+0.01);
    if (c1<p.rad*0.6&&c1<c0){ if (G.clearAt(nx,p.z)>=lim) nz=p.z; else if (G.clearAt(p.x,nz)>=lim) nx=p.x; else { nx=p.x; nz=p.z; } p.vx=(nx-p.x)/dt; p.vz=(nz-p.z)/dt; }
    p.x=nx; p.z=nz;
    { const gy=G.ground(p.x,p.z,p.y), s2=Math.hypot(p.vx,p.vz)||1; p.y+=(gy-p.y)*ease(10,dt);
      p.climb=lerp(p.climb||0,clamp((G.ground(p.x+p.vx/s2*0.5,p.z+p.vz/s2*0.5,gy)-gy)/0.5,-0.5,0.5),ease(3,dt)); }
    const s2=Math.hypot(p.vx,p.vz); let want=null;
    if (s2>0.3) want=Math.atan2(p.vx,p.vz); else if (p.face!=null) want=p.face; else if (p.circle) want=Math.atan2(p.circle.x-p.x,p.circle.z-p.z);
    else if (Math.abs(p.hY)>1.15&&p.gazeHold>1.2) want=p.yaw+p.hY*0.8;
    const prev=p.yaw; if (want!=null){ const rate=s2>0.3?5.5:2.6, dy=wrapA(want-p.yaw); p.yaw+=clamp(dy,-rate*dt,rate*dt); if (s2<=0.3) p.hY-=wrapA(p.yaw-prev); }
    p.yawRate=wrapA(p.yaw-prev)/Math.max(dt,1e-4);
    locomotion(p,s2,dt);
  }
  function locomotion(p,s2,dt){
    p.speedSm+=(s2-p.speedSm)*ease(6,dt); p.walkW+=(clamp(p.speedSm/0.25,0,1)-p.walkW)*ease(8,dt);
    const turning=p.speedSm<0.3&&Math.abs(p.yawRate)>0.6; p.turnStep+=((turning?1:0)-p.turnStep)*ease(6,dt);
    const stepLen=stepLenOf(p);
    if (!p.lockFeet) p.phase+=(s2*dt/stepLen+p.turnStep*Math.abs(p.yawRate)*dt*0.5)*Math.PI;
    else if (s2>0.15) p.phase+=s2*dt/stepLen*Math.PI; else if (p.needStep||p.inSwing) p.phase+=dt/0.42*Math.PI;
    p.armW+=((p.armMode===p.armWant&&p.armWant!=='free'?1:0)-p.armW)*ease(3,dt); if (p.armMode!==p.armWant&&p.armW<0.05) p.armMode=p.armWant;
  }
  function sitThink(p,dt){
    const s=p.seat;
    if (p.mode==='sit'){ if (!s){ p.mode='slot'; return; }
      if (p.sitW>0.5){ p.pinL=p.pinR=null; p.hipW=null; }
      p.yaw+=wrapA(s.yaw-p.yaw)*ease(7,dt); if (Math.abs(wrapA(s.yaw-p.yaw))<0.5) p.sitW=Math.min(1,p.sitW+dt);
      const k=smooth(p.sitW); p.x=lerp(p.sitFrom[0],s.x-Math.sin(s.yaw)*0.05,k); p.z=lerp(p.sitFrom[1],s.z-Math.cos(s.yaw)*0.05,k); p.y=lerp(p.y,s.y0,ease(8,dt));
    } else { const u=p.unseat; p.sitW=Math.max(0,p.sitW-dt/0.9); const k=smooth(p.sitW);
      if (u){ p.x=lerp(u.ax,u.x-Math.sin(u.yaw)*0.05,k); p.z=lerp(u.az,u.z-Math.cos(u.yaw)*0.05,k); }
      if (p.sitW<=0){ p.mode='slot'; if (u){ u.taken=null; if (u.ref&&u.ref.ppl===p) u.ref.ppl=null; } p.unseat=null; } }
    p.vx=p.vz=0; p.yawRate=0; locomotion(p,0,dt);
  }

  /* ---------- where people look ---------- */
  function chooseGaze(p){
    const C=p.circle&&p.mode==='stand'&&p.group&&p.group.state==='talk'?p.circle:null, R2=rnd(), moving=p.speedSm>0.4;
    const camD=Math.hypot(cam.position.x-p.x,cam.position.z-p.z), camAng=Math.abs(wrapA(Math.atan2(cam.position.x-p.x,cam.position.z-p.z)-p.yaw));
    p.gazeT=0.8+rnd()*2.8; p.gaze=null;
    if (camD<9&&camAng<1.6&&rnd()<(camD<3?0.5:0.18)){ p.gaze={cam:true}; p.gazeT=0.8+rnd()*1.6; return; }
    if (C){ if (C.speaker!==p&&R2<0.72) p.gaze={p:C.speaker}; else if (R2<0.9) p.gaze={p:pick(rnd,C.members.filter(m=>m!==p))||C.speaker}; else p.gaze={dir:p.yaw+(rnd()-0.5)*2.4,y:1.4}; p.gazeT=1.5+rnd()*3.5; return; }
    const cands=[]; if (!p.veh) for (const q of near(p.x,p.z,12,NEAR)){ if (q===p) continue; const dx=q.x-p.x, dz=q.z-p.z, d=Math.hypot(dx,dz); if (d>12) continue;
      const ang=Math.abs(wrapA(Math.atan2(dx,dz)-p.yaw)); if (ang>(moving?1.2:1.9)) continue; let w=1/(1+d*0.3); if (q.group===p.group) w*=moving?2.2:0.6; if (q.speedSm>1.8) w*=2.5; if (q.child) w*=1.4; cands.push([q,w]); }
    if (moving&&R2<0.45){ p.gaze={dir:p.yaw+(rnd()-0.5)*0.5,y:0.6+rnd()*0.6,ahead:true}; return; }
    if (cands.length&&R2<0.8){ p.gaze={p:pickW(rnd,cands.map(c=>c[0]),cands.map(c=>c[1]))}; return; }
    p.gaze={dir:p.yaw+(rnd()-0.5)*(p.sitW>0.5?2.0:2.8),y:1.2+rnd()*2.5};
  }
  function gazeThink(p,dt){
    p.gazeT-=dt; if (p.gazeT<=0||(p.gaze&&p.gaze.p&&!p.gaze.p.alive)) chooseGaze(p);
    let tx,ty,tz; const Gz=p.gaze, eye=p.y+p.look.H*0.93*(1-0.36*smooth(p.sitW));
    if (!Gz){ tx=p.x+Math.sin(p.yaw)*5; tz=p.z+Math.cos(p.yaw)*5; ty=eye; }
    else if (Gz.cam){ tx=cam.position.x; ty=cam.position.y; tz=cam.position.z; }
    else if (Gz.p){ tx=Gz.p.x; tz=Gz.p.z; ty=Gz.p.y+Gz.p.look.H*0.9*(1-0.36*smooth(Gz.p.sitW)); }
    else { tx=p.x+Math.sin(Gz.dir)*6; tz=p.z+Math.cos(Gz.dir)*6; ty=Gz.ahead?eye-(1.6-Gz.y):p.y+Gz.y; }
    const dx=tx-p.x, dz=tz-p.z, hd=Math.hypot(dx,dz); let yw=wrapA(Math.atan2(dx,dz)-p.yaw); const lim=p.sitW>0.5?1.25:1.35;
    p.gazeHold=Math.abs(yw)>1.15?(p.gazeHold||0)+dt:0; yw=clamp(yw,-lim,lim); if (p.speedSm>0.6) yw=clamp(yw,-1.1,1.1);
    const pitch=clamp(Math.atan2(eye-ty,Math.max(0.3,hd)),-0.45,0.55);
    if (Number.isFinite(yw)) p.hY+=(yw-p.hY)*ease(7,dt); if (Number.isFinite(pitch)) p.hP+=(pitch-p.hP)*ease(6,dt);
    if (p.circle&&p.group&&p.group.state==='talk'&&p.mode==='stand'){
      const sp=p.circle.speaker===p; if (sp&&p.armWant!=='gesture'&&rnd()<dt*0.8){ p.armWant='gesture'; p.gest2=rnd()<0.3; }
      else if (!sp&&p.armWant==='gesture') p.armWant='free'; else if (!sp&&rnd()<dt*0.04) p.armWant=p.armWant==='free'?(rnd()<0.6||!p.look.man?'folded':'hips'):'free';
    } else if (p.armWant==='gesture'||p.armWant==='folded'||p.armWant==='hips') p.armWant=p.mode==='slot'?(p.holdKid||p.holdBy?'hold':p.walkArms):'free';
  }

  /* ---------- trains and ferries ----------
     A passenger is posed in the vehicle's own frame (a coach's or the ferry's), so that the vehicle carries them. To
     go aboard or ashore a passenger walks a short path in that frame between the seat, the aisle, a door or the
     gangway, and the platform or the quay, where they become one of the place's people; going aboard is the reverse. */
  const _lv=new THREE.Vector3(), _m3=new THREE.Matrix3(), _fw=new THREE.Vector3();
  function frameOf(m){ m.updateMatrix(); return m.matrix; }
  const toWorld=(m,lx,ly,lz)=>_lv.set(lx,ly,lz).applyMatrix4(frameOf(m));
  function yawOf(m){ _fw.set(0,0,1).applyMatrix3(_m3.setFromMatrix4(frameOf(m))); return Math.atan2(_fw.x,_fw.z); }
  const seatsOf=v=>v.kind==='coach'?ctx.train.seats:ctx.ferry.seats;
  const vehMesh=v=>v.kind==='coach'?ctx.train.cars()[v.car].m:v.F.m;
  const sameVeh=(a,b)=>a.kind===b.kind&&(a.kind==='coach'?a.car===b.car:a.F===b.F);
  const seatFree=(v,s)=>!pax.some(q=>sameVeh(q.veh,v)&&q.veh.seat===s);
  function makePax(v){
    const q=rnd(), p=makePerson(q<0.5?'man':'woman',q<0.15?66+Math.floor(rand(0,18)):18+Math.floor(rand(0,46)),null);
    p.veh=v; p.lockFeet=false; p.mode='vsit'; p.sitW=1; p.seat={h:v.seat.h}; return p;
  }
  // the way from a seat to a door or the gangway and out, in the vehicle's frame; reversed to go aboard
  function pathOut(v,door){
    const s=v.seat, y=s.y-s.h;
    if (v.kind==='coach'){ const {CDX,CDZ}=ctx.train, e=door.e, sx=door.sx;
      return [[s.x,y,s.z+s.fz*0.5],[0,y,s.z+s.fz*0.5],[0,y,e*CDZ],[sx*(CDX-0.35),y,e*CDZ],[sx*1.75,y-0.35,e*CDZ],[sx*2.45,0.9,e*CDZ]]; }
    const {FB,FPL,FGZ,FSZ0}=ctx.ferry, sd=v.F.side;
    return [[s.x,y,s.z+0.55],[sd*1.45,y,s.z+0.55],[sd*1.45,y,FSZ0+0.6],[sd*1.45,y,FSZ0-0.6],[sd*(FB/2-0.4),y,FGZ],[sd*(FB/2+FPL+0.3),y+0.04,FGZ]];
  }
  function paxStep(p,dt){
    const v=p.veh, m=vehMesh(v), s=v.seat;
    if (v.state==='rise'){ p.sitW=Math.max(0,p.sitW-dt/0.9); if (p.sitW<=0){ v.state='walk'; v.i=0; v.u=0; } }
    else if (v.state==='sitdown'){ p.sitW=Math.min(1,p.sitW+dt); if (p.sitW>=1) v.state='sit'; }
    let L=null;
    if (v.state==='walk'){ const P=v.path; const a=P[v.i], b=P[v.i+1], len=Math.hypot(b[0]-a[0],b[2]-a[2])||0.01; if (!v.hold) v.u+=dt*1.05/len;
      if (v.u>=1){ v.u=0; v.i++; if (v.i>=P.length-1){ v.state=v.dir>0?'out':'sitdown'; } }
      if (v.state==='walk'){ const a2=P[v.i], b2=P[v.i+1]; L=[lerp(a2[0],b2[0],v.u),lerp(a2[1],b2[1],v.u),lerp(a2[2],b2[2],v.u)]; v.head=Math.atan2(b2[0]-a2[0],b2[2]-a2[2]); if (!v.hold) p.phase+=dt*1.05/stepLenOf(p)*Math.PI; }
      p.speedSm=v.hold?0:1.05; p.walkW=v.hold?0:1; }
    else { p.speedSm=0; p.walkW=0; }
    if (!L) L=v.state==='out'?v.path[v.path.length-1]:[s.x-s.fx*0.05,s.y-s.h,s.z-s.fz*0.05];
    const w=toWorld(m,L[0],L[1],L[2]); p.x=w.x; p.y=w.y; p.z=w.z;
    p.yaw=yawOf(m)+(v.state==='walk'||v.state==='out'?(v.head||0):Math.atan2(s.fx,s.fz)); p.vx=p.vz=0;
    gazeThink(p,dt);
  }
  /* How long the doors (or the gangway) will stay open: the coach doors close as the train's wait falls to 2.5 s, and the
     gangway is taken in as the ferry's falls to 1.2 s. A passenger steps through only with 1.8 s or more to spare. */
  function openFor(v){ if (v.kind==='coach') return ctx.train.doorOpen()>0.6?ctx.train.wait()-2.5:0; return v.F.wait-1.2; }
  function localNow(v){ const P=v.path; if (v.state!=='walk') return [v.seat.x,v.seat.y-v.seat.h,v.seat.z]; const a=P[v.i], b=P[v.i+1]; return [lerp(a[0],b[0],v.u),lerp(a[1],b[1],v.u),lerp(a[2],b[2],v.u)]; }
  // still inside when the doors close: back to the seat
  function turnBack(p){ const v=p.veh, P=v.path, here=localNow(v);
    if (v.state==='rise'){ v.state='sitdown'; v.dir=-1; v.place=null; return; }
    v.path=[here,...P.slice(0,v.i+1).reverse()]; v.dir=-1; v.i=0; v.u=0; v.place=null; }
  // the doors on the platform side of each coach, or the end of the ferry's gangway, in the world
  function doorsAt(pl){
    const out=[];
    if (pl.kind==='station') ctx.train.cars().forEach((c,i)=>{ if (c.loco) return; for (const e of [-1,1]) for (const sx of [-1,1]){ const w=toWorld(c.m,sx*2.45,0.9,e*ctx.train.CDZ), cell=pl.G.cellOf(w.x,w.z);
      if (cell>=0&&pl.G.open[cell]) out.push({kind:'coach',car:i,e,sx,x:w.x,z:w.z}); } });
    else { const F=pl.F, w=toWorld(F.m,F.side*(ctx.ferry.FB/2+ctx.ferry.FPL+0.3),ctx.ferry.FD0,ctx.ferry.FGZ), cell=pl.G.cellOf(w.x,w.z); if (cell>=0&&pl.G.open[cell]) out.push({kind:'ferry',F,x:w.x,z:w.z}); }
    return out;
  }
  // the door nearest a seat on the side of the platform, found in the coach's own frame before the train comes to rest
  function doorFor(v,pl){
    if (v.kind==='ferry') return {kind:'ferry',F:v.F};
    const m=ctx.train.cars()[v.car].m, a=toWorld(m,0,0,0).clone(), b=toWorld(m,1,0,0);
    return {kind:'coach',car:v.car,e:v.seat.z>=0?1:-1,sx:Math.sign((b.z-a.z)*pl.S.side)||1};
  }
  /* As the train slows for a station, or the ferry for a landing, about half the passengers stand, walk to the door or the
     gangway and wait there; they step out once it is open with time to spare. Anyone who reaches it after it has begun
     to close, or whose train does not stop after all, goes back to the seat. Each passenger is considered once a stop. */
  function chooseAlighters(pl){
    for (const p of pax){ const v=p.veh; if (v.state!=='sit'||v.prep) continue;
      if (v.kind==='ferry'?v.F!==pl.F:pl.kind!=='station') continue;
      v.prep=true; if (rnd()>0.5) continue;
      v.path=pathOut(v,doorFor(v,pl)); v.dir=1; v.state='rise'; v.place=pl; v.delay=rnd()*2.5; v.sawOpen=false; v.holdT=0; v.hold=false; }
  }
  // a stop: about half the passengers in the coaches or the saloon get off, and the people waiting get on
  function atStop(pl){
    const doors=doorsAt(pl); if (!doors.length) return;
    chooseAlighters(pl);
    for (const g of groups){ if (g.place!==pl||g.alighted||g.board||g.state==='leaving') continue;
      const m0=g.members[0], d=doors.slice().sort((a,b)=>Math.hypot(a.x-m0.x,a.z-m0.z)-Math.hypot(b.x-m0.x,b.z-m0.z))[0]; if (!d||Math.hypot(d.x-m0.x,d.z-m0.z)>30) continue;
      for (const m of g.members){ if (m.seat){ if (m.sitW>0||m.mode==='sit') m.unseat=m.seat; else freeSeat(m); m.seat=null; } m.mode=m.unseat?'unsit':'goto'; m.tx=d.x; m.tz=d.z; m.circle=null; m.face=null; leaveGame(m); }
      releaseHands(g); g.board=d; g.state='board'; }
  }
  function vehicleTick(dt){
    const T=ctx.train, wait=T.wait(), cars=T.cars();
    const TR=T.obj();
    let nearStop=false;
    if (TR.wait===0) for (const pl of places.values()) if (pl.kind==='station'&&pl.setup){ const d=(pl.S.x+TR.dir*28-TR.x)*TR.dir; if (d>0&&d<45){ nearStop=true; chooseAlighters(pl); } }
    // clear of any stop again: the passengers may be chosen afresh at the next one
    if (TR.wait===0&&!nearStop) for (const p of pax) if (p.veh.kind==='coach') p.veh.prep=false;
    if (wait>wasWait+5) for (const pl of places.values()) if (pl.kind==='station'&&pl.setup) atStop(pl);
    wasWait=wait;
    for (const F of ctx.ferry.list()){ if (!F.R) continue; const w=F.wait, was=ferryWas.get(F)||0;
      if (w>was+5) for (const pl of places.values()) if (pl.kind==='quay'&&pl.F===F&&pl.stop===F.at&&pl.setup) atStop(pl);
      if (w===0){ const len=F.R.loop.len, d=((F.R.stops[F.next]-F.s)%len+len)%len;
        if (d<25){ for (const pl of places.values()) if (pl.kind==='quay'&&pl.F===F&&pl.stop===F.next&&pl.setup) chooseAlighters(pl); }
        else for (const p of pax) if (p.veh.F===F) p.veh.prep=false; }
      ferryWas.set(F,w); }
    // walking to the doors or the gangway: aboard on reaching them while they are open; if the train or the ferry
    // leaves first, the group stays behind
    for (const g of groups.slice()){ if (!g.board) continue; const d=g.board, open=d.kind==='coach'?wait>2.6:d.F.wait>1.5, doorsOpen=openFor(d.kind==='coach'?{kind:'coach'}:{kind:'ferry',F:d.F})>1.2;
      for (const m of g.members) if (m.mode==='unsit'&&m.sitW<=0){ m.mode='goto'; m.tx=d.x; m.tz=d.z; }
      if (!open){ g.board=null; g.alighted=true; for (const m of g.members) if (m.mode==='goto'){ m.mode='stand'; m.tx=m.x; m.tz=m.z; } chooseDest(g); startWalk(g); continue; }
      for (const m of g.members.slice()){ if (!doorsOpen||m.mode!=='goto'||Math.hypot(m.x-d.x,m.z-d.z)>0.7) continue;
        const v={kind:d.kind,car:d.car,F:d.F};
        if ((v.kind==='coach'&&T.playerCar()===v.car)||(v.kind==='ferry'&&ctx.ferry.ridden()===v.F)) continue;
        const seats=seatsOf(v).filter(s=>seatFree(v,s)); if (!seats.length) continue;
        seats.sort((a,b)=>Math.abs(a.z-(d.e||0)*(T.CDZ||0))-Math.abs(b.z-(d.e||0)*(T.CDZ||0)));
        v.seat=seats[Math.floor(rnd()*Math.min(3,seats.length))]; v.path=pathOut(v,d).reverse(); v.dir=-1; v.state='walk'; v.i=0; v.u=0;
        leaveGame(m); m.veh=v; m.place=null; m.lockFeet=false; m.mode='vsit'; m.seat={h:v.seat.h}; m.sitW=0; m.armWant='free'; m.armMode='free'; m.armW=0; m.holdBy=m.holdKid=null; m.group=null;
        people.splice(people.indexOf(m),1); pax.push(m); g.members.splice(g.members.indexOf(m),1); }
      if (!g.members.length) groups.splice(groups.indexOf(g),1); }
    // passengers: off at the end of the way out, where they join the place and make for its way out
    for (const p of pax.slice()){ const v=p.veh;
      if (v.dir>0&&v.state==='walk'){ const o=openFor(v); if (o>=1.8) v.sawOpen=true;
        // at the door: the step through it takes under a second and is begun only with 1.8 s of opening left
        if (v.i===v.path.length-2&&v.u<0.02){ if (o>=1.8) v.hold=false; else { v.hold=true; v.holdT+=dt; if (v.sawOpen||v.holdT>30){ v.hold=false; turnBack(p); } } } }
      if (v.delay>0){ v.delay-=dt; paxStep(p,0); } else paxStep(p,dt);
      if (v.state==='out'){ pax.splice(pax.indexOf(p),1); const pl=v.place; if (!pl||!pl.setup) continue;
        { const G=pl.G; if (G.clearAt(p.x,p.z)<0.3){ let best=null, bd=1e9; const c0=G.cellOf(p.x,p.z);
            for (let dj=-8;dj<=8;dj++) for (let di=-8;di<=8;di++){ const c=c0<0?-1:c0+dj*G.nx+di; if (c<0||c>=G.N||G.clr[c]<0.3) continue; const d=di*di+dj*dj; if (d<bd){ bd=d; best=c; } }
            if (best==null) continue; p.x=G.cX(best); p.z=G.cZ(best); } }
        p.veh=null; p.place=pl; p.lockFeet=true; p.mode='slot'; p.sitW=0; p.seat=null; p.pinL=p.pinR=null; p.hipW=null; p.y=pl.G.ground(p.x,p.z,p.y);
        const g=makeGroup([p],'single',pl); g.alighted=true; g.ax=p.x; g.az=p.z; g.ayaw=p.yaw; people.push(p); groups.push(g);
        const ex=pl.exits.slice().sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z)), e=ex[Math.floor(rnd()*Math.min(6,ex.length))];
        g.dest=e?{kind:'leave',x:e.x,z:e.z}:{kind:'spot',x:p.x,z:p.z}; continue; }
      if (Math.hypot(p.x-cam.position.x,p.z-cam.position.z)>600&&hiddenAt(p.x,p.y,p.z)) pax.splice(pax.indexOf(p),1); }
    // a few passengers take their seats while the train or the ferry is out of sight
    if (wait<=0&&cars.length&&pax.filter(p=>p.veh.kind==='coach').length<6){ const ci=1+Math.floor(rnd()*(cars.length-2)), c=cars[ci], w=toWorld(c.m,0,1.5,0);
      if (c&&!c.loco&&hiddenAt(w.x,w.y,w.z)&&T.playerCar()!==ci&&Math.hypot(w.x-cam.position.x,w.z-cam.position.z)<500){ const s=pick(rnd,ctx.train.seats), v={kind:'coach',car:ci,seat:s,state:'sit'}; if (seatFree(v,s)){ const p=makePax(v); pax.push(p); paxStep(p,0); } } }
    for (const F of ctx.ferry.list()){ if (!F.R||F.wait>0||!F.m.visible||ctx.ferry.ridden()===F) continue; if (pax.filter(p=>p.veh.F===F).length>=5) continue;
      const w=toWorld(F.m,0,2,0); if (!hiddenAt(w.x,w.y,w.z)||Math.hypot(w.x-cam.position.x,w.z-cam.position.z)>500) continue;
      const s=pick(rnd,ctx.ferry.seats), v={kind:'ferry',F,seat:s,state:'sit'}; if (seatFree(v,s)){ const p=makePax(v); pax.push(p); paxStep(p,0); } }
  }

  /* ---------- population ---------- */
  function spawnTick(dt){
    let total=people.length;
    for (const pl of places.values()){
      if (!pl.G.ready){ pl.G.build(1500); continue; } if (!pl.setup) setupPlace(pl);
      pl.spawnT-=dt; if (pl.spawnT>0) continue; pl.spawnT=1.2+rnd()*1.5;
      const here=people.filter(p=>p.place===pl).length, t=target(pl);
      if (here<t&&total<CAP){
        // where no one sees: a way into the place, or a spot within it, out of view
        const cands=[...pl.exits.slice().sort(()=>rnd()-0.5).slice(0,12),...pl.spots.slice().sort(()=>rnd()-0.5).slice(0,8)];
        const at=cands.find(c=>hiddenAt(c.x,pl.G.ground(c.x,c.z,0),c.z)); if (!at) continue;
        const g=compose(pl); if (here+g.members.length>t+1) continue;
        placeGroup(g,at.x,at.z,rnd()*TAU); chooseDest(g); if (g.dest.kind==='leave') chooseDest(g); startWalk(g); total+=g.members.length; }
      else if (here>t){ const g=groups.find(g=>g.place===pl&&g.state==='walk'&&!g.board&&g.dest&&g.dest.kind!=='leave'); if (g&&pl.exits.length){ const e=pick(rnd,pl.exits); g.dest={kind:'leave',x:e.x,z:e.z}; g.wp=null; } }
    }
  }
  function clearAll(){ for (const p of people) dropPerson(p); people.length=0; groups.length=0; games.length=0; pax.length=0; }

  /* ---------- each frame ---------- */
  function update(dt){
    if (!on){ body.mesh.visible=false; return; }
    viewUpdate();
    const P=ctx.player(); PL.x=P.x; PL.z=P.z; PL.vx=P.vx||0; PL.vz=P.vz||0;
    if (dt>0){
      simT+=dt; scanT-=dt; if (scanT<=0){ scanT=1; scan(); }
      for (const pl of places.values()) pl.G.budget=1;
      spawnTick(dt);
      rebuildHash();
      for (const g of groups.slice()) groupThink(g,dt);
      for (const p of people) personThink(p,dt);
      separate(); rebuildHash();
      for (const p of people) gazeThink(p,dt);
      vehicleTick(dt);
    }
    let r=0;
    for (const list of [people,pax]) for (const p of list){ if (r>=MAXP) break; buildPose(p,simT,POSE); body.write(r++,p.look,POSE); }
    body.setCount(r); body.mesh.position.copy(O); body.mesh.visible=r>0&&!ctx.hidden();
  }
  function setOn(v){ on=!!v; if (!on){ clearAll(); places.clear(); body.mesh.visible=false; } }
  // when the world repeats from north to south, or a new island is made, everyone is let go; the places fill again
  // out of view
  function reset(){ clearAll(); places.clear(); }
  return { update, setOn, reset, get on(){ return on; }, people, pax, places, groups, inView,
    stats(){ return {people:people.length, passengers:pax.length, places:places.size}; } };
}
