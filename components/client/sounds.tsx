"use client";

import { useEffect } from "react";

// Made in code rather than recorded, so there's no sound file to license.

const TARGET = "a[href], button:not(:disabled), select";
const NOTES = [784, 880, 988, 1175, 1319];

let ctx: AudioContext | null = null;
let out: GainNode | null = null;

function audio(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const warm = ctx.createBiquadFilter();
    warm.type = "lowpass";
    warm.frequency.value = 3200;
    out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(warm).connect(ctx.destination);
  }
  return ctx;
}

/** Plays now if sound is on; the first press of a visit plays once the browser lets sound start. */
function play(sound: (a: AudioContext) => void, wait: boolean) {
  const a = audio();
  if (!a) return;
  if (a.state === "running") sound(a);
  else if (wait) void a.resume().then(() => a.state === "running" && sound(a), () => {});
}

function tone(a: AudioContext, from: number, to: number, peak: number, decay: number, type: OscillatorType = "sine") {
  const t = a.currentTime;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + decay);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g).connect(out!);
  o.start(t);
  o.stop(t + decay + 0.02);
}

function thump(a: AudioContext, freq: number, peak: number, decay: number) {
  const t = a.currentTime;
  const n = Math.ceil((decay + 0.01) * a.sampleRate);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = 1.2;
  const g = a.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(f).connect(g).connect(out!);
  src.start(t);
}

function tick(a: AudioContext) {
  const note = NOTES[Math.floor(Math.random() * NOTES.length)];
  tone(a, note, note * 0.97, 0.04, 0.045);
  thump(a, 2400, 0.03, 0.008);
}

function pop(a: AudioContext) {
  tone(a, 330, 196, 0.12, 0.11);
  tone(a, 660, 520, 0.035, 0.05, "triangle");
  thump(a, 700, 0.09, 0.025);
}

/** A tick when a mouse comes onto something you can press, a pop when you press it. */
export function Sounds() {
  useEffect(() => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let woke = false;
    let over: Element | null = null;
    let lastTick = 0;
    let scrolled = 0;
    let mouseDownAt = 0;

    const target = (e: Event) => (e.target instanceof Element ? e.target.closest(TARGET) : null);
    const wake = () => {
      woke = true;
      void audio()?.resume().catch(() => {});
    };

    // A mouse press pops at once. A finger pops on the tap's click instead, so a swipe that starts on a card stays quiet.
    const onDown = (e: PointerEvent) => {
      woke = true;
      if (e.pointerType !== "mouse") return wake();
      mouseDownAt = performance.now();
      if (!calm.matches && target(e)) play(pop, true);
      else wake();
    };
    const onClick = (e: MouseEvent) => {
      if (performance.now() - mouseDownAt < 1000 || calm.matches || !target(e)) return;
      play(pop, true);
    };
    const onOver = (e: PointerEvent) => {
      const el = target(e);
      if (el === over) return;
      over = el;
      if (!el || e.pointerType !== "mouse" || !woke || calm.matches) return;
      const now = performance.now();
      if (now - scrolled < 250 || now - lastTick < 45) return;
      lastTick = now;
      play(tick, false);
    };
    const onScroll = () => {
      scrolled = performance.now();
    };

    const on: [string, EventListener][] = [
      ["pointerdown", onDown as EventListener],
      ["click", onClick as EventListener],
      ["pointerover", onOver as EventListener],
      ["keydown", wake],
      ["touchend", wake],
      ["scroll", onScroll],
      ["wheel", onScroll],
    ];
    for (const [name, fn] of on) window.addEventListener(name, fn, { capture: true, passive: true });
    return () => {
      for (const [name, fn] of on) window.removeEventListener(name, fn, { capture: true });
    };
  }, []);
  return null;
}
