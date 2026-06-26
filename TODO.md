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
- **2b — TODO.** Webserver adapters implementing the ports over `db_service` /
  `file_service` with `user_id` scoping baked in; rewire `make_ally` + `route/ally.ts`
  to pass adapters instead of a raw history array. May ship first with raw-turn (or
  trivial-summary) project memory and swap in the real summarizer in step 3.

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

- [ ] Migration `008_extend_projects` comment: `instructions` is **appended**, not
      "prepended" — fix the column comment/doc to match the decided behavior.
- [ ] `grant_reviewer.ts` `set_context`: validate content (`TODO:[grant reviewer]`).
- [ ] Test type-checking: `test/` is outside the build `include`, so tsc doesn't type-check
      tests (they run via Node type-stripping). Add a test tsconfig if compile-time checking
      is wanted.
