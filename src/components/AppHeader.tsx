'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { usePersona } from '@/context/PersonaContext';
import { getInboxSection } from '@/lib/taskRoles';
import type { Role } from '@/lib/types';

const NAV_ITEMS = [
  { href: '/', label: 'Workspace' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/decisions', label: 'Decisions' },
] as const;

const ROLE_LABELS: Record<Role, string> = {
  pm: 'PM',
  designer: 'Designer',
  engineer: 'Engineer',
};

const ROLE_BADGE_CLASSES: Record<Role, string> = {
  pm: 'bg-purple-100 text-purple-800',
  designer: 'bg-pink-100 text-pink-800',
  engineer: 'bg-blue-100 text-blue-800',
};

export function AppHeader() {
  const pathname = usePathname();
  const { db, currentUser, members, activeMemberId, setActiveMemberId, resetDemo, isResetting } =
    usePersona();

  const inboxActionCount = useMemo(() => {
    if (!db || !currentUser) return 0;
    return db.tasks.filter((task) => getInboxSection(task, currentUser.id) === 'action').length;
  }, [db, currentUser]);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white shadow-sm">
              AI
            </span>
            <div className="leading-tight">
              <span className="block text-sm font-semibold text-slate-900">
                AI-in-the-Loop Planner
              </span>
              <span className="block text-xs text-slate-500">
                Meeting → Task → Confirm → Calendar
              </span>
            </div>
          </Link>

          <nav aria-label="Primary navigation" className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.href === '/inbox' && inboxActionCount > 0 ? (
                    <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                      {inboxActionCount}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <label htmlFor="persona-switcher" className="text-xs font-medium text-slate-500">
              Acting as
            </label>
            <select
              id="persona-switcher"
              value={activeMemberId}
              onChange={(event) => setActiveMemberId(event.target.value)}
              className="rounded border-none bg-transparent text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {members.length > 0 ? (
                members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} ({ROLE_LABELS[member.role]})
                  </option>
                ))
              ) : (
                <option value="alice">Alice Chen (PM)</option>
              )}
            </select>
            {currentUser ? (
              <span
                className={`hidden rounded-full px-2 py-0.5 text-xs font-medium sm:inline-block ${ROLE_BADGE_CLASSES[currentUser.role]}`}
              >
                {ROLE_LABELS[currentUser.role]}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void resetDemo()}
            disabled={isResetting}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isResetting ? 'Resetting…' : 'Reset Demo Data'}
          </button>
        </div>
      </div>
    </header>
  );
}
