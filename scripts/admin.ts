// Admin calls against a running Misogi server. better-sqlite3 doesn't load under Bun, so the
// server does the database work and this script only talks HTTP.
//
//   bun run seed [--covers] [--spaces] [--force]   demo challenges, people and history
//   bun run ai-check [--image]                     one small call per model job
//
// BASE_URL picks the server (default http://localhost:3000). ADMIN_KEY is required in
// production and ignored in dev when the server has none. Bun loads both from .env.local.

export {}; // a module, so top-level await works

const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest);

const routes: Record<string, { path: string; body: Record<string, boolean> }> = {
  seed: {
    path: "/api/admin/seed",
    body: { covers: flags.has("--covers"), spaces: flags.has("--spaces"), force: flags.has("--force") },
  },
  "ai-check": { path: "/api/admin/ai-check", body: { image: flags.has("--image") } },
};

const route = command ? routes[command] : undefined;
if (!route) {
  console.error("Usage: bun scripts/admin.ts seed [--covers] [--spaces] [--force] | ai-check [--image]");
  process.exit(2);
}

const headers: Record<string, string> = { "content-type": "application/json" };
if (process.env.ADMIN_KEY) headers["x-admin-key"] = process.env.ADMIN_KEY;

let res: Response;
try {
  res = await fetch(base + route.path, { method: "POST", headers, body: JSON.stringify(route.body) });
} catch {
  console.error(`Can't reach ${base}. Start the server first (bun dev), or set BASE_URL.`);
  process.exit(1);
}
const text = await res.text();
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
if (!res.ok) process.exit(1);
if (command === "ai-check" && JSON.parse(text).ok === false) process.exit(1);
