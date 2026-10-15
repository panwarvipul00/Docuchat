"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, type Workspace } from "@/lib/api";

const SELECTED_KEY = "docuchat.workspace";

interface WorkspaceContextValue {
  workspaces: Workspace[];
  current: Workspace | null;
  loading: boolean;
  error: string | null;
  select: (id: number) => void;
  create: (name: string) => Promise<Workspace>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** Loads the user's workspaces and remembers which one is selected. */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listWorkspaces()
      .then((list) => {
        if (cancelled) return;
        setWorkspaces(list);
        const saved = Number(localStorage.getItem(SELECTED_KEY));
        setCurrentId(list.some((w) => w.id === saved) ? saved : (list[0]?.id ?? null));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load workspaces");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const select = useCallback((id: number) => {
    setCurrentId(id);
    localStorage.setItem(SELECTED_KEY, String(id));
  }, []);

  const create = useCallback(
    async (name: string) => {
      const ws = await api.createWorkspace(name);
      setWorkspaces((prev) => [...prev, ws]);
      select(ws.id);
      return ws;
    },
    [select],
  );

  const current = workspaces.find((w) => w.id === currentId) ?? null;

  return (
    <WorkspaceContext.Provider value={{ workspaces, current, loading, error, select, create }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaces(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaces must be used inside <WorkspaceProvider>");
  return ctx;
}
