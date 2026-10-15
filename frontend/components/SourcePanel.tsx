"use client";

import { useEffect, useState } from "react";

import { CloseIcon, DocumentIcon } from "@/components/icons";
import { ErrorBanner, Skeleton, sourceLocation } from "@/components/ui";
import { api, ApiError, type Citation, type SourceChunk } from "@/lib/api";

// Passages never change once ingested, so cache them for the whole session:
// re-opening a citation is instant and doesn't hit the API again.
const cache = new Map<number, SourceChunk>();

type State =
  | { status: "loading" }
  | { status: "ready"; chunk: SourceChunk }
  | { status: "error"; message: string };

/**
 * Slide-over panel showing the exact passage an answer cited. Citations only
 * store the chunk id, so the text is fetched on demand from /chunks/{id}/.
 */
export function SourcePanel({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const cached = cache.get(citation.chunk_id);
    if (cached) {
      setState({ status: "ready", chunk: cached });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    api
      .getChunk(citation.chunk_id)
      .then((chunk) => {
        cache.set(chunk.id, chunk);
        if (!cancelled) setState({ status: "ready", chunk });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError && err.status === 404
            ? "This passage is no longer available. The document may have been deleted."
            : err instanceof Error
              ? err.message
              : "Could not load the source.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [citation.chunk_id, attempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop only on small screens; on desktop the chat stays usable beside the panel. */}
      <div className="fixed inset-0 z-40 bg-fg/30 lg:hidden" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={`Source ${citation.index}: ${citation.title}`}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-2xl border border-border bg-surface shadow-2xl lg:inset-y-0 lg:left-auto lg:right-0 lg:top-16 lg:max-h-none lg:w-[26rem] lg:rounded-none lg:border-y-0 lg:border-r-0"
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <span className="mt-0.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-accent-soft px-1.5 text-xs font-bold text-accent-fg">
            {citation.index}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate font-medium">
              <DocumentIcon size={15} className="shrink-0 text-primary" />
              <span className="truncate">{citation.title}</span>
            </p>
            <p className="text-xs capitalize text-muted">
              {sourceLocation(citation.page, citation.file_type, "long") ?? "Table"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close source"
            className="rounded-md p-1 text-muted hover:bg-surface-muted hover:text-fg"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state.status === "loading" && (
            <div className="space-y-2.5">
              {["w-full", "w-11/12", "w-full", "w-4/5", "w-full", "w-2/3"].map((w, i) => (
                <Skeleton key={i} className={`h-3.5 ${w}`} />
              ))}
            </div>
          )}
          {state.status === "error" && (
            <ErrorBanner message={state.message} onRetry={() => setAttempt((a) => a + 1)} />
          )}
          {state.status === "ready" && (
            <>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                Passage sent to the model
              </p>
              <blockquote className="whitespace-pre-wrap border-l-4 border-accent pl-4 text-sm leading-7 text-fg-soft">
                {state.chunk.content}
              </blockquote>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
