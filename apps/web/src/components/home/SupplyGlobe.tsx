import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Pause, Play, RotateCcw, Send, X, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mulberry32, prefersReducedMotion, runLoop } from './webgl';
import { buildScene, STAGE_COLORS, STAGE_NAMES } from './globe/scene';
import { GlobeSim, MAX_DIST, MIN_DIST } from './globe/sim';
import { createWebGLRenderer, type GlobeRenderer } from './globe/renderWebGL';
import { createCanvasRenderer } from './globe/renderCanvas';

export { STAGE_COLORS } from './globe/scene';

/*
 * An interactive dotted globe of the MediChain network. Custody routes arc Manufacturer → Distributor → Wholesaler →
 * Pharmacy; when a shipment reaches its pharmacy, a flash and shockwave light up the surrounding area and the
 * pharmacy's local distribution network (spokes to nearby clinics and patients) grows out of it.
 *
 * Drawn with WebGL, or with Canvas 2D where WebGL is unavailable, from one shared simulation (globe/sim.ts).
 * No dependencies. Hover a hub for details, click it to follow its route, drag to rotate, pinch or Ctrl+scroll to zoom.
 */

type Renderer = 'webgl' | 'canvas2d' | 'static';
const LABEL_LIFETIME = 2.8;

export function SupplyGlobe({ className, onSelectionChange }: { className?: string; onSelectionChange?: (selected: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // One simulation for the component's lifetime; it survives renderer fallbacks and StrictMode effect re-runs.
  const [sim] = useState(() => new GlobeSim(buildScene(window.innerWidth >= 768), prefersReducedMotion()));
  const simRef = useRef(sim);
  const redrawRef = useRef<() => void>(() => {});
  const tooltipRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [renderer, setRenderer] = useState<Renderer>('webgl');
  const [dragging, setDragging] = useState(false);
  const [hoverHub, setHoverHub] = useState(-1);
  const [selected, setSelected] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<{ leg: number; delivered: boolean } | null>(null);

  const scene = sim.scene;

  const select = useCallback(
    (chain: number) => {
      const sim = simRef.current;
      if (!sim) return;
      sim.select(chain);
      setSelected(chain);
      onSelectionChange?.(true);
      redrawRef.current();
    },
    [onSelectionChange],
  );
  const clear = useCallback(() => {
    const sim = simRef.current;
    if (!sim || sim.selected < 0) return;
    sim.clearSelection();
    setSelected(-1);
    onSelectionChange?.(false);
    redrawRef.current();
  }, [onSelectionChange]);

  // Keep the latest callbacks reachable from the long-lived input handlers.
  const actions = useRef({ select, clear });
  actions.current = { select, clear };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || renderer === 'static') return;

    let r: GlobeRenderer;
    try {
      r = renderer === 'webgl' ? createWebGLRenderer(canvas, sim) : createCanvasRenderer(canvas, sim);
    } catch (err) {
      if (import.meta.env.DEV) console.warn(`[SupplyGlobe] ${renderer} renderer unavailable, falling back`, err);
      // A canvas that once held a WebGL context cannot give a 2D one, so the fallback remounts it (see key below).
      setRenderer(renderer === 'webgl' ? 'canvas2d' : 'static');
      return;
    }

    const point = [0, 0, 0];
    const updateOverlays = () => {
      const tip = tooltipRef.current;
      if (tip) {
        if (sim.hoverHub >= 0 && !sim.dragging) {
          const h = sim.scene.hubs[sim.hoverHub].pos;
          sim.project(h[0], h[1], h[2], point);
          tip.style.transform = `translate(${point[0]}px, ${point[1]}px) translate(-50%, calc(-100% - 16px))`;
          tip.style.opacity = '1';
        } else {
          tip.style.opacity = '0';
        }
      }
      sim.scene.chains.forEach((c, i) => {
        const el = labelRefs.current[i];
        if (!el) return;
        const age = sim.liveAge(i);
        const h = sim.scene.hubs[c.hubs[c.hubs.length - 1]].pos;
        sim.project(h[0], h[1], h[2], point);
        const visible = age >= 0 && age < LABEL_LIFETIME && point[2] > 0.1;
        const opacity = visible ? Math.min(1, age / 0.25) * (1 - Math.max(0, (age - 2.1) / 0.7)) : 0;
        el.style.opacity = String(opacity);
        if (visible) el.style.transform = `translate(${point[0]}px, ${point[1] - 30 - age * 8}px) translate(-50%, -100%)`;
      });
    };

    let prev = 0;
    const frame = (time: number) => {
      // allow long frames so slow devices don't run in slow motion; runLoop pauses off-screen, so no huge jumps
      const dt = Math.min(0.12, Math.max(0, time - prev));
      prev = time;
      sim.update(dt);
      r.draw();
      updateOverlays();
    };
    const redraw = () => {
      sim.update(0);
      r.draw();
      updateOverlays();
    };
    redrawRef.current = redraw;

    const stop = runLoop(canvas, frame, () => r.resize());
    const detach = attachInput(canvas, sim, redraw, {
      setDragging,
      onHover: setHoverHub,
      onClick: (hub) => (hub >= 0 ? actions.current.select(sim.scene.hubs[hub].chain) : actions.current.clear()),
      onCycle: () => actions.current.select((sim.selected + 1) % sim.scene.chains.length),
      onEscape: () => actions.current.clear(),
    });
    const onLost = (e: Event) => {
      e.preventDefault();
      setRenderer('canvas2d');
    };
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      stop();
      detach();
      canvas.removeEventListener('webglcontextlost', onLost);
      r.dispose();
      redrawRef.current = () => {};
    };
  }, [renderer, sim]);

  // Live status of the followed route.
  useEffect(() => {
    if (selected < 0) return setStatus(null);
    const read = () => {
      const sim = simRef.current;
      if (!sim) return;
      const h = sim.head(selected);
      setStatus({ leg: sim.status(selected).leg, delivered: h >= 1 });
    };
    read();
    const id = window.setInterval(read, 250);
    return () => window.clearInterval(id);
  }, [selected]);

  const control = (fn: (sim: GlobeSim) => void) => () => {
    const sim = simRef.current;
    if (!sim) return;
    fn(sim);
    redrawRef.current();
  };

  const hovered = scene && hoverHub >= 0 ? scene.hubs[hoverHub] : null;
  const route = scene && selected >= 0 ? scene.chains[selected] : null;

  // On phones the route panel sits below the globe so it never hides the delivery; from sm up it floats over it.
  const panel = route && scene && (
    <section
      aria-label={`Route ${route.code}`}
      className="relative z-20 mt-3 w-full animate-slide-up rounded-2xl border border-line bg-surface/95 p-4 shadow-[var(--shadow-raised)] backdrop-blur sm:absolute sm:bottom-2 sm:left-2 sm:mt-0 sm:w-[300px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Following route {route.code}</p>
          <p aria-live="polite" className={cn('mt-1 text-[13px] font-semibold', status?.delivered ? 'text-success' : 'text-ink')}>
            {status?.delivered
              ? `Delivered to ${scene.hubs[route.hubs[3]].code} — local network lit`
              : status
                ? `In transit: ${STAGE_NAMES[status.leg]} → ${STAGE_NAMES[status.leg + 1]}`
                : 'Dispatching…'}
          </p>
        </div>
        <button
          type="button"
          onClick={clear}
          aria-label="Stop following this route"
          className="-mr-1 -mt-1 grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
      <ol className="mt-3 flex items-start justify-between" aria-label="Stages">
        {route.hubs.map((h, stage) => {
          const reached = status ? (status.delivered ? true : stage <= status.leg) : stage === 0;
          return (
            <li key={h} className="relative flex flex-1 flex-col items-center text-center">
              {stage > 0 && <span aria-hidden className={cn('absolute right-1/2 top-[7px] h-[2px] w-full', reached ? 'bg-brand' : 'bg-line')} />}
              <span
                className="relative size-4 rounded-full border-2 border-white shadow-[0_0_0_1px_var(--color-line)]"
                style={{ background: reached ? STAGE_COLORS[stage] : 'var(--color-subtle)' }}
              />
              <span className="mt-1 font-mono text-[10.5px] text-charcoal">{scene.hubs[h].code}</span>
              <span className="text-[10px] text-muted">{STAGE_NAMES[stage].slice(0, 5)}.</span>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={control((s) => s.dispatch(selected))}
        className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-brand text-[12.5px] font-semibold text-ink transition-colors hover:bg-brand-hover focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
      >
        <Send className="size-3.5" /> Send another shipment
      </button>
    </section>
  );

  return (
    <div className="relative">
      <div className={cn('relative', className)} data-renderer={renderer}>
        {/* Soft atmosphere behind the sphere */}
        <div
          className="pointer-events-none absolute inset-[8%] rounded-full"
          aria-hidden
          style={{
            background: 'radial-gradient(circle closest-side at 50% 50%, rgb(252 232 232 / 0.5) 0%, rgb(252 232 232 / 0.8) 72%, rgb(252 232 232 / 0) 100%)',
          }}
        />
        {renderer === 'static' ? (
          <GlobeFallback />
        ) : (
          <>
            <canvas
              key={renderer}
              ref={canvasRef}
              tabIndex={0}
              className={cn(
                // pan-y: a vertical swipe still scrolls the page; horizontal drags rotate and pinches zoom the globe
                'relative size-full touch-pan-y select-none rounded-full focus-visible:outline-offset-[-8px]',
                dragging ? 'cursor-grabbing' : hovered ? 'cursor-pointer' : 'cursor-grab',
              )}
              role="img"
              aria-label="Interactive globe of medicine custody routes from manufacturers through distributors and wholesalers to pharmacies. Drag or use arrow keys to rotate, plus and minus to zoom, Enter to follow the next route, Escape to stop following."
            />

            {/* hover tooltip — positioned every frame */}
            <div ref={tooltipRef} aria-hidden className="pointer-events-none absolute left-0 top-0 z-10 opacity-0 transition-opacity duration-150">
              {hovered && scene && (
                <div className="whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-2 shadow-[var(--shadow-raised)]">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                    <span className="size-2 rounded-full" style={{ background: STAGE_COLORS[hovered.stage] }} />
                    {STAGE_NAMES[hovered.stage]} · <span className="font-mono">{hovered.code}</span>
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    Route {scene.chains[hovered.chain].code} · {selected === hovered.chain ? 'click to send another shipment' : 'click to follow'}
                  </p>
                </div>
              )}
            </div>

            {/* "Delivered" labels that rise from a pharmacy when a shipment arrives — positioned every frame */}
            {scene?.chains.map((c, i) => (
              <div
                key={c.code}
                ref={(el) => {
                  labelRefs.current[i] = el;
                }}
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 z-10 opacity-0"
              >
                <div className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-success/25 bg-surface/95 py-1 pl-1.5 pr-2.5 text-[11.5px] font-semibold text-success shadow-[var(--shadow-raised)]">
                  <CheckCircle2 className="size-3.5" />
                  Delivered · {scene.hubs[c.hubs[c.hubs.length - 1]].code}
                  <span className="font-medium text-muted">local network lit</span>
                </div>
              </div>
            ))}

            {/* controls */}
            <div className="absolute right-1 top-1 z-10 flex flex-col gap-1.5 sm:right-2 sm:top-2">
              <GlobeButton label="Zoom in" onClick={control((s) => s.zoomBy(0.85))}>
                <ZoomIn />
              </GlobeButton>
              <GlobeButton label="Zoom out" onClick={control((s) => s.zoomBy(1 / 0.85))}>
                <ZoomOut />
              </GlobeButton>
              <GlobeButton
                label={paused ? 'Resume shipments' : 'Pause shipments'}
                pressed={paused}
                onClick={control((s) => {
                  s.paused = !s.paused;
                  setPaused(s.paused);
                })}
              >
                {paused ? <Play /> : <Pause />}
              </GlobeButton>
              <GlobeButton
                label="Reset view"
                onClick={control((s) => {
                  s.reset();
                  setPaused(false);
                  setSelected(-1);
                  onSelectionChange?.(false);
                })}
              >
                <RotateCcw />
              </GlobeButton>
            </div>
          </>
        )}
      </div>
      {panel}
    </div>
  );
}

function GlobeButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className="grid size-8 place-items-center rounded-lg border border-line bg-surface/90 text-charcoal shadow-[var(--shadow-card)] backdrop-blur transition-colors hover:border-brand/40 hover:text-ink focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

interface InputCallbacks {
  setDragging: (d: boolean) => void;
  onHover: (hub: number) => void;
  onClick: (hub: number) => void;
  onCycle: () => void;
  onEscape: () => void;
}

/** Pointer (mouse, touch, pen), pinch, Ctrl+wheel and keyboard input. A press that barely moves is a click. */
function attachInput(canvas: HTMLCanvasElement, sim: GlobeSim, redraw: () => void, cb: InputCallbacks) {
  const pointers = new Map<number, { x: number; y: number }>();
  let start = { x: 0, y: 0, t: 0 };
  let last = { x: 0, y: 0, t: 0 };
  let moved = false;
  let pinch = { d: 0, dist: 0 };
  const local = (e: PointerEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const setHover = (hub: number) => {
    if (hub === sim.hoverHub) return;
    sim.hoverHub = hub;
    cb.onHover(hub);
    redraw();
  };
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onDown = (e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture?.(e.pointerId);
    if (pointers.size === 1) {
      start = last = { x: e.clientX, y: e.clientY, t: performance.now() };
      moved = false;
      sim.velocity = 0;
    } else if (pointers.size === 2) {
      pinch = { d: spread(), dist: sim.targetDist };
      moved = true; // a pinch is never a click
    }
  };
  const onMove = (e: PointerEvent) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      sim.targetDist = Math.min(MAX_DIST, Math.max(MIN_DIST, pinch.dist * (pinch.d / Math.max(1, spread()))));
      if (sim.reduced) sim.dist = sim.targetDist;
      redraw();
      return;
    }
    if (pointers.size === 1) {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) {
        moved = true;
        sim.dragging = true;
        cb.setDragging(true);
        setHover(-1);
      }
      if (!moved) return;
      const now = performance.now();
      const dSpin = ((e.clientX - last.x) / canvas.clientWidth) * 3.2;
      sim.rotateBy(dSpin, ((e.clientY - last.y) / canvas.clientHeight) * 2.2);
      sim.velocity = Math.max(-3, Math.min(3, dSpin / Math.max(0.016, (now - last.t) / 1000)));
      last = { x: e.clientX, y: e.clientY, t: now };
      redraw();
      return;
    }
    if (e.pointerType === 'mouse') {
      const p = local(e);
      setHover(sim.hitHub(p.x, p.y));
    }
  };
  const onUp = (e: PointerEvent) => {
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (wasSingle && !moved && performance.now() - start.t < 600) {
      const p = local(e);
      cb.onClick(sim.hitHub(p.x, p.y, e.pointerType === 'mouse' ? 18 : 28));
    }
    if (pointers.size === 0 && sim.dragging) {
      sim.dragging = false;
      cb.setDragging(false);
    }
  };
  const onLeave = () => {
    if (pointers.size === 0) setHover(-1);
  };
  // Plain wheel keeps scrolling the page; Ctrl+wheel (and trackpad pinch, which sends it) zooms.
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    sim.zoomBy(Math.exp(e.deltaY * 0.01));
    redraw();
  };
  const onKey = (e: KeyboardEvent) => {
    const turn: Record<string, [number, number]> = { ArrowLeft: [-0.25, 0], ArrowRight: [0.25, 0], ArrowUp: [0, -0.15], ArrowDown: [0, 0.15] };
    if (turn[e.key]) sim.rotateBy(...turn[e.key]);
    else if (e.key === '+' || e.key === '=') sim.zoomBy(0.85);
    else if (e.key === '-' || e.key === '_') sim.zoomBy(1 / 0.85);
    else if (e.key === 'Enter') cb.onCycle();
    else if (e.key === 'Escape') cb.onEscape();
    else return;
    e.preventDefault();
    redraw();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('keydown', onKey);
  };
}

/** Last-resort static drawing, used only when neither WebGL nor Canvas 2D can render. */
function GlobeFallback() {
  const rand = mulberry32(7);
  const dots = Array.from({ length: 420 }, () => {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 46;
    return { x: 50 + Math.cos(a) * r, y: 50 + Math.sin(a) * r };
  });
  return (
    <svg viewBox="0 0 100 100" className="relative size-full" role="img" aria-label="Dotted globe illustration of the MediChain supply network">
      <circle cx="50" cy="50" r="47" fill="none" stroke="#E8E3E0" strokeWidth="0.4" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="0.45" fill="#333" opacity={0.18 + ((d.y - 4) / 92) * 0.5} />
      ))}
      <path d="M28 40 Q40 22 55 34 Q66 26 74 46" fill="none" stroke="#E76F75" strokeWidth="0.7" strokeDasharray="1 1.2" />
      {[
        [28, 40, STAGE_COLORS[0]],
        [55, 34, STAGE_COLORS[1]],
        [74, 46, STAGE_COLORS[2]],
      ].map(([x, y, c]) => (
        <circle key={`${x}`} cx={x} cy={y} r="1.6" fill={c as string} stroke="#fff" strokeWidth="0.6" />
      ))}
    </svg>
  );
}
