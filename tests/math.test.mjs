import test from 'node:test';
import assert from 'node:assert/strict';
import {Camera,dot,perspective} from '../src/math.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
test('WebGPU projection maps near/far planes to depth 0/1',()=>{
  const p=perspective(Math.PI/3,16/9,.1,150);
  const depth=z=>(p[10]*z+p[14])/(-z);
  near(depth(-.1),0);near(depth(-150),1);
});
test('pointer plane projects to the cursor after orbit, pan and zoom',()=>{
  const c=new Camera();c.orbit(273,-92);c.pan(54,29);c.zoom(-240);c.update(1.77);
  for(const [x,y] of [[0,0],[-.9,.7],[.5,-.4]]){
    const p=[...c.pointer(x,y,1.77),1],m=c.vp;
    const projected=[0,1,2,3].map(r=>p.reduce((sum,v,k)=>sum+v*m[k*4+r],0));
    near(projected[0]/projected[3],x);near(projected[1]/projected[3],y);
  }
  near(dot(c.up,c.right),0);near(dot(c.forward,c.right),0);near(dot(c.up,c.forward),0);
});
test('extreme zoom and orbit inputs keep the camera finite',()=>{
  const c=new Camera();c.zoom(-1e6);c.orbit(123,1e6);c.update(.4);
  assert.equal(c.distance,3);assert.ok([...c.vp,...c.pointer(1,1,.4)].every(Number.isFinite));
  c.zoom(1e6);assert.equal(c.distance,60);
});


import {collapseState,COLLAPSE_DURATION} from '../src/collapse.js';
test('guide timeline stops strictly before its singularity marker',()=>{
  const start=collapseState(0),end=collapseState(COLLAPSE_DURATION);
  near(start.t,0);near(start.tau,1);
  near(end.tau,.04);assert.ok(end.t<1&&end.done);
  assert.deepEqual(collapseState(1e9),end);
  assert.deepEqual(collapseState(-10),start);
  for(let t=0;t<=24;t+=.1){
    const s=collapseState(t);
    assert.ok([s.guideRadius,s.guideHeight,s.tau].every(Number.isFinite));
    assert.ok(s.tau>0);
  }
});


test('guide animation squeezes radius and stretches height instead of uniformly zooming',()=>{
  const start=collapseState(0),end=collapseState(24);
  near(start.guideRadius,1);near(start.guideHeight,1);
  assert.ok(end.guideRadius<.27&&end.guideHeight>=2.1);
  for(let seconds=1;seconds<=24;seconds++){
    const a=collapseState(seconds-1),b=collapseState(seconds);
    assert.ok(b.guideRadius<a.guideRadius&&b.guideHeight>a.guideHeight);
  }
});
