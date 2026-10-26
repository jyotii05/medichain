import { compileProgram, fitCanvas, getContext, interleavedBuffer, perspective, releaseContext } from '../webgl';
import { hex, MAX_CHAINS, STAGE_COLORS } from './scene';
import { BURST_DURATION, FOV, perChain, type GlobeSim } from './sim';

export interface GlobeRenderer {
  resize(): void;
  draw(): void;
  dispose(): void;
}

// Vertex shaders use highp: burst distances on the sphere are small and mediump would band them.
const VS_HEAD = `
precision highp float;
uniform mat4 uProj;
uniform mat4 uRot;
uniform float uTime;
uniform float uScale;
uniform float uDist;
vec4 project(vec3 p) { return uProj * vec4(p.xy, p.z - uDist, 1.0); }
float facing(vec3 p) { return smoothstep(-0.45, 0.55, p.z); }
`;

const DOTS_VS = `${VS_HEAD}
attribute vec3 aPos;
attribute float aLand;
attribute float aSeed;
uniform vec4 uBurst[${MAX_CHAINS}]; // xyz = pharmacy, w = effect age (< 0 when idle)
varying float vAlpha;
varying float vLand;
varying float vRing;
varying float vArea;
void main() {
  vec3 p = (uRot * vec4(aPos, 1.0)).xyz;
  float f = facing(p);
  float ring = 0.0;
  float area = 0.0;
  for (int i = 0; i < ${MAX_CHAINS}; i++) {
    vec4 b = uBurst[i];
    if (b.w < 0.0) continue;
    float d = length(aPos - b.xyz);
    float wave = 0.3 * (1.0 - exp(-b.w * 2.0));                       // shockwave front, easing out
    float front = (d - wave) / 0.02;
    ring = max(ring, exp(-front * front) * (1.0 - smoothstep(1.2, 3.4, b.w)));
    area = max(area, (1.0 - smoothstep(wave * 0.55, wave + 0.012, d)) * (1.0 - smoothstep(2.4, 3.6, b.w)));
  }
  float twinkle = 0.86 + 0.14 * sin(uTime * 1.3 + aSeed * 6.2831);
  float base = (aLand > 0.5 ? mix(0.07, 0.82, f) : mix(0.03, 0.32, f)) * twinkle;
  float glow = max(ring, area * 0.85);
  vAlpha = mix(base, mix(0.15, 1.0, f), glow);
  vLand = aLand;
  vRing = ring;
  vArea = area;
  gl_Position = project(p);
  gl_PointSize = (aLand > 0.5 ? 2.5 : 1.7) * uScale * (0.72 + 0.4 * f) * (1.0 + 1.3 * ring + 0.55 * area);
}`;

const DOTS_FS = `
precision mediump float;
varying float vAlpha;
varying float vLand;
varying float vRing;
varying float vArea;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  vec3 col = mix(vec3(0.55, 0.52, 0.5), vec3(0.2), vLand);
  col = mix(col, vec3(0.13, 0.53, 0.33), vArea * 0.85);   // local area: success green
  col = mix(col, vec3(0.906, 0.435, 0.459), vRing);      // shockwave: brand red
  gl_FragColor = vec4(col, vAlpha * smoothstep(0.5, 0.3, d));
}`;

const ROUTES_VS = `${VS_HEAD}
attribute vec3 aPos;
attribute float aU;
attribute float aChain;
uniform float uHead[${MAX_CHAINS}];
uniform float uFocus;
uniform float uHover;
varying float vTrail;
varying float vHead;
varying float vFacing;
varying float vEmph;
void main() {
  vec3 p = (uRot * vec4(aPos, 1.0)).xyz;
  float d = uHead[int(aChain + 0.5)] - aU;
  vTrail = d >= 0.0 ? exp(-d * 7.0) : 0.0;
  vHead = 1.0 - smoothstep(0.0, 0.03, abs(d));
  vFacing = facing(p);
  float mine = 1.0 - step(0.5, abs(aChain - uFocus));
  float hov = 1.0 - step(0.5, abs(aChain - uHover));
  vEmph = uFocus < 0.0 ? 1.0 + 0.7 * hov : mix(0.3, 1.8, mine);
  gl_Position = project(p);
  gl_PointSize = uScale * (2.0 + 2.0 * vTrail + 7.0 * vHead) * (0.75 + 0.35 * vFacing) * (1.0 + 0.3 * clamp(vEmph - 1.0, 0.0, 1.0));
}`;

const ROUTES_FS = `
precision mediump float;
uniform vec3 uBrand;
uniform vec3 uBrandInk;
varying float vTrail;
varying float vHead;
varying float vFacing;
varying float vEmph;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float disc = mix(smoothstep(0.5, 0.25, d), smoothstep(0.5, 0.0, d), vHead);
  float a = (0.38 + 0.62 * max(vTrail, vHead)) * mix(0.12, 1.0, vFacing) * vEmph;
  gl_FragColor = vec4(mix(uBrand, uBrandInk, vTrail * 0.7), min(1.0, a) * disc);
}`;

const LOCAL_VS = `${VS_HEAD}
attribute vec3 aPos;
attribute float aU;
attribute float aChain;
attribute float aKind;
uniform float uAge[${MAX_CHAINS}];
varying float vA;
varying float vKind;
varying float vRing;
void main() {
  vec3 p = (uRot * vec4(aPos, 1.0)).xyz;
  float age = uAge[int(aChain + 0.5)];
  float on = age < 0.0 ? 0.0 : 1.0;
  float reveal = clamp((age - 0.2) * 1.5, 0.0, 1.0);                  // spokes grow out after the flash
  float fade = 1.0 - smoothstep(2.6, 3.5, age);
  float shown = aKind > 0.5 ? step(0.999, reveal) : step(aU, reveal);
  float tip = aKind > 0.5 ? 0.0 : 1.0 - smoothstep(0.0, 0.1, abs(reveal - aU));
  float f = facing(p);
  vA = on * shown * fade * mix(0.1, 1.0, f);
  vKind = aKind;
  vRing = fract(uTime * 0.9 + aPos.x * 7.0);
  gl_Position = project(p);
  gl_PointSize = on * shown * uScale * (aKind > 0.5 ? 20.0 : 1.9 + 3.5 * tip) * (0.7 + 0.4 * f);
}`;

const LOCAL_FS = `
precision mediump float;
varying float vA;
varying float vKind;
varying float vRing;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  vec3 green = vec3(0.13, 0.53, 0.33);
  if (vKind < 0.5) {
    gl_FragColor = vec4(green, vA * smoothstep(0.5, 0.25, d));
  } else {
    float core = smoothstep(0.17, 0.12, d);
    float halo = smoothstep(0.25, 0.19, d) * (1.0 - core);
    float r = mix(0.18, 0.48, vRing);
    float ring = (1.0 - smoothstep(0.0, 0.035, abs(d - r))) * (1.0 - vRing) * 0.8;
    gl_FragColor = vec4(mix(green, vec3(1.0), halo), vA * max(max(core, halo), ring));
  }
}`;

const HUBS_VS = `${VS_HEAD}
attribute vec3 aPos;
attribute vec3 aColor;
attribute float aSeed;
attribute float aChain;
attribute float aIndex;
attribute float aStage;
uniform float uFocus;
uniform float uHoverHub;
uniform float uAge[${MAX_CHAINS}];
varying vec3 vColor;
varying float vRing;
varying float vVis;
void main() {
  vec3 p = (uRot * vec4(aPos * 1.004, 1.0)).xyz;
  float mine = uFocus < 0.0 ? 1.0 : mix(0.3, 1.0, 1.0 - step(0.5, abs(aChain - uFocus)));
  float hov = 1.0 - step(0.5, abs(aIndex - uHoverHub));
  float age = uAge[int(aChain + 0.5)];
  float pop = (aStage > 2.5 && age >= 0.0 && age < 0.6) ? sin(3.14159 * age / 0.6) : 0.0;  // pharmacy bounces on arrival
  vColor = aColor;
  vRing = fract(uTime * 0.42 + aSeed);
  vVis = mix(0.1, 1.0, facing(p)) * mine;
  gl_Position = project(p);
  gl_PointSize = 32.0 * uScale * (0.65 + 0.4 * facing(p)) * (1.0 + 0.5 * hov + 0.9 * pop);
}`;

const HUBS_FS = `
precision mediump float;
varying vec3 vColor;
varying float vRing;
varying float vVis;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float core = smoothstep(0.15, 0.11, d);
  float halo = smoothstep(0.2, 0.15, d) * (1.0 - core);
  float r = mix(0.16, 0.48, vRing);
  float ring = (1.0 - smoothstep(0.0, 0.025, abs(d - r))) * (1.0 - vRing) * 0.85;
  gl_FragColor = vec4(mix(vColor, vec3(1.0), halo), max(max(core, halo), ring) * vVis);
}`;

const FLASH_VS = `${VS_HEAD}
attribute vec3 aPos;
attribute float aChain;
uniform float uAge[${MAX_CHAINS}];
varying float vA;
void main() {
  vec3 p = (uRot * vec4(aPos * 1.006, 1.0)).xyz;
  float age = uAge[int(aChain + 0.5)];
  float on = (age >= 0.0 && age < 0.9) ? 1.0 : 0.0;
  float t = clamp(age / 0.9, 0.0, 1.0);
  vA = on * pow(1.0 - t, 1.4) * mix(0.15, 1.0, facing(p));
  gl_Position = project(p);
  gl_PointSize = on * uScale * mix(16.0, 170.0, 1.0 - pow(1.0 - t, 3.0));
}`;

const FLASH_FS = `
precision mediump float;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float glow = smoothstep(0.5, 0.0, d);
  float ring = 1.0 - smoothstep(0.0, 0.045, abs(d - 0.45));
  vec3 col = mix(vec3(1.0, 0.93, 0.9), vec3(0.906, 0.435, 0.459), smoothstep(0.0, 0.35, d));
  gl_FragColor = vec4(col, vA * max(glow * glow, ring * 0.85));
}`;

export function createWebGLRenderer(canvas: HTMLCanvasElement, sim: GlobeSim): GlobeRenderer {
  const gl = getContext(canvas);
  if (!gl) throw new Error('WebGL is not available');
  const { scene } = sim;
  const programs: WebGLProgram[] = [];
  const buffers: WebGLBuffer[] = [];
  try {
    const make = (vs: string, fs: string) => {
      const p = compileProgram(gl, vs, fs);
      programs.push(p);
      return p;
    };
    const dotsP = make(DOTS_VS, DOTS_FS);
    const routesP = make(ROUTES_VS, ROUTES_FS);
    const localP = make(LOCAL_VS, LOCAL_FS);
    const hubsP = make(HUBS_VS, HUBS_FS);
    const flashP = make(FLASH_VS, FLASH_FS);

    const hubData = new Float32Array(scene.hubs.flatMap((h, i) => [...h.pos, ...hex(STAGE_COLORS[h.stage]), h.seed, h.chain, i, h.stage]));
    const flashData = new Float32Array(scene.chains.flatMap((c, i) => [...scene.hubs[c.hubs[c.hubs.length - 1]].pos, i]));
    const dots = interleavedBuffer(gl, dotsP, scene.dots, [['aPos', 3], ['aLand', 1], ['aSeed', 1]]);
    const routes = interleavedBuffer(gl, routesP, scene.routes, [['aPos', 3], ['aU', 1], ['aChain', 1]]);
    const local = interleavedBuffer(gl, localP, scene.local, [['aPos', 3], ['aU', 1], ['aChain', 1], ['aKind', 1]]);
    const hubs = interleavedBuffer(gl, hubsP, hubData, [['aPos', 3], ['aColor', 3], ['aSeed', 1], ['aChain', 1], ['aIndex', 1], ['aStage', 1]]);
    const flash = interleavedBuffer(gl, flashP, flashData, [['aPos', 3], ['aChain', 1]]);
    buffers.push(dots.buffer, routes.buffer, local.buffer, hubs.buffer, flash.buffer);

    gl.useProgram(routesP);
    gl.uniform3fv(gl.getUniformLocation(routesP, 'uBrand'), hex('#E76F75'));
    gl.uniform3fv(gl.getUniformLocation(routesP, 'uBrandInk'), hex('#B5444C'));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL setup failed');

    const loc = new Map<string, WebGLUniformLocation | null>();
    const u = (p: WebGLProgram, name: string) => {
      const key = `${programs.indexOf(p)}:${name}`;
      if (!loc.has(key)) loc.set(key, gl.getUniformLocation(p, name));
      return loc.get(key)!;
    };

    const pharmacies = scene.chains.map((c) => scene.hubs[c.hubs[c.hubs.length - 1]].pos);
    const burst = new Float32Array(MAX_CHAINS * 4);
    const heads = new Float32Array(MAX_CHAINS);
    const ages = new Float32Array(MAX_CHAINS);
    let proj = perspective(FOV, 1, 0.1, 10);
    let scale = 1;

    return {
      resize() {
        fitCanvas(canvas);
        gl.viewport(0, 0, canvas.width, canvas.height);
        proj = perspective(FOV, canvas.width / canvas.height, 0.1, 10);
        scale = Math.min(1.6, Math.max(0.55, canvas.height / 640));
        sim.setSize(canvas.clientWidth, canvas.clientHeight);
      },
      draw() {
        perChain(sim, (c) => sim.head(c), heads);
        perChain(sim, (c) => sim.burstAge(c), ages);
        for (let i = 0; i < MAX_CHAINS; i++) {
          const p = pharmacies[i];
          burst.set(p ? [p[0], p[1], p[2], ages[i] < BURST_DURATION ? ages[i] : -1] : [0, 0, 0, -1], i * 4);
        }
        gl.clear(gl.COLOR_BUFFER_BIT);
        const common = (p: WebGLProgram) => {
          gl.useProgram(p);
          gl.uniformMatrix4fv(u(p, 'uProj'), false, proj);
          gl.uniformMatrix4fv(u(p, 'uRot'), false, sim.rot);
          gl.uniform1f(u(p, 'uTime'), sim.clock);
          gl.uniform1f(u(p, 'uScale'), scale);
          gl.uniform1f(u(p, 'uDist'), sim.dist);
        };
        common(dotsP);
        gl.uniform4fv(u(dotsP, 'uBurst'), burst);
        dots.bind();
        gl.drawArrays(gl.POINTS, 0, dots.count);

        common(routesP);
        gl.uniform1fv(u(routesP, 'uHead'), heads);
        gl.uniform1f(u(routesP, 'uFocus'), sim.selected);
        gl.uniform1f(u(routesP, 'uHover'), sim.hoverHub >= 0 ? scene.hubs[sim.hoverHub].chain : -1);
        routes.bind();
        gl.drawArrays(gl.POINTS, 0, routes.count);

        common(localP);
        gl.uniform1fv(u(localP, 'uAge'), ages);
        local.bind();
        gl.drawArrays(gl.POINTS, 0, local.count);

        common(hubsP);
        gl.uniform1f(u(hubsP, 'uFocus'), sim.selected);
        gl.uniform1f(u(hubsP, 'uHoverHub'), sim.hoverHub);
        gl.uniform1fv(u(hubsP, 'uAge'), ages);
        hubs.bind();
        gl.drawArrays(gl.POINTS, 0, hubs.count);

        common(flashP);
        gl.uniform1fv(u(flashP, 'uAge'), ages);
        flash.bind();
        gl.drawArrays(gl.POINTS, 0, flash.count);
      },
      dispose() {
        buffers.forEach((b) => gl.deleteBuffer(b));
        programs.forEach((p) => gl.deleteProgram(p));
        // No loseContext(): React may re-run the effect on the same canvas (StrictMode in development) and
        // getContext() would then return the dead context. The browser frees it with the canvas.
      },
    };
  } catch (err) {
    buffers.forEach((b) => gl.deleteBuffer(b));
    programs.forEach((p) => gl.deleteProgram(p));
    releaseContext(gl); // this canvas is being replaced by the fallback renderer
    throw err;
  }
}
