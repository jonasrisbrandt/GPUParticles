const common = /* wgsl */`
struct Uniforms {
  vp: mat4x4f,
  right: vec4f,
  up: vec4f,
  eye: vec4f,
  pointer: vec4f,
  timing: vec4f,
  flow: vec4f,
  render: vec4f,
  misc: vec4f,
};
struct Particle { position: vec4f, velocity: vec4f };
@group(0) @binding(0) var<uniform> u: Uniforms;
fn hash(n: u32) -> u32 {
  var x = n;
  x = (x ^ (x >> 16u)) * 2146121005u;
  x = (x ^ (x >> 15u)) * 2221713035u;
  return x ^ (x >> 16u);
}
fn random(n: u32) -> f32 { return f32(hash(n)) / 4294967295.; }
// Art-directed guide animation. Every particle is evaluated from absolute time,
// so seeking and uninterrupted playback produce the same positions.
fn guidePosition(i:u32,time:f32)->vec3f {
  let progress=clamp(time/24.,0.,1.);
  let tau=1.-.96*progress;
  let strand=i%64u;
  let seed=hash(i+u32(u.misc.w));
  let variation=random(strand/2u+u32(u.misc.w));
  let along=fract(random(seed)+time*.065+time*time*.003);
  let radialScale=4.*pow(tau,.42);
  let heightScale=2.8*(1.+1.1*progress);
  let radius=(1.65*exp(-2.4*along)+.08)*(.4+variation*.85)*radialScale;
  let signY=select(-1.,1.,strand%2u==0u);
  let height=signY*(.2*along+(1.3+variation*.8)*along*along)*heightScale;
  let angle=f32(strand/2u)*6.2831853/32.+along*(10.+variation*5.+progress*9.)+time*.12;
  let scatter=vec3f(random(seed+1u)-.5,random(seed+2u)-.5,random(seed+3u)-.5);
  var pos=vec3f(cos(angle)*radius,height,sin(angle)*radius)+scatter*vec3f(.24*pow(tau,.3),.18,.24*pow(tau,.3));
  pos+=vec3f(sin(height*1.8+time+variation*9.),sin(angle*2.-time),cos(height*1.6-time+variation*9.))*u.flow.x*.07;
  let delta=u.pointer.xyz-pos;
  pos+=delta*u.pointer.w*u.flow.z*.65*exp(-dot(delta,delta)/12.);
  let age=max(0.,time-u.right.w);
  pos+=normalize(pos+vec3f(.001))*exp(-age*2.)*min(age*8.,1.)*1.5;
  return pos;
}
fn guideParticle(i:u32)->Particle {
  let seed=hash(i+u32(u.misc.w));
  let phase=fract(random(seed)+u.timing.y*.065+u.timing.y*u.timing.y*.003);
  let pos=guidePosition(i,u.timing.y);
  var p:Particle;
  p.position=vec4f(pos,random(seed+6u));
  let velocity=(guidePosition(i,u.timing.y+.001)-pos)*1000.;
  p.velocity=vec4f(velocity*min(1.,40./max(length(velocity),.001)),.05+8.*smoothstep(0.,.04,phase)*(1.-smoothstep(.94,1.,phase)));
  return p;
}
`;

export const simulation = common + /* wgsl */`
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
const TAU: f32 = 6.2831853;
fn spawn(i: u32, epoch: u32) -> Particle {
  let seed = hash(i + epoch * 7919u + u32(u.misc.w));
  let a = random(seed) * TAU;
  let b = random(seed + 1u) * TAU;
  let r = pow(random(seed + 2u), .6) * 1.45 + .04;
  var pos = vec3f((4.1 + cos(b)*r)*cos(a), sin(b)*r + sin(a*3.)*.6, (4.1 + cos(b)*r)*sin(a));
  if (u.flow.w > .5 && u.flow.w < 1.5) {
    let z = random(seed + 3u)*2.-1.;
    let rad = pow(random(seed + 4u), .3333)*5.2;
    pos = vec3f(sqrt(1.-z*z)*cos(a), z*.72, sqrt(1.-z*z)*sin(a))*rad;
  }
  if (u.flow.w > 1.5 && u.flow.w < 2.5) {
    let x = (random(seed + 5u)*2.-1.)*7.;
    let strand = f32(i % 5u)*TAU/5.;
    pos = vec3f(x, sin(x*.65 + strand)*1.5 + cos(b)*r*.3, cos(x*.65 + strand)*1.5 + sin(b)*r*.3);
  }
  if (u.flow.w > 2.5 && u.flow.w < 3.5) {
    let diskRadius = 3.05 + pow(random(seed + 5u), 1.6)*5.15;
    pos = vec3f(cos(a)*diskRadius, (random(seed + 8u)-.5)*.04, sin(a)*diskRadius);
  }
  var p: Particle;
  p.position = vec4f(pos, random(seed + 6u));
  p.velocity = vec4f(0.,0.,0.,random(seed + 7u)*22. + 8.);
  if (u.flow.w > 2.5 && u.flow.w < 3.5) {
    p.velocity = vec4f(normalize(vec3f(-pos.z,0.,pos.x))*sqrt(42./length(pos.xz)), 35.+random(seed+7u)*35.);
  }

  return p;
}
@compute @workgroup_size(256) fn init(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(u.timing.z)) { return; }
  if(u.flow.w>3.5){particles[id.x]=guideParticle(id.x);}
  else {particles[id.x] = spawn(id.x, 0u);}
}
// A sum of ABC fields: each component is independent of its own axis,
// so the analytic velocity field is divergence-free and stays filamentary.
fn curl(p: vec3f, t: f32) -> vec3f {
  let q = p*.82;
  let a = vec3f(sin(q.z+t*.19)+cos(q.y-t*.13), sin(q.x+t*.17)+cos(q.z+t*.11), sin(q.y-t*.15)+cos(q.x+t*.14));
  let s = p*1.93;
  let b = vec3f(sin(s.z-t*.27)+cos(s.y), sin(s.x)+cos(s.z+t*.21), sin(s.y+t*.23)+cos(s.x));
  return a + b*.32;
}
@compute @workgroup_size(256) fn update(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= u32(u.timing.z)) { return; }
  let dt = u.timing.x*u.flow.y;
  if (dt <= 0.) { return; }
  var p = particles[i];
  if (u.flow.w > 3.5) {
    particles[i]=guideParticle(i);
    return;
  }
  let pos = p.position.xyz;
  let t = u.timing.y;
  let radius = max(length(pos.xz), .001);
  let radial = vec3f(pos.x/radius, 0., pos.z/radius);
  let tangent = vec3f(-radial.z, 0., radial.x);
  let theta = atan2(pos.z, pos.x);
  let centerY = sin(theta*3.+t*.15)*.6;
  let centerR = 4.1 + sin(theta*2.-t*.12)*.35;
  let tube = pos - radial*centerR - vec3f(0.,centerY,0.);
  var flowVelocity = tangent*2.2 + cross(tangent,tube)*1.6 - tube*.48;
  if (u.flow.w > .5 && u.flow.w < 1.5) {
    flowVelocity = vec3f(-pos.z*.32, sin(pos.x*.6+t*.2)*.5, pos.x*.32) - pos*.1;
    flowVelocity -= normalize(pos + vec3f(.0001))*max(length(pos)-5.,0.)*.9;
  }
  if (u.flow.w > 1.5 && u.flow.w < 2.5) {
    let phase = pos.x*.65 + f32(i % 5u)*TAU/5.;
    let center = vec3f(pos.x, sin(phase)*1.5, cos(phase)*1.5);
    flowVelocity = vec3f(2.5, cos(phase)*2.44, -sin(phase)*2.44) - (pos-center)*1.25;
  }
  if (u.flow.w > 2.5 && u.flow.w < 3.5) {
    // Kepler-like differential rotation, slow accretion and weak planar turbulence.
    flowVelocity = tangent*sqrt(42./max(radius,1.)) - radial*.045 - vec3f(0.,pos.y*5.,0.);
    let eddies = curl(pos,t)*u.flow.x*.16;
    flowVelocity += vec3f(eddies.x,0.,eddies.z);
    flowVelocity -= radial*max(radius-8.2,0.)*.8;
  } else {
    flowVelocity += curl(pos,t)*u.flow.x*1.15;
  }
  var vel = mix(p.velocity.xyz, flowVelocity, 1.-exp(-dt*2.4));
  let delta = u.pointer.xyz - pos;
  let d2 = dot(delta, delta);
  let falloff = exp(-d2/10.);
  vel += (delta*u.pointer.w*3.8 + cross(u.eye.xyz-u.pointer.xyz, -delta)*abs(u.pointer.w)*.08)*falloff*u.flow.z*dt;
  vel += normalize(pos+vec3f(.001))*u.misc.z*11.;
  vel *= min(1., 16./max(length(vel),.001));
  p.position = vec4f(pos+vel*dt, p.position.w);
  p.velocity = vec4f(vel,p.velocity.w-dt);
  if (u.flow.w > 2.5 && u.flow.w < 3.5) { p.position.y = 0.; p.velocity.y = 0.; }
  if (u.flow.w > 1.5 && u.flow.w < 2.5 && p.position.x > 7.5) { p.position.x -= 15.; }
  if (p.velocity.w <= 0. || length(p.position.xyz) > 24. || (u.flow.w > 2.5 && u.flow.w < 3.5 && length(p.position.xyz) < 2.5)) {
    p = spawn(i, u32(t*7.)+1u);
    p.velocity.w = 22. + p.position.w*20.;
  }
  particles[i] = p;
}
`;

export const particleShader = common + /* wgsl */`
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
struct Out {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec3f,
};
fn thermalColor(radius: f32) -> vec3f {
  let heat = 1.-smoothstep(2.8,8.4,radius);
  return mix(vec3f(.65,.16,.025),vec3f(1.,.79,.42),heat)*(.35+heat*.65)
    + vec3f(.55,.52,.43)*pow(heat,5.);
}
// A top-down emission atlas of the actual particles, consumed by curved camera rays.
@vertex fn vsDisk(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let p = particles[i];
  let corners = array<vec2f,6>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(-1.,1.),vec2f(1.,-1.),vec2f(1.,1.));
  let corner = corners[v];
  let radius = length(p.position.xz);
  let fade = smoothstep(2.5,3.1,radius)*(1.-smoothstep(7.6,8.8,radius))*smoothstep(0.,1.5,p.velocity.w);
  let theta = atan2(p.position.z,p.position.x);
  let filaments = .65+.35*sin(radius*34.+theta*3.-u.timing.y*.8);
  var color = thermalColor(radius);
  if (u.render.w < 2.5) {
    color = mix(vec3f(.055,.69,.66),vec3f(1.,.27,.065),.5+.5*sin(radius));
    if (u.render.w > .5 && u.render.w < 1.5) { color=mix(vec3f(.35,.12,.95),vec3f(.15,1.,.64),.5+.5*sin(radius)); }
    if (u.render.w > 1.5) { color=mix(vec3f(.9,.025,.1),vec3f(1.,.65,.15),.5+.5*sin(radius)); }
  }
  var o: Out;
  o.position=vec4f(p.position.x/10.+corner.x*u.render.x*3./1024.,-p.position.z/10.+corner.y*u.render.x*3./1024.,0.,1.);
  o.local=corner;
  o.color=color*(524288./u.timing.z)*(.7+p.position.w*.6)*filaments*fade*.7;
  return o;
}
@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let p = particles[i];
  let corners = array<vec2f, 6>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(-1.,1.),vec2f(1.,-1.),vec2f(1.,1.));
  let corner = corners[v];
  let clip = u.vp*vec4f(p.position.xyz,1.);
  let next = u.vp*vec4f(p.position.xyz+p.velocity.xyz*.035,1.);
  let delta = (next.xy/max(next.w,.1)-clip.xy/max(clip.w,.1))*u.misc.xy;
  let direction = normalize(delta+vec2f(.0001,0.));
  let normal = vec2f(-direction.y,direction.x);
  let perspective = clamp(16./max(clip.w,.1),.5,2.5);
  let width = u.render.x*perspective*select(1.,.85,u.flow.w>3.5);
  let stretch = select(min(length(delta)*.35,5.) + width,width,u.flow.w>3.5);
  let offset = (direction*corner.x*stretch + normal*corner.y*width)*2./u.misc.xy;
  var o: Out;
  o.position = clip + vec4f(offset*clip.w,0.,0.);
  o.local = corner;
  let pos = p.position.xyz;
  let band = sin(pos.x*.38 + pos.z*.31 + pos.y*.45 + u.timing.y*.06)*.5+.5;
  var hot = smoothstep(.48,.9,band);
  if (u.flow.w > 3.5) {
    hot=clamp(1.-length(pos.xz)/(4.*pow(u.timing.w,.42))*.75,0.,1.);
  }
  var coldColor = vec3f(.055,.69,.66);
  var warmColor = vec3f(1.,.27,.065);
  if (u.render.w > .5 && u.render.w < 1.5) { coldColor=vec3f(.35,.12,.95); warmColor=vec3f(.15,1.,.64); }
  if (u.render.w > 1.5 && u.render.w < 2.5) { coldColor=vec3f(.9,.025,.1); warmColor=vec3f(1.,.65,.15); }
  if (u.render.w > 2.5) { coldColor=vec3f(.65,.16,.025); warmColor=vec3f(1.,.86,.6); }
  let brightness = (.65+p.position.w*.7)*(.7+min(length(p.velocity.xyz)*.12,.7));
  // Compensate density so four million particles retain color instead of clipping white.
  let density = pow(524288./u.timing.z,.68);
  let depth = exp(-max(clip.w-8.,0.)*.027);
  let fade = smoothstep(0.,1.5,p.velocity.w);
  o.color = mix(coldColor,warmColor,hot)*brightness*density*depth*.012*fade;
  // Keep the contracting tracer sample from turning into a white, overexposed blob.
  if (u.flow.w > 3.5) {
    var color=mix(vec3f(.07,.52,.57),vec3f(.025,.10,.5),smoothstep(.05,.65,hot));
    color=mix(color,vec3f(.8,.38,.09),smoothstep(.65,.94,hot));
    if(u.render.w>.5){color=mix(coldColor,warmColor,hot);}
    o.color=color*density*depth*fade*(.012+pow(p.position.w,18.)*.9);
  }
  return o;
}
@fragment fn fs(o: Out) -> @location(0) vec4f {
  let r2 = dot(o.local,o.local);
  let glow = exp(-r2*3.8)*(1.-smoothstep(.6,1.,r2));
  return vec4f(o.color*glow,1.);
}
`;

const fullscreen = /* wgsl */`
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.));
  var o: Out; o.position=vec4f(p[i],0.,1.); o.uv=p[i]*vec2f(.5,-.5)+.5; return o;
}
`;
export const blackHoleShader = common + fullscreen + /* wgsl */`
@group(0) @binding(1) var disk: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@fragment fn fs(o: Out) -> @location(0) vec4f {
  let screen = (o.uv*2.-1.)*vec2f(u.misc.x/u.misc.y,-1.);
  let focal = length(vec3f(u.vp[0].y,u.vp[1].y,u.vp[2].y));
  let forward = -normalize(cross(u.right.xyz,u.up.xyz));
  var ray = normalize(forward+(u.right.xyz*screen.x+u.up.xyz*screen.y)/focal);
  var pos = u.eye.xyz;
  let angular = cross(pos,ray);
  let h2 = dot(angular,angular);
  var light = vec3f(0.);
  var transmission = 1.;
  // Schwarzschild-inspired ray equation, rs=1. Fixed work bound, adaptive spatial steps.
  // This thin-disk approximation omits Kerr spin, frequency transport and full GR radiometry.
  for (var step=0; step<180; step++) {
    let radius = length(pos);
    if (radius < 1.02) { break; }
    if (radius > 35. && dot(pos,ray)>0.) { break; }
    let ds = clamp(radius*.075,.045,1.5);
    let accel = -1.5*h2*pos/pow(radius,5.);
    let next = pos+ray*ds+accel*(.5*ds*ds);
    let nextRadius = max(length(next),.5);
    let nextAccel = -1.5*h2*next/pow(nextRadius,5.);
    if (pos.y*next.y <= 0. && abs(pos.y-next.y) > .000001) {
      let hit = mix(pos,next,clamp(pos.y/(pos.y-next.y),0.,1.));
      let diskRadius = length(hit.xz);
      if (diskRadius > 2.5 && diskRadius < 9.) {
        let emission = textureSampleLevel(disk,linearSampler,hit.xz/20.+.5,0.).rgb;
        // Modest approaching/receding asymmetry, preserving the film's warm grading.
        let orbital = normalize(vec3f(-hit.z,0.,hit.x));
        let beaming = clamp(1.+dot(orbital,-normalize(ray))*.23,.7,1.3);
        light += emission*transmission*beaming*.18;
        transmission *= .42;
      }
    }
    ray += (accel+nextAccel)*(.5*ds);
    pos = next;
  }
  return vec4f(light,1.);
}
`;
export const downsampleShader = fullscreen + /* wgsl */`
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@fragment fn fs(o: Out) -> @location(0) vec4f {
  let texel = 1./vec2f(textureDimensions(source));
  var c = textureSample(source,linearSampler,o.uv).rgb*4.;
  c += textureSample(source,linearSampler,o.uv+texel*vec2f(-2.,-2.)).rgb;
  c += textureSample(source,linearSampler,o.uv+texel*vec2f(2.,-2.)).rgb;
  c += textureSample(source,linearSampler,o.uv+texel*vec2f(-2.,2.)).rgb;
  c += textureSample(source,linearSampler,o.uv+texel*vec2f(2.,2.)).rgb;
  c += textureSample(source,linearSampler,o.uv+texel*vec2f(-2.,0.)).rgb*2.;
  c += textureSample(source,linearSampler,o.uv+texel*vec2f(2.,0.)).rgb*2.;
  c += textureSample(source,linearSampler,o.uv+texel*vec2f(0.,-2.)).rgb*2.;
  c += textureSample(source,linearSampler,o.uv+texel*vec2f(0.,2.)).rgb*2.;
  return vec4f(c/16.,1.);
}
`;
export const blurShader = fullscreen + /* wgsl */`
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
fn blur(uv: vec2f, direction: vec2f) -> vec4f {
  let d = direction/vec2f(textureDimensions(source));
  var c = textureSample(source,linearSampler,uv).rgb*.227027;
  c += textureSample(source,linearSampler,uv+d*1.384615).rgb*.316216;
  c += textureSample(source,linearSampler,uv-d*1.384615).rgb*.316216;
  c += textureSample(source,linearSampler,uv+d*3.230769).rgb*.070270;
  c += textureSample(source,linearSampler,uv-d*3.230769).rgb*.070270;
  return vec4f(c,1.);
}
@fragment fn horizontal(o: Out) -> @location(0) vec4f { return blur(o.uv,vec2f(1.,0.)); }
@fragment fn vertical(o: Out) -> @location(0) vec4f { return blur(o.uv,vec2f(0.,1.)); }
`;
export const compositeShader = common + fullscreen + /* wgsl */`
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var bloom0: texture_2d<f32>;
@group(0) @binding(3) var bloom1: texture_2d<f32>;
@group(0) @binding(4) var bloom2: texture_2d<f32>;
@group(0) @binding(5) var bloom3: texture_2d<f32>;
@group(0) @binding(6) var bloom4: texture_2d<f32>;
@group(0) @binding(7) var linearSampler: sampler;
@fragment fn fs(o: Out) -> @location(0) vec4f {
  let uv=o.uv;
  let base = textureSample(scene,linearSampler,uv).rgb;
  let bloom = textureSample(bloom0,linearSampler,uv).rgb*.3
    + textureSample(bloom1,linearSampler,uv).rgb*.5
    + textureSample(bloom2,linearSampler,uv).rgb*.8
    + textureSample(bloom3,linearSampler,uv).rgb*1.1
    + textureSample(bloom4,linearSampler,uv).rgb*1.5;
  var bloomScale = 1.;
  if (u.flow.w > 2.5 && u.flow.w < 3.5) {
    let screen = (uv*2.-1.)*vec2f(u.misc.x/u.misc.y,-1.);
    let focal = length(vec3f(u.vp[0].y,u.vp[1].y,u.vp[2].y));
    let ray = normalize(-normalize(cross(u.right.xyz,u.up.xyz))+(u.right.xyz*screen.x+u.up.xyz*screen.y)/focal);
    let impact = length(cross(u.eye.xyz,ray));
    // Art-directed glare rejection inside the shadow; foreground disk emission survives.
    let shadow = smoothstep(2.5,2.8,impact);
    bloomScale = .4*max(shadow,smoothstep(.01,.16,length(base)));
  }
  if (u.flow.w > 3.5) { bloomScale=.22; }
  let hdr = (base + bloom*u.render.y*bloomScale)*u.render.z;
  let mapped = 1.-exp(-hdr);
  let vignette = 1.-smoothstep(.25,.85,length((uv-.5)*vec2f(1.,.85)))*.38;
  var bg = vec3f(.018,.030,.039) + vec3f(.006,.012,.012)*exp(-dot(uv-.5,uv-.5)*5.);
  if (u.flow.w > 2.5 && u.flow.w < 3.5) { bg = vec3f(.0015,.0013,.001); }
  if (u.flow.w > 3.5) { bg=vec3f(.003); }
  let grain = (random(u32(o.position.x)+u32(o.position.y)*8192u)-.5)/255.;
  return vec4f((pow(mapped,vec3f(1./2.2))+bg)*vignette+grain,1.);
}
`;
