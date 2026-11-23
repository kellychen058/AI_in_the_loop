# AI-in-the-Loop Planner

A collaborative prototype for **Meeting Notes → Task Assignment → Two-Party Confirmation → Calendar Sync**, keeping humans as the final decision-makers while AI assists with task drafting, workload conflict visibility, and rejection memory.

## Quick Start (3 Steps — Zero API Keys Required)

> **Zero-key out-of-the-box demo:** Both the web app and the Vitest suite run locally with **no environment variables or API keys configured** (deterministic mock fallback mode). Per [`AI-usage-guildline.md`](./AI-usage-guildline.md), API keys and `.env.local` are handled exclusively by humans and are never committed.

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Start the development server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000). A local JSON database (`data/db.json`, gitignored) is automatically seeded for the active Mon–Fri workweek.
3. **Run tests & production build check**
   ```bash
   npm test
   npm run build
   ```

### Optional: Connecting a Live LLM Provider

Copy `.env.example` to `.env.local` manually and supply a provider key (`openai`, `gemini`, or `anthropic`). Leave `LLM_PROVIDER=mock` (or omit `.env.local`) to run in deterministic offline mode.

## Demo Flow & Zero-Login Persona Switcher

Use the **Acting as** dropdown in the top navigation bar to switch personas instantly without logging in (persisted in `localStorage` and synced across tabs via `/api/state`):

- **Alice Chen (PM, 35h/wk):** Assigner pasting meeting notes, checking team capacity, and proposing tasks.
- **Bob Lin (Designer, 30h/wk):** Light load with plenty of open capacity for design tasks.
- **Carol Wu (Engineer, 30h/wk):** Heavy meetings (12h) + confirmed tasks (12h) leaving **~6h free** this week, plus a historical rejection for a 10h Payment API task due to overload.
- **David Wang (Engineer, 25h/wk):** Moderate load (~17h free) — a viable engineering alternative to Carol, with a confirmed task depending on Carol's OAuth2 task.

Click **Reset Demo Data** in the header at any time to restore `data/db.json` to the clean seeded state (`POST /api/demo/reset`).

## The 4 Screens

| Route | Screen | Purpose |
|---|---|---|
| `/` | **Assigner Workspace** | Paste meeting notes, review/edit AI-drafted tasks with source quotes, inspect live workload conflict math, and submit proposals with rejection guards. *(Expanded in #12)* |
| `/inbox` | **Assignee Inbox & Negotiation** | Persona-aware queue for accepting, counter-proposing, or declining tasks with version locks, rescheduling confirmed tasks, and retrying calendar sync failures. *(Expanded in #13)* |
| `/calendar` | **Shared Team Calendar** | Mon–Fri 09:00–18:00 grid of meetings and confirmed task work blocks, capacity sidebar, `.ics` export, and toggleable sync failure simulation. *(Expanded in #14)* |
| `/decisions` | **Decisions & Rejection Audit Log** | Structured rejection memory table, filterable chronological audit trail, and evaluation JSON export. *(Expanded in #15)* |

## Project Structure

- `src/lib/types.ts` — Canonical shared TypeScript contracts across all tracks
- `src/lib/store.ts` — Cross-platform atomic JSON store (`data/db.json`) with per-path write queue
- `src/lib/seed.ts` — Workweek-anchored seed data, sample meeting notes, and edge-case presets
- `src/lib/workload.ts`, `src/lib/ai/extract.ts`, `src/lib/workflow.ts`, `src/lib/calendar/*` — Typed service contracts built out in parallel during Wave 1 (#8–#11)
- `src/context/PersonaContext.tsx` & `src/components/AppHeader.tsx` — Shared persona state and navigation shell
- `tests/` — Vitest unit and integration test suites
