"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Markdown } from "@/components/Markdown";
import { CitationChip, ErrorBanner, Logo, Spinner } from "@/components/ui";
import { api, type Citation, type Message } from "@/lib/api";

/** A message being streamed: shown like a Message but not yet saved. */
interface PendingAnswer {
  content: string;
  sources: Citation[];
}

export default function ConversationPage() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = Number(params.conversationId);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAnswer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listMessages(conversationId)
      .then((list) => !cancelled && setMessages(list))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      abortRef.current?.abort(); // stop streaming if the user navigates away
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending?.content, pendingQuestion]);

  const streaming = pendingQuestion !== null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming) return;

    setQuestion("");
    setError(null);
    setPendingQuestion(q);
    setPending({ content: "", sources: [] });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await api.ask(
        conversationId,
        q,
        {
          onSources: (sources) => setPending((p) => (p ? { ...p, sources } : p)),
          onToken: (text) => setPending((p) => (p ? { ...p, content: p.content + text } : p)),
          onDone: () => undefined,
          onError: (detail) => setError(detail),
        },
        controller.signal,
      );
      // Reload so the list holds the saved user + assistant messages (with ids
      // and the final citations) instead of our temporary streaming copy.
      setMessages(await api.listMessages(conversationId));
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setQuestion(q); // let the user retry without retyping
      }
    } finally {
      setPendingQuestion(null);
      setPending(null);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="mb-4">
        <Link href="/chat" className="text-sm text-muted hover:text-fg">
          ← All conversations
        </Link>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto pb-4 pr-1">
        {loading ? (
          <Spinner />
        ) : messages.length === 0 && !streaming ? (
          <p className="pt-10 text-center text-sm text-muted">
            Ask a question about your documents to get started.
          </p>
        ) : (
          messages.map((m) => (
            <MessageBubble key={m.id} role={m.role} content={m.content} citations={m.citations} />
          ))
        )}

        {pendingQuestion && <MessageBubble role="user" content={pendingQuestion} citations={[]} />}
        {pending && (
          <MessageBubble
            role="assistant"
            content={pending.content}
            // While streaming, show only the sources the answer has cited so far.
            citations={pending.sources.filter((s) => pending.content.includes(`[${s.index}]`))}
            streaming
          />
        )}
        <div ref={bottomRef} />
      </div>

      <ErrorBanner message={error} />

      <form onSubmit={onSubmit} className="mt-3 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about your documents…"
          maxLength={2000}
          disabled={streaming}
          className="flex-1 rounded-md border border-border-strong bg-surface px-3 py-2 text-sm focus:border-primary disabled:bg-surface-muted"
        />
        <button
          type="submit"
          disabled={streaming || !question.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
        >
          {streaming ? "Answering…" : "Ask"}
        </button>
      </form>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  citations,
  streaming = false,
}: {
  role: Message["role"];
  content: string;
  citations: Citation[];
  streaming?: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-6 text-primary-fg shadow-sm shadow-primary/20">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <span className="mt-1 shrink-0">
        <Logo compact />
      </span>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-border bg-surface px-5 py-4 shadow-sm">
        {streaming && !content ? (
          <TypingIndicator />
        ) : (
          <>
            <Markdown content={content} sources={citations} />
            {streaming && (
              <span className="mt-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent" />
            )}
          </>
        )}
        {citations.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              Sources
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {citations.map((c) => (
                <li key={c.index} className="max-w-full">
                  <CitationChip index={c.index} title={c.title} page={c.page} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted" role="status">
      <span className="flex gap-1">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      Searching your documents…
    </div>
  );
}
