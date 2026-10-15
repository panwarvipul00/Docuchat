"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/components/AuthProvider";
import {
  ChatIcon,
  ChevronDownIcon,
  DashboardIcon,
  DocumentIcon,
  WorkspaceIcon,
} from "@/components/icons";
import { Logo, Spinner } from "@/components/ui";
import { UserMenu } from "@/components/UserMenu";
import { useWorkspaces, WorkspaceProvider } from "@/components/WorkspaceProvider";

const NAV = [
  { href: "/dashboard", label: "Dashboard", Icon: DashboardIcon },
  { href: "/documents", label: "Documents", Icon: DocumentIcon },
  { href: "/chat", label: "Chat", Icon: ChatIcon },
];

/**
 * Layout for signed-in pages: guards the route and renders the top nav.
 * `fullWidth` drops the centered column so a page (chat) can manage its own
 * full-height, edge-to-edge layout.
 */
export function AppShell({
  children,
  fullWidth = false,
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <WorkspaceProvider>
      <div className="min-h-screen bg-bg">
        <TopNav />
        {fullWidth ? (
          <main>{children}</main>
        ) : (
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        )}
      </div>
    </WorkspaceProvider>
  );
}

function TopNav() {
  const { workspaces, current, select } = useWorkspaces();
  const pathname = usePathname();

  return (
    // Sticky, translucent bar: content scrolls under it with a soft blur.
    <header className="sticky top-0 z-40 border-b border-border/70 bg-surface/80 shadow-[0_8px_24px_-16px] shadow-primary/25 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-4 sm:gap-6">
        <Link href="/dashboard" aria-label="DocuChat home" className="shrink-0 rounded-lg">
          <span className="hidden sm:block">
            <Logo />
          </span>
          <span className="sm:hidden">
            <Logo compact />
          </span>
        </Link>

        <nav className="flex items-center gap-1" aria-label="Main">
          {NAV.map(({ href, label, Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                title={label}
                className={`relative flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary-soft text-primary-strong"
                    : "text-muted hover:bg-surface-muted hover:text-fg"
                }`}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{label}</span>
                {active && (
                  <span className="absolute inset-x-4 -bottom-[13px] h-0.5 rounded-full bg-accent" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {workspaces.length > 0 && (
            <label className="relative hidden items-center md:flex">
              <span className="sr-only">Workspace</span>
              <WorkspaceIcon size={15} className="pointer-events-none absolute left-3 text-primary" />
              <select
                value={current?.id ?? ""}
                onChange={(e) => select(Number(e.target.value))}
                className="max-w-48 cursor-pointer appearance-none truncate rounded-full border border-border bg-surface py-1.5 pl-9 pr-8 text-sm font-medium text-fg-soft transition-colors hover:border-border-strong"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <ChevronDownIcon size={14} className="pointer-events-none absolute right-3 text-muted" />
            </label>
          )}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
