"use client";

import { useId, useRef, useState } from "react";
import { setCityAction } from "@/app/actions";
import { Spinner } from "./space-frame";

export type PickedCity = { key: string; label: string };
type Option = PickedCity & { name: string };

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** A city from Misogi's list, suggested as you type. Only a suggestion can be picked. */
export function CityPicker({ id, value, onChange }: { id?: string; value: PickedCity | null; onChange: (c: PickedCity | null) => void }) {
  const list = useId();
  const [text, setText] = useState(value?.label ?? "");
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const asked = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function suggest(typed: string) {
    const q = typed.trim();
    const n = ++asked.current;
    if (timer.current) clearTimeout(timer.current);
    if (q.length < 2) return setOptions([]);
    timer.current = setTimeout(async () => {
      const r = await fetch(`/api/cities?q=${encodeURIComponent(q)}`).catch(() => null);
      const body = r?.ok ? ((await r.json()) as { cities: Option[] }) : { cities: [] };
      if (n === asked.current) {
        setOptions(body.cities.map((c) => ({ key: c.key, label: c.label, name: c.name })));
        setActive(0);
      }
    }, 150);
  }

  function pick(c: Option) {
    onChange({ key: c.key, label: c.label });
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
          // Near the bottom of a sheet, or above a phone's keyboard, the suggestions open upwards instead.
          const r = e.currentTarget.getBoundingClientRect();
          const below = (window.visualViewport?.height ?? innerHeight) - r.bottom;
          setUp(below < 200 && r.top > below);
          setText(e.target.value);
          setOpen(true);
          suggest(e.target.value);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          // Typed in full but not picked ("Lisbon"): that's the city, unless another place on the list has the name too.
          const same = options.filter((o) => fold(o.name) === fold(text));
          if (!value && same.length === 1) pick(same[0]);
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
        <ul id={list} role="listbox" className={`absolute inset-x-0 z-20 overflow-hidden ${up ? "bottom-full mb-1" : "top-full mt-1"} rounded-[18px] bg-white py-1 text-left shadow-[var(--shadow-float)] ring-1 ring-line`}
        >
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
      {!value && !open && text.trim() && <p className="mt-1.5 text-[13px] font-bold text-coral-deep">Not set yet: pick your city from the list.</p>}
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
  const [round, setRound] = useState(0);

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
        Your city
      </label>
      <div
        className="mt-2"
        onBlur={(e) => {
          // Emptying the field doesn't take them off the map, so their city comes back.
          if (saved && !(e.target as HTMLInputElement).value.trim()) {
            setCity(saved);
            setRound((n) => n + 1);
          }
        }}
      >
        <CityPicker
          key={`${saved?.key ?? "none"}-${round}`}
          id="my-city"
          value={city}
          onChange={(c) => {
            setCity(c);
            if (c) void save(c);
          }}
        />
      </div>
      <div className="mt-2 flex items-center gap-3 text-[13px] text-ink-3">
        <span className="flex-1">{saved ? `Your Muse is on the world map in ${saved.label}. Only the city shows.` : CITY_HELP}</span>
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
