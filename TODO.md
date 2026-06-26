# TODO

Working set of things to do. Newest decisions captured inline so they aren't lost.

## Memory / context refactor

**Goal:** move memory/context *strategy* into the chatbot core behind ports; keep
I/O + auth in the webserver. **Driver:** project `instructions` + `memory_enabled`
(migration `008_extend_projects`).

**Layering rule:** core owns *policy* (selection, budgeting, composition). The host
(webserver) owns *I/O, user-scoping, and authorization* via adapter implementations
of the core ports. Core never imports the DB / file storage and never makes an authz
decision.

### Step 1 — context assembler — DONE
- `ContextAssembler` in `core/context.ts`: char-based budget +
  `clamp_document` / `clamp_message` / `window_history`.
- Both bots routed through it; scattered capping TODOs removed.
- Constructor asserts every budget cap `> 0`.
- Unit tests in `test/unit/context.test.ts`.

### Step 2 — source ports
- **2a — DONE.** Core ports `HistorySource`, `ProjectContextSource`, `ProjectContext`;
  `assemble({ system_prompt, history?, project?, message? }) -> { system, messages }`.
  Exported from `chatlib.ts`. Unit-tested with in-memory fake ports.
  - Decided: project `instructions` are **appended after** the base system prompt.
    (Migration 008's "prepended" wording is a doc error — see misc fix below.)
- **2b — DONE.** Webserver adapters `ChatHistorySource` / `ChatProjectContextSource`
  (in `src/context/`, `#context/*` alias) implement the ports over `db_service` with
  `user_id` scoping baked in; `db.get_project_by_chat_id` added. `Ally.respond` now takes
  the ports and pulls via `assemble()`; `route/ally.ts` constructs and passes the adapters.
  Project `instructions` now flow end-to-end (appended to Ally's system prompt). Cross-chat
  memory is stubbed (`memory: []`) pending the step-3 summarizer.
  - Decided: the assembler is **constructed by the bot, not injected**. Inject only what
    needs host-only info/capability (endpoint = secrets, ports = DB); the budget is intrinsic
    to the bot, so the factory builds its own `ContextAssembler`. Minimal future seam if a
    deployment needs to override caps: an optional `make_ally(endpoint, budget?)` param.
  - Tested: both adapters (`test/unit/context/`, with a shared `test/mock/db.ts` fake). The
    assembler is covered by the chatbot's `context.test.ts`. Still untested: `Ally.respond`
    wiring itself (thin glue over the already-tested `assemble()`; would need a fake model).

### Step 3 — sophisticated strategy
- Unified, **token-aware** budget across all replayed context (replaces the char caps),
  with a deliberate priority between cross-chat memory and recent turns. (Tracked by the
  TODO in `assemble()` / `_clamp`.)
- Cross-chat "project memory" — see decision below.

## Decision: cross-chat "project memory" (`memory_enabled`)

When a project has `memory_enabled`, a chat may draw on its sibling chats in the same
project. A chat belongs to a single project (logical; not enforced in schema).

- **Summarize, don't interleave.** Represent sibling-chat context as a single synthesized
  summary, not raw turns — avoids role-confusion with the live conversation, bounds tokens,
  distills relevance.
- **Inject as one framed leading turn** in the request `messages` array — the slot
  `assemble()` already fills from `ProjectContext.memory` (i.e. `memory: [summaryTurn]`,
  e.g. `"## Context from related project chats\n<summary>"`). System-prompt-after-instructions
  is an acceptable alternative; the leading turn was chosen to reuse the mechanism and keep
  knowledge out of the behavior block.
- **Do NOT prepend to the live user message.** It breaks prompt caching (rides the
  ever-changing user turn), diverges persisted-vs-sent messages, and is inconsistent across
  multi-turn chats.
- **On-demand injection, not fan-out.** The summary is built per request for the *active*
  chat only. Siblings are read-from to generate it, never written-to; nothing is persisted
  into any chat transcript.
- **One cached summary per project.** Generation is the expensive part: precompute with a
  cheap model (e.g. Haiku), cache it, and invalidate on sibling change. Never summarize
  synchronously in the hot path of a chat turn.
- **Exclude the current chat** from its own summary (its turns are already in history).
- **Framing nit:** this is RAG / background context, *not* in-context learning — label the
  block as context, not examples.

### Step-3 sub-items
- [ ] Schema: project memory-summary storage + staleness tracking — e.g.
      `projects.memory_summary` + `memory_summary_updated_at`, or a derived table (migration).
- [ ] Summarizer job: (re)generate the per-project summary with a cheap model.
- [ ] Invalidation triggers on sibling change (message added; chat added/removed from project).
- [ ] Prompt caching: mark the stable prefix (system + leading memory turn) with
      `cache_control` in the model layer (currently unset in `model/anthropic.ts`).
- [ ] Unified token-aware budget (supersedes char caps); priority between project memory and
      recent history.

## Misc

- [ ] Enforce single-project-per-chat in the DB. `project_chats` is physically
      many-to-many, but the code now assumes a chat belongs to at most one project
      (`get_project_by_chat_id` asserts `<= 1`). Make it a real invariant at the model
      level — e.g. a `UNIQUE (chat_id)` constraint on `project_chats` (migration) — so the
      assertion can't be violated by data.
- [ ] Migration `008_extend_projects` comment: `instructions` is **appended**, not
      "prepended" — fix the column comment/doc to match the decided behavior.
- [ ] `grant_reviewer.ts` `set_context`: validate content (`TODO:[grant reviewer]`).
- [ ] Test type-checking: `test/` is outside the build `include`, so tsc doesn't type-check
      tests (they run via Node type-stripping). Add a test tsconfig if compile-time checking
      is wanted.
