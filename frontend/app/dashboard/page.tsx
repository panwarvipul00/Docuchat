"use client";

import Link from "next/link";
import { useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useWorkspaces } from "@/components/WorkspaceProvider";
import { ErrorBanner, Spinner } from "@/components/ui";

export default function DashboardPage() {
  const { user } = useAuth();
  const { workspaces, current, loading, error, select, create } = useWorkspaces();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await create(name.trim());
      setName("");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create workspace.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Welcome{user?.full_name ? `, ${user.full_name}` : ""}</h1>
        <p className="mt-1 text-sm text-muted">
          Upload documents to a workspace, then ask questions about them.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Your workspaces</h2>
        <ErrorBanner message={error} />
        {loading ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {workspaces.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="font-medium">
                    {w.name}
                    {current?.id === w.id && (
                      <span className="ml-2 text-xs font-normal text-muted">(current)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted">{w.role}</p>
                </div>
                <Link
                  href="/documents"
                  onClick={() => select(w.id)}
                  className="rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-surface-muted"
                >
                  Open documents
                </Link>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={onCreate} className="flex max-w-md gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New workspace name"
            maxLength={200}
            className="flex-1 rounded-md border border-border-strong bg-surface px-3 py-2 text-sm focus:border-primary"
          />
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
          >
            Create
          </button>
        </form>
        <ErrorBanner message={createError} />
      </section>
    </div>
  );
}
