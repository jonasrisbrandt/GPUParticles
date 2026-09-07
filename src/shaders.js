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
  if (u.flow.w > 1.5) {
    let x = (random(seed + 5u)*2.-1.)*7.;
    let strand = f32(i % 5u)*TAU/5.;
    pos = vec3f(x, sin(x*.65 + strand)*1.5 + cos(b)*r*.3, cos(x*.65 + strand)*1.5 + sin(b)*r*.3);
  }
  var p: Particle;
  p.position = vec4f(pos, random(seed + 6u));
  p.velocity = vec4f(0.,0.,0.,random(seed + 7u)*22. + 8.);
  return p;
}
@compute @workgroup_size(256) fn init(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(u.timing.z)) { return; }
  particles[id.x] = spawn(id.x, 0u);
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
  if (u.flow.w > 1.5) {
    let phase = pos.x*.65 + f32(i % 5u)*TAU/5.;
    let center = vec3f(pos.x, sin(phase)*1.5, cos(phase)*1.5);
    flowVelocity = vec3f(2.5, cos(phase)*2.44, -sin(phase)*2.44) - (pos-center)*1.25;
  }
  flowVelocity += curl(pos,t)*u.flow.x*1.15;
  var vel = mix(p.velocity.xyz, flowVelocity, 1.-exp(-dt*2.4));
  let delta = u.pointer.xyz - pos;
  let d2 = dot(delta, delta);
  let falloff = exp(-d2/10.);
  vel += (delta*u.pointer.w*3.8 + cross(u.eye.xyz-u.pointer.xyz, -delta)*abs(u.pointer.w)*.08)*falloff*u.flow.z*dt;
  vel += normalize(pos+vec3f(.001))*u.misc.z*11.;
  vel *= min(1., 16./max(length(vel),.001));
  p.position = vec4f(pos+vel*dt, p.position.w);
  p.velocity = vec4f(vel,p.velocity.w-dt);
  if (u.flow.w > 1.5 && p.position.x > 7.5) { p.position.x -= 15.; }
  if (p.velocity.w <= 0. || length(p.position.xyz) > 24.) {
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
  let width = u.render.x*perspective;
  let stretch = min(length(delta)*.35,5.) + width;
  let offset = (direction*corner.x*stretch + normal*corner.y*width)*2./u.misc.xy;
  var o: Out;
  o.position = clip + vec4f(offset*clip.w,0.,0.);
  o.local = corner;
  let pos = p.position.xyz;
  let band = sin(pos.x*.38 + pos.z*.31 + pos.y*.45 + u.timing.y*.06)*.5+.5;
  let hot = smoothstep(.48,.9,band);
  var coldColor = vec3f(.055,.69,.66);
  var warmColor = vec3f(1.,.27,.065);
  if (u.render.w > .5 && u.render.w < 1.5) { coldColor=vec3f(.35,.12,.95); warmColor=vec3f(.15,1.,.64); }
  if (u.render.w > 1.5) { coldColor=vec3f(.9,.025,.1); warmColor=vec3f(1.,.65,.15); }
  let brightness = (.65+p.position.w*.7)*(.7+min(length(p.velocity.xyz)*.12,.7));
  // Compensate density so four million particles retain color instead of clipping white.
  let density = pow(524288./u.timing.z,.68);
  let depth = exp(-max(clip.w-8.,0.)*.027);
  let fade = smoothstep(0.,1.5,p.velocity.w);
  o.color = mix(coldColor,warmColor,hot)*brightness*density*depth*.012*fade;
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
  let hdr = (base + bloom*u.render.y)*u.render.z;
  let mapped = 1.-exp(-hdr);
  let vignette = 1.-smoothstep(.25,.85,length((uv-.5)*vec2f(1.,.85)))*.38;
  let bg = vec3f(.018,.030,.039) + vec3f(.006,.012,.012)*exp(-dot(uv-.5,uv-.5)*5.);
  let grain = (random(u32(o.position.x)+u32(o.position.y)*8192u)-.5)/255.;
  return vec4f((pow(mapped,vec3f(1./2.2))+bg)*vignette+grain,1.);
}
`;
