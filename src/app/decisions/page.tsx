'use client';

import { AuditTimeline } from '@/components/AuditTimeline';
import { RejectionLogTable } from '@/components/RejectionLogTable';
import { Banner, buttonClass } from '@/components/ui';
import { usePersona } from '@/context/PersonaContext';
import { buildEvaluationExport, summarizeEvaluation } from '@/lib/evaluation';

export default function DecisionsPage() {
  const { db, loading, error } = usePersona();
  const summary = db ? summarizeEvaluation(db) : null;

  function exportJson() {
    if (!db) return;
    const payload = buildEvaluationExport(db);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `evaluation-log-${payload.exportedAt.slice(0, 19).replace(/:/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#111827]">
            Trust &amp; Decision Ledger
          </h1>
          <p className="mt-0.5 text-xs text-[#57534E]">
            Every human decline AI must respect, and every timestamped receipt in order.
          </p>
        </div>
        <button type="button" onClick={exportJson} disabled={!db} className={buttonClass.primary}>
          Export Evaluation Log (JSON)
        </button>
      </div>

      {error ? <Banner tone="error" title="Failed to load state">{error}</Banner> : null}
      {loading ? <p className="text-xs text-[#78716C]">Loading ledger…</p> : null}

      {/* 3 Verbatim Evidence-Backed Trust Metrics */}
      {summary ? (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[#E5E2DC] bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#57534E]">
              Work blocks without a linked task with a recorded confirmation
            </p>
            <p
              className={`mt-2 font-mono text-2xl font-bold tabular-nums ${
                summary.unapprovedCalendarBlocks === 0 ? 'text-[#047857]' : 'text-[#BE123C]'
              }`}
            >
              {summary.unapprovedCalendarBlocks}
            </p>
            <p className="mt-1 text-[11px] text-[#78716C]">
              {summary.confirmations} mutual confirmation{summary.confirmations === 1 ? '' : 's'}{' '}
              recorded · {summary.calendarSyncFailures} sync failure
              {summary.calendarSyncFailures === 1 ? '' : 's'}
            </p>
          </div>

          <div className="rounded-xl border border-[#E5E2DC] bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#57534E]">
              Rejection Memory
            </p>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="font-mono text-2xl font-bold text-[#111827] tabular-nums">
                {summary.activeRejectionBlocks}
              </span>
              <span className="text-xs font-medium text-[#57534E]">
                decline{summary.activeRejectionBlocks === 1 ? '' : 's'} with no logged override
              </span>
            </div>
            <p className="mt-1 text-[11px] text-[#78716C]">
              {summary.overriddenRejections} overridden with justification · {summary.rejections}{' '}
              total declines recorded
            </p>
          </div>

          <div className="rounded-xl border border-[#E5E2DC] bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#57534E]">
              Workload &amp; Negotiation
            </p>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="font-mono text-2xl font-bold text-[#111827] tabular-nums">
                {summary.proposalsWithConflict}
              </span>
              <span className="text-xs font-medium text-[#57534E]">
                initial proposal{summary.proposalsWithConflict === 1 ? '' : 's'} sent over capacity
              </span>
            </div>
            <p className="mt-1 text-[11px] text-[#78716C]">
              {summary.counterProposals} counter-proposal{summary.counterProposals === 1 ? '' : 's'}
              {summary.avgHoursToConfirmation !== null
                ? ` · ${summary.avgHoursToConfirmation}h avg initial-send to confirm`
                : ''}
            </p>
          </div>
        </section>
      ) : null}

      {db ? (
        <>
          <section className="rounded-xl border border-[#E5E2DC] bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold text-[#111827]">Rejection Memory Registry</h2>
              <span className="font-mono text-[11px] text-[#78716C] tabular-nums">
                {db.rejections.length} record{db.rejections.length === 1 ? '' : 's'}
              </span>
            </div>
            <RejectionLogTable
              rejections={db.rejections}
              auditLog={db.auditLog}
              members={db.members}
            />
          </section>

          <section className="rounded-xl border border-[#E5E2DC] bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-[#111827]">Decision &amp; Receipt Timeline</h2>
            <AuditTimeline auditLog={db.auditLog} tasks={db.tasks} members={db.members} />
          </section>
        </>
      ) : null}
    </div>
  );
}
