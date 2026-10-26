import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { compileProgram, fitCanvas, getContext, interleavedBuffer, runLoop } from './webgl';

/*
 * Full-bleed fragment shader: a dot matrix (the same dotted texture as the sign-in panel) whose dots swell and
 * warm to brand red as slow noise currents pass through, and around the pointer. Decorative only.
 */

const VS = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uDpr;
uniform vec2 uMouse;
uniform float uMouseOn;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}

void main() {
  float cell = 22.0 * uDpr;
  vec2 g = gl_FragCoord.xy / cell;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 center = (id + 0.5) * cell;
  vec2 uv = center / uRes.y;

  float n = fbm(uv * 1.7 + vec2(uTime * 0.045, -uTime * 0.03));
  float current = sin(uv.x * 2.4 + uv.y * 1.3 - uTime * 0.55 + n * 5.0) * 0.5 + 0.5;
  float energy = smoothstep(0.55, 1.05, current * (0.5 + n));
  float hover = uMouseOn * exp(-length(center - uMouse) / (120.0 * uDpr));
  energy = clamp(energy + hover * 0.8, 0.0, 1.0);

  float r = mix(0.06, 0.27, energy);
  float d = length(f);
  float dotMask = smoothstep(r, r - 1.4 / cell * 1.0, d);

  vec3 quiet = vec3(0.851, 0.824, 0.808); // line-strong
  vec3 brand = vec3(0.906, 0.435, 0.459);
  vec3 col = mix(quiet, brand, smoothstep(0.25, 0.75, energy));

  // fade towards the top and bottom edges so the band blends into the page
  float y = gl_FragCoord.y / uRes.y;
  float edge = smoothstep(0.0, 0.22, y) * smoothstep(1.0, 0.78, y);
  gl_FragColor = vec4(col, dotMask * mix(0.45, 0.85, energy) * edge);
}`;

export function FlowField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas && getContext(canvas);
    if (!canvas || !gl) return; // purely decorative: without WebGL the section simply keeps its plain background

    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    try {
      program = compileProgram(gl, VS, FS);
      const quad = interleavedBuffer(gl, program, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), [['aPos', 2]]);
      buffer = quad.buffer;
      gl.useProgram(program);
      quad.bind();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);

      const u = (name: string) => gl.getUniformLocation(program!, name);
      const mouse = { x: -9999, y: -9999, on: 0, target: 0 };
      let dpr = 1;
      let prev = 0;

      const onResize = () => {
        fitCanvas(canvas, 1.5);
        dpr = canvas.width / Math.max(1, canvas.clientWidth);
        gl.viewport(0, 0, canvas.width, canvas.height);
      };
      const frame = (time: number) => {
        const dt = Math.min(0.05, Math.max(0, time - prev));
        prev = time;
        mouse.on += (mouse.target - mouse.on) * Math.min(1, dt * 4);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(u('uRes'), canvas.width, canvas.height);
        gl.uniform1f(u('uTime'), time);
        gl.uniform1f(u('uDpr'), dpr);
        gl.uniform2f(u('uMouse'), mouse.x, mouse.y);
        gl.uniform1f(u('uMouseOn'), mouse.on);
        gl.drawArrays(gl.TRIANGLES, 0, quad.count);
      };
      const stop = runLoop(canvas, frame, onResize);

      // Listen on the section (the canvas sits behind the content and ignores pointer events).
      const host = canvas.parentElement!;
      const onMove = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        mouse.x = (e.clientX - r.left) * dpr;
        mouse.y = (r.bottom - e.clientY) * dpr;
        mouse.target = 1;
      };
      const onLeave = () => (mouse.target = 0);
      host.addEventListener('pointermove', onMove);
      host.addEventListener('pointerleave', onLeave);

      return () => {
        stop();
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerleave', onLeave);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        // No loseContext(): a re-run of this effect on the same canvas (React StrictMode) would get the dead context.
      };
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[FlowField] WebGL unavailable', err);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
    }
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={cn('pointer-events-none absolute inset-0 size-full', className)} />;
}
