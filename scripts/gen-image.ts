// Usage: bun scripts/gen-image.ts <out.png> <aspect> "<prompt>" [model]
// Generates one image with xAI Grok Imagine via the team key API (dev tool, not app code).
import fs from "node:fs";
import path from "node:path";
const [out, aspect = "1:1", prompt, model = "grok-imagine-image-2.0"] = process.argv.slice(2);
if (!out || !prompt) { console.error("usage: gen-image.ts out.png aspect prompt [model]"); process.exit(1); }
const home = process.env.HOME!;
const keyUrl = fs.readFileSync(path.join(home, ".config/grok-key-api/url"), "utf8").trim();
const pass = fs.readFileSync(path.join(home, ".config/grok-key-api/password"), "utf8").trim();
const key = (await (await fetch(keyUrl + "/key", { headers: { Authorization: "Bearer " + pass } })).text()).trim();
const t = Date.now();
const r = await fetch("https://api.x.ai/v1/images/generations", {
  method: "POST",
  headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
  body: JSON.stringify({ model, prompt, n: 1, aspect_ratio: aspect, response_format: "b64_json" }),
});
const j: any = await r.json();
if (!r.ok) { console.error(r.status, JSON.stringify(j).slice(0, 400)); process.exit(1); }
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(j.data[0].b64_json, "base64"));
console.log(`${out} ${Date.now() - t}ms`);
