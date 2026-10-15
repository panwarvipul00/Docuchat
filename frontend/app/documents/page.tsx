"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { ChatIcon, CloseIcon, DocumentIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { useWorkspaces } from "@/components/WorkspaceProvider";
import {
  EmptyState,
  ErrorBanner,
  formatBytes,
  Skeleton,
  StatusBadge,
  SUPPORTED_FILES,
} from "@/components/ui";
import { api, type DocumentItem } from "@/lib/api";

// Mirrors the backend limits so users get instant feedback; the server still
// re-validates (extension + file signature + size) because the client can't be trusted.
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt", ".xlsx", ".csv"];
// Common formats we can't read, with what to do instead (same hints as the backend).
const UNSUPPORTED_HINTS: Record<string, string> = {
  ".xls": "Old .xls files aren't supported. In Excel use File > Save As > .xlsx.",
  ".doc": "Old .doc files aren't supported. In Word use File > Save As > .docx.",
};
const MAX_BYTES = 20 * 1024 * 1024;
// While any document is still being ingested, re-fetch the list on this interval.
// Plain polling is simplest here; SSE/websockets would be overkill for a status flag.
const POLL_MS = 2000;
const IN_PROGRESS: ReadonlySet<DocumentItem["status"]> = new Set(["uploaded", "processing"]);

function validateFile(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return UNSUPPORTED_HINTS[ext] ?? `Only ${SUPPORTED_FILES} files are supported.`;
  }
  if (file.size > MAX_BYTES) return "File is too large (max 20 MB).";
  if (file.size === 0) return "The file is empty.";
  return null;
}

/** One file in the upload queue. Finished uploads leave the queue and join the list. */
interface UploadItem {
  key: number;
  file: File;
  progress: number;
  error: string | null;
}

let nextUploadKey = 1;

export default function DocumentsPage() {
  const { user } = useAuth();
  const { current, loading: wsLoading } = useWorkspaces();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const workspaceId = current?.id;

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      setDocuments(await api.listDocuments(workspaceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasPending = documents.some((d) => IN_PROGRESS.has(d.status));

  useEffect(() => {
    if (!workspaceId || !hasPending) return;
    const timer = setInterval(() => {
      // Silent refresh: no spinner, and keep the current list if a poll fails.
      api.listDocuments(workspaceId).then(setDocuments, () => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [workspaceId, hasPending]);

  const patchUpload = (key: number, patch: Partial<UploadItem>) =>
    setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  /**
   * Queue the files and upload them one at a time: parallel uploads would
   * split the bandwidth (so nothing finishes sooner) and all hit the worker
   * at once. Invalid files show their error in the queue without uploading.
   */
  async function addFiles(files: File[]) {
    if (!workspaceId || files.length === 0) return;
    const items = files.map((file) => ({
      key: nextUploadKey++,
      file,
      progress: 0,
      error: validateFile(file),
    }));
    setUploads((prev) => [...prev, ...items]);

    for (const item of items.filter((i) => !i.error)) {
      try {
        const doc = await api.uploadDocument(workspaceId, item.file, (progress) =>
          patchUpload(item.key, { progress }),
        );
        setDocuments((prev) => [doc, ...prev]);
        setUploads((prev) => prev.filter((u) => u.key !== item.key));
      } catch (err) {
        patchUpload(item.key, { error: err instanceof Error ? err.message : "Upload failed." });
      }
    }
  }

  async function deleteDocument(id: number) {
    await api.deleteDocument(id);
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }

  if (wsLoading) return <ListSkeleton />;
  if (!current) return <ErrorBanner message="No workspace found." />;

  const canDelete = (d: DocumentItem) => d.uploaded_by === user?.id || current.role === "owner";
  const readyCount = documents.filter((d) => d.status === "ready").length;
  const uploading = uploads.some((u) => !u.error);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="mt-1 text-sm text-muted">
            {current.name}
            {documents.length > 0 &&
              ` · ${documents.length} document${documents.length === 1 ? "" : "s"}, ${readyCount} ready`}
          </p>
        </div>
        {readyCount > 0 && (
          <Link
            href="/chat"
            className="flex items-center gap-2 rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-muted"
          >
            <ChatIcon size={16} /> Ask about them
          </Link>
        )}
      </div>

      <Dropzone onFiles={(files) => void addFiles(files)} busy={uploading} />

      {uploads.length > 0 && (
        <ul className="space-y-2" aria-label="Uploads">
          {uploads.map((u) => (
            <UploadRow
              key={u.key}
              item={u}
              onDismiss={() => setUploads((prev) => prev.filter((x) => x.key !== u.key))}
            />
          ))}
        </ul>
      )}

      <ErrorBanner message={error} onRetry={() => void load()} />

      {loading && documents.length === 0 ? (
        <ListSkeleton />
      ) : documents.length === 0 ? (
        !error && (
          <EmptyState
            icon={<DocumentIcon size={22} />}
            title="No documents yet"
            description={`Upload a ${SUPPORTED_FILES} file above. Once it's processed you can ask questions about it.`}
          />
        )
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {documents.map((d) => (
            <DocumentRow
              key={d.id}
              doc={d}
              onDelete={canDelete(d) ? () => deleteDocument(d.id) : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Dropzone({ onFiles, busy }: { onFiles: (files: File[]) => void; busy: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child element; count them so the
  // highlight doesn't flicker as the pointer crosses the zone's contents.
  const depth = useRef(0);

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()} // required, or the browser opens the file
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={`relative flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
        dragging ? "border-primary bg-primary-soft" : "border-border-strong bg-surface"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ALLOWED_EXTENSIONS.join(",")}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = ""; // allow re-selecting the same file
        }}
        className="hidden"
      />
      <span
        className={`mb-3 flex h-11 w-11 items-center justify-center rounded-full ${
          dragging ? "bg-primary text-primary-fg" : "bg-primary-soft text-primary-strong"
        }`}
      >
        <UploadIcon size={20} />
      </span>
      <p className="text-sm font-medium">
        {dragging ? (
          "Drop to upload"
        ) : (
          <>
            Drag files here, or{" "}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="font-semibold text-primary underline-offset-2 hover:underline"
            >
              browse
            </button>
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-muted">
        PDF, DOCX, TXT, XLSX, CSV · max 20 MB each{busy ? " · uploading…" : ""}
      </p>
    </div>
  );
}

function UploadRow({ item, onDismiss }: { item: UploadItem; onDismiss: () => void }) {
  const pct = Math.round(item.progress * 100);
  return (
    <li
      className={`rounded-lg border px-4 py-3 text-sm ${
        item.error ? "border-danger-border bg-danger-soft" : "border-border bg-surface"
      }`}
    >
      <div className="flex items-center gap-3">
        <DocumentIcon size={16} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate font-medium">{item.file.name}</span>
        <span className="shrink-0 text-xs text-muted">{formatBytes(item.file.size)}</span>
        {item.error ? (
          <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-danger">
            <CloseIcon size={16} />
          </button>
        ) : (
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted">{pct}%</span>
        )}
      </div>
      {item.error ? (
        <p className="mt-1 pl-7 text-xs text-danger">{item.error}</p>
      ) : (
        <div className="ml-7 mt-2 h-1 overflow-hidden rounded bg-border">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </li>
  );
}

function DocumentRow({ doc, onDelete }: { doc: DocumentItem; onDelete?: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!onDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(); // the parent removes the row on success
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the document.");
      setDeleting(false);
      setConfirming(false);
    }
  }

  const meta = [
    doc.file_type.toUpperCase(),
    formatBytes(doc.file_size),
    pageCountLabel(doc),
    new Date(doc.created_at).toLocaleDateString(),
  ].filter(Boolean);

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-strong sm:flex">
          <DocumentIcon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={doc.title}>
            {doc.title}
          </p>
          <p className="truncate text-xs text-muted">{meta.join(" · ")}</p>
        </div>
        <StatusBadge status={doc.status} />
        {doc.status === "ready" && !confirming && (
          <Link
            href={`/chat?doc=${doc.id}`}
            title={`Start a chat about ${doc.title} only`}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft"
          >
            <ChatIcon size={14} />
            <span className="hidden sm:inline">Ask</span>
          </Link>
        )}
        {onDelete &&
          (confirming ? (
            <span className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-surface disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-muted"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              aria-label={`Delete ${doc.title}`}
              title="Delete"
              className="shrink-0 rounded-md p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
            >
              <TrashIcon size={16} />
            </button>
          ))}
      </div>
      {confirming && !deleting && (
        <p className="mt-2 text-xs text-muted sm:pl-12">
          This removes the file and its search index. Past answers keep their text, but their
          citations to it won&apos;t open.
        </p>
      )}
      {doc.status === "failed" && doc.error_message && (
        <p className="mt-1 text-xs text-danger sm:pl-12">{doc.error_message}</p>
      )}
      {error && <p className="mt-1 text-xs text-danger sm:pl-12">{error}</p>}
    </li>
  );
}

/** "12 pages" / "3 sheets"; nothing for CSV (always one table) or before processing. */
function pageCountLabel(doc: DocumentItem): string | null {
  if (!doc.page_count || doc.file_type === "csv") return null;
  const unit = doc.file_type === "xlsx" ? "sheet" : "page";
  return `${doc.page_count} ${unit}${doc.page_count === 1 ? "" : "s"}`;
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading documents">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}
