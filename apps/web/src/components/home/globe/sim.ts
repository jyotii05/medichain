import { rotationXY, type Mat4 } from '../webgl';
import { MAX_CHAINS, type Scene, type Vec3 } from './scene';

/** Head position at which a shipment counts as delivered (1 = pharmacy). It then rests until 1.35 and loops. */
const REST = 1.35;
/** How long an arrival effect (flash, shockwave, local network) lasts, in seconds. */
export const BURST_DURATION = 3.6;
/** A selected route keeps its local network lit at this point of the effect. */
const HOLD_AGE = 1.6;
/** Seconds a followed route rests at the pharmacy after delivery before its next shipment leaves. */
const SELECTED_REST = 5;
export const FOV = 0.75;
const DEFAULT_DIST = 3.2;
const FOCUS_DIST = 2.65;
export const MIN_DIST = 2.15;
export const MAX_DIST = 4.2;
const TILT_MIN = -0.4;
const TILT_MAX = 1.1;

const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
const clampTilt = (t: number) => Math.min(TILT_MAX, Math.max(TILT_MIN, t));

/**
 * Renderer-independent state of the globe: the clock, every shipment's position, arrival bursts, camera and selection.
 * Both the WebGL and the Canvas 2D renderer draw from this, and the overlays read it.
 */
export class GlobeSim {
  readonly scene: Scene;
  readonly reduced: boolean;
  clock = 0;
  paused = false;
  /** Shipment progress per route, 0 → 1 (scaled by REST for the head position). */
  readonly phase: number[];
  /** Clock time of each route's latest arrival (−∞ when none yet). */
  readonly arrivedAt: number[];
  selected = -1;
  hoverHub = -1;
  /** While following a route, the camera tracks its moving shipment until the user takes over (drag / keys). */
  tracking = false;
  /** Route vertex indices per chain, in order of u, for locating a shipment on its route. */
  private readonly routeVerts: number[][];

  spin: number;
  tilt = 0.38;
  dist = DEFAULT_DIST;
  velocity = 0;
  dragging = false;
  targetSpin: number | null = null;
  targetTilt: number | null = null;
  targetDist = DEFAULT_DIST;

  rot: Mat4;
  width = 1;
  height = 1;
  onArrival?: (chain: number) => void;

  constructor(scene: Scene, reduced: boolean) {
    this.scene = scene;
    this.reduced = reduced;
    this.spin = scene.initialSpin;
    this.phase = scene.chains.map((c) => (reduced ? 0.45 + c.offset * 0.25 : c.offset));
    this.arrivedAt = scene.chains.map(() => -1e9);
    this.routeVerts = scene.chains.map(() => []);
    for (let i = 0; i < scene.routes.length / 5; i++) this.routeVerts[scene.routes[i * 5 + 4]].push(i);
    this.rot = rotationXY(this.tilt, this.spin);
  }

  /** Where a route's shipment currently is (it rests at the pharmacy after delivery). */
  shipmentPosition(chain: number): Vec3 {
    const verts = this.routeVerts[chain];
    const k = verts[Math.round(Math.min(1, this.head(chain)) * (verts.length - 1))] * 5;
    return [this.scene.routes[k], this.scene.routes[k + 1], this.scene.routes[k + 2]];
  }

  private pharmacy(chain: number): Vec3 {
    const c = this.scene.chains[chain];
    return this.scene.hubs[c.hubs[c.hubs.length - 1]].pos;
  }

  setSize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  /** Shipment head per route, in route units (0 = manufacturer, 1 = pharmacy, up to REST while resting). */
  head(chain: number) {
    return this.phase[chain] * REST;
  }

  /** Age of the arrival effect for a route, or −1 when none is showing. Selected routes hold their local network. */
  burstAge(chain: number) {
    const age = this.clock - this.arrivedAt[chain];
    if (chain === this.selected) return age >= 0 && age < HOLD_AGE ? age : HOLD_AGE;
    return age >= 0 && age < BURST_DURATION ? age : -1;
  }

  /** Age of the real (not held) arrival effect, for transient UI such as the "Delivered" label. */
  liveAge(chain: number) {
    const age = this.clock - this.arrivedAt[chain];
    return age >= 0 && age < BURST_DURATION ? age : -1;
  }

  update(dt: number) {
    if (!this.paused) {
      this.clock += dt;
      this.scene.chains.forEach((c, i) => {
        const before = this.phase[i] * REST;
        let next = this.phase[i] + dt * c.speed;
        if (i === this.selected && before >= 1) {
          // a followed shipment waits at the pharmacy so the delivery can be seen, then the next one leaves
          next = this.clock - this.arrivedAt[i] < SELECTED_REST ? Math.min(next, 0.999) : 0;
        }
        this.phase[i] = next % 1;
        const after = this.phase[i] * REST;
        if (before < 1 && after >= 1) {
          this.arrivedAt[i] = this.clock;
          this.onArrival?.(i);
        }
      });
    }

    // camera: follow the tracked shipment, or glide to a focus target, otherwise auto-spin with drag inertia
    if (this.tracking && this.selected >= 0 && !this.dragging && !this.reduced) this.lookAt(this.shipmentPosition(this.selected));
    if (!this.dragging) {
      if (this.targetSpin !== null && this.targetTilt !== null) {
        const k = ease(dt, 4.5);
        this.spin += (this.targetSpin - this.spin) * k;
        this.tilt += (this.targetTilt - this.tilt) * k;
        if (Math.abs(this.targetSpin - this.spin) < 1e-3 && Math.abs(this.targetTilt - this.tilt) < 1e-3) {
          this.targetSpin = this.targetTilt = null;
        }
      } else if (this.selected < 0 && !this.paused && this.hoverHub < 0) {
        // auto-spin, but hold still while a hub is hovered so it is easy to click
        this.spin += (0.07 + this.velocity) * dt;
      } else {
        this.spin += this.velocity * dt;
      }
      this.velocity *= Math.pow(0.04, dt);
    }
    this.dist += (this.targetDist - this.dist) * ease(dt, 6);
    this.rot = rotationXY(this.tilt, this.spin);
  }

  /** Rotates and projects a point on/near the unit sphere to CSS pixels. out = [x, y, rotatedZ]. */
  project(x: number, y: number, z: number, out: number[]) {
    const m = this.rot;
    const rx = m[0] * x + m[4] * y + m[8] * z;
    const ry = m[1] * x + m[5] * y + m[9] * z;
    const rz = m[2] * x + m[6] * y + m[10] * z;
    const f = 1 / Math.tan(FOV / 2);
    const w = this.dist - rz;
    out[0] = ((f / (this.width / this.height)) * (rx / w) * 0.5 + 0.5) * this.width;
    out[1] = (1 - (f * (ry / w) * 0.5 + 0.5)) * this.height;
    out[2] = rz;
    return out;
  }

  /** Front-facing hub nearest to a CSS-pixel position, or −1. */
  hitHub(px: number, py: number, radius = 18) {
    const p = [0, 0, 0];
    let best = -1;
    let bestD = radius;
    this.scene.hubs.forEach((h, i) => {
      this.project(h.pos[0], h.pos[1], h.pos[2], p);
      if (p[2] < 0.05) return;
      const d = Math.hypot(p[0] - px, p[1] - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  rotateBy(dSpin: number, dTilt: number) {
    this.tracking = false; // the user has taken the camera
    this.targetSpin = this.targetTilt = null;
    this.spin += dSpin;
    this.tilt = clampTilt(this.tilt + dTilt);
    this.rot = rotationXY(this.tilt, this.spin);
  }

  zoomBy(factor: number) {
    this.targetDist = Math.min(MAX_DIST, Math.max(MIN_DIST, this.targetDist * factor));
    if (this.reduced) this.dist = this.targetDist;
  }

  /** Turns the globe so a point faces the viewer (spin to x' = 0, then tilt to y' = 0). */
  lookAt(p: Vec3) {
    const s = Math.atan2(-p[0], p[2]);
    const t = clampTilt(Math.atan2(p[1], Math.hypot(p[0], p[2])));
    // take the short way round from the current spin
    const twoPi = Math.PI * 2;
    const spin = s + Math.round((this.spin - s) / twoPi) * twoPi;
    this.velocity = 0;
    if (this.reduced) {
      this.spin = spin;
      this.tilt = t;
      this.targetSpin = this.targetTilt = null;
      this.rot = rotationXY(this.tilt, this.spin);
    } else {
      this.targetSpin = spin;
      this.targetTilt = t;
    }
  }

  /** Follow a route: zoom in, send a fresh shipment along it and let the camera track it to the pharmacy. */
  select(chain: number) {
    this.selected = chain;
    this.targetDist = FOCUS_DIST;
    if (this.reduced) this.dist = FOCUS_DIST;
    this.dispatch(chain);
  }

  clearSelection() {
    this.selected = -1;
    this.tracking = false;
    this.targetDist = DEFAULT_DIST;
    if (this.reduced) this.dist = DEFAULT_DIST;
  }

  /** Starts a new shipment at the manufacturer. With reduced motion it is shown as already delivered. */
  dispatch(chain: number) {
    if (this.reduced) {
      // no travelling animation: show it delivered, with the pharmacy's local network facing the viewer
      this.phase[chain] = 1.02 / REST;
      this.arrivedAt[chain] = this.clock - HOLD_AGE;
      this.lookAt(this.pharmacy(chain));
    } else {
      this.phase[chain] = 0;
      if (chain === this.selected) this.tracking = true;
    }
  }

  reset() {
    this.clearSelection();
    this.lookAt(this.initialFocus());
    this.paused = false;
  }

  private initialFocus(): Vec3 {
    // the point that faces the camera at the initial spin and default tilt
    const s = this.scene.initialSpin;
    return [-Math.sin(s) * Math.cos(0.38), Math.sin(0.38), Math.cos(s) * Math.cos(0.38)];
  }

  /** Human-readable status of a route's current shipment. */
  status(chain: number): { label: string; leg: number } {
    const h = this.head(chain);
    if (h >= 1) return { label: 'Delivered — local distribution active', leg: 3 };
    const legs = this.scene.chains[chain].hubs.length - 1;
    const leg = Math.min(legs - 1, Math.floor(h * legs));
    return { label: `In transit: stage ${leg + 1} → ${leg + 2}`, leg };
  }
}

/** Fills a Float32Array(MAX_CHAINS) via a per-route function, padding unused slots with −1. */
export function perChain(sim: GlobeSim, fn: (chain: number) => number, out = new Float32Array(MAX_CHAINS)) {
  for (let i = 0; i < MAX_CHAINS; i++) out[i] = i < sim.scene.chains.length ? fn(i) : -1;
  return out;
}
