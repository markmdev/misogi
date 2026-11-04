// An amount shows as its camp names it. On 4 November a swim summit named "1500m in 29:30" read "30 min" under it,
// a rowing camp named "2k in 8:15" read "8.3 min", a plank camp named "Hold 5 minutes straight" read "300 sec", and a
// trail runner's 13.1-mile camp read "13 mi".
//   bun test tests/amounts.test.ts

import { expect, test } from "bun:test";
import { withUnit } from "../lib/shared/format";

test("amounts keep their tenths", () => {
  expect(withUnit(29.5, "min")).toBe("29:30 min");
  expect(withUnit(8.25, "min")).toBe("8:15 min");
  expect(withUnit(300, "sec")).toBe("5 min");
  expect(withUnit(90, "sec")).toBe("1:30 min");
  expect(withUnit(45, "sec")).toBe("45 sec");
  expect(withUnit(13.1, "mi")).toBe("13.1 mi");
});
