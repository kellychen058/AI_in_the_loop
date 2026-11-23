'use client';

import { useState } from 'react';
import { EDGE_CASE_PRESETS, SAMPLE_MEETING_NOTES } from '@/lib/seed';
import type { Task } from '@/lib/types';
import { PlusIcon, SparkleIcon, XIcon } from './Icons';
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
  onExtracted,
  onClose,
}: {
  currentUserId: string;
  onChanged: () => Promise<void>;
  onExtracted?: (firstTaskId?: string) => void;
  onClose?: () => void;
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
        setOutcome({
          tone: 'error',
          title: errorText(result),
          detail: 'Paste notes with action items or add a task manually below.',
        });
        return;
      }
      const { tasks, usedFallbackAi, aiWarning } = result.data;
      if (tasks.length === 0) {
        setOutcome({
          tone: 'warning',
          title: 'No actionable tasks found in input',
          detail: aiWarning,
        });
      } else if (usedFallbackAi) {
        setOutcome({
          tone: 'warning',
          title: `${tasks.length} heuristic draft${tasks.length === 1 ? '' : 's'} created (zero-key offline mode)`,
          detail: aiWarning,
        });
      } else {
        setOutcome({
          tone: aiWarning ? 'warning' : 'success',
          title: `${tasks.length} draft${tasks.length === 1 ? '' : 's'} extracted via ${result.data.provider ?? 'AI'}`,
          detail: aiWarning,
        });
      }
      await onChanged();
      if (tasks.length > 0) onExtracted?.(tasks[0].id);
    } catch (err) {
      setOutcome({
        tone: 'error',
        title: err instanceof Error ? err.message : 'Extraction failed',
      });
    } finally {
      setExtracting(false);
    }
  }

  async function addManual() {
    setManualBusy(true);
    setManualError(null);
    const result = await apiFetch<{ task: Task }>('/api/tasks', {
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
    onExtracted?.(result.data.task?.id);
  }

  return (
    <section className="space-y-3 rounded-xl border border-[#D1CCC2] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[#111827]">Meeting Notes Intake</h2>
          <p className="mt-0.5 text-xs text-[#57534E]">
            AI drafts tasks in blueprint with verbatim quotes. Nothing is assigned or written to
            calendars until two humans sign.
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#57534E] hover:bg-[#F7F6F2] hover:text-[#111827]"
            aria-label="Collapse intake panel"
          >
            <XIcon className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass.secondary}
          onClick={() => loadPreset('Sprint 12 Product & Engineering Sync', SAMPLE_MEETING_NOTES)}
        >
          Load Sample Meeting Notes (ZH/EN)
        </button>
        <details className="relative">
          <summary className={`${buttonClass.secondary} cursor-pointer list-none`}>
            Demo Edge Cases
          </summary>
          <div className="absolute z-20 mt-1.5 w-56 rounded-lg border border-[#D1CCC2] bg-white p-1 shadow-xl">
            {Object.values(EDGE_CASE_PRESETS).map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-[#111827] hover:bg-[#F7F6F2]"
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
        <button
          type="button"
          className={buttonClass.secondary}
          onClick={() => setManualOpen((v) => !v)}
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Manual Task
        </button>
      </div>

      {manualOpen ? (
        <div className="space-y-2 rounded-lg border border-[#E5E2DC] bg-[#F7F6F2] p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#57534E]">
            Add Manual Draft
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className={`${inputClass} min-w-[200px] flex-1`}
              placeholder="Task title"
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
            />
            <input
              type="number"
              min={0.5}
              step={0.5}
              className={`${inputClass} w-24 font-mono tabular-nums`}
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
          </div>
          {manualError ? <Banner tone="error">{manualError}</Banner> : null}
        </div>
      ) : null}

      <div className="grid gap-2.5 sm:grid-cols-[1fr_2fr]">
        <input
          className={inputClass}
          placeholder="Meeting title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="flex items-center justify-between gap-2 text-xs text-[#78716C] sm:justify-end">
          <span className="font-mono tabular-nums">
            {notes.length.toLocaleString()} chars
            {notes.length > 15_000 ? ' (truncated to 15,000)' : ''}
          </span>
          <button
            type="button"
            className={buttonClass.primary}
            onClick={extract}
            disabled={extracting}
          >
            {extracting ? <Spinner /> : <SparkleIcon className="h-3.5 w-3.5" />}
            {extracting ? 'Extracting…' : 'Extract Drafts'}
          </button>
        </div>
      </div>

      <textarea
        className={`${inputClass} font-mono text-xs leading-relaxed`}
        rows={5}
        placeholder="Paste meeting notes (English, 繁體中文, or mixed)…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {outcome ? (
        <Banner tone={outcome.tone} title={outcome.title} onDismiss={() => setOutcome(null)}>
          {outcome.detail}
        </Banner>
      ) : null}
    </section>
  );
}
