import { mulberry32 } from '../webgl';

/** Hub colours per supply-chain stage — the MediChain palette (brand, brand-ink, charcoal, success). */
export const STAGE_COLORS = ['#E76F75', '#B5444C', '#333333', '#218653'] as const;
export const STAGE_NAMES = ['Manufacturer', 'Distributor', 'Wholesaler', 'Pharmacy'] as const;
export const LOCAL_GREEN = '#218653';
/** Shader uniform arrays are sized for this many routes. */
export const MAX_CHAINS = 8;

export type Vec3 = [number, number, number];

export interface Hub {
  pos: Vec3;
  stage: number;
  chain: number;
  /** Fictional display code, e.g. "P-23". */
  code: string;
  seed: number;
}

export interface Chain {
  /** Indices into Scene.hubs, in stage order (manufacturer → pharmacy). */
  hubs: number[];
  speed: number;
  offset: number;
  code: string;
}

export interface Scene {
  /** stride 5: x, y, z, isLand, seed */
  dots: Float32Array;
  /** stride 5: x, y, z, u (0 at manufacturer → 1 at pharmacy), chain */
  routes: Float32Array;
  /** stride 6: x, y, z, u (0 at pharmacy → 1 at local point), chain, kind (0 spoke, 1 local point) */
  local: Float32Array;
  hubs: Hub[];
  chains: Chain[];
  initialSpin: number;
}

export const hex = (c: string): Vec3 => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) as Vec3;

const norm = (v: number[]): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: number[], b: number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const angle = (a: number[], b: number[]) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

function slerp(a: number[], b: number[], t: number): Vec3 {
  const om = angle(a, b);
  if (om < 1e-4) return [a[0], a[1], a[2]];
  const s = Math.sin(om);
  const ka = Math.sin((1 - t) * om) / s;
  const kb = Math.sin(t * om) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}

/** Cheap procedural "continents": a few interfering sine fields over the sphere. */
function landAt(x: number, y: number, z: number) {
  const n =
    Math.sin(2.1 * x + 1.3) * Math.sin(2.4 * y - 0.6) * Math.sin(1.9 * z + 2.1) +
    0.55 * Math.sin(4.3 * x - 2.2 * z + 0.7) * Math.cos(3.7 * y + 1.1 * x) +
    0.28 * Math.sin(8.1 * y + 3.3 * z) * Math.sin(7.4 * x - 0.4);
  const polar = Math.abs(y) > 0.9 ? -0.4 : 0;
  return n + polar > -0.06;
}

export function buildScene(dense: boolean): Scene {
  const rand = mulberry32(20261022);

  // ---- dotted sphere (Fibonacci lattice), dense on land, sparse at sea
  const N = dense ? 11000 : 6000;
  const dots: number[] = [];
  const land: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const x = Math.cos(golden * i) * r;
    const z = Math.sin(golden * i) * r;
    const isLand = landAt(x, y, z);
    if (!isLand && i % 4 !== 0) continue;
    dots.push(x, y, z, isLand ? 1 : 0, rand());
    if (isLand && Math.abs(y) < 0.8) land.push([x, y, z]);
  }

  // ---- candidate hub sites: well-spaced land points
  const sites: Vec3[] = [];
  for (let tries = 0; sites.length < 22 && tries < 4000; tries++) {
    const p = land[Math.floor(rand() * land.length)];
    if (sites.every((h) => angle(h, p) > 0.32)) sites.push(p);
  }

  // ---- custody chains: each hops to a nearby unused site, one stage at a time (always 4 stages)
  const hubs: Hub[] = [];
  const chains: Chain[] = [];
  const routes: number[] = [];
  const local: number[] = [];
  const SAMPLES = dense ? 110 : 70;
  const CHAINS = 7;
  for (let c = 0; c < CHAINS; c++) {
    let path: number[] = [];
    for (let attempt = 0; attempt < 60 && path.length < 4; attempt++) {
      path = [Math.floor(rand() * sites.length)];
      while (path.length < 4) {
        const cur = path[path.length - 1];
        const near = sites
          .map((s, i) => ({ i, d: angle(sites[cur], s) }))
          .filter((o) => !path.includes(o.i) && o.d > 0.25)
          .sort((a, b) => a.d - b.d)
          .slice(0, 3);
        if (!near.length) break;
        path.push(near[Math.floor(rand() * near.length)].i);
      }
    }
    const chain: Chain = { hubs: [], speed: 0.07 + rand() * 0.05, offset: rand(), code: `R${c + 1}` };
    path.forEach((site, stage) => {
      chain.hubs.push(hubs.length);
      hubs.push({ pos: sites[site], stage, chain: c, code: `${'MDWP'[stage]}-${10 + c * 4 + stage}`, seed: rand() });
    });
    chains.push(chain);

    // long-haul arcs between stages
    const legs = path.length - 1;
    for (let l = 0; l < legs; l++) {
      const a = sites[path[l]];
      const b = sites[path[l + 1]];
      const lift = 0.05 + 0.32 * angle(a, b);
      for (let k = 0; k <= SAMPLES; k++) {
        const t = k / SAMPLES;
        const p = slerp(a, b, t);
        const h = 1 + lift * Math.sin(Math.PI * t);
        routes.push(p[0] * h, p[1] * h, p[2] * h, (l + t) / legs, c);
      }
    }

    // last-mile spokes from the pharmacy to nearby local points (clinics, patients), revealed on arrival
    const d = sites[path[path.length - 1]];
    const t1 = norm(cross(d, Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]));
    const t2 = cross(d, t1);
    const SPOKES = 7;
    for (let k = 0; k < SPOKES; k++) {
      const a = (k / SPOKES) * Math.PI * 2 + rand() * 0.7;
      const r = 0.06 + rand() * 0.11;
      const dir = [t1[0] * Math.cos(a) + t2[0] * Math.sin(a), t1[1] * Math.cos(a) + t2[1] * Math.sin(a), t1[2] * Math.cos(a) + t2[2] * Math.sin(a)];
      const end = norm([d[0] * Math.cos(r) + dir[0] * Math.sin(r), d[1] * Math.cos(r) + dir[1] * Math.sin(r), d[2] * Math.cos(r) + dir[2] * Math.sin(r)]);
      const S = 26;
      for (let s = 0; s <= S; s++) {
        const t = s / S;
        const p = slerp(d, end, t);
        const h = 1.002 + 0.018 * Math.sin(Math.PI * t);
        local.push(p[0] * h, p[1] * h, p[2] * h, t, c, 0);
      }
      local.push(end[0] * 1.003, end[1] * 1.003, end[2] * 1.003, 1, c, 1);
    }
  }

  // Open with the first route facing the viewer: z' = -sin(s)·x + cos(s)·z is largest at s = atan2(-x, z).
  const mid = chains[0].hubs.reduce((acc, h) => acc.map((v, k) => v + hubs[h].pos[k]), [0, 0, 0]);
  return {
    dots: new Float32Array(dots),
    routes: new Float32Array(routes),
    local: new Float32Array(local),
    hubs,
    chains,
    initialSpin: Math.atan2(-mid[0], mid[2]) - 0.35,
  };
}
