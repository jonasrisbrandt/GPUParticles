export const add = (a,b) => a.map((x,i)=>x+b[i]);
export const sub = (a,b) => a.map((x,i)=>x-b[i]);
export const scale = (a,s) => a.map(x=>x*s);
export const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
export const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const normalize = a => scale(a,1/(Math.hypot(...a)||1));
export function multiply(a,b) {
  const out=new Float32Array(16);
  for(let c=0;c<4;c++) for(let r=0;r<4;r++) for(let k=0;k<4;k++) out[c*4+r]+=a[k*4+r]*b[c*4+k];
  return out;
}
export function perspective(fov,aspect,near,far) {
  const f=1/Math.tan(fov/2), out=new Float32Array(16);
  out[0]=f/aspect; out[5]=f; out[10]=far/(near-far); out[11]=-1; out[14]=far*near/(near-far);
  return out;
}
export class Camera {
  constructor(){this.reset();}
  reset(){this.target=[0,0,0];this.yaw=.24;this.pitch=.42;this.distance=22;this.fov=Math.PI/3.2;this.update(1);}
  update(aspect){
    this.eye=add(this.target,scale([Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch),Math.cos(this.yaw)*Math.cos(this.pitch)],this.distance));
    this.forward=normalize(sub(this.target,this.eye));this.right=normalize(cross(this.forward,[0,1,0]));this.up=cross(this.right,this.forward);
    const z=scale(this.forward,-1), r=this.right, up=this.up, e=this.eye;
    const view=new Float32Array([r[0],up[0],z[0],0,r[1],up[1],z[1],0,r[2],up[2],z[2],0,-dot(r,e),-dot(up,e),-dot(z,e),1]);
    this.vp=multiply(perspective(this.fov,aspect,.1,150),view);
  }
  orbit(dx,dy){this.yaw-=dx*.005;this.pitch=Math.max(-1.5,Math.min(1.5,this.pitch+dy*.005));}
  pan(dx,dy){this.target=add(this.target,add(scale(this.right,-dx*this.distance*.0015),scale(this.up,dy*this.distance*.0015)));}
  zoom(delta){this.distance=Math.max(3,Math.min(60,this.distance*Math.exp(delta*.001)));}
  pointer(nx,ny,aspect){
    const height=Math.tan(this.fov/2)*this.distance;
    return add(this.target,add(scale(this.right,nx*height*aspect),scale(this.up,ny*height)));
  }
}
