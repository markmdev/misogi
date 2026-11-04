// The city list behind the world map: what people and their Muse type, and where it lands.
//   bun test tests/cities.test.ts

import { describe, expect, test } from "bun:test";
import { cityLabel, resolveCity, searchCities } from "../lib/server/cities";

const where = (text: string) => {
  const r = resolveCity(text);
  return "city" in r ? cityLabel(r.city, true) : r.choices;
};

describe("finding a city", () => {
  test("a name lands on the place people mean, not a small namesake", () => {
    expect(where("Lisbon")).toBe("Lisbon, Portugal");
    expect(where("tokyo")).toBe("Tokyo, Japan");
  });

  test("local names and accents work either way", () => {
    expect(where("Lisboa")).toBe("Lisbon, Portugal");
    expect(where("Sao Paulo")).toBe(where("São Paulo"));
    expect(where("Kiev")).toBe("Kyiv, Ukraine");
  });

  test("a region or country tells namesakes apart", () => {
    expect(where("Portland, Oregon")).toBe("Portland, Oregon, United States");
    expect(where("Portland, Maine")).toBe("Portland, Maine, United States");
    expect(where("Valencia, Venezuela")).toContain("Venezuela");
  });

  test("the way people write a place resolves, and so does each choice it offers", () => {
    expect(where("London, UK")).toBe("London, England, United Kingdom");
    expect(where("Austin, TX")).toBe("Austin, Texas, United States");
    expect(where("New York, NY")).toBe("New York City, New York, United States");
    expect(where("Washington, DC")).toBe("Washington, District of Columbia, United States");
    const choices = where("Springfield");
    for (const c of choices as string[]) expect(where(c)).toBe(c);
  });

  test("old names land on the big city, not a small namesake", () => {
    expect(where("Calcutta")).toBe("Kolkata, West Bengal, India");
    expect(where("St. Petersburg")).toContain("Russia");
  });

  test("a district of a big city isn't a place of its own", () => {
    expect(searchCities("Islington").map((c) => c.label)).not.toContain("Islington, United Kingdom");
    expect(where("Manhattan, NY")).toBe("New York City, New York, United States");
    expect(where("Hoboken")).not.toContain("United States");
  });

  test("when several places fit, it asks", () => {
    const springfield = where("Springfield");
    expect(Array.isArray(springfield) && springfield.length).toBeGreaterThan(1);
    expect(where("Qxzlwv")).toEqual([]);
  });

  test("a small town is on the list", () => {
    expect(searchCities("Tortosa")[0]).toMatchObject({ name: "Tortosa", country: "Spain" });
  });

  test("suggestions start from what was typed, biggest first", () => {
    const s = searchCities("lis");
    expect(s[0].name).toBe("Lisbon");
    expect(s.every((c) => c.label.length > 0)).toBe(true);
  });
});
