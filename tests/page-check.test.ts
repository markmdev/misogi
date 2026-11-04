// A page Muse Wonder writes must at least parse before it goes live: one shipped with a script that threw
// "Unexpected token ')'" on load and showed visitors an empty box.
//   bun test tests/page-check.test.ts

import { describe, expect, test } from "bun:test";
import { scriptError } from "../lib/server/ai/page-check";

const page = (script: string, extra = "") =>
  `<!doctype html><html><head>${extra}</head><body><div id="app"></div><script>${script}</script></body></html>`;

describe("scripts on a generated page", () => {
  test("a script that doesn't parse is caught, with the parser's message", () => {
    const err = scriptError(page(`const data = JSON.parse(document.getElementById("misogi-data").textContent);\nrender(data));`));
    expect(err).toContain("Unexpected token");
  });

  test("a page whose scripts parse passes, data blocks and all", () => {
    const ok = page(
      `const data = JSON.parse(document.getElementById("misogi-data").textContent);\nfunction render(d) { document.getElementById("app").textContent = d.challenge?.title ?? ""; }\nrender(data);`,
      `<script type="application/json" id="seed">{"not": "javascript"</script>`,
    );
    expect(scriptError(ok)).toBeNull();
  });

  test("each script is checked, not only the first", () => {
    const html = `<!doctype html><html><body><script>let a = 1;</script><script>if (a {</script></body></html>`;
    expect(scriptError(html)).not.toBeNull();
  });

  test("the script isn't run while it's checked", () => {
    expect(scriptError(page(`throw new Error("ran")`))).toBeNull();
  });
});
