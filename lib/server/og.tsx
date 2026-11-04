// Shared pieces for share images rendered with next/og (Satori: flexbox only, woff/ttf fonts, PNG/JPEG images).

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { dataDir } from "./db";

const root = path.join(process.cwd(), "assets");
const cache = new Map<string, string | Buffer>();

function read(file: string): Buffer {
  const hit = cache.get(file);
  if (hit instanceof Buffer) return hit;
  const data = fs.readFileSync(path.join(root, file));
  cache.set(file, data);
  return data;
}

export function ogFonts() {
  return [
    { name: "Fredoka", data: read("fonts/Fredoka-SemiBold.woff"), weight: 600 as const, style: "normal" as const },
    { name: "Nunito", data: read("fonts/Nunito-Bold.woff"), weight: 700 as const, style: "normal" as const },
    { name: "Nunito", data: read("fonts/Nunito-ExtraBold.woff"), weight: 800 as const, style: "normal" as const },
  ];
}

function dataUri(file: string): string {
  const key = `uri:${file}`;
  const hit = cache.get(key);
  if (typeof hit === "string") return hit;
  let uri: string;
  try {
    uri = `data:image/png;base64,${read(file).toString("base64")}`;
  } catch {
    uri = `data:image/png;base64,${read("og/icon-summit.png").toString("base64")}`;
  }
  cache.set(key, uri);
  return uri;
}

export const ogScene = (theme: string) => dataUri(`og/scene-${/^[a-z-]{1,20}$/.test(theme) ? theme : "teal"}.png`);
export const ogIcon = (name: string) => dataUri(`og/icon-${/^[a-z0-9-]{1,40}$/.test(name) ? name : "summit"}.png`);
export const ogMascot = (pose: string) => dataUri(`og/mascot-${pose}.png`);

/** The challenge's own dressed Muse as a PNG, or the plain one in `pose` while it has none. */
export async function ogMuse(virgilPath: string | null | undefined, pose: string): Promise<string> {
  if (!virgilPath) return ogMascot(pose);
  const png = await sharp(path.join(dataDir(), "media", virgilPath)).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
