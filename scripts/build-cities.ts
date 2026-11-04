// Builds lib/server/geo/cities.json, the city list people pick from for the world map, from GeoNames
// (https://www.geonames.org, CC BY 4.0). Download cities15000.zip (unzipped), countryInfo.txt and admin1CodesASCII.txt
// from https://download.geonames.org/export/dump/ into one folder, then:
//   bun scripts/build-cities.ts <that folder>

import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("Usage: bun scripts/build-cities.ts <folder with the GeoNames files>");
const rows = (file: string) =>
  fs
    .readFileSync(path.join(dir, file), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t"));

const countries: Record<string, string> = {};
for (const r of rows("countryInfo.txt")) countries[r[0]] = r[4];

const regions: Record<string, string> = {};
for (const r of rows("admin1CodesASCII.txt")) regions[r[0]] = r[1];

// Sections of a city, historical, abandoned and destroyed places aren't somewhere a person lives.
const SKIP = new Set(["PPLX", "PPLH", "PPLQ", "PPLW"]);
const latin = /^[\p{Script=Latin}\s'’.\-]+$/u;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const places = rows("cities15000.txt").filter((r) => !SKIP.has(r[7]) && countries[r[8]]);

// A district of a big city (Islington, Camden Town, Paris 15, Manhattan) isn't a city of its own: picking it would show
// someone finer than their city. Anything within 10 km of a bigger city of a million or more in the same country is one.
const big = places.filter((r) => Number(r[14]) >= 1_000_000);
const km = (a: string[], b: string[]) => {
  const [la1, lo1, la2, lo2] = [a[4], a[5], b[4], b[5]].map((x) => (Number(x) * Math.PI) / 180);
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const districts = new Set(
  places.filter((r) => big.some((b) => b !== r && b[8] === r[8] && Number(b[14]) > Number(r[14]) && km(b, r) < 10)).map((r) => r[0]),
);

// Another place's own name ("Porto" listed for Bordeaux) would send people to the wrong city, so it's kept as a second
// name only for a place fifteen times bigger than the one it names: "Calcutta" for Kolkata and "St. Petersburg" for
// Russia's, but not "Tortosa" for Tartus, only 13 times bigger than Tortosa in Spain.
const ownNames = new Map<string, number>();
for (const r of places) if (!districts.has(r[0])) ownNames.set(fold(r[1]), Math.max(ownNames.get(fold(r[1])) ?? 0, Number(r[14])));

type City = [id: string, name: string, cc: string, region: string, lat: number, lon: number, pop: number, also: string];
const cities: City[] = [];
for (const r of places) {
  const [id, name, ascii, alternates, lat, lon, , , cc, , admin1, , , , pop] = r;
  if (districts.has(id)) continue;
  const population = Number(pop);
  const free = (a: string) => population >= 15 * (ownNames.get(fold(a)) ?? 0);
  // Other names a person might type for a big city ("Lisboa", "Kiev"), in Latin letters only, to keep the file small.
  const also = new Set<string>();
  if (ascii !== name) also.add(ascii);
  if (population >= 250_000)
    for (const a of alternates.split(","))
      if (a && a !== name && a.length <= 30 && !/^[A-Z]{2,4}$/.test(a) && latin.test(a) && free(a) && also.size < 60) also.add(a);
  cities.push([id, name, cc, admin1 && regions[`${cc}.${admin1}`] ? admin1 : "", Number(Number(lat).toFixed(3)), Number(Number(lon).toFixed(3)), population, [...also].join("|")]);
}
cities.sort((a, b) => b[6] - a[6]);

const used = new Set(cities.map((c) => c[2]));
const usedRegions = new Set(cities.filter((c) => c[3]).map((c) => `${c[2]}.${c[3]}`));
const out = {
  source: "GeoNames cities15000 (https://www.geonames.org), CC BY 4.0",
  countries: Object.fromEntries(Object.entries(countries).filter(([cc]) => used.has(cc))),
  regions: Object.fromEntries(Object.entries(regions).filter(([k]) => usedRegions.has(k))),
  cities,
};
const file = path.join(import.meta.dir, "../lib/server/geo/cities.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));
console.log(`${cities.length} cities in ${Object.keys(out.countries).length} countries, ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
