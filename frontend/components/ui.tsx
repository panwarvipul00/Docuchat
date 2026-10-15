import { BrandGlyph } from "@/components/icons";
import type { DocumentFileType, DocumentStatus } from "@/lib/api";

/** File types users can upload; mirrors the backend validator. */
export const SUPPORTED_FILES = "PDF, DOCX, TXT, XLSX, or CSV";

/**
 * Where a citation points, in words: "p. 3" / "page 3" for documents,
 * "sheet 2" for Excel. A CSV is a single table, so it has no location.
 */
export function sourceLocation(
  page: number,
  fileType?: DocumentFileType,
  style: "short" | "long" = "short",
): string | null {
  if (fileType === "csv") return null;
  if (fileType === "xlsx") return `sheet ${page}`;
  return style === "short" ? `p. ${page}` : `page ${page}`;
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-primary ${className}`}
    />
  );
}

/** Grey placeholder block shown while content loads (less jumpy than a spinner). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-md bg-surface-muted ${className}`} />;
}

export function ErrorBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string | null;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      <span className="flex-1 whitespace-pre-line">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 font-semibold underline underline-offset-2">
          Retry
        </button>
      )}
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
          ×
        </button>
      )}
    </div>
  );
}

/** Friendly placeholder for "nothing here yet", with an optional call to action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
      {icon && (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary-strong">
          {icon}
        </span>
      )}
      <p className="font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
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

/** Amber "[n] Title, p. N" chip used for answer citations; clickable when onClick is set. */
export function CitationChip({
  index,
  title,
  page,
  fileType,
  active = false,
  onClick,
}: {
  index: number;
  title: string;
  page: number;
  fileType?: DocumentFileType;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-pressed={active}
      title={`Show source: ${[title, sourceLocation(page, fileType, "long")].filter(Boolean).join(", ")}`}
      className={`inline-flex max-w-full items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-xs text-accent-fg transition enabled:hover:ring-1 enabled:hover:ring-accent ${
        active ? "ring-2 ring-accent" : ""
      }`}
    >
      <span className="font-semibold">[{index}]</span>
      <span className="truncate">{title}</span>
      {sourceLocation(page, fileType) && (
        <span className="shrink-0 opacity-80">{sourceLocation(page, fileType)}</span>
      )}
    </button>
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
