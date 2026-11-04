// The city list people pick from for the world map, bundled in lib/server/geo/cities.json (built from GeoNames by
// scripts/build-cities.ts), so finding a city never asks anyone outside.

import fs from "node:fs";
import path from "node:path";

type Row = [id: string, name: string, cc: string, region: string, lat: number, lon: number, pop: number, also: string];
type Data = { countries: Record<string, string>; regions: Record<string, string>; cities: Row[] };

export type City = { key: string; name: string; region: string | null; country: string; lat: number; lon: number };

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

let loaded: { data: Data; byId: Map<string, Row>; names: string[][] } | null = null;
function list() {
  if (!loaded) {
    const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib/server/geo/cities.json"), "utf8")) as Data;
    loaded = {
      data,
      byId: new Map(data.cities.map((r) => [r[0], r])),
      names: data.cities.map((r) => [fold(r[1]), ...(r[7] ? r[7].split("|").map(fold) : [])]),
    };
  }
  return loaded;
}

function city(r: Row): City {
  const { countries, regions } = list().data;
  return { key: r[0], name: r[1], region: r[3] ? (regions[`${r[2]}.${r[3]}`] ?? null) : null, country: countries[r[2]], lat: r[4], lon: r[5] };
}

/** "Portland, Oregon, United States": the region only where it tells two places apart, and never "Kyiv, Kyiv City". */
export function cityLabel(c: City, withRegion = false): string {
  const region = withRegion && c.region && !fold(c.region).includes(fold(c.name)) ? c.region : null;
  return [c.name, region, c.country].filter(Boolean).join(", ");
}

export function cityByKey(key: string | null | undefined): City | null {
  const r = key ? list().byId.get(key) : undefined;
  return r ? city(r) : null;
}

/** 0: its own name is what was typed; 1: another of its names is; 2 and 3: its own or another name starts with it. */
type Match = { row: Row; tier: 0 | 1 | 2 | 3 };

function matches(text: string): Match[] {
  const [place, ...rest] = text.split(",");
  const q = fold(place);
  const where = fold(rest.join(" "));
  if (!q) return [];
  const { data, names } = list();
  const out: Match[] = [];
  data.cities.forEach((r, i) => {
    const [own, ...others] = names[i];
    const tier = own === q ? 0 : others.includes(q) ? 1 : own.startsWith(q) ? 2 : others.some((x) => x.startsWith(q)) ? 3 : -1;
    if (tier < 0) return;
    if (where) {
      const country = fold(data.countries[r[2]] ?? "");
      const region = r[3] ? fold(data.regions[`${r[2]}.${r[3]}`] ?? "") : "";
      if (!(country.startsWith(where) || region.startsWith(where) || r[2].toLowerCase() === where)) return;
    }
    out.push({ row: r, tier: tier as Match["tier"] });
  });
  // The list is sorted by population and this sort keeps that order, so within each tier the biggest place comes first.
  // Other names that only start with what was typed are noisy, so they count only when nothing else matches ("Munch").
  out.sort((a, b) => a.tier - b.tier);
  return out[0]?.tier === 3 ? out : out.filter((m) => m.tier < 3);
}

/** Cities for a picker as someone types: exact names first, then names that start with what they typed. */
export function searchCities(text: string, limit = 8): (City & { label: string })[] {
  const found = matches(text.slice(0, 80)).slice(0, limit).map((m) => city(m.row));
  return found.map((c) => {
    const twin = found.some((o) => o !== c && o.name === c.name && o.country === c.country);
    return { ...c, label: cityLabel(c, twin) };
  });
}

/**
 * The city someone named in words ("Lisbon", "Portland, Oregon"). One place that has the name, or one far bigger than the
 * rest (Lisbon in Portugal, not Lisbon in Ohio), is it; otherwise the choices come back to ask about.
 */
export function resolveCity(text: string): { city: City } | { choices: string[] } {
  const all = matches(text.slice(0, 80));
  const exact = all.filter((m) => m.tier === all[0]?.tier && m.tier < 2);
  if (exact.length === 1 || (exact.length > 1 && exact[0].row[6] >= 10 * exact[1].row[6])) return { city: city(exact[0].row) };
  const options = (exact.length ? exact : all).slice(0, 5).map((m) => city(m.row));
  return { choices: options.map((c) => cityLabel(c, options.some((o) => o !== c && o.name === c.name && o.country === c.country))) };
}

/** The biggest place with this exact name in this country, for the demo climbers. */
export function findCity(name: string, cc: string): City | null {
  const q = fold(name);
  const { data, names } = list();
  const i = data.cities.findIndex((r, j) => r[2] === cc && names[j][0] === q);
  return i >= 0 ? city(data.cities[i]) : null;
}
