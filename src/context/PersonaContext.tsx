'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AppDatabase, TeamMember } from '@/lib/types';

const STORAGE_KEY = 'ai_loop_active_persona';
const BUMP_KEY = 'ai_loop_db_bump';
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
  refreshDb: (options?: { broadcast?: boolean }) => Promise<void>;
  resetDemo: () => Promise<void>;
  toggleSimulateFailure: () => Promise<void>;
  isResetting: boolean;
  isTogglingOutage: boolean;
  lastSyncedAt: string | null;
}

const PersonaContext = createContext<PersonaContextValue | undefined>(undefined);

function broadcastDbBump() {
  try {
    window.localStorage.setItem(BUMP_KEY, String(Date.now()));
  } catch {
    // Ignore storage errors in restricted contexts.
  }
}

export function PersonaProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<AppDatabase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeMemberId, setActiveMemberIdState] = useState<string>(DEFAULT_MEMBER_ID);
  const [isResetting, setIsResetting] = useState(false);
  const [isTogglingOutage, setIsTogglingOutage] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const stateSeqRef = useRef(0);

  // Per-tab persona independence: sessionStorage keeps each tab on its own persona for 2-tab demos,
  // seeded from localStorage on first open.
  useEffect(() => {
    try {
      const fromTab = window.sessionStorage.getItem(STORAGE_KEY);
      const fromLocal = window.localStorage.getItem(STORAGE_KEY);
      const initial = fromTab ?? fromLocal;
      if (initial) {
        setActiveMemberIdState(initial);
        if (!fromTab) window.sessionStorage.setItem(STORAGE_KEY, initial);
      }
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const setActiveMemberId = useCallback((memberId: string) => {
    setActiveMemberIdState(memberId);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, memberId);
      window.localStorage.setItem(STORAGE_KEY, memberId);
    } catch {
      // Ignore storage write failures.
    }
  }, []);

  const refreshDb = useCallback(async (options?: { broadcast?: boolean }) => {
    const seq = ++stateSeqRef.current;
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`State request failed (${response.status})`);
      }
      const data = (await response.json()) as AppDatabase;
      if (seq < stateSeqRef.current) return;
      setDb(data);
      setError(null);
      setLastSyncedAt(new Date().toISOString());
      if (options?.broadcast) broadcastDbBump();
    } catch (err) {
      if (seq < stateSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Unable to fetch state');
    } finally {
      if (seq === stateSeqRef.current) setLoading(false);
    }
  }, []);

  const resetDemo = useCallback(async () => {
    setIsResetting(true);
    const seq = ++stateSeqRef.current;
    try {
      const response = await fetch('/api/demo/reset', {
        method: 'POST',
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Reset request failed (${response.status})`);
      }
      const payload = (await response.json()) as { ok: boolean; db?: AppDatabase };
      if (seq < stateSeqRef.current) return;
      if (payload.db) {
        setDb(payload.db);
        setLastSyncedAt(new Date().toISOString());
      } else {
        await refreshDb();
      }
      setError(null);
      broadcastDbBump();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset demo data');
    } finally {
      setIsResetting(false);
    }
  }, [refreshDb]);

  const toggleSimulateFailure = useCallback(async () => {
    if (!db) return;
    setIsTogglingOutage(true);
    try {
      const response = await fetch('/api/calendar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulateCalendarFailure: !db.settings.simulateCalendarFailure }),
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Outage toggle failed (${response.status})`);
      }
      await refreshDb({ broadcast: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to toggle calendar outage simulation');
    } finally {
      setIsTogglingOutage(false);
    }
  }, [db, refreshDb]);

  useEffect(() => {
    void refreshDb();
    const timer = window.setInterval(() => {
      void refreshDb();
    }, POLL_INTERVAL_MS);
    const onStorage = (event: StorageEvent) => {
      // Sync database updates immediately across tabs WITHOUT overwriting this tab's persona.
      if (event.key === BUMP_KEY) {
        void refreshDb();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', onStorage);
    };
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
      toggleSimulateFailure,
      isResetting,
      isTogglingOutage,
      lastSyncedAt,
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
      toggleSimulateFailure,
      isResetting,
      isTogglingOutage,
      lastSyncedAt,
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
