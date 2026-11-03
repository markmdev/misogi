import type { NextRequest } from "next/server";
import { one } from "@/lib/server/db";
import { originOf } from "@/lib/server/http";
import { inlineJson, spaceData } from "@/lib/server/space-data";
import { getVersion } from "@/lib/server/spaces";
import type { ChallengeRow } from "@/lib/server/domain/challenges";

export const dynamic = "force-dynamic";

function bootstrap(versionId: string) {
  // Reports runtime errors and content height to the Misogi page that embeds this space.
  return `<script>(function(){var id=${JSON.stringify(versionId)};var sent=0;
function post(m){try{m.source="misogi-space";m.id=id;parent.postMessage(m,"*")}catch(e){}}
function err(msg,shows){if(sent++<3)post({type:"error",message:String(msg||"error").slice(0,300),shows:!!shows})}
addEventListener("error",function(e){err(e.message)});
addEventListener("unhandledrejection",function(e){err(e.reason&&e.reason.message||e.reason)});
var last=0;function size(){var h=Math.ceil(Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0));if(Math.abs(h-last)>2){last=h;post({type:"height",height:h})}}
addEventListener("load",function(){size();if(window.ResizeObserver)new ResizeObserver(size).observe(document.body||document.documentElement);setTimeout(size,400);setTimeout(size,1500);
setTimeout(function(){var b=document.body;if(!b||(!b.innerText.trim()&&!b.querySelector("svg,canvas,img")))err("The page rendered blank.");var h=document.documentElement.scrollHeight;if(h>6000)err("The page is "+h+" px tall, and the frame cuts it off at 6000. Keep the whole page under 3000 px; the frame grows to fit the page, so size nothing with vh.",1)},2500)});
})();</script>`;
}

function inject(html: string, head: string): string {
  const m = /<head(\s[^>]*)?>/i.exec(html);
  if (m) return html.slice(0, m.index + m[0].length) + head + html.slice(m.index + m[0].length);
  const h = /<html[^>]*>/i.exec(html);
  if (h) return html.slice(0, h.index + h[0].length) + `<head>${head}</head>` + html.slice(h.index + h[0].length);
  return head + html;
}

export async function GET(req: NextRequest, ctx: RouteContext<"/s/[id]">) {
  const { id } = await ctx.params;
  // Spaces only ever render inside Misogi's sandboxed frame; opened directly, a model-written page
  // could pose as Misogi. Browsers send Sec-Fetch-Dest; tools without it (curl, tests) are harmless.
  const dest = req.headers.get("sec-fetch-dest");
  if (dest && dest !== "iframe") return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  const v = getVersion(id);
  if (!v || !v.html) return new Response("This space doesn't exist.", { status: 404, headers: { "Content-Type": "text/plain" } });
  const c = one<ChallengeRow>("SELECT * FROM challenges WHERE id = ?", v.challenge_id);
  if (!c) return new Response("Not found", { status: 404 });
  const data = spaceData(c, v.owner_key || null);
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script id="misogi-data" type="application/json">${inlineJson(data)}</script>${bootstrap(v.id)}`;
  const origin = originOf(req);
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com data:",
    `img-src data: blob: ${origin}`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-scripts",
  ].join("; ");
  return new Response(inject(v.html, head), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  });
}
