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
  Project `instructions` now flow end-to-end (appended to Ally's system prompt — raw and
  unclamped today; hardening tracked in "Decision: project instructions"). Cross-chat
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

- **Summarize per chat; compose siblings on demand.** Cache one summary per *chat*, not one
  per project. For the active chat's request, concatenate its *siblings'* cached summaries into
  a single framed block — a cheap, model-free concat in the hot path; the expensive per-chat
  summarization happens out of band. Self-exclusion and narrow invalidation both fall out of
  this keying (see below). Raw sibling turns are never interleaved — only their summaries — to
  avoid role-confusion with the live conversation and to bound tokens.
- **Inject as one framed leading turn** in the request `messages` array — the slot
  `assemble()` already fills from `ProjectContext.memory` (i.e. `memory: [siblingBlockTurn]`,
  e.g. `"## Context from related project chats\n<sibling summaries>"`). One turn, so the
  cacheable prefix stays a single turn; its content varies per active chat but is stable within
  a chat session until a sibling changes. System-prompt-after-instructions is an acceptable
  alternative; the leading turn was chosen to reuse the mechanism and keep knowledge out of the
  behavior block.
- **Do NOT prepend to the live user message.** It breaks prompt caching (rides the
  ever-changing user turn), diverges persisted-vs-sent messages, and is inconsistent across
  multi-turn chats.
- **On-demand composition, not fan-out.** The sibling block is assembled per request for the
  *active* chat only; siblings are read-from, never written-to, and nothing is persisted into
  any chat transcript. Only the concat is per-request — each per-chat summary is generated out
  of band.
- **Cache one summary per chat.** Generation is the expensive part: (re)generate each chat's
  summary out of band with a cheap model (e.g. Haiku) and cache it. Per-chat keying means a new
  message invalidates only *that* chat's summary, not a shared project blob — a multi-chat
  project never thrashes one ever-stale summary. Never summarize synchronously in the hot path.
- **Exclude the current chat** — falls out of composing *siblings'* summaries; the active
  chat's own turns are already in its history.
- **Framing nit:** this is RAG / background context, *not* in-context learning — label the
  block as context, not examples.

### Step-3 sub-items
- [ ] Schema: per-*chat* memory-summary storage + staleness tracking — e.g.
      `chats.memory_summary` + `memory_summary_updated_at`, or a derived table keyed by
      `chat_id` (migration). Per-chat, not per-project (see decision above).
- [ ] Summarizer job: (re)generate a single chat's summary out of band with a cheap model.
- [ ] Invalidation: a new message in a chat invalidates *that chat's* summary. (Chat
      added/removed from a project needs no invalidation — composition is per-request, so it
      picks up membership changes automatically.)
- [ ] Compose-on-demand: in the project adapter, gather the active chat's siblings' summaries
      into the single framed `ProjectContext.memory` block, excluding the active chat.
- [ ] Prompt caching: mark the stable prefix (system + leading memory turn) with
      `cache_control` in the model layer (currently unset in `model/anthropic.ts`).
- [ ] Unified token-aware budget (supersedes char caps); priority between project memory and
      recent history.

## Decision: project instructions in the system prompt (`instructions`)

Project `instructions` are user-controlled text composed into the system prompt after the base
prompt. They ship today (2b) as a raw, unbounded `\n\n` append — two hardening requirements
before that is safe:

- **Fence with precedence.** Wrap the user instructions in an injected frame that tells the
  model to follow them *unless they conflict with the base system prompt*, in which case the
  base prompt wins and the conflicting instruction is ignored. Raw appending puts user text in
  the highest-authority position, letting project instructions override Ally's guardrails; the
  base prompt must stay authoritative.
- **Clamp to the budget.** Instructions currently bypass the `ContextAssembler` budget and
  enter the prompt unbounded — the one piece of directly user-controlled text that skips the
  guardrail the assembler exists to provide. Clamp via `clamp_document` (or a dedicated
  `max_instructions_chars`).

### Tasks
- [ ] `assemble()`: wrap `project.instructions` in the precedence frame instead of the raw
      `\n\n` append (`core/context.ts`).
- [ ] `assemble()`: clamp `instructions` to the budget before composing it in.
- [ ] Tests: precedence frame is present; oversized instructions are truncated.

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

## Future: token accounting — estimate vs actual

Two distinct needs, usually conflated as "token counting." Documented now; not required for the
memory work. (Raised as: a model-delegated token abstraction in `core/bot.ts` for internal +
per-provider/per-user metrics — auditing.)

- **Estimate** (pre-send, provider-independent) → budgeting / future quota enforcement. The Phase-C
  local estimator (`core/tokens.ts`). Cheap, synchronous, **no I/O** — safe inside `assemble()`. This
  is the embryonic internal token metric; promote/normalize it later if we expose quotas.
- **Actual** (post-receive, provider-exact, per-user) → auditing / billing / cost attribution. Source
  is `message.usage` on the generation response — input **+ output + cache_read + cache_creation**,
  which `count_tokens` cannot give (it's pre-send, input-only). Already in hand and discarded today:
  `model/anthropic.ts` `extract_content` only `console.log`s `msg.usage`. The audit feature is mostly
  plumbing this through instead of logging it.

Decision / seam:
- **Surface `usage` up the existing reply path.** `Model.gen_message` already returns the full
  `Anthropic.Message`; have `Chatbot.gen_reply` / `BotReply` carry a normalized `usage` instead of
  dropping it. Core surfaces it (it knows model + provider); putting this on the model-delegated path
  is consistent with the layering — `Model` is the injected I/O seam, not pure policy.
- **Host assembles the audit record.** Core never sees `user_id` (auth boundary). `route/ally.ts` has
  `req.session.user_id`; persist `{ user_id, chat_id, provider, model, input, output, cache_read,
  cache_creation, ts }`. Store **raw** provider counts + model/provider id; derive any normalized
  internal unit later — don't invent a synthetic unit up front (YAGNI; raw is unrecoverable once lost).
- **Optional `Model.count_tokens()` capability** (delegated through `Chatbot`, per the suggestion) for
  preflight context-limit checks / offline estimator calibration. It is **I/O** (a network round-trip,
  input-only) — fine as a `Model` capability, but **never call it from `assemble()`**, and it does not
  serve auditing (that needs actual `usage`).
