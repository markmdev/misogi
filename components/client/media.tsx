"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { uploadLinkAction } from "@/app/actions";
import { shortDate } from "@/lib/shared/format";
import type { LogMedia } from "@/lib/shared/types";
import { cx, Icon } from "../ui";
import { Fresh } from "./live";
import { Sheet } from "./sheet";

const MAX = 4;

type Item = { key: string; file: File; preview: string; progress: number; media?: LogMedia; error?: string };

function put(url: string, file: File, onProgress: (p: number) => void): Promise<LogMedia> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { media_id?: string; error?: { message: string; hint?: string } } & Partial<LogMedia> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* reported below */
      }
      if (xhr.status === 201 && body.media_id) resolve({ ...(body as LogMedia), id: body.media_id });
      else reject(new Error(body.error ? [body.error.message, body.error.hint].filter(Boolean).join(" ") : "That didn't upload. Try again."));
    };
    xhr.onerror = () => reject(new Error("That didn't upload. Check your connection and try again."));
    xhr.send(file);
  });
}

/**
 * Photos and videos for a new log: each uploads as soon as it's picked, so it's ready by the time the
 * person has written their note. `onChange` gets the ids of the finished ones; `busy` is true while any is uploading.
 */
export function MediaPicker({ slug, onChange, disabled }: { slug: string; onChange: (ids: string[], busy: boolean) => void; disabled?: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const link = useRef<{ url: Promise<string>; at: number } | null>(null);
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  });
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
    changed.current(items.filter((i) => i.media).map((i) => i.media!.id), items.some((i) => !i.media && !i.error));
  }, [items]);
  useEffect(() => () => latest.current.forEach((i) => URL.revokeObjectURL(i.preview)), []);

  const update = (key: string, patch: Partial<Item>) => setItems((all) => all.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  // A link lasts 30 minutes; a sheet left open longer gets a new one.
  function uploadUrl() {
    if (!link.current || Date.now() - link.current.at > 25 * 60_000) {
      const url = uploadLinkAction(slug).then((r) => {
        if (!r.ok) {
          link.current = null;
          throw new Error(r.error);
        }
        return r.data!.url;
      });
      link.current = { url, at: Date.now() };
    }
    return link.current.url;
  }

  function add(files: FileList | null) {
    const picked = Array.from(files ?? []).slice(0, MAX - items.length);
    const added = picked.map((file) => ({ key: `${file.name}:${file.size}:${Math.random()}`, file, preview: URL.createObjectURL(file), progress: 0 }));
    setItems((all) => [...all, ...added]);
    for (const it of added) {
      uploadUrl()
        .then((url) => put(url, it.file, (p) => update(it.key, { progress: p })))
        .then((media) => update(it.key, { media, progress: 1 }))
        .catch((e: Error) => update(it.key, { error: e.message }));
    }
  }

  return (
    <div>
      <span className="label">Photo or video</span>
      <div className="mt-1.5 grid grid-cols-4 gap-2">
        {items.map((i) => (
          <div key={i.key} className="relative aspect-square overflow-hidden rounded-xl bg-cream-2 ring-1 ring-line">
            {i.file.type.startsWith("video/") ? (
              <video src={i.preview} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={i.preview} alt="" className="h-full w-full object-cover" />
            )}
            {!i.media && !i.error && (
              <div className="absolute inset-x-1.5 bottom-1.5 h-1.5 overflow-hidden rounded-full bg-white/70">
                <div className="h-full rounded-full bg-moss transition-[width]" style={{ width: `${Math.max(6, i.progress * 100)}%` }} />
              </div>
            )}
            {i.error && <div className="absolute inset-0 grid place-items-center bg-ink/55 p-1 text-center text-[11px] leading-4 font-extrabold text-white">Didn&apos;t upload</div>}
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(i.preview);
                setItems((all) => all.filter((x) => x.key !== i.key));
              }}
              aria-label="Remove"
              className="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-ink-2 ring-1 ring-line"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
        {items.length < MAX && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => input.current?.click()}
            className={cx(
              "flex items-center justify-center rounded-xl border-2 border-dashed border-line-2 bg-white font-extrabold text-ink-2 hover:text-ink",
              items.length ? "aspect-square flex-col gap-0.5 text-[12px]" : "col-span-4 h-[64px] gap-2 text-[15px]",
            )}
          >
            <Icon name="camera" size={items.length ? 28 : 32} />
            {items.length ? "Add" : "Add a photo or video"}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
      {items.find((i) => i.error) && <p className="mt-1.5 text-[13px] font-bold text-coral-deep">{items.find((i) => i.error)!.error}</p>}
      <p className="mt-1.5 text-[13px] font-bold text-ink-3">Your climb page is public, so anyone with its link sees these.</p>
    </div>
  );
}

/** One photo or video, big, with the log's words under it. */
function Viewer({ item, words, date, onClose }: { item: LogMedia | null; words?: string | null; date?: string; onClose: () => void }) {
  return (
    <Sheet open={!!item} onClose={onClose} title={date ? shortDate(date) : "Photo"} wide>
      {item &&
        (item.kind === "video" ? (
          <video src={item.url} controls playsInline autoPlay className="max-h-[70dvh] w-full rounded-[18px] bg-ink" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.caption ?? ""} className="max-h-[70dvh] w-full rounded-[18px] object-contain" />
        ))}
      {words && <p className="mt-3 text-[15px] leading-6 text-ink-2">{words}</p>}
    </Sheet>
  );
}

/** The photo's own shape, so a tile shows it whole. */
function ratio(m: LogMedia) {
  return m.width && m.height ? m.width / m.height : 1;
}

function Tile({ item, onOpen, className, small }: { item: LogMedia; onOpen: () => void; className?: string; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={item.kind === "video" ? "Play the video" : "Open the photo"}
      className={cx("relative block overflow-hidden rounded-[14px] bg-cream-2 ring-1 ring-line", className)}
      style={{ aspectRatio: ratio(item) }}
    >
      {item.kind === "video" ? (
        <>
          <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
          <span className="absolute inset-0 grid place-items-center">
            <span className={cx("grid place-items-center rounded-full bg-white/90 shadow", small ? "h-8 w-8" : "h-10 w-10")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 text-ink" aria-hidden>
                <path d="M7 4.5v15l13-7.5z" />
              </svg>
            </span>
          </span>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.thumb_url ?? item.url} alt={item.caption ?? ""} loading="lazy" className="h-full w-full object-cover" />
      )}
    </button>
  );
}

/** A log's photos and videos small under its words, each whole at its own shape; the wall above is where they're big. */
export function LogMediaRow({ media, words, date }: { media: LogMedia[]; words?: string | null; date: string }) {
  const [open, setOpen] = useState<LogMedia | null>(null);
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {media.map((m) => (
          <Tile key={m.id} item={m} onOpen={() => setOpen(m)} small className="h-[88px] max-w-full" />
        ))}
      </div>
      <Viewer item={open} words={words} date={date} onClose={() => setOpen(null)} />
    </>
  );
}

const WALL_FIRST = 8;

/** Every photo and video on a climb, newest first: the wall, its newest few until someone asks for all. */
export function PhotoWall({ items }: { items: WallItem[] }) {
  const [open, setOpen] = useState<(typeof items)[number] | null>(null);
  const [all, setAll] = useState(false);
  return (
    <>
      <div className="columns-2 gap-2.5 sm:columns-3 lg:columns-4">
        {(all ? items : items.slice(0, WALL_FIRST)).map((m) => (
          <div key={m.id} className="mb-2.5 break-inside-avoid">
            <Tile item={m} onOpen={() => setOpen(m)} className="w-full" />
            <div className="mt-1 px-1 text-[12px] font-extrabold text-ink-3">{shortDate(m.date)}</div>
          </div>
        ))}
      </div>
      {!all && items.length > WALL_FIRST && (
        <div className="mt-1 flex justify-center">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(true)}>
            Show all {items.length}
          </button>
        </div>
      )}
      <Viewer item={open} words={open ? open.note || open.caption : null} date={open?.date} onClose={() => setOpen(null)} />
    </>
  );
}

type WallItem = LogMedia & { date: string; note: string; label: string | null };
type Stuck = WallItem & { sticker: NonNullable<LogMedia["sticker"]> };

const STICKERS_FIRST = 12;
const TILTS = [-6, 4, -3, 6, -5, 3];

/**
 * The things SAM 3.1 cut out of a climber's photos, as felt stickers, newest first. One that lands while the page
 * is open shows its photo first, then SAM's cut lights up as the rest dims, lifts off and the photo falls away.
 */
export function StickerBoard({ items }: { items: WallItem[] }) {
  const stuck = items.filter((m): m is Stuck => !!m.sticker);
  const [open, setOpen] = useState<Stuck | null>(null);
  const [all, setAll] = useState(false);
  return (
    <>
      <div className="sticker-board flex flex-wrap gap-x-3 gap-y-4 sm:gap-x-7 sm:gap-y-5">
        {/* All mount at once, so the ones behind "Show all" don't play a landing when they appear. */}
        {stuck.map((m, i) => (
          <Fresh key={m.id} arrive="sticker-arrive" className={!all && i >= STICKERS_FIRST ? "hidden" : undefined}>
            <Sticker item={m} onOpen={() => setOpen(m)} />
          </Fresh>
        ))}
      </div>
      {!all && stuck.length > STICKERS_FIRST && (
        <div className="mt-3 flex justify-center">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(true)}>
            Show all {stuck.length}
          </button>
        </div>
      )}
      <Viewer item={open} words={open ? open.note || open.caption : null} date={open?.date} onClose={() => setOpen(null)} />
    </>
  );
}

function Sticker({ item, onOpen }: { item: Stuck; onOpen: () => void }) {
  const { url, what, x, y, w, h } = item.sticker;
  const shape = ((item.width ?? 1) * w) / ((item.height ?? 1) * h);
  const tilt = TILTS[[...item.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % TILTS.length];
  const name = item.label || what;
  return (
    <button type="button" onClick={onOpen} aria-label={`Open the photo of ${name}`} className="group flex w-[var(--cell)] flex-col items-center">
      <span className="grid size-[var(--cell)] place-items-center">
        <span className="relative block" style={{ width: `calc(var(--cell) * ${Math.min(1, shape).toFixed(3)})`, aspectRatio: shape }}>
          <span className="sticker-photo absolute inset-0 overflow-hidden rounded-[10px]">
            <span
              className="absolute"
              style={{
                left: `${(-x / w) * 100}%`,
                top: `${(-y / h) * 100}%`,
                width: `${100 / w}%`,
                height: `${100 / h}%`,
                ["--photo" as string]: `url(${item.thumb_url ?? item.url})`,
              }}
            />
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={what} loading="lazy" draggable={false} className="sticker-art absolute inset-0 h-full w-full select-none" style={{ ["--tilt" as string]: `${tilt}deg` }} />
        </span>
      </span>
      <span className="mt-2 line-clamp-2 text-center text-[13px] leading-4 font-extrabold text-ink-2 break-words first-letter:uppercase">
        {name.split("/").map((part, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <>
                /<wbr />
              </>
            )}
            {part}
          </Fragment>
        ))}
      </span>
      <span className="mt-0.5 text-[12px] font-bold text-ink-3">{shortDate(item.date)}</span>
    </button>
  );
}
