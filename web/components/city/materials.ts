// Custom shader materials for the city. All colours are linear, HDR (>1) values bloom.
import * as THREE from "three";
import { COLORS, col } from "./layout";
import { MAX_RIPPLES } from "./fx";

/** Uniform objects shared by every material (mutate `.value` once per frame). */
export function makeShared() {
  return {
    uTime: { value: 0 },
    uRise: { value: 0 }, // intro clock (seconds since mount)
    uShadow: { value: 0.22 }, // shadow-city brightness
    uFlare: { value: 0 }, // reveal flare 0..1
    uInk: { value: col(COLORS.ink) },
    uFogNear: { value: 38 },
    uFogFar: { value: 110 },
  };
}
export type Shared = ReturnType<typeof makeShared>;

const NOISE = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

const SHADOW_WARP = /* glsl */ `
  #ifdef SHADOW
    wp.y = -wp.y;
    float dpt = -wp.y;
    wp.x += sin(dpt * 1.25 + uTime * 1.05 + wp.z * 0.33) * (0.05 + dpt * 0.045);
    wp.z += cos(dpt * 1.05 + uTime * 0.85 + wp.x * 0.29) * (0.03 + dpt * 0.03);
  #endif
`;

// ---------------------------------------------------------------- buildings
// Unit box with its base at y=0. Glowing edges, sparse lit windows, ground glow, fog.
const buildingVert = /* glsl */ `
uniform float uTime; uniform float uRise;
attribute float aDelay;
varying vec3 vLocal; varying vec3 vScale; varying vec3 vWorld; varying vec3 vN; varying float vSeed;
${NOISE}
void main(){
  #ifdef USE_INSTANCING
    mat4 m = modelMatrix * instanceMatrix;
  #else
    mat4 m = modelMatrix;
  #endif
  vec3 sc = vec3(length(m[0].xyz), length(m[1].xyz), length(m[2].xyz));
  vec3 origin = m[3].xyz;
  vSeed = hash12(origin.xz * 1.37 + sc.xz);
  #ifdef USE_INSTANCING
    float delay = aDelay;
  #else
    float delay = uDelay;
  #endif
  float rise = smoothstep(0.0, 1.0, clamp((uRise - delay) / 1.6, 0.0, 1.0));
  vec3 p = position;
  p.y *= max(rise, 0.002);
  vScale = vec3(sc.x, sc.y * max(rise, 0.002), sc.z);
  vLocal = position;
  vN = normal;
  vec4 wp = m * vec4(p, 1.0);
  ${SHADOW_WARP}
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const buildingFrag = /* glsl */ `
uniform float uTime; uniform vec3 uEdge; uniform vec3 uBase; uniform vec3 uWin; uniform vec3 uInk;
uniform float uIntensity; uniform float uWindows; uniform float uFogNear; uniform float uFogFar;
uniform float uShadow; uniform float uFlare; uniform float uLevel;
varying vec3 vLocal; varying vec3 vScale; varying vec3 vWorld; varying vec3 vN; varying float vSeed;
${NOISE}
void main(){
  vec3 d = vec3((0.5 - abs(vLocal.x)) * vScale.x, min(vLocal.y, 1.0 - vLocal.y) * vScale.y, (0.5 - abs(vLocal.z)) * vScale.z);
  vec3 an = abs(vN);
  float e = an.y > 0.5 ? min(d.x, d.z) : (an.x > 0.5 ? min(d.y, d.z) : min(d.x, d.y));
  float w = fwidth(e);
  float edge = 1.0 - smoothstep(0.012, 0.03 + w * 1.5, e);
  float h = vLocal.y * vScale.y;

  // buildings right in front of the lens dissolve to their edges (keeps fly-to shots clear)
  float camDist = length(vWorld - cameraPosition);
  float near = smoothstep(9.0, 20.0, camDist);
  if (near < 0.999 && edge < 0.5 && hash12(floor(gl_FragCoord.xy)) > near) discard;

  float win = 0.0;
  if (an.y < 0.5) {
    float u = an.x > 0.5 ? vLocal.z * vScale.z : vLocal.x * vScale.x;
    vec2 cell = vec2(u / 0.3, h / 0.38);
    vec2 f = fract(cell); vec2 id = floor(cell);
    float r = hash12(id + vec2(vSeed * 91.0, an.x * 7.0 + sign(vN.x + vN.z) * 3.0));
    float lit = step(0.78, r);
    float rect = step(0.22, f.x) * step(f.x, 0.78) * step(0.28, f.y) * step(f.y, 0.68);
    float band = step(0.35, h) * step(h, vScale.y - 0.25);
    win = lit * rect * band * (0.55 + 0.45 * sin(uTime * 0.35 + r * 40.0));
  }

  vec3 c = uBase;
  c += uEdge * 0.10 * exp(-h * 1.1);           // light pooling at street level
  c += uWin * win * uWindows;
  c += uEdge * edge * uIntensity;
  if (vN.y > 0.5) c += uEdge * 0.025 * uIntensity;

  #ifdef SHADOW
    float depth = clamp(-vWorld.y / 9.0, 0.0, 1.0);
    c *= (1.0 - depth * 0.75);
    c *= 0.8 + 0.2 * sin(vWorld.y * 9.0 + uTime * 1.6);
    c *= uShadow * uLevel;
    c += vec3(1.0, 0.31, 0.85) * edge * uFlare * 1.6;
  #else
    c *= uLevel;
  #endif
  float fog = smoothstep(uFogNear, uFogFar, length(vWorld - cameraPosition));
  c = mix(c, uInk, fog);
  gl_FragColor = vec4(c, 1.0);
}`;

export interface BuildingOpts {
  shadow?: boolean;
  edge: string | THREE.Color;
  base?: string;
  win?: string;
  intensity?: number;
  windows?: number;
  delay?: number;
}

export function makeBuildingMaterial(shared: Shared, o: BuildingOpts) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime, uRise: shared.uRise, uShadow: shared.uShadow, uFlare: shared.uFlare,
      uInk: shared.uInk, uFogNear: shared.uFogNear, uFogFar: shared.uFogFar,
      uEdge: { value: new THREE.Color(o.edge) },
      uBase: { value: new THREE.Color(o.base ?? (o.shadow ? "#0a0716" : "#070c18")) },
      uWin: { value: new THREE.Color(o.win ?? (o.shadow ? COLORS.shadow : COLORS.window)).multiplyScalar(0.55) },
      uIntensity: { value: o.intensity ?? 1 },
      uWindows: { value: o.windows ?? 1 },
      uLevel: { value: 1 },
      uDelay: { value: o.delay ?? 0 },
    },
    vertexShader: "uniform float uDelay;\n" + buildingVert,
    fragmentShader: buildingFrag,
    side: o.shadow ? THREE.DoubleSide : THREE.FrontSide,
    defines: o.shadow ? { SHADOW: "" } : {},
  });
  return m;
}

// ---------------------------------------------------------------- water surface
const waterVert = /* glsl */ `
varying vec3 vWorld;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;

const waterFrag = /* glsl */ `
uniform float uTime; uniform vec3 uInk; uniform vec3 uGrid; uniform vec3 uDeep; uniform float uShadow; uniform float uFlare;
uniform float uFogNear; uniform float uFogFar;
uniform vec4 uRipA[${MAX_RIPPLES}]; uniform vec4 uRipB[${MAX_RIPPLES}];
varying vec3 vWorld;
${NOISE}
float gridLine(vec2 q, float s, float wdt){
  vec2 g = abs(fract(q / s - 0.5) - 0.5) * s;
  float l = min(g.x, g.y);
  return 1.0 - smoothstep(0.0, wdt + fwidth(l) * 1.2, l);
}
void main(){
  vec2 p = vWorld.xz;
  vec3 rc = vec3(0.0); vec2 disp = vec2(0.0);
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 a = uRipA[i]; vec4 b = uRipB[i];
    float age = uTime - a.z;
    if (a.w <= 0.0 || age < 0.0 || age > 7.0) continue;
    float R = age * b.w * (1.0 - age * 0.04);
    vec2 dv = p - a.xy; float r = length(dv);
    float wdt = 0.25 + b.w * 0.05 + age * 0.35;
    float x = (r - R) / wdt;
    float life = pow(max(0.0, 1.0 - age / (2.2 + a.w * 1.2)), 1.5);
    float ring = exp(-x * x) * life;
    float x2 = (r - R * 0.62) / (wdt * 0.8);
    ring += 0.35 * exp(-x2 * x2) * life;
    float core = exp(-r * r / (0.6 + age * 2.0)) * max(0.0, 1.0 - age * 1.2) * 0.6;
    rc += b.rgb * (ring + core) * a.w;
    disp += (dv / max(r, 0.001)) * sin(x * 2.6) * exp(-x * x * 0.5) * life * 0.35 * a.w;
  }
  vec2 q = p + disp;
  q += 0.05 * vec2(sin(q.y * 0.8 + uTime * 0.6), cos(q.x * 0.7 + uTime * 0.5));

  float r0 = length(p);
  float city = 1.0 - smoothstep(24.0, 44.0, r0);
  float street = gridLine(q + vec2(1.6), 3.2, 0.03);
  float major = gridLine(q + vec2(6.4), 12.8, 0.05);
  float sheen = sin(q.x * 0.55 + uTime * 0.35 + sin(q.y * 0.4)) * sin(q.y * 0.7 - uTime * 0.28);
  float glint = pow(max(0.0, sheen), 6.0);

  vec3 c = uDeep;
  c += uGrid * (street * 0.10 + major * 0.18) * city;
  c += uGrid * glint * 0.05 * city;
  // the shadow city breathes through the surface
  c += vec3(0.42, 0.18, 0.75) * 0.05 * uShadow * city;
  c += rc;

  vec3 V = normalize(cameraPosition - vWorld);
  float graze = 1.0 - clamp(V.y, 0.0, 1.0);
  float alpha = mix(0.55, 0.3, graze) - uFlare * 0.15;
  alpha = max(alpha, 0.18) + length(rc) * 0.2;

  float fog = smoothstep(uFogNear, uFogFar, length(vWorld - cameraPosition));
  c = mix(c, uInk, fog);
  alpha = mix(alpha, 1.0, fog);
  gl_FragColor = vec4(c, clamp(alpha, 0.0, 1.0));
}`;

export function makeWaterMaterial(shared: Shared) {
  const ripA = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0));
  const ripB = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, 0, 1));
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime, uInk: shared.uInk, uShadow: shared.uShadow, uFlare: shared.uFlare,
      uFogNear: shared.uFogNear, uFogFar: shared.uFogFar,
      uGrid: { value: col(COLORS.real) },
      uDeep: { value: col("#03050b") },
      uRipA: { value: ripA },
      uRipB: { value: ripB },
    },
    vertexShader: waterVert,
    fragmentShader: waterFrag,
    transparent: true,
    depthWrite: false,
  });
}

// ---------------------------------------------------------------- net threads (tubes)
const linkVert = /* glsl */ `
uniform float uTime;
varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  ${SHADOW_WARP}
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const linkFrag = /* glsl */ `
uniform float uTime; uniform vec3 uColor; uniform vec3 uAlt; uniform float uAltMix; uniform float uLevel;
uniform float uCut; uniform float uDraw; uniform float uSeed; uniform float uShadow; uniform float uFlare;
uniform vec3 uInk; uniform float uFogNear; uniform float uFogFar;
varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW;
void main(){
  float u = vUv.x;
  if (u > uDraw) discard;
  float pulse = pow(fract(u * 1.5 - uTime * 0.16 + uSeed), 14.0) * 2.2;
  pulse += pow(fract(-u * 1.0 - uTime * 0.11 + uSeed * 3.1), 18.0) * 1.2;
  float ends = smoothstep(0.0, 0.03, u) * smoothstep(1.0, 0.97, u);
  float head = smoothstep(uDraw - 0.04, uDraw, u) * step(uDraw, 0.999) * 3.0;
  // cut: the middle burns away, leaving amber stubs
  float gapHalf = uCut * 0.38;
  float gap = smoothstep(gapHalf - 0.015, gapHalf + 0.015, abs(u - 0.5));
  float ember = uCut > 0.01 ? exp(-pow((abs(u - 0.5) - gapHalf) / 0.02, 2.0)) * 2.5 : 0.0;
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = 0.55 + 0.45 * abs(dot(V, vNormalW));
  vec3 c = mix(uColor, uAlt, uAltMix);
  vec3 outc = c * (0.55 + pulse + head) * rim * ends * gap * uLevel;
  outc += uAlt * ember * uLevel;
  #ifdef SHADOW
    outc *= uShadow;
    outc += vec3(1.0, 0.31, 0.85) * uFlare * 0.8 * ends;
  #endif
  float fog = smoothstep(uFogNear, uFogFar, length(vWorld - cameraPosition));
  gl_FragColor = vec4(outc * (1.0 - fog), 1.0);
}`;

export function makeLinkMaterial(shared: Shared, o: { shadow?: boolean; color: THREE.ColorRepresentation; seed: number }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime, uShadow: shared.uShadow, uFlare: shared.uFlare, uInk: shared.uInk,
      uFogNear: shared.uFogNear, uFogFar: shared.uFogFar,
      uColor: { value: new THREE.Color(o.color) },
      uAlt: { value: col(COLORS.alert).multiplyScalar(1.4) },
      uAltMix: { value: 0 },
      uLevel: { value: 1 },
      uCut: { value: 0 },
      uDraw: { value: 0 },
      uSeed: { value: o.seed },
    },
    vertexShader: linkVert,
    fragmentShader: linkFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    defines: o.shadow ? { SHADOW: "" } : {},
  });
}

// ---------------------------------------------------------------- status ring (flat on the water)
const ringVert = /* glsl */ `
varying vec2 vP; varying vec3 vWorld;
void main(){ vP = position.xy; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;

const ringFrag = /* glsl */ `
uniform float uTime; uniform vec3 uColor; uniform float uR; uniform float uLevel; uniform float uPulse; uniform float uSpin;
uniform float uFogNear; uniform float uFogFar;
varying vec2 vP; varying vec3 vWorld;
void main(){
  float r = length(vP);
  float a = atan(vP.y, vP.x);
  float pulse = 1.0 + uPulse * (0.6 + 0.6 * sin(uTime * 5.0));
  float band = exp(-pow((r - uR) / 0.045, 2.0));
  float glow = exp(-pow((r - uR) / 0.5, 2.0)) * 0.22;
  float r2 = uR + 0.38;
  float tickMask = exp(-pow((r - r2) / 0.07, 2.0));
  float ticks = step(0.55, fract(a * 36.0 / 6.28318 + uTime * 0.04 * uSpin)) * tickMask * 0.9;
  float r3 = uR + 0.8;
  float arcMask = exp(-pow((r - r3) / 0.03, 2.0));
  float arcs = smoothstep(0.0, 0.05, sin(a * 3.0 - uTime * 0.5 * uSpin) - 0.55) * arcMask * 0.9;
  // inner wash from the tower
  float wash = exp(-r * r / (uR * uR * 0.6)) * 0.18;
  vec3 c = uColor * (band * 1.5 + glow + ticks + arcs + wash) * uLevel * pulse;
  float fog = smoothstep(uFogNear, uFogFar, length(vWorld - cameraPosition));
  gl_FragColor = vec4(c * (1.0 - fog), 1.0);
}`;

export function makeRingMaterial(shared: Shared, radius: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime, uFogNear: shared.uFogNear, uFogFar: shared.uFogFar,
      uColor: { value: col(COLORS.real) },
      uR: { value: radius },
      uLevel: { value: 1 },
      uPulse: { value: 0 },
      uSpin: { value: 1 },
    },
    vertexShader: ringVert,
    fragmentShader: ringFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------- quarantine shield / beacon beam
const shellVert = /* glsl */ `
varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW;
void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vNormalW = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`;

const shieldFrag = /* glsl */ `
uniform float uTime; uniform vec3 uColor; uniform float uLevel;
varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW;
void main(){
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(V, vNormalW)), 2.0);
  float scan = pow(fract(vUv.y * 9.0 - uTime * 0.6), 10.0);
  float hex = step(0.92, fract(vUv.x * 48.0)) * 0.4 + step(0.95, fract(vUv.y * 14.0)) * 0.3;
  float fade = smoothstep(1.0, 0.55, vUv.y) * smoothstep(0.0, 0.04, vUv.y);
  vec3 c = uColor * (fres * 0.55 + scan * 0.25 + hex * 0.2 + 0.015) * fade * uLevel;
  gl_FragColor = vec4(c, 1.0);
}`;

export function makeShieldMaterial(shared: Shared) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uColor: { value: col(COLORS.alert).multiplyScalar(0.9) }, uLevel: { value: 0 } },
    vertexShader: shellVert,
    fragmentShader: shieldFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

const beamFrag = /* glsl */ `
uniform float uTime; uniform vec3 uColor; uniform float uLevel;
varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW;
void main(){
  vec3 V = normalize(cameraPosition - vWorld);
  float core = pow(abs(dot(V, vNormalW)), 3.0);
  float fade = pow(1.0 - vUv.y, 2.2);
  float flick = 0.85 + 0.15 * sin(uTime * 2.0 + vUv.y * 20.0 - uTime * 6.0);
  gl_FragColor = vec4(uColor * core * fade * flick * uLevel, 1.0);
}`;

export function makeBeamMaterial(shared: Shared, color: string) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uColor: { value: col(color) }, uLevel: { value: 0.6 } },
    vertexShader: shellVert,
    fragmentShader: beamFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------- sky dome
const skyFrag = /* glsl */ `
uniform vec3 uInk; uniform float uShadow; uniform float uFlare; uniform float uTime;
varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW;
${NOISE}
void main(){
  vec3 dir = normalize(vWorld);
  float y = dir.y;
  vec3 c = uInk;
  // horizon haze: teal above, violet below the waterline
  c += vec3(0.02, 0.07, 0.09) * exp(-abs(y) * 9.0) * step(0.0, y);
  c += vec3(0.05, 0.02, 0.09) * exp(-abs(y) * 12.0) * (1.0 - step(0.0, y)) * (0.3 + uShadow * 0.5);
  c += vec3(0.25, 0.06, 0.22) * exp(-abs(y) * 5.0) * uFlare * 0.6;
  // sparse stars
  vec2 sp = vec2(atan(dir.z, dir.x) * 80.0, y * 160.0);
  float s = hash12(floor(sp));
  float star = step(0.9965, s) * smoothstep(0.03, 0.25, y) * (0.5 + 0.5 * sin(uTime * 1.3 + s * 80.0));
  c += vec3(0.6, 0.8, 1.0) * star * 0.5;
  gl_FragColor = vec4(c, 1.0);
}`;

export function makeSkyMaterial(shared: Shared) {
  return new THREE.ShaderMaterial({
    uniforms: { uInk: shared.uInk, uShadow: shared.uShadow, uFlare: shared.uFlare, uTime: shared.uTime },
    vertexShader: shellVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
  });
}
