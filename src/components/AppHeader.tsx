'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePersona } from '@/context/PersonaContext';
import { countDeskActionItems } from '@/lib/deskQueue';
import type { Role } from '@/lib/types';
import { AlertIcon, FlaskIcon, RefreshIcon } from './Icons';

const NAV_ITEMS = [
  { href: '/', label: 'Desk', match: (p: string) => p === '/' || p.startsWith('/inbox') },
  { href: '/calendar', label: 'Week', match: (p: string) => p.startsWith('/calendar') },
  { href: '/decisions', label: 'Ledger', match: (p: string) => p.startsWith('/decisions') },
] as const;

const ROLE_LABELS: Record<Role, string> = {
  pm: 'PM',
  designer: 'Designer',
  engineer: 'Engineer',
};

export function AppHeader() {
  const pathname = usePathname();
  const {
    db,
    currentUser,
    members,
    activeMemberId,
    setActiveMemberId,
    refreshDb,
    resetDemo,
    toggleSimulateFailure,
    isResetting,
    isTogglingOutage,
  } = usePersona();
  const [labOpen, setLabOpen] = useState(false);
  const labRef = useRef<HTMLDivElement>(null);

  const simulateFailure = db?.settings.simulateCalendarFailure ?? false;

  const actionCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (!db) return map;
    const now = new Date().toISOString();
    for (const member of db.members) {
      map.set(member.id, countDeskActionItems(db.tasks, member, now));
    }
    return map;
  }, [db]);

  useEffect(() => {
    if (!labOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLabOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (labRef.current && !labRef.current.contains(e.target as Node)) {
        setLabOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [labOpen]);

  return (
    <div className="sticky top-0 z-30">
      {simulateFailure ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 bg-[#BE123C] px-4 py-1.5 text-xs font-semibold text-white sm:px-6"
        >
          <span className="inline-flex items-center gap-1.5">
            <AlertIcon className="h-3.5 w-3.5" />
            Calendar Provider Outage Simulation is ON — mutual agreements succeed but fail calendar write until Retry.
          </span>
          <button
            type="button"
            onClick={() => void toggleSimulateFailure()}
            disabled={isTogglingOutage}
            className="rounded border border-white/40 bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-white/25 disabled:opacity-60"
          >
            Turn Off Outage
          </button>
        </div>
      ) : null}

      <header className="border-b border-[#E5E2DC] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#111827] text-xs font-bold tracking-tight text-white">
                LH
              </span>
              <div className="hidden leading-tight sm:block">
                <span className="block text-sm font-bold tracking-tight text-[#111827]">
                  Living Handshake
                </span>
                <span className="block text-[11px] text-[#78716C]">
                  AI drafts · Two humans sign · Calendar unlocks
                </span>
              </div>
            </Link>

            <nav
              aria-label="Primary navigation"
              className="inline-flex items-center rounded-lg border border-[#E5E2DC] bg-[#F7F6F2] p-0.5"
            >
              {NAV_ITEMS.map((item) => {
                const isActive = item.match(pathname);
                const myCount = currentUser ? actionCounts.get(currentUser.id) ?? 0 : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                      isActive
                        ? 'bg-white text-[#111827] shadow-sm'
                        : 'text-[#57534E] hover:text-[#111827]'
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.href === '/' && myCount > 0 ? (
                      <span className="rounded-full bg-[#111827] px-1.5 py-0.2 font-mono text-[10px] font-bold text-white tabular-nums">
                        {myCount}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Instant 1-Click Persona Strip */}
            <div
              role="group"
              aria-label="Switch active persona"
              className="inline-flex items-center gap-0.5 rounded-full border border-[#E5E2DC] bg-[#F7F6F2] p-0.5"
            >
              {members.map((member) => {
                const active = member.id === activeMemberId;
                const count = actionCounts.get(member.id) ?? 0;
                const first = member.name.split(' ')[0];
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => setActiveMemberId(member.id)}
                    title={`${member.name} (${ROLE_LABELS[member.role]}) — ${count} item${count === 1 ? '' : 's'} needing action`}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-[#111827] text-white shadow-sm'
                        : 'text-[#57534E] hover:text-[#111827]'
                    }`}
                  >
                    <span>{first}</span>
                    {count > 0 ? (
                      <span
                        className={`rounded-full px-1.5 font-mono text-[10px] font-bold leading-4 tabular-nums ${
                          active ? 'bg-white text-[#111827]' : 'bg-[#BE123C] text-white'
                        }`}
                      >
                        {count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* Quarantined Demo Lab Popover */}
            <div className="relative" ref={labRef}>
              <button
                type="button"
                aria-expanded={labOpen}
                aria-haspopup="dialog"
                onClick={() => setLabOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  simulateFailure
                    ? 'border-[#BE123C] bg-[#FFF1F2] text-[#BE123C]'
                    : 'border-[#D1CCC2] bg-white text-[#111827] hover:bg-[#F7F6F2]'
                }`}
              >
                <FlaskIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Demo Lab</span>
              </button>

              {labOpen ? (
                <div
                  role="dialog"
                  aria-label="Demo Lab controls"
                  className="absolute right-0 mt-2 w-72 rounded-xl border border-[#D1CCC2] bg-white p-3.5 shadow-xl"
                >
                  <div className="flex items-center justify-between border-b border-[#E5E2DC] pb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#57534E]">
                      Demo Lab
                    </span>
                    <button
                      type="button"
                      onClick={() => void refreshDb()}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#57534E] hover:text-[#111827]"
                    >
                      <RefreshIcon className="h-3 w-3" />
                      Sync now
                    </button>
                  </div>

                  <div className="mt-3 space-y-3 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[#111827]">Simulate Calendar Outage</p>
                        <p className="mt-0.5 text-[11px] text-[#57534E]">
                          Confirmations succeed as mutual agreements, then fail calendar write so you can test Retry.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={simulateFailure}
                        disabled={isTogglingOutage || !db}
                        onClick={() => void toggleSimulateFailure()}
                        className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold transition-colors ${
                          simulateFailure
                            ? 'bg-[#BE123C] text-white'
                            : 'border border-[#D1CCC2] bg-[#F7F6F2] text-[#57534E]'
                        }`}
                      >
                        {simulateFailure ? 'ON' : 'OFF'}
                      </button>
                    </div>

                    <div className="border-t border-[#E5E2DC] pt-3">
                      <p className="font-semibold text-[#111827]">Reset Seeded Workweek</p>
                      <p className="mt-0.5 text-[11px] text-[#57534E]">
                        Restores clean Mon–Fri data, Carol’s Payment API decline, and seeded tasks.
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          await resetDemo();
                          setLabOpen(false);
                        }}
                        disabled={isResetting}
                        className="mt-2 w-full rounded-lg border border-[#D1CCC2] bg-[#F7F6F2] px-3 py-1.5 text-xs font-semibold text-[#111827] hover:bg-[#ECEAE4] disabled:opacity-50"
                      >
                        {isResetting ? 'Resetting…' : 'Reset Demo Data'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>
    </div>
  );
}
