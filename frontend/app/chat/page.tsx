"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useWorkspaces } from "@/components/WorkspaceProvider";
import { ErrorBanner, Spinner } from "@/components/ui";
import { api, type Conversation } from "@/lib/api";

export default function ChatIndexPage() {
  const router = useRouter();
  const { current, loading: wsLoading } = useWorkspaces();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspaceId = current?.id;

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setLoading(true);
    api
      .listConversations(workspaceId)
      .then((list) => !cancelled && setConversations(list))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  async function startChat() {
    if (!workspaceId) return;
    setCreating(true);
    setError(null);
    try {
      const conv = await api.createConversation(workspaceId);
      router.push(`/chat/${conv.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start a conversation.");
      setCreating(false);
    }
  }

  if (wsLoading) return <Spinner />;
  if (!current) return <ErrorBanner message="No workspace found." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Chat</h1>
          <p className="mt-1 text-sm text-muted">
            Ask questions about the documents in {current.name}.
          </p>
        </div>
        <button
          onClick={startChat}
          disabled={creating}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
        >
          New chat
        </button>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner />
      ) : conversations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong bg-surface p-10 text-center text-sm text-muted">
          No conversations yet. Start a new chat to ask your first question.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/chat/${c.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-muted"
              >
                <span className="truncate font-medium">{c.title || "Untitled conversation"}</span>
                <span className="shrink-0 text-xs text-muted">
                  {new Date(c.updated_at).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
