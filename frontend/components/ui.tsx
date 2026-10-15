import { BrandGlyph } from "@/components/icons";
import type { DocumentStatus } from "@/lib/api";

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-primary ${className}`}
    />
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="whitespace-pre-line rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      {message}
    </div>
  );
}

// Amber marks "in progress" so it stands apart from violet UI chrome.
const STATUS_STYLES: Record<DocumentStatus, string> = {
  uploaded: "bg-surface-muted text-muted",
  processing: "bg-accent-soft text-accent-fg",
  ready: "bg-success-soft text-success-fg",
  failed: "bg-danger-soft text-danger",
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const busy = status === "uploaded" || status === "processing";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {busy && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {status}
    </span>
  );
}

/** Amber "[n] Title, p. N" chip used for answer citations. */
export function CitationChip({ index, title, page }: { index: number; title: string; page: number }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-xs text-accent-fg">
      <span className="font-semibold">[{index}]</span>
      <span className="truncate">{title}</span>
      <span className="shrink-0 opacity-80">p. {page}</span>
    </span>
  );
}

/** Brand mark: gradient violet tile with a doc-chat glyph and amber dot, plus wordmark. */
export function Logo({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-primary to-primary-hover text-primary-fg shadow-md shadow-primary/30"
        aria-hidden
      >
        <BrandGlyph size={18} />
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface" />
      </span>
      {!compact && (
        <span className="font-display text-xl font-extrabold tracking-tight text-fg">
          Docu<span className="text-primary">Chat</span>
        </span>
      )}
    </span>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
