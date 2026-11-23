'use client';

import { useState } from 'react';
import { EDGE_CASE_PRESETS, SAMPLE_MEETING_NOTES } from '@/lib/seed';
import type { Task } from '@/lib/types';
import { apiFetch, Banner, buttonClass, errorText, inputClass, Spinner } from './ui';

interface ExtractResponse {
  tasks: Task[];
  usedFallbackAi: boolean;
  aiWarning?: string;
  provider?: string;
}

interface Outcome {
  tone: 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
}

export function MeetingIngestPanel({
  currentUserId,
  onChanged,
}: {
  currentUserId: string;
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualHours, setManualHours] = useState('4');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  function loadPreset(presetTitle: string, rawNotes: string) {
    setTitle(presetTitle);
    setNotes(rawNotes);
    setOutcome(null);
  }

  async function extract() {
    setExtracting(true);
    setOutcome(null);
    try {
      const result = await apiFetch<ExtractResponse>('/api/meetings/extract', {
        method: 'POST',
        body: { title, rawNotes: notes, actorId: currentUserId },
      });
      if (!result.ok) {
        setOutcome({ tone: 'error', title: errorText(result), detail: 'Paste notes or add a task manually below.' });
        return;
      }
      const { tasks, usedFallbackAi, aiWarning } = result.data;
      if (tasks.length === 0) {
        setOutcome({ tone: 'warning', title: 'No actionable tasks found in input', detail: aiWarning });
      } else if (usedFallbackAi) {
        setOutcome({
          tone: 'warning',
          title: `${tasks.length} draft(s) from deterministic fallback mode — review drafts carefully`,
          detail: aiWarning,
        });
      } else {
        setOutcome({
          tone: aiWarning ? 'warning' : 'success',
          title: `${tasks.length} draft(s) extracted with ${result.data.provider ?? 'AI'}`,
          detail: aiWarning,
        });
      }
      await onChanged();
    } catch (err) {
      setOutcome({ tone: 'error', title: err instanceof Error ? err.message : 'Extraction failed' });
    } finally {
      setExtracting(false);
    }
  }

  async function addManual() {
    setManualBusy(true);
    setManualError(null);
    const result = await apiFetch('/api/tasks', {
      method: 'POST',
      body: { actorId: currentUserId, title: manualTitle, estimatedHours: Number(manualHours) },
    });
    setManualBusy(false);
    if (!result.ok) {
      setManualError(errorText(result));
      return;
    }
    setManualTitle('');
    setManualOpen(false);
    await onChanged();
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-base font-semibold text-slate-900">1. Paste meeting notes</h2>
        <p className="text-xs text-slate-500">
          AI drafts tasks with verbatim source quotes. Nothing is assigned until you submit.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass.secondary}
          onClick={() => loadPreset('Sprint 12 Product & Engineering Sync', SAMPLE_MEETING_NOTES)}
        >
          Load Sample Meeting Notes
        </button>
        <details className="relative">
          <summary className={`${buttonClass.secondary} cursor-pointer list-none`}>Try Edge Cases ▾</summary>
          <div className="absolute z-10 mt-1 w-56 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
            {Object.values(EDGE_CASE_PRESETS).map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                onClick={(event) => {
                  loadPreset(preset.title, preset.rawNotes);
                  event.currentTarget.closest('details')?.removeAttribute('open');
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </details>
      </div>

      <input
        className={inputClass}
        placeholder="Meeting title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className={`${inputClass} font-mono text-xs`}
        rows={9}
        placeholder="Paste meeting notes (English, 繁體中文, or mixed)…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {notes.length.toLocaleString()} chars{notes.length > 15_000 ? ' — will be truncated to 15,000' : ''}
        </span>
        <button type="button" className={buttonClass.primary} onClick={extract} disabled={extracting}>
          {extracting ? <Spinner /> : '✦'} {extracting ? 'Extracting…' : 'Extract Tasks with AI'}
        </button>
      </div>

      {outcome ? (
        <Banner tone={outcome.tone} title={outcome.title} onDismiss={() => setOutcome(null)}>
          {outcome.detail}
        </Banner>
      ) : null}

      <div className="border-t border-slate-100 pt-3">
        {manualOpen ? (
          <div className="space-y-2">
            <input
              className={inputClass}
              placeholder="Task title"
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
            />
            <div className="flex gap-2">
              <input
                type="number"
                min={0.5}
                step={0.5}
                className={`${inputClass} w-28`}
                value={manualHours}
                onChange={(e) => setManualHours(e.target.value)}
                aria-label="Estimated hours"
              />
              <button
                type="button"
                className={buttonClass.primary}
                onClick={addManual}
                disabled={manualBusy || !manualTitle.trim()}
              >
                {manualBusy ? <Spinner /> : null} Add Draft
              </button>
              <button type="button" className={buttonClass.secondary} onClick={() => setManualOpen(false)}>
                Cancel
              </button>
            </div>
            {manualError ? <Banner tone="error">{manualError}</Banner> : null}
          </div>
        ) : (
          <button type="button" className={buttonClass.secondary} onClick={() => setManualOpen(true)}>
            + Add Task Manually
          </button>
        )}
      </div>
    </section>
  );
}
