'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppDatabase, TeamMember } from '@/lib/types';

const STORAGE_KEY = 'ai_loop_active_persona';
const DEFAULT_MEMBER_ID = 'alice';
const POLL_INTERVAL_MS = 3000;

export interface PersonaContextValue {
  db: AppDatabase | null;
  loading: boolean;
  error: string | null;
  activeMemberId: string;
  currentUser: TeamMember | null;
  members: TeamMember[];
  setActiveMemberId: (memberId: string) => void;
  refreshDb: () => Promise<void>;
  resetDemo: () => Promise<void>;
  isResetting: boolean;
}

const PersonaContext = createContext<PersonaContextValue | undefined>(undefined);

export function PersonaProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<AppDatabase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeMemberId, setActiveMemberIdState] = useState<string>(DEFAULT_MEMBER_ID);
  const [isResetting, setIsResetting] = useState(false);

  // Restore saved persona on mount (client-only to avoid SSR hydration mismatch).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setActiveMemberIdState(stored);
      }
    } catch {
      // Ignore storage access failures in restricted browser contexts.
    }
  }, []);

  const setActiveMemberId = useCallback((memberId: string) => {
    setActiveMemberIdState(memberId);
    try {
      window.localStorage.setItem(STORAGE_KEY, memberId);
    } catch {
      // Ignore storage write failures.
    }
  }, []);

  const refreshDb = useCallback(async () => {
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`State request failed (${response.status})`);
      }
      const data = (await response.json()) as AppDatabase;
      setDb(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch state');
    } finally {
      setLoading(false);
    }
  }, []);

  const resetDemo = useCallback(async () => {
    setIsResetting(true);
    try {
      const response = await fetch('/api/demo/reset', {
        method: 'POST',
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Reset request failed (${response.status})`);
      }
      const payload = (await response.json()) as { ok: boolean; db?: AppDatabase };
      if (payload.db) {
        setDb(payload.db);
      } else {
        await refreshDb();
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset demo data');
    } finally {
      setIsResetting(false);
    }
  }, [refreshDb]);

  useEffect(() => {
    void refreshDb();
    const timer = window.setInterval(() => {
      void refreshDb();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshDb]);

  const members = useMemo(() => db?.members ?? [], [db]);

  const currentUser = useMemo(() => {
    if (members.length === 0) return null;
    return members.find((member) => member.id === activeMemberId) ?? members[0];
  }, [members, activeMemberId]);

  const value = useMemo<PersonaContextValue>(
    () => ({
      db,
      loading,
      error,
      activeMemberId: currentUser?.id ?? activeMemberId,
      currentUser,
      members,
      setActiveMemberId,
      refreshDb,
      resetDemo,
      isResetting,
    }),
    [
      db,
      loading,
      error,
      currentUser,
      activeMemberId,
      members,
      setActiveMemberId,
      refreshDb,
      resetDemo,
      isResetting,
    ],
  );

  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export function usePersona(): PersonaContextValue {
  const ctx = useContext(PersonaContext);
  if (!ctx) {
    throw new Error('usePersona must be used within a PersonaProvider');
  }
  return ctx;
}
