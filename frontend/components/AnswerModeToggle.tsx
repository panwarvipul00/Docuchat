"use client";

import type { AnswerMode } from "@/lib/api";

const MODES: { mode: AnswerMode; label: string; title: string }[] = [
  {
    mode: "documents",
    label: "Docs only",
    title: "Answer strictly from your documents, with citations",
  },
  {
    mode: "general",
    label: "Docs + general",
    title:
      "Use your documents first; fill gaps with general knowledge, clearly labelled as not from your documents",
  },
];

/** Segmented control: may answers use general knowledge, or only the documents? */
export function AnswerModeToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: AnswerMode;
  onChange: (mode: AnswerMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Answer from"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5 text-xs"
    >
      {MODES.map(({ mode, label, title }) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            title={title}
            disabled={disabled}
            onClick={() => !active && onChange(mode)}
            className={`rounded-full px-2.5 py-1 font-medium transition-colors disabled:opacity-50 ${
              active
                ? mode === "general"
                  ? "bg-accent-soft text-accent-fg"
                  : "bg-primary-soft text-primary-strong"
                : "text-muted hover:text-fg"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
