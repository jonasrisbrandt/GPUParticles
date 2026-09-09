import {collapseState,COLLAPSE_DURATION} from './collapse.js';
import {simulation,particleShader,downsampleShader,compositeShader,blurShader,blackHoleShader,filamentShader} from './shaders.js';

export class Renderer {
  constructor(canvas){this.canvas=canvas;this.uniforms=new Float32Array(48);this.time=0;this.needsReset=true;this.seed=42;this.frames=0;this.errors=[];}
  async init(){
    if(!navigator.gpu) throw new Error('WebGPU saknas. Öppna sidan i Chrome eller Edge med hårdvaruacceleration, via localhost eller HTTPS.');
    const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if(!adapter) throw new Error('Ingen WebGPU-kompatibel grafikprocessor hittades. Kontrollera att hårdvaruacceleration är aktiverad i webbläsaren.');
    this.maxCount=Math.min(4194304,Math.floor(Math.min(adapter.limits.maxStorageBufferBindingSize,adapter.limits.maxBufferSize)/32/256)*256);
    const device=this.device=await adapter.requestDevice({requiredLimits:{maxStorageBufferBindingSize:this.maxCount*32,maxBufferSize:this.maxCount*32}});
    this.adapterName=adapter.info?.description || adapter.info?.device || adapter.info?.vendor || 'WebGPU';
    device.addEventListener('uncapturederror',e=>{this.errors.push(e.error.message);this.onError?.(new Error(e.error.message));});
    device.lost.then(info=>this.onError?.(new Error(`GPU-anslutningen bröts: ${info.message || info.reason}. Ladda om sidan för att starta om.`)));
    this.context=this.canvas.getContext('webgpu');
    this.format=navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({device,format:this.format,alphaMode:'opaque'});
    this.uniformBuffer=device.createBuffer({label:'Frame uniforms',size:192,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const modules=[];
    for(const [label,code] of [['Simulation',simulation],['Particles',particleShader],['Bloom',downsampleShader],['Composite',compositeShader],['Bloom smoothing',blurShader],['Black hole lensing',blackHoleShader],['Material filaments',filamentShader]]) {
      const module=device.createShaderModule({label,code});
      const info=await module.getCompilationInfo();
      const errors=info.messages.filter(m=>m.type==='error');
      if(errors.length) throw new Error(`${label}: ${errors.map(m=>`rad ${m.lineNum}: ${m.message}`).join('\n')}`);
      modules.push(module);
    }
    device.pushErrorScope('validation');
    this.initPipeline=await device.createComputePipelineAsync({label:'Seed particles',layout:'auto',compute:{module:modules[0],entryPoint:'init'}});
    this.computePipeline=await device.createComputePipelineAsync({label:'Advect particles',layout:'auto',compute:{module:modules[0],entryPoint:'update'}});
    this.particlePipeline=await device.createRenderPipelineAsync({label:'HDR particle streaks',layout:'auto',vertex:{module:modules[1],entryPoint:'vs'},fragment:{module:modules[1],entryPoint:'fs',targets:[{format:'rgba16float',blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
    this.diskPipeline=await device.createRenderPipelineAsync({label:'Particle accretion emission',layout:'auto',vertex:{module:modules[1],entryPoint:'vsDisk'},fragment:{module:modules[1],entryPoint:'fs',targets:[{format:'rgba16float',blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}}}]}});
    this.blackHolePipeline=await device.createRenderPipelineAsync({label:'Curved rays through particle disk',layout:'auto',vertex:{module:modules[5],entryPoint:'vs'},fragment:{module:modules[5],entryPoint:'fs',targets:[{format:'rgba16float'}]}});
    this.filamentPipeline=await device.createRenderPipelineAsync({label:'Solid material filaments',multisample:{count:4},layout:'auto',vertex:{module:modules[6],entryPoint:'vs'},fragment:{module:modules[6],entryPoint:'fs',targets:[{format:'rgba16float'}]},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    this.bloomPipeline=await device.createRenderPipelineAsync({label:'Bloom pyramid',layout:'auto',vertex:{module:modules[2],entryPoint:'vs'},fragment:{module:modules[2],entryPoint:'fs',targets:[{format:'rgba16float'}]}});
    this.compositePipeline=await device.createRenderPipelineAsync({label:'Bloom and tone map',layout:'auto',vertex:{module:modules[3],entryPoint:'vs'},fragment:{module:modules[3],entryPoint:'fs',targets:[{format:this.format}]}});
    this.blurPipelines=[];
    for(const entryPoint of ['horizontal','vertical'])this.blurPipelines.push(await device.createRenderPipelineAsync({label:`Bloom ${entryPoint}`,layout:'auto',vertex:{module:modules[4],entryPoint:'vs'},fragment:{module:modules[4],entryPoint,targets:[{format:'rgba16float'}]}}));
    const error=await device.popErrorScope();if(error) throw error;
    this.sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
    this.diskTexture=device.createTexture({label:'Accretion emission atlas',size:[1024,1024],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    this.diskView=this.diskTexture.createView();
    this.blackHoleGroup=device.createBindGroup({layout:this.blackHolePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:this.diskView},{binding:2,resource:this.sampler}]});
    this.setCount(Math.min(524288,this.maxCount));
    this.resize();
  }
  setCount(count){
    if(!Number.isInteger(count)||count<256||count>this.maxCount) throw new Error('Partikelantalet stöds inte av denna GPU.');
    this.count=count;
    this.particleBuffer?.destroy();
    this.particleBuffer=this.device.createBuffer({label:`${count} particles / 32 bytes`,size:count*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    const entries=[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:this.particleBuffer}}];
    this.initGroup=this.device.createBindGroup({layout:this.initPipeline.getBindGroupLayout(0),entries});
    this.computeGroup=this.device.createBindGroup({layout:this.computePipeline.getBindGroupLayout(0),entries});
    this.particleGroup=this.device.createBindGroup({layout:this.particlePipeline.getBindGroupLayout(0),entries});
    this.filamentGroup=this.device.createBindGroup({layout:this.filamentPipeline.getBindGroupLayout(0),entries});
    this.diskGroup=this.device.createBindGroup({layout:this.diskPipeline.getBindGroupLayout(0),entries});
    this.needsReset=true;
  }
  reset(){this.needsReset=true;this.seed=(this.seed+7919)%1000000;this.time=0;}
  resize(){
    const max=this.device.limits.maxTextureDimension2D;
    const cssW=Math.max(1,this.canvas.clientWidth),cssH=Math.max(1,this.canvas.clientHeight);
    const ratio=Math.min(devicePixelRatio||1,1.5,Math.sqrt(2400000/(cssW*cssH)),max/cssW,max/cssH);
    const width=Math.max(1,Math.round(cssW*ratio)),height=Math.max(1,Math.round(cssH*ratio));
    if(this.width===width&&this.height===height) return;
    this.width=this.canvas.width=width;this.height=this.canvas.height=height;
    this.targets?.forEach(t=>t.destroy());this.blurTargets?.forEach(t=>t.destroy());
    this.filamentTarget?.destroy();
    this.filamentTarget=this.device.createTexture({label:'Antialiased filaments',size:[width,height],sampleCount:4,format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    this.filamentView=this.filamentTarget.createView();
    this.depthTexture?.destroy();
    this.depthTexture=this.device.createTexture({label:'Filament occlusion',size:[width,height],sampleCount:4,format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    this.depthView=this.depthTexture.createView();
    this.targets=[];this.bloomGroups=[];
    for(let i=0;i<6;i++) this.targets.push(this.device.createTexture({label:i?'Bloom '+i:'HDR scene',size:[Math.max(1,width>>i),Math.max(1,height>>i)],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}));
    this.views=this.targets.map(t=>t.createView());
    this.blurTargets=[];this.blurViews=[];this.blurGroups=[];
    for(let i=1;i<6;i++){
      const texture=this.device.createTexture({label:`Bloom scratch ${i}`,size:[Math.max(1,width>>i),Math.max(1,height>>i)],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
      this.blurTargets.push(texture);this.blurViews.push(texture.createView());
      this.blurGroups.push(this.blurPipelines.map((pipeline,axis)=>this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:axis?this.blurViews[i-1]:this.views[i]},{binding:1,resource:this.sampler}]})));
    }
    for(let i=1;i<6;i++) this.bloomGroups.push(this.device.createBindGroup({layout:this.bloomPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.views[i-1]},{binding:1,resource:this.sampler}]}));
    this.compositeGroup=this.device.createBindGroup({layout:this.compositePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}},...this.views.map((resource,i)=>({binding:i+1,resource})),{binding:7,resource:this.sampler}]});
  }
  frame(dt,camera,pointer,settings,burst){
    this.resize();
    if(settings.preset===4){
      const previousTime=this.time;
      this.time=Math.min(COLLAPSE_DURATION,this.time+dt*settings.speed);
      dt=(this.time-previousTime)/settings.speed;
    }else this.time+=dt*settings.speed;
    const u=this.uniforms;
    u.set(camera.vp,0);u.set([...camera.right,0],16);u.set([...camera.up,0],20);u.set([...camera.eye,0],24);
    u.set([...pointer.position,pointer.strength],28);u.set([dt,this.time,this.count,collapseState(this.time).tau],32);
    u.set([settings.turbulence,settings.speed,settings.force,settings.preset],36);
    u.set([settings.size,settings.bloom,settings.exposure,settings.palette],40);u.set([this.width,this.height,burst,this.seed],44);
    this.device.queue.writeBuffer(this.uniformBuffer,0,u);
    const encoder=this.device.createCommandEncoder();
    const compute=encoder.beginComputePass();
    if(this.needsReset){compute.setPipeline(this.initPipeline);compute.setBindGroup(0,this.initGroup);compute.dispatchWorkgroups(Math.ceil(this.count/256));this.needsReset=false;}
    compute.setPipeline(this.computePipeline);compute.setBindGroup(0,this.computeGroup);compute.dispatchWorkgroups(Math.ceil(this.count/256));compute.end();
    const attachment=view=>({view,clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'});
    if(settings.preset===3){
      const disk=encoder.beginRenderPass({colorAttachments:[attachment(this.diskView)]});
      disk.setPipeline(this.diskPipeline);disk.setBindGroup(0,this.diskGroup);disk.draw(6,this.count);disk.end();
    }
    const scene=encoder.beginRenderPass({colorAttachments:[settings.preset===4?{...attachment(this.filamentView),resolveTarget:this.views[0]}:attachment(this.views[0])],...(settings.preset===4?{depthStencilAttachment:{view:this.depthView,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}}:{})});
    if(settings.preset===3){scene.setPipeline(this.blackHolePipeline);scene.setBindGroup(0,this.blackHoleGroup);scene.draw(3);}
    else if(settings.preset===4){scene.setPipeline(this.filamentPipeline);scene.setBindGroup(0,this.filamentGroup);scene.draw(6,64*Math.min(Math.floor(this.count/64)-1,512));}
    else {scene.setPipeline(this.particlePipeline);scene.setBindGroup(0,this.particleGroup);scene.draw(6,this.count);}
    scene.end();
    for(let i=0;i<5;i++){
      const bloom=encoder.beginRenderPass({colorAttachments:[attachment(this.views[i+1])]});
      bloom.setPipeline(this.bloomPipeline);bloom.setBindGroup(0,this.bloomGroups[i]);bloom.draw(3);bloom.end();
      for(let axis=0;axis<2;axis++){
        const blur=encoder.beginRenderPass({colorAttachments:[attachment(axis?this.views[i+1]:this.blurViews[i])]});
        blur.setPipeline(this.blurPipelines[axis]);blur.setBindGroup(0,this.blurGroups[i][axis]);blur.draw(3);blur.end();
      }
    }
    const composite=encoder.beginRenderPass({colorAttachments:[attachment(this.context.getCurrentTexture().createView())]});
    composite.setPipeline(this.compositePipeline);composite.setBindGroup(0,this.compositeGroup);composite.draw(3);composite.end();
    this.device.queue.submit([encoder.finish()]);this.frames++;
  }
}
