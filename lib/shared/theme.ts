import type { Theme } from "./types";

export type Palette = {
  /** Soft page tint behind content on this challenge. */
  tint: string;
  /** Main accent: progress, highlights. */
  accent: string;
  /** Darker accent for the 3D edge under buttons and for text on tint. */
  deep: string;
  /** Sky color behind the scene art while it loads. */
  sky: string;
  label: string;
};

export const PALETTES: Record<Theme, Palette> = {
  teal: { tint: "#E4F4F1", accent: "#2FA59A", deep: "#1E7A71", sky: "#CDEBE5", label: "Teal dawn" },
  mint: { tint: "#E9F6E7", accent: "#4BB873", deep: "#2E8B52", sky: "#D7EFD3", label: "Spring" },
  sand: { tint: "#FBF0DF", accent: "#DF9C45", deep: "#A86E22", sky: "#F6E2C3", label: "Desert" },
  peach: { tint: "#FFEDE5", accent: "#FF8A66", deep: "#D35E3C", sky: "#FFD9C9", label: "Sunset" },
  lilac: { tint: "#F1ECFB", accent: "#9479DE", deep: "#674EB2", sky: "#E2D9F6", label: "Twilight" },
  sky: { tint: "#E7F1FC", accent: "#4A98E6", deep: "#2C6FB3", sky: "#D3E6F9", label: "Snow peaks" },
  rose: { tint: "#FDECF1", accent: "#E9779A", deep: "#BC4C6E", sky: "#F9D9E3", label: "Blossom" },
  night: { tint: "#E9ECF7", accent: "#5763BA", deep: "#3A438C", sky: "#2B3266", label: "Starry night" },
};

export function palette(theme: string | null | undefined): Palette {
  return PALETTES[(theme as Theme) in PALETTES ? (theme as Theme) : "teal"];
}
