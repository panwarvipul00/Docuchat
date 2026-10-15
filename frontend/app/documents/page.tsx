"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useWorkspaces } from "@/components/WorkspaceProvider";
import { ErrorBanner, formatBytes, Spinner, StatusBadge } from "@/components/ui";
import { api, type DocumentItem } from "@/lib/api";

// Mirrors the backend limits so users get instant feedback; the server still
// re-validates (extension + file signature + size) because the client can't be trusted.
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];
const MAX_BYTES = 20 * 1024 * 1024;
// While any document is still being ingested, re-fetch the list on this interval.
// Plain polling is simplest here; SSE/websockets would be overkill for a status flag.
const POLL_MS = 2000;
const IN_PROGRESS: ReadonlySet<DocumentItem["status"]> = new Set(["uploaded", "processing"]);

function validateFile(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) return "Only PDF, DOCX, and TXT files are supported.";
  if (file.size > MAX_BYTES) return "File is too large (max 20 MB).";
  if (file.size === 0) return "The file is empty.";
  return null;
}

export default function DocumentsPage() {
  const { current, loading: wsLoading } = useWorkspaces();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file || !workspaceId) return;

    const invalid = validateFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }

    setError(null);
    setProgress(0);
    try {
      const doc = await api.uploadDocument(workspaceId, file, setProgress);
      setDocuments((prev) => [doc, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setProgress(null);
    }
  }

  if (wsLoading) return <Spinner />;
  if (!current) return <ErrorBanner message="No workspace found." />;

  const uploading = progress !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="mt-1 text-sm text-muted">{current.name}</p>
        </div>
        <div>
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_EXTENSIONS.join(",")}
            onChange={onFileChosen}
            className="hidden"
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
          >
            {uploading ? `Uploading… ${Math.round((progress ?? 0) * 100)}%` : "Upload document"}
          </button>
          <p className="mt-1 text-right text-xs text-muted">PDF, DOCX, TXT · max 20 MB</p>
        </div>
      </div>

      {uploading && (
        <div className="h-1.5 w-full overflow-hidden rounded bg-border">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
          />
        </div>
      )}

      <ErrorBanner message={error} />

      {loading && documents.length === 0 ? (
        <Spinner />
      ) : documents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong bg-surface p-10 text-center text-sm text-muted">
          No documents yet. Upload a PDF, DOCX, or TXT file to get started.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Size</th>
                <th className="px-4 py-2 font-medium">Pages</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {documents.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2 font-medium">{d.title}</td>
                  <td className="px-4 py-2 uppercase text-muted">{d.file_type}</td>
                  <td className="px-4 py-2 text-muted">{formatBytes(d.file_size)}</td>
                  <td className="px-4 py-2 text-muted">{d.page_count ?? "—"}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={d.status} />
                    {d.status === "failed" && d.error_message && (
                      <p className="mt-1 max-w-xs text-xs text-danger">{d.error_message}</p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {new Date(d.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
