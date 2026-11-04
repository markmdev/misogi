// Compiles each inline script of a generated page without running it, so a page that can't even parse
// never goes live.

const JS_TYPES = /^(|text\/javascript|application\/javascript)$/i;

/** The first parse error among the page's inline scripts, or null when they all compile. */
export function scriptError(html: string): string | null {
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(m[1])?.[1] ?? "";
    if (!JS_TYPES.test(type)) continue;
    try {
      // Parses the body without calling it.
      new Function(m[2]);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
  return null;
}
