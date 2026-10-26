/** Minimal, dependency-free WebGL helpers shared by the homepage scenes. */

export type Mat4 = Float32Array;

export function compileProgram(gl: WebGLRenderingContext, vertexSrc: string, fragmentSrc: string): WebGLProgram {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, vertexSrc);
  const fs = shader(gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
  return program;
}

/** Creates a static buffer and wires its float attributes. `layout` maps attribute name → component count. */
export function interleavedBuffer(gl: WebGLRenderingContext, program: WebGLProgram, data: Float32Array, layout: [string, number][]) {
  const buffer = gl.createBuffer()!;
  const stride = layout.reduce((n, [, size]) => n + size, 0) * 4;
  const bind = () => {
    // Attributes left enabled by another program would otherwise be bounds-checked against this buffer.
    for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    let offset = 0;
    for (const [name, size] of layout) {
      const loc = gl.getAttribLocation(program, name);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      }
      offset += size * 4;
    }
  };
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return { buffer, bind, count: (data.length * 4) / stride };
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

/** Rotation about X (tilt) then Y (spin), column-major. */
export function rotationXY(ax: number, ay: number): Mat4 {
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
  // prettier-ignore
  return new Float32Array([
    cy, sx * sy, -cx * sy, 0,
    0, cx, sx, 0,
    sy, -sx * cy, cx * cy, 0,
    0, 0, 0, 1,
  ]);
}

/** Deterministic PRNG so the scene looks the same on every visit. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Runs `frame` on requestAnimationFrame only while the canvas is on screen and the tab is visible.
 * With reduced motion it renders a single still frame (re-rendered on resize). Returns a cleanup function.
 */
export function runLoop(canvas: HTMLCanvasElement, frame: (timeSeconds: number) => void, onResize: () => void) {
  const still = prefersReducedMotion();
  let raf = 0;
  let onScreen = true;
  let start = performance.now();
  let pausedAt = 0;

  const tick = (now: number) => {
    frame((now - start) / 1000);
    raf = requestAnimationFrame(tick);
  };
  const play = () => {
    if (still || raf || !onScreen || document.hidden) return;
    if (pausedAt) start += performance.now() - pausedAt;
    pausedAt = 0;
    raf = requestAnimationFrame(tick);
  };
  const pause = () => {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
    pausedAt = performance.now();
  };

  const resize = () => {
    onResize();
    if (still || !raf) frame(still ? 6 : (performance.now() - start) / 1000);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const io = new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    if (onScreen) play();
    else pause();
  });
  io.observe(canvas);
  const onVisibility = () => (document.hidden ? pause() : play());
  document.addEventListener('visibilitychange', onVisibility);

  resize();
  play();
  return () => {
    pause();
    ro.disconnect();
    io.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/** Matches the canvas backing store to its CSS size (pixel ratio capped for performance). Returns true if it changed. */
export function fitCanvas(canvas: HTMLCanvasElement, maxDpr = 2) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

export function getContext(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  try {
    return canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false, powerPreference: 'low-power' }) as WebGLRenderingContext | null;
  } catch {
    return null;
  }
}

export function releaseContext(gl: WebGLRenderingContext) {
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}
