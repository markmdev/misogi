// Starting a goal that's already a live challenge offers to join it instead of making a near-empty copy. On 4 November
// the home chips and "Decide for me" drafted copies of live challenges, titled the same or with a year framing added.
//   bun test tests/same-goal.test.ts

import { describe, expect, test } from "bun:test";
import { sameGoal } from "../lib/server/util";

const same = (a: string, b: string) => sameGoal(a) === sameGoal(b);

describe("a drafted title and a live challenge's", () => {
  test("are the same climb when only the framing in time differs", () => {
    expect(same("Read 25 books", "Read 25 books")).toBe(true);
    expect(same("Read 25 books this year", "Read 25 books")).toBe(true);
    expect(same("Read 25 books in a year", "Read 25 books")).toBe(true);
    expect(same("Run 365 miles in 2027", "Run 365 miles")).toBe(true);
    expect(same("Publish 24 videos", "Publish 24 videos in a year")).toBe(true);
    expect(same("Hold a 20-minute conversation in Mandarin", "Hold a 20-minute conversation in Mandarin")).toBe(true);
  });

  test("are different climbs when the goal differs", () => {
    expect(same("Read 24 books", "Read 25 books")).toBe(false);
    expect(same("Read 50 books on one country in a year", "Read 25 books")).toBe(false);
    expect(same("Run a strong SF half marathon", "Run a strong half marathon")).toBe(false);
    expect(same("Cook 100 different meals from scratch", "Cook 100 meals from scratch")).toBe(false);
    expect(same("Hold a 15-minute conversation in Spanish", "Hold a 20-minute conversation in Mandarin")).toBe(false);
  });
});
