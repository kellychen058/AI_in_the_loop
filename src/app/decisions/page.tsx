'use client';

import { AuditTimeline } from '@/components/AuditTimeline';
import { RejectionLogTable } from '@/components/RejectionLogTable';
import { Banner, buttonClass } from '@/components/ui';
import { usePersona } from '@/context/PersonaContext';
import { buildEvaluationExport, summarizeEvaluation } from '@/lib/evaluation';

export default function DecisionsPage() {
  const { db, loading, error, refreshDb } = usePersona();
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

  const stats = summary
    ? [
        ['Rejections', summary.rejections],
        ['Active blocks', summary.activeRejectionBlocks],
        ['Overrides', summary.overriddenRejections],
        ['Proposals w/ conflict', summary.proposalsWithConflict],
        ['Confirmations', summary.confirmations],
        ['Unapproved calendar blocks', summary.unapprovedCalendarBlocks],
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Decisions &amp; Rejection Audit Log</h1>
          <p className="mt-1 text-sm text-slate-600">
            Every rejection the AI must respect, and every human decision in order.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={exportJson} disabled={!db} className={buttonClass.primary}>
            Export Evaluation Log (JSON)
          </button>
          <button type="button" onClick={() => void refreshDb()} className={buttonClass.secondary}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <Banner tone="error" title="Failed to load state">{error}</Banner> : null}
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}

      {summary ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
            </div>
          ))}
        </section>
      ) : null}

      {db ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-base font-semibold text-slate-900">Previously rejected options</h2>
            <RejectionLogTable rejections={db.rejections} auditLog={db.auditLog} members={db.members} />
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-base font-semibold text-slate-900">Audit timeline</h2>
            <AuditTimeline auditLog={db.auditLog} tasks={db.tasks} members={db.members} />
          </section>
        </>
      ) : null}
    </div>
  );
}
