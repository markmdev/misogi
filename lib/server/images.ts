import sharp from "sharp";

/** The image models return large PNGs; keep them as WebP no wider than the site ever shows them. */
export function toWebp(data: Buffer, maxWidth: number): Promise<Buffer> {
  return sharp(data).resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
}
