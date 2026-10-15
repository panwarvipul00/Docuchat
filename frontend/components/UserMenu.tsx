"use client";

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { ChevronDownIcon, LogoutIcon } from "@/components/icons";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { useWorkspaces } from "@/components/WorkspaceProvider";

function initials(name: string, email: string): string {
  const source = name.trim() || email.split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : source[0];
  return letters.toUpperCase();
}

/** Avatar button that opens a menu with account info, theme and log out. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const { workspaces, current, select } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape, like a native menu.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  const displayName = user.full_name || user.email.split("@")[0];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-2 transition-colors hover:border-border-strong"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-br from-primary to-primary-hover font-display text-xs font-bold text-primary-fg">
          {initials(user.full_name, user.email)}
        </span>
        <span className="hidden max-w-28 truncate text-sm font-medium text-fg-soft md:inline">
          {displayName}
        </span>
        <ChevronDownIcon
          size={14}
          className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-xl shadow-primary/10"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="truncate font-display text-sm font-semibold text-fg">{displayName}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          {/* On small screens the navbar hides the workspace picker; offer it here. */}
          {workspaces.length > 0 && (
            <div className="space-y-2 border-b border-border px-4 py-3 md:hidden">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Workspace
              </p>
              <select
                aria-label="Workspace"
                value={current?.id ?? ""}
                onChange={(e) => select(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-2 border-b border-border px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Appearance
            </p>
            <ThemeSegmented />
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-fg-soft transition-colors hover:bg-danger-soft hover:text-danger"
          >
            <LogoutIcon size={16} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
