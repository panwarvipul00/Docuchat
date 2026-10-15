"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ChatComposer } from "@/components/ChatComposer";
import { ChatTopBar, useConversations } from "@/components/ChatSidebar";
import { DocumentIcon } from "@/components/icons";
import { useWorkspaces } from "@/components/WorkspaceProvider";
import { EmptyState, ErrorBanner, Logo, Skeleton } from "@/components/ui";
import { api, type DocumentItem } from "@/lib/api";

const SUGGESTIONS = [
  "Summarize the key points of my documents",
  "What are the main conclusions or recommendations?",
  "List any important dates, deadlines, or numbers",
];

/** "New chat": a welcome screen whose first question creates the conversation. */
export default function NewChatPage() {
  const { current, loading: wsLoading } = useWorkspaces();
  const { startChat } = useConversations();
  const [documents, setDocuments] = useState<DocumentItem[] | null>(null);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const workspaceId = current?.id;

  // Only to decide which state to show; asking still works if this fails.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setDocuments(null);
    setDocsError(null);
    api.listDocuments(workspaceId).then(
      (docs) => !cancelled && setDocuments(docs),
      (err: unknown) => {
        if (cancelled) return;
        setDocsError(err instanceof Error ? err.message : "Could not load documents.");
        setDocuments([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, attempt]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    setSending(true);
    setError(null);
    try {
      await startChat(q); // navigates to the new conversation
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a conversation.");
      setQuestion(q);
      setSending(false);
    }
  }

  const ready = documents?.filter((d) => d.status === "ready").length ?? 0;
  const processing = documents?.some((d) => d.status === "uploaded" || d.status === "processing");

  let body: React.ReactNode;
  if (wsLoading || documents === null) {
    body = (
      <div className="mx-auto w-full max-w-2xl space-y-4 pt-16">
        <Skeleton className="mx-auto h-8 w-2/3" />
        <Skeleton className="mx-auto h-4 w-1/2" />
        <Skeleton className="mt-8 h-14 w-full" />
      </div>
    );
  } else if (!current) {
    body = <ErrorBanner message="No workspace found." />;
  } else if (docsError) {
    body = (
      <div className="mx-auto w-full max-w-xl pt-10">
        <ErrorBanner message={docsError} onRetry={() => setAttempt((a) => a + 1)} />
      </div>
    );
  } else if (ready === 0) {
    body = (
      <div className="mx-auto w-full max-w-xl pt-10">
        <EmptyState
          icon={<DocumentIcon size={22} />}
          title={processing ? "Your documents are still processing" : "No documents to chat with yet"}
          description={
            processing
              ? "Answers come only from ready documents. This usually takes under a minute."
              : `Upload a PDF, DOCX, or TXT file to ${current.name}, then come back and ask about it.`
          }
          action={
            <Link
              href="/documents"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover"
            >
              {processing ? "View documents" : "Upload documents"}
            </Link>
          }
        />
      </div>
    );
  } else {
    body = (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center pt-10 text-center sm:pt-20">
        <Logo compact />
        <h2 className="mt-4 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          What would you like to know?
        </h2>
        <p className="mt-2 text-sm text-muted">
          Answers come only from the {ready} ready document{ready === 1 ? "" : "s"} in{" "}
          {current.name}, with citations.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              disabled={sending}
              onClick={() => void send(s)}
              className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-fg-soft transition-colors hover:border-primary hover:text-primary-strong disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // If the document check failed we still let the user ask: the backend decides.
  const showComposer = Boolean(current && documents !== null && (ready > 0 || docsError));

  return (
    <>
      <ChatTopBar title="New chat" />
      <div className="flex-1 overflow-y-auto px-4">{body}</div>
      {(showComposer || error) && (
        <div className="mx-auto w-full max-w-3xl space-y-2 px-4 pb-4 pt-2">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
          {showComposer && (
            <ChatComposer
              value={question}
              onChange={setQuestion}
              onSubmit={() => void send(question)}
              disabled={sending}
              autoFocus
            />
          )}
        </div>
      )}
    </>
  );
}
