"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ChatComposer } from "@/components/ChatComposer";
import { ChatTopBar, useConversations } from "@/components/ChatSidebar";
import { ChatIcon } from "@/components/icons";
import { Markdown } from "@/components/Markdown";
import { SourcePanel } from "@/components/SourcePanel";
import { CitationChip, EmptyState, ErrorBanner, Logo, Skeleton } from "@/components/ui";
import { api, ApiError, type Citation, type Message } from "@/lib/api";

/** A message being streamed: shown like a Message but not yet saved. */
interface PendingAnswer {
  content: string;
  sources: Citation[];
}

/** Which citation's source panel is open, and in which message. */
interface OpenSource {
  messageKey: string;
  citation: Citation;
}

type LoadState = "loading" | "ready" | "not-found" | "error";

// Abort reasons: the user pressed Stop, or left the page mid-answer.
const STOPPED = "stopped";
const LEFT = "left";

// Only sources the answer actually cites are shown under it.
const citedIn = (content: string, sources: Citation[]) =>
  sources.filter((s) => content.includes(`[${s.index}]`));

export default function ConversationPage() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = Number(params.conversationId);
  const { conversations, reload: reloadSidebar, takeFirstQuestion } = useConversations();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAnswer | null>(null);
  const [openSource, setOpenSource] = useState<OpenSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow new tokens only while the user is at the bottom, so scrolling up
  // to re-read something isn't yanked back down on every token.
  const stickToBottom = useRef(true);

  const streaming = pendingQuestion !== null;
  const title = conversations.find((c) => c.id === conversationId)?.title || "New conversation";

  const ask = useCallback(
    async (q: string) => {
      setError(null);
      setFailedQuestion(null);
      setPendingQuestion(q);
      setPending({ content: "", sources: [] });
      stickToBottom.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      let partial: PendingAnswer = { content: "", sources: [] };

      try {
        await api.ask(
          conversationId,
          q,
          {
            onSources: (sources) => {
              partial = { ...partial, sources };
              setPending(partial);
            },
            onToken: (text) => {
              partial = { ...partial, content: partial.content + text };
              setPending(partial);
            },
            onError: (detail) => {
              setError(detail);
              setFailedQuestion(q);
            },
          },
          controller.signal,
        );
        // Reload so the list holds the saved user + assistant messages (with ids
        // and the final citations) instead of our temporary streaming copy.
        setMessages(await api.listMessages(conversationId));
      } catch (err) {
        if (controller.signal.aborted) {
          if (controller.signal.reason !== STOPPED) return; // navigated away: nothing to show
          // Stopped by the user. The server saves the partial answer when the
          // client disconnects; show the same thing locally right away.
          // Negative ids mark these as local until the next reload.
          const now = new Date().toISOString();
          setMessages((prev) => [
            ...prev,
            { id: -Date.now(), role: "user", content: q, citations: [], tokens_used: 0, created_at: now },
            {
              id: -Date.now() - 1,
              role: "assistant",
              content: partial.content || "_Stopped before an answer was generated._",
              citations: citedIn(partial.content, partial.sources),
              tokens_used: 0,
              created_at: now,
            },
          ]);
        } else {
          setError(err instanceof Error ? err.message : "Something went wrong.");
          setFailedQuestion(q);
        }
      } finally {
        setPendingQuestion(null);
        setPending(null);
        abortRef.current = null;
        void reloadSidebar(); // first question sets the title; activity reorders the list
      }
    },
    [conversationId, reloadSidebar],
  );

  // Keep the latest `ask` reachable from the load effect without re-running it.
  const askRef = useRef(ask);
  askRef.current = ask;

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setOpenSource(null);
    api
      .listMessages(conversationId)
      .then((list) => {
        if (cancelled) return;
        setMessages(list);
        setLoadState("ready");
        // Arrived here from "New chat": send the question typed there.
        const first = takeFirstQuestion(conversationId);
        if (first) void askRef.current(first);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) return setLoadState("not-found");
        setLoadError(err instanceof Error ? err.message : "Could not load this conversation.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort(LEFT); // stop streaming if the user navigates away
    };
  }, [conversationId, loadAttempt, takeFirstQuestion]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending?.content, pendingQuestion]);

  function onScroll() {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function submit() {
    const q = question.trim();
    if (!q || streaming) return;
    setQuestion("");
    void ask(q);
  }

  const closeSource = useCallback(() => setOpenSource(null), []);
  const toggleSource = (messageKey: string, citation: Citation) =>
    setOpenSource((cur) =>
      cur?.messageKey === messageKey && cur.citation.index === citation.index
        ? null
        : { messageKey, citation },
    );

  if (loadState === "not-found") {
    return (
      <>
        <ChatTopBar title="Conversation not found" />
        <div className="mx-auto w-full max-w-xl px-4 pt-10">
          <EmptyState
            icon={<ChatIcon size={22} />}
            title="This conversation doesn't exist"
            description="It may have been deleted, or it belongs to another account or workspace."
            action={
              <Link
                href="/chat"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover"
              >
                Start a new chat
              </Link>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <ChatTopBar title={title} />

      <div
        ref={scrollRef}
        onScroll={onScroll}
        // Leave room for the source panel on desktop so it doesn't cover the answer.
        className={`flex-1 overflow-y-auto px-4 transition-[padding] ${openSource ? "lg:pr-[27rem]" : ""}`}
      >
        <div className="mx-auto max-w-3xl space-y-6 py-6">
          {loadState === "loading" ? (
            <MessagesSkeleton />
          ) : loadState === "error" ? (
            <ErrorBanner message={loadError} onRetry={() => setLoadAttempt((a) => a + 1)} />
          ) : messages.length === 0 && !streaming ? (
            <p className="pt-16 text-center text-sm text-muted">
              Ask a question about your documents to get started.
            </p>
          ) : (
            messages.map((m) => {
              const key = String(m.id);
              return (
                <MessageBubble
                  key={key}
                  role={m.role}
                  content={m.content}
                  citations={m.citations}
                  activeIndex={openSource?.messageKey === key ? openSource.citation.index : null}
                  onCitationClick={(c) => toggleSource(key, c)}
                />
              );
            })
          )}

          {pendingQuestion && <MessageBubble role="user" content={pendingQuestion} citations={[]} />}
          {pending && (
            <MessageBubble
              role="assistant"
              content={pending.content}
              // While streaming, show only the sources the answer has cited so far.
              citations={citedIn(pending.content, pending.sources)}
              activeIndex={openSource?.messageKey === "pending" ? openSource.citation.index : null}
              onCitationClick={(c) => toggleSource("pending", c)}
              streaming
            />
          )}
        </div>
      </div>

      <div className={`px-4 pb-4 pt-2 ${openSource ? "lg:pr-[27rem]" : ""}`}>
        <div className="mx-auto max-w-3xl space-y-2">
          <ErrorBanner
            message={error}
            onRetry={failedQuestion && !streaming ? () => void ask(failedQuestion) : undefined}
            onDismiss={() => setError(null)}
          />
          <ChatComposer
            value={question}
            onChange={setQuestion}
            onSubmit={submit}
            onStop={() => abortRef.current?.abort(STOPPED)}
            streaming={streaming}
            disabled={loadState !== "ready"}
            autoFocus
          />
          <p className="text-center text-[11px] text-muted">
            Answers use only your documents. Click a citation to see the source passage.
          </p>
        </div>
      </div>

      {openSource && <SourcePanel citation={openSource.citation} onClose={closeSource} />}
    </>
  );
}

function MessagesSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading messages">
      <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
      <div className="flex gap-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
        <Skeleton className="h-28 flex-1 rounded-2xl" />
      </div>
      <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
    </div>
  );
}

function MessageBubble({
  role,
  content,
  citations,
  activeIndex = null,
  onCitationClick,
  streaming = false,
}: {
  role: Message["role"];
  content: string;
  citations: Citation[];
  activeIndex?: number | null;
  onCitationClick?: (citation: Citation) => void;
  streaming?: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-6 text-primary-fg shadow-sm shadow-primary/20 sm:max-w-[80%]">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 sm:gap-3">
      <span className="mt-1 hidden shrink-0 sm:block">
        <Logo compact />
      </span>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-3.5 shadow-sm sm:px-5 sm:py-4">
        {streaming && !content ? (
          <TypingIndicator />
        ) : (
          <>
            <Markdown content={content} sources={citations} onCitationClick={onCitationClick} />
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
                  <CitationChip
                    index={c.index}
                    title={c.title}
                    page={c.page}
                    active={activeIndex === c.index}
                    onClick={onCitationClick && (() => onCitationClick(c))}
                  />
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
