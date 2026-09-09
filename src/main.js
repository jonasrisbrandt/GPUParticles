import {collapseState,COLLAPSE_DURATION} from './collapse.js';
import {Renderer} from './renderer.js';
import {Camera,add,scale} from './math.js';
const $=id=>document.getElementById(id);
const canvas=$('scene'),renderer=new Renderer(canvas),camera=new Camera();
const settings={turbulence:.75,speed:1,force:1.2,bloom:.85,size:1.2,exposure:1,preset:0,palette:0};
const pointer={x:innerWidth/2,y:innerHeight/2,position:[0,0,0],strength:0,inside:false,button:-1,id:null};
const keys=new Set();
let paused=false,failed=false,burst=0,previous=performance.now(),fpsTime=0,fpsFrames=0,raf;
function fail(error){
  if(failed)return;failed=true;cancelAnimationFrame(raf);console.error(error);
  $('loading').hidden=true;$('error').hidden=false;$('error-message').textContent=error.message || String(error);$('status').textContent='GPU ERROR';
}
renderer.onError=fail;
for(const name of ['turbulence','speed','force','bloom','size','exposure']){
  const input=$(name);
  const update=()=>{settings[name]=Number(input.value);$(name+'-value').value=Number(input.value).toFixed(2);input.style.setProperty('--fill',`${(input.value-input.min)/(input.max-input.min)*100}%`);};
  input.addEventListener('input',update);update();
}
function updateCount(){
  const count=renderer.count;
  $('count').value=String(count);$('count-value').value=count.toLocaleString('sv-SE');
  $('particle-stat').textContent=count>=1000000?(count/1000000).toFixed(2)+'M':Math.round(count/1000)+'K';
  $('memory').textContent=`${Math.round(count*32/1024/1024)} MB`;
}
$('count').addEventListener('change',()=>{try{renderer.setCount(Number($('count').value));renderer.reset();updateCount();}catch(e){fail(e);}});
const names=['VORTEX','NEBULA','STREAM','BLACK HOLE','NAVIER–STOKES'];
const notes=['Ett roterande fält av sammanflätade virvlar.','Ett viktlöst moln av långsamt böljande ljus.','Fem strömmar i en ändlös, turbulent helix.','En glödande ackretionsskiva. Ljus böjs runt mörkret.','En krympande virvelkärna med allt snabbare rotation.'];
let previousPalette=0;
function selectPalette(value){
  settings.palette=value;
  document.querySelectorAll('.palette').forEach(b=>{const active=Number(b.dataset.palette)===value;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
}
document.querySelectorAll('.preset').forEach(button=>button.addEventListener('click',()=>{
  const previous=settings.preset;
  settings.preset=Number(button.dataset.preset);
  if(settings.preset===3&&previous!==3){previousPalette=settings.palette;selectPalette(3);camera.reset(3);}
  if(previous===3&&settings.preset!==3){selectPalette(previousPalette);camera.reset();}
  if(settings.preset===4){selectPalette(0);camera.reset(4);}
  if(previous===4&&settings.preset<3)camera.reset();
  $('collapse-controls').hidden=settings.preset!==4;
  document.querySelectorAll('.preset').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  $('scene-index').textContent=`0${settings.preset+1} / ${names[settings.preset]}`;$('preset-note').textContent=notes[settings.preset];renderer.reset();
}));
document.querySelectorAll('.palette').forEach(button=>button.addEventListener('click',()=>{
  selectPalette(Number(button.dataset.palette));
}));
$('collapse-phase').addEventListener('input',()=>{
  renderer.time=Number($('collapse-phase').value)/100*COLLAPSE_DURATION;
  renderer.needsReset=true;burst=0;updateCollapse();
});
function updateCollapse(){
  if(settings.preset!==4)return;
  const state=collapseState(renderer.time);
  $('collapse-phase').value=String(state.progress*100);
  $('collapse-phase').style.setProperty('--fill',`${state.progress*100}%`);
  $('collapse-time').value=`t = ${state.t.toFixed(3)}`;
  $('collapse-metrics').textContent=`Radie ×${state.radius.toFixed(2)} · fartskala ×${state.speed.toFixed(2)}`;
  const colors=settings.palette===0?'Turkos → orange':settings.palette===1?'Lila → mint':settings.palette===2?'Rött → guld':'Bärnsten → vitgult';
  $('collapse-state').textContent=state.done?'Visningsgräns nådd · dra tillbaka tiden eller återställ.':`${colors}: långsam → snabb rotation.`;
}
function pause(){paused=!paused;$('pause').textContent=paused?'▷ Fortsätt':'Ⅱ Pausa';$('status').textContent=paused?'PAUSAD':'LIVE SIMULATION';}
function reset(){renderer.reset();camera.reset(settings.preset);burst=0;}
function toggleUI(){const hidden=document.body.classList.toggle('ui-hidden');$('show').hidden=!hidden;}
$('pause').addEventListener('click',pause);$('reset').addEventListener('click',reset);$('hide').addEventListener('click',toggleUI);$('show').addEventListener('click',toggleUI);
function clearInput(){keys.clear();pointer.button=-1;pointer.strength=0;pointer.id=null;$('pointer').style.display='none';}
window.addEventListener('blur',clearInput);
document.addEventListener('visibilitychange',()=>{clearInput();previous=performance.now();fpsTime=0;fpsFrames=0;});
window.addEventListener('keydown',e=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
  if(e.code==='Space'&&e.target.tagName==='BUTTON')return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  keys.add(e.code);if(e.repeat)return;
  if(e.code==='Space')pause();if(e.code==='KeyR')reset();if(e.code==='KeyH')toggleUI();if(e.code==='KeyB'&&!paused)burst=1;
  if(e.code==='KeyF'){if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});else document.documentElement.requestFullscreen().catch(()=>{});}
});
window.addEventListener('keyup',e=>keys.delete(e.code));
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{if(pointer.id!==null)return;pointer.button=e.button;pointer.id=e.pointerId;pointer.x=e.clientX;pointer.y=e.clientY;pointer.inside=true;canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{
  if(pointer.id!==null&&pointer.id!==e.pointerId)return;
  const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
  if(pointer.button===2)camera.orbit(dx,dy);
  if(pointer.button===1)camera.pan(dx,dy);
  pointer.x=e.clientX;pointer.y=e.clientY;pointer.inside=true;
});
canvas.addEventListener('pointerup',e=>{if(e.pointerId!==pointer.id)return;pointer.button=-1;pointer.id=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);});
canvas.addEventListener('pointercancel',clearInput);canvas.addEventListener('lostpointercapture',()=>{pointer.button=-1;pointer.id=null;});
canvas.addEventListener('pointerleave',()=>{pointer.inside=false;});
canvas.addEventListener('wheel',e=>{e.preventDefault();camera.zoom(e.deltaY);},{passive:false});
function frame(now){
  if(failed)return;
  const realElapsed=Math.max((now-previous)/1000,.0001),elapsed=Math.min(realElapsed,.05);previous=now;
  if(document.hidden){raf=requestAnimationFrame(frame);return;}
  const move=elapsed*camera.distance*.45;
  if(keys.has('KeyW')||keys.has('ArrowUp'))camera.target=add(camera.target,scale(camera.forward,move));
  if(keys.has('KeyS')||keys.has('ArrowDown'))camera.target=add(camera.target,scale(camera.forward,-move));
  if(keys.has('KeyA')||keys.has('ArrowLeft'))camera.target=add(camera.target,scale(camera.right,-move));
  if(keys.has('KeyD')||keys.has('ArrowRight'))camera.target=add(camera.target,scale(camera.right,move));
  if(keys.has('KeyQ'))camera.target[1]-=move;if(keys.has('KeyE'))camera.target[1]+=move;
  camera.update(canvas.clientWidth/canvas.clientHeight);
  pointer.position=camera.pointer(pointer.x/canvas.clientWidth*2-1,1-pointer.y/canvas.clientHeight*2,canvas.clientWidth/canvas.clientHeight);
  const push=keys.has('ShiftLeft')||keys.has('ShiftRight');
  // Hover gently stirs the flow; holding left click makes the force stronger.
  pointer.strength=pointer.inside&&pointer.button!==2&&pointer.button!==1?(pointer.button===0?1:.12)*(push?-1:1):0;
  const marker=$('pointer');marker.style.display=pointer.inside&&pointer.button===0?'block':'none';marker.style.left=pointer.x+'px';marker.style.top=pointer.y+'px';marker.classList.toggle('push',push);marker.querySelector('span').textContent=push?'REPEL':'ATTRACT';
  try{renderer.frame(paused?0:elapsed,camera,pointer,settings,paused?0:burst);burst=0;updateCollapse();}catch(e){fail(e);return;}
  fpsTime+=realElapsed;fpsFrames++;
  if(fpsTime>.6){$('fps').textContent=Math.round(fpsFrames/fpsTime);fpsFrames=0;fpsTime=0;}
  raf=requestAnimationFrame(frame);
}
try{
  await renderer.init();
  for(const option of $('count').options)if(Number(option.value)>renderer.maxCount)option.disabled=true;
  updateCount();$('gpu-label').textContent=renderer.adapterName;$('gpu-label').title=renderer.adapterName;
  $('status').textContent='LIVE SIMULATION';$('loading').hidden=true;previous=performance.now();raf=requestAnimationFrame(frame);
  // Read-only diagnostics are useful for browser smoke tests and performance inspection.
  window.aether={get diagnostics(){return {count:renderer.count,maxCount:renderer.maxCount,frames:renderer.frames,errors:[...renderer.errors],paused,preset:settings.preset,palette:settings.palette,width:renderer.width,height:renderer.height,adapter:renderer.adapterName,camera:{eye:[...camera.eye],target:[...camera.target]},pointer:{position:[...pointer.position],strength:pointer.strength}};}};
}catch(e){fail(e);}
