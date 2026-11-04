"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { sizedSet } from "@/lib/shared/art";
import type { MapClimber } from "@/lib/server/geo";
import { firstName } from "@/lib/shared/format";
import { cx, Icon, IconTile, Mascot } from "../ui";
import { useFirstScreenIn } from "./alive";

const OCEAN = "#cfe6e0";
const LAND = "#f5e4c8";
/** Pins closer than this, in pixels, stand together as one group. */
const NEAR = 64;
const MAX_ZOOM = 32;
/** The world as the map first shows it: every continent but Antarctica, with room above the north for its pins. */
const WORLD = { west: -180, east: 180, south: -56, north: 84 };

/** Natural Earth projection, in units of a hundredth of a radian, y down. */
function project(lon: number, lat: number): [number, number] {
  const l = (lon * Math.PI) / 180, p = (lat * Math.PI) / 180;
  const p2 = p * p, p4 = p2 * p2;
  const x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
  const y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
  return [x * 100, -y * 100];
}

const [W0] = project(WORLD.west, 0), [E0] = project(WORLD.east, 0), [, N0] = project(0, WORLD.north), [, S0] = project(0, WORLD.south);
const WORLD_BOX = { x: W0, y: N0, w: E0 - W0, h: S0 - N0 };

/** Natural Earth's land and lakes at 1:110m, one multipolygon each (public/geo/land.json). */
type Geo = { features: { properties: { kind: "land" | "lake" }; geometry: { coordinates: number[][][][] } }[] };

/** Each kind's outlines as one SVG path in projected units. */
function paths(geo: Geo) {
  const out = { land: "", lake: "" };
  for (const f of geo.features) {
    for (const rings of f.geometry.coordinates)
      for (const ring of rings)
        out[f.properties.kind] += ring.map(([lon, lat], i) => {
          const [x, y] = project(lon, lat);
          return `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
        }).join("") + "Z";
  }
  return out;
}

/** A soft felt sheet in one colour: short fibres in lighter and darker shades over the base. */
function felt(base: string, size = 96) {
  const c = document.createElement("canvas");
  c.width = c.height = size * 2;
  const g = c.getContext("2d")!;
  g.scale(2, 2);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI, l = 2 + rnd() * 5;
    g.strokeStyle = rnd() < 0.5 ? "rgba(255,255,255,0.24)" : "rgba(120,90,60,0.08)";
    g.lineWidth = 0.6;
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        g.beginPath();
        g.moveTo(x + dx, y + dy);
        g.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l);
        g.stroke();
      }
  }
  return c.toDataURL();
}

type City = { key: string; name: string; country: string; at: [number, number]; people: MapClimber[] };
type Group = { key: string; at: [number, number]; cities: City[]; people: MapClimber[] };
/** What the map shows: the projected point at its centre and the zoom, 1 being the whole world. */
type View = { x: number; y: number; k: number };

function citiesOf(climbers: MapClimber[]): City[] {
  const by = new Map<string, City>();
  for (const p of climbers) {
    const c = by.get(p.city.key) ?? { key: p.city.key, name: p.city.name, country: p.city.country, at: project(p.city.lon, p.city.lat), people: [] };
    c.people.push(p);
    by.set(c.key, c);
  }
  return [...by.values()].sort((a, b) => b.people.length - a.people.length);
}

/** Room left above the whole world for the pins of the northernmost cities. */
const NORTH_ROOM = 36;
/** Pixels per projected unit at zoom 1: the whole world fits the map's box. */
const fitScale = (w: number, h: number) => Math.min(w / WORLD_BOX.w, (h - NORTH_ROOM) / WORLD_BOX.h);
const home = (w: number, h: number): View => ({ x: WORLD_BOX.x + WORLD_BOX.w / 2, y: WORLD_BOX.y + WORLD_BOX.h / 2 - NORTH_ROOM / 2 / fitScale(w, h), k: 1 });
const toScreen = (v: View, w: number, h: number, [x, y]: [number, number]) => {
  const s = fitScale(w, h) * v.k;
  return { x: (x - v.x) * s + w / 2, y: (y - v.y) * s + h / 2 };
};

/** Cities whose pins would overlap at this many pixels per unit stand together, around the busiest one. */
function groupsAt(px: number, cities: City[]): Group[] {
  const out: Group[] = [];
  for (const c of cities) {
    const g = out.find((o) => Math.hypot(o.at[0] - c.at[0], o.at[1] - c.at[1]) * px < NEAR);
    if (g) {
      g.cities.push(c);
      g.people.push(...c.people);
    } else out.push({ key: "", at: c.at, cities: [c], people: [...c.people] });
  }
  return out.map((g) => ({ ...g, key: g.cities.map((c) => c.key).sort().join("+") }));
}

/** The pins' room around their city: half a pin to each side and a whole pin above, plus a margin. */
const ROOM = { x: 52, top: 82, bottom: 16 };

/**
 * The view a tap on a crowd flies to: close enough that it comes apart, with some room between its pins, but never so
 * close that its cities run off the map.
 */
function viewOf(cities: City[], w: number, h: number, fromK: number): View {
  const xs = cities.map((c) => c.at[0]), ys = cities.map((c) => c.at[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = fitScale(w, h);
  const kx = (w - 2 * ROOM.x) / Math.max(1e-6, (x1 - x0) * s), ky = (h - ROOM.top - ROOM.bottom) / Math.max(1e-6, (y1 - y0) * s);
  const fit = Math.min(MAX_ZOOM, Math.max(1, Math.min(kx, ky)));
  let k = fit;
  for (let z = fromK * 1.25; z < fit; z *= 1.25)
    if (groupsAt(s * z, cities).length > 1) {
      k = Math.min(fit, z * 1.6);
      break;
    }
  // The cities sit between the room above and below them, so the view's centre is a little above their middle.
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - (ROOM.top - ROOM.bottom) / 2 / (s * k), k };
}

const place = (g: Group) => (g.cities.length === 1 ? `${g.cities[0].name}, ${g.cities[0].country}` : g.cities.map((c) => c.name).join(", "));
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Where people are climbing: each climber who picked a city is their dressed Muse standing there, on a felt world.
 * Pins that would overlap stand together; a tap on one spread over several cities zooms in to them, otherwise it opens
 * a card of who's there and what they're climbing. The outlines load after the first screen, as the loops do.
 */
export function WorldMap({ climbers }: { climbers: MapClimber[] }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"waiting" | "loading" | "ready" | "failed">("waiting");
  const [art, setArt] = useState<{ land: string; lake: string; landFelt: string; oceanFelt: string } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Unset is the whole world, which follows the map's size.
  const [shown, setView] = useState<View | null>(null);
  const [rest, setSettled] = useState<View | null>(null);
  const [open, setOpen] = useState<Group | null>(null);
  const flight = useRef(0);
  const firstScreenIn = useFirstScreenIn();
  const cities = useMemo(() => citiesOf(climbers), [climbers]);
  const { w, h } = size;
  const view = shown ?? home(w, h), settled = rest ?? home(w, h);
  const groups = useMemo(() => (w ? groupsAt(fitScale(w, h) * (rest?.k ?? 1), cities) : []), [rest, w, h, cities]);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(flight.current);
    };
  }, []);

  if (firstScreenIn && state === "waiting") setState("loading");

  useEffect(() => {
    if (state !== "loading") return;
    let gone = false;
    fetch("/geo/land.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((geo: Geo) => {
        if (gone) return;
        setArt({ ...paths(geo), landFelt: felt(LAND), oceanFelt: felt(OCEAN) });
        setState("ready");
      })
      .catch(() => !gone && setState("failed"));
    return () => {
      gone = true;
    };
  }, [state]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [open]);

  /** Moves to a view, or to the whole world when it's null. */
  function fly(dest: View | null) {
    cancelAnimationFrame(flight.current);
    setOpen(null);
    const land = () => {
      setView(dest);
      setSettled(dest);
    };
    if (calm()) return land();
    const from = view, to = dest ?? home(w, h), ms = 650;
    let t0 = -1;
    const step = (t: number) => {
      if (t0 < 0) t0 = t;
      const u = Math.min(1, (t - t0) / ms), e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
      // The zoom moves evenly on a log scale, and the centre keeps pace with it, so the flight feels like one move.
      const k = from.k * (to.k / from.k) ** e;
      const f = from.k === to.k ? e : (1 / from.k - 1 / k) / (1 / from.k - 1 / to.k);
      const now = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, k };
      if (u < 1) {
        setView(now);
        flight.current = requestAnimationFrame(step);
      } else land();
    };
    flight.current = requestAnimationFrame(step);
  }

  // A crowd that zooming in would barely spread opens as one card, with each person's city.
  const tap = (g: Group) => {
    const to = g.cities.length > 1 ? viewOf(g.cities, w, h, settled.k) : null;
    if (to && to.k > settled.k * 1.3) fly(to);
    else setOpen(open?.key === g.key ? null : g);
  };

  const s = w ? fitScale(w, h) * view.k : 1;
  const box = w ? [view.x - w / 2 / s, view.y - h / 2 / s, w / s, h / s].map((n) => n.toFixed(3)).join(" ") : undefined;
  const docked = w < 640;
  const zoomed = settled.k > 1.01;
  const spot = open ? toScreen(view, w, h, open.at) : null;

  return (
    <div
      ref={wrap}
      className="relative h-[260px] overflow-hidden rounded-[28px] shadow-[var(--shadow-float)] ring-1 ring-line select-none sm:h-[420px] lg:h-[460px]"
      style={{ backgroundColor: OCEAN, backgroundImage: art ? `url(${art.oceanFelt})` : undefined, backgroundSize: "96px 96px" }}
      onClick={() => setOpen(null)}
    >
      {art && box && (
        <svg viewBox={box} className="animate-fade absolute inset-0 h-full w-full" role="img" aria-label={`A world map of ${climbers.length} climbers and where they are`}>
          <defs>
            <pattern id={`${id}l`} patternUnits="userSpaceOnUse" width={96 / s} height={96 / s}>
              <image href={art.landFelt} width={96 / s} height={96 / s} />
            </pattern>
            <pattern id={`${id}o`} patternUnits="userSpaceOnUse" width={96 / s} height={96 / s}>
              <image href={art.oceanFelt} width={96 / s} height={96 / s} />
            </pattern>
            <clipPath id={`${id}c`}>
              <path d={art.land} />
            </clipPath>
          </defs>
          <path d={art.land} fill="rgb(46 42 38 / 0.10)" transform={`translate(0 ${2.5 / s})`} />
          <path d={art.land} fill={`url(#${id}l)`} />
          <path d={art.lake} fill={`url(#${id}o)`} />
          <path d={art.land} fill="none" stroke="#d4b88f" strokeWidth={3.2 / s} strokeDasharray={`${3 / s} ${2.4 / s}`} clipPath={`url(#${id}c)`} />
        </svg>
      )}
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[28px] shadow-[inset_0_0_40px_rgb(46_42_38/0.10)]" />

      {state !== "ready" && (
        <div className="absolute inset-0 grid place-items-center text-center">
          {state === "failed" ? (
            <div className="max-w-xs px-6">
              <Mascot pose="think" size={72} alt="" className="mx-auto" />
              <p className="mt-2 text-[15px] font-bold text-ink">The map didn&apos;t load here.</p>
              <p className="mt-1 text-[14px] text-ink-2">Everyone on it is climbing one of the challenges below.</p>
            </div>
          ) : (
            <p className="animate-pulse text-[14px] font-bold text-ink-2">Unrolling the map…</p>
          )}
        </div>
      )}

      {state === "ready" &&
        groups.map((g) => {
          const at = toScreen(view, w, h, g.at);
          return (
            <div key={g.key} className="absolute top-0 left-0" style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
              <Pin group={g} selected={open?.key === g.key} onTap={() => tap(g)} />
            </div>
          );
        })}

      {state === "ready" && zoomed && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            fly(null);
          }}
          className="absolute top-3 right-3 z-10 flex h-10 items-center gap-1.5 rounded-full bg-white/95 pr-4 pl-2.5 text-[14px] font-extrabold text-ink shadow-[0_2px_0_rgb(46_42_38/0.08)] ring-1 ring-line hover:bg-white"
        >
          <Icon name="map" size={24} />
          Whole world
        </button>
      )}

      {open && spot && <Card group={open} docked={docked} spot={spot} width={w} height={h} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Pin({ group, selected, onTap }: { group: Group; selected: boolean; onTap: () => void }) {
  const shown = group.people.slice(0, 3);
  const names = group.people.map((p) => firstName(p.name));
  const label = `${place(group)}: ${names.slice(0, 2).join(" and ")}${names.length > 2 ? ` and ${names.length - 2} more` : ""}`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onTap();
      }}
      aria-label={label}
      aria-expanded={selected}
      className={cx("group absolute bottom-0 block h-[58px] -translate-x-1/2 cursor-pointer transition-transform duration-200 hover:-translate-y-0.5 sm:h-[66px]", selected && "-translate-y-1 scale-110")}
      style={{ width: 44 + (shown.length - 1) * 16 }}
    >
      <span aria-hidden className="absolute bottom-0 left-1/2 h-2 w-9 -translate-x-1/2 rounded-full bg-ink/20 blur-[2px]" />
      {shown
        .map((p, i) => ({ p, i }))
        .reverse()
        .map(({ p, i }) => {
          const set = sizedSet(p.muse);
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={p.handle}
              src={p.muse}
              srcSet={set}
              sizes="64px"
              alt=""
              draggable={false}
              className="absolute bottom-0.5 h-[52px] w-[52px] object-contain drop-shadow-[0_2px_1px_rgb(46_42_38/0.18)] select-none sm:h-[60px] sm:w-[60px]"
              style={{ left: `calc(50% + ${(i === 0 ? 0 : i === 1 ? -16 : 16) - 26}px)`, transform: i ? "scale(0.82)" : undefined, transformOrigin: "bottom", zIndex: 3 - i }}
            />
          );
        })}
      {group.people.length > 1 && (
        <span className="absolute -top-1 right-0 z-10 grid h-[22px] min-w-[22px] place-items-center rounded-full bg-coral px-1.5 text-[12px] font-extrabold text-white shadow-[0_2px_0_var(--color-coral-deep)] ring-2 ring-white">
          {group.people.length}
        </span>
      )}
    </button>
  );
}

const CARD_W = 300;

function Card({ group, docked, spot, width, height, onClose }: { group: Group; docked: boolean; spot: { x: number; y: number }; width: number; height: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useEffect(() => setH(ref.current?.offsetHeight ?? 0), [group]);
  let style: React.CSSProperties | undefined;
  if (!docked) {
    const left = Math.min(Math.max(spot.x - CARD_W / 2, 12), width - CARD_W - 12);
    const above = spot.y - 76 - h > 12;
    const top = above ? spot.y - 76 - h : Math.min(spot.y + 12, height - h - 12);
    style = { left, top, width: CARD_W };
  }
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Climbing in ${place(group)}`}
      onClick={(e) => e.stopPropagation()}
      className={cx("animate-rise absolute z-20 flex flex-col overflow-hidden rounded-[22px] bg-white shadow-[var(--shadow-float)] ring-1 ring-line", docked ? "inset-x-2 bottom-2 max-h-[72%]" : "max-h-[calc(100%-24px)]")}
      style={style}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Icon name="pin" size={22} />
        <p className="min-w-0 flex-1 truncate text-[14px] font-extrabold text-ink">{place(group)}</p>
        <button type="button" onClick={onClose} className="-mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[20px] leading-none text-ink-3 hover:bg-cream-2 hover:text-ink" aria-label="Close">
          ×
        </button>
      </div>
      <ul className="divide-y divide-line overflow-y-auto overscroll-contain">
        {group.people.map((p) => (
          <li key={p.handle} className="flex gap-3 px-4 py-3">
            <Mascot src={p.muse} size={52} alt="" className="-my-1 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-extrabold text-ink">
                {firstName(p.name)}
                {group.cities.length > 1 && <span className="font-bold text-ink-3"> · {p.city.name}</span>}
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {p.challenges.slice(0, 3).map((c) => (
                  <li key={c.slug}>
                    <Link href={c.url} className="-mx-1.5 flex items-center gap-2 rounded-[10px] px-1.5 py-1 text-[14px] leading-5 font-bold text-ink-2 hover:bg-cream-2 hover:text-ink">
                      <IconTile name={c.icon} size={28} />
                      <span className="min-w-0 flex-1">{c.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {p.challenges.length > 3 && (
                <Link href={`/u/${p.handle}`} className="mt-1 inline-block text-[13px] font-bold text-coral-deep hover:underline">
                  {p.challenges.length - 3} more on {firstName(p.name)}&apos;s page
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
