"use client";

import { useCallback, useEffect, useState } from "react";

import { MoonIcon, SunIcon, SystemIcon } from "@/components/icons";

export type ThemePreference = "system" | "light" | "dark";

export const THEME_KEY = "docuchat.theme";
export const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: typeof SunIcon }[] = [
  { value: "system", label: "System", Icon: SystemIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
];

/**
 * Inline script for <head>: applies the saved theme before first paint so the
 * page never flashes the wrong colors. Kept tiny and dependency-free.
 */
export const themeInitScript = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/** Current theme preference plus a setter that applies and persists it. */
export function useThemePreference(): [ThemePreference, (pref: ThemePreference) => void] {
  const [pref, setPrefState] = useState<ThemePreference>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") setPrefState(saved);
    } catch {
      // Storage blocked: stay on "system".
    }
  }, []);

  const setPref = useCallback((next: ThemePreference) => {
    setPrefState(next);
    const root = document.documentElement;
    if (next === "system") delete root.dataset.theme;
    else root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage blocked (private mode): the choice just won't persist.
    }
  }, []);

  return [pref, setPref];
}

/** Single icon button that cycles system -> light -> dark (used on auth pages). */
export function ThemeToggle() {
  const [pref, setPref] = useThemePreference();
  const i = THEME_OPTIONS.findIndex((o) => o.value === pref);
  const { label, Icon } = THEME_OPTIONS[i];
  const next = THEME_OPTIONS[(i + 1) % THEME_OPTIONS.length].value;

  return (
    <button
      type="button"
      onClick={() => setPref(next)}
      aria-label={`Theme: ${label}`}
      title={`Theme: ${label}`}
      className="rounded-full p-2 text-muted transition-colors hover:bg-surface-muted hover:text-fg"
    >
      <Icon />
    </button>
  );
}

/** Three-way segmented control (used in the user menu). */
export function ThemeSegmented() {
  const [pref, setPref] = useThemePreference();
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-lg bg-surface-muted p-1">
      {THEME_OPTIONS.map(({ value, label, Icon }) => {
        const active = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPref(value)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              active ? "bg-surface text-primary-strong shadow-sm" : "text-muted hover:text-fg"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
