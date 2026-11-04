// SAM 3.1's answer read as pixels: each match's mask laid over the image it was asked about, and the fill that turns a
// mask's outline into a solid shape.

import { decodeMaskToRaster } from "@meta-sam/parser";
import sharp from "sharp";

/** Each match in SAM's output line as a W×H mask, 1 inside, 0 outside, in the order SAM gave them. */
export async function samMasks(sam: string, W: number, H: number): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const m of sam.matchAll(/<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);[^|]*\|><\|mask;[^|]*?data=(\d+),(\d+),([^|]*)\|>/g)) {
    const [x1, y1, x2, y2, mh, mw] = m.slice(1, 7).map(Number);
    const payload = m[7];
    const raster = decodeMaskToRaster({ encoding: payload[0] === "!" ? "one_bit" : "lossless", payload, width: mw, height: mh });
    const bw = x2 - x1 + 1;
    const bh = y2 - y1 + 1;
    const { data: box, info: bi } = await sharp(Buffer.from(raster.map((v) => v * 255)), { raw: { width: mw, height: mh, channels: 1 } })
      .resize(bw, bh, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) if (box[(y * bw + x) * bi.channels] > 127 && y1 + y < H && x1 + x < W) mask[(y1 + y) * W + x1 + x] = 1;
    out.push(mask);
  }
  return out;
}

/** The pixels reachable from the picture's edges through `open` ones. */
export function floodFromEdges(W: number, H: number, open: (i: number) => boolean): Uint8Array {
  const seen = new Uint8Array(W * H);
  // Each pixel goes on the stack at most once, so the stack never outgrows the image.
  const stack = new Int32Array(W * H);
  let top = 0;
  const visit = (i: number) => {
    if (!seen[i] && open(i)) {
      seen[i] = 1;
      stack[top++] = i;
    }
  };
  for (let x = 0; x < W; x++) {
    visit(x);
    visit((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    visit(y * W);
    visit(y * W + W - 1);
  }
  while (top) {
    const i = stack[--top];
    const x = i % W;
    if (x > 0) visit(i - 1);
    if (x < W - 1) visit(i + 1);
    if (i >= W) visit(i - W);
    if (i < W * (H - 1)) visit(i + W);
  }
  return seen;
}
