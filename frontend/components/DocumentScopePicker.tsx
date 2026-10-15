"use client";

import { useEffect, useRef, useState } from "react";

import { CheckIcon, ChevronDownIcon, DocumentIcon, SearchIcon } from "@/components/icons";
import { StatusBadge } from "@/components/ui";
import type { DocumentItem } from "@/lib/api";

/** Show the filter box only once the list is long enough to need it. */
const FILTER_THRESHOLD = 6;

/**
 * "Search in: All documents ▾": chooses which documents a chat answers from.
 * An empty selection means every ready document in the workspace.
 * Opens upward because it sits just above the message box.
 */
export function DocumentScopePicker({
  documents,
  selected,
  onChange,
  disabled = false,
}: {
  documents: DocumentItem[];
  selected: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape, like a native menu.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Failed uploads can never be searched, so they aren't offered at all.
  const choices = documents.filter((d) => d.status !== "failed");
  // Ignore ids of documents that were deleted since the chat was scoped.
  const chosen = choices.filter((d) => selected.includes(d.id));
  const label =
    chosen.length === 0
      ? "All documents"
      : chosen.length === 1
        ? chosen[0].title
        : `${chosen.length} documents`;

  const q = filter.trim().toLowerCase();
  const visible = q ? choices.filter((d) => d.title.toLowerCase().includes(q)) : choices;

  function toggle(id: number) {
    const ids = chosen.map((d) => d.id);
    onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled || choices.length === 0}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={chosen.length > 1 ? chosen.map((d) => d.title).join("\n") : undefined}
        className={`flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
          chosen.length > 0
            ? "border-primary/40 bg-primary-soft text-primary-strong"
            : "border-border bg-surface text-fg-soft hover:border-border-strong"
        }`}
      >
        <DocumentIcon size={13} className="shrink-0" />
        <span className="shrink-0 text-muted">Search in:</span>
        <span className="truncate font-medium">{label}</span>
        <ChevronDownIcon size={13} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <div className="border-b border-border px-3 py-2">
            <p className="text-xs font-semibold">Which documents should answers come from?</p>
            <p className="text-[11px] text-muted">The choice is saved with this chat.</p>
          </div>

          {choices.length > FILTER_THRESHOLD && (
            <label className="flex items-center gap-2 border-b border-border px-3 py-2">
              <SearchIcon size={14} className="text-muted" />
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter documents…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
              />
            </label>
          )}

          <ul role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto p-1">
            {!q && (
              <Option checked={chosen.length === 0} onClick={() => onChange([])}>
                <span className="font-medium">All documents</span>
                <span className="ml-auto text-[11px] text-muted">{choices.length}</span>
              </Option>
            )}
            {visible.map((d) => (
              <Option key={d.id} checked={chosen.some((c) => c.id === d.id)} onClick={() => toggle(d.id)}>
                <span className="min-w-0 flex-1 truncate" title={d.title}>
                  {d.title}
                </span>
                {/* Still-processing documents can be picked; they'll be searched once ready. */}
                {d.status !== "ready" && <StatusBadge status={d.status} />}
              </Option>
            ))}
            {visible.length === 0 && (
              <li className="px-3 py-4 text-center text-xs text-muted">No documents match.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Option({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <li role="option" aria-selected={checked}>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-muted"
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            checked ? "border-primary bg-primary text-primary-fg" : "border-border-strong"
          }`}
        >
          {checked && <CheckIcon size={11} />}
        </span>
        {children}
      </button>
    </li>
  );
}
