"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ChatComposer } from "@/components/ChatComposer";
import { ChatTopBar, useConversations } from "@/components/ChatSidebar";
import { AnswerModeToggle } from "@/components/AnswerModeToggle";
import { DocumentScopePicker } from "@/components/DocumentScopePicker";
import { DocumentIcon } from "@/components/icons";
import { useWorkspaces } from "@/components/WorkspaceProvider";
import { EmptyState, ErrorBanner, Logo, Skeleton, SUPPORTED_FILES } from "@/components/ui";
import type { AnswerMode } from "@/lib/api";

const SUGGESTIONS = [
  "Summarize the key points",
  "What are the main conclusions or recommendations?",
  "List any important dates, deadlines, or numbers",
];

/** "New chat": a welcome screen whose first question creates the conversation. */
export default function NewChatPage() {
  const { current, loading: wsLoading } = useWorkspaces();
  const { startChat, documents, documentsError, reloadDocuments } = useConversations();
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<number[]>([]);
  const [answerMode, setAnswerMode] = useState<AnswerMode>("documents");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // /chat?doc=12 (the "Ask" button on the Documents page) starts a chat
  // already limited to that document. Read once, then drop it from the URL.
  useEffect(() => {
    const doc = Number(new URLSearchParams(window.location.search).get("doc"));
    if (doc) {
      setScope([doc]);
      window.history.replaceState(null, "", "/chat");
    }
  }, []);

  async function send(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    setSending(true);
    setError(null);
    try {
      await startChat(q, scope, answerMode); // navigates to the new conversation
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a conversation.");
      setQuestion(q);
      setSending(false);
    }
  }

  const ready = documents?.filter((d) => d.status === "ready") ?? [];
  const processing = documents?.some((d) => d.status === "uploaded" || d.status === "processing");
  const scoped = ready.filter((d) => scope.includes(d.id));

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
  } else if (documentsError) {
    body = (
      <div className="mx-auto w-full max-w-xl pt-10">
        <ErrorBanner message={documentsError} onRetry={() => void reloadDocuments()} />
      </div>
    );
  } else if (ready.length === 0) {
    body = (
      <div className="mx-auto w-full max-w-xl pt-10">
        <EmptyState
          icon={<DocumentIcon size={22} />}
          title={processing ? "Your documents are still processing" : "No documents to chat with yet"}
          description={
            processing
              ? "Answers come only from ready documents. This usually takes under a minute."
              : `Upload a ${SUPPORTED_FILES} file to ${current.name}, then come back and ask about it.`
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
          {scoped.length === 1
            ? `Answers will come only from “${scoped[0].title}”, with citations.`
            : scoped.length > 1
              ? `Answers will come only from the ${scoped.length} selected documents, with citations.`
              : `Answers come from all ${ready.length} ready document${ready.length === 1 ? "" : "s"} in ${current.name}, with citations. Use “Search in” below to pick specific ones.`}
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
  const showComposer = Boolean(current && documents !== null && (ready.length > 0 || documentsError));

  return (
    <>
      <ChatTopBar title="New chat" />
      <div className="flex-1 overflow-y-auto px-4">{body}</div>
      {(showComposer || error) && (
        <div className="mx-auto w-full max-w-3xl space-y-2 px-4 pb-4 pt-2">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
          {showComposer && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <DocumentScopePicker
                  documents={documents ?? []}
                  selected={scope}
                  onChange={setScope}
                  disabled={sending}
                />
                <AnswerModeToggle value={answerMode} onChange={setAnswerMode} disabled={sending} />
              </div>
              <ChatComposer
                value={question}
                onChange={setQuestion}
                onSubmit={() => void send(question)}
                disabled={sending}
                autoFocus
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
