import { fitCanvas } from '../webgl';
import { hex, STAGE_COLORS } from './scene';
import type { GlobeRenderer } from './renderWebGL';
import type { GlobeSim } from './sim';

/*
 * Canvas 2D renderer: the same scene, effects and interaction as the WebGL renderer, computed on the CPU.
 * Used when WebGL is unavailable (hardware acceleration off, blocked drivers, some VMs).
 * Quiet dots are batched into ~20 fills per frame; only lit or moving elements are drawn one by one.
 */

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
const mixRgb = (a: number[], b: number[], t: number) => [0, 1, 2].map((i) => mix(a[i], b[i], t));

const BRAND = hex('#E76F75');
const BRAND_INK = hex('#B5444C');
const GREEN = [0.13, 0.53, 0.33];
const LAND = [0.2, 0.2, 0.2];
const SEA = [0.55, 0.52, 0.5];
const BUCKETS = 10;
const TAU = Math.PI * 2;

export function createCanvasRenderer(canvas: HTMLCanvasElement, sim: GlobeSim): GlobeRenderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  const { scene } = sim;
  const nDots = scene.dots.length / 5;
  const nRoutes = scene.routes.length / 5;
  const nLocal = scene.local.length / 6;
  const buckets = Array.from({ length: 2 * BUCKETS }, () => [] as number[]);
  const hubRgb = scene.hubs.map((h) => rgb(hex(STAGE_COLORS[h.stage])));
  const pharmacies = scene.chains.map((c) => scene.hubs[c.hubs[c.hubs.length - 1]].pos);
  let dpr = 1;
  let scale = 1;

  const disc = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.3, r), 0, TAU);
    ctx.fill();
  };

  return {
    resize() {
      fitCanvas(canvas);
      dpr = canvas.width / Math.max(1, canvas.clientWidth);
      scale = Math.min(1.6, Math.max(0.55, canvas.height / 640));
      sim.setSize(canvas.clientWidth, canvas.clientHeight);
    },
    draw() {
      const p = [0, 0, 0];
      // project in CSS px, draw in device px
      const proj = (x: number, y: number, z: number) => {
        sim.project(x, y, z, p);
        p[0] *= dpr;
        p[1] *= dpr;
        return p;
      };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const ages = scene.chains.map((_, c) => sim.burstAge(c));
      const active = ages.map((a, c) => ({ a, c })).filter((b) => b.a >= 0);
      const focus = sim.selected;
      const hoverChain = sim.hoverHub >= 0 ? scene.hubs[sim.hoverHub].chain : -1;

      // ---- dots: quiet ones batched by colour and alpha, lit ones drawn individually
      for (const b of buckets) b.length = 0;
      const lit: number[] = [];
      for (let i = 0; i < nDots; i++) {
        const o = i * 5;
        const x = scene.dots[o], y = scene.dots[o + 1], z = scene.dots[o + 2];
        const isLand = scene.dots[o + 3] > 0.5;
        let ring = 0, area = 0;
        for (const { a, c } of active) {
          const q = pharmacies[c];
          const d = Math.hypot(x - q[0], y - q[1], z - q[2]);
          if (d > 0.36) continue;
          const wave = 0.3 * (1 - Math.exp(-a * 2));
          const front = (d - wave) / 0.02;
          ring = Math.max(ring, Math.exp(-front * front) * (1 - smoothstep(1.2, 3.4, a)));
          area = Math.max(area, (1 - smoothstep(wave * 0.55, wave + 0.012, d)) * (1 - smoothstep(2.4, 3.6, a)));
        }
        proj(x, y, z);
        const f = smoothstep(-0.45, 0.55, p[2]);
        const twinkle = 0.86 + 0.14 * Math.sin(sim.clock * 1.3 + scene.dots[o + 4] * 6.2831);
        const base = (isLand ? mix(0.07, 0.82, f) : mix(0.03, 0.32, f)) * twinkle;
        const glow = Math.max(ring, area * 0.85);
        const size = (isLand ? 2.5 : 1.7) * scale * (0.72 + 0.4 * f) * 0.72;
        if (glow > 0.04) {
          lit.push(p[0], p[1], size * (1 + 1.3 * ring + 0.55 * area), mix(base, mix(0.15, 1, f), glow), isLand ? 1 : 0, ring, area);
        } else {
          buckets[(isLand ? 0 : BUCKETS) + Math.min(BUCKETS - 1, Math.floor(base * BUCKETS))].push(p[0] - size / 2, p[1] - size / 2, size);
        }
      }
      buckets.forEach((list, k) => {
        if (!list.length) return;
        ctx.globalAlpha = ((k % BUCKETS) + 0.5) / BUCKETS;
        ctx.fillStyle = rgb(k < BUCKETS ? LAND : SEA);
        ctx.beginPath();
        for (let j = 0; j < list.length; j += 3) ctx.rect(list[j], list[j + 1], list[j + 2], list[j + 2]);
        ctx.fill();
      });
      for (let j = 0; j < lit.length; j += 7) {
        const [x, y, s, a, isLand, ring, area] = lit.slice(j, j + 7);
        let col = mixRgb(isLand ? LAND : SEA, GREEN, area * 0.85);
        col = mixRgb(col, BRAND, ring);
        ctx.globalAlpha = a;
        ctx.fillStyle = rgb(col);
        disc(x, y, s / 2);
      }

      // ---- long-haul routes
      const quiet: number[][] = [[], [], []];
      const moving: number[] = [];
      for (let i = 0; i < nRoutes; i++) {
        const o = i * 5;
        const c = scene.routes[o + 4];
        const d = sim.head(c) - scene.routes[o + 3];
        const trail = d >= 0 ? Math.exp(-d * 7) : 0;
        const head = 1 - smoothstep(0, 0.03, Math.abs(d));
        proj(scene.routes[o], scene.routes[o + 1], scene.routes[o + 2]);
        const f = smoothstep(-0.45, 0.55, p[2]);
        const emph = focus < 0 ? 1 + (c === hoverChain ? 0.7 : 0) : c === focus ? 1.8 : 0.3;
        if (trail < 0.03 && head < 0.03 && emph === 1) {
          const s = scale * 2 * (0.75 + 0.35 * f);
          quiet[f > 0.66 ? 2 : f > 0.33 ? 1 : 0].push(p[0] - s / 2, p[1] - s / 2, s);
        } else {
          moving.push(p[0], p[1], f, trail, head, emph);
        }
      }
      ctx.fillStyle = rgb(BRAND);
      quiet.forEach((list, band) => {
        if (!list.length) return;
        ctx.globalAlpha = 0.38 * mix(0.12, 1, (band + 0.5) / 3);
        ctx.beginPath();
        for (let j = 0; j < list.length; j += 3) ctx.rect(list[j], list[j + 1], list[j + 2], list[j + 2]);
        ctx.fill();
      });
      for (let j = 0; j < moving.length; j += 6) {
        const [x, y, f, trail, head, emph] = moving.slice(j, j + 6);
        ctx.globalAlpha = Math.min(1, (0.38 + 0.62 * Math.max(trail, head)) * mix(0.12, 1, f) * emph);
        ctx.fillStyle = rgb(mixRgb(BRAND, BRAND_INK, trail * 0.7));
        disc(x, y, (scale * (2 + 2 * trail + 7 * head) * (0.75 + 0.35 * f) * (1 + 0.3 * Math.min(1, Math.max(0, emph - 1)))) / 2);
      }

      // ---- local distribution networks (only around pharmacies with an active effect)
      ctx.fillStyle = rgb(GREEN);
      for (let i = 0; i < nLocal; i++) {
        const o = i * 6;
        const a = ages[scene.local[o + 4]];
        if (a < 0) continue;
        const reveal = Math.min(1, Math.max(0, (a - 0.2) * 1.5));
        const fade = 1 - smoothstep(2.6, 3.5, a);
        const isNode = scene.local[o + 5] > 0.5;
        const u = scene.local[o + 3];
        if (isNode ? reveal < 0.999 : u > reveal) continue;
        proj(scene.local[o], scene.local[o + 1], scene.local[o + 2]);
        const f = smoothstep(-0.45, 0.55, p[2]);
        const vis = fade * mix(0.1, 1, f);
        if (!isNode) {
          const tip = 1 - smoothstep(0, 0.1, Math.abs(reveal - u));
          ctx.globalAlpha = vis;
          disc(p[0], p[1], (scale * (1.9 + 3.5 * tip) * (0.7 + 0.4 * f)) / 2);
        } else {
          const size = scale * 20 * (0.7 + 0.4 * f);
          const r = (((sim.clock * 0.9 + scene.local[o] * 7) % 1) + 1) % 1;
          ctx.globalAlpha = vis;
          ctx.fillStyle = '#fff';
          disc(p[0], p[1], size * 0.25);
          ctx.fillStyle = rgb(GREEN);
          disc(p[0], p[1], size * 0.15);
          ctx.globalAlpha = vis * (1 - r) * 0.8;
          ctx.strokeStyle = rgb(GREEN);
          ctx.lineWidth = Math.max(1, size * 0.035);
          ctx.beginPath();
          ctx.arc(p[0], p[1], size * mix(0.18, 0.48, r), 0, TAU);
          ctx.stroke();
        }
      }

      // ---- hubs
      scene.hubs.forEach((h, i) => {
        proj(h.pos[0] * 1.004, h.pos[1] * 1.004, h.pos[2] * 1.004);
        const f = smoothstep(-0.45, 0.55, p[2]);
        const mine = focus < 0 ? 1 : h.chain === focus ? 1 : 0.3;
        const a = ages[h.chain];
        const pop = h.stage === 3 && a >= 0 && a < 0.6 ? Math.sin((Math.PI * a) / 0.6) : 0;
        const size = 32 * scale * (0.65 + 0.4 * f) * (1 + (i === sim.hoverHub ? 0.5 : 0) + 0.9 * pop);
        const vis = mix(0.1, 1, f) * mine;
        const ring = (((sim.clock * 0.42 + h.seed) % 1) + 1) % 1;
        ctx.globalAlpha = vis;
        ctx.fillStyle = '#fff';
        disc(p[0], p[1], size * 0.2);
        ctx.fillStyle = hubRgb[i];
        disc(p[0], p[1], size * 0.13);
        ctx.globalAlpha = vis * (1 - ring) * 0.85;
        ctx.strokeStyle = hubRgb[i];
        ctx.lineWidth = Math.max(1, size * 0.03);
        ctx.beginPath();
        ctx.arc(p[0], p[1], size * mix(0.16, 0.48, ring), 0, TAU);
        ctx.stroke();
      });

      // ---- arrival flash
      scene.chains.forEach((_, c) => {
        const a = ages[c];
        if (a < 0 || a >= 0.9) return;
        const q = pharmacies[c];
        proj(q[0] * 1.006, q[1] * 1.006, q[2] * 1.006);
        const t = a / 0.9;
        const r = (scale * mix(16, 170, 1 - Math.pow(1 - t, 3))) / 2;
        const alpha = Math.pow(1 - t, 1.4) * mix(0.15, 1, smoothstep(-0.45, 0.55, p[2]));
        const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
        g.addColorStop(0, 'rgba(255,238,230,1)');
        g.addColorStop(0.45, 'rgba(231,111,117,0.55)');
        g.addColorStop(1, 'rgba(231,111,117,0)');
        ctx.globalAlpha = alpha;
        ctx.fillStyle = g;
        disc(p[0], p[1], r);
        ctx.globalAlpha = alpha * 0.85;
        ctx.strokeStyle = rgb(BRAND);
        ctx.lineWidth = Math.max(1.2, r * 0.05);
        ctx.beginPath();
        ctx.arc(p[0], p[1], r * 0.9, 0, TAU);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    },
    dispose() {},
  };
}
