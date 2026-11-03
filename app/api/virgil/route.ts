import { currentUser } from "@/lib/server/auth";
import { runVirgil, type VirgilEvent } from "@/lib/server/ai/virgil";
import { errorJson, originOf, rateLimit } from "@/lib/server/http";
import { AppError } from "@/lib/server/util";

export const dynamic = "force-dynamic";

/** Streams Virgil's work as newline-delimited JSON events. */
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new AppError("unauthorized", "Sign in first.");
    rateLimit(`virgil:${user.id}`, 10, 6);
    const body = (await req.json().catch(() => ({}))) as { message?: string; thread?: string; challenge?: string };
    const thread = (body.thread || "main").slice(0, 80);
    const origin = originOf(req);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (e: VirgilEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        try {
          await runVirgil(user, { thread, message: String(body.message ?? ""), challenge: body.challenge ?? null, origin }, emit);
        } catch (e) {
          emit({ type: "error", message: e instanceof AppError ? e.message : "Virgil hit a snag. Try again." });
          if (!(e instanceof AppError)) console.error("[virgil]", e);
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
    });
  } catch (e) {
    return errorJson(e);
  }
}
