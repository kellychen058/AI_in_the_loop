# CLAUDE.md — repo guide for teammates and AI agents

AI-in-the-Loop Planner: **meeting notes → AI task drafts → workload check → two-party
confirmation → calendar work blocks**, with a decision/rejection audit log. Humans make every
final decision; AI only drafts and suggests.

## Commands

```bash
npm install
npm run dev        # http://localhost:3000, auto-seeds data/db.json
npm test           # Vitest, offline, zero API keys
npm run typecheck
npm run build
RUN_LIVE_LLM_TESTS=1 npm test   # optional: prompt suite against a real LLM (human-supplied key)
```

## Security boundary (from `AI-usage-guildline.md`)

- API keys, credentials and `.env.local` are handled **only by humans**. Agents never create,
  read, edit or commit them, and never hardcode keys.
- Code reads keys only via `process.env.*` in `src/lib/ai/client.ts`. With no key the app and
  tests run in deterministic fallback mode.
- PR descriptions and `DECISIONS.md` entries are written/personalized by humans.

## Architecture

| Layer | Files | Notes |
|---|---|---|
| Contracts | `src/lib/types.ts` | Shared types. Change only with team agreement. |
| Store | `src/lib/store.ts`, `src/lib/seed.ts` | JSON file `data/db.json` (gitignored), per-path write queue, seeded per workweek. |
| AI | `src/lib/ai/{client,prompts,extract}.ts` | Provider wrapper (OpenAI/Gemini/Anthropic/mock) that never throws; extraction + assignee suggestion with heuristic fallback. See `docs/PROMPT_CARD.md`. |
| Workload | `src/lib/workload.ts` | Deterministic capacity math; no AI. |
| Workflow | `src/lib/workflow.ts`, `src/lib/taskRoles.ts` | Draft → propose → accept/counter/decline → confirmed/sync_failed; reschedule; rejection guard (`409 PREVIOUSLY_REJECTED`). `taskRoles.ts` is pure (safe for client components). |
| Calendar | `src/lib/calendar/*` | `CalendarAdapter` seam, block scheduler, `.ics`, simulated outage + retry. |
| Evaluation | `src/lib/evaluation.ts` | Summary metrics + JSON export for `/decisions`. |
| API | `src/app/api/**/route.ts` | Thin handlers over the libs above. |
| UI | `src/app/{page,inbox,calendar,decisions}`, `src/components/*` | Client pages read shared state from `PersonaContext` (polls `/api/state` every 3s). Shared helpers in `src/components/ui.tsx`. |

## Conventions

- TypeScript strict, Tailwind, no extra UI libraries.
- Server time is local time (same convention as `seed.ts`); date pickers mean 18:00 local.
- Tests live in `tests/*.test.ts` and must run offline. Pass explicit `now` to time-dependent
  functions; stub `fetch` and env vars for LLM paths.
- Prompt changes: add or update a case in `tests/fixtures/prompt-cases.json` and log the
  revision in `docs/PROMPT_CARD.md`.
- Every PR: `npm test` + `npm run build` green, uses `.github/pull_request_template.md`, never
  commits `data/db.json` or `.env*.local`.
