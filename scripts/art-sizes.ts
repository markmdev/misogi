// Makes the small "-sm" copies of the icons and Virgil's poses that pages draw small (lib/shared/art.ts), beside each
// picture. It runs before `bun dev` and `bun run build`.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ICON_SM, MASCOT_SM } from "../lib/shared/art";

for (const [dir, width] of [["icons", ICON_SM], ["mascot", MASCOT_SM]] as const) {
  const root = path.join(import.meta.dir, "..", "public", "art", dir);
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".webp") || name.endsWith("-sm.webp")) continue;
    const full = path.join(root, name);
    const small = full.replace(/\.webp$/, "-sm.webp");
    await sharp(full).resize({ width }).webp({ quality: 85 }).toFile(small);
  }
}
