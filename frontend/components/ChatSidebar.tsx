"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CloseIcon, MenuIcon, PencilIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { ErrorBanner, Skeleton } from "@/components/ui";
import { useWorkspaces } from "@/components/WorkspaceProvider";
import { api, type Conversation } from "@/lib/api";

// ---------- Shared conversation state ----------

interface ConversationsContextValue {
  conversations: Conversation[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Create a conversation and open it; `question` is asked as soon as it loads. */
  startChat: (question: string) => Promise<void>;
  /** The question passed to startChat for this conversation (returned once). */
  takeFirstQuestion: (conversationId: number) => string | null;
  rename: (id: number, title: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const ConversationsContext = createContext<ConversationsContextValue | null>(null);

export function useConversations(): ConversationsContextValue {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error("useConversations must be used inside ConversationsProvider");
  return ctx;
}

/**
 * Holds the conversation list for the chat layout, so the sidebar and the
 * pages share one copy: asking a question updates the title in the sidebar
 * without a second fetch, and deleting the open chat can navigate away.
 */
export function ConversationsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { current } = useWorkspaces();
  const workspaceId = current?.id;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // A "new chat" isn't created until the first question is sent, so empty
  // conversations don't pile up in the sidebar. The question is handed to the
  // conversation page through this ref after navigating.
  const firstQuestion = useRef<{ id: number; question: string } | null>(null);

  const reload = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setConversations(await api.listConversations(workspaceId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load conversations.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // Switching workspace: load its conversations. If a chat from the old
  // workspace is open, leave it, since it no longer belongs on screen.
  const previousWorkspace = useRef(workspaceId);
  useEffect(() => {
    setLoading(true);
    void reload();
    if (previousWorkspace.current !== undefined && previousWorkspace.current !== workspaceId) {
      router.push("/chat");
    }
    previousWorkspace.current = workspaceId;
  }, [reload, workspaceId, router]);

  const startChat = useCallback(
    async (question: string) => {
      if (!workspaceId) throw new Error("No workspace selected.");
      const conv = await api.createConversation(workspaceId);
      firstQuestion.current = { id: conv.id, question };
      setConversations((prev) => [conv, ...prev]);
      router.push(`/chat/${conv.id}`);
    },
    [workspaceId, router],
  );

  const takeFirstQuestion = useCallback((conversationId: number) => {
    const pending = firstQuestion.current;
    if (pending?.id !== conversationId) return null;
    firstQuestion.current = null;
    return pending.question;
  }, []);

  const rename = useCallback(async (id: number, title: string) => {
    const updated = await api.renameConversation(id, title);
    setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
  }, []);

  const remove = useCallback(async (id: number) => {
    await api.deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      conversations,
      loading,
      error,
      reload,
      startChat,
      takeFirstQuestion,
      rename,
      remove,
      drawerOpen,
      setDrawerOpen,
    }),
    [conversations, loading, error, reload, startChat, takeFirstQuestion, rename, remove, drawerOpen],
  );

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

// ---------- Sidebar UI ----------

/** Buckets conversations by last activity, like most chat apps. */
function groupByDate(conversations: Conversation[]): [string, Conversation[]][] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const day = 24 * 60 * 60 * 1000;
  const groups = new Map<string, Conversation[]>();
  for (const c of conversations) {
    const t = new Date(c.updated_at).getTime();
    const label =
      t >= today ? "Today" : t >= today - day ? "Yesterday" : t >= today - 7 * day ? "Previous 7 days" : "Older";
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }
  return [...groups.entries()];
}

/** Header row above a chat; on mobile it holds the button that opens the drawer. */
export function ChatTopBar({ title, children }: { title: string; children?: React.ReactNode }) {
  const { setDrawerOpen } = useConversations();
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface/60 px-3 sm:px-5">
      <button
        onClick={() => setDrawerOpen(true)}
        aria-label="Open conversations"
        className="-ml-1 rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-fg lg:hidden"
      >
        <MenuIcon size={18} />
      </button>
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
      {children}
    </div>
  );
}

/** Conversation list: a fixed column on desktop, a slide-in drawer on mobile. */
export function ChatSidebar() {
  const { drawerOpen, setDrawerOpen } = useConversations();

  return (
    <>
      <aside className="hidden w-72 shrink-0 border-r border-border bg-surface lg:flex lg:flex-col">
        <SidebarContent />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-label="Conversations">
          <div className="absolute inset-0 bg-fg/30" onClick={() => setDrawerOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-[85vw] max-w-xs flex-col bg-surface shadow-2xl">
            <div className="flex justify-end px-2 pt-2">
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close conversations"
                className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-fg"
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  );
}

function SidebarContent() {
  const { conversations, loading, error, reload, setDrawerOpen } = useConversations();
  const params = useParams<{ conversationId?: string }>();
  const activeId = params.conversationId ? Number(params.conversationId) : null;
  const groups = useMemo(() => groupByDate(conversations), [conversations]);

  return (
    <>
      <div className="p-3">
        <Link
          href="/chat"
          onClick={() => setDrawerOpen(false)}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-fg shadow-sm shadow-primary/20 hover:bg-primary-hover"
        >
          <PlusIcon size={16} /> New chat
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Conversations">
        {loading ? (
          <div className="space-y-2 px-2 pt-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="px-1">
            <ErrorBanner message={error} onRetry={() => void reload()} />
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-3 pt-4 text-center text-sm text-muted">
            No conversations yet. Your chats will appear here.
          </p>
        ) : (
          groups.map(([label, items]) => (
            <section key={label} className="mt-3 first:mt-0">
              <h3 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {label}
              </h3>
              <ul className="space-y-0.5">
                {items.map((c) => (
                  <ConversationItem key={c.id} conversation={c} active={c.id === activeId} />
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>
    </>
  );
}

function ConversationItem({ conversation, active }: { conversation: Conversation; active: boolean }) {
  const router = useRouter();
  const { rename, remove, setDrawerOpen } = useConversations();
  const [mode, setMode] = useState<"view" | "rename" | "confirm-delete">("view");
  const [title, setTitle] = useState(conversation.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = conversation.title || "New conversation";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode("view");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "rename") {
    return (
      <li className="px-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const next = title.trim();
            if (!next || next === conversation.title) return setMode("view");
            void run(() => rename(conversation.id, next));
          }}
        >
          <input
            autoFocus
            value={title}
            maxLength={200}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setTitle(conversation.title);
                setMode("view");
              }
            }}
            aria-label="Conversation title"
            className="w-full rounded-md border border-primary bg-surface px-2 py-1.5 text-sm"
          />
        </form>
        {error && <p className="px-1 pt-1 text-xs text-danger">{error}</p>}
      </li>
    );
  }

  if (mode === "confirm-delete") {
    return (
      <li className="rounded-md bg-danger-soft px-3 py-2 text-sm">
        <p className="truncate text-danger">Delete “{label}”?</p>
        {error && <p className="pt-1 text-xs text-danger">{error}</p>}
        <div className="mt-2 flex gap-2">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await remove(conversation.id);
                if (active) router.push("/chat");
              })
            }
            className="rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-surface disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button
            disabled={busy}
            onClick={() => setMode("view")}
            className="rounded-md px-2.5 py-1 text-xs text-fg-soft hover:bg-surface"
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="group relative">
      <Link
        href={`/chat/${conversation.id}`}
        onClick={() => setDrawerOpen(false)}
        aria-current={active ? "page" : undefined}
        title={label}
        className={`block truncate rounded-md py-2 pl-3 pr-16 text-sm transition-colors ${
          active ? "bg-primary-soft font-medium text-primary-strong" : "text-fg-soft hover:bg-surface-muted"
        }`}
      >
        {label}
      </Link>
      {/* Always visible on touch screens; revealed on hover/focus with a mouse. */}
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
        <button
          onClick={() => {
            setTitle(conversation.title);
            setMode("rename");
          }}
          aria-label={`Rename ${label}`}
          className="rounded p-1.5 text-muted hover:bg-surface hover:text-fg"
        >
          <PencilIcon size={13} />
        </button>
        <button
          onClick={() => setMode("confirm-delete")}
          aria-label={`Delete ${label}`}
          className="rounded p-1.5 text-muted hover:bg-surface hover:text-danger"
        >
          <TrashIcon size={13} />
        </button>
      </div>
    </li>
  );
}
