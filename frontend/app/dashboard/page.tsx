"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import {
  ChatIcon,
  CheckIcon,
  DocumentIcon,
  PlusIcon,
  UploadIcon,
  WorkspaceIcon,
} from "@/components/icons";
import { useWorkspaces } from "@/components/WorkspaceProvider";
import { ErrorBanner, Skeleton, StatusBadge } from "@/components/ui";
import { api, type Conversation, type DocumentItem, type Workspace } from "@/lib/api";

const RECENT_LIMIT = 5;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface Overview {
  documents: DocumentItem[];
  conversations: Conversation[];
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { workspaces, current, loading: wsLoading, error: wsError } = useWorkspaces();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const workspaceId = current?.id;

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setOverview(null);
    setError(null);
    Promise.all([api.listDocuments(workspaceId), api.listConversations(workspaceId)])
      .then(([documents, conversations]) => {
        if (!cancelled) setOverview({ documents, conversations });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load your workspace.");
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, attempt]);

  const firstName = (user?.full_name || user?.email.split("@")[0] || "").split(" ")[0];

  return (
    <div className="space-y-8">
      <Hero name={firstName} workspace={current} />

      <ErrorBanner message={wsError} />
      {error ? (
        <ErrorBanner message={error} onRetry={() => setAttempt((a) => a + 1)} />
      ) : (
        <>
          <Stats overview={overview} />
          {overview && <GettingStarted overview={overview} />}
          <div className="grid gap-6 lg:grid-cols-2">
            <RecentChats conversations={overview?.conversations ?? null} />
            <RecentDocuments documents={overview?.documents ?? null} />
          </div>
        </>
      )}

      <Workspaces workspaces={workspaces} current={current} loading={wsLoading} />
    </div>
  );
}

// ---------- Hero ----------

function Hero({ name, workspace }: { name: string; workspace: Workspace | null }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-linear-to-br from-primary to-primary-hover px-6 py-8 text-primary-fg shadow-lg shadow-primary/25 sm:px-10 sm:py-10">
      {/* Soft decorative glows; purely visual. */}
      <span aria-hidden className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-accent/30 blur-3xl" />
      <span aria-hidden className="absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-primary-fg/10 blur-3xl" />

      <div className="relative">
        <p className="text-sm font-medium opacity-80">
          {workspace ? (
            <span className="inline-flex items-center gap-1.5">
              <WorkspaceIcon size={14} /> {workspace.name}
            </span>
          ) : (
            " "
          )}
        </p>
        <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          {greeting()}
          {name ? `, ${name}` : ""} 👋
        </h1>
        <p className="mt-2 max-w-xl text-sm opacity-85 sm:text-base">
          Ask questions about your documents and get answers with exact citations, then download
          them as Word files.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 rounded-lg bg-surface px-4 py-2.5 text-sm font-semibold text-primary-strong shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <ChatIcon size={16} /> Start a chat
          </Link>
          <Link
            href="/documents"
            className="inline-flex items-center gap-2 rounded-lg border border-primary-fg/30 bg-primary-fg/10 px-4 py-2.5 text-sm font-semibold backdrop-blur transition hover:bg-primary-fg/20"
          >
            <UploadIcon size={16} /> Upload documents
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------- Stats ----------

function Stats({ overview }: { overview: Overview | null }) {
  const docs = overview?.documents ?? [];
  const ready = docs.filter((d) => d.status === "ready");
  const processing = docs.filter((d) => d.status === "uploaded" || d.status === "processing");
  const pages = ready.reduce((sum, d) => sum + (d.page_count ?? 0), 0);

  const items = [
    {
      label: "Documents",
      value: docs.length,
      note: processing.length ? `${processing.length} processing` : "in this workspace",
      Icon: DocumentIcon,
    },
    {
      label: "Ready to search",
      value: ready.length,
      note: docs.length ? `${Math.round((ready.length / docs.length) * 100)}% of documents` : "none yet",
      Icon: CheckIcon,
    },
    { label: "Pages & sheets", value: pages, note: "indexed for search", Icon: WorkspaceIcon },
    {
      label: "Conversations",
      value: overview?.conversations.length ?? 0,
      note: "your chats here",
      Icon: ChatIcon,
    },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-label="Workspace stats">
      {items.map(({ label, value, note, Icon }) => (
        <div key={label} className="rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted sm:text-sm">{label}</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary-strong">
              <Icon size={16} />
            </span>
          </div>
          {overview ? (
            <p className="mt-2 font-display text-2xl font-bold tabular-nums sm:text-3xl">
              {value.toLocaleString()}
            </p>
          ) : (
            <Skeleton className="mt-3 h-7 w-12" />
          )}
          <p className="mt-1 truncate text-xs text-muted">{overview ? note : " "}</p>
        </div>
      ))}
    </section>
  );
}

// ---------- Getting started ----------

function GettingStarted({ overview }: { overview: Overview }) {
  const steps = [
    {
      done: overview.documents.length > 0,
      title: "Upload a document",
      text: "PDF, Word, text, Excel or CSV, up to 20 MB.",
      href: "/documents",
      cta: "Upload",
    },
    {
      done: overview.documents.some((d) => d.status === "ready"),
      title: "Let it finish processing",
      text: "We split it into passages and index them. Usually under a minute.",
      href: "/documents",
      cta: "Check status",
    },
    {
      done: overview.conversations.length > 0,
      title: "Ask your first question",
      text: "Answers cite the exact page; click a citation to see the passage.",
      href: "/chat",
      cta: "Ask",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null; // onboarding complete: hide it

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Get started</h2>
          <p className="text-sm text-muted">
            {doneCount} of {steps.length} done
          </p>
        </div>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
      </div>
      <ol className="mt-5 grid gap-3 md:grid-cols-3">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className={`flex gap-3 rounded-xl border p-4 ${
              step.done ? "border-border bg-surface-muted/50" : "border-primary/30 bg-primary-soft/40"
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step.done ? "bg-success-soft text-success-fg" : "bg-primary text-primary-fg"
              }`}
            >
              {step.done ? <CheckIcon size={14} /> : i + 1}
            </span>
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${step.done ? "text-muted line-through" : ""}`}>
                {step.title}
              </p>
              <p className="mt-0.5 text-xs text-muted">{step.text}</p>
              {!step.done && (
                <Link
                  href={step.href}
                  className="mt-2 inline-block text-xs font-semibold text-primary hover:underline"
                >
                  {step.cta} →
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- Recent activity ----------

function Panel({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-2xl border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="font-display font-bold">{title}</h2>
        <Link href={href} className="text-xs font-semibold text-primary hover:underline">
          {linkLabel} →
        </Link>
      </div>
      <div className="flex-1 p-2">{children}</div>
    </section>
  );
}

function RowsSkeleton() {
  return (
    <div className="space-y-2 p-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function EmptyRow({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <p className="text-sm text-muted">{text}</p>
      <Link href={href} className="mt-3 text-sm font-semibold text-primary hover:underline">
        {cta}
      </Link>
    </div>
  );
}

function RecentChats({ conversations }: { conversations: Conversation[] | null }) {
  return (
    <Panel title="Recent chats" href="/chat" linkLabel="New chat">
      {conversations === null ? (
        <RowsSkeleton />
      ) : conversations.length === 0 ? (
        <EmptyRow text="No conversations yet." href="/chat" cta="Ask your first question" />
      ) : (
        <ul>
          {conversations.slice(0, RECENT_LIMIT).map((c) => (
            <li key={c.id}>
              <Link
                href={`/chat/${c.id}`}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-muted"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg">
                  <ChatIcon size={15} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {c.title || "New conversation"}
                </span>
                {c.document_ids.length > 0 && (
                  <span className="hidden shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] text-primary-strong sm:inline">
                    {c.document_ids.length} doc{c.document_ids.length === 1 ? "" : "s"}
                  </span>
                )}
                <span className="shrink-0 text-xs text-muted">{timeAgo(c.updated_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RecentDocuments({ documents }: { documents: DocumentItem[] | null }) {
  return (
    <Panel title="Recent documents" href="/documents" linkLabel="All documents">
      {documents === null ? (
        <RowsSkeleton />
      ) : documents.length === 0 ? (
        <EmptyRow text="No documents yet." href="/documents" cta="Upload your first document" />
      ) : (
        <ul>
          {documents.slice(0, RECENT_LIMIT).map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-strong">
                <DocumentIcon size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={d.title}>
                  {d.title}
                </p>
                <p className="text-xs uppercase text-muted">
                  {d.file_type} · {timeAgo(d.created_at)}
                </p>
              </div>
              {d.status === "ready" ? (
                <Link
                  href={`/chat?doc=${d.id}`}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
                >
                  Ask
                </Link>
              ) : (
                <StatusBadge status={d.status} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------- Workspaces ----------

function Workspaces({
  workspaces,
  current,
  loading,
}: {
  workspaces: Workspace[];
  current: Workspace | null;
  loading: boolean;
}) {
  const { select } = useWorkspaces();

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-bold">Your workspaces</h2>
        <p className="text-sm text-muted">
          Each workspace has its own documents and chats. Switch to work in another one.
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((w) => {
            const isCurrent = current?.id === w.id;
            return (
              <div
                key={w.id}
                className={`flex flex-col rounded-2xl border bg-surface p-5 shadow-sm transition ${
                  isCurrent ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-border-strong"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-primary to-primary-hover font-display text-lg font-bold text-primary-fg">
                    {w.name.trim()[0]?.toUpperCase() ?? "W"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold" title={w.name}>
                      {w.name}
                    </p>
                    <div className="mt-1 flex gap-1.5">
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium capitalize text-fg-soft">
                        {w.role ?? "member"}
                      </span>
                      {isCurrent && (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-fg">
                          Current
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex gap-2">
                  {isCurrent ? (
                    <Link
                      href="/documents"
                      className="flex-1 rounded-lg bg-primary px-3 py-2 text-center text-sm font-medium text-primary-fg hover:bg-primary-hover"
                    >
                      Open documents
                    </Link>
                  ) : (
                    <button
                      onClick={() => select(w.id)}
                      className="flex-1 rounded-lg border border-border-strong px-3 py-2 text-sm font-medium hover:bg-surface-muted"
                    >
                      Switch to this workspace
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <NewWorkspaceCard />
        </div>
      )}
    </section>
  );
}

function NewWorkspaceCard() {
  const { create } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await create(name.trim()); // also switches to it
      setName("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create workspace.");
    } finally {
      setCreating(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border-strong p-5 text-muted transition-colors hover:border-primary hover:bg-primary-soft/40 hover:text-primary-strong"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted">
          <PlusIcon size={18} />
        </span>
        <span className="text-sm font-semibold">New workspace</span>
        <span className="text-xs">For a project, client or team</span>
      </button>
    );
  }

  return (
    <form
      onSubmit={onCreate}
      className="flex min-h-32 flex-col gap-3 rounded-2xl border-2 border-dashed border-primary bg-primary-soft/30 p-5"
    >
      <label className="text-sm font-semibold" htmlFor="new-workspace">
        Name your workspace
      </label>
      <input
        id="new-workspace"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder="e.g. Client contracts"
        maxLength={200}
        className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm focus:border-primary"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
