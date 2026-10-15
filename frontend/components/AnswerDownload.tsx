"use client";

import { useEffect, useRef, useState } from "react";

import { ChevronDownIcon, DownloadIcon } from "@/components/icons";
import { api, saveFile, type ExportFormat } from "@/lib/api";

const FORMATS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: "docx", label: "Word document", hint: ".docx" },
  { format: "md", label: "Markdown", hint: ".md" },
];

/** "Download ▾" under an answer: saves it as Word or Markdown, with its sources. */
export function AnswerDownload({ messageId }: { messageId: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  async function download(format: ExportFormat) {
    setOpen(false);
    setBusy(format);
    setError(null);
    try {
      saveFile(await api.exportAnswer(messageId, format));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-muted hover:text-fg disabled:opacity-60"
      >
        <DownloadIcon size={14} />
        {busy ? "Preparing…" : "Download"}
        <ChevronDownIcon size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {FORMATS.map(({ format, label, hint }) => (
            <button
              key={format}
              role="menuitem"
              onClick={() => void download(format)}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface-muted"
            >
              {label}
              <span className="text-xs text-muted">{hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
