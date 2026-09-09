import {Renderer} from '../src/renderer.js';
import {Camera} from '../src/math.js';
const output=document.getElementById('results');
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
document.getElementById('run').onclick=async()=>{
  const button=document.getElementById('run');button.disabled=true;output.textContent='Running…\n';
  const renderer=new Renderer(document.getElementById('gpu'));
  const camera=new Camera();
  const pointer={position:[4,0,0],strength:0};
  const settings={turbulence:.75,speed:1,force:1.2,bloom:.85,size:1.2,exposure:1,preset:0,palette:0};
  const errors=[];renderer.onError=error=>errors.push(error.message);
  // Inspect both ends of the storage binding, including the final dispatched workgroup.
  async function sample(){
    const bytes=64*32;
    const readback=renderer.device.createBuffer({size:bytes*2,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{
      const encoder=renderer.device.createCommandEncoder();
      encoder.copyBufferToBuffer(renderer.particleBuffer,0,readback,0,bytes);
      encoder.copyBufferToBuffer(renderer.particleBuffer,renderer.count*32-bytes,readback,bytes,bytes);
      renderer.device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const values=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();
      assert(values.every(Number.isFinite),'Non-finite particle state');
      for(let i=0;i<values.length;i+=8)assert(values[i+7]>0,'Uninitialized or dead particle at buffer boundary');
      return values;
    }finally{readback.destroy();}
  }
  try{
    await renderer.init();renderer.setCount(65536);
    for(const preset of [0,1,2,3,4,3,0]){
      settings.preset=preset;settings.palette=preset===3?3:0;camera.reset(preset);camera.update(16/9);renderer.reset();
      for(let i=0;i<12;i++)renderer.frame(1/60,camera,pointer,settings,0);
      const values=await sample();
      if(preset===3)for(let i=0;i<values.length;i+=8)assert(Math.abs(values[i+1])<.03,'Accretion particles left the disk plane');
      output.textContent+=`PASS formation ${preset}: initialization, update, rendering and finite GPU state\n`;
    }
    settings.preset=4;settings.palette=0;camera.reset(4);camera.update(16/9);
    renderer.time=0;renderer.needsReset=true;renderer.frame(0,camera,pointer,settings,0);
    const broad=await sample();
    renderer.time=24;renderer.needsReset=true;renderer.frame(0,camera,pointer,settings,0);
    const narrow=await sample();
    for(let i=0;i<broad.length;i+=8){
      const radius=Math.hypot(broad[i],broad[i+2]);
      assert(Math.abs(Math.hypot(narrow[i],narrow[i+2])/radius-.2)<1e-4,'GPU radial scale mismatch');
      assert(Math.abs(narrow[i+1]-broad[i+1]*Math.pow(.04,.495))<1e-4,'GPU axial scale mismatch');
      const speedRatio=Math.hypot(narrow[i+4],narrow[i+5],narrow[i+6])/Math.hypot(broad[i+4],broad[i+5],broad[i+6]);
      assert(speedRatio>4.99&&speedRatio<5.09,'GPU velocity did not grow with contraction');
    }
    output.textContent+='PASS GPU radial/axial scaling and increasing velocity at matching tracer coordinates\n';
    for(const time of [0,12,23.99,24]){
      renderer.time=time;renderer.needsReset=true;
      renderer.frame(1/60,camera,pointer,settings,0);await sample();
    }
    const stopped=await sample();
    renderer.frame(.05,camera,pointer,settings,1);
    const cutoff=await sample();
    assert(stopped.every((v,i)=>v===cutoff[i]),'Finite cutoff failed to hold particles');
    assert(renderer.time===24,'Timeline exceeded its finite cutoff');
    renderer.reset();renderer.frame(1/60,camera,pointer,settings,0);
    assert(renderer.time<1,'Reset did not restart the collapse');
    const initial=await sample();
    renderer.frame(0,camera,pointer,settings,0);
    const frozen=await sample();assert(initial.every((v,i)=>v===frozen[i]),'Collapse pause changed state');
    pointer.strength=1;
    renderer.frame(.05,camera,pointer,settings,1);await sample();pointer.strength=0;
    output.textContent+='PASS collapse timeline, seek initialization, finite cutoff, restart, pause and interaction\n';
    for(const preset of [4,3]){
      settings.preset=preset;settings.palette=preset===3?3:0;camera.reset(preset);camera.update(16/9);renderer.reset();
      for(const count of [renderer.maxCount,262144]){
        renderer.setCount(count);renderer.frame(1/60,camera,pointer,settings,0);await sample();
        output.textContent+=`PASS resize particle buffer: ${count}\n`;
      }
    }
    const before=await sample();
    renderer.frame(0,camera,pointer,settings,0);
    const paused=await sample();
    assert(before.every((v,i)=>v===paused[i]),'Pause changed particle state');
    pointer.strength=1;
    for(let i=0;i<12;i++)renderer.frame(1/60,camera,pointer,settings,0);
    const moved=await sample();assert(moved.some((v,i)=>v!==paused[i]),'Simulation did not resume');
    camera.orbit(120,-100);camera.pan(20,-10);camera.zoom(-100);camera.update(16/9);
    renderer.frame(1/60,camera,pointer,settings,1);await sample();
    assert(errors.length===0,errors.join('\n'));
    output.textContent+='PASS pause, resume, mouse force, orbit, pan, zoom and impulse\nALL GPU CHECKS PASSED';
  }catch(error){output.textContent+='FAIL: '+error.message;console.error(error);}
  finally{renderer.onError=undefined;renderer.device?.destroy();button.disabled=false;}
};
