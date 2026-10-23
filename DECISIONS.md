# Decisions Log

## 2026-09-21 — Initial code steward
**What:** 陳奕潔 is the initial code steward for the team.
**Why:** volunteered

## 2026-10-23 — Initial interaction design: meeting → task → calendar tool
**What:** Build a tool that combines "meeting outcomes → tasks → assignment → confirmation → calendar" in one flow.
- **Inputs:** Meeting notes or discussion messages; member calendars (busy/free only is enough); existing tasks with deadlines and remaining estimated hours; self-reported weekly available hours; estimated hours for new tasks (from the assigner or assignee, AI may suggest a reference value); task dependencies; confirmation results; previously rejected options and reasons.
- **Outputs:** Task drafts, each linked to its source discussion; suggested assignee and deadline with reasoning; workload check flagging overloaded members; confirmation status per task; work blocks written to the calendar (or a task list); per-member sync success/failure; an auditable log of decisions, changes, and rejections.
- **Workload conflict:** Available hours before deadline = reported work hours − scheduled meeting hours − remaining estimated hours of existing tasks in that period. Conflict if new task hours > available hours; "near capacity" if less than 20% remains after the new task.
- **Flow:** Assigner pastes meeting notes → system drafts tasks; assigner corrects them and adds estimates → system suggests assignees and deadlines based on workload → assigner submits → assignees accept, propose a new deadline, or decline with a reason (all logged) → any change triggers a workload re-check and a new pending version → once assigner and assignee confirm the same version, work blocks are written to the calendar; failures are clearly flagged with retry. Later reschedules list affected tasks/members and go through the same re-check and confirmation.
- **First-version scope:** Extract tasks from text meeting notes; check workload per the definition above; assign tasks and get assignee confirmation; sync with one calendar service (Google Calendar or Outlook, TBD).

**Why:** Post-meeting task assignment is often scattered across tools, with assignees and deadlines chosen without workload data or explicit confirmation. Keeping humans as final decision-makers, with AI providing suggestions and checks plus a full decision log, reduces overload and scheduling conflicts.
