import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { one } from "@/lib/server/db";
import { originOf } from "@/lib/server/http";
import { inlineJson, spaceData } from "@/lib/server/space-data";
import { getVersion, savedMarks } from "@/lib/server/spaces";
import type { ChallengeRow } from "@/lib/server/domain/challenges";

export const dynamic = "force-dynamic";

function bootstrap(versionId: string, canSave: boolean) {
  // Reports runtime errors and content height to the Misogi page that embeds this space, and hands it what the
  // person saves (misogiSave), since the page itself can't reach the network. The sandbox has no storage, and some
  // browsers' in-app scripts read localStorage in every frame: an in-memory one keeps that from counting as the page's
  // error, and errors from any script file but this page's own aren't the page's either.
  return `<script>(function(){var id=${JSON.stringify(versionId)};var sent=0;
function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}
try{localStorage}catch(e){try{Object.defineProperty(window,"localStorage",{value:mem(),configurable:true});Object.defineProperty(window,"sessionStorage",{value:mem(),configurable:true})}catch(e2){}}
function post(m){try{m.source="misogi-space";m.id=id;parent.postMessage(m,"*")}catch(e){}}
window.misogiSave=function(v){if(${canSave})post({type:"save",data:v})};
function err(msg,shows){if(sent++<3)post({type:"error",message:String(msg||"error").slice(0,300),shows:!!shows})}
addEventListener("error",function(e){if(!e.filename||e.filename===location.href)err(e.message)});
addEventListener("unhandledrejection",function(e){err(e.reason&&e.reason.message||e.reason)});
var last=0;function size(){var h=Math.ceil(Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0));if(Math.abs(h-last)>2){last=h;post({type:"height",height:h})}}
addEventListener("load",function(){size();if(window.ResizeObserver)new ResizeObserver(size).observe(document.body||document.documentElement);setTimeout(size,400);setTimeout(size,1500);
setTimeout(function(){var b=document.body;if(!b||(!b.innerText.trim()&&!b.querySelector("svg,canvas,img")))err("The page rendered blank.");var h=document.documentElement.scrollHeight;if(h>6000)err("The page is "+h+" px tall, and the frame cuts it off at 6000. Keep the whole page under 3000 px; the frame grows to fit the page, so size nothing with vh.",1);var d=document.documentElement;if(d.scrollWidth>d.clientWidth+1)err("The page is "+d.scrollWidth+" px wide in a "+d.clientWidth+" px frame, so it scrolls sideways. Make everything fit the frame's width: let rows wrap, let fixed-width items shrink, and keep any long strip inside its own overflow-x:auto box.",1)},2500)});
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
  // The home page shows someone's page as an example, with nowhere to save to: there it keeps nothing.
  const viewer = req.nextUrl.searchParams.has("showcase") ? null : await currentUser();
  const data = { ...spaceData(c, v.owner_key || null), saved: savedMarks(c.id, v.owner_key, viewer?.id ?? null), can_save: !!viewer };
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script id="misogi-data" type="application/json">${inlineJson(data)}</script>${bootstrap(v.id, !!viewer)}`;
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
