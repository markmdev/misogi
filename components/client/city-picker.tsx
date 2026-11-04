"use client";

import { useId, useRef, useState } from "react";
import { setCityAction } from "@/app/actions";
import { Spinner } from "./space-frame";

export type PickedCity = { key: string; label: string };

/** A city from Misogi's list, suggested as you type. Only a suggestion can be picked. */
export function CityPicker({ id, value, onChange }: { id?: string; value: PickedCity | null; onChange: (c: PickedCity | null) => void }) {
  const list = useId();
  const [text, setText] = useState(value?.label ?? "");
  const [options, setOptions] = useState<PickedCity[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const asked = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function suggest(typed: string) {
    const q = typed.trim();
    const n = ++asked.current;
    if (timer.current) clearTimeout(timer.current);
    if (q.length < 2) return setOptions([]);
    timer.current = setTimeout(async () => {
      const r = await fetch(`/api/cities?q=${encodeURIComponent(q)}`).catch(() => null);
      const body = r?.ok ? ((await r.json()) as { cities: PickedCity[] }) : { cities: [] };
      if (n === asked.current) {
        setOptions(body.cities.map((c) => ({ key: c.key, label: c.label })));
        setActive(0);
      }
    }, 150);
  }

  function pick(c: PickedCity) {
    onChange(c);
    setText(c.label);
    setOpen(false);
  }

  const showing = open && !value && options.length > 0;
  return (
    <div className="relative">
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={showing}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={showing ? `${list}-${active}` : undefined}
        autoComplete="off"
        maxLength={80}
        placeholder="Start typing your city"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          suggest(e.target.value);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          // Typed in full but not picked ("Lisbon"): take the first suggestion, which is the biggest place by that name.
          const typed = text.trim().toLowerCase();
          if (!value && typed && options[0]?.label.toLowerCase().startsWith(typed)) pick(options[0]);
        }}
        onKeyDown={(e) => {
          if (!showing) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(options[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {showing && (
        <ul id={list} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-[18px] bg-white py-1 text-left shadow-[var(--shadow-float)] ring-1 ring-line">
          {options.map((c, i) => (
            <li
              key={c.key}
              id={`${list}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-4 py-2.5 text-[15px] text-ink ${i === active ? "bg-cream-2" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(c)}
            >
              {c.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const CITY_HELP = "Puts your Muse on the world map. Only the city shows.";

/** The "Your city" row on a person's own profile. */
export function MyCity({ initial }: { initial: PickedCity | null }) {
  const [city, setCity] = useState<PickedCity | null>(initial);
  const [saved, setSaved] = useState<PickedCity | null>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: PickedCity | null) {
    setPending(true);
    setError(null);
    const r = await setCityAction(next?.key ?? null);
    setPending(false);
    if (!r.ok) return setError(r.error);
    setSaved(next);
  }

  return (
    <div className="card mt-8 p-5">
      <label className="label" htmlFor="my-city">
        Your city (optional)
      </label>
      <div className="mt-2">
        <CityPicker
          key={saved?.key ?? "none"}
          id="my-city"
          value={city}
          onChange={(c) => {
            setCity(c);
            if (c) void save(c);
          }}
        />
      </div>
      <div className="mt-2 flex items-center gap-3 text-[13px] text-ink-3">
        <span className="flex-1">{CITY_HELP}</span>
        {pending && <Spinner />}
        {saved && !pending && (
          <button
            type="button"
            className="font-bold text-ink-2 underline"
            onClick={() => {
              setCity(null);
              void save(null);
            }}
          >
            Take me off the map
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-[14px] font-bold text-coral-deep">{error}</p>}
    </div>
  );
}
