// The game's geometry builder (GB) and its trees and plants (addTree, addFlora), copied unchanged from testbench/trees.html,
// which copies them from index.html, so that the streams testbench grows the same plants as the game. The ground height
// is supplied by the page with setGround.
import * as THREE from 'three';
let heightAt=()=>0;
export function setGround(f){ heightAt=f; }
/* ---------- from index.html: random numbers ---------- */
let SEED = 7;
function hash(a,b,c){
  let h = Math.imul(a|0,0x27d4eb2d) ^ Math.imul(b|0,0x165667b1) ^ Math.imul(((c|0)+SEED*977)|0,0x9e3779b1);
  h = Math.imul(h ^ (h>>>15), 0x85ebca6b); h = Math.imul(h ^ (h>>>13), 0xc2b2ae35); h ^= h>>>16;
  return (h>>>0)/4294967296;
}
function rng(seed){ let s = seed>>>0 || 1; return ()=>{ s=(s+0x6D2B79F5)|0; let t=Math.imul(s^s>>>15,1|s); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const pick=(R,arr)=>arr[Math.floor(R()*arr.length)];
const lerp=(a,b,t)=>a+(b-a)*t;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>{ t=clamp(t,0,1); return t*t*(3-2*t); };
const hex=h=>new THREE.Color(h);
const PAL={ leaf:['#4e6a2c','#5b7834','#465f27','#62803a'], olive:'#7f8b55', cypress:'#36502a', trunk:'#6a4a30',
  sand:'#dcb886', sand2:'#e6c99a', grass2:'#8f9a53', stone:'#dcc6ab', terrace:'#efd8c1', piazza:'#efdcb6', walls:['#f3e4d0','#efd6bf','#eacbb0'], roofs:['#d65a52','#de6b5b'], rock:'#b8a48e', scrub:'#9a9a5c' };
const C_={}; for (const k in PAL) C_[k]=Array.isArray(PAL[k])?PAL[k].map(hex):hex(PAL[k]);
const shade=(c,R,a=0.05)=>c.clone().multiplyScalar(1+(R()-0.5)*2*a);
const SV=8;

/* ---------- from index.html: the geometry builder ---------- */
function tpl(geo,smooth){ const g=geo.index?geo.toNonIndexed():geo; return {p:g.attributes.position.array,n:g.attributes.normal.array,smooth}; }
function prismTpl(){
  const P=[-.5,0,-.5, 0,1,-.5, .5,0,-.5,   .5,0,.5, 0,1,.5, -.5,0,.5,
    0,1,-.5, 0,1,.5, .5,0,.5,   0,1,-.5, .5,0,.5, .5,0,-.5,
    0,1,.5, 0,1,-.5, -.5,0,-.5,  0,1,.5, -.5,0,-.5, -.5,0,.5];
  return {p:new Float32Array(P),n:new Float32Array(P.length),smooth:false};
}
const T={
  box:tpl(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),false),
  boxC:tpl(new THREE.BoxGeometry(1,1,1),false),
  cyl:tpl(new THREE.CylinderGeometry(.5,.5,1,28).translate(0,.5,0),true),
  cylC:tpl(new THREE.CylinderGeometry(.5,.5,1,12),true),
  cyl8:tpl(new THREE.CylinderGeometry(.5,.5,1,8).translate(0,.5,0),false),
  bowl:tpl(new THREE.CylinderGeometry(.5,.28,1,16).translate(0,.5,0),true),
  pyr:tpl(new THREE.ConeGeometry(Math.SQRT1_2,1,4,1).rotateY(Math.PI/4).translate(0,.5,0),false),
  cone:tpl(new THREE.ConeGeometry(.5,1,14).translate(0,.5,0),true),
  taper:tpl(new THREE.CylinderGeometry(.36,.5,1,28,1,true).translate(0,.5,0),true),   // a lighthouse tower, narrowing to 72 per cent
  sph:tpl(new THREE.IcosahedronGeometry(.5,2),true),
  sphLo:tpl(new THREE.IcosahedronGeometry(.5,1),true),
  quad:tpl(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),false),
  prism:prismTpl(),
  ico:tpl(new THREE.IcosahedronGeometry(0.5,0),true),
  body:tpl(new THREE.CylinderGeometry(.12,.24,1.25,8).translate(0,.625,0),true),
};
const _nm=new THREE.Matrix3();
class GB{
  constructor(lod=0){ this.p=[]; this.n=[]; this.c=[]; this.s=[]; this.oy=0; this.lod=lod; this.glow=null; }
  add(t,m,color,aoBase=0,surf=0){
    if (this.lod>0){ // drop pieces too small to read at this distance; simplify round shapes
      const e=m.elements, sx=Math.hypot(e[0],e[1],e[2]), sy=Math.hypot(e[4],e[5],e[6]), sz=Math.hypot(e[8],e[9],e[10]);
      const med=sx+sy+sz-Math.max(sx,sy,sz)-Math.min(sx,sy,sz);
      if (this.lod===1 && med<0.55 && surf!==5) return;
      if (this.lod>=2 && med<1.4){
        if (surf===5 && this.glow && hash(Math.round(e[12]*3),Math.round(e[14]*3),77)<0.5) this.glow.push(e[12],e[13]+this.oy,e[14],1.4,1,0.62,0.3);
        return; }
      if (t===T.sph) t=this.lod===1?T.sphLo:T.ico;
      else if (this.lod>=2 && (t===T.sphLo||t===T.body)) t=T.ico;
      else if (this.lod>=2 && t===T.cyl) t=T.cyl8;
    }
    const P=t.p, N=t.n, e=m.elements, len=P.length, oy=this.oy;
    if (t.smooth) _nm.getNormalMatrix(m);
    const ne=_nm.elements, pp=this.p, nn=this.n, cc=this.c, ss=this.s;
    for (let i=0;i<len;i+=9){
      const w=[];
      for (let k=0;k<3;k++){ const o=i+k*3, x=P[o], y=P[o+1], z=P[o+2];
        w.push(e[0]*x+e[4]*y+e[8]*z+e[12], e[1]*x+e[5]*y+e[9]*z+e[13]+oy, e[2]*x+e[6]*y+e[10]*z+e[14]); }
      { // skip triangles of zero area, such as those that meet at the tip of a cone
        const ux=w[3]-w[0], uy=w[4]-w[1], uz=w[5]-w[2], vx=w[6]-w[0], vy=w[7]-w[1], vz=w[8]-w[2];
        if (Math.abs(uy*vz-uz*vy)+Math.abs(uz*vx-ux*vz)+Math.abs(ux*vy-uy*vx)<1e-9) continue; }
      pp.push(...w);
      if (t.smooth){
        for (let k=0;k<3;k++){ const o=i+k*3, x=N[o], y=N[o+1], z=N[o+2];
          const a=ne[0]*x+ne[3]*y+ne[6]*z, b=ne[1]*x+ne[4]*y+ne[7]*z, c=ne[2]*x+ne[5]*y+ne[8]*z, l=Math.hypot(a,b,c)||1; nn.push(a/l,b/l,c/l); }
      } else {
        const ux=w[3]-w[0], uy=w[4]-w[1], uz=w[5]-w[2], vx=w[6]-w[0], vy=w[7]-w[1], vz=w[8]-w[2];
        let a=uy*vz-uz*vy, b=uz*vx-ux*vz, c=ux*vy-uy*vx; const l=Math.hypot(a,b,c)||1; a/=l; b/=l; c/=l;
        nn.push(a,b,c,a,b,c,a,b,c);
      }
      for (let k=0;k<3;k++){
        let f=1; if (aoBase!==null){ const hy=w[k*3+1]-(aoBase+oy); f=0.8+0.2*clamp(hy/2.4,0,1); }
        cc.push(color.r*f,color.g*f,color.b*f); ss.push(surf);
      }
    }
  }
  // the positions are stored relative to (ox,0,oz), worked out before they are rounded to single precision
  geometry(ox=0,oz=0){
    const g=new THREE.BufferGeometry(), P=this.p, F=new Float32Array(P.length);
    for (let i=0;i<P.length;i+=3){ F[i]=P[i]-ox; F[i+1]=P[i+1]; F[i+2]=P[i+2]-oz; }
    g.setAttribute('position',new THREE.BufferAttribute(F,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(this.n,3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3));
    g.setAttribute('surf',new THREE.Float32BufferAttribute(this.s,1));
    g.computeBoundingSphere(); return g;
  }
}
const _q=new THREE.Quaternion(), _e=new THREE.Euler(), _v1=new THREE.Vector3(), _v2=new THREE.Vector3();
function mat(x,y,z,sx=1,sy=1,sz=1,ry=0,rx=0,rz=0){ _e.set(rx,ry,rz,'YXZ'); _q.setFromEuler(_e); return new THREE.Matrix4().compose(_v1.set(x,y,z),_q,_v2.set(sx,sy,sz)); }
const mm=(A,B)=>new THREE.Matrix4().multiplyMatrices(A,B);
// a flat list of world positions as single precision, relative to (ox,0,oz)
function relPos(P,ox,oz){ const F=new Float32Array(P.length); for (let i=0;i<P.length;i+=3){ F[i]=P[i]-ox; F[i+1]=P[i+1]; F[i+2]=P[i+2]-oz; } return F; }
function segBox(gb,p,q,w,h,color,surf=0){
  const dx=q[0]-p[0], dy=q[1]-p[1], dz=q[2]-p[2], len=Math.hypot(dx,dy,dz);
  gb.add(T.boxC, mat((p[0]+q[0])/2,(p[1]+q[1])/2,(p[2]+q[2])/2,w,h,len+0.02,Math.atan2(dx,dz),-Math.atan2(dy,Math.hypot(dx,dz))), color, null, surf);
}

/* ---------- from index.html: the original trees ---------- */
function addTree(gb,ch,x,z,R,s=1,base,kind){
  if (kind in FLORA) return addFlora(gb,ch,x,z,s,base,kind);
  if (ch) (ch.treeSpots||(ch.treeSpots=[])).push([x,z,s]);
  if (base===undefined) base=heightAt(x,z)-gb.oy;
  kind=kind||(R()<0.18?'cypress':'round');
  if (kind==='cypress'){
    const c=shade(C_.cypress,R,0.08), lean=(R()-0.5)*0.05;
    gb.add(T.cyl8, mat(x,base-0.3,z,0.25,1.1,0.25), C_.trunk, base);
    gb.add(T.sph, mat(x,base+0.35+2.7*s,z,1.75*s,5.6*s,1.75*s,0,lean), c, null);
    gb.add(T.cone, mat(x,base+3.4*s,z,1.5*s,6.2*s,1.5*s,0,lean), c.clone().multiplyScalar(0.94), null);
  } else if (kind==='olive'){
    // the trunk rises into the crown, and a bough runs from its top to the heart of each mass of leaves
    const ty=base+1.5*s, tw=0.3*Math.max(1,Math.sqrt(s));
    gb.add(T.cyl8, mat(x,base-0.3,z,tw,ty-base+0.3,tw), C_.trunk, base);
    for (let k=0;k<3;k++){ const a=R()*6.28, r=0.5*s, bx=x+Math.cos(a)*r, by=base+1.9*s+R()*0.5, bz=z+Math.sin(a)*r;
      segBox(gb,[x,ty-0.1,z],[bx,by,bz],tw*0.55,tw*0.55,C_.trunk);
      gb.add(T.sph, mat(bx,by,bz,2.0*s,1.4*s,2.0*s), shade(C_.olive,R,0.08), null); }
  } else {
    gb.add(T.cyl8, mat(x,base-0.3,z,0.32*s,2.3*s+0.3,0.32*s), C_.trunk, base);   // up into the crown
    const leaf=pick(R,C_.leaf);
    gb.add(T.sph, mat(x,base+2.6*s,z,3.1*s,2.7*s,3.1*s), shade(leaf,R,0.05), null);
    for (let k=0;k<3;k++){ const a=R()*6.28, r=0.9*s;
      gb.add(T.sph, mat(x+Math.cos(a)*r,base+2.3*s+R()*0.9*s,z+Math.sin(a)*r,1.9*s,1.7*s,1.9*s), shade(leaf,R,0.09), null); }
  }
  ch.circles.push({x,z,r:0.35,top:Infinity});
}

/* ================= trees, shrubs and plants =================
   Besides the cypress, the olive and the round broadleaf of addTree, the island grows the trees and plants of a
   Mediterranean coast, each built by addFlora from a few low shapes merged into the block like everything else:
   stone (umbrella) pines, Aleppo pines, holm oaks, carobs, figs, almonds, prickly pears, agaves and the low maquis of
   lentisk and rosemary.
   A crown is never one shape: it is built from several overlapping clumps with gaps between them. Each clump is a
   low sphere made lumpy by pushing its vertices in and out, given a flat normal on every face so that it catches the
   light in facets, as a mass of leaves does, and shaded across the whole crown from darker beneath to lighter and
   warmer on top, with a little variation from face to face. Fruit and flowers are many small specks. Each plant takes its variation of size, lean and tint from its own random sequence, seeded from
   where it stands, so the block's own sequence is not disturbed and the plant is the same at every level of detail:
   it takes the same random numbers whether or not a part is drawn. At the simplified level the small parts (twigs,
   fruit, single leaves and pads) are left out, and in the outlines a crown keeps one clump in three, a little larger. */
// a tapering open trunk of six sides, an open branch of five sides, a blade (an agave's leaf): a flat diamond,
// widest a third of the way along, with a little thickness, in eight triangles, and a speck of fruit or flower
function bladeTpl(){
  const V=[[0,0,0],[-.5,.32,0],[0,1,0],[.5,.32,0]], F=[0,.4,.5], B=[0,.4,-.5], P=[];
  for (let i=0;i<4;i++){ const a=V[i], b=V[(i+1)%4]; P.push(...a,...b,...F, ...b,...a,...B); }
  // turn every triangle to face outwards from the blade's middle
  for (let i=0;i<P.length;i+=9){ const ux=P[i+3]-P[i], uy=P[i+4]-P[i+1], uz=P[i+5]-P[i+2], vx=P[i+6]-P[i], vy=P[i+7]-P[i+1], vz=P[i+8]-P[i+2];
    const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx, cx=(P[i]+P[i+3]+P[i+6])/3, cy=(P[i+1]+P[i+4]+P[i+7])/3-.4, cz=(P[i+2]+P[i+5]+P[i+8])/3;
    if (nx*cx+ny*cy+nz*cz<0) for (let k=0;k<3;k++){ const t=P[i+3+k]; P[i+3+k]=P[i+6+k]; P[i+6+k]=t; } }
  return {p:new Float32Array(P),n:new Float32Array(P.length),smooth:false};
}
const TV={
  trunk:tpl(new THREE.CylinderGeometry(.36,.5,1,6,1,true).translate(0,.5,0),true),
  limb:tpl(new THREE.CylinderGeometry(.5,.5,1,5,1,true).translate(0,.5,0),true),
  blade:bladeTpl(),
  speck:tpl(new THREE.OctahedronGeometry(.5,0),false),
};
// a matrix that carries a template's y axis from p to q, its x axis across (level, then turned by tw about the
// axis) scaled to w, and its z axis to t
function segM(p,q,w,t,tw=0){
  let dx=q[0]-p[0], dy=q[1]-p[1], dz=q[2]-p[2]; const L=Math.hypot(dx,dy,dz)||1e-6; dx/=L; dy/=L; dz/=L;
  let sx=dz, sz=-dx; const sl=Math.hypot(sx,sz); if (sl<1e-4){ sx=1; sz=0; } else { sx/=sl; sz/=sl; }
  let nx=-dy*sz, ny=sz*dx-sx*dz, nz=sx*dy, sy=0;   // n = side × axis
  if (tw){ const c=Math.cos(tw), s=Math.sin(tw), ax=sx*c+nx*s, ay=sy*c+ny*s, az=sz*c+nz*s; nx=nx*c-sx*s; ny=ny*c-sy*s; nz=nz*c-sz*s; sx=ax; sy=ay; sz=az; }
  return new THREE.Matrix4().set(sx*w,dx*L,nx*t,p[0], sy*w,dy*L,ny*t,p[1], sz*w,dz*L,nz*t,p[2], 0,0,0,1);
}
// the way the ground falls away at (x,z), as a unit vector, and how steeply
function downhill(x,z){ const gx=heightAt(x+2,z)-heightAt(x-2,z), gz=heightAt(x,z+2)-heightAt(x,z-2), l=Math.hypot(gx,gz);
  return l>1e-3?[-gx/l,-gz/l,l/4]:[0,0,0]; }
// whether (x,z) stands at least as high as the ground 9 m away all round: a crest or the top of a knoll
function onCrest(x,z){ const h=heightAt(x,z)+0.4; for (let a=0;a<6.28;a+=0.785) if (heightAt(x+Math.cos(a)*9,z+Math.sin(a)*9)>h) return false; return true; }
// the leaves' colours are of the brightness of the olive and the round broadleaf, never near black
const FLC={
  pine:hex('#6f8e3e'), pineBark:hex('#8e5c44'), aleppo:hex('#879a58'), aleppoBark:hex('#7a6a5c'),
  holm:hex('#5e7440'), holmBark:hex('#5f5850'), carob:hex('#4f7d2f'), carobBark:hex('#6a5646'),
  fig:hex('#6f9a3c'), figBark:hex('#a7a296'), almond:hex('#93a873'), almondBark:hex('#4f3f34'),
  opuntia:hex('#6f9248'), pear:hex('#b0304a'), agave:hex('#8db0a2'), agave2:hex('#9fb58c'), spike:hex('#8e7c55'), bloom:hex('#e0c84a'),
  lentisk:hex('#62803a'), rosemary:hex('#8a9670'), warm:hex('#e9e2a2'),
};
// the vertices gb.add has just put in, from float index i0, are pushed in or out along their direction from the
// clump's middle by a noise of where they stand, so the clump is lumpy; each face then takes a flat normal and a tone
// from dark beneath to light and warm on top of the whole crown (from y0 to y1), varied a little from face to face.
// Positions shared by two faces move alike, since the push depends only on the position.
function foliage(gb,i0,cx,cy,cz,amt,y0,y1,seed,lo=0.76,hi=1.18,tint=null,tk=0){
  const P=gb.p, N=gb.n, Cc=gb.c, oy=gb.oy; cy+=oy; y0+=oy; y1+=oy;
  for (let i=i0;i<P.length;i+=3){ const x=P[i], y=P[i+1], z=P[i+2], k=1+amt*(hash(Math.round(x*23),Math.round(y*23)*31+Math.round(z*23),seed)*2-1);
    P[i]=cx+(x-cx)*k; P[i+1]=cy+(y-cy)*k; P[i+2]=cz+(z-cz)*k; }
  for (let i=i0;i<P.length;i+=9){
    const ux=P[i+3]-P[i], uy=P[i+4]-P[i+1], uz=P[i+5]-P[i+2], vx=P[i+6]-P[i], vy=P[i+7]-P[i+1], vz=P[i+8]-P[i+2];
    let a=uy*vz-uz*vy, b=uz*vx-ux*vz, c=ux*vy-uy*vx; const l=Math.hypot(a,b,c)||1; a/=l; b/=l; c/=l;
    const mx=(P[i]+P[i+3]+P[i+6])/3, my=(P[i+1]+P[i+4]+P[i+7])/3, mz=(P[i+2]+P[i+5]+P[i+8])/3;
    const t=clamp((my-y0)/Math.max(0.1,y1-y0),0,1), up=b*0.5+0.5, hv=hash(Math.round(mx*9),Math.round(my*9)*13+Math.round(mz*9),seed+5);
    const f=lerp(lo,hi,0.5*t+0.5*up)*(0.9+0.2*hv), w=0.2*t*up, ft=tint&&hv>1-tk;
    for (let k=0;k<3;k++){ const j=i+k*3; N[j]=a; N[j+1]=b; N[j+2]=c;
      if (ft){ Cc[j]=tint.r; Cc[j+1]=tint.g; Cc[j+2]=tint.b; continue; }
      Cc[j]=lerp(Cc[j],FLC.warm.r,w)*f; Cc[j+1]=lerp(Cc[j+1],FLC.warm.g,w)*f; Cc[j+2]=lerp(Cc[j+2],FLC.warm.b,w)*f; } }
}
// the kinds addFlora builds; trees take a collision circle at the trunk and are heard in the wind (treeSpots)
const FLORA={stonepine:1,aleppo:1,holm:1,carob:1,fig:1,almond:1,opuntia:0,agave:0,maquis:0};
// The species that may be placed. A kind not yet approved by Mark is not placed as itself: a tree falls back to the
// original rounded tree, and a shrub is left out. Kinds are added here only once approved in testbench/trees.html.
const FLORA_OK=new Set(['stonepine','aleppo','holm','carob','fig','almond','agave','opuntia','maquis']);
const FLORA_SHRUBS=new Set(['agave','opuntia','maquis','oleander']);
function addFlora(gb,ch,x,z,s=1,base,kind,lean){
  if (!FLORA_OK.has(kind)){ if (FLORA_SHRUBS.has(kind)) return;
    return addTree(gb,ch,x,z,rng(Math.floor(hash(Math.round(x*16),Math.round(z*16),977)*4294967296)),s,base,'round'); }
  if (base===undefined) base=heightAt(x,z)-gb.oy;
  const r=rng(Math.floor(hash(Math.round(x*16),Math.round(z*16),kind.length*131+7)*4294967296)), lod=gb.lod, seed=Math.floor(r()*1e6);
  const sh=(c,a=0.06)=>c.clone().multiplyScalar(1+(r()-0.5)*2*a), Y=base;
  if (FLORA[kind] && ch) (ch.treeSpots||(ch.treeSpots=[])).push([x,z,s]);
  // a trunk or branch from p to q, of diameter d at its foot; it runs on a little past q, into the next piece, so
  // that no seam shows where two pieces meet
  const limb=(p,q,d,c,t=TV.trunk)=>{ const L=Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2])||1, e=1+0.3*d/L; gb.add(t,segM(p,[p[0]+(q[0]-p[0])*e,p[1]+(q[1]-p[1])*e,p[2]+(q[2]-p[2])*e],d,d),c,base); };
  const ell=(t,cx,cy,cz,sx,sy,sz,c,ry=0)=>gb.add(t,mat(cx,cy,cz,sx,sy,sz,ry),c,null);
  // one clump of a crown, lumpy and shaded; beyond full detail it is a coarser shape, and in the outlines every other
  // two clumps in three are left out and the rest grow to fill
  let nc=0;
  const clump=(cx,cy,cz,sx,sy,sz,c,y0,y1,o={})=>{ const ry=r()*6.28, k=nc++;
    if (lod>=2 && !o.keep && k%3) return; const g=lod>=2&&!o.keep?1.35:1, i0=gb.p.length;
    gb.add(o.t||(lod>=1?T.ico:T.sphLo),mat(cx,cy,cz,sx*g,sy*g,sz*g,ry),c,null);
    foliage(gb,i0,cx,cy,cz,o.lump??0.15,y0,y1,seed+k,o.lo,o.hi,o.tint,o.tk||0); };
  // a crown of n clumps over an ellipsoid of half-widths (rx,ry,rz) about (cx,cy,cz), the clumps about w wide and h
  // tall, kept off the middle so that there are gaps; returns the clumps' middles, for branches to reach
  const crown=(cx,cy,cz,rx,ry,rz,n,w,h,c,o={})=>{ const out=[], y0=cy-ry-h*0.5, y1=cy+ry+h*0.5, a0=r()*6.28;
    for (let i=0;i<n;i++){ const f=(i+0.5)/n, el=o.flat?(r()-0.5)*0.6:Math.asin(1-2*f*(o.lower??0.85)), az=a0+i*2.39996+(r()-0.5)*0.5, rad=0.62+r()*0.38;
      const px=cx+Math.cos(az)*Math.cos(el)*rx*rad, py=cy+Math.sin(el)*ry*rad, pz=cz+Math.sin(az)*Math.cos(el)*rz*rad, q=0.75+r()*0.5;
      clump(px,py,pz,w*q,h*q*(0.85+r()*0.3),w*q*(0.8+r()*0.4),c.clone().multiplyScalar(0.94+r()*0.12),y0,y1,o); out.push([px,py,pz]); }
    return out; };
  // which way the tree leans: downhill (on a coast or a clifftop, towards the sea), or as it is told
  let [lx,lz,sl]=lean||downhill(x,z); if (!lean && sl<0.08){ const a=r()*6.28; lx=Math.cos(a); lz=Math.sin(a); }
  if (kind==='stonepine'){
    // a short, slightly curving reddish-brown trunk that forks into a few limbs under a broad, flat-topped umbrella;
    // the umbrella is a broken layer of flattened clumps on the limbs' ends, with sky showing between them
    const H=(3.8+r()*1.8)*s, k=0.08+r()*0.16, d=0.55*s, w=(r()-0.5)*0.6;
    const p1=[x+lx*H*k*0.4-lz*w,Y+H*0.55,z+lz*H*k*0.4+lx*w], p2=[x+lx*H*k,Y+H,z+lz*H*k];
    limb([x,Y-0.3,z],p1,d,FLC.pineBark); limb(p1,p2,d*0.74,FLC.pineBark);
    const nl=4+Math.floor(r()*2), a0=r()*6.28, R0=(3.0+r()*1.0)*s, cy=Y+H+(1.4+r()*0.5)*s, c=sh(FLC.pine,0.05), tips=[];
    for (let i=0;i<nl;i++){ const a=a0+i*6.28/nl+(r()-0.5)*0.7, rr=R0*(0.45+r()*0.2), q=[p2[0]+Math.cos(a)*rr,cy-0.5*s+(r()-0.5)*0.4*s,p2[2]+Math.sin(a)*rr];
      limb(p2,q,0.26*s,FLC.pineBark,TV.limb); tips.push([q,a]); }
    const y0=cy-0.9*s, y1=cy+0.9*s;
    for (const [q,a] of tips){ const m=3;
      for (let j=0;j<m;j++){ const b=a+(j-1)*0.8+(r()-0.5)*0.4, rr=(0.3+r()*1.3)*s, cw=(2.5+r()*0.9)*s;
        const px=q[0]+Math.cos(b)*rr, pz=q[2]+Math.sin(b)*rr, py=cy+(r()-0.4)*0.6*s;
        if (lod===0 && rr>0.9*s) limb(q,[px,py-0.3*s,pz],0.12*s,FLC.pineBark,TV.limb);
        clump(px,py,pz,cw,(0.9+r()*0.3)*s,cw*(0.75+r()*0.3),c.clone().multiplyScalar(0.94+r()*0.12),y0,y1,{lump:0.14,lo:0.7,hi:1.22}); } }
    clump(p2[0],cy+0.35*s,p2[2],(3.2+r()*0.6)*s,0.9*s,(3.0+r()*0.6)*s,c,y0,y1,{keep:true,lo:0.7,hi:1.22});
    if (ch) ch.circles.push({x,z,r:0.32*s,top:Infinity});
  } else if (kind==='aleppo'){
    // a slender grey trunk leaning over and bending as it rises, with an uneven crown in its upper part: broad, flat
    // masses of foliage held out on short crooked branches, overlapping, with the sky showing through at the edges
    const H=(6.5+r()*2.8)*s, k=0.2+r()*0.3, d=0.42*s, w=(r()-0.5)*0.9*s, pts=[[x,Y-0.3,z]];
    for (let i=1;i<=3;i++){ const f=i/3, b=k*Math.pow(f,1.3+r()*0.4); pts.push([x+lx*H*b+(-lz*w)*Math.sin(f*3.1),Y+H*f*(1-0.12*k),z+lz*H*b+(lx*w)*Math.sin(f*3.1)]); }
    for (let i=0;i<3;i++) limb(pts[i],pts[i+1],d*(1-i*0.24),FLC.aleppoBark);
    const at=(f)=>{ const t=f*3, i=Math.min(2,Math.floor(t)), u=t-i, A=pts[i], B=pts[i+1]; return [A[0]+(B[0]-A[0])*u,A[1]+(B[1]-A[1])*u,A[2]+(B[2]-A[2])*u]; };
    const c=sh(FLC.aleppo,0.06), y0=Y+H*0.45, y1=Y+H+1.2*s, nb=4+Math.floor(r()*2);
    for (let i=0;i<nb;i++){ const f=0.52+0.46*(i+r())/nb, P=at(f), a=i*2.4+r()*0.9, out=(0.7+r()*0.9)*s*(1.3-f*0.6);
      const q=[P[0]+Math.cos(a)*out+lx*out*0.3,P[1]+(0.3+r()*0.5)*s,P[2]+Math.sin(a)*out+lz*out*0.3];
      limb(P,q,0.15*s,FLC.aleppoBark,TV.limb);
      const m=2; for (let j=0;j<m;j++){ const b=a+(r()-0.5)*1.6, rr=(0.3+r()*0.8)*s, tw=(2.0+r()*0.9)*s;
        clump(q[0]+Math.cos(b)*rr,q[1]+(r()-0.3)*0.5*s,q[2]+Math.sin(b)*rr,tw,tw*(0.42+r()*0.15),tw*(0.8+r()*0.3),c.clone().multiplyScalar(0.92+r()*0.16),y0,y1,{lump:0.16}); } }
    const tp=pts[3]; clump(tp[0],tp[1]+0.3*s,tp[2],2.0*s,1.1*s,1.8*s,c,y0,y1,{keep:true,lump:0.18});
    if (ch) ch.circles.push({x,z,r:0.25*s,top:Infinity});
  } else if (kind==='holm'){
    // a short stout trunk dividing into three or four limbs under a dense, rounded, dark grey-green crown, a little
    // wider than it is tall, built of many clumps
    const p1=[x+lx*0.3*s,Y+1.7*s,z+lz*0.3*s]; limb([x,Y-0.3,z],p1,0.55*s,FLC.holmBark);
    const cy=Y+(3.9+r()*0.5)*s, ccx=x+lx*0.3*s, ccz=z+lz*0.3*s, c=sh(FLC.holm,0.05);
    const cl=crown(ccx,cy,ccz,2.1*s,1.5*s,2.0*s,9,2.2*s,1.8*s,c,{lower:0.8});
    for (let i=0;i<4;i++) limb(p1,[cl[i][0]*0.6+ccx*0.4,cl[i][1]-0.6*s,cl[i][2]*0.6+ccz*0.4],0.26*s,FLC.holmBark,TV.limb);
    if (ch) ch.circles.push({x,z,r:0.3*s,top:Infinity});
  } else if (kind==='carob'){
    // a short thick trunk and spreading limbs under a broad, low dome of glossy dark green that hangs nearly to the
    // ground at its edge; the sheen shows as the lighter faces on top
    const p1=[x+lx*0.2*s,Y+1.4*s,z+lz*0.2*s]; limb([x,Y-0.3,z],p1,0.65*s,FLC.carobBark);
    const cy=Y+(3.0+r()*0.4)*s, c=sh(FLC.carob,0.05);
    const cl=crown(x,cy,z,3.0*s,1.3*s,2.8*s,11,2.4*s,1.7*s,c,{lower:0.95,hi:1.3,lo:0.74});
    for (let i=0;i<4;i++) limb(p1,[cl[i][0]*0.55+x*0.45,cl[i][1]-0.5*s,cl[i][2]*0.55+z*0.45],0.3*s,FLC.carobBark,TV.limb);
    if (ch) ch.circles.push({x,z,r:0.36*s,top:Infinity});
  } else if (kind==='fig'){
    // several smooth pale grey stems splay out from the foot and fork, under a low, wide, open crown of large bright
    // leaves, coarse in its facets, with the stems showing between the clumps
    const ns=3+Math.floor(r()*2), c=sh(FLC.fig,0.06), y0=Y+1.0*s, y1=Y+3.8*s;
    for (let i=0;i<ns;i++){ const a=i*6.28/ns+r()*0.8, q=[x+Math.cos(a)*1.0*s,Y+(1.0+r()*0.3)*s,z+Math.sin(a)*1.0*s]; limb([x,Y-0.3,z],q,0.26*s,FLC.figBark);
      for (let j=0;j<2;j++){ const b=a+(j-0.5)*0.9+(r()-0.5)*0.3, e=[q[0]+Math.cos(b)*(1.1+r()*0.7)*s,q[1]+(0.6+r()*0.6)*s,q[2]+Math.sin(b)*(1.1+r()*0.7)*s];
        limb(q,e,0.14*s,FLC.figBark,TV.limb);
        clump(e[0],e[1]+0.4*s,e[2],(2.5+r()*0.7)*s,(1.6+r()*0.4)*s,(2.3+r()*0.7)*s,c.clone().multiplyScalar(0.92+r()*0.16),y0,y1,{lump:0.12,hi:1.24}); } }
    clump(x,Y+3.0*s,z,2.6*s,1.4*s,2.4*s,c,y0,y1,{keep:true,lump:0.12,hi:1.24});
    if (ch) ch.circles.push({x,z,r:0.3*s,top:Infinity});
  } else if (kind==='almond'){
    // a dark, crooked trunk opening into a vase of thin branches that carry a rounded, open crown of small, sparse
    // tufts of pale grey-green leaves, with much sky between them
    const p1=[x+lx*0.3*s,Y+1.1*s,z+lz*0.3*s]; limb([x,Y-0.3,z],p1,0.3*s,FLC.almondBark);
    const c=sh(FLC.almond,0.05), cy=Y+3.3*s;
    const cl=crown(x+lx*0.3*s,cy,z+lz*0.3*s,1.9*s,1.1*s,1.9*s,11,1.15*s,0.75*s,c,{lower:0.9,lump:0.2,lo:0.74});
    for (let i=0;i<cl.length;i++){ const C0=cl[i]; if (i<5) limb(p1,[C0[0],C0[1]-0.3*s,C0[2]],0.12*s,FLC.almondBark,TV.limb);
      else if (lod===0){ const P0=cl[i%5]; limb([(p1[0]+P0[0])/2,(p1[1]+P0[1])/2,(p1[2]+P0[2])/2],[C0[0],C0[1]-0.25*s,C0[2]],0.07*s,FLC.almondBark,TV.limb); } }
    if (ch) ch.circles.push({x,z,r:0.18*s,top:Infinity});
  } else if (kind==='opuntia'){
    // prickly pear: chains of flat oval pads, each growing from the rim of the one below, lighter on their upper
    // edges, with a few small dark-red fruit on the outermost; at a distance, a lumpy grey-green mass
    if (lod>=2) {}   // too small to draw in the outlines
    else if (lod===1){ const i0=gb.p.length; gb.add(T.sphLo,mat(x,Y+0.55*s,z,2.0*s,1.4*s,1.8*s,r()*6.28),sh(FLC.opuntia,0.05),null); foliage(gb,i0,x,Y+0.55*s,z,0.3,Y,Y+1.3*s,seed); }
    else { const c=sh(FLC.opuntia,0.05), q=[]; for (let i=0;i<3;i++){ const a=r()*6.28; q.push([x+Math.cos(a)*0.6*s,Y-0.05,z+Math.sin(a)*0.6*s,0]); }
      let made=0;
      while (q.length && made<18){ const [px,py,pz,g]=q.shift(), a=r()*6.28, tilt=(r()<0.5?-1:1)*(0.2+r()*(0.35+g*0.3)), ca=Math.cos(a), sa=Math.sin(a);
        const L=(0.58+r()*0.12)*s, tx=px+ca*Math.sin(tilt)*L, ty=py+Math.cos(tilt)*L, tz=pz+sa*Math.sin(tilt)*L;
        // the ico is centred on its origin, so the pad is carried from its middle
        const mx=(px+tx)/2, my=(py+ty)/2, mz=(pz+tz)/2, i0=gb.p.length;
        gb.add(T.ico,segM([mx,my,mz],[mx+tx-px,my+ty-py,mz+tz-pz],0.5*s,0.12*s,a+1.57),c.clone().multiplyScalar(0.92+r()*0.16),null);
        foliage(gb,i0,mx,my,mz,0.04,Y,Y+1.6*s,seed+made,0.78,1.18);
        made++;
        if (g<2){ const kids=1+(r()<0.7?1:0); for (let j=0;j<kids;j++){ const e=(j?-1:1)*0.18*s; q.push([tx+ca*e,ty-0.1*s,tz+sa*e,g+1]); } }
        else for (let j=0;j<3;j++){ const u=(j-1)*0.13*s; if (r()<0.6) ell(TV.speck,tx-sa*u*Math.cos(tilt),ty+0.03*s,tz+ca*u*Math.cos(tilt),0.06*s,0.08*s,0.06*s,FLC.pear); } }
    }
    if (ch) ch.circles.push({x,z,r:0.8*s,top:Infinity});
  } else if (kind==='agave'){
    // a rosette of thick blue-grey leaves, the inner ones upright and the outer ones arching out, lighter at their
    // tips; on some a tall flowering stem branches into a candelabra of small yellow flower heads
    const c=r()<0.7?FLC.agave:FLC.agave2, spike=r()<0.3, H=(4.5+r()*2)*s;
    if (lod===1){ const i0=gb.p.length; gb.add(T.sphLo,mat(x,Y+0.3*s,z,2.2*s,1.2*s,2.2*s,r()*6.28),sh(c,0.05),null); foliage(gb,i0,x,Y+0.3*s,z,0.3,Y,Y+1.2*s,seed); }
    else if (lod===0){ const n=16+Math.floor(r()*5);
      for (let i=0;i<n;i++){ const a=i*2.4+r()*0.3, e=0.45+(i%4)*0.28+r()*0.2, L=(1.1+r()*0.5)*s*(1-0.1*(i%4));
        gb.add(TV.blade,segM([x,Y-0.1,z],[x+Math.cos(a)*Math.cos(e)*L,Y-0.1+Math.sin(e)*L,z+Math.sin(a)*Math.cos(e)*L],0.36*s,0.16*s,1.5),sh(c,0.07).multiplyScalar(spike?0.9:1),Y-0.1); } }
    if (spike && lod<2){ const tp=[x+lx*0.5*s,Y+H,z+lz*0.5*s]; gb.add(TV.limb,segM([x,Y,z],tp,0.16*s,0.16*s),FLC.spike,null);
      for (let i=0;i<6;i++){ const f=0.55+i*0.08, P=[x+lx*0.5*s*f,Y+H*f,z+lz*0.5*s*f], a=i*2.3+r(), l=(0.7-i*0.07)*s, q=[P[0]+Math.cos(a)*l,P[1]+0.2*s,P[2]+Math.sin(a)*l];
        if (lod===0){ gb.add(TV.limb,segM(P,q,0.07*s,0.07*s),FLC.spike,null); for (let j=0;j<5;j++) ell(TV.speck,q[0]+(r()-0.5)*0.35*s,q[1]+0.1*s+r()*0.2*s,q[2]+(r()-0.5)*0.35*s,0.14*s,0.12*s,0.14*s,sh(FLC.bloom,0.1)); } } }
    if (ch) ch.circles.push({x,z,r:0.7*s,top:Infinity});
  } else if (kind==='maquis'){
    // a low, uneven clump of lentisk (mid-green and dense) or rosemary (lower, grey-green): several lumpy mounds
    const ros=r()<0.4, c=ros?FLC.rosemary:FLC.lentisk, n=lod>=2?0:lod>=1?1:3+Math.floor(r()*2), y0=Y, y1=Y+(ros?0.8:1.3)*s;
    for (let i=0;i<n;i++){ const a=r()*6.28, rr=i?(0.5+r()*0.6)*s:0, w=(ros?1.0:1.5)*s*(1-i*0.12)*(0.8+r()*0.4), h=(ros?0.6:1.0)*s*(0.85+r()*0.3);
      const gx=x+Math.cos(a)*rr, gz=z+Math.sin(a)*rr, gy=(i?heightAt(gx,gz)-gb.oy:Y)+h*0.3;
      const i0=gb.p.length; gb.add(T.sphLo,mat(gx,gy,gz,w*(lod>=1?1.4:1),h,w*0.85*(lod>=1?1.4:1),r()*6.28),sh(c,0.08),null); foliage(gb,i0,gx,gy,gz,0.18,y0,y1,seed+i,0.7,1.15); }
  }
}


export { GB, addFlora, addTree, rng, C_ };
